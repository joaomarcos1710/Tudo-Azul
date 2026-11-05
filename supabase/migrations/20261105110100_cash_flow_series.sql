-- Tudo Azul — migration 066: Entradas x Saídas em REGIME DE CAIXA, só do período escolhido, com o saldo, numa chamada
-- só (public.cash_flow_series)
--
-- Pedidos do dono (05/11/2026, #179, referência do Relatório "Entradas x Saídas" do Organizze):
--   1. o período é a escolha principal e a divisão (diário, semanal, mensal, acumulado) só fatia esse período;
--   2. "28/11 R$ 0,00 — você não está considerando o valor do cartão de crédito no dia do pagamento dele": em produção, as
--      compras de cartão entravam como saída no FECHAMENTO de cada fatura (18/11 e 22/11) e o dia do pagamento (28/11)
--      ficava zerado; no Organizze, 28/11 mostra a saída. Entradas x Saídas tem a coluna Saldo, então é fluxo de CAIXA:
--      mostra o dinheiro saindo da conta.
-- Antes, a tela pedia o fluxo a cash_flow_report e o saldo a balance_totals_projected UMA VEZ POR LINHA (até 31 chamadas
-- no diário; pendência "Saldo em uma chamada só" da #171), e não havia o "acumulado".
--
-- REGRA DE CAIXA (só nesta função; cash_flow_report, period_summary, orçamento, relatórios por categoria e totais do mês
-- continuam na data da fatura, como manda a 062):
--   * lançamentos (receita e despesa, só reais, transferência fora): como em cash_flow_report.
--   * cartão: a compra NÃO é saída no fechamento (charge/credit de cartão ficam fora, e o crédito avulso income_credit
--     também, porque estorno e crédito já estão dentro do total da fatura, card_months). A saída é o PAGAMENTO da fatura
--     (debt_events payment/extra_principal do cartão, na data e da conta do pagamento, como em account_balances); a
--     devolução em dinheiro de crédito do cartão (refund_cash) volta como saída negativa. Juros e tarifa (que saem de uma
--     conta, fora da fatura) continuam na data deles. Nunca os dois: compra OU pagamento.
--   * "considerar não pagos": o que falta pagar de cada fatura (greatest(total − pago, 0) de card_months) é saída
--     PLANEJADA no VENCIMENTO (a mesma conta que balance_totals_projected desconta do saldo a partir do vencimento), com a
--     conta de pagamento do cartão no filtro de conta; sem autor (fica fora com filtro de quem lançou). Os planejados de
--     lançamento e a parcela planejada do contrato de empréstimo: como em cash_flow_report.
--   * empréstimo/financiamento: o principal pago na data do pagamento (private.loan_principal_items, 046), juros e tarifa
--     na data deles; consignado não conta. Igual a cash_flow_report.
-- Assim o Saldo de cada linha (balance_totals_projected no fim dela) anda junto com o resultado: só pagos, a fatura sai da
-- conta no pagamento; com não pagos, a fatura a pagar sai do saldo no vencimento.
--
-- Colunas de cada linha:
--   period_start / period_end : o balde inteiro (dia; segunda a domingo; dia 1 ao último do mês; no 'total', de p_from a
--                               p_to). A 1ª e a última semana (e mês) podem passar do período: só os RÓTULOS. Os valores
--                               contam só os dias de p_from a p_to.
--   income / expense / result  : entradas, saídas e entradas − saídas da linha.
--   closing_balance            : saldo total em reais no último dia da linha, cortado em p_to
--                               (balance_totals_projected(..., least(period_end, p_to), p_include_planned).total). Nulo com
--                               filtro de conta ou de quem lançou: aquela função não filtra (pendência à parte).
--   total_income / total_expense / total_result : o período inteiro, repetidos em toda linha (o front não soma).
-- p_step: 'day' | 'week' | 'month' | 'total' (acumulado: uma linha só). Limites de cash_flow_report (dia: até 366 dias;
-- os demais: até 10 anos), recusa 22023. SECURITY INVOKER + is_member: quem não é da família recebe zero linhas; só
-- authenticated executa. Nenhuma migration anterior é editada. Teste: 66_cash_flow_series.

create function public.cash_flow_series(
  p_household uuid, p_from date, p_to date, p_step text default 'day',
  p_accounts uuid[] default null, p_member uuid default null, p_include_planned boolean default false)
returns table (period_start date, period_end date, income numeric, expense numeric, result numeric,
               closing_balance numeric, total_income numeric, total_expense numeric, total_result numeric)
language plpgsql stable security invoker set search_path = '' as $$
begin
  if p_step is null or p_step not in ('day', 'week', 'month', 'total') then
    raise exception 'divisão inválida: use day, week, month ou total' using errcode = '22023';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 3660 or (p_step = 'day' and p_to - p_from > 366) then
    raise exception 'período inválido (dia: até 366 dias; semana, mês e acumulado: até 10 anos)' using errcode = '22023';
  end if;
  return query
  with itens as (
    -- lançamentos de contas em reais (igual a cash_flow_report)
    select t.date as dia, t.type as tipo, t.amount as valor
      from public.transactions t
     where t.household_id = p_household and t.deleted_at is null and t.type in ('income', 'expense')
       and t.date between p_from and p_to
       and (t.status = 'paid' or (p_include_planned and t.status = 'planned'))
       and (p_accounts is null or t.account_id = any(p_accounts))
       and (p_member is null or t.created_by = p_member)
       and exists (select 1 from public.accounts ac where ac.household_id = t.household_id and ac.id = t.account_id
                     and ac.currency_code = 'BRL')
    union all
    -- juros e tarifas (de qualquer dívida: saem de uma conta na data deles); compra/estorno só de dívida que não é cartão
    select e.date, 'expense', case when e.kind = 'credit' then -e.amount else e.amount end
      from public.debt_events e
      join public.debts d on d.household_id = e.household_id and d.id = e.debt_id
     where e.household_id = p_household and e.voided_at is null
       and (e.kind in ('interest', 'fee') or (e.kind in ('charge', 'credit') and d.kind <> 'card'))
       and e.date between p_from and p_to
       and (p_accounts is null or e.account_id = any(p_accounts))
       and (p_member is null or e.created_by = p_member)
    union all
    -- cartão em caixa: o pagamento da fatura (e a antecipação) sai da conta na data dele; a devolução em dinheiro volta
    select e.date, 'expense', case when e.kind = 'refund_cash' then -e.amount else e.amount end
      from public.debt_events e
      join public.debts d on d.household_id = e.household_id and d.id = e.debt_id and d.kind = 'card'
     where e.household_id = p_household and e.voided_at is null
       and e.kind in ('payment', 'extra_principal', 'refund_cash')
       and e.date between p_from and p_to
       and (p_accounts is null or e.account_id = any(p_accounts))
       and (p_member is null or e.created_by = p_member)
    union all
    -- não pagos: o que falta pagar de cada fatura, no vencimento (a mesma base de balance_totals_projected)
    select m.due_date, 'expense', greatest(m.total - m.paid, 0)
      from public.debts d
     cross join lateral public.card_months(d.id) m
     where p_include_planned and p_member is null
       and d.household_id = p_household and d.kind = 'card'
       and m.due_date between p_from and p_to and m.total > m.paid
       and (p_accounts is null or d.pay_account_id = any(p_accounts))
    union all
    -- principal pago de empréstimo/financiamento (migration 046)
    select l.day, 'expense', l.amount
      from private.loan_principal_items(p_household, p_from, p_to) l
     where (p_accounts is null or l.account_id = any(p_accounts))
       and (p_member is null or l.created_by = p_member)
    union all
    -- parcela planejada do contrato (ainda não baixada)
    select s.day, 'expense', s.amount
      from private.loan_schedule_planned(p_household, p_from, p_to) s
     where p_include_planned and p_member is null
       and (p_accounts is null or s.account_id = any(p_accounts))
  ), baldes as (
    select distinct (case p_step when 'day' then g::date when 'week' then date_trunc('week', g)::date
                                 when 'month' then date_trunc('month', g)::date else p_from end) as ini
      from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g
  ), linhas as (
    select b.ini,
           case p_step when 'day' then b.ini when 'week' then b.ini + 6
                       when 'month' then ((b.ini + interval '1 month')::date - 1) else p_to end as fim,
           coalesce(sum(x.valor) filter (where x.tipo = 'income'), 0) as ent,
           coalesce(sum(x.valor) filter (where x.tipo = 'expense'), 0) as sai
      from baldes b
      left join itens x on (case p_step when 'day' then x.dia when 'week' then date_trunc('week', x.dia)::date
                                        when 'month' then date_trunc('month', x.dia)::date else p_from end) = b.ini
     group by b.ini
  )
  select l.ini, l.fim, l.ent, l.sai, l.ent - l.sai,
         case when p_accounts is null and p_member is null then
           (select bt.total from public.balance_totals_projected(p_household, least(l.fim, p_to), p_include_planned) bt)
         end,
         sum(l.ent) over (), sum(l.sai) over (), sum(l.ent - l.sai) over ()
    from linhas l
   where (select private.is_member(p_household))
   order by l.ini;
end $$;

revoke execute on function public.cash_flow_series(uuid, date, date, text, uuid[], uuid, boolean) from public, anon;
grant execute on function public.cash_flow_series(uuid, date, date, text, uuid[], uuid, boolean) to authenticated;
