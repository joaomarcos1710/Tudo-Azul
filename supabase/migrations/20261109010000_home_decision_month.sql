-- Tudo Azul — Home de Decisão: primeira RPC agregada.
-- Reaproveita as regras financeiras já existentes; não altera saldos nem cria lançamentos.
-- SECURITY INVOKER mantém a RLS do usuário chamador como autoridade.

create or replace function public.get_home_decision_month(
  p_household uuid,
  p_month date default current_date
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with periodo as (
    select date_trunc('month', p_month::timestamp)::date as month_start,
           (date_trunc('month', p_month::timestamp) + interval '1 month - 1 day')::date as month_end,
           (now() at time zone 'America/Sao_Paulo')::date as today
  ),
  resumo as materialized (
    select s.*
      from periodo p
      cross join lateral public.period_summary(
        p_household, p.month_start, p.month_end
      ) s
  ),
  alertas as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'kind', a.kind,
      'count', a.item_count,
      'total', a.total,
      'firstDate', a.first_date,
      'targetId', a.target_id,
      'targetName', a.target_name
    ) order by a.first_date, a.kind), '[]'::jsonb) as items
      from periodo p
      cross join lateral public.home_alerts(p_household, p.today) a
  ),
  categorias as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'categoryId', ranked.category_id,
      'name', ranked.category_name,
      'limit', ranked.amount_limit,
      'spent', ranked.spent,
      'planned', ranked.planned,
      'projected', ranked.projected,
      'remaining', ranked.remaining,
      'percent', round(100 * ranked.projected / ranked.amount_limit, 1)
    ) order by ranked.ratio desc, ranked.category_name), '[]'::jsonb) as items
      from (
        select x.*, x.projected / nullif(x.amount_limit, 0) as ratio
          from periodo p
          cross join lateral public.budget_projection(
            p_household, p.month_start, p.today
          ) x
         where x.amount_limit > 0
         order by x.projected / nullif(x.amount_limit, 0) desc, x.category_name
         limit 5
      ) ranked
  ),
  calculo as (
    select p.month_start, p.month_end, p.today,
           s.income_paid, s.income_planned, s.expense_paid, s.expense_planned,
           (s.income_paid + s.income_planned - s.expense_paid - s.expense_planned) as money_free,
           greatest(1, p.month_end - greatest(p.month_start, least(p.today, p.month_end)) + 1) as days_remaining,
           greatest(1, least(p.today, p.month_end) - p.month_start + 1) as elapsed_days
      from periodo p cross join resumo s
  )
  select jsonb_build_object(
    'monthStart', c.month_start,
    'monthEnd', c.month_end,
    'asOf', least(c.today, c.month_end),
    'moneyFree', round(c.money_free, 2),
    'dailySafeLimit', round(greatest(c.money_free, 0) / c.days_remaining, 2),
    'currentDailyPace', round(c.expense_paid / c.elapsed_days, 2),
    'incomePaid', round(c.income_paid, 2),
    'incomePlanned', round(c.income_planned, 2),
    'expensesPaid', round(c.expense_paid, 2),
    'expensesPlanned', round(c.expense_planned, 2),
    'plannedOutflows', round(c.expense_planned, 2),
    'risks', a.items,
    'monitoredCategories', k.items,
    'calculation', jsonb_build_object(
      'method', 'period_summary',
      'reservesIncluded', false,
      'note', 'Reservas manuais ainda não possuem entidade própria; não são inferidas de saldos ou limites de orçamento.'
    )
  )
    from calculo c
    cross join alertas a
    cross join categorias k
   where p_household is not null
     and p_month is not null
     and (select private.is_member(p_household));
$$;

revoke execute on function public.get_home_decision_month(uuid, date) from public, anon;
grant execute on function public.get_home_decision_month(uuid, date) to authenticated;
