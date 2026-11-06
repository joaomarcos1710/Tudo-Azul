-- Tudo Azul — migration 071: os 7 indicadores do topo do Início numa chamada só (#187, pedido do dono de 06/11/2026:
-- "quanto tenho, quanto entra e sai, quanto devo, e se estou avançando").
--
-- 1. private.family_assets_brl(p_household, p_as_of): a regra dos bens (avaliação mais recente até a data × participação
--    da família, só BRL, bem ativo ou vendido/baixado depois da data) sai de dentro de net_worth_with_assets para um
--    lugar só, usado pelas duas funções. Mesma regra, sem mudança de valor.
-- 2. net_worth_with_assets: create or replace com o MESMO resultado, mas chamando debt_balances UMA vez (antes eram 3:
--    dívida, crédito a receber e compromissos). Medido no volume do #182: 847 ms -> ~220 ms. Ganha também a evolução
--    de 12 meses de Análises, que chama esta função uma vez por mês.
-- 3. public.home_indicators(p_household, p_as_of): o mês é o de p_as_of; saldos e dívidas são os de p_as_of (hoje, no app).
--    Cada fonte é lida UMA vez (CTE materializada; nada de saldo em laço):
--      account_balances      -> contas em reais: ativas dos 7 tipos (070), reserva (savings ativas) e todas (patrimônio)
--      debt_balances         -> dívida total, crédito a receber, compromissos e as faturas de cartão fechadas a pagar
--      family_assets_brl     -> bens;  investment_totals -> investimentos cadastrados em reais (valor de mercado)
--      period_summary        -> o mês (cartão pela data da fatura) e os 6 meses fechados
--      income_regularity     -> renda regular recebida no mês
--    Os totais de contas e o patrimônio são os mesmos de balance_totals_by_type e net_worth_with_assets (o pgTAP 71
--    confere a igualdade); aqui eles saem de uma leitura só de account_balances/debt_balances porque chamar as três
--    funções juntas lia account_balances 2 vezes e debt_balances 2 vezes (~2× o tempo).
--    Medido no volume do #182 (10 mil lançamentos, 5,5 mil parcelas de cartão, 3 contratos): ~260 ms.
--    Única conta nova: as parcelas de contrato do mês (debt_payment_schedule de empréstimo/financiamento/consignado).
--
-- Fórmulas (decisões em docs/projeto/30 - Decisões.md e 20 - Regras do dinheiro.md):
--   available       = contas ativas em reais − faturas de cartão FECHADAS a pagar (dívida do cartão em debt_balances:
--                     cobrado no fechamento − pago). A fatura ABERTA não entra: ainda muda e não foi cobrada.
--   net_worth       = todas as contas em reais + crédito a receber + bens (arredondados ao centavo, para as parcelas
--                     do (i) somarem o total) − dívidas (= net_worth_with_assets)
--                     + investimentos em reais. Previdência e FGTS ainda não existem no app.
--   result          = period_summary.result do mês inteiro
--   savings_rate    = round(100 × result ÷ receitas, 1); sem receita = null
--   reserve_months  = round(reserva × meses ÷ despesas dos meses fechados, 1); meses = meses fechados dos últimos 6 que
--                     terminam depois da abertura da 1ª conta (família nova não divide por meses que não existiam);
--                     sem despesa ou sem mês fechado = null
--   commitment_pct  = round(100 × parcelas de contrato do mês ÷ renda regular do mês, 1); sem renda regular = null.
--                     Cartão (inclusive a compra parcelada) fica FORA: é consumo e já está nas despesas.
--   debt_total      = saldo devedor de todas as dívidas (debt_balances.debt), cartões incluídos
-- Faixas (sobre o valor JÁ arredondado, o mesmo que a tela mostra):
--   savings_band    critico < 0 ≤ atencao < 10 ≤ saudavel
--   reserve_band    critico < 3 ≤ atencao < 6 ≤ saudavel
--   commitment_band saudavel ≤ 30 < atencao ≤ 40 < critico
-- Conta em outra moeda fica fora de tudo (sem conversão). SECURITY INVOKER: a RLS do chamador decide; quem não é da
-- família recebe zero linhas.

create function private.family_assets_brl(p_household uuid, p_as_of date)
returns numeric
language sql stable security invoker set search_path = '' as $$
  select coalesce((
    select sum(v.total_value * a.household_share / 100)
      from public.family_assets a
      join lateral (
        select x.total_value from public.family_asset_valuations x
         where x.household_id = a.household_id and x.asset_id = a.id
           and x.valuation_date <= p_as_of
         order by x.valuation_date desc, x.created_at desc limit 1
      ) v on true
     where a.household_id = p_household and a.currency_code = 'BRL'
       and coalesce(a.acquired_on, a.created_at::date) <= p_as_of
       and (a.status = 'active' or (a.status in ('sold','disposed') and a.ended_on > p_as_of))
  ), 0)
$$;
revoke execute on function private.family_assets_brl(uuid, date) from public, anon;
grant execute on function private.family_assets_brl(uuid, date) to authenticated;

create or replace function public.net_worth_with_assets(p_household uuid, p_as_of date)
returns table(
  available numeric,
  debt numeric,
  credit_receivable numeric,
  family_assets_brl numeric,
  net_worth numeric,
  planned_commitments numeric
)
language sql stable security invoker set search_path = '' as $$
  select s.available, s.debt, s.cr, s.family_assets_brl,
         s.available + s.cr + s.family_assets_brl - s.debt,
         s.pc
    from (
      select
        coalesce((select sum(b.balance) from public.account_balances(p_household, p_as_of) b
                   where b.currency_code = 'BRL'), 0) as available,
        d.debt, d.cr,
        private.family_assets_brl(p_household, p_as_of) as family_assets_brl,
        d.pc
        from (select coalesce(sum(x.debt), 0) as debt, coalesce(sum(x.credit_receivable), 0) as cr,
                     coalesce(sum(x.planned_remaining), 0) as pc
                from public.debt_balances(p_household, p_as_of) x) d
    ) s
   where (select private.is_member(p_household))
$$;

create function public.home_indicators(p_household uuid, p_as_of date)
returns table (
  month_start date, month_end date,
  accounts_active numeric, card_bills_closed numeric, available numeric,
  accounts_total numeric, credit_receivable numeric, family_assets numeric, investments numeric,
  debt_total numeric, planned_commitments numeric, net_worth numeric,
  income numeric, expense numeric, result numeric, savings_rate numeric, savings_band text,
  reserve numeric, expense_closed_months numeric, closed_months integer, average_expense numeric,
  reserve_months numeric, reserve_band text,
  debt_installments numeric, regular_income numeric, commitment_pct numeric, commitment_band text
)
-- jit = off: a consulta junta várias funções de 1000 linhas estimadas e passa do jit_above_cost; no volume do #182 a
-- compilação JIT levava ~600 ms de um total de ~870 ms. Sem JIT: ~260 ms. O resultado não muda.
language sql stable security invoker set search_path = '' set jit = off as $$
  with m as (
    select date_trunc('month', p_as_of)::date as ini,
           (date_trunc('month', p_as_of) + interval '1 month - 1 day')::date as fim,
           (date_trunc('month', p_as_of) - interval '6 months')::date as ini6,
           (date_trunc('month', p_as_of) - interval '1 day')::date as fim6
  ),
  contas as materialized (
    select coalesce(sum(b.balance) filter (where b.active and b.type in
             ('checking', 'savings', 'brokerage', 'fixed_income', 'variable_income', 'crypto', 'cash')), 0) as ativas,
           coalesce(sum(b.balance) filter (where b.active and b.type = 'savings'), 0) as reserva,
           coalesce(sum(b.balance), 0) as todas
      from public.account_balances(p_household, p_as_of) b
     where b.currency_code = 'BRL'
  ),
  dividas as materialized (
    select coalesce(sum(x.debt), 0) as debt, coalesce(sum(x.credit_receivable), 0) as cr,
           coalesce(sum(x.planned_remaining), 0) as pc,
           coalesce(sum(x.debt) filter (where x.kind = 'card'), 0) as cartao_fechadas
      from public.debt_balances(p_household, p_as_of) x
  ),
  inv as materialized (
    select round(coalesce(sum(i.market_value) filter (where i.currency_code = 'BRL'), 0), 2) as brl
      from public.investment_totals(p_household, p_as_of) i
  ),
  mes as materialized (select ps.* from m cross join lateral public.period_summary(p_household, m.ini, m.fim) ps),
  seis as materialized (select ps.expense_paid from m cross join lateral public.period_summary(p_household, m.ini6, m.fim6) ps),
  renda as materialized (
    select ir.income_regular from m cross join lateral public.income_regularity(p_household, m.ini, m.fim) ir
  ),
  meses as (
    select count(*)::integer as n
      from m cross join lateral generate_series(m.ini6, m.fim6, interval '1 month') g(d)
     where (g.d + interval '1 month - 1 day')::date
           >= (select min(a.opening_date) from public.accounts a where a.household_id = p_household)
  ),
  -- parcelas de contrato que vencem no mês (paga ou a pagar; a cancelada não), de empréstimo, financiamento e
  -- consignado. A planejada de dívida arquivada não conta (a dívida saiu do dia a dia).
  parcelas as (
    select coalesce(sum(s.amount), 0) as total
      from m
      join public.debt_payment_schedule s on s.household_id = p_household and s.due_date between m.ini and m.fim
      join public.debts d on d.household_id = s.household_id and d.id = s.debt_id and d.kind in ('loan', 'financing')
     where s.status = 'paid' or (s.status = 'planned' and d.active)
  ),
  calc as (
    select m.ini, m.fim, contas.ativas, contas.reserva, contas.todas, dividas.cartao_fechadas,
           dividas.debt, dividas.cr, dividas.pc, round(private.family_assets_brl(p_household, p_as_of), 2) as bens, inv.brl as inv,
           mes.income_paid as rec, mes.expense_paid as desp, mes.result as res,
           seis.expense_paid as desp6, meses.n as meses, renda.income_regular as reg, parcelas.total as parc,
           case when mes.income_paid > 0 then round(100 * mes.result / mes.income_paid, 1) end as taxa,
           case when meses.n > 0 and seis.expense_paid > 0 then round(contas.reserva * meses.n / seis.expense_paid, 1) end as cob,
           case when renda.income_regular > 0 then round(100 * parcelas.total / renda.income_regular, 1) end as comp
      from m, contas, dividas, inv, mes, seis, renda, meses, parcelas
  )
  select c.ini, c.fim,
         c.ativas, c.cartao_fechadas, c.ativas - c.cartao_fechadas,
         c.todas, c.cr, c.bens, c.inv, c.debt, c.pc, c.todas + c.cr + c.bens - c.debt + c.inv,
         c.rec, c.desp, c.res, c.taxa,
         case when c.taxa is null then null when c.taxa < 0 then 'critico' when c.taxa < 10 then 'atencao' else 'saudavel' end,
         c.reserva, c.desp6, c.meses,
         case when c.meses > 0 then round(c.desp6 / c.meses, 2) end,
         c.cob,
         case when c.cob is null then null when c.cob < 3 then 'critico' when c.cob < 6 then 'atencao' else 'saudavel' end,
         c.parc, c.reg, c.comp,
         case when c.comp is null then null when c.comp > 40 then 'critico' when c.comp > 30 then 'atencao' else 'saudavel' end
    from calc c
   where (select private.is_member(p_household))
$$;

revoke execute on function public.home_indicators(uuid, date) from public, anon;
grant execute on function public.home_indicators(uuid, date) to authenticated;
