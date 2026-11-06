-- Tudo Azul — migration 069: o saldo previsto de todo o app conta as assinaturas e os lançamentos fixos previstos
--
-- Pedido do dono (05/11/2026, #185): "Alinha o Calendário e o Início com as assinaturas." A 068 pôs nos Relatórios
-- (cash_flow_series e account_flow_report, com "não pagos") as assinaturas de cartão que ainda não viraram parcela
-- (private.card_pending_by_due, no vencimento da fatura) e os lançamentos fixos de conta ainda não gerados
-- (private.account_recurrence_pending, na data da ocorrência), mas deixou balance_totals_projected e
-- account_balances_projected como estavam. Resultado: o Calendário (saldo até a data), o Início ("posso gastar?" /
-- previsto no fim do mês) e o aviso diário (daily_digest) mostravam ~R$ 1.120 a mais que os Relatórios em novembro.
--
-- Caminho escolhido (opção A da decisão em 30): corrigir na fonte, uma vez, em vez de remendar cada tela.
--   a. public.account_balances_projected (create or replace do corpo da 055; mesmo cabeçalho e colunas). Com
--      p_include_planned, por conta EM REAIS (como na 068; conta em outra moeda fica igual):
--        * planned  += fixos ainda não gerados até p_as_of (receita +, despesa −, transferência − na origem e + no destino);
--        * invoices += assinaturas previstas cujas faturas vencem até p_as_of, pela conta de pagamento do cartão.
--      balance = realized + planned − invoices, como antes. Cada previsto é lido UMA vez (não por conta): os dois
--      auxiliares da 068 são chamados uma vez e agrupados por conta.
--   b. public.balance_totals_projected (create or replace do corpo da 055). planned vem de (a) (só BRL; a
--      transferência fixa entre contas em reais se anula no total). invoices += todas as assinaturas previstas que
--      vencem até p_as_of (inclusive de cartão sem conta de pagamento, que também vão para unassigned_invoices).
--   c. public.cash_flow_series (corpo da 068): o saldo de abertura volta a ser só balance_totals_projected em
--      p_from − 1 (o ajuste manual da 068 sairia em dobro agora).
--   d. public.account_flow_report (corpo da 068): o saldo inicial volta a ser só account_balances_projected em
--      p_from − 1 (sai o "antes"); os previstos do período são lidos só de [p_from, p_to].
--   e. A service_role (aviso diário: daily_digest → balance_totals_projected) passa a executar os auxiliares
--      privados que o saldo previsto agora chama; antes eram só do authenticated.
-- Os números dos Relatórios não mudam (teste 69: mesmos valores antes/depois); só pagos: nada muda em lugar nenhum.
-- Quem chama o saldo previsto e herda a correção sem ser recriado: daily_digest (aviso diário), o front
-- (src/lib/saldoProjetado.ts: Calendário e "Saldo hoje e previsto" do Início). home_alerts, card_overview,
-- month_projection e budget_projection não usam estas funções (ver 30 - Decisões).
-- Desempenho: cada chamada lê card_pending_by_due e account_recurrence_pending uma vez (balance_totals_projected:
-- duas de card_pending_by_due, a de (a) e a do total); nada por dia ou por linha. Tempos na PR #185.
-- Teste: 69_projected_with_pending (falha sem esta migration).

-- ---------------------------------------------------------------------------
-- 0. Os dois auxiliares de previstos, mais rápidos (mesmas regras, mesmas colunas; só a ordem dos filtros muda)
-- ---------------------------------------------------------------------------
-- Medido no volume de teste (r182/volume.sql, como authenticated): account_recurrence_pending desde o início levava
-- ~0,33 s para 7 linhas (o planejador lia todos os lançamentos gerados por recorrente, com a checagem de RLS em cada,
-- uma vez por conta) e card_recurrence_pending ~0,13 s (calculava o fechamento de TODA ocorrência antes de ver se ela
-- já virou parcela). Agora a ocorrência já gerada sai primeiro, por índice (recurrence_id, occurrence_date), e só a que
-- falta tem o fechamento calculado. "offset 0" impede o planejador de desfazer essa ordem.

-- (create or replace da 068) mesmas condições de recurrence_materialize: regra ativa, conta (e destino) ativa e já
-- aberta na data; a ocorrência que já tem lançamento (planejado, pago ou na lixeira) não é prevista.
create or replace function private.account_recurrence_pending(p_household uuid, p_from date, p_to date)
returns table (recurrence_id uuid, kind text, account_id uuid, destination_account_id uuid, amount numeric,
               occurrence_date date, created_by uuid)
language sql stable security invoker set search_path = '' as $$
  select r.id, r.kind, r.account_id, r.destination_account_id, r.amount, o.occ, r.created_by
    from public.recurrences r
    join public.accounts a on a.household_id = r.household_id and a.id = r.account_id and a.active
    left join public.accounts ad on ad.household_id = r.household_id and ad.id = r.destination_account_id
   cross join lateral (
     select x.occ from private.recurrence_occurrences(r, coalesce(p_from, r.start_date), p_to) x(occ)
      where x.occ >= a.opening_date
        and (r.destination_account_id is null or (ad.active and ad.opening_date <= x.occ))
        and not exists (select 1 from public.transactions t
                         where t.household_id = r.household_id and t.recurrence_id = r.id and t.occurrence_date = x.occ)
      offset 0
   ) o
   where r.household_id = p_household and r.active and r.kind in ('income', 'expense', 'transfer')
$$;

-- (create or replace da 061) a fatura aberta na data da ocorrência, com o ciclo do mês; ocorrência já gerada como
-- parcela (debt_installments) não é prevista.
create or replace function private.card_recurrence_pending(p_household uuid, p_first date, p_last date)
returns table (category_id uuid, amount numeric, debt_id uuid, occurrence_date date, closing_date date)
language sql stable security invoker set search_path = '' as $$
  select r.category_id, r.amount, r.debt_id, o.occ, c.fecha
    from public.recurrences r
    join public.debts d on d.household_id = r.household_id and d.id = r.debt_id
   cross join lateral (
     select x.occ from private.recurrence_occurrences(r, (date_trunc('month', p_first) - interval '1 month')::date, p_last) x(occ)
      where x.occ > d.reference_date
        and not exists (select 1 from public.debt_installments i
                         where i.recurrence_id = r.id and i.occurrence_date = x.occ)
      offset 0
   ) o
   -- mesma regra de recurrence_materialize: a fatura aberta na data da ocorrência, com o ciclo do mês (migration 061)
   cross join lateral (select private.card_cycle_first(d, o.occ) as fecha offset 0) c
   where r.household_id = p_household and r.kind = 'card' and r.active and d.closing_day is not null
     and c.fecha between p_first and p_last
$$;

-- ---------------------------------------------------------------------------
-- a. Saldo previsto por conta
-- ---------------------------------------------------------------------------
create or replace function public.account_balances_projected(
  p_household uuid, p_as_of date, p_include_planned boolean default true
)
returns table(account_id uuid,name text,type text,active boolean,realized numeric,planned numeric,invoices numeric,balance numeric,
              currency_code text)
language sql stable security invoker set search_path = '' as $$
  with fixos as (
    -- lançamentos fixos ainda não gerados até p_as_of (068), por conta, com o sinal do saldo; uma leitura só
    select v.conta, sum(v.delta) as delta
      from private.account_recurrence_pending(p_household, null, p_as_of) pr
     cross join lateral (values (pr.account_id, case pr.kind when 'income' then pr.amount else -pr.amount end),
                                (pr.destination_account_id, pr.amount)) v(conta, delta)
     where p_include_planned and v.conta is not null
     group by v.conta
  ), assin as (
    -- assinaturas previstas (ainda sem parcela) das faturas que vencem até p_as_of, pela conta de pagamento; uma leitura só
    select pc.pay_account_id as conta, sum(pc.amount) as rem
      from private.card_pending_by_due(p_household, null, p_as_of) pc
     where p_include_planned and pc.pay_account_id is not null
     group by pc.pay_account_id
  )
  select b.account_id,b.name,b.type,b.active,b.balance,
    case when p_include_planned then coalesce(pl.delta,0) - coalesce(ds.rem,0) + coalesce(fx.delta,0) else 0 end,
    case when p_include_planned then coalesce(inv.rem,0) + coalesce(sb.rem,0) else 0 end,
    b.balance
      + case when p_include_planned then coalesce(pl.delta,0) - coalesce(ds.rem,0) + coalesce(fx.delta,0) else 0 end
      - case when p_include_planned then coalesce(inv.rem,0) + coalesce(sb.rem,0) else 0 end,
    b.currency_code
  from public.account_balances(p_household,p_as_of) b
  join public.accounts a on a.id=b.account_id
  -- os previstos da 068 são só de contas em reais (como nos Relatórios)
  left join fixos fx on fx.conta=a.id and a.currency_code='BRL'
  left join assin sb on sb.conta=a.id and a.currency_code='BRL'
  left join lateral (
    select sum(case
      when t.type='income' and t.account_id=a.id then t.amount
      when t.type='expense' and t.account_id=a.id then -t.amount
      when t.type='transfer' and t.account_id=a.id then -t.amount
      when t.type='transfer' and t.destination_account_id=a.id then t.amount
    end) as delta
    from public.transactions t
    where t.household_id=a.household_id and t.deleted_at is null and t.status='planned'
      and t.date>=a.opening_date and t.date<=p_as_of
      and (t.account_id=a.id or t.destination_account_id=a.id)
  ) pl on true
  left join lateral (
    select sum(s.amount) as rem
    from public.debt_payment_schedule s
    join public.debts d on d.household_id=s.household_id and d.id=s.debt_id
    where s.household_id=a.household_id and s.status='planned' and s.due_date<=p_as_of
      and d.payment_method='account_debit' and d.payment_account_id=a.id
  ) ds on true
  left join lateral (
    select sum(greatest(m.total-m.paid,0)) as rem
    from public.debts d
    cross join lateral public.card_months(d.id) m
    where d.household_id=a.household_id and d.kind='card' and d.pay_account_id=a.id
      and m.due_date<=p_as_of
  ) inv on true
  where (select private.is_member(p_household))
  order by b.name
$$;

-- ---------------------------------------------------------------------------
-- b. Saldo previsto total (em reais)
-- ---------------------------------------------------------------------------
create or replace function public.balance_totals_projected(
  p_household uuid, p_as_of date, p_include_planned boolean default true
)
returns table(realized numeric,planned numeric,invoices numeric,unassigned_invoices numeric,total numeric)
language sql stable security invoker set search_path = '' as $$
  with c as (
    -- planned já traz os fixos não gerados (a)
    select coalesce(sum(b.realized),0) as realized,coalesce(sum(b.planned),0) as planned
    from public.account_balances_projected(p_household,p_as_of,p_include_planned) b
    where b.currency_code = 'BRL'
  ), f as (
    select coalesce(sum(greatest(m.total-m.paid,0)),0) as todas,
      coalesce(sum(greatest(m.total-m.paid,0)) filter (where d.pay_account_id is null),0) as sem_conta
    from public.debts d
    cross join lateral public.card_months(d.id) m
    where d.household_id=p_household and d.kind='card' and m.due_date<=p_as_of
  ), pa as (
    -- assinaturas previstas (068) das faturas que vencem até p_as_of, de todo cartão; uma leitura só
    select coalesce(sum(pc.amount),0) as todas,
      coalesce(sum(pc.amount) filter (where pc.pay_account_id is null),0) as sem_conta
    from private.card_pending_by_due(p_household, null, p_as_of) pc
    where p_include_planned
  ), s as (
    select coalesce(sum(sch.amount),0) as sem_conta
    from public.debt_payment_schedule sch
    join public.debts d on d.household_id=sch.household_id and d.id=sch.debt_id
    where sch.household_id=p_household and sch.status='planned' and sch.due_date<=p_as_of
      and d.payment_method in ('boleto','manual')
  )
  select c.realized,c.planned,
    case when p_include_planned then f.todas+pa.todas+s.sem_conta else 0 end,
    case when p_include_planned then f.sem_conta+pa.sem_conta+s.sem_conta else 0 end,
    c.realized+c.planned-case when p_include_planned then f.todas+pa.todas+s.sem_conta else 0 end
  from c cross join f cross join pa cross join s
  where (select private.is_member(p_household))
$$;

-- ---------------------------------------------------------------------------
-- c. Entradas x Saídas (corpo da 068; só o saldo de abertura muda)
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
    -- saldo de abertura (padrão da 067): UMA chamada de balance_totals_projected, em p_from − 1. Desde a 069 ela já
    -- desconta as assinaturas previstas e soma os fixos não gerados até ali (com não pagos); os do período estão nos
    -- itens acima e entram no acumulado.
    select case when p_accounts is null and p_member is null then
             (select bt.total from public.balance_totals_projected(p_household, p_from - 1, p_include_planned) bt)
           end as saldo
  )
  select l.ini, l.fim, l.ent, l.sai, l.ent - l.sai,
         (select i.saldo from inicio i) + sum(l.ent - l.sai) over (order by l.ini rows between unbounded preceding and current row),
         sum(l.ent) over (), sum(l.sai) over (), sum(l.ent - l.sai) over ()
    from linhas l
   where (select private.is_member(p_household))
   order by l.ini;
end $$;

-- ---------------------------------------------------------------------------
-- d. Relatório › Contas (corpo da 068; o saldo inicial vem só de account_balances_projected)
-- ---------------------------------------------------------------------------
-- Regras: as do cabeçalho da 068. O que muda: opening_balance = account_balances_projected em p_from − 1 (que desde a
-- 069 já conta as assinaturas previstas e os fixos não gerados até ali) e os previstos do período são lidos só de
-- [p_from, p_to] (uma leitura de cada auxiliar).
create or replace function public.account_flow_report(p_household uuid, p_from date, p_to date, p_include_planned boolean default false)
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
    select pr.* from private.account_recurrence_pending(p_household, p_from, p_to) pr where p_include_planned
  ), prev as (
    -- previstos do período (068), por conta (sinal do saldo)
    select pc.pay_account_id as conta, -pc.amount as delta, false as transf
      from private.card_pending_by_due(p_household, p_from, p_to) pc
     where p_include_planned and pc.pay_account_id is not null
    union all
    select pr.account_id, case pr.kind when 'income' then pr.amount else -pr.amount end, pr.kind = 'transfer'
      from rec pr
    union all
    select pr.destination_account_id, pr.amount, true
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
    select p.conta, p.delta, p.transf from prev p
  ), fluxo as (
    select x.conta,
           coalesce(sum(x.delta) filter (where x.delta > 0), 0) as ent,
           coalesce(-sum(x.delta) filter (where x.delta < 0), 0) as sai,
           coalesce(sum(x.delta) filter (where x.delta > 0 and x.transf), 0) as t_ent,
           coalesce(-sum(x.delta) filter (where x.delta < 0 and x.transf), 0) as t_sai
      from movs x group by x.conta
  ), linhas as (
    select c.id, c.name, c.type,
           case when c.opening_date < p_from then coalesce(si.balance, 0) else c.initial_balance end as ini,
           coalesce(f.ent, 0) as ent, coalesce(f.sai, 0) as sai, coalesce(f.t_ent, 0) as t_ent, coalesce(f.t_sai, 0) as t_sai
      from contas c
      left join saldo_ini si on si.account_id = c.id
      left join fluxo f on f.conta = c.id
  )
  select l.id, l.name, l.type, l.ini, l.ent, l.sai, l.t_ent, l.t_sai, l.ini + l.ent - l.sai,
         sum(l.ini) over (), sum(l.ent - l.t_ent) over (), sum(l.sai - l.t_sai) over (),
         sum(l.t_ent - l.t_sai) over (), sum(l.ini + l.ent - l.sai) over ()
    from linhas l
   where (select private.is_member(p_household))
   order by l.name, l.id;
end $$;

-- ---------------------------------------------------------------------------
-- e. A service_role (aviso diário) executa o que o saldo previsto agora chama
-- ---------------------------------------------------------------------------
-- create or replace mantém os grants de (a)–(d). Os auxiliares abaixo são SECURITY INVOKER e leem só a família pedida;
-- a service_role já tinha usage no schema private (047) e is_member só lhe diz "sim" durante daily_digest_service (049).
grant execute on function private.card_pending_by_due(uuid, date, date), private.account_recurrence_pending(uuid, date, date),
  private.card_recurrence_pending(uuid, date, date), private.recurrence_occurrences(public.recurrences, date, date),
  private.card_cycle_first(public.debts, date), private.card_cycle_closing(public.debts, date),
  private.card_cycle_closing_day(public.debts, date), private.card_cycle_due(public.debts, date),
  private.card_cycle_due_day(public.debts, date)
  to service_role;
