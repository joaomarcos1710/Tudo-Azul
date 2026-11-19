-- Tudo Azul — migration 144: orçamento pelo ciclo do dia em que o mês começa (pedido do dono, 19/11/2026)
--
-- Hoje o orçamento é sempre o mês de calendário. Quem recebe no dia 20 quer o orçamento do dia 20 ao dia 19 do mês seguinte.
-- Regra (decisão 16/11/2026, "nomeado pelo mês em que começa"): o limite continua gravado em budgets.month = dia 1 do mês em que o
-- ciclo COMEÇA; o ciclo de chave 2026-11 com dia 20 vai de 20/11 a 19/12. Com dia 1 o ciclo é o mês de calendário, igual a antes.
--
-- O que muda:
--   * private.budget_cycle(p_month, p_dia) devolve o início e o fim do ciclo; dia fora de 1 a 28 é erro 22023 (nunca resultado
--     vazio, que pareceria "sem orçamento").
--   * public.budget_usage(p_household, p_month, p_dia default 1) e public.budget_projection(p_household, p_month, p_today,
--     p_dia default 1) somam e projetam no ciclo (gasto pago, cobrança de cartão, empréstimo, planejado, ritmo e dias que
--     faltam). As colunas devolvidas não mudam.
--   * Quem chama com 3 argumentos (public.get_home_decision_month e os testes antigos) continua no mês de calendário: o default
--     é 1. O Início, portanto, NÃO muda com esta migration (limite conhecido, em 40 - Pendências).
-- Mudar a assinatura exige drop + create. Ninguém depende delas no catálogo (pg_depend); quem chama lê por nome. Mesma segurança
-- (SECURITY INVOKER, search_path vazio, stable) e mesmos grants (só authenticated). Corpos copiados da 056/101 com a janela de
-- datas vinda do ciclo.
-- Teste: 137_budget_cycle (falha sem esta migration).

create function private.budget_cycle(p_month date, p_dia int default 1)
returns table (first_day date, last_day date)
language plpgsql immutable security invoker set search_path = '' as $$
begin
  if p_dia is null or p_dia not between 1 and 28 then
    raise exception 'dia do ciclo inválido: %', p_dia using errcode = '22023';
  end if;
  first_day := date_trunc('month', p_month::timestamp)::date + (p_dia - 1);
  last_day := (date_trunc('month', p_month::timestamp) + interval '1 month')::date + (p_dia - 1) - 1;
  return next;
end $$;

revoke execute on function private.budget_cycle(date, int) from public, anon;
grant execute on function private.budget_cycle(date, int) to authenticated;

drop function public.budget_projection(uuid, date, date);
drop function public.budget_usage(uuid, date);

create function public.budget_usage(p_household uuid, p_month date, p_dia int default 1)
returns table (category_id uuid, category_name text, amount_limit numeric,
               spent numeric, remaining numeric, percent numeric)
language sql stable security invoker set search_path = '' as $$
  select b.category_id, c.name, b.amount_limit,
         coalesce(s.spent, 0),
         b.amount_limit - coalesce(s.spent, 0),
         round(100 * coalesce(s.spent, 0) / b.amount_limit, 1)
    from public.budgets b
    join public.categories c on c.household_id = b.household_id and c.id = b.category_id
    cross join lateral private.budget_cycle(b.month, p_dia) cy
    left join lateral (
      select sum(x.amt) as spent
        from (
          select t.amount as amt, t.category_id as cat
            from public.transactions t
           where t.household_id = b.household_id and t.type = 'expense' and t.status = 'paid'
             and t.deleted_at is null
             and t.date between cy.first_day and cy.last_day
             and exists (select 1 from public.accounts ac where ac.household_id = t.household_id and ac.id = t.account_id
                           and ac.currency_code = 'BRL')
          union all
          select case when e.kind = 'credit' then -e.amount else e.amount end,
                 coalesce(e.category_id, i.category_id)
            from public.debt_events e
            left join public.debt_installments i
              on i.household_id = e.household_id and i.id = e.installment_id
           where e.household_id = b.household_id and e.voided_at is null
             and e.kind in ('charge', 'credit', 'interest', 'fee')
             and e.date between cy.first_day and cy.last_day
          union all
          select l.amount, l.category_id
            from private.loan_principal_items(b.household_id, cy.first_day, cy.last_day) l
        ) x
        join public.categories tc on tc.household_id = b.household_id and tc.id = x.cat
       where tc.id = b.category_id or tc.parent_id = b.category_id
    ) s on true
   where b.household_id = p_household
     and b.month = date_trunc('month', p_month::timestamp)::date
     and (select private.is_member(p_household))
   order by c.name
$$;

create function public.budget_projection(p_household uuid, p_month date, p_today date, p_dia int default 1)
returns table (category_id uuid, category_name text, amount_limit numeric, spent numeric, planned numeric,
               pace_extra numeric, projected numeric, remaining numeric, planned_card numeric)
language sql stable security invoker set search_path = '' as $$
  with m as (
    select c.first_day, c.last_day from private.budget_cycle(p_month, p_dia) c
  ), d as (
    select m.first_day, m.last_day, (m.last_day - m.first_day + 1) as n,
           greatest(0, least(p_today, m.last_day) - m.first_day + 1) as elapsed
      from m
  )
  select u.category_id, u.category_name, u.amount_limit, u.spent,
         pl.planned_other + pl.planned_card, pc.pace_extra,
         u.spent + (pl.planned_other + pl.planned_card) + pc.pace_extra,
         u.amount_limit - (u.spent + (pl.planned_other + pl.planned_card) + pc.pace_extra),
         pl.planned_card
    from d
   cross join lateral public.budget_usage(p_household, p_month, p_dia) u
   cross join lateral (
     select coalesce((select sum(t.amount) from public.transactions t
                        join public.categories tc on tc.household_id = t.household_id and tc.id = t.category_id
                       where t.household_id = p_household and t.type = 'expense' and t.status = 'planned'
                         and t.deleted_at is null and t.date between d.first_day and d.last_day
                         and (tc.id = u.category_id or tc.parent_id = u.category_id)
                         and exists (select 1 from public.accounts ac where ac.household_id = t.household_id
                                       and ac.id = t.account_id and ac.currency_code = 'BRL')), 0)
          + coalesce((select sum(x.amount) from private.card_recurrence_pending(p_household, d.first_day, d.last_day) x
                        join public.categories xc on xc.household_id = p_household and xc.id = x.category_id
                       where (xc.id = u.category_id or xc.parent_id = u.category_id)), 0) as planned_other,
            -- parcela de cartão que fecha no mês e ainda não foi cobrada: face − cobrado − cancelado
            coalesce((select sum(i.face - coalesce((select sum(e.amount) from public.debt_events e
                                                      where e.installment_id = i.id and e.kind in ('charge', 'cancel')
                                                        and e.voided_at is null), 0))
                        from public.debt_installments i
                        join public.categories ic on ic.household_id = i.household_id and ic.id = i.category_id
                       where i.household_id = p_household and i.due_date between d.first_day and d.last_day
                         and (ic.id = u.category_id or ic.parent_id = u.category_id)), 0) as planned_card
   ) pl
   cross join lateral (
     select case when d.elapsed >= 7
                 then round(coalesce((select sum(t.amount) from public.transactions t
                                        join public.categories tc on tc.household_id = t.household_id and tc.id = t.category_id
                                       where t.household_id = p_household and t.type = 'expense' and t.status = 'paid'
                                         and t.deleted_at is null and t.occurrence_date is null
                                         and t.date between d.first_day and least(p_today, d.last_day)
                                         and (tc.id = u.category_id or tc.parent_id = u.category_id)
                                         and exists (select 1 from public.accounts ac where ac.household_id = t.household_id
                                                       and ac.id = t.account_id and ac.currency_code = 'BRL')), 0)
                            / d.elapsed * (d.n - d.elapsed), 2)
                 else 0 end as pace_extra
   ) pc
   where (select private.is_member(p_household))
   order by u.category_name
$$;

revoke execute on function public.budget_usage(uuid, date, int), public.budget_projection(uuid, date, date, int) from public, anon;
grant execute on function public.budget_usage(uuid, date, int), public.budget_projection(uuid, date, date, int) to authenticated;
