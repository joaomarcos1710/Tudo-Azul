-- Tudo Azul — migration 031: contrato e agenda de parcelas de empréstimos/financiamentos
-- A agenda é previsão; somente a RPC de baixa cria eventos no motor oficial debts/debt_events.

alter table public.debts
  add column creditor text check (creditor is null or char_length(btrim(creditor)) between 1 and 100),
  add column contract_number text check (contract_number is null or char_length(btrim(contract_number)) between 1 and 80),
  add column original_installments integer check (original_installments is null or original_installments between 1 and 1200),
  add column remaining_installments integer check (remaining_installments is null or remaining_installments between 0 and 1200),
  add column installment_amount numeric check (installment_amount is null or (installment_amount > 0 and installment_amount = round(installment_amount, 2) and installment_amount < 1e12)),
  add column payment_day smallint check (payment_day is null or payment_day between 1 and 31),
  add column payment_method text check (payment_method is null or payment_method in ('account_debit','boleto','payroll','manual')),
  add column payment_account_id uuid,
  add column first_due_date date;

alter table public.debts
  add constraint debts_payment_account_fk
  foreign key (household_id, payment_account_id)
  references public.accounts(household_id, id) deferrable initially immediate,
  add constraint debts_contract_shape check (
    (original_installments is null and remaining_installments is null and installment_amount is null
      and payment_day is null and payment_method is null and payment_account_id is null and first_due_date is null)
    or
    (original_installments is not null and remaining_installments is not null
      and remaining_installments <= original_installments and installment_amount is not null
      and payment_day is not null and payment_method is not null and first_due_date is not null
      and ((payment_method = 'account_debit') = (payment_account_id is not null)))
  ),
  add constraint debts_contract_loan_only check (
    original_installments is null or kind in ('loan','financing')
  );

create table public.debt_payment_schedule (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  debt_id uuid not null,
  installment_number integer not null check (installment_number between 1 and 1200),
  due_date date not null,
  amount numeric not null check (amount > 0 and amount = round(amount, 2) and amount < 1e12),
  status text not null default 'planned' check (status in ('planned','paid','cancelled')),
  payment_op_id uuid unique,
  payment_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, id, debt_id),
  unique (household_id, debt_id, installment_number),
  foreign key (household_id, debt_id) references public.debts(household_id, id) on delete cascade,
  check ((status = 'paid') = (payment_op_id is not null)),
  check ((status = 'paid') = (payment_date is not null))
);

create index debt_payment_schedule_due_idx
  on public.debt_payment_schedule(household_id, due_date, status);

alter table public.debt_payment_schedule enable row level security;
create policy debt_payment_schedule_select on public.debt_payment_schedule
  for select to authenticated using ((select private.is_member(household_id)));
revoke all on public.debt_payment_schedule from public, anon, authenticated;
grant select on public.debt_payment_schedule to authenticated;

alter table public.debt_events add column schedule_id uuid;
alter table public.debt_events
  add constraint debt_events_schedule_fk
  foreign key (household_id, schedule_id, debt_id)
  references public.debt_payment_schedule(household_id, id, debt_id)
  deferrable initially immediate,
  add constraint debt_events_schedule_shape check (
    (schedule_id is null or kind in ('payment','extra_principal','interest','fee','payroll_payment'))
    and (kind <> 'payroll_payment' or (schedule_id is not null and account_id is null))
  );

alter table public.debt_events drop constraint debt_events_kind_check;
alter table public.debt_events add constraint debt_events_kind_check
  check (kind = any (array['disbursement','charge','payment','extra_principal','interest','fee','credit','refund_cash','cancel','payroll_payment']));

create or replace function private.debt_effect(p_kind text, p_amount numeric)
returns numeric language sql immutable set search_path = '' as $$
  select case when p_kind in ('disbursement','charge','refund_cash') then p_amount
              when p_kind in ('payment','extra_principal','credit','payroll_payment') then -p_amount
              else 0 end
$$;

create or replace function private.debt_balance(p_debt uuid, p_as_of date)
returns numeric language sql stable security definer set search_path = '' as $$
  select d.reference_balance + coalesce((
    select sum(private.debt_effect(e.kind, e.amount))
    from public.debt_events e
    where e.debt_id = d.id and e.voided_at is null and e.date <= p_as_of
  ), 0)
  from public.debts d where d.id = p_debt
$$;

create or replace function public.debt_balances(p_household uuid, p_as_of date)
returns table(debt_id uuid, name text, kind text, balance numeric, debt numeric, credit_receivable numeric, planned_remaining numeric)
language sql stable security definer set search_path = '' as $
  select d.id, d.name, d.kind, b.bal, greatest(b.bal, 0), greatest(-b.bal, 0), coalesce(p.rem, 0)
  from public.debts d
  cross join lateral (select private.debt_balance(d.id, p_as_of) as bal) b
  left join lateral (
    select sum(i.face - coalesce((
      select sum(e.amount) from public.debt_events e
      where e.household_id = i.household_id and e.installment_id = i.id
        and e.kind in ('charge','cancel') and e.voided_at is null and e.date <= p_as_of
    ), 0)) as rem
    from public.debt_installments i
    where i.household_id = d.household_id and i.debt_id = d.id
  ) p on true
  where d.household_id = p_household and d.reference_date <= p_as_of
    and (select auth.uid()) is not null
    and (select private.is_member(p_household))
  order by d.name
$$;


-- A agenda participa da projeção de caixa sem virar lançamento efetivo:
-- débito em conta reduz a conta correspondente; boleto/manual sem conta reduzem apenas o total;
-- consignado não reduz caixa porque o salário pode já estar registrado líquido.
create or replace function public.account_balances_projected(
  p_household uuid, p_as_of date, p_include_planned boolean default true
)
returns table(account_id uuid,name text,type text,active boolean,realized numeric,planned numeric,invoices numeric,balance numeric)
language sql stable set search_path = '' as $$
  select b.account_id,b.name,b.type,b.active,b.balance,
    case when p_include_planned then coalesce(pl.delta,0) - coalesce(ds.rem,0) else 0 end,
    case when p_include_planned then coalesce(inv.rem,0) else 0 end,
    b.balance
      + case when p_include_planned then coalesce(pl.delta,0) - coalesce(ds.rem,0) else 0 end
      - case when p_include_planned then coalesce(inv.rem,0) else 0 end
  from public.account_balances(p_household,p_as_of) b
  join public.accounts a on a.id=b.account_id
  left join lateral (
    select sum(case
      when t.type='income' and t.account_id=a.id then t.amount
      when t.type='expense' and t.account_id=a.id then -t.amount
      when t.type='transfer' and t.account_id=a.id then -t.amount
      when t.type='transfer' and t.destination_account_id=a.id then t.amount
    end) as delta
    from public.transactions t
    where t.household_id=a.household_id and t.deleted_at is null and t.status='planned'
      and t.date>=a.opening_date and t.date<=p_as_of
      and (t.account_id=a.id or t.destination_account_id=a.id)
  ) pl on true
  left join lateral (
    select sum(s.amount) as rem
    from public.debt_payment_schedule s
    join public.debts d on d.household_id=s.household_id and d.id=s.debt_id
    where s.household_id=a.household_id and s.status='planned' and s.due_date<=p_as_of
      and d.payment_method='account_debit' and d.payment_account_id=a.id
  ) ds on true
  left join lateral (
    select sum(greatest(m.total-m.paid,0)) as rem
    from public.debts d
    cross join lateral public.card_months(d.id) m
    where d.household_id=a.household_id and d.kind='card' and d.pay_account_id=a.id
      and m.due_date<=p_as_of
  ) inv on true
  where (select private.is_member(p_household))
  order by b.name
$$;

create or replace function public.balance_totals_projected(
  p_household uuid, p_as_of date, p_include_planned boolean default true
)
returns table(realized numeric,planned numeric,invoices numeric,unassigned_invoices numeric,total numeric)
language sql stable set search_path = '' as $$
  with c as (
    select coalesce(sum(b.realized),0) as realized,coalesce(sum(b.planned),0) as planned
    from public.account_balances_projected(p_household,p_as_of,p_include_planned) b
  ), f as (
    select coalesce(sum(greatest(m.total-m.paid,0)),0) as todas,
      coalesce(sum(greatest(m.total-m.paid,0)) filter (where d.pay_account_id is null),0) as sem_conta
    from public.debts d
    cross join lateral public.card_months(d.id) m
    where d.household_id=p_household and d.kind='card' and m.due_date<=p_as_of
  ), s as (
    select coalesce(sum(sch.amount),0) as sem_conta
    from public.debt_payment_schedule sch
    join public.debts d on d.household_id=sch.household_id and d.id=sch.debt_id
    where sch.household_id=p_household and sch.status='planned' and sch.due_date<=p_as_of
      and d.payment_method in ('boleto','manual')
  )
  select c.realized,c.planned,
    case when p_include_planned then f.todas+s.sem_conta else 0 end,
    case when p_include_planned then f.sem_conta+s.sem_conta else 0 end,
    c.realized+c.planned-case when p_include_planned then f.todas+s.sem_conta else 0 end
  from c cross join f cross join s
  where (select private.is_member(p_household))
$$;

create or replace function private.debt_events_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.amount is not null then
      if new.amount <> round(new.amount,2) then
        raise exception 'valor com mais de 2 casas decimais: %',new.amount using errcode = '22003';
      end if;
      new.amount := round(new.amount,2);
    end if;
    if new.account_id is not null and exists (
      select 1 from public.accounts a
      where a.household_id=new.household_id and a.id=new.account_id and not a.active
    ) then
      raise exception 'conta desativada' using errcode = '23514';
    end if;
    return new;
  end if;
  if old.voided_at is not null then
    raise exception 'evento já anulado não pode ser alterado' using errcode = '55000';
  end if;
  if (new.id,new.household_id,new.debt_id,new.date,new.kind,new.amount,new.account_id,new.installment_id,
      new.invoice_id,new.category_id,new.op_id,new.note,new.created_by,new.created_at,new.schedule_id)
     is distinct from
     (old.id,old.household_id,old.debt_id,old.date,old.kind,old.amount,old.account_id,old.installment_id,
      old.invoice_id,old.category_id,old.op_id,old.note,old.created_by,old.created_at,old.schedule_id) then
    raise exception 'evento é imutável: use a anulação' using errcode = '42501';
  end if;
  return new;
end
$$;

create or replace function private.debt_chk(p_debt uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_d public.debts%rowtype;
  r record;
begin
  select * into v_d from public.debts where id = p_debt;
  if not found then return; end if;

  if exists (
    select 1 from public.debt_events e
    where e.debt_id = p_debt and e.voided_at is null and e.date <= v_d.reference_date
  ) then
    raise exception 'evento anterior ou igual à data de referência da dívida (%)', v_d.reference_date using errcode = '23514';
  end if;
  if exists (
    select 1 from public.debt_events e
    join public.accounts a on a.household_id = e.household_id and a.id = e.account_id
    where e.debt_id = p_debt and e.voided_at is null and e.date < a.opening_date
  ) then
    raise exception 'evento anterior à abertura da conta' using errcode = '23514';
  end if;

  for r in
    select distinct e.date, e.kind from public.debt_events e
    where e.debt_id = p_debt and e.voided_at is null
      and e.kind in ('payment','extra_principal','payroll_payment','refund_cash')
  loop
    if r.kind <> 'refund_cash' and not (r.kind = 'payment' and v_d.kind = 'card')
       and private.debt_balance(p_debt, r.date) < 0 then
      raise exception 'pagamento acima do saldo devedor (use a antecipação para parcelas futuras)' using errcode = '23514';
    end if;
    if r.kind = 'refund_cash' and private.debt_balance(p_debt, r.date) > 0 then
      raise exception 'devolução acima do crédito a receber' using errcode = '23514';
    end if;
  end loop;

  if exists (
    select 1 from public.debt_installments i
    where i.debt_id = p_debt
      and (select coalesce(sum(e.amount),0) from public.debt_events e
           where e.installment_id=i.id and e.kind in ('charge','cancel') and e.voided_at is null) > i.face
  ) then
    raise exception 'cobrança ou cancelamento acima do valor da parcela' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.debt_installments i
    where i.debt_id = p_debt
      and (select coalesce(sum(e.amount),0) from public.debt_events e
           where e.installment_id=i.id and e.kind='credit' and e.voided_at is null)
        > (select coalesce(sum(e.amount),0) from public.debt_events e
           where e.installment_id=i.id and e.kind='charge' and e.voided_at is null)
  ) then
    raise exception 'estorno acima do valor cobrado' using errcode = '23514';
  end if;
end
$$;

revoke execute on function private.debt_effect(text,numeric), private.debt_balance(uuid,date), private.debt_chk(uuid)
  from public, anon, authenticated;
revoke execute on function public.debt_balances(uuid,date) from public, anon;
grant execute on function public.debt_balances(uuid,date) to authenticated;

create function public.debt_contract_set(
  p_debt uuid,
  p_creditor text,
  p_contract_number text,
  p_original_installments integer,
  p_remaining_installments integer,
  p_installment_amount numeric,
  p_payment_day integer,
  p_payment_method text,
  p_payment_account uuid,
  p_first_due_date date
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_d public.debts%rowtype;
  v_paid_max integer;
  v_first_number integer;
begin
  v_d := private.debt_lock(p_debt);
  if v_d.kind not in ('loan','financing') then
    raise exception 'contrato disponível apenas para empréstimos e financiamentos' using errcode = '22023';
  end if;
  if p_creditor is not null and char_length(btrim(p_creditor)) not between 1 and 100
     or p_contract_number is not null and char_length(btrim(p_contract_number)) > 80
     or p_original_installments is null or p_original_installments not between 1 and 1200
     or p_remaining_installments is null or p_remaining_installments not between 0 and p_original_installments
     or p_installment_amount is null or p_installment_amount <= 0
     or p_installment_amount <> round(p_installment_amount,2) or p_installment_amount >= 1e12
     or p_payment_day is null or p_payment_day not between 1 and 31
     or p_payment_method is null or p_payment_method not in ('account_debit','boleto','payroll','manual')
     or p_first_due_date is null then
    raise exception 'dados do contrato ou cronograma inválidos' using errcode = '22023';
  end if;
  if (p_payment_method = 'account_debit') <> (p_payment_account is not null) then
    raise exception 'selecione uma conta somente para débito automático' using errcode = '22023';
  end if;
  if p_payment_account is not null and not exists (
    select 1 from public.accounts a
    where a.household_id = v_d.household_id and a.id = p_payment_account
      and a.active and a.opening_date <= p_first_due_date
  ) then
    raise exception 'conta de débito inexistente, inativa ou ainda não aberta' using errcode = '23514';
  end if;

  select coalesce(max(s.installment_number),0) into v_paid_max
  from public.debt_payment_schedule s
  where s.debt_id = v_d.id and s.status = 'paid';
  v_first_number := p_original_installments - p_remaining_installments + 1;
  if p_original_installments < v_paid_max or (p_remaining_installments > 0 and v_first_number <= v_paid_max) then
    raise exception 'prazo restante incompatível com as parcelas já pagas' using errcode = '23514';
  end if;

  update public.debts set
    creditor = nullif(btrim(p_creditor),''),
    contract_number = nullif(btrim(p_contract_number),''),
    original_installments = p_original_installments,
    remaining_installments = p_remaining_installments,
    installment_amount = p_installment_amount,
    payment_day = p_payment_day,
    payment_method = p_payment_method,
    payment_account_id = p_payment_account,
    first_due_date = p_first_due_date
  where id = v_d.id and household_id = v_d.household_id;

  delete from public.debt_payment_schedule
  where debt_id = v_d.id and status = 'planned';

  if p_remaining_installments > 0 then
    insert into public.debt_payment_schedule
      (household_id,debt_id,installment_number,due_date,amount)
    select v_d.household_id,v_d.id,v_first_number + g.n,
      case when g.n = 0 then p_first_due_date else
        make_date(
          extract(year from (date_trunc('month',p_first_due_date) + make_interval(months => g.n))::date)::integer,
          extract(month from (date_trunc('month',p_first_due_date) + make_interval(months => g.n))::date)::integer,
          least(p_payment_day, extract(day from (
            date_trunc('month',p_first_due_date) + make_interval(months => g.n) + interval '1 month - 1 day'
          ))::integer)
        )
      end,
      p_installment_amount
    from generate_series(0,p_remaining_installments - 1) as g(n);
  end if;
end
$$;

create function public.debt_schedule_record_payment(
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
  select * into v_s from public.debt_payment_schedule where id = p_schedule_id for update;
  if not found then raise exception 'parcela não encontrada' using errcode = '42501'; end if;
  v_d := private.debt_lock(v_s.debt_id);
  if v_s.household_id <> v_d.household_id then
    raise exception 'parcela não encontrada' using errcode = '42501';
  end if;
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

  if v_d.payment_method = 'payroll' then
    if p_account is not null or p_interest <> 0 or p_fee <> 0 or p_principal <= 0 or coalesce(p_extra,false) then
      raise exception 'no consignado, informe apenas o valor amortizado no saldo devedor' using errcode = '22023';
    end if;
    v_op := gen_random_uuid();
    insert into public.debt_events
      (household_id,debt_id,date,kind,amount,op_id,note,schedule_id)
    values
      (v_d.household_id,v_d.id,p_date,'payroll_payment',p_principal,v_op,
       'parcela consignada confirmada; sem nova saída de conta',v_s.id);
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

revoke execute on function public.debt_contract_set(uuid,text,text,integer,integer,numeric,integer,text,uuid,date),
  public.debt_schedule_record_payment(uuid,date,uuid,numeric,numeric,numeric,uuid,boolean)
  from public, anon;
grant execute on function public.debt_contract_set(uuid,text,text,integer,integer,numeric,integer,text,uuid,date),
  public.debt_schedule_record_payment(uuid,date,uuid,numeric,numeric,numeric,uuid,boolean)
  to authenticated;
