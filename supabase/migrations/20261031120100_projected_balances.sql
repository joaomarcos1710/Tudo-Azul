-- Tudo Azul — migration 025: faturas por vencimento (Calendário) e saldo projetado
--
-- Pedido do dono (30/10/2026):
--   * a fatura do cartão que vence dia 28 deve aparecer no Calendário no dia 28, como planejada;
--   * o saldo (total e por conta) deve existir também em meses futuros, "só efetuados" ou "efetuados + planejados".
-- Decisão do dono: no saldo "efetuados + planejados", a fatura do cartão DESCONTA da conta que o paga (migration 024)
-- no dia do vencimento, como se já estivesse paga.
--
-- O que esta migration acrescenta (nada é alterado nem apagado nas migrations anteriores; tudo SECURITY INVOKER, só leitura,
-- e a soma é do banco: o front nunca soma saldos):
--   1. card_invoices_due(p_household, p_from, p_to): uma linha por fatura de cartão que VENCE no período, com total, pago, falta
--      (nunca negativo) e a conta pagadora (null = cartão sem conta escolhida). Mesma fonte da tela de Cartões (card_months).
--   2. account_balances_projected(p_household, p_as_of, p_include_planned): por conta, o saldo efetuado (account_balances), o
--      que falta pagar nos planejados até a data (lançamentos 'planned' não excluídos, inclusive os vencidos e as
--      transferências entre contas), as faturas que vencem até a data nos cartões que a conta paga, e o saldo projetado.
--      Com p_include_planned = false, planejado e faturas vêm zerados e o saldo é igual ao de account_balances.
--   3. balance_totals_projected(p_household, p_as_of, p_include_planned): o total das contas. As faturas de TODOS os cartões
--      descontam do total, inclusive as dos cartões sem conta de pagamento escolhida (ficam em "unassigned_invoices": entram
--      só no total, nunca em uma conta).
--
-- Limites conhecidos (documentados na tela e no diário): assinatura de cartão ainda não gerada (a compra só nasce no dia) e o saldo
-- das faturas que já existiam antes do app (âncora do cartão) não entram nas faturas projetadas.
--
-- Testes: 32_projected_balances.

create function public.card_invoices_due(p_household uuid, p_from date, p_to date)
returns table (debt_id uuid, card_name text, due_date date, total numeric, paid numeric, remaining numeric, pay_account_id uuid)
language sql stable security invoker set search_path = '' as $$
  select d.id, d.name, m.due_date, m.total, m.paid, greatest(m.total - m.paid, 0), d.pay_account_id
    from public.debts d
   cross join lateral public.card_months(d.id) m
   where d.household_id = p_household and d.kind = 'card'
     and (select private.is_member(p_household))
     and m.due_date between p_from and p_to
   order by m.due_date, d.name
$$;

create function public.account_balances_projected(p_household uuid, p_as_of date, p_include_planned boolean default true)
returns table (account_id uuid, name text, type text, active boolean,
               realized numeric, planned numeric, invoices numeric, balance numeric)
language sql stable security invoker set search_path = '' as $$
  select b.account_id, b.name, b.type, b.active, b.balance,
         case when p_include_planned then coalesce(pl.delta, 0) else 0 end,
         case when p_include_planned then coalesce(inv.rem, 0) else 0 end,
         b.balance
           + case when p_include_planned then coalesce(pl.delta, 0) else 0 end
           - case when p_include_planned then coalesce(inv.rem, 0) else 0 end
    from public.account_balances(p_household, p_as_of) b
    join public.accounts a on a.id = b.account_id
    left join lateral (
      select sum(case
               when t.type = 'income'   and t.account_id = a.id             then  t.amount
               when t.type = 'expense'  and t.account_id = a.id             then -t.amount
               when t.type = 'transfer' and t.account_id = a.id             then -t.amount
               when t.type = 'transfer' and t.destination_account_id = a.id then  t.amount
             end) as delta
        from public.transactions t
       where t.household_id = a.household_id and t.deleted_at is null and t.status = 'planned'
         and t.date >= a.opening_date and t.date <= p_as_of
         and (t.account_id = a.id or t.destination_account_id = a.id)
    ) pl on true
    left join lateral (
      select sum(greatest(m.total - m.paid, 0)) as rem
        from public.debts d
       cross join lateral public.card_months(d.id) m
       where d.household_id = a.household_id and d.kind = 'card' and d.pay_account_id = a.id
         and m.due_date <= p_as_of
    ) inv on true
   where (select private.is_member(p_household))
   order by b.name
$$;

create function public.balance_totals_projected(p_household uuid, p_as_of date, p_include_planned boolean default true)
returns table (realized numeric, planned numeric, invoices numeric, unassigned_invoices numeric, total numeric)
language sql stable security invoker set search_path = '' as $$
  with c as (
    select coalesce(sum(b.realized), 0) as realized, coalesce(sum(b.planned), 0) as planned
      from public.account_balances_projected(p_household, p_as_of, p_include_planned) b
  ), f as (
    select coalesce(sum(greatest(m.total - m.paid, 0)), 0) as todas,
           coalesce(sum(greatest(m.total - m.paid, 0)) filter (where d.pay_account_id is null), 0) as sem_conta
      from public.debts d
     cross join lateral public.card_months(d.id) m
     where d.household_id = p_household and d.kind = 'card' and m.due_date <= p_as_of
  )
  select c.realized, c.planned,
         case when p_include_planned then f.todas else 0 end,
         case when p_include_planned then f.sem_conta else 0 end,
         c.realized + c.planned - case when p_include_planned then f.todas else 0 end
    from c cross join f
   where (select private.is_member(p_household))
$$;

revoke execute on function public.card_invoices_due(uuid, date, date), public.account_balances_projected(uuid, date, boolean),
  public.balance_totals_projected(uuid, date, boolean) from public, anon;
grant execute on function public.card_invoices_due(uuid, date, date), public.account_balances_projected(uuid, date, boolean),
  public.balance_totals_projected(uuid, date, boolean) to authenticated;
