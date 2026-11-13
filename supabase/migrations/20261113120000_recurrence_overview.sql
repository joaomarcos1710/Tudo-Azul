-- Tudo Azul — migration 116: visão geral dos recorrentes (somente leitura): total por mês e por ano, fixo × variável
--
-- Recorrentes virou só informativa (decisão do dono, 13/11/2026). O topo da página mostra quanto se gasta por mês e por ano
-- (fixo × variável) e quanto entra por mês e por ano. O front não soma dinheiro de relatório, então tudo vem daqui.
--
-- Mesma base de public.recurrence_summary e recurrence_nature_summary: regra ativa, data final não passada, só em reais (cartão é
-- sempre em reais), conta e destino ativos, transferência fora. kind: 'expense' (despesa em conta + cartão) ou 'income'.
-- Duas famílias de linha, para o front não somar nada:
--   * klass = 'all': o total do tipo;
--   * klass = 'fixed' | 'variable' (só despesa): o recorte. A soma dos dois fecha com o 'all'.
--
-- POR MÊS: o mesmo equivalente das outras funções (round(x, 2) por regra, depois a soma).
-- POR ANO: valor × ocorrências por ano, arredondado por regra (mensal 12 ÷ cada; semanal 52 ÷ cada; dias 365 ÷ cada). Não é 12 × o
-- mensal: o mensal já vem arredondado no centavo e 12 × ele erraria até alguns centavos por regra.
--
-- FIXO × VARIÁVEL (decisão do dono: o app sugere):
--   1. a natureza que a pessoa marcou vence: 'fixed' e 'subscription' = fixo; 'variable' = variável;
--   2. sem natureza, o app sugere pelo histórico: se nas últimas 6 cobranças efetivadas da regra (lançamentos pagos, ou as parcelas
--      da fatura no cartão) houve mais de um valor, é variável; senão (valor sempre igual, ou ainda sem histórico) é fixo.
--   suggested_count diz quantas regras do recorte são sugestão (sem natureza marcada), para a tela marcar "sugerido".
-- Atalho: um reajuste de preço (o valor da regra mudou de vez) aparece como "valores diferentes" e sugere variável até a pessoa marcar
-- a natureza ou o histórico se refazer. Melhorar se virar incômodo (comparar só o valor mais recente com o anterior, por exemplo).
-- Receita não tem fixo × variável aqui (só o total).
--
-- SECURITY INVOKER: a RLS do chamador decide; quem não é da família recebe vazio.

create function public.recurrence_overview(p_household uuid)
returns table (kind text, klass text, item_count integer, suggested_count integer, total_monthly numeric, total_yearly numeric)
language sql stable security invoker set search_path = '' as $$
  with regras as (
    select r.id, r.nature,
           case when r.kind = 'card' then 'expense' else r.kind end as kind,
           round(case r.freq_unit
                   when 'month' then r.amount / r.freq_every
                   when 'week'  then r.amount * 52 / (12 * r.freq_every)
                   else              r.amount * 365 / (12 * r.freq_every) end, 2) as monthly,
           round(case r.freq_unit
                   when 'month' then r.amount * 12 / r.freq_every
                   when 'week'  then r.amount * 52 / r.freq_every
                   else              r.amount * 365 / r.freq_every end, 2) as yearly
      from public.recurrences r
      left join public.accounts a on a.household_id = r.household_id and a.id = r.account_id
     where r.household_id = p_household
       and (select private.is_member(p_household))
       and r.active
       and r.kind <> 'transfer'
       and (r.end_date is null or r.end_date >= (now() at time zone 'America/Sao_Paulo')::date)
       and (r.kind = 'card' or a.currency_code = 'BRL')
       and (r.kind = 'card' or a.active)
  ), classe as (
    select g.kind, g.monthly, g.yearly,
           (g.kind = 'expense' and g.nature is null) as suggested,
           case when g.kind <> 'expense' then null
                when g.nature in ('fixed', 'subscription') then 'fixed'
                when g.nature = 'variable' then 'variable'
                when (select count(distinct h.valor) > 1
                        from (
                          (select t.amount as valor, t.date as dia from public.transactions t
                            where t.recurrence_id = g.id and t.status = 'paid' and t.deleted_at is null)
                          union all
                          (select i.face as valor, i.occurrence_date as dia from public.debt_installments i
                            where i.recurrence_id = g.id)
                          order by dia desc limit 6
                        ) h) then 'variable'
                else 'fixed' end as klass
      from regras g
  )
  select x.kind, x.klass, x.item_count, x.suggested_count, x.total_monthly, x.total_yearly
    from (
      select c.kind, 'all'::text as klass, count(*)::integer as item_count, (count(*) filter (where c.suggested))::integer as suggested_count,
             sum(c.monthly) as total_monthly, sum(c.yearly) as total_yearly
        from classe c group by c.kind
      union all
      select c.kind, c.klass, count(*)::integer, (count(*) filter (where c.suggested))::integer, sum(c.monthly), sum(c.yearly)
        from classe c where c.klass is not null group by c.kind, c.klass
    ) x
   order by x.kind, array_position(array['all', 'fixed', 'variable'], x.klass)
$$;
revoke execute on function public.recurrence_overview(uuid) from public, anon;
grant execute on function public.recurrence_overview(uuid) to authenticated;
