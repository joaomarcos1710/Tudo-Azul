-- Tudo Azul — migration 013: projeção do mês e projeção por orçamento (somente leitura)
--
-- Ideia vinda da revisão do repositório shadcn-fintech (25/10/2026), refeita com as regras do Tudo Azul:
-- "até o fim do mês, quanto vou ter gasto?". A conta fica TODA no banco; a tela só mostra.
--
--   projetado = já gasto + já previsto + ritmo do variável × dias que faltam
--     já gasto     despesa paga do mês (a mesma definição de period_summary: lançamentos pagos, cobranças de
--                  parcela de cartão, juros e tarifas, menos estornos)
--     já previsto  planejado do mês (lançamentos planejados, inclusive atrasados, e parcelas de cartão que ainda
--                  vão fechar no mês), também de period_summary
--     ritmo        média diária do que foi pago e NÃO é recorrente (conta fixa e assinatura já estão no "previsto"
--                  quando futuras, e extrapolar essas distorceria), vezes os dias que faltam
--
-- É uma ESTIMATIVA: o ritmo de poucos dias é instável (a tela avisa nos primeiros dias do mês). Mês passado: sem
-- ritmo (dias que faltam = 0). Mês futuro: só o previsto.
-- budget_projection faz a mesma conta por categoria com orçamento (categoria raiz soma as subcategorias; o "gasto"
-- é o de budget_usage, a mesma fonte da tela de Orçamentos).
-- SECURITY INVOKER: a RLS do chamador decide; quem não é membro recebe zero linhas. Nenhuma tabela é alterada.

create function public.month_projection(p_household uuid, p_month date, p_today date)
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
                             and t.deleted_at is null and t.recurrence_id is null
                             and t.date between d.first_day and least(p_today, d.last_day)), 0) as variable_paid
      from d
  ), s as (
    select v.*, ps.expense_paid, ps.expense_planned
      from v cross join lateral public.period_summary(p_household, v.first_day, v.last_day) ps
  )
  select s.n::integer, s.elapsed::integer, (s.n - s.elapsed)::integer,
         s.expense_paid, s.expense_planned, s.variable_paid,
         case when s.elapsed > 0 then round(s.variable_paid / s.elapsed, 2) else 0 end,
         case when s.elapsed > 0 then round(s.variable_paid / s.elapsed * (s.n - s.elapsed), 2) else 0 end,
         s.expense_paid + s.expense_planned
           + case when s.elapsed > 0 then round(s.variable_paid / s.elapsed * (s.n - s.elapsed), 2) else 0 end
    from s
   where (select private.is_member(p_household))
$$;

create function public.budget_projection(p_household uuid, p_month date, p_today date)
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
                         and (ic.id = u.category_id or ic.parent_id = u.category_id)), 0) as planned
   ) pl
   cross join lateral (
     select case when d.elapsed > 0
                 then round(coalesce((select sum(t.amount) from public.transactions t
                                        join public.categories tc on tc.household_id = t.household_id and tc.id = t.category_id
                                       where t.household_id = p_household and t.type = 'expense' and t.status = 'paid'
                                         and t.deleted_at is null and t.recurrence_id is null
                                         and t.date between d.first_day and least(p_today, d.last_day)
                                         and (tc.id = u.category_id or tc.parent_id = u.category_id)), 0)
                            / d.elapsed * (d.n - d.elapsed), 2)
                 else 0 end as pace_extra
   ) pc
   where (select private.is_member(p_household))
   order by u.category_name
$$;

revoke execute on function public.month_projection(uuid, date, date), public.budget_projection(uuid, date, date) from public, anon;
grant execute on function public.month_projection(uuid, date, date), public.budget_projection(uuid, date, date) to authenticated;
