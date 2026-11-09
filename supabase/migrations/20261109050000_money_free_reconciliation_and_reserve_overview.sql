-- Reconciliação de cartão respeita a data de corte; eventos futuros não antecipam saldo.
create function private.card_months_as_of(p_debt uuid, p_as_of date)
returns table (label text, due_date date, charged numeric, pending numeric, total numeric, paid numeric, invoice_id uuid)
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_d record; r record; v_credit numeric; v_ref numeric; v_s0 numeric; v_link numeric; v_total numeric;
  v_use numeric; v_surplus numeric; v_paid numeric; v_due date; v_b date; v_first boolean := true;
begin
  if p_as_of is null then raise exception 'data de corte obrigatória' using errcode = '22023'; end if;
  select d.id, d.household_id, d.closing_day, d.due_day, greatest(0, d.reference_balance) as reference_balance into v_d from public.debts d
   where d.id = p_debt and d.kind = 'card' and (select private.is_member(d.household_id));
  if not found then return; end if;

  -- pagamentos sem fatura: entram como adiantamento. A devolução em dinheiro (refund_cash) tira do adiantamento NA ORDEM
  -- DAS DATAS (correção da 052): a de antes do primeiro fechamento sai daqui; as outras saem no loop, depois da sobra
  -- da fatura cujo fechamento a antecede. Antes ela era descontada no começo, só do que existia sem fatura: a sobra de
  -- uma fatura (pagamento ou crédito avulso acima dela) já devolvida reaparecia como adiantamento.
  select coalesce(sum(e.amount), 0) into v_credit
    from public.debt_events e
   where e.household_id = v_d.household_id and e.debt_id = v_d.id and e.voided_at is null
     and e.kind in ('payment', 'extra_principal') and e.invoice_id is null and e.date <= p_as_of;
  v_ref := v_d.reference_balance;
  v_s0 := least(v_credit, v_ref);
  v_ref := v_ref - v_s0;
  v_credit := v_credit - v_s0;

  for r in
    with parc as (
      select i.id, i.due_date, i.face, i.closing_day, i.due_day,
             coalesce((select sum(case e.kind when 'charge' then e.amount when 'credit' then -e.amount else 0 end)
                         from public.debt_events e
                        where e.installment_id = i.id and e.voided_at is null and e.kind in ('charge', 'credit') and e.date <= p_as_of), 0) as cobrado,
             i.face - coalesce((select sum(e.amount) from public.debt_events e
                                 where e.installment_id = i.id and e.voided_at is null
                                   and e.kind in ('charge', 'cancel') and e.date <= p_as_of), 0) as resta,
             coalesce((select sum(e.amount) from public.debt_events e
                        where e.installment_id = i.id and e.voided_at is null and e.kind = 'cancel' and e.date <= p_as_of), 0) as cancelado
        from public.debt_installments i
       where i.household_id = v_d.household_id and i.debt_id = v_d.id
    ), meses_parc as (
      select to_char(p.due_date, 'YYYY-MM') as label, min(p.due_date) as closing_date,
             sum(p.cobrado) as charged, sum(p.resta) as pending, count(*)::int as items,
             max(p.closing_day) as cd, max(p.due_day) as dd
        from parc p where p.cancelado < p.face group by 1
    ), cred as (
      select to_char(e.date, 'YYYY-MM') as label, min(e.date) as closing_date, sum(e.amount) as credits
        from public.debt_events e
       where e.household_id = v_d.household_id and e.debt_id = v_d.id and e.voided_at is null
         and e.kind = 'income_credit' and e.date <= p_as_of
       group by 1
    ), meses as (
      select coalesce(m.label, c.label) as label, coalesce(m.closing_date, c.closing_date) as closing_date,
             coalesce(m.charged, 0) - coalesce(c.credits, 0) as charged, coalesce(m.pending, 0) as pending,
             coalesce(m.items, 0) as items, m.cd, m.dd, coalesce(c.credits, 0) as credits
        from meses_parc m full join cred c on c.label = m.label
    )
    select m.label, m.closing_date, m.charged, m.pending, m.items, m.cd, m.dd, m.credits, inv.id as inv_id, inv.due_date as inv_due,
           lead(m.closing_date) over (order by m.label) as next_closing,
           coalesce((select sum(e.amount) from public.debt_events e
                      where e.invoice_id = inv.id and e.voided_at is null
                        and e.kind in ('payment', 'extra_principal') and e.date <= p_as_of), 0) as pago_fatura
      from meses m
      left join public.debt_invoices inv
        on inv.household_id = v_d.household_id and inv.debt_id = v_d.id and inv.label = m.label
     order by m.label
  loop
    -- vencimento: o da fatura (se já existe) ou o calculado pelo ciclo da parcela (senão, o do cartão); mesma regra de
    -- private.card_due_date (migration 004), escrita aqui porque este relatório roda como o chamador
    v_due := r.inv_due;
    if v_due is null and coalesce(r.cd, v_d.closing_day) is not null then
      v_b := (date_trunc('month', r.closing_date)
              + case when coalesce(r.dd, v_d.due_day) > coalesce(r.cd, v_d.closing_day)
                     then interval '0' else interval '1 month' end)::date;
      v_due := make_date(extract(year from v_b)::int, extract(month from v_b)::int,
                         least(coalesce(r.dd, v_d.due_day),
                               extract(day from (v_b + interval '1 month - 1 day'))::int));
    end if;

    -- devoluções de antes do primeiro fechamento: saem do adiantamento sem fatura
    if v_first then
      v_credit := greatest(0, v_credit - coalesce((
        select sum(e.amount) from public.debt_events e
         where e.household_id = v_d.household_id and e.debt_id = v_d.id and e.voided_at is null
           and e.kind = 'refund_cash' and e.date < r.closing_date and e.date <= p_as_of), 0));
      v_first := false;
    end if;

    v_total   := greatest(0, r.charged + r.pending);
    v_link    := r.pago_fatura;
    v_use     := least(v_credit, greatest(0, v_total - v_link));
    -- excedente: pagamento acima da fatura + crédito avulso acima da fatura (migration 052)
    v_surplus := greatest(0, v_link - v_total) + greatest(0, -(r.charged + r.pending));
    v_paid    := least(v_total, v_link) + v_use;

    label := r.label; due_date := v_due; invoice_id := r.inv_id;
    charged := r.charged; pending := r.pending; total := v_total; paid := v_paid;
    
    v_s0 := least(v_surplus, v_ref);
    v_ref := v_ref - v_s0;
    v_credit := v_credit - v_use + (v_surplus - v_s0);
    -- devoluções feitas depois deste fechamento (inclusive) e antes do próximo: levam o crédito que existia então
    -- (inclui a sobra desta fatura); greatest(0, …) só protege a tela, debt_chk já garante a ordem
    v_credit := v_credit - coalesce((
      select sum(e.amount) from public.debt_events e
       where e.household_id = v_d.household_id and e.debt_id = v_d.id and e.voided_at is null
         and e.kind = 'refund_cash' and e.date >= r.closing_date and e.date <= p_as_of
         and (r.next_closing is null or e.date < r.next_closing)), 0);
    if v_credit < 0 then v_credit := 0; end if;
    return next;
  end loop;
end $$;


revoke execute on function private.card_months_as_of(uuid, date) from public, anon;
grant execute on function private.card_months_as_of(uuid, date) to authenticated;

-- A matriz usa o mesmo corte por mês da Home, inclusive para estornos/cancelamentos futuros.
create or replace function public.dashboard_commitment_matrix(
  p_household uuid,
  p_from date,
  p_months integer default 6
)
returns table (
  commitment_id text,
  description text,
  source_name text,
  source_type text,
  period_month date,
  currency_code text,
  amount numeric,
  row_type text
)
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_from date;
  v_to date;
begin
  if p_household is null or p_from is null or p_months is null or p_months not between 3 and 6 then
    raise exception 'parâmetros inválidos: informe família, data e período entre 3 e 6 meses'
      using errcode = '22023';
  end if;

  if not (select private.is_member(p_household)) then
    return;
  end if;

  v_from := date_trunc('month', p_from::timestamp)::date;
  v_to := (date_trunc('month', v_from::timestamp) + make_interval(months => p_months) - interval '1 day')::date;

  return query
  with
  -- Lançamentos de despesa já materializados: avulsos, parcelas comuns e recorrências de conta.
  transacoes as (
    select
      case
        when t.installment_group is not null then 'transaction-installment:' || t.installment_group::text
        when t.recurrence_id is not null then 'account-recurrence:' || t.recurrence_id::text
        else 'transaction:' || t.id::text
      end as id,
      case
        when t.recurrence_id is not null then coalesce(r.description, t.description)
        when t.installment_group is not null then regexp_replace(t.description, '\s+[0-9]+/[0-9]+$', '')
        else t.description
      end as descricao,
      a.name as origem,
      'Conta'::text as tipo_origem,
      date_trunc('month', t.date::timestamp)::date as mes,
      a.currency_code as moeda,
      sum(t.amount) as valor
    from public.transactions t
    join public.accounts a
      on a.household_id = t.household_id and a.id = t.account_id
    left join public.recurrences r
      on r.household_id = t.household_id and r.id = t.recurrence_id
    where t.household_id = p_household
      and t.type = 'expense'
      and t.status = 'planned'
      and t.deleted_at is null
      and t.date between v_from and v_to
    group by 1, 2, 3, 4, 5, 6
  ),
  -- Ocorrências de conta que ainda não foram materializadas. A função interna exclui qualquer ocorrência
  -- que já tenha transação, inclusive as que foram para a lixeira, evitando reintroduzir itens excluídos.
  recorrencias_conta as (
    select
      'account-recurrence:' || pr.recurrence_id::text as id,
      r.description as descricao,
      a.name as origem,
      'Conta'::text as tipo_origem,
      date_trunc('month', pr.occurrence_date::timestamp)::date as mes,
      a.currency_code as moeda,
      sum(pr.amount) as valor
    from private.account_recurrence_pending(p_household, v_from, v_to) pr
    join public.recurrences r
      on r.household_id = p_household and r.id = pr.recurrence_id
    join public.accounts a
      on a.household_id = p_household and a.id = pr.account_id
    where pr.kind = 'expense'
    group by 1, 2, 3, 4, 5, 6
  ),
  -- Faturas no período: card_months é a fonte oficial do valor líquido ainda não pago e da data de vencimento.
  periodos_cartao as (
    select gs.mes::date as inicio_mes,
           (gs.mes + interval '1 month - 1 day')::date as fim_mes,
           least((now() at time zone 'America/Sao_Paulo')::date, (gs.mes + interval '1 month - 1 day')::date) as as_of
      from generate_series(v_from::timestamp, v_to::timestamp, interval '1 month') gs(mes)
  ),
  faturas_cartao as materialized (
    select d.id as cartao_id, d.name as cartao, m.label,
           m.due_date as vencimento, greatest(m.total - m.paid, 0) as em_aberto,
           p.as_of
      from public.debts d
      cross join periodos_cartao p
      cross join lateral private.card_months_as_of(d.id, p.as_of) m
     where d.household_id = p_household
       and d.kind = 'card'
       and m.due_date between p.inicio_mes and p.fim_mes
  ),
  -- Itens de compra parcelada. A chave da compra mantém as parcelas de meses diferentes na mesma linha.
  -- Cancelamentos da parcela são descontados; créditos e pagamentos da fatura são conciliados abaixo.
  parcelas_cartao as (
    select
      case
        when i.recurrence_id is not null then 'card-recurrence:' || i.recurrence_id::text
        else 'card-purchase:' || i.debt_id::text || ':' || i.plan
      end as id,
      coalesce(nullif(i.description, ''), 'Compra parcelada') as descricao,
      f.cartao as origem,
      'Cartão'::text as tipo_origem,
      date_trunc('month', f.vencimento::timestamp)::date as mes,
      'BRL'::text as moeda,
      f.cartao_id,
      f.label,
      f.vencimento,
      sum(greatest(i.face - coalesce(cancelados.valor, 0), 0)) as valor
    from faturas_cartao f
    join public.debt_installments i
      on i.household_id = p_household
     and i.debt_id = f.cartao_id
     and to_char(i.due_date, 'YYYY-MM') = f.label
    left join lateral (
      select sum(e.amount) as valor
      from public.debt_events e
      where e.household_id = i.household_id
        and e.installment_id = i.id
        and e.kind = 'cancel'
         and e.voided_at is null
         and e.date <= f.as_of
    ) cancelados on true
    group by 1, 2, 3, 4, 5, 6, 7, 8, 9, f.as_of
  ),
  -- card_months_as_of também considera créditos avulsos e pagamentos parciais. A linha de ajuste reconcilia cada
  -- fatura ao saldo líquido real, sem esconder esses efeitos nem inflar o total da matriz.
  totais_itens_cartao as (
    select cartao_id, vencimento, sum(valor) as valor_itens
    from parcelas_cartao
    group by cartao_id, vencimento
  ),
  ajustes_cartao as (
    select
      'card-invoice-adjustment:' || f.cartao_id::text || ':' || f.label as id,
      case
        when f.em_aberto < coalesce(t.valor_itens, 0) then 'Créditos e pagamentos já considerados'
        else 'Outros valores da fatura'
      end as descricao,
      f.cartao as origem,
      'Ajuste de fatura'::text as tipo_origem,
      date_trunc('month', f.vencimento::timestamp)::date as mes,
      'BRL'::text as moeda,
      f.cartao_id,
      f.label,
      f.vencimento,
      f.em_aberto - coalesce(t.valor_itens, 0) as valor
    from faturas_cartao f
    left join totais_itens_cartao t
      on t.cartao_id = f.cartao_id and t.vencimento = f.vencimento
    where f.em_aberto <> coalesce(t.valor_itens, 0)
  ),
  -- Assinaturas de cartão futuras. A geração automática só materializa compras até hoje; as ocorrências
  -- futuras precisam aparecer aqui. O anti-join impede duplicidade quando a compra já foi criada.
  recorrencias_cartao as (
    select
      'card-recurrence:' || r.id::text as id,
      r.description as descricao,
      d.name as origem,
      'Cartão'::text as tipo_origem,
      date_trunc('month', datas.vencimento::timestamp)::date as mes,
      'BRL'::text as moeda,
      sum(r.amount) as valor
    from public.recurrences r
    join public.debts d
      on d.household_id = r.household_id and d.id = r.debt_id and d.kind = 'card'
    cross join lateral private.recurrence_occurrences(r, v_from - 62, v_to) o(ocorrencia)
    cross join lateral (
      select private.card_cycle_first(d, o.ocorrencia) as fechamento
    ) ciclo
    left join public.debt_invoices inv
      on inv.household_id = p_household
     and inv.debt_id = d.id
     and inv.label = to_char(ciclo.fechamento, 'YYYY-MM')
    cross join lateral (
      select coalesce(inv.due_date, private.card_cycle_due(d, ciclo.fechamento)) as vencimento
    ) datas
    where r.household_id = p_household
      and r.kind = 'card'
      and r.active
      and d.closing_day is not null
      and d.due_day is not null
      and datas.vencimento between v_from and v_to
      and not exists (
        select 1
        from public.debt_installments ja
        where ja.household_id = p_household
          and ja.recurrence_id = r.id
          and ja.occurrence_date = o.ocorrencia
      )
    group by 1, 2, 3, 4, 5, 6
  ),
  -- Parcelas de empréstimos/financiamentos são cronograma contratual, não debt_installments.
  -- Consignado fica fora porque o salário já é registrado líquido.
  agenda_dividas as (
    select
      'debt-schedule:' || d.id::text as id,
      d.name as descricao,
      case
        when d.payment_method = 'account_debit' then coalesce(a.name, 'Conta')
        when d.payment_method = 'boleto' then coalesce(d.creditor, 'Boleto')
        else coalesce(d.creditor, 'Pagamento manual')
      end as origem,
      case when d.kind = 'financing' then 'Financiamento'::text else 'Empréstimo'::text end as tipo_origem,
      date_trunc('month', s.due_date::timestamp)::date as mes,
      'BRL'::text as moeda,
      sum(s.amount) as valor
    from public.debt_payment_schedule s
    join public.debts d
      on d.household_id = s.household_id and d.id = s.debt_id
    left join public.accounts a
      on a.household_id = d.household_id and a.id = d.payment_account_id
    where s.household_id = p_household
      and s.status = 'planned'
      and s.due_date between v_from and v_to
      and d.kind in ('loan', 'financing')
      and d.payment_method is distinct from 'payroll'
    group by 1, 2, 3, 4, 5, 6
  ),
  itens_brutos as (
    select * from transacoes
    union all select * from recorrencias_conta
    union all select id, descricao, origem, tipo_origem, mes, moeda, sum(valor)
      from parcelas_cartao
      group by id, descricao, origem, tipo_origem, mes, moeda
    union all select id, descricao, origem, tipo_origem, mes, moeda, sum(valor)
      from ajustes_cartao
      group by id, descricao, origem, tipo_origem, mes, moeda
    union all select * from recorrencias_cartao
    union all select * from agenda_dividas
  ),
  itens as (
    select
      i.id,
      i.descricao,
      i.origem,
      i.tipo_origem,
      i.mes,
      i.moeda,
      sum(i.valor) as valor
    from itens_brutos i
    group by i.id, i.descricao, i.origem, i.tipo_origem, i.mes, i.moeda
  ),
  linhas as (
    select
      i.id, i.descricao, i.origem, i.tipo_origem, i.mes, i.moeda, i.valor,
      'item'::text as linha
    from itens i
    union all
    select
      null::text,
      'Total do mês'::text,
      null::text,
      'total'::text,
      i.mes,
      i.moeda,
      sum(i.valor),
      'total'::text
    from itens i
    group by i.mes, i.moeda
  )
  select
    l.id,
    l.descricao,
    l.origem,
    l.tipo_origem,
    l.mes,
    l.moeda,
    l.valor,
    l.linha
  from linhas l
  order by l.moeda, l.mes, case when l.linha = 'total' then 1 else 0 end, l.descricao, l.id;
end
$function$;


revoke execute on function public.dashboard_commitment_matrix(uuid, date, integer) from public, anon;
grant execute on function public.dashboard_commitment_matrix(uuid, date, integer) to authenticated;

create or replace function public.get_home_decision_month(
  p_household uuid,
  p_month date default current_date
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with periodo as (
    select date_trunc('month', p_month::timestamp)::date as month_start,
           (date_trunc('month', p_month::timestamp) + interval '1 month - 1 day')::date as month_end,
           (now() at time zone 'America/Sao_Paulo')::date as today,
           least((now() at time zone 'America/Sao_Paulo')::date,
                 (date_trunc('month', p_month::timestamp) + interval '1 month - 1 day')::date) as as_of
  ),
  tesouraria as materialized (
    select h.*
      from periodo p
      cross join lateral public.home_indicators(p_household, p.as_of) h
  ),
  projecao as materialized (
    select mp.*
      from periodo p
      cross join lateral public.month_projection(p_household, p.month_start, p.as_of) mp
  ),
  matriz as materialized (
    select cm.*
      from periodo p
      cross join lateral public.dashboard_commitment_matrix(p_household, p.month_start, 3) cm
     where cm.period_month = p.month_start
       and cm.row_type = 'item'
       and cm.currency_code = 'BRL'
  ),
  matriz_com_cartao as (
    select m.*,
           case
             when m.commitment_id like 'card-purchase:%'
               or m.commitment_id like 'card-invoice-adjustment:%'
               then nullif(split_part(m.commitment_id, ':', 2), '')::uuid
             when m.commitment_id like 'card-recurrence:%' then r.debt_id
             else null
           end as card_debt_id
      from matriz m
      left join public.recurrences r
        on m.commitment_id like 'card-recurrence:%'
       and r.household_id = p_household
       and r.id::text = split_part(m.commitment_id, ':', 2)
  ),
  -- A matriz representa o saldo líquido ainda em aberto da fatura. A tesouraria,
  -- porém, só já descontou a parcela efetivamente cobrada e ainda não paga.
  -- card_months é a fonte oficial: charged já incorpora créditos/estornos;
  -- paid inclui pagamentos da fatura e adiantamentos efetivamente consumidos.
  card_matriz as (
    select m.card_debt_id, m.period_month, max(m.source_name) as source_name,
           sum(m.amount) as commitment_amount
      from matriz_com_cartao m
     where m.card_debt_id is not null
     group by m.card_debt_id, m.period_month
  ),
  card_reconciliado as (
    select d.id as card_debt_id,
           date_trunc('month', cm.due_date::timestamp)::date as period_month,
           sum(greatest(cm.charged - cm.paid, 0)) as already_deducted
      from periodo p
      join public.debts d
        on d.household_id = p_household and d.kind = 'card'
      cross join lateral private.card_months_as_of(d.id, p.as_of) cm
     where cm.due_date between p.month_start and p.month_end
     group by d.id, date_trunc('month', cm.due_date::timestamp)::date
  ),
  card_liquido as (
    select g.card_debt_id, g.period_month, g.source_name,
           greatest(
             g.commitment_amount
             - least(greatest(g.commitment_amount, 0), coalesce(r.already_deducted, 0)),
             0
           ) as amount
      from card_matriz g
      left join card_reconciliado r
        on r.card_debt_id = g.card_debt_id
       and r.period_month = g.period_month
  ),
  itens_liquidos as (
    -- Compromissos não relacionados a cartão continuam integralmente pendentes.
    select m.commitment_id, m.description, m.source_name, m.source_type,
           m.period_month, m.currency_code, m.amount
      from matriz_com_cartao m
     where m.card_debt_id is null
    union all
    -- Cartão é consolidado por fatura/mês. Só a parte ainda não cobrada entra
    -- no Dinheiro Livre; a parte cobrada e não paga já foi abatida da tesouraria.
    select 'card-unreconciled:' || c.card_debt_id::text || ':' || to_char(c.period_month, 'YYYY-MM'),
           'Fatura do cartão', c.source_name, 'Cartão',
           c.period_month, 'BRL', c.amount
      from card_liquido c
     where c.amount > 0
  ),
  compromissos as (
    select coalesce(sum(i.amount), 0) as total_pendente,
           coalesce(jsonb_agg(jsonb_build_object(
             'id', i.commitment_id,
             'description', i.description,
             'source', i.source_name,
             'sourceType', i.source_type,
             'month', i.period_month,
             'currency', i.currency_code,
             'amount', i.amount,
             'lineType', 'item'
           ) order by i.amount desc, i.description), '[]'::jsonb) as items
      from itens_liquidos i
  ),
  reservas_comprometidas as (
    select coalesce(sum(a.amount), 0)::numeric as total_reservado
      from public.reserves r
      left join public.reserve_allocations a
        on a.household_id = r.household_id
       and a.reserve_id = r.id
     where r.household_id = p_household
       and r.currency_code = 'BRL'
       and r.status in ('active', 'completed')
  ),
  alertas as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'kind', a.kind,
      'count', a.item_count,
      'total', a.total,
      'firstDate', a.first_date,
      'targetId', a.target_id,
      'targetName', a.target_name
    ) order by a.first_date, a.kind), '[]'::jsonb) as items
      from periodo p
      cross join lateral public.home_alerts(p_household, p.as_of) a
     where a.kind in ('overdue_payable', 'overdue_receivable')
  ),
  resumo_realizado as materialized (
    select ps.*
      from periodo p
      cross join lateral public.period_summary(p_household, p.month_start, least(p.as_of, p.month_end)) ps
     where p.as_of >= p.month_start
  ),
  resumo_mes as materialized (
    select ps.*
      from periodo p
      cross join lateral public.period_summary(p_household, p.month_start, p.month_end) ps
  ),
  categorias as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'categoryId', ranked.category_id,
      'name', ranked.category_name,
      'limit', ranked.amount_limit,
      'spent', ranked.spent,
      'planned', ranked.planned,
      'projected', ranked.projected,
      'remaining', ranked.remaining,
      'percent', round(100 * ranked.projected / ranked.amount_limit, 1)
    ) order by ranked.ratio desc, ranked.category_name), '[]'::jsonb) as items
      from (
        select x.*, x.projected / nullif(x.amount_limit, 0) as ratio
          from periodo p
          cross join lateral public.budget_projection(p_household, p.month_start, p.as_of) x
         where x.amount_limit > 0
         order by x.projected / nullif(x.amount_limit, 0) desc, x.category_name
         limit 5
      ) ranked
  ),
  calculo as (
    select p.month_start, p.month_end, p.as_of, t.available,
           r.total_reservado,
           (t.available - r.total_reservado) as circulating_balance,
           c.total_pendente, c.items,
           coalesce((select r.income_paid from resumo_realizado r), 0) as income_paid,
           coalesce((select r.income_planned from resumo_mes r), 0) as income_planned,
           case when p.today > p.month_end then 0
                else greatest(0, p.month_end - greatest(p.month_start, p.as_of) + 1) end as days_remaining,
           mp.*
      from periodo p
      cross join tesouraria t
      cross join compromissos c
      cross join reservas_comprometidas r
      cross join projecao mp
  )
  select jsonb_build_object(
    'monthStart', c.month_start,
    'monthEnd', c.month_end,
    'asOf', least(c.as_of, c.month_end),
    'availableMoney', round(c.available, 2),
    'reserveCommitted', round(c.total_reservado, 2),
    'circulatingBalance', round(c.circulating_balance, 2),
    'moneyFree', round(c.circulating_balance - c.total_pendente, 2),
    'dailySafeLimit', case when c.days_remaining > 0
      then round(greatest(c.circulating_balance - c.total_pendente, 0) / c.days_remaining, 2)
      else 0 end,
    'currentDailyPace', case when c.days_elapsed > 0
      then round(c.spent / c.days_elapsed, 2) else 0 end,
    'incomePaid', round(c.income_paid, 2),
    'incomePlanned', round(c.income_planned, 2),
    'expensesPaid', round(c.spent, 2),
    'expensesPlanned', round(c.planned, 2),
    'plannedOutflows', round(c.total_pendente, 2),
    'treasury', (select to_jsonb(t) from tesouraria t),
    'projection', jsonb_build_object(
      'daysInMonth', c.days_in_month, 'daysElapsed', c.days_elapsed, 'daysLeft', c.days_left,
      'spent', round(c.spent, 2), 'planned', round(c.planned, 2),
      'variableSoFar', round(c.variable_so_far, 2), 'pacePerDay', round(c.pace_per_day, 2),
      'paceExtra', round(c.pace_extra, 2), 'projected', round(c.projected, 2)
    ),
    'upcoming_commitments', c.items,
    'risks', a.items,
    'monitoredCategories', k.items,
    'opportunities', null,
    'calculation', jsonb_build_object(
      'method', 'home_indicators + dashboard_commitment_matrix + month_projection',
      'cardAmountsDeductedByReconciledValue', true,
      'reservesIncluded', true,
      'reserveCurrency', 'BRL',
      'reserveStatusesIncluded', jsonb_build_array('active', 'completed'),
      'note', 'Dinheiro Livre = tesouraria disponível menos reservas comprometidas em BRL e compromissos futuros. De cada fatura de cartão, somente o valor efetivamente cobrado e ainda não pago (charged - paid) é abatido da matriz; parcelas ainda não cobradas permanecem como compromisso.'
    )
  )
    from calculo c
    cross join alertas a
    cross join categorias k
   where p_household is not null
     and p_month is not null
     and (select private.is_member(p_household));
$$;

revoke execute on function public.get_home_decision_month(uuid, date) from public, anon;
grant execute on function public.get_home_decision_month(uuid, date) to authenticated;


-- Consulta de reservas: os saldos são agregados no PostgreSQL, nunca no navegador.
-- Cada reserva retorna até os 20 movimentos mais recentes; o saldo considera o ledger inteiro.
create function public.reserve_overview(p_household uuid)
returns table (
  reserve_id uuid,
  name text,
  currency_code text,
  target_amount numeric,
  target_date date,
  icon text,
  color text,
  status text,
  balance numeric,
  allocation_id uuid,
  allocation_amount numeric,
  allocation_date date,
  allocation_description text,
  allocation_created_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $function$
  select r.id, r.name, r.currency_code, r.target_amount, r.target_date, r.icon, r.color,
         r.status, coalesce(b.balance, 0)::numeric as balance,
         a.id, a.amount, a.date, a.description, a.created_at
    from public.reserves r
    left join lateral (
      select sum(x.amount) as balance
        from public.reserve_allocations x
       where x.household_id = r.household_id and x.reserve_id = r.id
    ) b on true
    left join lateral (
      select x.id, x.amount, x.date, x.description, x.created_at
        from public.reserve_allocations x
       where x.household_id = r.household_id and x.reserve_id = r.id
       order by x.date desc, x.created_at desc, x.id desc
       limit 20
    ) a on true
   where r.household_id = p_household
     and (select private.is_member(p_household))
   order by case r.status when 'active' then 0 when 'completed' then 1 else 2 end,
            r.name, a.date desc nulls last, a.created_at desc nulls last;
$function$;

revoke execute on function public.reserve_overview(uuid) from public, anon;
grant execute on function public.reserve_overview(uuid) to authenticated;
