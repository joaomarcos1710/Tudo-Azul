-- Tudo Azul: correção temporal da projeção e orquestração da Home de Decisão.
-- Reutiliza as fontes oficiais; não altera lançamentos, contratos, faturas ou saldos.

create or replace function public.month_projection(
  p_household uuid,
  p_month date,
  p_today date
)
returns table (
  days_in_month integer,
  days_elapsed integer,
  days_left integer,
  spent numeric,
  planned numeric,
  variable_so_far numeric,
  pace_per_day numeric,
  pace_extra numeric,
  projected numeric
)
language sql
stable
security invoker
set search_path = ''
as $function$
  with m as (
    select date_trunc('month', p_month::timestamp)::date as first_day,
           (date_trunc('month', p_month::timestamp) + interval '1 month - 1 day')::date as last_day
  ),
  d as (
    select m.first_day, m.last_day,
           (m.last_day - m.first_day + 1) as n,
           greatest(0, least(p_today, m.last_day) - m.first_day + 1) as elapsed,
           least(p_today, m.last_day) as cutoff
      from m
  ),
  v as (
    select d.*,
           coalesce((select sum(t.amount) from public.transactions t
                      where t.household_id = p_household and t.type = 'expense' and t.status = 'paid'
                        and t.deleted_at is null and t.occurrence_date is null
                        and t.date between d.first_day and d.cutoff
                        and exists (select 1 from public.accounts ac where ac.household_id = t.household_id
                                      and ac.id = t.account_id and ac.currency_code = 'BRL')), 0) as variable_paid,
           coalesce((select sum(x.amount) from private.card_recurrence_pending(p_household, d.first_day, d.last_day) x), 0) as card_rec
      from d
  ),
  realizado as (
    select case when v.elapsed = 0 then 0::numeric
                else coalesce(ps.expense_paid, 0) end as expense_paid
      from v
      left join lateral public.period_summary(p_household, v.first_day, v.cutoff) ps
        on v.elapsed > 0
  ),
  previsto as (
    select coalesce(ps.expense_planned, 0) as expense_planned
      from v
      cross join lateral public.period_summary(p_household, v.first_day, v.last_day) ps
  ),
  s as (
    select v.*, r.expense_paid, p.expense_planned + v.card_rec as planned_total,
           case when v.elapsed >= 7
                then round(v.variable_paid / v.elapsed * (v.n - v.elapsed), 2)
                else 0 end as extra
      from v cross join realizado r cross join previsto p
  )
  select s.n::integer, s.elapsed::integer, (s.n - s.elapsed)::integer,
         s.expense_paid, s.planned_total, s.variable_paid,
         case when s.elapsed > 0 then round(s.variable_paid / s.elapsed, 2) else 0 end,
         s.extra,
         s.expense_paid + s.planned_total + s.extra
    from s
   where (select private.is_member(p_household))
$function$;

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
           (now() at time zone 'America/Sao_Paulo')::date as today,
           least((now() at time zone 'America/Sao_Paulo')::date,
                 (date_trunc('month', p_month::timestamp) + interval '1 month - 1 day')::date) as as_of
  ),
  tesouraria as materialized (
    select h.*
      from periodo p
      cross join lateral public.home_indicators(p_household, p.as_of) h
  ),
  projecao as materialized (
    select mp.*
      from periodo p
      cross join lateral public.month_projection(p_household, p.month_start, p.as_of) mp
  ),
  matriz as materialized (
    select cm.*
      from periodo p
      cross join lateral public.dashboard_commitment_matrix(p_household, p.month_start, 3) cm
     where cm.period_month = p.month_start
       and cm.row_type = 'item'
       and cm.currency_code = 'BRL'
  ),
  matriz_classificada as (
    select m.*,
           exists (
             select 1
               from public.debts d
               join public.debt_invoices di
                 on di.household_id = d.household_id and di.debt_id = d.id
              where d.household_id = p_household
                and d.kind = 'card'
                and date_trunc('month', di.due_date)::date = m.period_month
                and (
                  m.commitment_id like 'card-purchase:' || d.id::text || ':%'
                  or m.commitment_id like 'card-invoice-adjustment:' || d.id::text || ':%'
                  or (
                    m.commitment_id like 'card-recurrence:%'
                    and exists (
                      select 1 from public.recurrences r
                       where r.household_id = p_household
                         and r.id::text = substring(m.commitment_id from '^card-recurrence:([0-9a-f-]{36})$')
                         and r.debt_id = d.id
                    )
                  )
                )
           ) as already_reserved
      from matriz m
  ),
  compromissos as (
    select coalesce(sum(m.amount) filter (where not m.already_reserved), 0) as total_pendente,
           coalesce(jsonb_agg(jsonb_build_object(
             'id', m.commitment_id,
             'description', m.description,
             'source', m.source_name,
             'sourceType', m.source_type,
             'month', m.period_month,
             'currency', m.currency_code,
             'amount', m.amount,
             'lineType', m.row_type
           ) order by m.amount desc, m.description)
             filter (where m.commitment_id is not null and not m.already_reserved), '[]'::jsonb) as items
      from matriz_classificada m
  ),
  reservas_comprometidas as (
    select coalesce(sum(a.amount), 0)::numeric as total_reservado
      from public.reserves r
      left join public.reserve_allocations a
        on a.household_id = r.household_id
       and a.reserve_id = r.id
     where r.household_id = p_household
       and r.currency_code = 'BRL'
       and r.status in ('active', 'completed')
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
      cross join lateral public.home_alerts(p_household, p.as_of) a
     where a.kind in ('overdue_payable', 'overdue_receivable')
  ),
  resumo_realizado as materialized (
    select ps.*
      from periodo p
      cross join lateral public.period_summary(p_household, p.month_start, least(p.as_of, p.month_end)) ps
     where p.as_of >= p.month_start
  ),
  resumo_mes as materialized (
    select ps.*
      from periodo p
      cross join lateral public.period_summary(p_household, p.month_start, p.month_end) ps
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
          cross join lateral public.budget_projection(p_household, p.month_start, p.as_of) x
         where x.amount_limit > 0
         order by x.projected / nullif(x.amount_limit, 0) desc, x.category_name
         limit 5
      ) ranked
  ),
  calculo as (
    select p.month_start, p.month_end, p.as_of, t.available,
           r.total_reservado,
           (t.available - r.total_reservado) as circulating_balance,
           c.total_pendente, c.items,
           coalesce((select r.income_paid from resumo_realizado r), 0) as income_paid,
           coalesce((select r.income_planned from resumo_mes r), 0) as income_planned,
           case when p.today > p.month_end then 0
                else greatest(0, p.month_end - greatest(p.month_start, p.as_of) + 1) end as days_remaining,
           mp.*
      from periodo p
      cross join tesouraria t
      cross join compromissos c
      cross join reservas_comprometidas r
      cross join projecao mp
  )
  select jsonb_build_object(
    'monthStart', c.month_start,
    'monthEnd', c.month_end,
    'asOf', least(c.as_of, c.month_end),
    'availableMoney', round(c.available, 2),
    'reserveCommitted', round(c.total_reservado, 2),
    'circulatingBalance', round(c.circulating_balance, 2),
    'moneyFree', round(c.circulating_balance - c.total_pendente, 2),
    'dailySafeLimit', case when c.days_remaining > 0
      then round(greatest(c.circulating_balance - c.total_pendente, 0) / c.days_remaining, 2)
      else 0 end,
    'currentDailyPace', case when c.days_elapsed > 0
      then round(c.spent / c.days_elapsed, 2) else 0 end,
    'incomePaid', round(c.income_paid, 2),
    'incomePlanned', round(c.income_planned, 2),
    'expensesPaid', round(c.spent, 2),
    'expensesPlanned', round(c.planned, 2),
    'plannedOutflows', round(c.total_pendente, 2),
    'treasury', (select to_jsonb(t) from tesouraria t),
    'projection', jsonb_build_object(
      'daysInMonth', c.days_in_month, 'daysElapsed', c.days_elapsed, 'daysLeft', c.days_left,
      'spent', round(c.spent, 2), 'planned', round(c.planned, 2),
      'variableSoFar', round(c.variable_so_far, 2), 'pacePerDay', round(c.pace_per_day, 2),
      'paceExtra', round(c.pace_extra, 2), 'projected', round(c.projected, 2)
    ),
    'upcoming_commitments', c.items,
    'risks', a.items,
    'monitoredCategories', k.items,
    'opportunities', null,
    'calculation', jsonb_build_object(
      'method', 'home_indicators + dashboard_commitment_matrix + month_projection',
      'closedCardInvoicesExcluded', true,
      'reservesIncluded', true,
      'reserveCurrency', 'BRL',
      'reserveStatusesIncluded', jsonb_build_array('active', 'completed'),
      'note', 'Dinheiro Livre = tesouraria disponível menos reservas comprometidas em BRL e menos compromissos futuros não duplicados. Faturas já descontadas da tesouraria são excluídas da matriz.'
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
