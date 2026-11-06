-- Tudo Azul — migration 076: o "Disponível" do Início conta só o dinheiro que dá para usar no mesmo dia
--
-- Decisão do dono (06/11/2026, #197, "sim, pode mudar o Disponível"): o indicador Disponível de public.home_indicators
-- passa a somar só as contas ATIVAS em reais dos tipos checking (conta corrente), savings (poupança/reserva), cash
-- (dinheiro/carteira) e brokerage (saldo parado na corretora), menos as faturas de cartão FECHADAS a pagar (como antes).
-- fixed_income, variable_income e crypto saem do Disponível: esse dinheiro precisa ser vendido/resgatado, leva dias e
-- pode dar perda. Continuam no Patrimônio total (contas em reais, todas), que não muda.
-- O nome dos campos do retorno não muda: `accounts_active` passa a ser "contas LÍQUIDAS ativas em reais" (os 4 tipos)
-- e `available` = accounts_active − card_bills_closed.
--
-- public.home_indicators: corpo da 075 (20261106130100_net_worth_single.sql), copiado sem mudança exceto o filtro de
-- `ativas` no CTE `contas` (7 tipos → 4). Mesma assinatura, jit = off e grants.
-- Teste: 76_available_liquid (falha sem esta migration).

-- ---------------------------------------------------------------------------
-- Indicadores do Início (corpo da 075, 20261106130100_net_worth_single.sql; só o filtro de `ativas` muda)
-- ---------------------------------------------------------------------------
create or replace function public.home_indicators(p_household uuid, p_as_of date)
returns table (
  month_start date, month_end date, closed_month_start date, closed_month_end date,
  accounts_active numeric, card_bills_closed numeric, available numeric,
  accounts_total numeric, credit_receivable numeric, family_assets numeric, investments numeric,
  debt_total numeric, planned_commitments numeric, net_worth numeric,
  income numeric, expense numeric, result numeric,
  savings_income numeric, savings_expense numeric, savings_result numeric, savings_rate numeric, savings_band text,
  reserve numeric, closed_months integer, typical_expense numeric, reserve_months numeric, reserve_band text,
  debt_installments numeric, regular_income_expected numeric, regular_income_received numeric, regular_income numeric,
  regular_income_source text, commitment_pct numeric, commitment_band text
)
-- jit = off: a consulta junta várias funções de 1000 linhas estimadas e passa do jit_above_cost; no volume do #182 a
-- compilação JIT levava ~600 ms de um total de ~870 ms. Sem JIT: ~260 ms. O resultado não muda.
language sql stable security invoker set search_path = '' set jit = off as $$
  with m as (
    select date_trunc('month', p_as_of)::date as ini,
           (date_trunc('month', p_as_of) + interval '1 month - 1 day')::date as fim,
           (date_trunc('month', p_as_of) - interval '1 month')::date as fini,
           (date_trunc('month', p_as_of) - interval '1 day')::date as ffim,
           (date_trunc('month', p_as_of) - interval '6 months')::date as ini6
  ),
  contas as materialized (
    select coalesce(sum(b.balance) filter (where b.active and b.type in
             ('checking', 'savings', 'cash', 'brokerage')), 0) as ativas,
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
  -- o mês corrente, ATÉ HOJE: period_summary do 1º dia até p_as_of (073: antes ia até o fim do mês e contava o pago com
  -- data futura), sem tirar nada
  mes as materialized (select ps.* from m cross join lateral public.period_summary(p_household, m.ini, least(p_as_of, m.fim)) ps),
  -- despesa de cada mês fechado (até 6), pela regra de sempre (private.expense_items = a despesa de period_summary),
  -- sem as categorias marcadas como "não conta como consumo" (só a marcada; a subcategoria não herda)
  desp_mes as materialized (
    select date_trunc('month', x.day)::date as mes, sum(x.amount) as total
      from m cross join lateral private.expense_items(p_household, m.ini6, m.ffim) x
      left join public.categories c on c.household_id = p_household and c.id = x.category_id
     where not coalesce(c.non_consumption, false)
     group by 1
  ),
  -- meses fechados da janela que já tinham conta aberta (família nova não conta meses que não existiam)
  meses as (
    select g.d::date as mes
      from m cross join lateral generate_series(m.ini6, m.ffim, interval '1 month') g(d)
     where (g.d + interval '1 month - 1 day')::date
           >= (select min(a.opening_date) from public.accounts a where a.household_id = p_household)
  ),
  -- despesa típica = MEDIANA dos meses contados (mês sem despesa conta como zero): um mês com quitação ou repasse
  -- grande não puxa a régua da reserva
  serie as (
    select coalesce(d.total, 0) as v, row_number() over (order by coalesce(d.total, 0)) as rn, count(*) over () as n
      from meses left join desp_mes d on d.mes = meses.mes
  ),
  tipica as (
    select coalesce(max(n), 0)::integer as n,
           round(avg(v) filter (where rn in ((n + 1) / 2, (n + 2) / 2)), 2) as mediana
      from serie
  ),
  -- receitas pagas do último mês fechado, em reais (lançamentos + crédito avulso do cartão já fechado, como
  -- income_regularity), com as marcas da categoria: eventual herda da mãe (012); "não é consumo" não herda
  renda_itens as materialized (
    select r.amount,
           coalesce(c.eventual, false) or coalesce(p.eventual, false) as eventual,
           coalesce(c.non_consumption, false) as fora
      from (
        select t.category_id, t.amount
          from m, public.transactions t
         where t.household_id = p_household and t.deleted_at is null
           and t.type = 'income' and t.status = 'paid' and t.date between m.fini and m.ffim
           and exists (select 1 from public.accounts ac where ac.household_id = t.household_id and ac.id = t.account_id
                         and ac.currency_code = 'BRL')
        union all
        select ci.category_id, ci.amount
          from m cross join lateral private.card_income_items(p_household, m.fini, m.ffim) ci
         where ci.paid
      ) r
      left join public.categories c on c.household_id = p_household and c.id = r.category_id
      left join public.categories p on p.household_id = c.household_id and p.id = c.parent_id
  ),
  renda as (
    select coalesce(sum(amount) filter (where not fora), 0) as rec,
           coalesce(sum(amount) filter (where not fora and not eventual), 0) as regular
      from renda_itens
  ),
  -- renda regular ESPERADA no mês fechado: as OCORRÊNCIAS daquele mês das recorrentes de receita ativas, em conta ativa
  -- em reais, de categoria regular (nem eventual, nem "não é consumo"):
  --   * as já geradas: o lançamento (pela chave occurrence_date no mês, fora da lixeira), com o valor e a categoria
  --     dele; pago ou planejado;
  --   * as ainda não geradas: private.account_recurrence_pending (regra viva, sem lançamento nenhum naquela chave).
  -- (074) Antes recalculava pela regra viva (recurrence_occurrences × valor da regra): depois de um "este e os próximos"
  -- com data nova, a regra começa no mês corrente e a esperada do mês fechado caía a 0; com valor novo, mudava o
  -- passado. O lançamento guarda o que aquele mês era. Ocorrência na lixeira não conta (antes contava pela regra).
  esperada_itens as materialized (
    select t.amount, t.category_id
      from m, public.transactions t
      join public.recurrences r on r.household_id = t.household_id and r.id = t.recurrence_id
                               and r.kind = 'income' and r.active
      join public.accounts ac on ac.household_id = t.household_id and ac.id = t.account_id
                             and ac.currency_code = 'BRL' and ac.active
     where t.household_id = p_household and t.recurrence_id is not null and t.type = 'income'
       and t.deleted_at is null and t.occurrence_date between m.fini and m.ffim
    union all
    select pr.amount, r.category_id
      from m cross join lateral private.account_recurrence_pending(p_household, m.fini, m.ffim) pr
      join public.recurrences r on r.household_id = p_household and r.id = pr.recurrence_id
      join public.accounts ac on ac.household_id = p_household and ac.id = pr.account_id
                             and ac.currency_code = 'BRL' and ac.active
     where pr.kind = 'income'
  ),
  esperada as (
    select coalesce(sum(e.amount), 0) as total
      from esperada_itens e
      left join public.categories c on c.household_id = p_household and c.id = e.category_id
      left join public.categories p on p.household_id = c.household_id and p.id = c.parent_id
     where not (coalesce(c.eventual, false) or coalesce(p.eventual, false))
       and not coalesce(c.non_consumption, false)
  ),
  -- parcelas de contrato que vencem no mês fechado (paga ou a pagar; a cancelada não), de empréstimo, financiamento e
  -- consignado. A planejada de dívida arquivada não conta (a dívida saiu do dia a dia).
  parcelas as (
    select coalesce(sum(s.amount), 0) as total
      from m
      join public.debt_payment_schedule s on s.household_id = p_household and s.due_date between m.fini and m.ffim
      join public.debts d on d.household_id = s.household_id and d.id = s.debt_id and d.kind in ('loan', 'financing')
     where s.status = 'paid' or (s.status = 'planned' and d.active)
  ),
  calc as (
    select m.ini, m.fim, m.fini, m.ffim, contas.ativas, contas.reserva, contas.todas, dividas.cartao_fechadas,
           dividas.debt, dividas.cr, dividas.pc, round(private.family_assets_brl(p_household, p_as_of), 2) as bens, inv.brl as inv,
           mes.income_paid as rec, mes.expense_paid as desp, mes.result as res,
           renda.rec as prec, coalesce((select d.total from desp_mes d where d.mes = m.fini), 0) as pdesp,
           tipica.n as meses, tipica.mediana as tip,
           esperada.total as esp, renda.regular as recebida, greatest(esperada.total, renda.regular) as reg,
           parcelas.total as parc
      from m, contas, dividas, inv, mes, renda, tipica, esperada, parcelas
  ),
  calc2 as (
    select c.*,
           case when c.prec > 0 then round(100 * (c.prec - c.pdesp) / c.prec, 1) end as taxa,
           case when c.tip > 0 then round(c.reserva / c.tip, 1) end as cob,
           case when c.reg > 0 then round(100 * c.parc / c.reg, 1) end as comp
      from calc c
  )
  select c.ini, c.fim, c.fini, c.ffim,
         c.ativas, c.cartao_fechadas, c.ativas - c.cartao_fechadas,
         c.todas, c.cr, c.bens, c.inv, c.debt, c.pc, c.todas + c.cr + c.bens - c.debt,
         c.rec, c.desp, c.res,
         c.prec, c.pdesp, c.prec - c.pdesp, c.taxa,
         case when c.taxa is null then null when c.taxa < 0 then 'critico' when c.taxa < 10 then 'atencao' else 'saudavel' end,
         c.reserva, c.meses, c.tip, c.cob,
         case when c.cob is null then null when c.cob < 3 then 'critico' when c.cob < 6 then 'atencao' else 'saudavel' end,
         c.parc, c.esp, c.recebida, c.reg,
         case when c.esp > c.recebida then 'recurring' else 'received' end,
         c.comp,
         case when c.comp is null then null when c.comp > 40 then 'critico' when c.comp > 30 then 'atencao' else 'saudavel' end
    from calc2 c
   where (select private.is_member(p_household))
$$;

revoke execute on function public.home_indicators(uuid, date) from public, anon;
grant execute on function public.home_indicators(uuid, date) to authenticated;
