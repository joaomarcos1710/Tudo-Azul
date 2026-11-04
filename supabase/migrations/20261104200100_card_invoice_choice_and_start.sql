-- Tudo Azul — migration 051: escolher a fatura da compra e mudar o início do cartão.
-- Pedido do dono (04/11/2026), na importação do histórico do Organizze:
--   1. "um botão onde podemos escolher em qual fatura lançar: a do mês ou até 3 antes e 3 depois".
--      public.card_purchase_at = card_purchase + p_invoice_offset (-3..+3): desloca a 1ª parcela (e as
--      seguintes) N faturas a partir da que a data da compra daria. card_purchase continua igual.
--   2. "desproteja" a data de referência. A trava protegia contra contar duas vezes o que já está no
--      saldo de referência. O que ela deve barrar é a FATURA fechar até a data de referência, não a
--      data da compra: compra feita antes, mas que fecha depois, não está no saldo e pode entrar.
--      E public.card_set_start permite RECUAR o início do cartão (data e saldo de referência), para
--      lançar o passado. A âncora continua imutável por UPDATE direto; só esta função a muda, ligando a
--      marca app.debt_anchor_edit dentro da própria chamada (set_config local, que o cliente não alcança).

-- 1. a âncora só muda pela função --------------------------------------------
create or replace function private.debts_immutable() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if (new.household_id, new.kind) is distinct from (old.household_id, old.kind)
     or ((new.reference_date, new.reference_balance) is distinct from (old.reference_date, old.reference_balance)
         and coalesce(current_setting('app.debt_anchor_edit', true), '') <> 'on') then
    raise exception 'âncora da dívida é imutável' using errcode = '42501';
  end if;
  return new;
end $$;

-- 2. recuar o início do cartão -----------------------------------------------
-- Só para trás, e só se nada (evento ou fechamento de parcela) cair até a nova data.
create function public.card_set_start(p_debt uuid, p_date date, p_balance numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare v_d public.debts%rowtype;
begin
  v_d := private.debt_lock(p_debt);
  if v_d.kind <> 'card' then
    raise exception 'só cartão' using errcode = '23514';
  end if;
  if p_date is null or p_balance is null or p_balance < 0 or p_balance <> round(p_balance, 2)
     or p_date < date '2000-01-01' then
    raise exception 'parâmetros inválidos' using errcode = '22023';
  end if;
  if p_date >= v_d.reference_date then
    raise exception 'o início do cartão só pode recuar (hoje: %)', v_d.reference_date using errcode = '22023';
  end if;
  if exists (select 1 from public.debt_events e where e.debt_id = v_d.id and e.voided_at is null and e.date <= p_date)
     or exists (select 1 from public.debt_installments i where i.debt_id = v_d.id and i.due_date <= p_date) then
    raise exception 'há movimento do cartão até %', p_date using errcode = '23514';
  end if;
  perform set_config('app.debt_anchor_edit', 'on', true);
  update public.debts set reference_date = p_date, reference_balance = p_balance where id = v_d.id;
  perform set_config('app.debt_anchor_edit', 'off', true);
  perform private.debt_chk(v_d.id);
end $$;

-- 3. compra escolhendo a fatura ----------------------------------------------
create function public.card_purchase_at(p_debt uuid, p_date date, p_total numeric, p_count integer,
                                        p_category uuid, p_description text, p_invoice_offset integer default 0,
                                        p_idem uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_d public.debts%rowtype; v_plan uuid; v_face numeric; v_first numeric; v_closing date; k integer;
  v_refund date;
begin
  v_d := private.debt_lock(p_debt);
  if v_d.kind <> 'card' then
    raise exception 'compra parcelada só existe em cartão' using errcode = '23514';
  end if;
  if v_d.closing_day is null then
    raise exception 'defina o dia de fechamento e de vencimento do cartão antes de lançar compras'
      using errcode = '55000';
  end if;
  if p_idem is not null and exists (select 1 from public.debt_installments i
       where i.household_id = v_d.household_id and i.debt_id = v_d.id and i.plan = p_idem::text) then
    return p_idem;
  end if;
  if p_date is null or p_count is null or p_count not between 1 and 72
     or p_total is null or p_total <= 0 or p_total >= 1e12
     or p_invoice_offset is null or p_invoice_offset not between -3 and 3 then
    raise exception 'parâmetros inválidos' using errcode = '22023';
  end if;
  if p_total <> round(p_total, 2) then
    raise exception 'valor com mais de 2 casas decimais: %', p_total using errcode = '22003';
  end if;
  v_face  := trunc(p_total / p_count, 2);
  v_first := p_total - v_face * (p_count - 1);
  if v_face <= 0 then
    raise exception 'valor pequeno demais para % parcelas', p_count using errcode = '22023';
  end if;

  v_closing := private.card_first_closing(p_date, v_d.closing_day);
  v_closing := private.card_day_in_month((date_trunc('month', v_closing) + make_interval(months => p_invoice_offset))::date,
                                         v_d.closing_day);
  -- o que fecha até a data de referência já está no saldo de referência
  if v_closing <= v_d.reference_date then
    raise exception 'esta fatura fecha em %, até o início do cartão (%): recue o início do cartão', v_closing, v_d.reference_date
      using errcode = '23514';
  end if;
  select max(e.date) into v_refund from public.debt_events e
   where e.debt_id = v_d.id and e.kind = 'refund_cash' and e.voided_at is null;
  if v_refund is not null and v_closing <= v_refund then
    raise exception 'esta compra fecharia em % , antes de uma devolução já lançada em %: exclua a devolução ou escolha outra fatura',
      v_closing, v_refund using errcode = '23514';
  end if;

  v_plan := coalesce(p_idem, gen_random_uuid());
  for k in 0 .. p_count - 1 loop
    insert into public.debt_installments (household_id, debt_id, plan, seq, due_date, face, category_id,
                                          description, purchase_date, closing_day, due_day)
    values (v_d.household_id, v_d.id, v_plan::text, k + 1,
            private.card_day_in_month((date_trunc('month', v_closing) + make_interval(months => k))::date, v_d.closing_day),
            case when k = 0 then v_first else v_face end, p_category,
            nullif(btrim(p_description), ''), p_date, v_d.closing_day, v_d.due_day);
  end loop;
  perform private.debt_chk(v_d.id);
  return v_plan;
end $$;

revoke execute on function public.card_set_start(uuid, date, numeric),
  public.card_purchase_at(uuid, date, numeric, integer, uuid, text, integer, uuid) from public, anon;
grant execute on function public.card_set_start(uuid, date, numeric),
  public.card_purchase_at(uuid, date, numeric, integer, uuid, text, integer, uuid) to authenticated;
