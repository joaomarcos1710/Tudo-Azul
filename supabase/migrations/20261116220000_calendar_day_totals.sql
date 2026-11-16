-- 130: totais de cada dia do Calendário, somados no banco (o front não soma dinheiro).
--
-- Problema (Calendário financeiro, decisão do dono de 16/11/2026): a grade passa a mostrar, dentro de cada dia, quanto
-- entra e quanto sai, e o painel do dia ganha um resumo "Entradas / Saídas". Somar os itens no front quebraria a regra do
-- projeto; esta função devolve os totais já somados, a partir dos MESMOS quatro blocos que a lista do dia mostra:
--   1. lançamentos (transactions) não apagados, pagos e planejados: receita entra, despesa sai; transferência fica fora
--      (é dinheiro mudando de conta, não entra nem sai da família). Moeda: a da conta.
--   2. movimentos de cartão/dívida que mexem em conta (debt_events não anulados, com conta): crédito e devolução entram;
--      pagamento, amortização, juros e tarifa saem. Em reais, como na lista.
--   3. parcelas de dívida PLANEJADAS (debt_payment_schedule) de dívida ativa com forma de pagamento: saem, em reais.
--   4. faturas de cartão que vencem no dia, pelo que ainda falta pagar (card_invoices_due.remaining > 0): saem, em reais.
--
-- public.calendar_day_totals(p_household, p_from, p_to)
--   retorno: day, currency, income (entradas do dia), expense (saídas do dia) e bills (a parte das saídas que é fatura ou
--   parcela: blocos 3 e 4 e, do bloco 2, o pagamento de cartão/dívida com os juros e a tarifa da MESMA operação (op_id);
--   amortização avulsa e juros ou tarifa sozinhos saem, mas não são parcela; para o filtro "Faturas e Parcelas").
--   Só dias com algo.
--   Valores em reais decimais (numeric), como as demais funções; o front converte para centavos.
--   p_from/p_to nulos ou p_to < p_from: 22023. Mais de 62 dias contando as duas pontas: 22023 (a tela pede um mês).
--   Quem não é da família recebe zero linhas.
-- Teste: 123_calendar_day_totals (falha sem esta migration).

create function public.calendar_day_totals(p_household uuid, p_from date, p_to date)
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
    -- 3. parcelas de dívida planejadas
    select s.due_date, 'BRL', 0::numeric, s.amount, s.amount
      from public.debt_payment_schedule s
      join public.debts d on d.household_id = s.household_id and d.id = s.debt_id
     where s.household_id = p_household and s.status = 'planned'
       and d.active and d.payment_method is not null
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

revoke execute on function public.calendar_day_totals(uuid, date, date) from public, anon;
grant execute on function public.calendar_day_totals(uuid, date, date) to authenticated;
