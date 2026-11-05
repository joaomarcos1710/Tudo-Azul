-- Tudo Azul — migration 068: assinaturas e lançamentos fixos previstos em Entradas x Saídas, e o relatório de Contas
-- (public.account_flow_report)
--
-- Pedidos do dono (05/11/2026, #182):
--   1. "sim — lançamentos fixos mensais": em Entradas x Saídas com "não pagos", novembro deu R$ 14.774,72 em 28/11 e o
--      Organizze 15.895,41. A diferença (1.120,69) eram as assinaturas de cartão que ainda não viraram compra
--      (card_pending_subscriptions): a 066/067 punha no vencimento só o total − pago de card_months, e a assinatura só vira
--      parcela no dia da cobrança (recurrence_materialize gera a de cartão até HOJE). Pelo mesmo motivo, os
--      lançamentos fixos de conta (recorrentes de receita/despesa) só existem como planejados até o horizonte de
--      recurrence_materialize (fim do mês daqui a 12 meses, sem data final) e só depois que ela roda: um relatório
--      mais à frente não os via.
--   2. Relatório › Contas (como no Organizze): uma linha por conta ativa em reais, com saldo no início, entradas, saídas
--      e saldo no fim do período, mais o total — numa chamada só.
--
-- O que muda (nenhuma migration anterior é editada):
--   a. private.card_pending_by_due(p_household, p_from, p_to): as assinaturas previstas (private.card_recurrence_pending,
--      058/061 — a regra de quais ocorrências ainda não viraram parcela e em que fatura caem fica LÁ) somadas por
--      fatura, com o vencimento dela: o de debt_invoices se a fatura já existe, senão o do ciclo do mês
--      (private.card_cycle_due) — o mesmo vencimento de card_pending_subscriptions. Só faturas que vencem em
--      [p_from, p_to]; p_from nulo = desde sempre. Depois de gerada como parcela, a assinatura sai daqui e já está no
--      total da fatura (card_months): conta uma vez só.
--   b. private.account_recurrence_pending(p_household, p_from, p_to): ocorrências de recorrente de CONTA (receita,
--      despesa, transferência) em [p_from, p_to] que ainda não viraram lançamento — nenhum lançamento com o mesmo
--      recurrence_id e occurrence_date, inclusive na lixeira e já pago (o mesmo "on conflict do nothing" da geração:
--      ocorrência excluída não volta). Mesmas datas (private.recurrence_occurrences) e mesmas condições de conta de
--      recurrence_materialize (061): regra ativa, conta (e destino) ativa e aberta na data. p_from nulo = desde o início.
--      atalho: as condições de conta estão escritas aqui e em recurrence_materialize; quando a geração mudar, trocar
--      lá para chamar esta função (pendência em 40).
--   c. public.cash_flow_series (create or replace do corpo da 067 (a versão rápida da 066), mesma assinatura e colunas). Com "não pagos":
--        * as assinaturas previstas de cada fatura saem no VENCIMENTO dela (com a conta de pagamento do cartão no
--          filtro de conta; sem autor, como a fatura a pagar);
--        * os lançamentos fixos ainda não gerados entram como planejados na data da ocorrência (receita e despesa de
--          conta em reais; transferência fora, como os lançamentos; o autor é quem criou a regra, o mesmo que a geração
--          grava em created_by);
--        * o saldo de cada linha anda junto, no padrão da 067 (UMA chamada de balance_totals_projected, em p_from − 1,
--          + o resultado acumulado): o saldo de abertura desconta as assinaturas previstas que venceram antes de p_from
--          e soma (receita − despesa) os fixos não gerados antes de p_from; dentro do período eles já estão no
--          resultado de cada linha, então entram no acumulado sem chamada extra. balance_totals_projected em si NÃO
--          muda (decisão em 30: quem a chama — Calendário, saldo previsto de Contas, Início/aviso diário (daily_digest)
--          — continua igual; pendência para alinhar).
--      Só pagos: nada muda.
--   d. public.account_flow_report(p_household, p_from, p_to, p_include_planned): ver o cabeçalho da função. UMA chamada
--      de account_balances_projected (em p_from − 1); o saldo final de cada conta é o inicial + entradas − saídas.
-- Teste: 68_account_flow_report (falha sem esta migration).

-- ---------------------------------------------------------------------------
-- a. Assinaturas previstas por fatura, no vencimento
-- ---------------------------------------------------------------------------
create function private.card_pending_by_due(p_household uuid, p_from date, p_to date)
returns table (debt_id uuid, pay_account_id uuid, closing_date date, due_date date, amount numeric)
language sql stable security invoker set search_path = '' as $$
  -- o vencimento vem no máximo ~2 meses depois do fechamento: as faturas candidatas fecham de p_from − 62 dias a p_to
  select d.id, d.pay_account_id, x.closing_date, v.due, sum(x.amount)
    from private.card_recurrence_pending(p_household, coalesce(p_from, date '1900-01-01') - 62, p_to) x
    join public.debts d on d.household_id = p_household and d.id = x.debt_id
    left join public.debt_invoices inv
      on inv.household_id = d.household_id and inv.debt_id = d.id and inv.label = to_char(x.closing_date, 'YYYY-MM')
   cross join lateral (select coalesce(inv.due_date, private.card_cycle_due(d, x.closing_date)) as due) v
   where d.due_day is not null
     and v.due <= p_to and (p_from is null or v.due >= p_from)
   group by d.id, d.pay_account_id, x.closing_date, v.due
$$;

-- ---------------------------------------------------------------------------
-- b. Lançamentos fixos (recorrentes de conta) ainda não gerados
-- ---------------------------------------------------------------------------
create function private.account_recurrence_pending(p_household uuid, p_from date, p_to date)
returns table (recurrence_id uuid, kind text, account_id uuid, destination_account_id uuid, amount numeric,
               occurrence_date date, created_by uuid)
language sql stable security invoker set search_path = '' as $$
  select r.id, r.kind, r.account_id, r.destination_account_id, r.amount, o.occ, r.created_by
    from public.recurrences r
   cross join lateral private.recurrence_occurrences(r, coalesce(p_from, r.start_date), p_to) o(occ)
   where r.household_id = p_household and r.active and r.kind in ('income', 'expense', 'transfer')
     -- mesmas condições de recurrence_materialize: conta (e destino) ativa e já aberta na data
     and exists (select 1 from public.accounts a
                  where a.household_id = r.household_id and a.id = r.account_id and a.active and a.opening_date <= o.occ)
     and (r.destination_account_id is null or exists (
            select 1 from public.accounts a
             where a.household_id = r.household_id and a.id = r.destination_account_id and a.active
               and a.opening_date <= o.occ))
     -- já gerada (planejada, paga ou na lixeira): não é mais prevista
     and not exists (select 1 from public.transactions t
                      where t.household_id = r.household_id and t.recurrence_id = r.id and t.occurrence_date = o.occ)
$$;

revoke execute on function private.card_pending_by_due(uuid, date, date),
  private.account_recurrence_pending(uuid, date, date) from public, anon;
-- as funções públicas abaixo rodam como o chamador
grant execute on function private.card_pending_by_due(uuid, date, date),
  private.account_recurrence_pending(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- c. Entradas x Saídas (corpo da 067 + os previstos acima)
-- ---------------------------------------------------------------------------
create or replace function public.cash_flow_series(
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
    -- não pagos (068): as assinaturas previstas de cada fatura (ainda sem parcela), no vencimento dela
    select pc.due_date, 'expense', pc.amount
      from private.card_pending_by_due(p_household, p_from, p_to) pc
     where p_include_planned and p_member is null
       and (p_accounts is null or pc.pay_account_id = any(p_accounts))
    union all
    -- não pagos (068): lançamentos fixos de conta em reais ainda não gerados, na data da ocorrência
    select pr.occurrence_date, pr.kind, pr.amount
      from private.account_recurrence_pending(p_household, p_from, p_to) pr
     where p_include_planned and pr.kind in ('income', 'expense')
       and (p_accounts is null or pr.account_id = any(p_accounts))
       and (p_member is null or pr.created_by = p_member)
       and exists (select 1 from public.accounts ac where ac.household_id = p_household and ac.id = pr.account_id
                     and ac.currency_code = 'BRL')
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
  ), inicio as (
    -- saldo de abertura (padrão da 067): UMA chamada de balance_totals_projected, em p_from − 1. Com não pagos (068),
    -- menos as assinaturas previstas que venceram antes de p_from e mais (receita − despesa) dos fixos ainda não gerados
    -- antes de p_from (transferência entre contas em reais não muda o total). Os do período já estão no resultado de cada
    -- linha (itens acima), então entram no acumulado.
    select case when p_accounts is null and p_member is null then
             (select bt.total from public.balance_totals_projected(p_household, p_from - 1, p_include_planned) bt)
             - coalesce((select sum(pc.amount) from private.card_pending_by_due(p_household, null, p_from - 1) pc
                          where p_include_planned), 0)
             + coalesce((select sum(case pr.kind when 'income' then pr.amount else -pr.amount end)
                           from private.account_recurrence_pending(p_household, null, p_from - 1) pr
                          where p_include_planned and pr.kind in ('income', 'expense')
                            and exists (select 1 from public.accounts ac where ac.household_id = p_household
                                          and ac.id = pr.account_id and ac.currency_code = 'BRL')), 0)
           end as saldo
  )
  select l.ini, l.fim, l.ent, l.sai, l.ent - l.sai,
         (select i.saldo from inicio i) + sum(l.ent - l.sai) over (order by l.ini rows between unbounded preceding and current row),
         sum(l.ent) over (), sum(l.sai) over (), sum(l.ent - l.sai) over ()
    from linhas l
   where (select private.is_member(p_household))
   order by l.ini;
end $$;

revoke execute on function public.cash_flow_series(uuid, date, date, text, uuid[], uuid, boolean) from public, anon;
grant execute on function public.cash_flow_series(uuid, date, date, text, uuid[], uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- d. Relatório › Contas
-- ---------------------------------------------------------------------------
-- Uma linha por conta ATIVA em REAIS aberta até p_to (conta em outra moeda fica fora: a tela avisa), em ordem de nome:
--   opening_balance : saldo no início do período = o do fim de p_from − 1 (account_balances_projected, com ou sem os
--                     planejados, menos as assinaturas previstas que vencem até ali e mais os fixos ainda não gerados
--                     até ali). Conta aberta dentro do período: o saldo inicial dela.
--   income/expense  : o que entrou e saiu DA CONTA no período, como no extrato: os movimentos realizados de
--                     account_movements (lançamentos pagos, transferências, eventos de dívida com a conta: pagamento
--                     de fatura na data do pagamento, devolução do cartão, crédito de empréstimo, juros, tarifa) e,
--                     com "não pagos", os mesmos planejados de account_balances_projected (lançamentos planejados,
--                     parcela de contrato em débito na conta, o que falta pagar da fatura no VENCIMENTO pela conta de
--                     pagamento do cartão) mais as assinaturas previstas (no vencimento) e os fixos ainda não gerados.
--                     Transferência entre contas entra como entrada numa e saída na outra.
--   transfer_in/out : a parte de income/expense que é transferência entre contas.
--   closing_balance : opening + income − expense (por construção; testado contra account_balances_projected em p_to).
-- Desempenho (padrão da 067): UMA chamada de account_balances_projected (em p_from − 1), nenhum saldo por conta em
-- laço; os previstos de (a) e (b) são lidos uma vez cada.
--   total_*         : repetidos em toda linha (o front não soma). total_income/total_expense SEM as transferências
--                     (saem de uma conta e entram em outra: não inflam o total da família); total_transfers = entradas
--                     − saídas por transferência das contas listadas (zero quando as duas pontas estão na lista).
--                     total_closing = total_opening + total_income − total_expense + total_transfers.
-- Diferença para Entradas x Saídas (que é por lançamento): aqui é o extrato de cada conta, então o crédito de
-- empréstimo é entrada, a devolução em dinheiro do cartão é entrada (lá, saída negativa) e o pagamento de dívida que
-- não é cartão nem empréstimo é saída. Cartão: igual (pagamento ou vencimento, nunca a compra).
-- Até 10 anos, recusa 22023. SECURITY INVOKER + is_member: quem não é da família recebe zero linhas; só authenticated.
create function public.account_flow_report(p_household uuid, p_from date, p_to date, p_include_planned boolean default false)
returns table (account_id uuid, name text, type text, opening_balance numeric, income numeric, expense numeric,
               transfer_in numeric, transfer_out numeric, closing_balance numeric,
               total_opening numeric, total_income numeric, total_expense numeric, total_transfers numeric,
               total_closing numeric)
language plpgsql stable security invoker set search_path = '' as $$
#variable_conflict use_column
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 3660 then
    raise exception 'período inválido (até 10 anos)' using errcode = '22023';
  end if;
  return query
  with contas as (
    select a.id, a.name, a.type, a.opening_date, a.initial_balance
      from public.accounts a
     where a.household_id = p_household and a.active and a.currency_code = 'BRL' and a.opening_date <= p_to
  ), saldo_ini as (
    select b.account_id, b.balance from public.account_balances_projected(p_household, p_from - 1, p_include_planned) b
  ), rec as (
    select pr.* from private.account_recurrence_pending(p_household, null, p_to) pr where p_include_planned
  ), prev as (
    -- previstos que o saldo projetado ainda não desconta (068), desde sempre até p_to, por conta (sinal do saldo)
    select pc.pay_account_id as conta, pc.due_date as dia, -pc.amount as delta, false as transf
      from private.card_pending_by_due(p_household, null, p_to) pc
     where p_include_planned and pc.pay_account_id is not null
    union all
    select pr.account_id, pr.occurrence_date, case pr.kind when 'income' then pr.amount else -pr.amount end,
           pr.kind = 'transfer'
      from rec pr
    union all
    select pr.destination_account_id, pr.occurrence_date, pr.amount, true
      from rec pr
     where pr.kind = 'transfer'
  ), movs as (
    -- realizados: o extrato da conta (account_movements), só o período, sem a linha do saldo inicial
    select c.id as conta, m.amount as delta, coalesce(t.type = 'transfer', false) as transf
      from contas c
     cross join lateral public.account_movements(c.id, p_to) m
      left join public.transactions t on m.source = 'transaction' and t.household_id = p_household and t.id = m.id
     where m.source <> 'opening' and m.date between p_from and p_to
    union all
    -- planejados (as mesmas regras de account_balances_projected, no período)
    select c.id,
           case when t.type = 'income' then t.amount
                when t.type = 'expense' then -t.amount
                when t.account_id = c.id then -t.amount
                else t.amount end,
           t.type = 'transfer'
      from contas c
      join public.transactions t
        on t.household_id = p_household and t.deleted_at is null and t.status = 'planned'
       and (t.account_id = c.id or t.destination_account_id = c.id)
       and t.date >= c.opening_date and t.date between p_from and p_to
     where p_include_planned
    union all
    select d.payment_account_id, -s.amount, false
      from public.debt_payment_schedule s
      join public.debts d on d.household_id = s.household_id and d.id = s.debt_id
     where p_include_planned and s.household_id = p_household and s.status = 'planned'
       and s.due_date between p_from and p_to
       and d.payment_method = 'account_debit' and d.payment_account_id is not null
    union all
    select d.pay_account_id, -greatest(m.total - m.paid, 0), false
      from public.debts d
     cross join lateral public.card_months(d.id) m
     where p_include_planned and d.household_id = p_household and d.kind = 'card' and d.pay_account_id is not null
       and m.due_date between p_from and p_to and m.total > m.paid
    union all
    select p.conta, p.delta, p.transf from prev p where p.dia between p_from and p_to
  ), fluxo as (
    select x.conta,
           coalesce(sum(x.delta) filter (where x.delta > 0), 0) as ent,
           coalesce(-sum(x.delta) filter (where x.delta < 0), 0) as sai,
           coalesce(sum(x.delta) filter (where x.delta > 0 and x.transf), 0) as t_ent,
           coalesce(-sum(x.delta) filter (where x.delta < 0 and x.transf), 0) as t_sai
      from movs x group by x.conta
  ), antes as (
    select p.conta, sum(p.delta) as delta from prev p where p.dia < p_from group by p.conta
  ), linhas as (
    select c.id, c.name, c.type,
           case when c.opening_date < p_from then coalesce(si.balance, 0) + coalesce(ab.delta, 0)
                else c.initial_balance end as ini,
           coalesce(f.ent, 0) as ent, coalesce(f.sai, 0) as sai, coalesce(f.t_ent, 0) as t_ent, coalesce(f.t_sai, 0) as t_sai
      from contas c
      left join saldo_ini si on si.account_id = c.id
      left join antes ab on ab.conta = c.id
      left join fluxo f on f.conta = c.id
  )
  select l.id, l.name, l.type, l.ini, l.ent, l.sai, l.t_ent, l.t_sai, l.ini + l.ent - l.sai,
         sum(l.ini) over (), sum(l.ent - l.t_ent) over (), sum(l.sai - l.t_sai) over (),
         sum(l.t_ent - l.t_sai) over (), sum(l.ini + l.ent - l.sai) over ()
    from linhas l
   where (select private.is_member(p_household))
   order by l.name, l.id;
end $$;

revoke execute on function public.account_flow_report(uuid, date, date, boolean) from public, anon;
grant execute on function public.account_flow_report(uuid, date, date, boolean) to authenticated;
