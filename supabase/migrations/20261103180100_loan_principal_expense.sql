-- Tudo Azul — migration 046: parcela de empréstimo/financiamento é despesa do mês em que é paga.
-- Decisão do dono (03/11/2026): "Despesa do mês! Criar categoria na dívida que vai vir da aba Categorias."
-- Antes: relatórios contavam de dívida só compra no cartão, juros e tarifa; o PAGAMENTO ficava de fora porque, no
-- cartão, a compra já contou. Em empréstimo/financiamento nada contava o principal: na parcela do imóvel só os juros
-- apareciam. Agora:
--   * principal pago (eventos payment e extra_principal com conta) de dívida loan/financing entra como despesa, na
--     categoria escolhida na dívida (debts.principal_category_id) ou em "Sem categoria" enquanto não houver escolha;
--   * juros e tarifa continuam nos próprios eventos e categorias (somam com o principal = parcela inteira);
--   * consignado (payroll_payment) fica de fora: o salário já entra líquido, contar de novo tiraria duas vezes;
--   * cartão não muda; dinheiro recebido do empréstimo (disbursement) continua sem contar como receita;
--   * parcela planejada do contrato (não baixada, exceto consignado) entra em "despesas planejadas" e no fluxo com
--     planejados, como recorrente e parcela de cartão.
-- Uma fonte só (private.loan_principal_items / private.loan_schedule_planned) para period_summary, cash_flow_report,
-- budget_usage e expense_items (que alimenta despesas por categoria, por dia e a regra 50-30-20).
-- Números de meses passados mudam: a despesa sobe pelo principal já pago.

alter table public.debts
  add column principal_category_id uuid references public.categories(id) on delete set null;

create function public.debt_set_principal_category(p_debt uuid, p_category uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.debts%rowtype;
begin
  v := private.debt_lock(p_debt);
  if v.kind not in ('loan', 'financing') then
    raise exception 'categoria do principal só para empréstimo e financiamento' using errcode = '22023';
  end if;
  if p_category is not null and not exists (
    select 1 from public.categories c
     where c.household_id = v.household_id and c.id = p_category and c.type = 'expense' and c.active
  ) then
    raise exception 'categoria de despesa inválida ou inativa' using errcode = '23514';
  end if;
  update public.debts set principal_category_id = p_category where id = v.id;
end $$;

create function private.loan_principal_items(p_household uuid, p_from date, p_to date)
returns table (day date, category_id uuid, amount numeric, account_id uuid, created_by uuid)
language sql stable security invoker set search_path = '' as $$
  select e.date, coalesce(d.principal_category_id, u.id), e.amount, e.account_id, e.created_by
    from public.debt_events e
    join public.debts d on d.household_id = e.household_id and d.id = e.debt_id and d.kind in ('loan', 'financing')
    left join public.categories u
      on u.household_id = e.household_id and u.type = 'expense' and u.system_key = 'uncategorized'
   where e.household_id = p_household and e.voided_at is null
     and e.kind in ('payment', 'extra_principal') and e.account_id is not null
     and e.date between p_from and p_to
$$;

create function private.loan_schedule_planned(p_household uuid, p_from date, p_to date)
returns table (day date, amount numeric, account_id uuid)
language sql stable security invoker set search_path = '' as $$
  select s.due_date, s.amount, d.payment_account_id
    from public.debt_payment_schedule s
    join public.debts d on d.household_id = s.household_id and d.id = s.debt_id
   where s.household_id = p_household and s.status = 'planned' and s.due_date between p_from and p_to
     and d.kind in ('loan', 'financing') and d.active and d.payment_method is distinct from 'payroll'
$$;

revoke execute on function public.debt_set_principal_category(uuid, uuid),
  private.loan_principal_items(uuid, date, date), private.loan_schedule_planned(uuid, date, date) from public, anon;
grant execute on function public.debt_set_principal_category(uuid, uuid),
  private.loan_principal_items(uuid, date, date), private.loan_schedule_planned(uuid, date, date) to authenticated;

create or replace function private.expense_items(p_household uuid, p_from date, p_to date)
returns table (day date, category_id uuid, amount numeric)
language sql stable security invoker set search_path = '' as $$
  select t.date, t.category_id, t.amount
    from public.transactions t
   where t.household_id = p_household and t.type = 'expense' and t.status = 'paid'
     and t.deleted_at is null and t.date between p_from and p_to
  union all
  select e.date, coalesce(e.category_id, i.category_id),
         case when e.kind = 'credit' then -e.amount else e.amount end
    from public.debt_events e
    left join public.debt_installments i on i.household_id = e.household_id and i.id = e.installment_id
   where e.household_id = p_household and e.voided_at is null
     and e.kind in ('charge', 'credit', 'interest', 'fee') and e.date between p_from and p_to
  union all
  -- principal pago de empréstimo/financiamento (migration 046): despesa do mês, na categoria da dívida
  select l.day, l.category_id, l.amount from private.loan_principal_items(p_household, p_from, p_to) l
$$;

create or replace function public.period_summary(p_household uuid, p_from date, p_to date)
returns table (income_paid numeric, expense_paid numeric, result numeric,
               income_planned numeric, expense_planned numeric)
language sql stable security invoker set search_path = '' as $$
  select s.income_paid, s.expense_paid, s.income_paid - s.expense_paid,
         s.income_planned, s.expense_planned
    from (
      select coalesce(sum(t.amount) filter (where t.type = 'income'  and t.status = 'paid'), 0)    as income_paid,
             coalesce(sum(t.amount) filter (where t.type = 'expense' and t.status = 'paid'), 0)
               + coalesce((select sum(case when e.kind = 'credit' then -e.amount else e.amount end)
                             from public.debt_events e
                            where e.household_id = p_household and e.voided_at is null
                              and e.kind in ('charge', 'credit', 'interest', 'fee')
                              and e.date between p_from and p_to), 0)
               + coalesce((select sum(l.amount) from private.loan_principal_items(p_household, p_from, p_to) l), 0) as expense_paid,
             coalesce(sum(t.amount) filter (where t.type = 'income'  and t.status = 'planned'), 0) as income_planned,
             coalesce(sum(t.amount) filter (where t.type = 'expense' and t.status = 'planned'), 0)
               + coalesce((select sum(i.face - coalesce((select sum(e.amount) from public.debt_events e
                                    where e.installment_id = i.id and e.kind in ('charge', 'cancel')
                                      and e.voided_at is null), 0))
                             from public.debt_installments i
                            where i.household_id = p_household and i.due_date between p_from and p_to), 0)
               + coalesce((select sum(s.amount) from private.loan_schedule_planned(p_household, p_from, p_to) s), 0) as expense_planned
        from (select 1) base
        left join public.transactions t
          on t.household_id = p_household
         and t.deleted_at is null
         and t.type in ('income', 'expense')
         and t.date between p_from and p_to
    ) s
   where (select private.is_member(p_household))
$$;

create or replace function public.cash_flow_report(
  p_household uuid, p_from date, p_to date, p_step text default 'day',
  p_accounts uuid[] default null, p_member uuid default null, p_include_planned boolean default false)
returns table (period_start date, income numeric, expense numeric, balance numeric, cumulative numeric,
               total_income numeric, total_expense numeric)
language plpgsql stable security invoker set search_path = '' as $$
begin
  if p_step not in ('day', 'week', 'month') then
    raise exception 'passo inválido: use day, week ou month' using errcode = '22023';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 3660 or (p_step = 'day' and p_to - p_from > 366) then
    raise exception 'período inválido (dia: até 366 dias; semana e mês: até 10 anos)' using errcode = '22023';
  end if;
  return query
  with itens as (
    select t.date as dia, t.type as tipo, t.amount as valor
      from public.transactions t
     where t.household_id = p_household and t.deleted_at is null and t.type in ('income', 'expense')
       and t.date between p_from and p_to
       and (t.status = 'paid' or (p_include_planned and t.status = 'planned'))
       and (p_accounts is null or t.account_id = any(p_accounts))
       and (p_member is null or t.created_by = p_member)
    union all
    select e.date, 'expense', case when e.kind = 'credit' then -e.amount else e.amount end
      from public.debt_events e
     where e.household_id = p_household and e.voided_at is null
       and e.kind in ('charge', 'credit', 'interest', 'fee') and e.date between p_from and p_to
       and (p_accounts is null or e.account_id = any(p_accounts))
       and (p_member is null or e.created_by = p_member)
    union all
    select i.due_date, 'expense',
           i.face - coalesce((select sum(e.amount) from public.debt_events e
                               where e.installment_id = i.id and e.kind in ('charge', 'cancel') and e.voided_at is null), 0)
      from public.debt_installments i
     where p_include_planned and p_accounts is null and p_member is null
       and i.household_id = p_household and i.due_date between p_from and p_to
    union all
    -- principal pago de empréstimo/financiamento (migration 046)
    select l.day, 'expense', l.amount
      from private.loan_principal_items(p_household, p_from, p_to) l
     where (p_accounts is null or l.account_id = any(p_accounts))
       and (p_member is null or l.created_by = p_member)
    union all
    -- parcela planejada do contrato (ainda não baixada)
    select s.day, 'expense', s.amount
      from private.loan_schedule_planned(p_household, p_from, p_to) s
     where p_include_planned and p_member is null
       and (p_accounts is null or s.account_id = any(p_accounts))
  ), baldes as (
    select (case p_step when 'day' then g::date when 'week' then date_trunc('week', g)::date
                        else date_trunc('month', g)::date end) as inicio
      from generate_series(p_from::timestamp, p_to::timestamp,
                           case p_step when 'day' then interval '1 day' when 'week' then interval '1 week'
                                       else interval '1 month' end) g
  ), unicos as (
    select distinct b.inicio from baldes b
    union
    select (case p_step when 'day' then p_to when 'week' then date_trunc('week', p_to)::date
                        else date_trunc('month', p_to)::date end)
  ), somas as (
    select u.inicio,
           coalesce(sum(x.valor) filter (where x.tipo = 'income'), 0) as entrada,
           coalesce(sum(x.valor) filter (where x.tipo = 'expense'), 0) as saida
      from unicos u
      left join itens x on (case p_step when 'day' then x.dia when 'week' then date_trunc('week', x.dia)::date
                                        else date_trunc('month', x.dia)::date end) = u.inicio
     group by u.inicio
  )
  select s.inicio, s.entrada, s.saida, s.entrada - s.saida,
         sum(s.entrada - s.saida) over (order by s.inicio),
         sum(s.entrada) over (), sum(s.saida) over ()
    from somas s
   where (select private.is_member(p_household))
   order by s.inicio;
end $$;

create or replace function public.budget_usage(p_household uuid, p_month date)
returns table (category_id uuid, category_name text, amount_limit numeric,
               spent numeric, remaining numeric, percent numeric)
language sql stable security invoker set search_path = '' as $$
  select b.category_id, c.name, b.amount_limit,
         coalesce(s.spent, 0),
         b.amount_limit - coalesce(s.spent, 0),
         round(100 * coalesce(s.spent, 0) / b.amount_limit, 1)
    from public.budgets b
    join public.categories c on c.household_id = b.household_id and c.id = b.category_id
    left join lateral (
      select sum(x.amt) as spent
        from (
          select t.amount as amt, t.category_id as cat
            from public.transactions t
           where t.household_id = b.household_id and t.type = 'expense' and t.status = 'paid'
             and t.deleted_at is null
             and t.date >= b.month and t.date < (b.month + interval '1 month')::date
          union all
          select case when e.kind = 'credit' then -e.amount else e.amount end,
                 coalesce(e.category_id, i.category_id)
            from public.debt_events e
            left join public.debt_installments i
              on i.household_id = e.household_id and i.id = e.installment_id
           where e.household_id = b.household_id and e.voided_at is null
             and e.kind in ('charge', 'credit', 'interest', 'fee')
             and e.date >= b.month and e.date < (b.month + interval '1 month')::date
          union all
          select l.amount, l.category_id
            from private.loan_principal_items(b.household_id, b.month, ((b.month + interval '1 month')::date - 1)) l
        ) x
        join public.categories tc on tc.household_id = b.household_id and tc.id = x.cat
       where tc.id = b.category_id or tc.parent_id = b.category_id
    ) s on true
   where b.household_id = p_household
     and b.month = date_trunc('month', p_month::timestamp)::date
     and (select private.is_member(p_household))
   order by c.name
$$;
