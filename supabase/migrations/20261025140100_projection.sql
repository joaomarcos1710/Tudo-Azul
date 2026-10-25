-- Tudo Azul — migration 013: projeção do mês e projeção por orçamento (somente leitura)
--
-- Ideia vinda da revisão do repositório shadcn-fintech (25/10/2026), refeita com as regras do Tudo Azul:
-- "até o fim do mês, quanto vou ter gasto?". A conta fica TODA no banco; a tela só mostra.
--
--   projetado = já gasto + já previsto + ritmo do variável × dias que faltam
--     já gasto     despesa paga do mês (a mesma definição de period_summary: lançamentos pagos, cobranças de
--                  parcela de cartão, juros e tarifas, menos estornos)
--     já previsto  planejado do mês (period_summary: lançamentos planejados, inclusive atrasados, e parcelas de
--                  cartão que ainda vão fechar no mês) MAIS as assinaturas recorrentes de cartão que ainda não
--                  viraram parcela (a recorrência de cartão só gera a parcela no dia; sem isso ela sumiria da
--                  projeção até o dia da cobrança)
--     ritmo        média diária do que foi pago e NÃO é recorrente (conta fixa e assinatura já estão no "previsto"
--                  quando futuras, e extrapolar essas distorceria), vezes os dias que faltam.
--                  Só entra depois de 7 dias de mês: com poucos dias, um aluguel pago no dia 2 viraria "gasto
--                  diário" e a projeção sairia absurda. Antes disso a projeção é só gasto + previsto.
--
-- É uma ESTIMATIVA. Limitação conhecida: o que você lança como planejado (sem recorrência) e depois paga entra no
-- ritmo como se fosse gasto contínuo. Mês passado: sem ritmo (dias que faltam = 0). Mês futuro: só o previsto.
-- budget_projection faz a mesma conta por categoria com orçamento (categoria raiz soma as subcategorias; o "gasto"
-- é o de budget_usage, a mesma fonte da tela de Orçamentos).
-- SECURITY INVOKER: a RLS do chamador decide; quem não é membro recebe zero linhas. Nenhuma tabela é alterada.

-- Ocorrências de recorrência de CARTÃO ainda sem parcela cuja fatura fecha dentro de [p_first, p_last].
-- Mesma regra de recurrence_materialize/card_first_closing, escrita aqui porque as funções private.card_* não são
-- executáveis pelo cliente (esta função é SECURITY INVOKER).
create function private.card_recurrence_pending(p_household uuid, p_first date, p_last date)
returns table (category_id uuid, amount numeric)
language sql stable security invoker set search_path = '' as $$
  select r.category_id, r.amount
    from public.recurrences r
    join public.debts d on d.household_id = r.household_id and d.id = r.debt_id
   cross join lateral (values ((p_first - interval '1 month')::date), (p_first)) m(mes)
   cross join lateral (
     select make_date(extract(year from m.mes)::int, extract(month from m.mes)::int,
                      least(r.day, extract(day from (m.mes + interval '1 month - 1 day'))::int)) as occ
   ) o
   cross join lateral (
     select make_date(extract(year from m.mes)::int, extract(month from m.mes)::int,
                      least(d.closing_day, extract(day from (m.mes + interval '1 month - 1 day'))::int)) as fecha_mes,
            (m.mes + interval '1 month')::date as prox
   ) f
   cross join lateral (
     select case when o.occ < f.fecha_mes then f.fecha_mes
                 else make_date(extract(year from f.prox)::int, extract(month from f.prox)::int,
                                least(d.closing_day, extract(day from (f.prox + interval '1 month - 1 day'))::int)) end as fecha
   ) c
   where r.household_id = p_household and r.kind = 'card' and r.active and d.closing_day is not null
     and o.occ >= r.start_date and (r.end_date is null or o.occ <= r.end_date)
     and o.occ > d.reference_date
     and c.fecha between p_first and p_last
     and not exists (select 1 from public.debt_installments i
                      where i.recurrence_id = r.id and i.occurrence_date = o.occ)
$$;
revoke execute on function private.card_recurrence_pending(uuid, date, date) from public, anon;
grant execute on function private.card_recurrence_pending(uuid, date, date) to authenticated;

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
