-- Tudo Azul — migration 041: consignado com juros e tarifa embutidos na parcela.
-- Defeito da 038: no consignado a baixa exigia juros = 0 e principal = parcela inteira. Uma parcela
-- de 560 (500 de principal + 60 de juros) abatia 560 do saldo e o saldo zerava antes do fim do contrato.
-- Agora a baixa aceita principal + juros + tarifa = parcela; só o principal abate o saldo devedor.
-- Juros e tarifa ficam na parcela (colunas novas), sem evento e sem efeito em caixa.

alter table public.debt_payment_schedule
  add column payroll_interest numeric check (payroll_interest is null or (payroll_interest >= 0 and payroll_interest = round(payroll_interest,2))),
  add column payroll_fee numeric check (payroll_fee is null or (payroll_fee >= 0 and payroll_fee = round(payroll_fee,2)));

create or replace function public.debt_schedule_record_payment(
  p_schedule_id uuid,
  p_date date,
  p_account uuid,
  p_principal numeric,
  p_interest numeric default 0,
  p_fee numeric default 0,
  p_category uuid default null,
  p_extra boolean default false
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_s public.debt_payment_schedule%rowtype;
  v_d public.debts%rowtype;
  v_op uuid;
begin
  select * into v_s from public.debt_payment_schedule where id = p_schedule_id;
  if not found then raise exception 'parcela não encontrada' using errcode = '42501'; end if;
  -- Ordem global de locks: dívida primeiro, parcela depois (mesma ordem de debt_contract_set).
  v_d := private.debt_lock(v_s.debt_id);
  select * into v_s from public.debt_payment_schedule
  where id = p_schedule_id and household_id = v_d.household_id for update;
  if not found then raise exception 'parcela não encontrada' using errcode = '42501'; end if;
  if v_s.status <> 'planned' then
    raise exception 'esta parcela já foi baixada ou cancelada' using errcode = '55000';
  end if;
  if v_s.installment_number <> (
    select min(s.installment_number) from public.debt_payment_schedule s
    where s.debt_id=v_d.id and s.status='planned'
  ) then
    raise exception 'baixe as parcelas na ordem do contrato' using errcode = '23514';
  end if;
  if p_date is null or p_principal is null or p_interest is null or p_fee is null
     or p_principal < 0 or p_interest < 0 or p_fee < 0
     or p_principal <> round(p_principal,2) or p_interest <> round(p_interest,2) or p_fee <> round(p_fee,2)
     or p_principal + p_interest + p_fee <= 0 then
    raise exception 'valores do pagamento inválidos' using errcode = '22023';
  end if;

  if round(p_principal + p_interest + p_fee, 2) <> v_s.amount then
    raise exception 'o total pago deve corresponder ao valor previsto da parcela (%)', v_s.amount using errcode = '22023';
  end if;

  if v_d.payment_method = 'payroll' then
    -- Consignado: o desconto em folha não sai de conta (o salário já está líquido). A parcela pode
    -- trazer juros e tarifa embutidos; só o principal abate o saldo devedor. Juros e tarifa ficam
    -- registrados na parcela, sem evento de dívida e sem mexer em caixa.
    if p_account is not null or p_principal <= 0 or coalesce(p_extra,false) then
      raise exception 'no consignado, não há conta de saída nem antecipação; informe o principal, os juros e a tarifa da parcela' using errcode = '22023';
    end if;
    v_op := gen_random_uuid();
    insert into public.debt_events
      (household_id,debt_id,date,kind,amount,op_id,note,schedule_id)
    values
      (v_d.household_id,v_d.id,p_date,'payroll_payment',p_principal,v_op,
       'parcela consignada confirmada; sem nova saída de conta',v_s.id);
    update public.debt_payment_schedule
      set payroll_interest = p_interest, payroll_fee = p_fee
    where id = v_s.id;
  else
    if p_account is null then
      raise exception 'selecione a conta de saída do pagamento' using errcode = '22023';
    end if;
    if v_d.payment_method = 'account_debit' and p_account <> v_d.payment_account_id then
      raise exception 'a conta deve ser a mesma definida no débito automático' using errcode = '22023';
    end if;
    if p_date is null or p_account is null or p_principal < 0 or p_interest < 0 or p_fee < 0
       or p_principal <> round(p_principal,2) or p_interest <> round(p_interest,2)
       or p_fee <> round(p_fee,2) or p_principal + p_interest + p_fee <= 0 then
      raise exception 'valores do pagamento inválidos' using errcode = '22023';
    end if;
    if (p_interest > 0 or p_fee > 0) and p_category is null then
      raise exception 'juros e tarifas exigem uma categoria de despesa' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.accounts a
      where a.household_id=v_d.household_id and a.id=p_account and a.active and a.opening_date<=p_date
    ) then
      raise exception 'conta de pagamento inexistente, arquivada ou ainda não aberta' using errcode = '23514';
    end if;
    if p_category is not null and not exists (
      select 1 from public.categories c
      where c.household_id=v_d.household_id and c.id=p_category and c.type='expense' and c.active
    ) then
      raise exception 'categoria de despesa inválida ou inativa' using errcode = '23514';
    end if;
    v_op := gen_random_uuid();
    if p_principal > 0 then
      insert into public.debt_events
        (household_id,debt_id,date,kind,amount,account_id,op_id,note,schedule_id)
      values (v_d.household_id,v_d.id,p_date,
        case when coalesce(p_extra,false) then 'extra_principal' else 'payment' end,
        p_principal,p_account,v_op,'pagamento da parcela agendada',v_s.id);
    end if;
    if p_interest > 0 then
      insert into public.debt_events
        (household_id,debt_id,date,kind,amount,account_id,category_id,op_id,note,schedule_id)
      values (v_d.household_id,v_d.id,p_date,'interest',p_interest,p_account,p_category,v_op,
        'juros da parcela agendada',v_s.id);
    end if;
    if p_fee > 0 then
      insert into public.debt_events
        (household_id,debt_id,date,kind,amount,account_id,category_id,op_id,note,schedule_id)
      values (v_d.household_id,v_d.id,p_date,'fee',p_fee,p_account,p_category,v_op,
        'tarifa da parcela agendada',v_s.id);
    end if;
  end if;

  update public.debt_payment_schedule
    set status = 'paid', payment_op_id = v_op, payment_date = p_date, updated_at = now()
  where id = v_s.id and status = 'planned';

  update public.debts d set
    remaining_installments = greatest(d.remaining_installments - 1,0),
    first_due_date = coalesce((
      select min(s.due_date) from public.debt_payment_schedule s
      where s.debt_id=d.id and s.status='planned'
    ),d.first_due_date)
  where d.id = v_d.id and d.household_id = v_d.household_id;

  perform private.debt_chk(v_d.id);
  return v_op;
end
$$;

create or replace function private.debt_schedule_restore_void()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_due date;
begin
  if tg_op <> 'UPDATE' or old.voided_at is not null or new.voided_at is null
     or new.schedule_id is null or new.op_id is null then
    return new;
  end if;

  update public.debt_payment_schedule s
     set status='planned',payment_op_id=null,payment_date=null,payroll_interest=null,payroll_fee=null,updated_at=now()
   where s.id=new.schedule_id and s.household_id=new.household_id and s.debt_id=new.debt_id
     and s.status='paid' and s.payment_op_id=new.op_id
  returning s.due_date into v_due;

  if found then
    update public.debts d
       set remaining_installments=least(d.original_installments,d.remaining_installments+1),
           first_due_date=least(d.first_due_date,v_due)
     where d.id=new.debt_id and d.household_id=new.household_id;
  end if;
  return new;
end
$$;

-- Histórico da carteira: ativo arquivado continua contando nos meses em que tinha posição.
-- Defeito da 039: investment_history chamava investment_portfolio, que ignora ativos inativos; ao
-- arquivar um ativo (só possível com posição zerada) o gráfico perdia o passado dele e subestimava
-- os meses anteriores. Agora o razão é calculado aqui, sem filtrar por "ativo", uma vez só até p_to.
create or replace function public.investment_history(p_household uuid, p_from date, p_to date)
returns table(month date, currency_code text, market_value numeric, cost_basis numeric)
language sql stable security invoker set search_path = '' as $$
  with recursive meses as (
    select generate_series(
      date_trunc('month', p_from)::date,
      date_trunc('month', p_to)::date,
      interval '1 month'
    )::date as mes
  ), moedas as (
    select distinct a.currency_code
      from public.investment_assets a
     where a.household_id = p_household
  ), operations as (
    select o.asset_id, o.kind, o.quantity, o.unit_price, o.fees, o.operation_date,
      row_number() over (partition by o.asset_id order by o.operation_date, o.created_at, o.id) as rn
    from public.investment_operations o
    where o.household_id = p_household and o.operation_date <= p_to
  ), ledger as (
    select o.asset_id, o.rn, o.operation_date,
      o.quantity as quantity,
      o.quantity*o.unit_price + o.fees as cost_basis
    from operations o where o.rn = 1 and o.kind = 'buy'
    union all
    select o.asset_id, o.rn, o.operation_date,
      case when o.kind = 'buy' then l.quantity + o.quantity else l.quantity - o.quantity end,
      case when o.kind = 'buy' then l.cost_basis + o.quantity*o.unit_price + o.fees
           else l.cost_basis - (l.cost_basis/nullif(l.quantity,0))*o.quantity end
    from ledger l
    join operations o on o.asset_id = l.asset_id and o.rn = l.rn + 1
  ), por_mes as (
    select m.mes, a.currency_code, pos.quantity, pos.cost_basis,
           coalesce(v.unit_price, case when pos.quantity > 0 then pos.cost_basis/pos.quantity else 0 end) as preco
      from meses m
      cross join public.investment_assets a
      cross join lateral (select least((m.mes + interval '1 month - 1 day')::date, p_to) as fim) f
      cross join lateral (
        select l.quantity, l.cost_basis from ledger l
         where l.asset_id = a.id and l.operation_date <= f.fim
         order by l.rn desc limit 1
      ) pos
      left join lateral (
        select x.unit_price from public.investment_valuations x
         where x.asset_id = a.id and x.household_id = p_household and x.valuation_date <= f.fim
         order by x.valuation_date desc, x.created_at desc limit 1
      ) v on true
     where a.household_id = p_household and pos.quantity > 0
  )
  select m.mes, c.currency_code,
         coalesce(round(sum(p.quantity*p.preco) filter (where p.mes is not null), 2), 0)::numeric,
         coalesce(round(sum(p.cost_basis) filter (where p.mes is not null), 2), 0)::numeric
    from meses m
    cross join moedas c
    left join por_mes p on p.mes = m.mes and p.currency_code = c.currency_code
   where p_household is not null and p_from is not null and p_to is not null
     and p_from <= p_to and private.is_member(p_household)
   group by m.mes, c.currency_code
   order by m.mes, c.currency_code
$$;
