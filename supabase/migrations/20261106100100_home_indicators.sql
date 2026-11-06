-- Tudo Azul — migration 071: os 7 indicadores do topo do Início numa chamada só (#188, pedido do dono de 06/11/2026:
-- "quanto tenho, quanto entra e sai, quanto devo, e se estou avançando").
--
-- 1. private.family_assets_brl(p_household, p_as_of): a regra dos bens (avaliação mais recente até a data × participação
--    da família, só BRL, bem ativo ou vendido/baixado depois da data) sai de dentro de net_worth_with_assets para um
--    lugar só, usado pelas duas funções. Mesma regra, sem mudança de valor.
-- 2. net_worth_with_assets: create or replace com o MESMO resultado, mas chamando debt_balances UMA vez (antes eram 3:
--    dívida, crédito a receber e compromissos). Medido no volume do #182: 847 ms -> ~220 ms. Ganha também a evolução
--    de 12 meses de Análises, que chama esta função uma vez por mês.
-- 3. categories.non_consumption ("não conta como consumo", pedido do dono de 06/11/2026): marca, categoria por categoria,
--    os movimentos que não são gasto nem renda do dia a dia (quitação, dinheiro de empréstimo recebido, repasse entre
--    familiares). Padrão false; nenhuma categoria vem marcada. Vale SÓ para a categoria marcada: a subcategoria NÃO
--    herda ("numa categoria-mãe pode haver lançamentos de quitação que não são consumo, enquanto as subcategorias dela
--    — parcelas mensais de empréstimo, financiamento — são consumo de verdade"). "Sem categoria" não pode ser marcada.
--    Só os indicadores do Início usam a marca; period_summary, Relatórios, Análises e orçamento NÃO mudam (pendência).
--    Quem altera: como eventual e budget_group, grant de UPDATE da coluna para authenticated + RLS categories_update
--    (is_member); não entra no INSERT (nasce false).
-- 4. public.home_indicators(p_household, p_as_of): os 7 indicadores. Cada fonte é lida UMA vez (nada em laço):
--      account_balances      -> contas em reais: ativas dos 7 tipos (070), reserva (savings ativas) e todas (patrimônio)
--      debt_balances         -> dívida total, crédito a receber, compromissos e as faturas de cartão fechadas a pagar
--      family_assets_brl     -> bens;  investment_totals -> investimentos cadastrados em reais (valor de mercado)
--      period_summary        -> o mês corrente até hoje (resultado do mês, o mesmo do cabeçalho)
--      private.expense_items -> despesa de cada um dos 6 meses fechados (a mesma despesa de period_summary)
--      transactions + card_income_items -> receitas do último mês fechado (a mesma receita de period_summary)
--      recurrences + recurrence_occurrences -> renda regular esperada do último mês fechado
--    Os totais de contas e o patrimônio são os mesmos de balance_totals_by_type e net_worth_with_assets; sem marca,
--    a receita/despesa e a renda regular do mês fechado são as de period_summary e income_regularity (o pgTAP 71
--    confere as igualdades).
--
-- Fórmulas (decisões em docs/projeto/30 - Decisões.md e 20 - Regras do dinheiro.md):
--   available       = contas ativas em reais − faturas de cartão FECHADAS a pagar. A fatura ABERTA não entra.
--   net_worth       = todas as contas em reais + crédito a receber + bens (arredondados ao centavo) − dívidas
--                     (= net_worth_with_assets) + investimentos em reais. Previdência e FGTS ainda não existem no app.
--   result          = period_summary.result do mês corrente (até hoje)
--   savings_rate    = do ÚLTIMO MÊS FECHADO: round(100 × (receitas − despesas) ÷ receitas, 1), sem as categorias "não é
--                     consumo"; sem receita = null. (No mês corrente, com 6 dias e sem o salário, dava 71,6% em produção.)
--   reserve_months  = round(reserva ÷ despesa típica, 1); despesa típica = MEDIANA da despesa mensal dos meses fechados
--                     (até 6, só os que terminam depois da abertura da 1ª conta; mês sem despesa = 0), sem as categorias
--                     "não é consumo"; sem despesa típica = null. (A média com empréstimo, quitação e repasses dava
--                     R$ 52 mil/mês e reserva 0,0 em produção.)
--   commitment_pct  = do ÚLTIMO MÊS FECHADO: round(100 × parcelas de contrato que venceram nele ÷ renda regular, 1);
--                     renda regular = a MAIOR entre a esperada (recorrentes de receita regular) e a recebida (receita
--                     paga fora das categorias eventuais e "não é consumo"); regular_income_source diz qual
--                     ('recurring' | 'received'). Sem renda regular = null. Cartão (inclusive a compra parcelada) fica FORA.
--   debt_total      = saldo devedor de todas as dívidas (debt_balances.debt), cartões incluídos
-- Faixas (sobre o valor JÁ arredondado, o mesmo que a tela mostra):
--   savings_band    critico < 0 ≤ atencao < 10 ≤ saudavel
--   reserve_band    critico < 3 ≤ atencao < 6 ≤ saudavel
--   commitment_band saudavel ≤ 30 < atencao ≤ 40 < critico
-- Conta em outra moeda fica fora de tudo (sem conversão). SECURITY INVOKER: a RLS do chamador decide; quem não é da
-- família recebe zero linhas.

alter table public.categories
  add column non_consumption boolean not null default false,
  add constraint categories_non_consumption_not_system check (not non_consumption or system_key is null);
grant update (non_consumption) on public.categories to authenticated;

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
  -- o mês corrente, até hoje (o mesmo do cabeçalho): period_summary, sem tirar nada
  mes as materialized (select ps.* from m cross join lateral public.period_summary(p_household, m.ini, m.fim) ps),
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
  -- renda regular ESPERADA no mês fechado: as ocorrências das recorrentes de receita ativas, em conta em reais,
  -- de categoria regular (nem eventual, nem "não é consumo")
  esperada as (
    select coalesce(sum(r.amount), 0) as total
      from m
      join public.recurrences r on r.household_id = p_household and r.kind = 'income' and r.active
      join public.accounts ac on ac.household_id = r.household_id and ac.id = r.account_id and ac.currency_code = 'BRL'
      left join public.categories c on c.household_id = r.household_id and c.id = r.category_id
      left join public.categories p on p.household_id = c.household_id and p.id = c.parent_id
      cross join lateral private.recurrence_occurrences(r, m.fini, m.ffim) o
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
         c.todas, c.cr, c.bens, c.inv, c.debt, c.pc, c.todas + c.cr + c.bens - c.debt + c.inv,
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
