-- Tudo Azul — migration 107: quanto já entrou, quanto já saiu e quanto rendeu no total, por ativo
--
-- Pedido do dono (10/11/2026): os cartões e a tabela de Investimentos devem mostrar "quanto saiu do bolso" e "quanto
-- rendeu", contando o que já foi resgatado. O que o banco tinha (cost_basis e unrealized_result de investment_portfolio)
-- é só do que AINDA está investido: depois de um resgate, a parte resgatada sai do custo e o ganho dela sai do
-- resultado (pôs 1.000, passou a valer 1.100, tirou 550 → custo 500, resultado 50). Num cofrinho, de onde o dinheiro
-- entra e sai toda semana, o rendimento mostrado caía a cada resgate.
--
-- O que entra: public.investment_contributions(p_household, p_as_of), uma linha por ativo com posição aberta
-- (level = 'asset') e uma por moeda (level = 'total'), com:
--   contributed     = tudo o que entrou: soma das compras (quantidade × preço + tarifas), cada uma em centavos;
--   redeemed        = tudo o que saiu: soma das vendas (quantidade × preço − tarifas), cada uma em centavos;
--   net_contributed = contributed − redeemed (o que saiu do bolso e ainda não voltou; fica NEGATIVO quando já se
--                     resgatou mais do que se aportou, e isso é verdade, não erro);
--   market_value    = o de investment_portfolio (a soma de uma moeda = investment_totals.market_value);
--   total_result    = market_value − net_contributed = tudo o que rendeu desde o primeiro aporte, somando o ganho que
--                     já saiu nos resgates. Por construção, market_value = net_contributed + total_result, no centavo.
-- Cada operação conta pelo mesmo valor em centavos que entra ou sai da conta (migration 100). Anuladas não contam.
-- Proventos não entram (são receita na conta, vistos em investment_income_by_asset).
--
-- Limites, de propósito: só ativos com posição aberta em p_as_of (os mesmos de investment_portfolio). Ativo zerado ou
-- arquivado some junto com o ganho que realizou; se voltar a ter posição, volta com a história inteira.
-- Nenhuma função existente muda e nenhum dado é alterado.
--
-- Códigos de erro: nenhum próprio; quem não é da família recebe zero linhas (como investment_portfolio).
-- Teste: 101_investment_contributions (falha sem esta migration).

create function public.investment_contributions(p_household uuid, p_as_of date)
returns table (
  level text, asset_id uuid, currency_code text,
  contributed numeric, redeemed numeric, net_contributed numeric, market_value numeric, total_result numeric
)
language sql stable security invoker set search_path = '' as $$
  with por_ativo as materialized (
    select p.asset_id, p.name, p.currency_code, p.market_value, m.contributed, m.redeemed
      from public.investment_portfolio(p_household, p_as_of) p
      cross join lateral (
        select coalesce(sum(round(o.quantity * o.unit_price + o.fees, 2)) filter (where o.kind = 'buy'), 0) as contributed,
               coalesce(sum(round(o.quantity * o.unit_price - o.fees, 2)) filter (where o.kind = 'sell'), 0) as redeemed
          from public.investment_operations o
         where o.household_id = p_household and o.asset_id = p.asset_id
           and o.operation_date <= p_as_of and o.voided_at is null
      ) m
     where (select private.is_member(p_household))
  )
  select x.level, x.asset_id, x.currency_code, x.contributed, x.redeemed,
         x.contributed - x.redeemed, x.market_value, x.market_value - (x.contributed - x.redeemed)
    from (
      select 'asset'::text as level, a.asset_id, a.name, a.currency_code, a.contributed, a.redeemed, a.market_value
        from por_ativo a
      union all
      select 'total', null, null, t.currency_code, sum(t.contributed), sum(t.redeemed), sum(t.market_value)
        from por_ativo t group by t.currency_code
    ) x
   order by x.currency_code, x.level, x.name
$$;

revoke execute on function public.investment_contributions(uuid, date) from public, anon;
grant execute on function public.investment_contributions(uuid, date) to authenticated;
