-- 131: o Calendário deixa de contar a parcela de consignado como saída do dia.
--
-- Problema: a parcela de consignado é descontada em folha, e a família lança o salário LÍQUIDO (dono, 16/11/2026). Contar a
-- parcela como saída do dia (bloco 3 de calendar_day_totals, migration 130) descontava a mesma coisa duas vezes. Os relatórios
-- (private.loan_schedule_planned) já deixavam o consignado de fora; o Calendário passa a fazer igual.
--
-- Solução: create or replace de public.calendar_day_totals com o mesmo corpo da 130 e uma condição a mais no bloco 3
-- (payment_method <> 'payroll'). Mesma assinatura, SECURITY INVOKER e grants (create or replace preserva); 00_audit não muda.
-- A tela continua mostrando a parcela de consignado na lista do dia, sem sinal e sem entrar nos totais.
-- Teste: 123_calendar_day_totals (asserção 131, falha sem esta migration).

create or replace function public.calendar_day_totals(p_household uuid, p_from date, p_to date)
returns table (day date, currency text, income numeric, expense numeric, bills numeric)
language plpgsql stable security invoker set search_path = '' as $$
#variable_conflict use_column
begin
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'período inválido' using errcode = '22023';
  end if;
  if p_to - p_from >= 62 then
    raise exception 'período longo demais: use no máximo 62 dias' using errcode = '22023';
  end if;
  return query
  with itens(day, currency, income, expense, bills) as (
    -- 1. lançamentos
    select t.date, coalesce(a.currency_code, 'BRL'),
           case when t.type = 'income' then t.amount else 0 end,
           case when t.type = 'expense' then t.amount else 0 end,
           0::numeric
      from public.transactions t
      left join public.accounts a on a.household_id = t.household_id and a.id = t.account_id
     where t.household_id = p_household and t.deleted_at is null
       and t.type in ('income', 'expense') and t.date between p_from and p_to
    union all
    -- 2. movimentos de cartão/dívida em conta
    select e.date, 'BRL',
           case when e.kind in ('disbursement', 'refund_cash') then e.amount else 0 end,
           case when e.kind in ('disbursement', 'refund_cash') then 0 else e.amount end,
           case when e.kind = 'payment'
                  -- juros e tarifa só são "da parcela" quando vêm na MESMA operação de um pagamento (debt_schedule_record_payment,
                  -- debt_pay com juros); sozinhos ou junto de uma amortização avulsa não são fatura nem parcela
                  or (e.kind in ('interest', 'fee') and e.op_id is not null and exists (
                        select 1 from public.debt_events p
                         where p.household_id = e.household_id and p.op_id = e.op_id
                           and p.kind = 'payment' and p.voided_at is null))
                then e.amount else 0 end
      from public.debt_events e
     where e.household_id = p_household and e.voided_at is null and e.account_id is not null
       and e.kind in ('payment', 'extra_principal', 'disbursement', 'refund_cash', 'interest', 'fee')
       and e.date between p_from and p_to
    union all
    -- 3. parcelas de dívida planejadas (menos o consignado)
    select s.due_date, 'BRL', 0::numeric, s.amount, s.amount
      from public.debt_payment_schedule s
      join public.debts d on d.household_id = s.household_id and d.id = s.debt_id
     where s.household_id = p_household and s.status = 'planned'
       and d.active and d.payment_method is not null
       -- consignado (desconto em folha) não sai da conta: o salário já entra líquido (decisão do dono de 16/11/2026)
       and d.payment_method <> 'payroll'
       and s.due_date between p_from and p_to
    union all
    -- 4. faturas que vencem, pelo que falta pagar
    select f.due_date, 'BRL', 0::numeric, f.remaining, f.remaining
      from public.card_invoices_due(p_household, p_from, p_to) f
     where f.remaining > 0
  )
  select i.day, i.currency, sum(i.income), sum(i.expense), sum(i.bills)
    from itens i
   where (select private.is_member(p_household))
   group by i.day, i.currency
  having sum(i.income) <> 0 or sum(i.expense) <> 0
   order by i.day, i.currency;
end $$;
