-- Tudo Azul — migration 100: conta interna "Carteira de investimentos" (comprar investimento tira o dinheiro da conta
-- sem virar despesa; conta antiga de investimento pode ser "movida para a carteira").
--
-- Decisão do dono (10/11/2026). Desde a 099 (20261110080000_investment_liquidity.sql) o patrimônio soma a carteira em
-- reais. Então o dinheiro que sai da conta numa compra NÃO pode cair numa conta comum (contaria duas vezes: na conta e
-- no ativo). Solução: uma conta INTERNA por família, "Carteira de investimentos" (accounts.system_role =
-- 'investment_portfolio'), que só recebe/devolve transferências das operações e fica FORA de todas as somas de saldo.
-- Assim: compra com conta = transferência conta → Carteira (sai da conta, entra no ativo; patrimônio igual); venda com
-- conta = transferência Carteira → conta pelo líquido. Transferência não é receita nem despesa (period_summary e
-- relatórios de caixa não mudam).
--
-- O que esta migration acrescenta ou troca (nada é alterado nas migrations anteriores):
--   1. accounts.system_role ('investment_portfolio' ou nulo) + índice único parcial (uma Carteira por família).
--      accounts_name_uq passa a valer só para contas comuns (a Carteira não colide com uma conta da família que já se
--      chame "Carteira de investimentos"). O cliente não tem grant na coluna nova (nem insert nem update).
--   2. private.investment_portfolio_account(p_household): devolve a Carteira, criando sob demanda (insert ... on
--      conflict, à prova de corrida). Tipo brokerage, BRL, saldo inicial 0, ativa, abertura 2000-01-01. A abertura é a
--      menor data aceita pelo banco (CHECK de accounts.opening_date e de investment_operations.operation_date):
--      transferência não pode ser anterior à abertura de nenhuma das duas contas (transactions_guard, decisão 8), e uma
--      operação pode ter qualquer data desde 2000-01-01, inclusive de uma conta criada depois com abertura antiga.
--      O único leitor de min(opening_date) é home_indicators (meses da reserva), que passa a ignorar a Carteira (item 5).
--   3. investment_operations.transaction_id: a transferência da operação (FK simples para transactions, como
--      investment_distributions — transactions não tem chave única (household_id, id) para FK composta; a família é
--      garantida pela função que grava). on delete set null: só o "excluir transações" (clear_household_transactions)
--      apaga o lançamento e mantém a operação. Único: uma operação por transferência.
--   4. FORA DE TODAS AS SOMAS — public.account_balances (corpo da 055, 20261104235100_account_currency.sql; nenhuma
--      definição mais nova) deixa de devolver a Carteira. Herdam sem ser recriadas (todas leem account_balances):
--      account_balances_projected, account_balances_daily, balance_totals, balance_totals_by_type,
--      balance_totals_by_currency, balance_totals_projected (e daily_digest, que a usa), net_worth,
--      net_worth_with_assets, home_indicators (contas/disponível/patrimônio), get_home_decision_month (via
--      home_indicators), reconcile_account (a Carteira não tem saldo para conferir: recusa).
--      Leitores de saldo que NÃO passam por account_balances, um a um (procurado no prosrc de public/private):
--        * home_indicators: o CTE `meses` usa min(opening_date) de TODAS as contas; a Carteira (2000-01-01) mudaria os
--          meses contados da reserva. Create or replace do corpo da 099 com `and a.system_role is null` ali. Só isso.
--        * account_flow_report (Relatórios › Contas): lista as contas ativas em reais direto de accounts; a Carteira
--          apareceria como linha e o total fecharia com ela. Create or replace do corpo da 069
--          (20261105140100_projected_with_pending.sql) com `and a.system_role is null` em `contas`. Com isso o total
--          de transferências do período deixa de ser zero quando há aporte/resgate (o dinheiro saiu das contas).
--        * cash_flow_series (Entradas x Saídas, coluna Saldo): Saldo = abertura (balance_totals_projected, já sem a
--          Carteira) + entradas − saídas + itens 'saldo'. Transferência não é entrada nem saída, mas a de aporte/resgate
--          muda o total das contas. Create or replace do corpo da 073 (20261106113100_audit_fixes.sql) com um item
--          'saldo' novo: − aporte / + resgate (na data). Sem isso o Saldo do fim ficaria maior que o das contas.
--        * account_movements (extrato de UMA conta), reconcile_account, reconciliation_undo: por conta; o lado comum da
--          transferência aparece no extrato da conta de origem como qualquer transferência. Não mudam.
--        * cash_flow_report, period_summary(_by_currency), expense_items, budget_*, month_projection, home_alerts,
--          income_regularity, dashboard_commitment_matrix, recurrence_summary, daily_digest: só receita/despesa (ou
--          saldo via balance_totals_projected). Transferência fica fora. Não mudam.
--   5. Trava: lançamento que toca a Carteira (origem ou destino, antes ou depois) não é criado, editado, enviado/
--      restaurado da lixeira nem apagado, por cliente nem por outra RPC; só pelas funções desta migration, que ligam a
--      marca de sessão app.investment_portfolio = <família> (set_config local, mesmo padrão de app.card_edit e
--      app.reserve_erase) e a desligam no fim. Exceções: mudança só em colunas que o cliente não edita
--      (reconciliation_id da conferência da conta comum, updated_at) e o apagamento da família inteira
--      (app.reserve_erase = família, ligado por reset_household e delete_household). A Carteira em si não é editada,
--      arquivada nem excluída (accounts); e nenhuma recorrente, dívida/cartão, evento de dívida nem conferência pode
--      usar a Carteira (o dinheiro sumiria de todas as somas sem passar por um ativo).
--   6. investment_operation_record (corpo da 043, 20261103150100_investment_operation_void.sql): p_account NO FIM
--      (drop + create; ninguém depende dela no catálogo; grants refeitos). Sem conta: idêntica. Com conta: ativo em
--      reais e conta comum ativa em reais da mesma família; compra = transferência conta → Carteira de
--      round(qtd × preço + tarifas, 2), "Aporte: <ativo>"; venda = Carteira → conta de round(qtd × preço − tarifas, 2)
--      (≤ 0: recusa), "Resgate: <ativo>". Pago, na data da operação, sem categoria.
--   7. investment_operation_void (corpo da 043): anular operação com transferência manda a transferência para a lixeira
--      na mesma transação. investment_asset_purge (corpo da 050): idem para as operações não anuladas do ativo (sem
--      isso o dinheiro sairia da conta e o ativo sumiria do patrimônio).
--   8. clear_household_transactions (corpo de 20261107190000_user_preferences_account_exit.sql): liga a marca para
--      poder apagar também as transferências da Carteira (as operações ficam, com transaction_id nulo).
--   9. public.account_move_to_portfolio(p_account, p_name, p_class, p_liquidity, p_subclass, p_date): move o saldo de
--      uma conta comum para um ativo novo da carteira (compra de 1 unidade ao preço = saldo, com a transferência) e
--      arquiva a conta. Patrimônio igual antes e depois.
-- Códigos de erro: 42501 não autenticado / conta ou ativo de outra família ou inexistente / mexer na Carteira;
-- 22023 conta inválida (arquivada, outra moeda, a própria Carteira), ativo fora de reais com conta, valor líquido ≤ 0,
-- saldo não positivo ou com movimento depois da data.
-- Teste: 94_investment_portfolio_account (falha sem esta migration).

-- ---------------------------------------------------------------------------
-- 1. Coluna e unicidade
-- ---------------------------------------------------------------------------
alter table public.accounts
  add column system_role text check (system_role in ('investment_portfolio'));

create unique index accounts_investment_portfolio_uq on public.accounts (household_id)
  where system_role = 'investment_portfolio';

-- o nome continua único entre as contas da família; a conta interna não entra (mesmo nome do índice da 001)
drop index public.accounts_name_uq;
create unique index accounts_name_uq on public.accounts (household_id, lower(btrim(name))) where system_role is null;

-- ---------------------------------------------------------------------------
-- 2. A Carteira da família (sob demanda)
-- ---------------------------------------------------------------------------
-- Só é chamada de dentro das RPCs desta migration (SECURITY DEFINER), que já conferiram a família.
create function private.investment_portfolio_account(p_household uuid) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid;
begin
  if p_household is null or not private.is_member(p_household) then
    raise exception 'família não autorizada' using errcode = '42501';
  end if;
  select a.id into v_id from public.accounts a
   where a.household_id = p_household and a.system_role = 'investment_portfolio';
  if found then
    return v_id;
  end if;
  insert into public.accounts (household_id, name, type, initial_balance, opening_date, active, currency_code, system_role)
  values (p_household, 'Carteira de investimentos', 'brokerage', 0, date '2000-01-01', true, 'BRL', 'investment_portfolio')
  on conflict (household_id) where system_role = 'investment_portfolio' do nothing
  returning id into v_id;
  if v_id is null then  -- outra transação criou ao mesmo tempo
    select a.id into v_id from public.accounts a
     where a.household_id = p_household and a.system_role = 'investment_portfolio';
  end if;
  return v_id;
end $$;
revoke execute on function private.investment_portfolio_account(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Vínculo da operação com a transferência
-- ---------------------------------------------------------------------------
alter table public.investment_operations
  add column transaction_id uuid references public.transactions (id) on delete set null;
create unique index investment_operations_transaction_uq on public.investment_operations (transaction_id)
  where transaction_id is not null;

-- ---------------------------------------------------------------------------
-- 4. Saldos: a Carteira fica fora (create or replace da 055; só o filtro `a.system_role is null` é novo)
-- ---------------------------------------------------------------------------
create or replace function public.account_balances(p_household uuid, p_as_of date)
returns table (account_id uuid, name text, type text, active boolean, balance numeric, currency_code text)
language sql stable security invoker set search_path = '' as $$
  select a.id, a.name, a.type, a.active,
         a.initial_balance + coalesce(sum(case
           when t.type = 'income'   and t.account_id = a.id             then  t.amount
           when t.type = 'expense'  and t.account_id = a.id             then -t.amount
           when t.type = 'transfer' and t.account_id = a.id             then -t.amount
           when t.type = 'transfer' and t.destination_account_id = a.id then  t.amount
         end), 0)
         + coalesce((
           select sum(case when e.kind in ('disbursement', 'refund_cash') then e.amount else -e.amount end)
             from public.debt_events e
            where e.household_id = a.household_id and e.account_id = a.id and e.voided_at is null
              and e.date >= a.opening_date and e.date <= p_as_of), 0),
         a.currency_code
    from public.accounts a
    left join public.transactions t
      on t.household_id = a.household_id
     and t.deleted_at is null
     and t.status = 'paid'
     and t.date >= a.opening_date
     and t.date <= p_as_of
     and (t.account_id = a.id or t.destination_account_id = a.id)
   where a.household_id = p_household and a.opening_date <= p_as_of
     -- (100) a Carteira de investimentos é interna: o valor dela já está nos ativos (patrimônio da 099)
     and a.system_role is null
   group by a.id, a.name, a.type, a.active, a.initial_balance, a.currency_code
$$;

-- ---------------------------------------------------------------------------
-- 4a. Indicadores do Início (corpo da 099, 20261110080000_investment_liquidity.sql; só o CTE `meses` muda). Mesma
-- assinatura e retorno: create or replace mantém grants e as opções (jit = off).
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
  regular_income_source text, commitment_pct numeric, commitment_band text,
  investments_liquid numeric, investments_restricted numeric
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
  -- (099) a carteira em reais, total e por liquidez, numa chamada só; líquido = total − restrito, para a soma das duas
  -- partes ser sempre o total
  inv as materialized (
    select t.brl, t.restr, t.brl - t.restr as liq
      from (select round(coalesce(sum(i.market_value), 0), 2) as brl,
                   round(coalesce(sum(i.market_value) filter (where i.liquidity = 'restricted'), 0), 2) as restr
              from public.investment_liquidity_totals(p_household, p_as_of) i
             where i.currency_code = 'BRL') t
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
  -- (100) a Carteira de investimentos (conta interna, aberta em 2000-01-01) não conta
  meses as (
    select g.d::date as mes
      from m cross join lateral generate_series(m.ini6, m.ffim, interval '1 month') g(d)
     where (g.d + interval '1 month - 1 day')::date
           >= (select min(a.opening_date) from public.accounts a where a.household_id = p_household and a.system_role is null)
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
           inv.liq as inv_liq, inv.restr as inv_restr,
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
         c.todas, c.cr, c.bens, c.inv, c.debt, c.pc, c.todas + c.cr + c.bens + c.inv - c.debt,
         c.rec, c.desp, c.res,
         c.prec, c.pdesp, c.prec - c.pdesp, c.taxa,
         case when c.taxa is null then null when c.taxa < 0 then 'critico' when c.taxa < 10 then 'atencao' else 'saudavel' end,
         c.reserva, c.meses, c.tip, c.cob,
         case when c.cob is null then null when c.cob < 3 then 'critico' when c.cob < 6 then 'atencao' else 'saudavel' end,
         c.parc, c.esp, c.recebida, c.reg,
         case when c.esp > c.recebida then 'recurring' else 'received' end,
         c.comp,
         case when c.comp is null then null when c.comp > 40 then 'critico' when c.comp > 30 then 'atencao' else 'saudavel' end,
         c.inv_liq, c.inv_restr
    from calc2 c
   where (select private.is_member(p_household))
$$;

-- ---------------------------------------------------------------------------
-- 4b. Entradas x Saídas (corpo da 073, 20261106113100_audit_fixes.sql; a Carteira fora do saldo inicial e o item
-- 'saldo' novo de aporte/resgate)
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
       and a.system_role is null  -- (100) a Carteira não é conta do saldo
    union all
    -- (100) aporte (conta → Carteira de investimentos: −) e resgate (Carteira → conta: +). Transferência não é entrada
    -- nem saída, mas a Carteira está fora do saldo das contas: só entra no acumulado do Saldo, como account_balances.
    select t.date, 'saldo', case when t.destination_account_id = c.id then -t.amount else t.amount end
      from public.transactions t
      join public.accounts c on c.household_id = t.household_id and c.system_role = 'investment_portfolio'
                            and (c.id = t.account_id or c.id = t.destination_account_id)
     where t.household_id = p_household and t.deleted_at is null and t.type = 'transfer' and t.status = 'paid'
       and t.date between p_from and p_to
       and (p_accounts is null
            or (case when t.destination_account_id = c.id then t.account_id else t.destination_account_id end) = any(p_accounts))
       and (p_member is null or t.created_by = p_member)
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
-- 4c. Relatório por conta (corpo da 069, 20261105140100_projected_with_pending.sql; a Carteira fora de `contas`)
-- ---------------------------------------------------------------------------
create or replace function public.account_flow_report(p_household uuid, p_from date, p_to date, p_include_planned boolean default false)
returns table (account_id uuid, name text, type text, opening_balance numeric, income numeric, expense numeric,
               transfer_in numeric, transfer_out numeric, closing_balance numeric, total_opening numeric,
               total_income numeric, total_expense numeric, total_transfers numeric, total_closing numeric)
language plpgsql stable security invoker set search_path = '' as $$
#variable_conflict use_column
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 3660 then
    raise exception 'período inválido (até 10 anos)' using errcode = '22023';
  end if;
  return query
  with contas as (
    select a.id, a.name, a.type, a.opening_date, a.initial_balance
      from public.accounts a
     where a.household_id = p_household and a.active and a.currency_code = 'BRL' and a.opening_date <= p_to
       and a.system_role is null  -- (100) a Carteira de investimentos é interna (fora de todas as somas)
  ), saldo_ini as (
    select b.account_id, b.balance from public.account_balances_projected(p_household, p_from - 1, p_include_planned) b
  ), rec as (
    select pr.* from private.account_recurrence_pending(p_household, p_from, p_to) pr where p_include_planned
  ), prev as (
    -- previstos do período (068), por conta (sinal do saldo)
    select pc.pay_account_id as conta, -pc.amount as delta, false as transf
      from private.card_pending_by_due(p_household, p_from, p_to) pc
     where p_include_planned and pc.pay_account_id is not null
    union all
    select pr.account_id, case pr.kind when 'income' then pr.amount else -pr.amount end, pr.kind = 'transfer'
      from rec pr
    union all
    select pr.destination_account_id, pr.amount, true
      from rec pr
     where pr.kind = 'transfer'
  ), movs as (
    -- realizados: o extrato da conta (account_movements), só o período, sem a linha do saldo inicial
    select c.id as conta, m.amount as delta, coalesce(t.type = 'transfer', false) as transf
      from contas c
     cross join lateral public.account_movements(c.id, p_to) m
      left join public.transactions t on m.source = 'transaction' and t.household_id = p_household and t.id = m.id
     where m.source <> 'opening' and m.date between p_from and p_to
    union all
    -- planejados (as mesmas regras de account_balances_projected, no período)
    select c.id,
           case when t.type = 'income' then t.amount
                when t.type = 'expense' then -t.amount
                when t.account_id = c.id then -t.amount
                else t.amount end,
           t.type = 'transfer'
      from contas c
      join public.transactions t
        on t.household_id = p_household and t.deleted_at is null and t.status = 'planned'
       and (t.account_id = c.id or t.destination_account_id = c.id)
       and t.date >= c.opening_date and t.date between p_from and p_to
     where p_include_planned
    union all
    select d.payment_account_id, -s.amount, false
      from public.debt_payment_schedule s
      join public.debts d on d.household_id = s.household_id and d.id = s.debt_id
     where p_include_planned and s.household_id = p_household and s.status = 'planned'
       and s.due_date between p_from and p_to
       and d.payment_method = 'account_debit' and d.payment_account_id is not null
    union all
    select d.pay_account_id, -greatest(m.total - m.paid, 0), false
      from public.debts d
     cross join lateral public.card_months(d.id) m
     where p_include_planned and d.household_id = p_household and d.kind = 'card' and d.pay_account_id is not null
       and m.due_date between p_from and p_to and m.total > m.paid
    union all
    select p.conta, p.delta, p.transf from prev p
  ), fluxo as (
    select x.conta,
           coalesce(sum(x.delta) filter (where x.delta > 0), 0) as ent,
           coalesce(-sum(x.delta) filter (where x.delta < 0), 0) as sai,
           coalesce(sum(x.delta) filter (where x.delta > 0 and x.transf), 0) as t_ent,
           coalesce(-sum(x.delta) filter (where x.delta < 0 and x.transf), 0) as t_sai
      from movs x group by x.conta
  ), linhas as (
    select c.id, c.name, c.type,
           case when c.opening_date < p_from then coalesce(si.balance, 0) else c.initial_balance end as ini,
           coalesce(f.ent, 0) as ent, coalesce(f.sai, 0) as sai, coalesce(f.t_ent, 0) as t_ent, coalesce(f.t_sai, 0) as t_sai
      from contas c
      left join saldo_ini si on si.account_id = c.id
      left join fluxo f on f.conta = c.id
  )
  select l.id, l.name, l.type, l.ini, l.ent, l.sai, l.t_ent, l.t_sai, l.ini + l.ent - l.sai,
         sum(l.ini) over (), sum(l.ent - l.t_ent) over (), sum(l.sai - l.t_sai) over (),
         sum(l.t_ent - l.t_sai) over (), sum(l.ini + l.ent - l.sai) over ()
    from linhas l
   where (select private.is_member(p_household))
   order by l.name, l.id;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Travas da Carteira
-- ---------------------------------------------------------------------------
-- Lançamentos: nada que toque a Carteira (origem ou destino, antes ou depois) muda sem a marca da família.
-- Mudança só em colunas fora do alcance do cliente (reconciliation_id da conferência da conta comum, updated_at) passa:
-- reconcile_account/reconciliation_undo marcam todas as transferências da conta, inclusive as da Carteira.
create function private.investment_portfolio_tx_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if current_setting('app.investment_portfolio', true) = coalesce(new.household_id, old.household_id)::text then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' and current_setting('app.reserve_erase', true) = old.household_id::text then
    return old;  -- zerar tudo / excluir a família
  end if;
  if tg_op = 'UPDATE'
     and (new.household_id, new.account_id, new.destination_account_id, new.category_id, new.type, new.description,
          new.amount, new.date, new.status, new.notes, new.deleted_at, new.person_id, new.is_shared_expense,
          new.recurrence_id, new.occurrence_date, new.installment_group, new.installment_number, new.installment_count,
          new.created_by)
         is not distinct from
         (old.household_id, old.account_id, old.destination_account_id, old.category_id, old.type, old.description,
          old.amount, old.date, old.status, old.notes, old.deleted_at, old.person_id, old.is_shared_expense,
          old.recurrence_id, old.occurrence_date, old.installment_group, old.installment_number, old.installment_count,
          old.created_by) then
    return new;
  end if;
  if exists (
    select 1 from public.accounts a
     where a.system_role = 'investment_portfolio'
       and ((tg_op <> 'DELETE' and a.household_id = new.household_id
             and (a.id = new.account_id or a.id = new.destination_account_id))
         or (tg_op <> 'INSERT' and a.household_id = old.household_id
             and (a.id = old.account_id or a.id = old.destination_account_id)))
  ) then
    raise exception 'Movimento da carteira de investimentos: altere pela operação em Investimentos.'
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

create trigger transactions_investment_portfolio_guard
  before insert or update or delete on public.transactions
  for each row execute function private.investment_portfolio_tx_guard();

-- A Carteira em si: não é editada, arquivada nem excluída (account_delete, cliente ou outra RPC). Só sai com a família.
-- E nenhuma conta comum vira Carteira (nem o contrário).
create function private.investment_portfolio_account_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if current_setting('app.investment_portfolio', true) = old.household_id::text then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if old.system_role is not null and current_setting('app.reserve_erase', true) is distinct from old.household_id::text then
      raise exception 'A carteira de investimentos é uma conta interna: não pode ser editada, arquivada nem excluída.'
        using errcode = '42501';
    end if;
    return old;
  end if;
  if old.system_role is not null or new.system_role is not null then
    raise exception 'A carteira de investimentos é uma conta interna: não pode ser editada, arquivada nem excluída.'
      using errcode = '42501';
  end if;
  return new;
end $$;

create trigger accounts_investment_portfolio_guard
  before update or delete on public.accounts
  for each row execute function private.investment_portfolio_account_guard();

-- Recorrentes, dívidas/cartões, eventos de dívida e conferências não usam a Carteira: o dinheiro sairia de todas as
-- somas sem entrar em ativo nenhum. Os argumentos do gatilho são as colunas de conta de cada tabela.
create function private.investment_portfolio_ref_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_row jsonb := to_jsonb(new);
  v_col text;
  v_acc uuid;
begin
  foreach v_col in array tg_argv loop
    v_acc := (v_row ->> v_col)::uuid;
    if v_acc is not null and exists (
      select 1 from public.accounts a
       where a.household_id = new.household_id and a.id = v_acc and a.system_role = 'investment_portfolio'
    ) then
      raise exception 'A carteira de investimentos é uma conta interna: use a compra e a venda em Investimentos.'
        using errcode = '42501';
    end if;
  end loop;
  return new;
end $$;

create trigger recurrences_investment_portfolio_guard
  before insert or update of account_id, destination_account_id on public.recurrences
  for each row execute function private.investment_portfolio_ref_guard('account_id', 'destination_account_id');
create trigger debts_investment_portfolio_guard
  before insert or update of pay_account_id, payment_account_id on public.debts
  for each row execute function private.investment_portfolio_ref_guard('pay_account_id', 'payment_account_id');
create trigger debt_events_investment_portfolio_guard
  before insert or update of account_id on public.debt_events
  for each row execute function private.investment_portfolio_ref_guard('account_id');
create trigger account_reconciliations_investment_portfolio_guard
  before insert or update of account_id on public.account_reconciliations
  for each row execute function private.investment_portfolio_ref_guard('account_id');

revoke execute on function private.investment_portfolio_tx_guard(), private.investment_portfolio_account_guard(),
  private.investment_portfolio_ref_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Operação com conta (corpo da 043 + p_account no fim; drop + create)
-- ---------------------------------------------------------------------------
drop function public.investment_operation_record(uuid, date, text, numeric, numeric, numeric, text);

create function public.investment_operation_record(
  p_asset uuid, p_date date, p_kind text, p_quantity numeric,
  p_unit_price numeric, p_fees numeric default 0, p_notes text default null, p_account uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_asset public.investment_assets%rowtype;
  v_acc public.accounts%rowtype;
  v_held numeric;
  v_id uuid;
  v_valor numeric;
  v_carteira uuid;
  v_tx uuid;
begin
  if auth.uid() is null then raise exception 'não autenticado' using errcode = '42501'; end if;
  select * into v_asset from public.investment_assets where id = p_asset for update;
  if not found or not private.is_member(v_asset.household_id) then
    raise exception 'ativo não encontrado' using errcode = '42501';
  end if;
  if not v_asset.active then raise exception 'ativo arquivado' using errcode = '55000'; end if;
  if p_date is null or p_date > private.today_sp() or p_date < date '2000-01-01'
     or p_kind not in ('buy','sell') or p_quantity is null or p_quantity <= 0
     or p_quantity <> round(p_quantity,12)
     or p_unit_price is null or p_unit_price <= 0 or p_unit_price <> round(p_unit_price,10)
     or p_fees is null or p_fees < 0 or p_fees <> round(p_fees,2)
     or abs(p_quantity) >= 1e18 or abs(p_unit_price) >= 1e12 or abs(p_fees) >= 1e12
     or (p_notes is not null and char_length(p_notes) > 500) then
    raise exception 'dados da operação inválidos' using errcode = '22023';
  end if;
  -- (100) conta que paga a compra ou recebe a venda
  if p_account is not null then
    select * into v_acc from public.accounts where id = p_account for share;
    if not found or v_acc.household_id <> v_asset.household_id then
      raise exception 'conta não encontrada' using errcode = '42501';
    end if;
    if v_acc.system_role is not null then
      raise exception 'conta inválida: a carteira de investimentos não paga nem recebe operações' using errcode = '22023';
    end if;
    if not v_acc.active then
      raise exception 'conta inválida: a conta está arquivada' using errcode = '22023';
    end if;
    if v_asset.currency_code <> 'BRL' or v_acc.currency_code <> 'BRL' then
      raise exception 'conta inválida: só ativo em reais movimenta conta, e só conta em reais' using errcode = '22023';
    end if;
    v_valor := round(case when p_kind = 'buy' then p_quantity * p_unit_price + p_fees
                          else p_quantity * p_unit_price - p_fees end, 2);
    if v_valor <= 0 then
      raise exception 'o valor líquido da operação na conta (%) precisa ser maior que zero', v_valor using errcode = '22023';
    end if;
    if v_valor >= 1e12 then
      raise exception 'dados da operação inválidos' using errcode = '22023';
    end if;
  end if;
  if p_kind = 'sell' then
    select coalesce(sum(case when o.kind='buy' then o.quantity else -o.quantity end),0)
      into v_held from public.investment_operations o
     where o.asset_id = v_asset.id and o.household_id = v_asset.household_id
       and o.operation_date <= p_date and o.voided_at is null;
    if p_quantity > v_held then
      raise exception 'quantidade vendida supera a posição disponível' using errcode = '23514';
    end if;
  end if;
  if p_account is not null then
    v_carteira := private.investment_portfolio_account(v_asset.household_id);
    perform set_config('app.investment_portfolio', v_asset.household_id::text, true);
    insert into public.transactions (household_id, account_id, destination_account_id, type, description, amount, date, status)
    values (v_asset.household_id,
            case when p_kind = 'buy' then p_account else v_carteira end,
            case when p_kind = 'buy' then v_carteira else p_account end,
            'transfer',
            case when p_kind = 'buy' then 'Aporte: ' else 'Resgate: ' end || v_asset.name,
            v_valor, p_date, 'paid')
    returning id into v_tx;
    perform set_config('app.investment_portfolio', '', true);
  end if;
  insert into public.investment_operations
    (household_id,asset_id,operation_date,kind,quantity,unit_price,fees,notes,created_by,transaction_id)
  values (v_asset.household_id,v_asset.id,p_date,p_kind,p_quantity,p_unit_price,p_fees,p_notes,auth.uid(),v_tx)
  returning id into v_id;
  return v_id;
end $$;

revoke execute on function public.investment_operation_record(uuid, date, text, numeric, numeric, numeric, text, uuid)
  from public, anon;
grant execute on function public.investment_operation_record(uuid, date, text, numeric, numeric, numeric, text, uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Anular devolve o dinheiro (corpo da 043; a transferência vai para a lixeira) e excluir o ativo também
-- ---------------------------------------------------------------------------
create or replace function public.investment_operation_void(p_operation uuid, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_op public.investment_operations%rowtype;
  v_asset public.investment_assets%rowtype;
  v_reason text := btrim(p_reason);
  v_min numeric;
begin
  if auth.uid() is null then raise exception 'não autenticado' using errcode = '42501'; end if;
  select * into v_op from public.investment_operations where id = p_operation;
  if not found then raise exception 'operação não encontrada' using errcode = '42501'; end if;
  -- mesma ordem de lock das outras funções de ativo: o ativo primeiro
  select * into v_asset from public.investment_assets
   where id = v_op.asset_id and household_id = v_op.household_id for update;
  if not found or not private.is_member(v_asset.household_id) then
    raise exception 'operação não encontrada' using errcode = '42501';
  end if;
  select * into v_op from public.investment_operations where id = p_operation for update;
  if v_op.voided_at is not null then
    raise exception 'esta operação já foi anulada' using errcode = '55000';
  end if;
  if not v_asset.active then
    raise exception 'ativo arquivado: reative o ativo antes de anular uma operação' using errcode = '55000';
  end if;
  if v_reason is null or char_length(v_reason) not between 3 and 200 then
    raise exception 'informe o motivo da anulação (3 a 200 caracteres)' using errcode = '22023';
  end if;

  -- Quantidade acumulada ao fim de cada data, sem a operação anulada (mesma regra da venda em
  -- investment_operation_record, que compara com a posição até a data da venda).
  select min(saldo) into v_min from (
    select sum(sum(case when o.kind = 'buy' then o.quantity else -o.quantity end))
             over (order by o.operation_date) as saldo
      from public.investment_operations o
     where o.asset_id = v_asset.id and o.household_id = v_asset.household_id
       and o.voided_at is null and o.id <> v_op.id
     group by o.operation_date
  ) s;
  if v_min < 0 then
    raise exception 'não dá para anular: sem esta compra, as vendas posteriores ficariam maiores que a posição. Anule a venda antes.'
      using errcode = '23514';
  end if;

  update public.investment_operations
     set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason
   where id = v_op.id;

  -- (100) a transferência da operação (aporte ou resgate) vai para a lixeira: o dinheiro volta para onde estava
  if v_op.transaction_id is not null then
    perform set_config('app.investment_portfolio', v_asset.household_id::text, true);
    update public.transactions set deleted_at = now()
     where id = v_op.transaction_id and household_id = v_asset.household_id and deleted_at is null;
    perform set_config('app.investment_portfolio', '', true);
  end if;
end $$;

-- (corpo da 050) as transferências das operações NÃO anuladas vão para a lixeira junto (as das anuladas já foram)
create or replace function public.investment_asset_purge(p_asset uuid, p_confirm_name text)
returns table (operations integer, valuations integer, distributions integer)
language plpgsql security definer set search_path = '' as $$
declare v_asset public.investment_assets%rowtype; v_o integer; v_v integer; v_d integer;
begin
  if (select auth.uid()) is null then
    raise exception 'não autenticado' using errcode = '42501';
  end if;
  select * into v_asset from public.investment_assets where id = p_asset for update;
  if not found or not private.is_member(v_asset.household_id) then
    raise exception 'ativo não encontrado' using errcode = '42501';
  end if;
  if p_confirm_name is null or btrim(p_confirm_name) <> btrim(v_asset.name) then
    raise exception 'Digite o nome exato do ativo para confirmar a exclusão.' using errcode = '22023';
  end if;
  perform set_config('app.investment_portfolio', v_asset.household_id::text, true);
  update public.transactions t set deleted_at = now()
    from public.investment_operations o
   where o.household_id = v_asset.household_id and o.asset_id = v_asset.id and o.voided_at is null
     and t.id = o.transaction_id and t.household_id = o.household_id and t.deleted_at is null;
  perform set_config('app.investment_portfolio', '', true);
  delete from public.investment_distributions where household_id = v_asset.household_id and asset_id = v_asset.id;
  get diagnostics v_d = row_count;
  delete from public.investment_valuations where household_id = v_asset.household_id and asset_id = v_asset.id;
  get diagnostics v_v = row_count;
  delete from public.investment_operations where household_id = v_asset.household_id and asset_id = v_asset.id;
  get diagnostics v_o = row_count;
  delete from public.investment_assets where id = v_asset.id and household_id = v_asset.household_id;
  return query select v_o, v_v, v_d;
end $$;

-- ---------------------------------------------------------------------------
-- 8. "Excluir transações" apaga também as transferências da Carteira (corpo de 20261107190000)
-- ---------------------------------------------------------------------------
create or replace function public.clear_household_transactions(p_household uuid, p_confirmation text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_deleted bigint;
  v_distributions bigint;
begin
  if v_uid is null then
    raise exception 'Não autenticado.' using errcode = '42501';
  end if;
  if p_household is null or not private.is_owner(p_household) then
    raise exception 'Somente o titular da família pode excluir os lançamentos.' using errcode = '42501';
  end if;
  if lower(btrim(coalesce(p_confirmation, ''))) <> 'excluir transações' then
    raise exception 'Confirmação incorreta. Escreva "excluir transações".' using errcode = '22023';
  end if;

  perform 1 from public.households h where h.id = p_household for update;
  select count(*) into v_distributions
  from public.investment_distributions d
  join public.transactions t on t.id = d.transaction_id
  where t.household_id = p_household;

  -- (100) as transferências de aporte/resgate saem também; as operações ficam (transaction_id vira nulo)
  perform set_config('app.investment_portfolio', p_household::text, true);
  with deleted as (
    delete from public.transactions t
    where t.household_id = p_household
    returning 1
  )
  select count(*) into v_deleted from deleted;
  perform set_config('app.investment_portfolio', '', true);

  return jsonb_build_object('transactions_deleted', v_deleted, 'investment_distributions_deleted', v_distributions);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Mover uma conta para a carteira
-- ---------------------------------------------------------------------------
-- O saldo da conta na data vira um ativo novo em reais (compra de 1 unidade ao preço = saldo, sem tarifa, com a
-- transferência conta → Carteira pelo saldo) e a conta é arquivada. Atômica: qualquer recusa desfaz tudo.
-- A conta não pode ter movimento pago depois da data (senão sobraria saldo numa conta arquivada).
create function public.account_move_to_portfolio(
  p_account uuid, p_name text, p_class text, p_liquidity text, p_subclass text default null, p_date date default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_acc public.accounts%rowtype;
  v_date date := coalesce(p_date, private.today_sp());
  v_saldo numeric;
  v_saldo_fim numeric;
  v_asset uuid;
begin
  if auth.uid() is null then raise exception 'não autenticado' using errcode = '42501'; end if;
  select * into v_acc from public.accounts where id = p_account for update;
  if not found or not private.is_member(v_acc.household_id) then
    raise exception 'conta não encontrada' using errcode = '42501';
  end if;
  if v_acc.system_role is not null then
    raise exception 'conta inválida: a carteira de investimentos não pode ser movida' using errcode = '22023';
  end if;
  if not v_acc.active then
    raise exception 'conta inválida: a conta já está arquivada' using errcode = '22023';
  end if;
  if v_acc.currency_code <> 'BRL' then
    raise exception 'conta inválida: só conta em reais vai para a carteira' using errcode = '22023';
  end if;
  if v_date > private.today_sp() or v_date < v_acc.opening_date then
    raise exception 'data inválida: entre a abertura da conta (%) e hoje', v_acc.opening_date using errcode = '22023';
  end if;
  select b.balance into v_saldo from public.account_balances(v_acc.household_id, v_date) b where b.account_id = v_acc.id;
  v_saldo := coalesce(v_saldo, 0);
  if v_saldo <= 0 then
    raise exception 'a conta tem saldo de R$ % em %: só dá para mover para a carteira uma conta com saldo positivo',
      replace(to_char(v_saldo, 'FM999999999990.00'), '.', ','), to_char(v_date, 'DD/MM/YYYY')
      using errcode = '22023';
  end if;
  select b.balance into v_saldo_fim from public.account_balances(v_acc.household_id, date '2100-01-01') b
   where b.account_id = v_acc.id;
  if v_saldo_fim is distinct from v_saldo then
    raise exception 'a conta tem movimento pago depois de %: escolha a data do último movimento ou uma posterior',
      to_char(v_date, 'DD/MM/YYYY') using errcode = '22023';
  end if;

  v_asset := public.investment_asset_create(v_acc.household_id, p_name, null, p_class, 'BRL');
  perform public.investment_asset_set_liquidity(v_asset, p_liquidity);
  if nullif(btrim(p_subclass), '') is not null then
    perform public.investment_asset_set_subclass(v_asset, p_subclass);
  end if;
  perform public.investment_operation_record(v_asset, v_date, 'buy', 1, v_saldo, 0,
    'Saldo da conta ' || v_acc.name || ' movido para a carteira', v_acc.id);
  update public.accounts set active = false where id = v_acc.id;
  return v_asset;
end $$;

revoke execute on function public.account_move_to_portfolio(uuid, text, text, text, text, date) from public, anon;
grant execute on function public.account_move_to_portfolio(uuid, text, text, text, text, date) to authenticated;
