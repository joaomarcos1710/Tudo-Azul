-- Tudo Azul — migration 023: total das faturas do mês, somando todos os cartões
--
-- Pedido do dono (30/10/2026): na tela inicial, onde aparecem os cartões, mostrar o total do mês somando todos
-- (como o "Faturas de Novembro" do Organizze). O front não soma dinheiro de relatório: a soma vem do banco.
--
-- O que esta migration acrescenta (nada é alterado nem apagado nas migrations anteriores):
--   card_invoices_month(p_household, p_month)  das faturas de todos os cartões da família (card_months, a mesma fonte
--     da tela de Cartões) as que VENCEM no mês de p_month: quantas são, o total (cobrado + a cobrar), quanto já foi pago
--     (inclui adiantamento aplicado) e quanto falta pagar (por fatura, nunca negativo: fatura paga a maior não abate
--     a de outra). Mês por VENCIMENTO, como o Organizze ("Venc. 28/11"): é o que sai do bolso naquele mês, e difere do mês
--     de fechamento que a tela de Cartões usa nos rótulos. Fatura de cartão sem ciclo (sem vencimento) não entra.
--
-- SECURITY INVOKER, só leitura; o chamador precisa ser membro da família (card_months já recusa quem não é).

create function public.card_invoices_month(p_household uuid, p_month date)
returns table (invoices integer, total numeric, paid numeric, remaining numeric)
language sql stable security invoker set search_path = '' as $$
  select count(m.label)::int,
         coalesce(sum(m.total), 0),
         coalesce(sum(m.paid), 0),
         coalesce(sum(greatest(m.total - m.paid, 0)), 0)
    from public.debts d
   cross join lateral public.card_months(d.id) m
   where d.household_id = p_household and d.kind = 'card'
     and (select private.is_member(p_household))
     and m.due_date >= date_trunc('month', p_month)::date
     and m.due_date <  (date_trunc('month', p_month) + interval '1 month')::date
$$;

revoke execute on function public.card_invoices_month(uuid, date) from public, anon;
grant execute on function public.card_invoices_month(uuid, date) to authenticated;
