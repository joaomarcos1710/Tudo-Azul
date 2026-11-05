-- Tudo Azul — migration 063: resumo dos recorrentes (por meio, conta/cartão, tipo e frequência)
--
-- Pedido do dono (05/11/2026): separar os recorrentes por frequência (dia, mês, bimestre, ano…), por meio (conta ou
-- cartão) e ver quanto sai por mês no cartão e na conta. O front não soma dinheiro: os totais saem daqui.
--
-- public.recurrence_summary(p_household) devolve linhas em cinco níveis (coluna grouping_level), todas da MESMA base:
--   'detail'        meio + conta/cartão + tipo + frequência  (a linha mais fina)
--   'target'        meio + conta/cartão + tipo               (lista "por cartão" / "por conta")
--   'frequency'     meio + tipo + frequência                 (cabeçalho do grupo nas abas Conta e Cartão)
--   'medium'        meio + tipo                              (cartões do topo: "No cartão, por mês" etc.)
--   'frequency_all' tipo + frequência, meio nulo             (cabeçalho do grupo na aba Todos)
--
-- Base (o que entra):
--   * só regras ATIVAS (active) e sem data final passada (end_date nula ou >= hoje em São Paulo). Regra com início no
--     futuro entra (já está cadastrada e vai acontecer);
--   * só reais: assinatura de cartão (cartão é sempre em reais) e regra de conta cuja conta (a de origem, na
--     transferência) é BRL. Regra em conta de outra moeda fica FORA (somar dólar com real não tem sentido; a tela avisa
--     quantas ficaram de fora — contar não é somar dinheiro);
--   * meio: 'card' (kind = 'card', que aqui vira tipo 'expense') ou 'account';
--   * tipo: 'expense', 'income' ou 'transfer'. Transferência é linha própria e nunca entra nos totais de gasto.
--
-- Frequência normalizada (freq_unit/freq_every das migrations 016 e 052):
--   day/N → 'daily' (todo dia e a cada N dias) · week/N → 'weekly' (semanal, quinzenal, a cada N semanas)
--   month/1 'monthly' · month/2 'bimonthly' · month/3 'quarterly' · month/6 'semiannual' · month/12 'yearly'
--   outro month/N (4, 5, 7–11) → 'custom'.
--
-- Equivalente mensal (regra do dinheiro, ver docs "20 - Regras do dinheiro"):
--   mês: valor / N · semana: valor × 52 / (12 × N) · dia: valor × 365 / (12 × N)
--   Arredondamento: round(x, 2) POR REGRA (meio centavo para longe do zero, o round de numeric), e só então soma.
--   Assim o total de um grupo é exatamente a soma dos equivalentes de cada regra (três trimestrais de 100,00 dão
--   33,33 cada e 99,99 no total, nunca 100,00). total_per_occurrence é a soma simples dos valores (sem conversão).
--
-- SECURITY INVOKER + is_member (a RLS do chamador decide), como as funções de relatório irmãs. "Hoje" é calculado
-- inline (private.today_sp não é executável por authenticated). Nenhuma migration anterior é editada.
-- Teste: 63_recurrence_summary.

create function public.recurrence_summary(p_household uuid)
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
      left join public.debts d on d.household_id = r.household_id and d.id = r.debt_id
     where r.household_id = p_household
       and (select private.is_member(p_household))
       and r.active
       and (r.end_date is null or r.end_date >= (now() at time zone 'America/Sao_Paulo')::date)
       and (r.kind = 'card' or a.currency_code = 'BRL')
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
