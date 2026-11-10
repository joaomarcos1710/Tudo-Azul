-- Tudo Azul — migration 101: orçamento mostra à parte o cartão já lançado que ainda não virou gasto (planned_card)
--
-- Pedido do dono (10/11/2026): na tela de Orçamentos, a barra de cada categoria ganha um trecho tracejado com as compras de
-- cartão já lançadas que caem no mês do orçamento e ainda não entraram no gasto.
--
-- Como o cartão entra no orçamento hoje (nada disso muda):
--   * a parcela de cartão (debt_installments: só compra parcelada, assinatura gerada ou item agendado convertido; empréstimo e
--     financiamento NÃO têm parcelas, migration 003) tem due_date = data de FECHAMENTO da fatura (004/061);
--   * até o fechamento ela está no `planned` de budget_projection, pelo que resta dela (face − cobrado − cancelado);
--   * no fechamento (card_bill_due) ou na antecipação ela vira cobrança ('charge') e passa para o `spent` (budget_usage), na
--     data da cobrança; o que resta dela no `planned` vai a zero. Estorno de parcela ainda não cobrada é 'cancel' (abate o
--     planejado); de parcela já cobrada é 'credit' (abate o gasto). O PAGAMENTO da fatura não é despesa: não mexe em nenhum.
--   Logo, hoje não há dupla contagem: a mesma parcela está ou no `planned` ou no `spent`, nunca nos dois.
--
-- O que muda: public.budget_projection devolve, NO FIM do retorno, `planned_card numeric` = a parte do `planned` que vem de
-- parcela de cartão ainda não cobrada (a mesma soma que já estava no `planned`, só exposta à parte). Por construção
-- 0 <= planned_card <= planned, e nenhum outro número muda (spent, planned, pace_extra, projected, remaining iguais aos da
-- 056, 20261105000100_foreign_currency_income_expense.sql: o teste compara linha a linha com uma cópia dela).
-- Não entram em planned_card: despesa planejada em conta (transactions) e assinatura de cartão ainda não gerada
-- (private.card_recurrence_pending): continuam só no `planned`.
-- Atenção ao nome na tela: "fatura fechada e ainda não paga" já está no `spent` (o orçamento é pela fatura, desde a 004);
-- e o pagamento ADIANTADO de uma fatura que ainda não fechou não tira a parcela de planned_card (adiantamento não é
-- despesa, migration 010). O número é "cartão lançado, fatura ainda não fechada".
-- Moeda: cartão só usa conta em reais (private.account_brl_only), então a parcela é sempre BRL; nada a filtrar.
--
-- Mudar o retorno exige drop + create. Ninguém depende dela no catálogo (pg_depend vazio); quem a chama lê por nome:
-- public.get_home_decision_month (20261109050000) e o front (src/lib/orcamentos.ts). Mesma segurança (SECURITY INVOKER,
-- search_path vazio, stable) e mesmos grants (só authenticated). Corpo igual ao da 056, com a soma do cartão calculada
-- uma vez numa coluna própria e somada ao planejado.
-- Teste: 95_budget_card_pending (falha sem esta migration).

drop function public.budget_projection(uuid, date, date);

create function public.budget_projection(p_household uuid, p_month date, p_today date)
returns table (category_id uuid, category_name text, amount_limit numeric, spent numeric, planned numeric,
               pace_extra numeric, projected numeric, remaining numeric, planned_card numeric)
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
         pl.planned_other + pl.planned_card, pc.pace_extra,
         u.spent + (pl.planned_other + pl.planned_card) + pc.pace_extra,
         u.amount_limit - (u.spent + (pl.planned_other + pl.planned_card) + pc.pace_extra),
         pl.planned_card
    from d
   cross join lateral public.budget_usage(p_household, d.first_day) u
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

revoke execute on function public.budget_projection(uuid, date, date) from public, anon;
grant execute on function public.budget_projection(uuid, date, date) to authenticated;
