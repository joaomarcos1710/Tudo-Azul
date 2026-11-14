-- Matriz de compromissos: as assinaturas de cartão respeitam as exceções da fatura (cancelada, editada, dividida).
--
-- Achado em 14/11/2026 (reprodução no Postgres local, a pedido do dono "segue com as linhas duplicadas"): a matriz
-- lia as assinaturas de cartão só da regra (recurrences) e nunca de card_scheduled_items, onde ficam as exceções que a
-- pessoa faz na fatura ("só esta" editar/cancelar, "esta e as próximas", migration 20261110050000). Resultado:
--   * uma cobrança CANCELADA na fatura continuava aparecendo na matriz e entrando no "Total do mês" (valor a mais);
--   * uma cobrança EDITADA (valor, data ou descrição) aparecia com o valor antigo da regra.
-- Relatórios, saldo previsto e orçamento já usavam private.card_recurrence_pending, que respeita as exceções; a matriz
-- era a única fora. Nada mais muda: o corpo abaixo é o da 20261110060000 (migration aplicada não se edita) com a troca
-- do bloco recorrencias_cartao, que agora faz o mesmo que card_recurrence_pending:
--   * ocorrência da regra sem parcela e sem item agendado: vem da regra, como antes;
--   * item agendado (status scheduled, regra ativa): vale com o valor, a descrição e a fatura (closing_date) dele;
--   * item cancelado ou convertido: não entra (o convertido já é parcela e aparece em parcelas_cartao).
-- Mesma assinatura e mesmas colunas; só leitura.

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
  -- Do mês corrente em diante a data de corte é sempre hoje: calcular as faturas uma vez por cartão e por
  -- data de corte DISTINTA, e só depois repartir pelos meses (antes eram cartões x meses chamadas iguais).
  datas_corte as (
    select distinct p.as_of from periodos_cartao p
  ),
  meses_cartao as materialized (
    select d.id as cartao_id, d.name as cartao, c.as_of,
           m.label, m.due_date, m.total, m.paid
      from public.debts d
      cross join datas_corte c
      cross join lateral private.card_months_as_of(d.id, c.as_of) m
     where d.household_id = p_household
       and d.kind = 'card'
  ),
  faturas_cartao as materialized (
    select m.cartao_id, m.cartao, m.label,
           m.due_date as vencimento, greatest(m.total - m.paid, 0) as em_aberto,
           p.as_of
      from periodos_cartao p
      join meses_cartao m on m.as_of = p.as_of
     where m.due_date between p.inicio_mes and p.fim_mes
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
  -- Assinaturas de cartão futuras. A geração automática só materializa compras até hoje; as ocorrências futuras
  -- precisam aparecer aqui, COM as exceções que a pessoa fez na fatura (card_scheduled_items, migration 20261110050000):
  --   * ocorrência sem item agendado e sem parcela: vem da regra, como sempre;
  --   * item agendado (editado ou não): vale com o valor, a descrição e a fatura dele;
  --   * item cancelado ou convertido em parcela: a regra não o traz de volta (convertido já entra em parcelas_cartao).
  -- É a mesma lógica de private.card_recurrence_pending, que Relatórios, saldo previsto e orçamento já usavam.
  recorrencias_cartao as (
    select x.id, x.descricao, x.origem, x.tipo_origem, x.mes, x.moeda, sum(x.valor) as valor
    from (
      select
        'card-recurrence:' || r.id::text as id,
        r.description as descricao,
        d.name as origem,
        'Cartão'::text as tipo_origem,
        date_trunc('month', datas.vencimento::timestamp)::date as mes,
        'BRL'::text as moeda,
        r.amount as valor
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
        and not exists (
          select 1
          from public.card_scheduled_items s
          where s.household_id = p_household
            and s.recurrence_id = r.id
            and s.occurrence_date = o.ocorrencia
        )
      union all
      select
        'card-recurrence:' || r.id::text,
        s.description,
        d.name,
        'Cartão'::text,
        date_trunc('month', datas.vencimento::timestamp)::date,
        'BRL'::text,
        s.amount
      from public.card_scheduled_items s
      join public.recurrences r
        on r.household_id = s.household_id and r.id = s.recurrence_id and r.active
      join public.debts d
        on d.household_id = s.household_id and d.id = s.debt_id and d.kind = 'card'
      left join public.debt_invoices inv
        on inv.household_id = p_household
       and inv.debt_id = d.id
       and inv.label = to_char(s.closing_date, 'YYYY-MM')
      cross join lateral (
        select coalesce(inv.due_date, private.card_cycle_due(d, s.closing_date)) as vencimento
      ) datas
      where s.household_id = p_household
        and s.status = 'scheduled'
        and d.closing_day is not null
        and d.due_day is not null
        and datas.vencimento between v_from and v_to
    ) x
    group by x.id, x.descricao, x.origem, x.tipo_origem, x.mes, x.moeda
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
