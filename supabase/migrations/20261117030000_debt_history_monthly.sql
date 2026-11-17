-- 133: saldo das dívidas mês a mês (empréstimo e financiamento), para os gráficos "Dívidas × Investimentos" (Análises)
-- e "Evolução das dívidas" (Dívidas). Pedido do dono de 17/11/2026: sem cartão, 12 meses.
--
-- Por que no banco: o total de dívidas por mês é dinheiro somado, e o front não soma dinheiro. O número pronto de
-- net_worth_with_assets inclui o cartão (que sobe e desce com a fatura todo mês), e o dono pediu a linha sem ele.
--
-- public.debt_history_monthly(p_household, p_until, p_months)
--   Uma linha por mês e por empréstimo/financiamento que já existia na data (o mês em que a dívida ainda não tinha sido
--   cadastrada não aparece: no gráfico vira vazio, nunca zero), mais uma linha de total por mês (debt_id nulo, só nos
--   meses com pelo menos uma dívida). Cada mês vale no último dia dele; o mês de p_until vale em p_until.
--   O saldo é o de public.debt_balances (o mesmo da tela de Dívidas e do patrimônio), com a correção pelo extrato
--   (migration 132) a partir da data dela. Dívida arquivada continua no passado (ela existia).
--   retorno: month ('AAAA-MM'), as_of, debt_id (nulo = total), name, debt (saldo devedor, nunca negativo).
--   p_until nulo ou p_months fora de 1..36: 22023. Quem não é da família recebe zero linhas (debt_balances já filtra).
-- Teste: 125_debt_history_monthly (falha sem esta migration).

create function public.debt_history_monthly(p_household uuid, p_until date, p_months integer default 12)
returns table (month text, as_of date, debt_id uuid, name text, debt numeric)
language plpgsql stable security invoker set search_path = '' as $$
#variable_conflict use_column
begin
  if p_until is null or p_months is null or p_months < 1 or p_months > 36 then
    raise exception 'período inválido: até 36 meses' using errcode = '22023';
  end if;
  return query
  with meses as (
    select to_char(m, 'YYYY-MM') as month,
           least((m + interval '1 month - 1 day')::date, p_until) as as_of
      from generate_series(date_trunc('month', p_until) - make_interval(months => p_months - 1),
                           date_trunc('month', p_until), interval '1 month') m
  ), linhas as (
    select ms.month, ms.as_of, b.debt_id, b.name, b.debt
      from meses ms
      cross join lateral public.debt_balances(p_household, ms.as_of) b
     where b.kind in ('loan', 'financing')
  )
  , todas as (
    select l.month, l.as_of, l.debt_id, l.name, l.debt from linhas l
    union all
    select l.month, l.as_of, null::uuid, 'Total'::text, sum(l.debt) from linhas l group by l.month, l.as_of
  )
  -- por mês; dentro do mês, as dívidas por nome e o total por último
  select t.month, t.as_of, t.debt_id, t.name, t.debt from todas t
  order by t.month, t.debt_id is null, t.name;
end $$;

revoke execute on function public.debt_history_monthly(uuid, date, integer) from public, anon;
grant execute on function public.debt_history_monthly(uuid, date, integer) to authenticated;
