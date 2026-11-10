-- Tudo Azul — migration 099: liquidez dos investimentos e patrimônio que soma a carteira
--
-- Decisão do dono (10/11/2026, "opção C"): o dinheiro passa a ser lido em três baldes, por liquidez:
--   * Disponível: contas ativas em reais dos tipos checking, savings, cash e brokerage (076; NÃO muda aqui);
--   * Investimentos líquidos: a carteira de Investimentos que dá para resgatar/vender;
--   * Restrito: o que não dá para usar quando se quer (previdência, FGTS).
-- E o Patrimônio total passa a SOMAR a carteira de investimentos em reais. Isto REVOGA a decisão #196 (migration 075,
-- 20261106130100_net_worth_single.sql), em que o patrimônio não somava a carteira.
-- Atenção (o motivo da 075 continua valendo como risco): a carteira não movimenta contas. Se o mesmo dinheiro estiver
-- cadastrado como CONTA de renda fixa/variável/cripto (070) E como ativo da carteira, ele entra duas vezes no
-- patrimônio. O banco não tem como saber que são a mesma aplicação.
--
-- O que esta migration acrescenta ou troca (nada é alterado nas migrations anteriores):
--   1. investment_assets.liquidity: 'liquid' (padrão) ou 'restricted'. Nenhum ativo existente é reclassificado: todos
--      ficam 'liquid' até a pessoa marcar. É um atributo ATUAL do ativo (como a subclasse, 034): não tem histórico, vale
--      para qualquer data de corte.
--   2. public.investment_asset_set_liquidity(p_asset, p_liquidity): molde de investment_asset_set_subclass (034). A tabela
--      continua sem escrita direta do cliente.
--   3. public.investment_liquidity_totals(p_household, p_as_of): valor de mercado por moeda e por liquidez, das mesmas
--      posições de investment_portfolio (abertas, de ativos ativos). Só devolve as combinações que existem (sem linha
--      zerada). A soma das linhas de uma moeda = investment_totals.market_value dela. Moedas nunca se somam.
--   4. public.home_indicators: corpo da 076 (20261106140100_available_liquid.sql), copiado sem mudança exceto:
--        * `net_worth` = contas + crédito a receber + bens + CARTEIRA EM REAIS − dívidas (antes sem a carteira);
--        * duas colunas novas NO FIM: `investments_liquid` e `investments_restricted` (a carteira em reais por
--          liquidez; a soma das duas = `investments`);
--        * o CTE `inv` lê investment_liquidity_totals (uma chamada só da carteira) em vez de investment_totals.
--      `available` e `accounts_active` não mudam. Como o tipo de retorno muda, é drop + create (o Postgres não troca o
--      retorno com create or replace), com os mesmos jit = off e grants. Ninguém depende dela no catálogo: quem a chama
--      (public.get_home_decision_month, 20261109050000) é função SQL de corpo em texto, resolvida na execução; o campo
--      `treasury` dela (to_jsonb da linha) ganha sozinho as duas chaves novas e o patrimônio novo.
--   5. public.net_worth_with_assets (Análises): corpo da 071 (20261106100100_home_indicators.sql);
--      `net_worth` passa a somar a carteira em reais, para continuar IGUAL ao de home_indicators na mesma data, e o
--      retorno ganha NO FIM a coluna `investments_brl` (a carteira em reais = home_indicators.investments), para a tela
--      fechar a conta sem somar no front: net_worth = available + credit_receivable + family_assets_brl +
--      investments_brl − debt. Como o tipo de retorno muda, é drop + create, com os mesmos grants. Ninguém depende
--      dela no catálogo nem a chama de dentro de outra função do banco (só o front, que lê as colunas pelo nome).
-- Fica como estava: public.net_worth (o legado da 002, sem bens nem carteira; só é chamado pelo front como reserva de
-- compatibilidade). reset_household/reset_preview/delete_household apagam ou contam a linha inteira de
-- investment_assets, sem enumerar colunas: não precisam acompanhar.
-- Códigos de erro: 42501 não autenticado ou ativo de outra família/inexistente; 22023 liquidez inválida.
-- Teste: 93_investment_liquidity (falha sem esta migration).

alter table public.investment_assets
  add column liquidity text not null default 'liquid' check (liquidity in ('liquid', 'restricted'));

create function public.investment_asset_set_liquidity(p_asset uuid, p_liquidity text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_asset public.investment_assets%rowtype;
begin
  if auth.uid() is null then raise exception 'não autenticado' using errcode = '42501'; end if;
  select * into v_asset from public.investment_assets where id = p_asset for update;
  if not found or not private.is_member(v_asset.household_id) then
    raise exception 'ativo não encontrado' using errcode = '42501';
  end if;
  if p_liquidity is null or p_liquidity not in ('liquid', 'restricted') then
    raise exception 'liquidez inválida (liquid ou restricted)' using errcode = '22023';
  end if;
  update public.investment_assets set liquidity = p_liquidity where id = v_asset.id;
end $$;

create function public.investment_liquidity_totals(p_household uuid, p_as_of date)
returns table (currency_code text, liquidity text, market_value numeric)
language sql stable security invoker set search_path = '' as $$
  select p.currency_code, a.liquidity, sum(p.market_value)
    from public.investment_portfolio(p_household, p_as_of) p
    join public.investment_assets a on a.id = p.asset_id and a.household_id = p_household
   where (select private.is_member(p_household))
   group by p.currency_code, a.liquidity
   order by p.currency_code, a.liquidity
$$;

revoke execute on function public.investment_asset_set_liquidity(uuid, text), public.investment_liquidity_totals(uuid, date) from public, anon;
grant execute on function public.investment_asset_set_liquidity(uuid, text), public.investment_liquidity_totals(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Patrimônio de Análises (corpo da 071, 20261106100100_home_indicators.sql; entra a carteira em reais na soma e a
-- coluna `investments_brl` no fim)
-- ---------------------------------------------------------------------------
drop function public.net_worth_with_assets(uuid, date);

create function public.net_worth_with_assets(p_household uuid, p_as_of date)
returns table(
  available numeric,
  debt numeric,
  credit_receivable numeric,
  family_assets_brl numeric,
  net_worth numeric,
  planned_commitments numeric,
  investments_brl numeric
)
language sql stable security invoker set search_path = '' as $$
  select s.available, s.debt, s.cr, s.family_assets_brl,
         s.available + s.cr + s.family_assets_brl + s.inv - s.debt,
         s.pc, s.inv
    from (
      select
        coalesce((select sum(b.balance) from public.account_balances(p_household, p_as_of) b
                   where b.currency_code = 'BRL'), 0) as available,
        d.debt, d.cr,
        private.family_assets_brl(p_household, p_as_of) as family_assets_brl,
        -- a carteira de investimentos em reais, com o mesmo arredondamento de home_indicators (099)
        (select round(coalesce(sum(i.market_value) filter (where i.currency_code = 'BRL'), 0), 2)
           from public.investment_totals(p_household, p_as_of) i) as inv,
        d.pc
        from (select coalesce(sum(x.debt), 0) as debt, coalesce(sum(x.credit_receivable), 0) as cr,
                     coalesce(sum(x.planned_remaining), 0) as pc
                from public.debt_balances(p_household, p_as_of) x) d
    ) s
   where (select private.is_member(p_household))
$$;

revoke execute on function public.net_worth_with_assets(uuid, date) from public, anon;
grant execute on function public.net_worth_with_assets(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Indicadores do Início (corpo da 076, 20261106140100_available_liquid.sql; mudam o CTE `inv`, a soma do patrimônio e
-- as duas colunas novas no fim)
-- ---------------------------------------------------------------------------
drop function public.home_indicators(uuid, date);

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

revoke execute on function public.home_indicators(uuid, date) from public, anon;
grant execute on function public.home_indicators(uuid, date) to authenticated;
