-- Tudo Azul — migration 134: faixa de pendências no topo de Lançamentos (handoff "Extrato e Gastos", item c).
--
-- Decisões do dono (17/11/2026):
--   * fatura do cartão entra no "a pagar" só FECHADA (fechamento <= hoje) e com saldo a pagar; a aberta ainda muda;
--   * parcela planejada de empréstimo/financiamento entra, MENOS o desconto em folha (payroll): o salário entra líquido,
--     então o consignado nunca sai da conta (mesma regra do Calendário, migration 131);
--   * "a pagar" e "a receber" vão de hoje até o fim do mês (p_until, o último dia do mês que a tela mostra);
--   * a faixa só aparece no mês atual (decisão de tela; aqui só o p_today e o p_until).
-- Vencidos a pagar e a receber ficam separados (somar o que sai com o que entra não diz nada).
--
-- public.pending_strip(p_household, p_today, p_until): uma linha por tipo, só quando há o que mostrar.
--   kind = 'overdue_payable'    planejados de saída com data < hoje: despesas, parcelas (sem payroll) e faturas fechadas
--                               com saldo cujo vencimento passou
--          'overdue_receivable' receitas planejadas com data < hoje
--          'payable'            o mesmo de saída, de hoje a p_until
--          'receivable'         receitas planejadas de hoje a p_until
--   item_count, total (soma do banco: a tela não soma dinheiro) e first_date (o mais antigo ou o próximo).
-- Reaproveita as regras do home_alerts (migration 057; nada dele muda): lançamento 'planned' fora da lixeira, só de conta
-- BRL; transferência fica fora; parcela de dívida ativa (debt_payment_schedule 'planned'); fatura pela conta de
-- card_invoices_due (card_months, a fonte da tela Cartões): o que FALTA pagar.
-- atalho: conta em outra moeda fica fora, como no home_alerts; melhorar com o bloco por moeda (F3+).
-- Teste: 126_pending_strip (falha sem esta migration).

create function public.pending_strip(p_household uuid, p_today date, p_until date)
returns table (kind text, item_count integer, total numeric, first_date date)
language plpgsql stable security invoker set search_path = '' as $$
begin
  if p_today is null or p_until is null or p_until < p_today then
    raise exception 'período inválido' using errcode = '22023';
  end if;
  return query
  with lanc as (
    select t.date, t.type, t.amount
      from public.transactions t
     where t.household_id = p_household and t.status = 'planned' and t.deleted_at is null
       and t.type in ('income', 'expense') and t.date <= p_until
       and exists (select 1 from public.accounts ac where ac.household_id = t.household_id and ac.id = t.account_id
                     and ac.currency_code = 'BRL')
  ), parc as (
    select s.due_date as date, s.amount
      from public.debt_payment_schedule s
      join public.debts d on d.household_id = s.household_id and d.id = s.debt_id and d.active
     where s.household_id = p_household and s.status = 'planned' and s.due_date <= p_until
       and d.payment_method is distinct from 'payroll'
  ), fat as (
    -- só fechada: o fechamento já passou (ou é hoje) e ainda falta pagar; a mesma conta de card_invoices_due (card_months)
    select m.due_date as date, m.total - m.paid as amount
      from public.debts d
     cross join lateral public.card_months(d.id) m
     where d.household_id = p_household and d.kind = 'card'
       and m.closing_date <= p_today and m.due_date <= p_until and m.total - m.paid > 0
  ), itens as (
    select case when l.date < p_today then 'overdue_' else '' end
             || case when l.type = 'income' then 'receivable' else 'payable' end as k,
           l.date, l.amount
      from lanc l
    union all
    select case when p.date < p_today then 'overdue_payable' else 'payable' end, p.date, p.amount from parc p
    union all
    select case when f.date < p_today then 'overdue_payable' else 'payable' end, f.date, f.amount from fat f
  )
  select i.k, count(*)::integer, sum(i.amount), min(i.date)
    from itens i
   where (select private.is_member(p_household))
   group by i.k
   order by case i.k when 'overdue_payable' then 1 when 'overdue_receivable' then 2 when 'payable' then 3 else 4 end;
end $$;

revoke execute on function public.pending_strip(uuid, date, date) from public, anon;
grant execute on function public.pending_strip(uuid, date, date) to authenticated;
