-- Tudo Azul — migration 001 (5/5): funções de saldo, resumo e orçamento
--
-- SECURITY INVOKER: aqui a RLS do chamador decide o que aparece. As funções que
-- agregam também verificam o vínculo, para que quem não é membro receba ZERO
-- linhas (e não uma linha de zeros). Regra de saldo: docs/MODELO-DE-DADOS.md, seção 4.

-- Saldo de cada conta na data p_as_of. NÃO filtra por active: conta desativada
-- continua nos saldos e nas consultas históricas (seção 4.4). Só entram contas
-- com opening_date <= p_as_of.
create function public.account_balances(p_household uuid, p_as_of date)
returns table (account_id uuid, name text, type text, active boolean, balance numeric)
language sql stable security invoker set search_path = '' as $$
  select a.id, a.name, a.type, a.active,
         a.initial_balance + coalesce(sum(case
           when t.type = 'income'   and t.account_id = a.id             then  t.amount
           when t.type = 'expense'  and t.account_id = a.id             then -t.amount
           when t.type = 'transfer' and t.account_id = a.id             then -t.amount
           when t.type = 'transfer' and t.destination_account_id = a.id then  t.amount
         end), 0)
    from public.accounts a
    left join public.transactions t
      on t.household_id = a.household_id
     and t.deleted_at is null
     and t.status = 'paid'
     and t.date >= a.opening_date
     and t.date <= p_as_of
     and (t.account_id = a.id or t.destination_account_id = a.id)
   where a.household_id = p_household and a.opening_date <= p_as_of
   group by a.id, a.name, a.type, a.active, a.initial_balance
$$;

-- Totais do dashboard, calculados no banco (o front nunca soma saldos).
-- Invariante: total = total_active + total_inactive.
create function public.balance_totals(p_household uuid, p_as_of date)
returns table (total numeric, total_active numeric, total_inactive numeric)
language sql stable security invoker set search_path = '' as $$
  select s.* from (
    select coalesce(sum(b.balance), 0),
           coalesce(sum(b.balance) filter (where b.active), 0),
           coalesce(sum(b.balance) filter (where not b.active), 0)
      from public.account_balances(p_household, p_as_of) b
  ) s
  where (select private.is_member(p_household))
$$;

-- Receitas e despesas do período (transferências ficam de fora).
create function public.period_summary(p_household uuid, p_from date, p_to date)
returns table (income_paid numeric, expense_paid numeric, result numeric,
               income_planned numeric, expense_planned numeric)
language sql stable security invoker set search_path = '' as $$
  select s.income_paid, s.expense_paid, s.income_paid - s.expense_paid,
         s.income_planned, s.expense_planned
    from (
      select coalesce(sum(t.amount) filter (where t.type = 'income'  and t.status = 'paid'), 0)    as income_paid,
             coalesce(sum(t.amount) filter (where t.type = 'expense' and t.status = 'paid'), 0)    as expense_paid,
             coalesce(sum(t.amount) filter (where t.type = 'income'  and t.status = 'planned'), 0) as income_planned,
             coalesce(sum(t.amount) filter (where t.type = 'expense' and t.status = 'planned'), 0) as expense_planned
        from public.transactions t
       where t.household_id = p_household
         and t.deleted_at is null
         and t.type in ('income', 'expense')
         and t.date between p_from and p_to
    ) s
   where (select private.is_member(p_household))
$$;

-- Uso do orçamento no mês de p_month: categorias raiz, somando as subcategorias.
create function public.budget_usage(p_household uuid, p_month date)
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
      select sum(t.amount) as spent
        from public.transactions t
        join public.categories tc on tc.household_id = t.household_id and tc.id = t.category_id
       where t.household_id = b.household_id
         and t.type = 'expense'
         and t.status = 'paid'
         and t.deleted_at is null
         and t.date >= b.month
         and t.date <  (b.month + interval '1 month')::date
         and (tc.id = b.category_id or tc.parent_id = b.category_id)
    ) s on true
   where b.household_id = p_household
     and b.month = date_trunc('month', p_month::timestamp)::date
     and (select private.is_member(p_household))
   order by c.name
$$;

revoke execute on function
  public.account_balances(uuid, date), public.balance_totals(uuid, date),
  public.period_summary(uuid, date, date), public.budget_usage(uuid, date)
  from public, anon;
grant execute on function
  public.account_balances(uuid, date), public.balance_totals(uuid, date),
  public.period_summary(uuid, date, date), public.budget_usage(uuid, date)
  to authenticated;
