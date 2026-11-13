-- Tudo Azul — migration 114: aporte líquido mês a mês (somente leitura)
--
-- Pedido do dono (12/11/2026): na evolução dos investimentos, a linha "Aportado" tem de ser o aporte líquido (o que ele pôs
-- menos o que tirou), igual ao "Aportado" do resumo. Hoje a linha vem de investment_history.cost_basis, que é o custo do que
-- AINDA está investido: depois de um resgate o custo cai e a linha deixa de bater com o número do topo.
--
-- public.investment_contribution_history(p_household, p_from, p_to) devolve, para cada mês de p_from a p_to e cada moeda
-- da família, o que já entrou (contributed), o que já saiu (redeemed) e o líquido (net_contributed = contributed −
-- redeemed), contados até o fim do mês (ou até p_to, no mês corrente). É a MESMA regra de investment_contributions (migration
-- 107): compras = round(quantidade × preço + tarifas, 2), vendas = round(quantidade × preço − tarifas, 2), operação anulada não
-- conta, e só entram os ativos com posição aberta naquele fim de mês (ativo zerado some com o que realizou, como na 107).
-- Por construção, o último mês (p_to = hoje) de uma moeda = a linha 'total' de investment_contributions(p_household, p_to)
-- para os ativos ativos. Teste 110_investment_contribution_history prova isso.
-- Mesmo conjunto de ativos e mesmo corpo de razão de investment_history (migration 043): os dois gráficos usam o mesmo
-- critério de "posição aberta", então as duas linhas do gráfico (valor atual e aportado) são comparáveis mês a mês.
-- Mês sem posição aberta devolve zeros (a linha não some). O líquido pode ser negativo (resgatou mais do que pôs).
-- SECURITY INVOKER: a RLS de quem chama decide; quem não é da família recebe zero linhas. Nada é gravado.

create function public.investment_contribution_history(p_household uuid, p_from date, p_to date)
returns table (month date, currency_code text, contributed numeric, redeemed numeric, net_contributed numeric)
language sql stable security invoker set search_path = '' as $$
  with recursive meses as (
    select generate_series(
      date_trunc('month', p_from)::date,
      date_trunc('month', p_to)::date,
      interval '1 month'
    )::date as mes
  ), moedas as (
    select distinct a.currency_code
      from public.investment_assets a
     where a.household_id = p_household
  ), operations as (
    select o.asset_id, o.kind, o.quantity, o.unit_price, o.fees, o.operation_date,
      row_number() over (partition by o.asset_id order by o.operation_date, o.created_at, o.id) as rn
    from public.investment_operations o
    where o.household_id = p_household and o.operation_date <= p_to and o.voided_at is null
  ), ledger as (
    select o.asset_id, o.rn, o.operation_date,
      o.quantity as quantity,
      round(o.quantity*o.unit_price + o.fees, 2) as contributed,
      0::numeric as redeemed
    from operations o where o.rn = 1 and o.kind = 'buy'
    union all
    select o.asset_id, o.rn, o.operation_date,
      case when o.kind = 'buy' then l.quantity + o.quantity else l.quantity - o.quantity end,
      l.contributed + case when o.kind = 'buy' then round(o.quantity*o.unit_price + o.fees, 2) else 0 end,
      l.redeemed + case when o.kind = 'sell' then round(o.quantity*o.unit_price - o.fees, 2) else 0 end
    from ledger l
    join operations o on o.asset_id = l.asset_id and o.rn = l.rn + 1
  ), por_mes as (
    select m.mes, a.currency_code, pos.contributed, pos.redeemed
      from meses m
      cross join public.investment_assets a
      cross join lateral (select least((m.mes + interval '1 month - 1 day')::date, p_to) as fim) f
      cross join lateral (
        select l.quantity, l.contributed, l.redeemed from ledger l
         where l.asset_id = a.id and l.operation_date <= f.fim
         order by l.rn desc limit 1
      ) pos
     where a.household_id = p_household and pos.quantity > 0
  )
  select m.mes, c.currency_code,
         coalesce(sum(p.contributed), 0)::numeric,
         coalesce(sum(p.redeemed), 0)::numeric,
         coalesce(sum(p.contributed - p.redeemed), 0)::numeric
    from meses m
    cross join moedas c
    left join por_mes p on p.mes = m.mes and p.currency_code = c.currency_code
   where p_household is not null and p_from is not null and p_to is not null
     and p_from <= p_to and private.is_member(p_household)
   group by m.mes, c.currency_code
   order by m.mes, c.currency_code
$$;

revoke execute on function public.investment_contribution_history(uuid, date, date) from public, anon;
grant execute on function public.investment_contribution_history(uuid, date, date) to authenticated;
