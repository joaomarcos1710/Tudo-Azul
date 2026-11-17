-- Tudo Azul — migration 140: "sobra por mês" dos recorrentes (entra − sai), somada no banco.
--
-- Pedido do dono (17/11/2026, pendência registrada na #416): no card do topo de Recorrentes, além de "Sai ≈" e "Entra ≈", a
-- diferença entre os dois. O front não soma nem subtrai dinheiro de relatório, então a conta vem daqui.
--
-- public.recurrence_net(p_household): UMA linha (ou nenhuma, se a família não tem recorrente vigente em reais):
--   income_monthly  = o "Entra ≈" por mês;     expense_monthly = o "Sai ≈" por mês (conta + cartão);
--   net_monthly     = income_monthly − expense_monthly (negativo quando sai mais do que entra);
--   net_yearly      = a mesma diferença no ano (valor × ocorrências por ano, exato por regra: não é 12 × o mensal).
-- Sai da MESMA base de public.recurrence_overview (migration 116, recorte 'all'): os números fecham com o topo da tela por
-- construção. Regra ativa, data final não passada, só em reais, transferência fora.
-- Só recorrentes: parcelas (parcelamentos, financiamentos), proventos previstos de investimento e o que varia fora de um recorrente
-- NÃO entram, nem em "Sai" nem em "Entra". A tela diz isso ao lado do número.
-- SECURITY INVOKER: a RLS do chamador decide; quem não é da família recebe vazio.
-- Teste: 132_recurrence_net (falha sem esta migration).

create function public.recurrence_net(p_household uuid)
returns table (income_monthly numeric, expense_monthly numeric, net_monthly numeric, net_yearly numeric)
language sql stable security invoker set search_path = '' as $$
  select coalesce(sum(o.total_monthly) filter (where o.kind = 'income'), 0),
         coalesce(sum(o.total_monthly) filter (where o.kind = 'expense'), 0),
         coalesce(sum(o.total_monthly) filter (where o.kind = 'income'), 0) - coalesce(sum(o.total_monthly) filter (where o.kind = 'expense'), 0),
         coalesce(sum(o.total_yearly) filter (where o.kind = 'income'), 0) - coalesce(sum(o.total_yearly) filter (where o.kind = 'expense'), 0)
    from public.recurrence_overview(p_household) o
   where o.klass = 'all'
  having count(*) > 0
$$;
revoke execute on function public.recurrence_net(uuid) from public, anon;
grant execute on function public.recurrence_net(uuid) to authenticated;
