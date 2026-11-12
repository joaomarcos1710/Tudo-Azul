-- Tudo Azul — migration 113: resumo dos recorrentes por natureza (somente leitura)
--
-- Recorrentes, 3ª PR (pedido do dono, 12/11/2026): resumo e filtro por natureza (custo fixo, assinatura, gasto variável,
-- ressarcimento a receber). O front não soma dinheiro de relatório, então o total mensal de cada natureza vem daqui.
--
-- Mesma base de public.recurrence_summary (corpo da 20261106113100): regra ativa, data final não passada, só em reais
-- (cartão é sempre reais), conta e destino ativos, e o mesmo equivalente por mês (round(x, 2) por regra, depois a soma).
-- Transferência fica de fora (não tem natureza e não é gasto). Regra sem natureza aparece como 'none'.
-- Duas famílias de linha, para o front não somar nada:
--   * nature = 'fixed' | 'subscription' | 'variable' | 'reimbursement' | 'none' + kind: o recorte;
--   * nature = 'all' + kind: o total do tipo (despesa = conta + cartão; receita).
-- kind: 'expense' (despesa em conta e no cartão) ou 'income'.
-- SECURITY INVOKER: a RLS do chamador decide; quem não é da família recebe vazio.

create function public.recurrence_nature_summary(p_household uuid)
returns table (nature text, kind text, item_count integer, total_monthly numeric)
language sql stable security invoker set search_path = '' as $$
  with regras as (
    select coalesce(r.nature, 'none') as nature,
           case when r.kind = 'card' then 'expense' else r.kind end as kind,
           round(case r.freq_unit
                   when 'month' then r.amount / r.freq_every
                   when 'week'  then r.amount * 52 / (12 * r.freq_every)
                   else              r.amount * 365 / (12 * r.freq_every) end, 2) as monthly
      from public.recurrences r
      left join public.accounts a on a.household_id = r.household_id and a.id = r.account_id
     where r.household_id = p_household
       and (select private.is_member(p_household))
       and r.active
       and r.kind <> 'transfer'
       and (r.end_date is null or r.end_date >= (now() at time zone 'America/Sao_Paulo')::date)
       and (r.kind = 'card' or a.currency_code = 'BRL')
       and (r.kind = 'card' or a.active)
  )
  select coalesce(g.nature, 'all'), g.kind, count(*)::integer, sum(g.monthly)
    from regras g
   group by grouping sets ((g.nature, g.kind), (g.kind))
   order by 2, array_position(array['fixed','subscription','variable','reimbursement','none'], g.nature) nulls last
$$;
revoke execute on function public.recurrence_nature_summary(uuid) from public, anon;
grant execute on function public.recurrence_nature_summary(uuid) to authenticated;
