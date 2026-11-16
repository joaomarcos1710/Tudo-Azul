-- Tudo Azul — migration 128: dia em que o MÊS FINANCEIRO começa (por pessoa) e Limite diário seguro até o próximo salário.
--
-- Decisão do dono (16/11/2026): o salário cai no dia 20, então o mês dele vai de 20 a 19, e cada pessoa tem o seu dia. O
-- "Limite diário seguro" dividia o Dinheiro Livre pelos dias até o fim do MÊS-CALENDÁRIO; agora divide pelos dias até a véspera
-- do próximo dia D (D = user_preferences.month_start_day, de 1 a 28, padrão 1).
--   * Com D = 1 o resultado é IDÊNTICO ao de antes (fim do mês). Quem nunca escolhe não vê diferença.
--   * Etapa 1 só. O Dinheiro Livre NÃO muda (horizonte continua mês corrente + seguinte, decisão de 15/11/2026). Trocar o horizonte
--     para "até o dia D-1" é a etapa 2, só com nova decisão do dono e revisão de valor.
--   * Dia 29 a 31 não existe (fevereiro): o limite é 28, então todo mês tem o dia D.
-- O que muda:
--   1. user_preferences.month_start_day smallint not null default 1 check (1..28) + grants de coluna (insert/update na linha da própria pessoa, como as outras preferências).
--   2. public.get_home_decision_month (create or replace, mesma assinatura e grants; corpo da migration 126): `days_remaining` conta de hoje até a véspera
--      do próximo dia D; o JSON ganha calculation.monthStartDay e calculation.dailyLimitUntil (a data do fim do ciclo, para a tela dizer "até DD/MM").
--      Mês passado: 0 dias (como antes). Mês futuro: o mês inteiro (como antes).
-- SECURITY INVOKER; a RLS da user_preferences só deixa ler a linha de quem pergunta.
-- Teste: 122_month_start_day.

alter table public.user_preferences
  add column month_start_day smallint not null default 1 check (month_start_day between 1 and 28);
grant insert (month_start_day), update (month_start_day) on public.user_preferences to authenticated;

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
                 (date_trunc('month', p_month::timestamp) + interval '1 month - 1 day')::date) as as_of,
           (date_trunc('month', p_month::timestamp) + interval '1 month')::date as next_month_start,
           (date_trunc('month', p_month::timestamp) + interval '2 months - 1 day')::date as next_month_end
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
     where cm.period_month in (p.month_start, p.next_month_start)
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
     where cm.due_date between p.month_start and p.next_month_end
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
  -- Migration 126 (decisão do dono, 15/11/2026): despesa planejada ATRASADA de meses anteriores também reduz o Dinheiro Livre
  -- (o saldo projetado já a descontava). Só o que venceu antes do mês: o atraso dentro do mês já está na matriz. Mesmos critérios
  -- da matriz: despesa de conta em reais; parcela de empréstimo/financiamento ativo que não é consignado (descontado em folha).
  atrasadas as (
    select coalesce(sum(x.valor), 0) as total
      from periodo p
      cross join lateral (
        select t.amount as valor
          from public.transactions t
          join public.accounts a on a.household_id = t.household_id and a.id = t.account_id and a.currency_code = 'BRL'
         where t.household_id = p_household and t.type = 'expense' and t.status = 'planned'
           and t.deleted_at is null and t.date < least(p.month_start, p.today)
        union all
        select s.amount
          from public.debt_payment_schedule s
          join public.debts d on d.household_id = s.household_id and d.id = s.debt_id
         where s.household_id = p_household and s.status = 'planned' and s.due_date < least(p.month_start, p.today)
           and d.active and d.kind in ('loan', 'financing') and d.payment_method is distinct from 'payroll'
      ) x
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
    union all
    select 'overdue:before-month', 'Despesas em atraso de meses anteriores', 'Atrasadas', 'Conta',
           p.month_start, 'BRL', a.total
      from periodo p
      cross join atrasadas a
     where a.total > 0
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
  ciclo as (
    -- D de quem pergunta (RLS: só a própria linha); 1 se nunca escolheu. Fim do ciclo = véspera do próximo dia D depois de hoje.
    select pf.dia,
           ((case when extract(day from p.today) >= pf.dia
                  then (date_trunc('month', p.today::timestamp) + interval '1 month')::date
                  else date_trunc('month', p.today::timestamp)::date end) + (pf.dia - 1) - 1) as ciclo_fim
      from periodo p
     cross join lateral (
       select coalesce((select u.month_start_day from public.user_preferences u where u.user_id = (select auth.uid())), 1)::int as dia
     ) pf
  ),
  calculo as (
    select p.month_start, p.month_end, p.as_of, t.available,
           r.total_reservado,
           (t.available - r.total_reservado) as circulating_balance,
           c.total_pendente, c.items,
           coalesce((select r.income_paid from resumo_realizado r), 0) as income_paid,
           coalesce((select r.income_planned from resumo_mes r), 0) as income_planned,
           -- dias até o próximo salário (decisão do dono, 16/11/2026): o ciclo vai do dia D de um mês ao dia D-1 do seguinte
           -- (D = user_preferences.month_start_day de quem pergunta; padrão 1 = o mês-calendário, igual a antes). Conta o dia de hoje.
           case when p.today > p.month_end then 0
                when p.today < p.month_start then greatest(0, p.month_end - p.month_start + 1)
                else pc.ciclo_fim - p.today + 1 end as days_remaining,
           pc.ciclo_fim as cycle_end, pc.dia as month_start_day,
           mp.*
      from periodo p
      cross join tesouraria t
      cross join compromissos c
      cross join reservas_comprometidas r
      cross join projecao mp
      cross join ciclo pc
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
      'note', 'Dinheiro Livre = tesouraria disponível menos reservas comprometidas em BRL e compromissos do mês e do mês seguinte, mais as despesas planejadas atrasadas de meses anteriores. De cada fatura de cartão, somente o valor efetivamente cobrado e ainda não pago (charged - paid) é abatido da matriz; parcelas ainda não cobradas permanecem como compromisso. Receita planejada não entra.',
      'horizonMonths', 2,
      'overdueBeforeMonthIncluded', true,
      'monthStartDay', (select pc.dia from ciclo pc),
      'dailyLimitUntil', (select pc.ciclo_fim from ciclo pc)
    )
  )
    from calculo c
    cross join alertas a
    cross join categorias k
   where p_household is not null
     and p_month is not null
     and (select private.is_member(p_household));
$$;
