-- Card "Parcelas e carnês" (Recorrentes › Saídas): quanto os parcelamentos pesam NESTE mês, por moeda, somado no banco.
--
-- Leitura pura (STABLE, SECURITY INVOKER), sem repetir regra: junta as duas funções que já existem,
--   * public.active_installment_plans (20261112130000): quais parcelamentos são ativos, a descrição e o valor da parcela atual;
--   * public.installment_plan_schedule (20261114120000): as parcelas vivas de cada um, com a situação e se vencem no mês.
-- Assim "ativo", "viva" e "paga" são, por construção, os mesmos das duas telas de Parcelas ativas; a tela não soma dinheiro.
-- Família conferida lá dentro (private.is_member) e a RLS decide o resto; sem família: 22023.
--
-- Uma linha por moeda (cartão é sempre BRL; parcela em conta usa a moeda da conta; moedas nunca se misturam):
--   active_count   parcelamentos ativos
--   month_count    quantos deles têm parcela que vence no mês de p_as_of (cartão: pelo vencimento da fatura; conta: pela data)
--   month_total    soma do valor líquido das parcelas que vencem no mês (pagas e não pagas)
--   paid_total     a parte que já está paga
--   pending_total  a parte que falta pagar (month_total - paid_total; inclui a vencida e não paga)
--   examples       até 3 descrições, dos parcelamentos de maior parcela atual (empate: ordem alfabética)
-- Sem parcelamento ativo não há linha.

create function public.installment_month_summary(p_household uuid, p_as_of date default null)
returns table (
  currency_code text,
  active_count integer,
  month_count integer,
  month_total numeric,
  paid_total numeric,
  pending_total numeric,
  examples text[]
)
language sql
stable
security invoker
set search_path = ''
as $function$
  with planos as (
    select a.currency_code, a.plan_key, a.description, a.installment_amount
      from public.active_installment_plans(p_household, p_as_of) a
     where a.row_kind = 'plan'
  ),
  mes as (
    select s.currency_code, s.plan_key, s.amount, s.state
      from public.installment_plan_schedule(p_household, p_as_of) s
     where s.in_month
  )
  select p.currency_code,
         count(*)::integer,
         (select count(distinct m.plan_key)::integer from mes m where m.currency_code = p.currency_code),
         coalesce((select sum(m.amount) from mes m where m.currency_code = p.currency_code), 0),
         coalesce((select sum(m.amount) from mes m where m.currency_code = p.currency_code and m.state = 'paid'), 0),
         coalesce((select sum(m.amount) from mes m where m.currency_code = p.currency_code and m.state <> 'paid'), 0),
         (array_agg(p.description order by p.installment_amount desc nulls last, p.description))[1:3]
    from planos p
   group by p.currency_code
   order by p.currency_code;
$function$;

revoke execute on function public.installment_month_summary(uuid, date) from public, anon;
grant execute on function public.installment_month_summary(uuid, date) to authenticated;
