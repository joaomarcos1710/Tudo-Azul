-- Tudo Azul — migration 019: a projeção não pode tratar como "gasto variável" o que um recorrente excluído já gerou
--
-- Achado da revisão de 29/10/2026 sobre a migration 018 (recurrence_delete): a projeção do mês e a do orçamento calculam o ritmo
-- (gasto por dia x dias que faltam) só com o gasto pago "fora de recorrência", e decidiam isso por `recurrence_id is null`.
-- Excluir a regra zera esse vínculo (ON DELETE SET NULL) nos lançamentos que ela já gerou e foram pagos; a partir daí o aluguel
-- pago passava a contar como gasto variável e inflava o ritmo (exemplo: aluguel de 2.000,00 pago + 100,00 de mercado, no dia 20:
-- projetado 2.155,00 antes de excluir a regra e 3.255,00 depois; no dia 8, 8.137,50).
--
-- Correção: o critério passa a ser `occurrence_date is null`. A coluna é preenchida só pela geração da regra
-- (recurrence_materialize) e NÃO é zerada pelo ON DELETE SET NULL; lançamento digitado à mão nunca a tem. Nenhum dado é alterado:
-- só estas duas funções são recriadas (create or replace, mesmos parâmetros, mesmas colunas e mesmos privilégios).
--
-- Teste: 26_projection_deleted_recurrence (falha sem esta migration).

create or replace function public.month_projection(p_household uuid, p_month date, p_today date)
returns table (days_in_month integer, days_elapsed integer, days_left integer,
               spent numeric, planned numeric, variable_so_far numeric, pace_per_day numeric,
               pace_extra numeric, projected numeric)
language sql stable security invoker set search_path = '' as $$
  with m as (
    select date_trunc('month', p_month::timestamp)::date as first_day,
           (date_trunc('month', p_month::timestamp) + interval '1 month - 1 day')::date as last_day
  ), d as (
    select m.first_day, m.last_day,
           (m.last_day - m.first_day + 1) as n,
           greatest(0, least(p_today, m.last_day) - m.first_day + 1) as elapsed
      from m
  ), v as (
    select d.*, coalesce((select sum(t.amount) from public.transactions t
                           where t.household_id = p_household and t.type = 'expense' and t.status = 'paid'
                             and t.deleted_at is null and t.occurrence_date is null
                             and t.date between d.first_day and least(p_today, d.last_day)), 0) as variable_paid,
           coalesce((select sum(x.amount) from private.card_recurrence_pending(p_household, d.first_day, d.last_day) x), 0) as card_rec
      from d
  ), s as (
    select v.*, ps.expense_paid, ps.expense_planned + v.card_rec as planned_total,
           -- ritmo só depois de 7 dias do mês
           case when v.elapsed >= 7 then round(v.variable_paid / v.elapsed * (v.n - v.elapsed), 2) else 0 end as extra
      from v cross join lateral public.period_summary(p_household, v.first_day, v.last_day) ps
  )
  select s.n::integer, s.elapsed::integer, (s.n - s.elapsed)::integer,
         s.expense_paid, s.planned_total, s.variable_paid,
         case when s.elapsed > 0 then round(s.variable_paid / s.elapsed, 2) else 0 end,
         s.extra,
         s.expense_paid + s.planned_total + s.extra
    from s
   where (select private.is_member(p_household))
$$;

create or replace function public.budget_projection(p_household uuid, p_month date, p_today date)
returns table (category_id uuid, category_name text, amount_limit numeric, spent numeric, planned numeric,
               pace_extra numeric, projected numeric, remaining numeric)
language sql stable security invoker set search_path = '' as $$
  with m as (
    select date_trunc('month', p_month::timestamp)::date as first_day,
           (date_trunc('month', p_month::timestamp) + interval '1 month - 1 day')::date as last_day
  ), d as (
    select m.first_day, m.last_day, (m.last_day - m.first_day + 1) as n,
           greatest(0, least(p_today, m.last_day) - m.first_day + 1) as elapsed
      from m
  )
  select u.category_id, u.category_name, u.amount_limit, u.spent,
         pl.planned, pc.pace_extra,
         u.spent + pl.planned + pc.pace_extra,
         u.amount_limit - (u.spent + pl.planned + pc.pace_extra)
    from d
   cross join lateral public.budget_usage(p_household, d.first_day) u
   cross join lateral (
     select coalesce((select sum(t.amount) from public.transactions t
                        join public.categories tc on tc.household_id = t.household_id and tc.id = t.category_id
                       where t.household_id = p_household and t.type = 'expense' and t.status = 'planned'
                         and t.deleted_at is null and t.date between d.first_day and d.last_day
                         and (tc.id = u.category_id or tc.parent_id = u.category_id)), 0)
          + coalesce((select sum(i.face - coalesce((select sum(e.amount) from public.debt_events e
                                                      where e.installment_id = i.id and e.kind in ('charge', 'cancel')
                                                        and e.voided_at is null), 0))
                        from public.debt_installments i
                        join public.categories ic on ic.household_id = i.household_id and ic.id = i.category_id
                       where i.household_id = p_household and i.due_date between d.first_day and d.last_day
                         and (ic.id = u.category_id or ic.parent_id = u.category_id)), 0)
          + coalesce((select sum(x.amount) from private.card_recurrence_pending(p_household, d.first_day, d.last_day) x
                        join public.categories xc on xc.household_id = p_household and xc.id = x.category_id
                       where (xc.id = u.category_id or xc.parent_id = u.category_id)), 0) as planned
   ) pl
   cross join lateral (
     select case when d.elapsed >= 7
                 then round(coalesce((select sum(t.amount) from public.transactions t
                                        join public.categories tc on tc.household_id = t.household_id and tc.id = t.category_id
                                       where t.household_id = p_household and t.type = 'expense' and t.status = 'paid'
                                         and t.deleted_at is null and t.occurrence_date is null
                                         and t.date between d.first_day and least(p_today, d.last_day)
                                         and (tc.id = u.category_id or tc.parent_id = u.category_id)), 0)
                            / d.elapsed * (d.n - d.elapsed), 2)
                 else 0 end as pace_extra
   ) pc
   where (select private.is_member(p_household))
   order by u.category_name
$$;
