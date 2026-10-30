-- Tudo Azul — migration 029: gestão de empréstimos e pagamentos atômicos
-- Reutiliza debts/debt_events como fonte única do saldo devedor.

alter table public.debts
  add column monthly_rate_bps integer not null default 0
    check (monthly_rate_bps between 0 and 10000),
  add column minimum_payment numeric not null default 0
    check (minimum_payment >= 0 and minimum_payment = round(minimum_payment, 2) and abs(minimum_payment) < 1e12);

-- Taxa em pontos-base por mês: 150 = 1,50% ao mês. Parcela mínima em BRL.
create function public.debt_set_terms(p_debt uuid, p_monthly_rate_bps integer, p_minimum_payment numeric)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_d public.debts%rowtype;
begin
  v_d := private.debt_lock(p_debt);
  if p_monthly_rate_bps is null or p_monthly_rate_bps not between 0 and 10000 then
    raise exception 'taxa mensal deve estar entre 0%% e 100%%' using errcode = '22023';
  end if;
  if p_minimum_payment is null or p_minimum_payment < 0 then
    raise exception 'pagamento mínimo inválido' using errcode = '22023';
  end if;
  if p_minimum_payment <> round(p_minimum_payment, 2) then
    raise exception 'valor com mais de 2 casas decimais' using errcode = '22003';
  end if;
  update public.debts
     set monthly_rate_bps = p_monthly_rate_bps,
         minimum_payment = p_minimum_payment
   where id = v_d.id and household_id = v_d.household_id;
end $$;

-- Registra principal, juros e tarifa na mesma transação. O op_id permite anular
-- todo o pagamento de uma só vez com debt_void(event_id, reason).
create function public.debt_record_payment(
  p_debt uuid,
  p_date date,
  p_account uuid,
  p_principal numeric,
  p_interest numeric default 0,
  p_fee numeric default 0,
  p_category uuid default null,
  p_extra boolean default false
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_d public.debts%rowtype;
  v_op uuid := gen_random_uuid();
begin
  v_d := private.debt_lock(p_debt);

  if p_date is null or p_account is null or p_principal is null or p_interest is null or p_fee is null
     or p_principal < 0 or p_interest < 0 or p_fee < 0
     or coalesce(p_principal, 0) + coalesce(p_interest, 0) + coalesce(p_fee, 0) <= 0 then
    raise exception 'valores e data do pagamento inválidos' using errcode = '22023';
  end if;
  if p_principal <> round(p_principal, 2)
     or p_interest <> round(p_interest, 2)
     or p_fee <> round(p_fee, 2) then
    raise exception 'valor com mais de 2 casas decimais' using errcode = '22003';
  end if;
  if (p_interest > 0 or p_fee > 0) and p_category is null then
    raise exception 'juros e tarifas exigem uma categoria de despesa' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.accounts a
     where a.household_id = v_d.household_id and a.id = p_account
       and a.active and a.opening_date <= p_date
  ) then
    raise exception 'conta de pagamento inexistente, arquivada ou ainda não aberta' using errcode = '23514';
  end if;
  if p_category is not null and not exists (
    select 1 from public.categories c
     where c.household_id = v_d.household_id and c.id = p_category
       and c.type = 'expense' and c.active
  ) then
    raise exception 'categoria de despesa inválida ou inativa' using errcode = '23514';
  end if;

  if p_principal > 0 then
    insert into public.debt_events
      (household_id, debt_id, date, kind, amount, account_id, op_id, note)
    values
      (v_d.household_id, v_d.id, p_date,
       case when coalesce(p_extra, false) then 'extra_principal' else 'payment' end,
       p_principal, p_account, v_op, 'pagamento registrado no módulo de dívidas');
  end if;

  if p_interest > 0 then
    insert into public.debt_events
      (household_id, debt_id, date, kind, amount, account_id, category_id, op_id, note)
    values (v_d.household_id, v_d.id, p_date, 'interest', p_interest, p_account, p_category, v_op, 'juros do pagamento');
  end if;

  if p_fee > 0 then
    insert into public.debt_events
      (household_id, debt_id, date, kind, amount, account_id, category_id, op_id, note)
    values (v_d.household_id, v_d.id, p_date, 'fee', p_fee, p_account, p_category, v_op, 'tarifa do pagamento');
  end if;

  perform private.debt_chk(v_d.id);
  return v_op;
end $$;

revoke execute on function public.debt_set_terms(uuid, integer, numeric),
  public.debt_record_payment(uuid, date, uuid, numeric, numeric, numeric, uuid, boolean)
  from public, anon;
grant execute on function public.debt_set_terms(uuid, integer, numeric),
  public.debt_record_payment(uuid, date, uuid, numeric, numeric, numeric, uuid, boolean)
  to authenticated;
