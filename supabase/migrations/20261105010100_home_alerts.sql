-- Tudo Azul — migration 057: avisos do topo do Início (como os cartões de aviso do Organizze).
--
-- Pedido do dono (05/11/2026): uma faixa no topo do Início que só aparece quando há algo a dizer — a receber e a pagar
-- nos próximos 7 dias, fatura de cartão que vence em até 7 dias e os vencidos. Contagens e totais vêm do banco.
--
-- O que já existia e foi reaproveitado (nada é alterado):
--   * card_invoices_due (migration 025): as faturas que vencem no período, da mesma fonte da tela de Cartões
--     (card_months); o aviso usa o que FALTA pagar (remaining), como o aviso diário (daily_digest);
--   * a regra do daily_digest (049/056) para os planejados: lançamentos 'planned' fora da lixeira só de contas BRL e
--     parcelas de dívida ativa ainda planejadas (debt_payment_schedule).
-- Por que uma função nova e não o daily_digest: ele olha só "vencidos" e "hoje", soma só as saídas e não separa
-- receita de despesa nem traz o cartão de cada fatura; mudar o retorno dele quebraria a Edge Function do e-mail.
--
-- public.home_alerts(p_household, p_today): uma linha por aviso, só quando há o que avisar.
--   kind = 'overdue_payable'    planejados de saída com data < hoje (despesas e parcelas de dívida)
--          'overdue_receivable' planejados de entrada com data < hoje
--          'invoice'            uma linha por fatura de cartão com saldo a pagar que vence de hoje a hoje + 7
--          'payable'            planejados de saída de hoje a hoje + 7 (inclui os recorrentes já gerados e parcelas de dívida)
--          'receivable'         planejados de entrada de hoje a hoje + 7
--   item_count, total (soma do banco), first_date (o mais antigo/próximo), target_id e target_name (só na fatura: o cartão).
-- Transferência planejada não é "a pagar" nem "a receber": fica fora (continua no card de vencidos do Início).
-- atalho: conta em outra moeda (USD/EUR) fica fora dos avisos (relatórios em reais ignoram contas não-BRL, F1/F2);
-- melhorar quando o Início tiver bloco por moeda (F3+).
--
-- Teste: 57_home_alerts.

create function public.home_alerts(p_household uuid, p_today date)
returns table (kind text, item_count integer, total numeric, first_date date, target_id uuid, target_name text)
language sql stable security invoker set search_path = '' as $$
  with lanc as (
    select t.date, t.type, t.amount
      from public.transactions t
     where t.household_id = p_household and t.status = 'planned' and t.deleted_at is null
       and t.type in ('income', 'expense') and t.date <= p_today + 7
       and exists (select 1 from public.accounts ac where ac.household_id = t.household_id and ac.id = t.account_id
                     and ac.currency_code = 'BRL')
  ), parc as (
    select s.due_date as date, s.amount
      from public.debt_payment_schedule s
      join public.debts d on d.household_id = s.household_id and d.id = s.debt_id and d.active
     where s.household_id = p_household and s.status = 'planned' and s.due_date <= p_today + 7
  ), itens as (
    select case when l.date < p_today then 'overdue_' else '' end
             || case when l.type = 'income' then 'receivable' else 'payable' end as kind,
           l.date, l.amount
      from lanc l
    union all
    select case when p.date < p_today then 'overdue_payable' else 'payable' end, p.date, p.amount
      from parc p
  ), avisos as (
    select i.kind, count(*)::integer as item_count, sum(i.amount) as total, min(i.date) as first_date,
           null::uuid as target_id, null::text as target_name,
           case i.kind when 'overdue_payable' then 1 when 'overdue_receivable' then 2 when 'payable' then 4 else 5 end as ord
      from itens i
     group by i.kind
    union all
    select 'invoice', 1, f.remaining, f.due_date, f.debt_id, f.card_name, 3
      from public.card_invoices_due(p_household, p_today, p_today + 7) f
     where f.remaining > 0
  )
  select a.kind, a.item_count, a.total, a.first_date, a.target_id, a.target_name
    from avisos a
   where (select private.is_member(p_household))
   order by a.ord, a.first_date, a.target_name
$$;

revoke execute on function public.home_alerts(uuid, date) from public, anon;
grant execute on function public.home_alerts(uuid, date) to authenticated;
