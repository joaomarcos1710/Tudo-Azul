-- Tudo Azul — migration 135: faixa de pendências sem cartão arquivado (achado do revisor-dinheiro na #409).
--
-- A 134 (já aplicada; não se edita) pegava a fatura de qualquer cartão, inclusive ARQUIVADO. Cartão arquivado sempre tem
-- saldo 0 (debt_archive exige), então tudo o que aparece dele na faixa é fantasma. Agora: `and d.active`, como a parcela
-- de contrato já fazia. Mesma assinatura, SECURITY INVOKER e grants (create or replace preserva); 00_audit não muda.
--
-- atalho: vencido fantasma de cartão ATIVO. Quando um pagamento vinculado a uma fatura mais nova cobre também o que ficou
-- em aberto numa anterior, public.card_months manda a sobra só para as faturas SEGUINTES (adiantamento): a anterior
-- continua com saldo e a faixa mostra "vencido" com a dívida zerada (o mesmo número já aparece em home_alerts,
-- Calendário e saldo previsto). A causa é da card_months; corrigir lá, numa PR própria (PR B, 40 - Pendências).
-- atalho: o saldo de referência do cartão (fatura que já existia antes do cadastro no app) não entra, como em
-- card_invoices_due (migration 025); a tela avisa. Melhorar se o dono pedir.
-- Teste: 127_pending_strip_active (o caso do cartão arquivado falha sem esta migration).

create or replace function public.pending_strip(p_household uuid, p_today date, p_until date)
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
     where d.household_id = p_household and d.kind = 'card' and d.active
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
