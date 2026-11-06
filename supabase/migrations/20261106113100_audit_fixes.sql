-- Tudo Azul — migration 073: correções da auditoria de dinheiro de 06/11/2026 (#191)
--
-- Três achados, todos reproduzidos no banco local antes da correção (teste 74_audit_fixes falha sem esta migration).
-- Nenhuma assinatura muda (create or replace; os grants ficam). Cada função parte EXATAMENTE do corpo em vigor:
--
-- C1 (crítico) public.cash_flow_series — corpo da 069 (20261105140100_projected_with_pending.sql, item c).
--    Relatórios › Entradas x Saídas: a coluna Saldo era "saldo de abertura + resultado acumulado" (padrão da 067,
--    20261105120100_cash_flow_series_rapida.sql). Mas o saldo das contas (account_balances, base de
--    balance_totals_projected) também muda por movimentos que NÃO são entrada nem saída nesta tela:
--      * crédito de empréstimo/financiamento na conta (debt_events.kind = 'disbursement', +);
--      * saldo inicial de conta em reais ABERTA dentro do período (opening_date em [p_from, p_to]): o saldo de abertura
--        (em p_from − 1) ainda não a conhecia.
--    Conferido em account_balances/account_movements: os demais eventos com conta já estão no resultado (payment e
--    extra_principal do cartão e do empréstimo/financiamento — principal, 046 —, interest, fee, refund_cash do cartão);
--    refund_cash de empréstimo não acontece (debt_chk só aceita devolução com crédito a receber, e empréstimo não fica
--    com crédito); payroll_payment, charge, credit e income_credit não têm conta; os lançamentos já estão; transferência
--    entre contas em reais soma zero no total. Nos previstos, a
--    parcela de contrato de dívida arquivada não existe (debt_archive cancela as planejadas, 045), então
--    loan_schedule_planned e balance_totals_projected leem o mesmo.
--    Exemplo do achado: Banco 1.000 desde 01/08; crédito de empréstimo 5.000 em 10/09; conta nova em 15/09 com 2.000;
--    pagamento do empréstimo 1.000 em 25/09 → a série semanal de setembro terminava em 0,00; o certo é 7.000
--    (= balance_totals_projected em 30/09).
--    Correção: essas variações entram nos itens com tipo 'saldo' (com os mesmos filtros de conta, membro e moeda dos
--    outros itens) e somam SÓ no acumulado do closing_balance. Entradas, saídas e resultado NÃO mudam (o crédito de
--    empréstimo continuar fora de Entradas x Saídas é decisão do dono; no Relatório › Contas ele é entrada — ver 40).
--    Desempenho: continua UMA chamada de balance_totals_projected; as variações são duas leituras pequenas
--    (debt_events da família no período, accounts da família), nada por linha.
--
-- I1 Recorrente em conta ARQUIVADA continuava contando (a geração e account_recurrence_pending já pulam a conta inativa
--    e o destino inativo da transferência):
--    a. public.recurrence_summary — corpo da 063 (20261105080100_recurrence_summary.sql): regra de conta só entra com a
--       conta ativa (e, na transferência, o destino ativo), como recurrence_materialize; assinatura de cartão não muda.
--    b. public.home_indicators — corpo da 071 (20261106100100_home_indicators.sql): a renda regular ESPERADA só lê
--       recorrentes de receita em conta ativa.
-- I2 public.home_indicators (o mesmo create or replace de I1b): "Resultado do mês — Até hoje" chamava
--    period_summary(início, FIM do mês) e contava receita/despesa PAGA com data depois de hoje. Agora vai até
--    least(p_as_of, fim do mês). Os outros campos do mês corrente: os saldos (contas, dívidas, bens, investimentos) já
--    eram em p_as_of; poupança, reserva e comprometimento são de meses fechados. Nada mais muda.
-- Teste: 74_audit_fixes.

-- ---------------------------------------------------------------------------
-- C1. Entradas x Saídas (corpo da 069; só os itens 'saldo' e o acumulado do saldo mudam)
-- ---------------------------------------------------------------------------
create or replace function public.cash_flow_series(
  p_household uuid, p_from date, p_to date, p_step text default 'day',
  p_accounts uuid[] default null, p_member uuid default null, p_include_planned boolean default false)
returns table (period_start date, period_end date, income numeric, expense numeric, result numeric,
               closing_balance numeric, total_income numeric, total_expense numeric, total_result numeric)
language plpgsql stable security invoker set search_path = '' as $$
begin
  if p_step is null or p_step not in ('day', 'week', 'month', 'total') then
    raise exception 'divisão inválida: use day, week, month ou total' using errcode = '22023';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 3660 or (p_step = 'day' and p_to - p_from > 366) then
    raise exception 'período inválido (dia: até 366 dias; semana, mês e acumulado: até 10 anos)' using errcode = '22023';
  end if;
  return query
  with itens as (
    -- lançamentos de contas em reais (igual a cash_flow_report)
    select t.date as dia, t.type as tipo, t.amount as valor
      from public.transactions t
     where t.household_id = p_household and t.deleted_at is null and t.type in ('income', 'expense')
       and t.date between p_from and p_to
       and (t.status = 'paid' or (p_include_planned and t.status = 'planned'))
       and (p_accounts is null or t.account_id = any(p_accounts))
       and (p_member is null or t.created_by = p_member)
       and exists (select 1 from public.accounts ac where ac.household_id = t.household_id and ac.id = t.account_id
                     and ac.currency_code = 'BRL')
    union all
    -- juros e tarifas (de qualquer dívida: saem de uma conta na data deles); compra/estorno só de dívida que não é cartão
    select e.date, 'expense', case when e.kind = 'credit' then -e.amount else e.amount end
      from public.debt_events e
      join public.debts d on d.household_id = e.household_id and d.id = e.debt_id
     where e.household_id = p_household and e.voided_at is null
       and (e.kind in ('interest', 'fee') or (e.kind in ('charge', 'credit') and d.kind <> 'card'))
       and e.date between p_from and p_to
       and (p_accounts is null or e.account_id = any(p_accounts))
       and (p_member is null or e.created_by = p_member)
    union all
    -- cartão em caixa: o pagamento da fatura (e a antecipação) sai da conta na data dele; a devolução em dinheiro volta
    select e.date, 'expense', case when e.kind = 'refund_cash' then -e.amount else e.amount end
      from public.debt_events e
      join public.debts d on d.household_id = e.household_id and d.id = e.debt_id and d.kind = 'card'
     where e.household_id = p_household and e.voided_at is null
       and e.kind in ('payment', 'extra_principal', 'refund_cash')
       and e.date between p_from and p_to
       and (p_accounts is null or e.account_id = any(p_accounts))
       and (p_member is null or e.created_by = p_member)
    union all
    -- não pagos: o que falta pagar de cada fatura, no vencimento (a mesma base de balance_totals_projected)
    select m.due_date, 'expense', greatest(m.total - m.paid, 0)
      from public.debts d
     cross join lateral public.card_months(d.id) m
     where p_include_planned and p_member is null
       and d.household_id = p_household and d.kind = 'card'
       and m.due_date between p_from and p_to and m.total > m.paid
       and (p_accounts is null or d.pay_account_id = any(p_accounts))
    union all
    -- não pagos (068): as assinaturas previstas de cada fatura (ainda sem parcela), no vencimento dela
    select pc.due_date, 'expense', pc.amount
      from private.card_pending_by_due(p_household, p_from, p_to) pc
     where p_include_planned and p_member is null
       and (p_accounts is null or pc.pay_account_id = any(p_accounts))
    union all
    -- não pagos (068): lançamentos fixos de conta em reais ainda não gerados, na data da ocorrência
    select pr.occurrence_date, pr.kind, pr.amount
      from private.account_recurrence_pending(p_household, p_from, p_to) pr
     where p_include_planned and pr.kind in ('income', 'expense')
       and (p_accounts is null or pr.account_id = any(p_accounts))
       and (p_member is null or pr.created_by = p_member)
       and exists (select 1 from public.accounts ac where ac.household_id = p_household and ac.id = pr.account_id
                     and ac.currency_code = 'BRL')
    union all
    -- principal pago de empréstimo/financiamento (migration 046)
    select l.day, 'expense', l.amount
      from private.loan_principal_items(p_household, p_from, p_to) l
     where (p_accounts is null or l.account_id = any(p_accounts))
       and (p_member is null or l.created_by = p_member)
    union all
    -- parcela planejada do contrato (ainda não baixada)
    select s.day, 'expense', s.amount
      from private.loan_schedule_planned(p_household, p_from, p_to) s
     where p_include_planned and p_member is null
       and (p_accounts is null or s.account_id = any(p_accounts))
    union all
    -- (073) variações SÓ de saldo (tipo 'saldo': não são entrada nem saída, só entram no acumulado do Saldo).
    -- Crédito de empréstimo/financiamento na conta, como account_balances (conta em reais, já aberta na data).
    select e.date, 'saldo', e.amount
      from public.debt_events e
     where e.household_id = p_household and e.voided_at is null and e.kind = 'disbursement'
       and e.date between p_from and p_to
       and (p_accounts is null or e.account_id = any(p_accounts))
       and (p_member is null or e.created_by = p_member)
       and exists (select 1 from public.accounts ac where ac.household_id = e.household_id and ac.id = e.account_id
                     and ac.currency_code = 'BRL' and ac.opening_date <= e.date)
    union all
    -- (073) saldo inicial de conta em reais aberta no período, na data de abertura (o saldo em p_from − 1 não a conhece).
    -- O saldo inicial não é de um membro: com p_member não entra (e o Saldo já é nulo com filtro).
    select a.opening_date, 'saldo', a.initial_balance
      from public.accounts a
     where a.household_id = p_household and a.currency_code = 'BRL'
       and a.opening_date between p_from and p_to
       and (p_accounts is null or a.id = any(p_accounts))
       and p_member is null
  ), baldes as (
    select distinct (case p_step when 'day' then g::date when 'week' then date_trunc('week', g)::date
                                 when 'month' then date_trunc('month', g)::date else p_from end) as ini
      from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g
  ), linhas as (
    select b.ini,
           case p_step when 'day' then b.ini when 'week' then b.ini + 6
                       when 'month' then ((b.ini + interval '1 month')::date - 1) else p_to end as fim,
           coalesce(sum(x.valor) filter (where x.tipo = 'income'), 0) as ent,
           coalesce(sum(x.valor) filter (where x.tipo = 'expense'), 0) as sai,
           coalesce(sum(x.valor) filter (where x.tipo = 'saldo'), 0) as aj
      from baldes b
      left join itens x on (case p_step when 'day' then x.dia when 'week' then date_trunc('week', x.dia)::date
                                        when 'month' then date_trunc('month', x.dia)::date else p_from end) = b.ini
     group by b.ini
  ), inicio as (
    -- saldo de abertura (padrão da 067): UMA chamada de balance_totals_projected, em p_from − 1. Desde a 069 ela já
    -- desconta as assinaturas previstas e soma os fixos não gerados até ali (com não pagos); os do período estão nos
    -- itens acima e entram no acumulado, com as variações só de saldo (073).
    select case when p_accounts is null and p_member is null then
             (select bt.total from public.balance_totals_projected(p_household, p_from - 1, p_include_planned) bt)
           end as saldo
  )
  select l.ini, l.fim, l.ent, l.sai, l.ent - l.sai,
         (select i.saldo from inicio i) + sum(l.ent - l.sai + l.aj) over (order by l.ini rows between unbounded preceding and current row),
         sum(l.ent) over (), sum(l.sai) over (), sum(l.ent - l.sai) over ()
    from linhas l
   where (select private.is_member(p_household))
   order by l.ini;
end $$;

-- ---------------------------------------------------------------------------
-- I1a. Resumo dos recorrentes (corpo da 063; só o filtro de conta ativa muda)
-- ---------------------------------------------------------------------------
create or replace function public.recurrence_summary(p_household uuid)
returns table (grouping_level text, medium text, target_id uuid, target_name text, kind text, frequency text,
               item_count integer, total_per_occurrence numeric, total_monthly numeric)
language sql stable security invoker set search_path = '' as $$
  with regras as (
    select case when r.kind = 'card' then 'card' else 'account' end as medium,
           coalesce(r.debt_id, r.account_id) as target_id,
           coalesce(d.name, a.name) as target_name,
           case when r.kind = 'card' then 'expense' else r.kind end as kind,
           case when r.freq_unit = 'day' then 'daily'
                when r.freq_unit = 'week' then 'weekly'
                when r.freq_every = 1 then 'monthly'
                when r.freq_every = 2 then 'bimonthly'
                when r.freq_every = 3 then 'quarterly'
                when r.freq_every = 6 then 'semiannual'
                when r.freq_every = 12 then 'yearly'
                else 'custom' end as frequency,
           r.amount,
           round(case r.freq_unit
                   when 'month' then r.amount / r.freq_every
                   when 'week'  then r.amount * 52 / (12 * r.freq_every)
                   else              r.amount * 365 / (12 * r.freq_every) end, 2) as monthly
      from public.recurrences r
      left join public.accounts a on a.household_id = r.household_id and a.id = r.account_id
      left join public.accounts ad on ad.household_id = r.household_id and ad.id = r.destination_account_id
      left join public.debts d on d.household_id = r.household_id and d.id = r.debt_id
     where r.household_id = p_household
       and (select private.is_member(p_household))
       and r.active
       and (r.end_date is null or r.end_date >= (now() at time zone 'America/Sao_Paulo')::date)
       and (r.kind = 'card' or a.currency_code = 'BRL')
       -- (073) conta arquivada (ou destino arquivado da transferência) não gera ocorrência: fica fora, como em
       -- recurrence_materialize e account_recurrence_pending
       and (r.kind = 'card' or (a.active and (r.destination_account_id is null or ad.active)))
  ), agregado as (
    select grouping(g.medium, g.target_id, g.target_name, g.kind, g.frequency) as bits,
           g.medium, g.target_id, g.target_name, g.kind, g.frequency,
           count(*)::integer as item_count, sum(g.amount) as total_per_occurrence, sum(g.monthly) as total_monthly
      from regras g
     group by grouping sets (
       (g.medium, g.target_id, g.target_name, g.kind, g.frequency),
       (g.medium, g.target_id, g.target_name, g.kind),
       (g.medium, g.kind, g.frequency),
       (g.medium, g.kind),
       (g.kind, g.frequency))
  )
  -- bits de grouping(): medium 16, target_id 8, target_name 4, kind 2, frequency 1
  select case x.bits when 0 then 'detail' when 1 then 'target' when 12 then 'frequency' when 13 then 'medium'
                     else 'frequency_all' end,
         x.medium, x.target_id, x.target_name, x.kind, x.frequency, x.item_count, x.total_per_occurrence, x.total_monthly
    from agregado x
   order by x.bits, x.medium, x.kind,
            array_position(array['daily','weekly','monthly','bimonthly','quarterly','semiannual','yearly','custom'], x.frequency),
            x.target_name
$$;

revoke execute on function public.recurrence_summary(uuid) from public, anon;
grant execute on function public.recurrence_summary(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- I1b + I2. Indicadores do Início (corpo da 071; só a conta ativa da renda esperada e o "até hoje" do mês mudam)
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
  -- renda regular ESPERADA no mês fechado: as ocorrências das recorrentes de receita ativas, em conta em reais,
  -- de categoria regular (nem eventual, nem "não é consumo")
  esperada as (
    select coalesce(sum(r.amount), 0) as total
      from m
      join public.recurrences r on r.household_id = p_household and r.kind = 'income' and r.active
      -- (073) só conta ativa: a recorrente em conta arquivada não gera mais
      join public.accounts ac on ac.household_id = r.household_id and ac.id = r.account_id and ac.currency_code = 'BRL'
                             and ac.active
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
