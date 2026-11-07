-- Tudo Azul: matriz de compromissos futuros do Dashboard.
-- Totais e consolidação monetária são calculados no PostgreSQL. O cliente apenas apresenta linhas e totais.
-- Não altera lançamentos, contratos, recorrências, faturas ou saldos.

create function public.dashboard_commitment_matrix(
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
  faturas_cartao as materialized (
    select
      d.id as cartao_id,
      d.name as cartao,
      m.label,
      m.due_date as vencimento,
      greatest(m.total - m.paid, 0) as em_aberto
    from public.debts d
    cross join lateral public.card_months(d.id) m
    where d.household_id = p_household
      and d.kind = 'card'
      and m.due_date between v_from and v_to
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
    ) cancelados on true
    group by 1, 2, 3, 4, 5, 6, 7, 8, 9
  ),
  -- card_months também considera créditos avulsos e pagamentos parciais. A linha de ajuste reconcilia cada
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
