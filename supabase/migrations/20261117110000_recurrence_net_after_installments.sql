-- Tudo Azul — migration 141: "sobra deste mês depois das parcelas" dos recorrentes (entra − sai − parcelas do mês), no banco.
--
-- Pedido do dono (17/11/2026): a "sobra por mês" (migration 140) só conta o que se repete e fica MAIOR do que o que sobra de
-- verdade, porque as parcelas ficam de fora. O dono quis um segundo número, ciente de que as parcelas mudam de mês para mês: é
-- a "sobra DESTE mês", não "todo mês". O front não soma nem subtrai dinheiro, então a conta vem daqui.
--
-- public.recurrence_net_after_installments(p_household, p_as_of): UMA linha (nenhuma se a família não tem recorrente vigente em
-- reais, como em recurrence_net), com:
--   net_monthly        = a sobra por mês dos recorrentes (recurrence_net, migration 140), a mesma do card;
--   installments_month = as parcelas que VENCEM no mês de p_as_of (pagas e não pagas), só em reais, vindas de
--                        installment_month_summary (migration 120/121: compras parceladas no cartão e carnês/parcelamentos em
--                        conta), a mesma base do card "Parcelas e carnês": os números fecham com ele;
--   net_after          = net_monthly − installments_month (negativo quando passa);
--   ref_month          = o primeiro dia do mês de p_as_of (padrão: hoje, em São Paulo).
-- FICAM DE FORA, e a tela diz: empréstimos e financiamentos (parcelas de contrato de dívida; o consignado já sai do salário
-- líquido) e o que o recorrente não cobre. Parcela em outra moeda não entra (a conta é em reais).
-- SECURITY INVOKER; a RLS do chamador decide (as duas funções-base checam a família): quem não é da família recebe vazio.
-- Teste: 133_recurrence_net_after_installments (falha sem esta migration).

create function public.recurrence_net_after_installments(p_household uuid, p_as_of date default null)
returns table (net_monthly numeric, installments_month numeric, net_after numeric, ref_month date)
language sql stable security invoker set search_path = '' as $$
  select n.net_monthly,
         coalesce(s.month_total, 0),
         n.net_monthly - coalesce(s.month_total, 0),
         date_trunc('month', coalesce(p_as_of, (now() at time zone 'America/Sao_Paulo')::date)::timestamp)::date
    from public.recurrence_net(p_household) n
    left join public.installment_month_summary(p_household, p_as_of) s on s.currency_code = 'BRL'
$$;
revoke execute on function public.recurrence_net_after_installments(uuid, date) from public, anon;
grant execute on function public.recurrence_net_after_installments(uuid, date) to authenticated;
