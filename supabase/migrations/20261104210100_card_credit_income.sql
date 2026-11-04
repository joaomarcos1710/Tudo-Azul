-- Tudo Azul — migration 052: crédito avulso no cartão conta como RECEITA
--
-- Decisão do dono (04/11/2026, "Reembolso no cartão conta como receita", opção A): um crédito no cartão que NÃO é estorno
-- de uma compra (estorno de IOF, "ajuste de crédito", cashback, reembolso da empresa ou do plano de saúde) entra como
-- RECEITA do mês, na categoria de receita escolhida, mesmo inflando receita e despesa. Antes o cartão só aceitava crédito
-- ligado a uma parcela (debt_refund, eventos cancel/credit), que ABATE a despesa da compra.
--
-- Desenho:
--   * novo tipo de evento 'income_credit' em debt_events: sem conta, sem parcela, sem fatura (invoice_id), COM categoria
--     de RECEITA (category_type = 'income'); a data do crédito informada pela pessoa fica em credit_date (só neste tipo).
--   * date do evento = DATA DE FECHAMENTO da fatura em que o crédito entra. Padrão: a fatura aberta na data do crédito,
--     mesma regra das compras (private.card_first_closing: no dia do fechamento ou depois, a seguinte). Pode-se escolher
--     uma fatura posterior (p_closing): até 3 faturas depois da natural (como a 051 na compra), nunca antes, e que seja
--     um fechamento do cartão. A trava do início do cartão vale para a data do FECHAMENTO (como a 051).
--     Por isso UMA data governa tudo, como na compra: o mês da receita é o do fechamento (o mesmo em que as compras
--     daquela fatura viram despesa), a fatura do mês AAAA-MM do fechamento é abatida e a dívida do cartão cai nessa data.
--   * efeito no saldo do cartão: como o 'credit' (reduz a dívida; se passar dela, vira crédito a receber — o mesmo
--     caminho do pagamento adiantado, que private.debt_chk já aceita em cartão). A devolução em dinheiro (refund_cash)
--     continua presa ao crédito a receber; anular um crédito já devolvido em dinheiro é recusado (23514), como hoje.
--   * receita (decisão do dono, 04/11/2026): PLANEJADA enquanto a fatura não fechou (date > hoje em São Paulo) e
--     RECEBIDA a partir do fechamento, como a compra, que é compromisso até fechar. period_summary (income_planned ×
--     income_paid), cash_flow_report (a futura só com p_include_planned), income_regularity e budget_rule_report (só
--     contam realizado: a futura fica de fora até fechar). Fonte única: private.card_income_items (coluna paid).
--     NÃO entra em nenhuma despesa (expense_items, budget_usage, period_summary.expense_*): o filtro de tipo dessas
--     funções já deixa o evento de fora.
--   * fatura: card_months ganha a coluna credits (créditos avulsos da fatura) e "charged" passa a descontá-los; o total
--     nunca fica negativo: o que sobra do crédito vira adiantamento para as próximas faturas (mesmo caminho do excedente
--     de pagamento). Com isso card_invoices_month, card_invoices_due, account_balances_projected e
--     balance_totals_projected (todas leem card_months) mostram a fatura abatida sem mudar.
--   * anulação: debt_void (já existente) anula o evento; tudo volta.
--   * limite (decisão do dono, 04/11/2026): card_limits devolve o limite NA DATA DO CRÉDITO (credit_date), antes do
--     fechamento; depois do fechamento o crédito já está no saldo e não conta duas vezes.
--   * arquivar: debt_archive recusa cartão com crédito numa fatura que ainda não fechou.
--   * card_months: a devolução em dinheiro (refund_cash) que levou uma sobra deixa de reaparecer como adiantamento.
--
-- Códigos de erro: 42501 sem permissão/registro inexistente; 22023 parâmetro inválido; 22003 mais de 2 casas;
-- 23514 regra de integridade; 55000 cartão sem ciclo.

-- ---------------------------------------------------------------------------
-- 1. Tabela: tipo novo, categoria de receita e data do crédito
-- ---------------------------------------------------------------------------
alter table public.debt_events add column credit_date date
  check (credit_date between date '2000-01-01' and date '2100-01-01');

alter table public.debt_events drop constraint debt_events_kind_check;
alter table public.debt_events add constraint debt_events_kind_check
  check (kind = any (array['disbursement','charge','payment','extra_principal','interest','fee','credit','refund_cash',
                           'cancel','payroll_payment','income_credit']));

alter table public.debt_events drop constraint debt_events_category_type_check;
alter table public.debt_events add constraint debt_events_category_type_check
  check (category_type in ('expense', 'income'));

-- forma: igual à da migration 002, só acrescentando income_credit entre os que exigem categoria
alter table public.debt_events drop constraint debt_events_shape;
alter table public.debt_events add constraint debt_events_shape check (
      ((kind in ('disbursement', 'payment', 'extra_principal', 'interest', 'fee', 'refund_cash'))
         = (account_id is not null))
  and ((kind in ('charge', 'credit', 'cancel')) = (installment_id is not null))
  and ((kind in ('interest', 'fee', 'income_credit')) = (category_id is not null))
);

-- crédito avulso: categoria de RECEITA, data do crédito antes do fechamento, nada de fatura; nos demais, nada disso
alter table public.debt_events add constraint debt_events_income_credit_shape check (
      ((kind = 'income_credit') = (category_type = 'income'))
  and ((kind = 'income_credit') = (credit_date is not null))
  and (kind <> 'income_credit' or (invoice_id is null and credit_date < date))
);

create index debt_events_income_credit_idx on public.debt_events (household_id, date)
  where kind = 'income_credit' and voided_at is null;

-- ---------------------------------------------------------------------------
-- 2. Efeito no saldo do cartão (create or replace a partir da migration 038)
-- ---------------------------------------------------------------------------
create or replace function private.debt_effect(p_kind text, p_amount numeric)
returns numeric language sql immutable set search_path = '' as $$
  select case when p_kind in ('disbursement','charge','refund_cash') then p_amount
              when p_kind in ('payment','extra_principal','credit','payroll_payment','income_credit') then -p_amount
              else 0 end
$$;

create or replace function public.debt_balances(p_household uuid, p_as_of date)
returns table(debt_id uuid, name text, kind text, balance numeric, debt numeric, credit_receivable numeric, planned_remaining numeric)
language sql stable security invoker set search_path = '' as $$
  select d.id, d.name, d.kind, b.bal, greatest(b.bal, 0), greatest(-b.bal, 0), coalesce(p.rem, 0)
  from public.debts d
  cross join lateral (
    select d.reference_balance + coalesce(sum(case
      when e.kind in ('disbursement','charge','refund_cash') then e.amount
      when e.kind in ('payment','extra_principal','credit','payroll_payment','income_credit') then -e.amount
      else 0 end), 0) as bal
    from public.debt_events e
    where e.household_id = d.household_id and e.debt_id = d.id
      and e.voided_at is null and e.date <= p_as_of
  ) b
  left join lateral (
    select sum(i.face - coalesce((
      select sum(e.amount) from public.debt_events e
      where e.household_id = i.household_id and e.installment_id = i.id
        and e.kind in ('charge','cancel') and e.voided_at is null and e.date <= p_as_of
    ), 0)) as rem
    from public.debt_installments i
    where i.household_id = d.household_id and i.debt_id = d.id
  ) p on true
  where d.household_id = p_household and d.reference_date <= p_as_of
    and (select private.is_member(p_household))
  order by d.name
$$;

-- Evento continua imutável (só a anulação muda), agora também na data do crédito (create or replace da 038)
create or replace function private.debt_events_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.amount is not null then
      if new.amount <> round(new.amount,2) then
        raise exception 'valor com mais de 2 casas decimais: %',new.amount using errcode = '22003';
      end if;
      new.amount := round(new.amount,2);
    end if;
    if new.account_id is not null and exists (
      select 1 from public.accounts a
      where a.household_id=new.household_id and a.id=new.account_id and not a.active
    ) then
      raise exception 'conta desativada' using errcode = '23514';
    end if;
    return new;
  end if;
  if old.voided_at is not null then
    raise exception 'evento já anulado não pode ser alterado' using errcode = '55000';
  end if;
  if (new.id,new.household_id,new.debt_id,new.date,new.kind,new.amount,new.account_id,new.installment_id,
      new.invoice_id,new.category_id,new.op_id,new.note,new.created_by,new.created_at,new.schedule_id,
      new.category_type,new.credit_date)
     is distinct from
     (old.id,old.household_id,old.debt_id,old.date,old.kind,old.amount,old.account_id,old.installment_id,
      old.invoice_id,old.category_id,old.op_id,old.note,old.created_by,old.created_at,old.schedule_id,
      old.category_type,old.credit_date) then
    raise exception 'evento é imutável: use a anulação' using errcode = '42501';
  end if;
  return new;
end
$$;

revoke execute on function private.debt_effect(text, numeric), private.debt_events_guard() from public, anon, authenticated;
revoke execute on function public.debt_balances(uuid, date) from public, anon;
grant execute on function public.debt_balances(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Operação: lançar o crédito
-- ---------------------------------------------------------------------------
create function public.card_credit_income(p_debt uuid, p_date date, p_amount numeric, p_category uuid,
                                          p_description text, p_closing date default null, p_idem uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_d public.debts%rowtype; v_natural date; v_ultima date; v_closing date;
  v_desc text := nullif(btrim(p_description), ''); v_id uuid; v_voided boolean;
begin
  v_d := private.debt_lock(p_debt);
  if v_d.kind <> 'card' then
    raise exception 'crédito avulso só existe em cartão' using errcode = '23514';
  end if;
  if v_d.closing_day is null then
    raise exception 'defina o dia de fechamento e de vencimento do cartão antes de lançar créditos' using errcode = '55000';
  end if;
  if p_date is null or p_amount is null or p_amount <= 0 or p_amount >= 1e12 then
    raise exception 'data ou valor do crédito inválido' using errcode = '22023';
  end if;
  if p_amount <> round(p_amount, 2) then
    raise exception 'valor com mais de 2 casas decimais: %', p_amount using errcode = '22003';
  end if;
  if v_desc is null or char_length(v_desc) > 80 then
    raise exception 'informe a descrição do crédito (até 80 caracteres)' using errcode = '22023';
  end if;
  if p_category is null or not exists (
    select 1 from public.categories c
     where c.household_id = v_d.household_id and c.id = p_category and c.type = 'income' and c.active
  ) then
    raise exception 'categoria de receita inválida ou inativa' using errcode = '23514';
  end if;

  -- fatura natural: a aberta na data do crédito (mesma regra da compra). A escolhida (p_closing) vai da natural até
  -- 3 faturas depois (como a 051 na compra), nunca antes; e tem de ser um fechamento do cartão: o dia do ciclo atual
  -- naquele mês ou o fechamento de uma fatura que já existe (ciclo antigo)
  v_natural := private.card_first_closing(p_date, v_d.closing_day);
  if p_closing is null then
    v_closing := v_natural;
  else
    v_ultima := private.card_day_in_month((date_trunc('month', v_natural) + interval '3 months')::date, v_d.closing_day);
    if p_closing < v_natural or p_closing > v_ultima then
      raise exception 'a fatura escolhida precisa fechar entre % e % (a aberta na data do crédito e até 3 depois)',
        v_natural, v_ultima using errcode = '22023';
    end if;
    if p_closing <> private.card_day_in_month(p_closing, v_d.closing_day)
       and not exists (select 1 from public.debt_installments i
                        where i.household_id = v_d.household_id and i.debt_id = v_d.id and i.due_date = p_closing) then
      raise exception 'a data escolhida não é um fechamento deste cartão' using errcode = '22023';
    end if;
    v_closing := p_closing;
  end if;
  -- o que FECHA até a data de referência já está no saldo de referência (mesma trava da compra na 051: vale a data
  -- do fechamento, não a do crédito)
  if v_closing <= v_d.reference_date then
    raise exception 'esta fatura fecha em %, até o início do cartão (%): recue o início do cartão', v_closing, v_d.reference_date
      using errcode = '23514';
  end if;

  -- idempotência: a chave só vale para ESTE crédito. Em qualquer outro evento (deste ou de outro cartão) ela faria
  -- debt_void anular os dois juntos (op_id compartilhado): recusa. Crédito com a mesma chave já ANULADO: recusa em vez
  -- de regravar ou de devolver o anulado como se tivesse gravado (a tela gera chave nova a cada formulário).
  if p_idem is not null then
    if exists (select 1 from public.debt_events e
                where e.household_id = v_d.household_id and e.op_id = p_idem
                  and (e.debt_id <> v_d.id or e.kind <> 'income_credit')) then
      raise exception 'chave de idempotência já usada em outro movimento' using errcode = '22023';
    end if;
    select e.id, e.voided_at is not null into v_id, v_voided from public.debt_events e
     where e.household_id = v_d.household_id and e.debt_id = v_d.id and e.op_id = p_idem and e.kind = 'income_credit'
     order by (e.voided_at is null) desc
     limit 1;
    if found then
      if v_voided then
        raise exception 'esta chave é de um crédito já anulado: lance de novo' using errcode = '22023';
      end if;
      return v_id;
    end if;
  end if;

  insert into public.debt_events (household_id, debt_id, date, kind, amount, category_id, category_type,
                                  credit_date, op_id, note)
  values (v_d.household_id, v_d.id, v_closing, 'income_credit', p_amount, p_category, 'income',
          p_date, p_idem, v_desc)
  returning id into v_id;
  perform private.debt_chk(v_d.id);
  return v_id;
end $$;

revoke execute on function public.card_credit_income(uuid, date, numeric, uuid, text, date, uuid) from public, anon;
grant execute on function public.card_credit_income(uuid, date, numeric, uuid, text, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Fonte única da receita do cartão (para os relatórios SECURITY INVOKER)
-- ---------------------------------------------------------------------------
-- Mês = data do evento = fechamento da fatura. Sem conta (o dinheiro não passou por conta nenhuma).
-- paid: a fatura já fechou (data <= hoje em São Paulo). Antes disso é receita PLANEJADA, como a compra é compromisso
-- até o fechamento (decisão do dono, 04/11/2026). "Hoje" escrito aqui (mesma expressão de private.today_sp) porque os
-- relatórios rodam como o cliente, que não executa today_sp.
create function private.card_income_items(p_household uuid, p_from date, p_to date)
returns table (day date, category_id uuid, amount numeric, created_by uuid, paid boolean)
language sql stable security invoker set search_path = '' as $$
  select e.date, e.category_id, e.amount, e.created_by, e.date <= (now() at time zone 'America/Sao_Paulo')::date
    from public.debt_events e
   where e.household_id = p_household and e.voided_at is null and e.kind = 'income_credit'
     and e.date between p_from and p_to
$$;
revoke execute on function private.card_income_items(uuid, date, date) from public, anon;
grant execute on function private.card_income_items(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Relatórios de receita (create or replace a partir da última versão de cada um)
-- ---------------------------------------------------------------------------
-- period_summary: versão da migration 046 + crédito avulso do cartão em income_paid
create or replace function public.period_summary(p_household uuid, p_from date, p_to date)
returns table (income_paid numeric, expense_paid numeric, result numeric,
               income_planned numeric, expense_planned numeric)
language sql stable security invoker set search_path = '' as $$
  select s.income_paid, s.expense_paid, s.income_paid - s.expense_paid,
         s.income_planned, s.expense_planned
    from (
      select coalesce(sum(t.amount) filter (where t.type = 'income'  and t.status = 'paid'), 0)
               + coalesce((select sum(ci.amount) from private.card_income_items(p_household, p_from, p_to) ci where ci.paid), 0) as income_paid,
             coalesce(sum(t.amount) filter (where t.type = 'expense' and t.status = 'paid'), 0)
               + coalesce((select sum(case when e.kind = 'credit' then -e.amount else e.amount end)
                             from public.debt_events e
                            where e.household_id = p_household and e.voided_at is null
                              and e.kind in ('charge', 'credit', 'interest', 'fee')
                              and e.date between p_from and p_to), 0)
               + coalesce((select sum(l.amount) from private.loan_principal_items(p_household, p_from, p_to) l), 0) as expense_paid,
             coalesce(sum(t.amount) filter (where t.type = 'income'  and t.status = 'planned'), 0)
               + coalesce((select sum(ci.amount) from private.card_income_items(p_household, p_from, p_to) ci where not ci.paid), 0) as income_planned,
             coalesce(sum(t.amount) filter (where t.type = 'expense' and t.status = 'planned'), 0)
               + coalesce((select sum(i.face - coalesce((select sum(e.amount) from public.debt_events e
                                    where e.installment_id = i.id and e.kind in ('charge', 'cancel')
                                      and e.voided_at is null), 0))
                             from public.debt_installments i
                            where i.household_id = p_household and i.due_date between p_from and p_to), 0)
               + coalesce((select sum(s.amount) from private.loan_schedule_planned(p_household, p_from, p_to) s), 0) as expense_planned
        from (select 1) base
        left join public.transactions t
          on t.household_id = p_household
         and t.deleted_at is null
         and t.type in ('income', 'expense')
         and t.date between p_from and p_to
    ) s
   where (select private.is_member(p_household))
$$;

-- cash_flow_report: versão da migration 046 + crédito avulso do cartão como entrada. Sem conta: com filtro de conta fica
-- de fora (como as compras do cartão); filtro de membro = quem lançou.
create or replace function public.cash_flow_report(
  p_household uuid, p_from date, p_to date, p_step text default 'day',
  p_accounts uuid[] default null, p_member uuid default null, p_include_planned boolean default false)
returns table (period_start date, income numeric, expense numeric, balance numeric, cumulative numeric,
               total_income numeric, total_expense numeric)
language plpgsql stable security invoker set search_path = '' as $$
begin
  if p_step not in ('day', 'week', 'month') then
    raise exception 'passo inválido: use day, week ou month' using errcode = '22023';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 3660 or (p_step = 'day' and p_to - p_from > 366) then
    raise exception 'período inválido (dia: até 366 dias; semana e mês: até 10 anos)' using errcode = '22023';
  end if;
  return query
  with itens as (
    select t.date as dia, t.type as tipo, t.amount as valor
      from public.transactions t
     where t.household_id = p_household and t.deleted_at is null and t.type in ('income', 'expense')
       and t.date between p_from and p_to
       and (t.status = 'paid' or (p_include_planned and t.status = 'planned'))
       and (p_accounts is null or t.account_id = any(p_accounts))
       and (p_member is null or t.created_by = p_member)
    union all
    select e.date, 'expense', case when e.kind = 'credit' then -e.amount else e.amount end
      from public.debt_events e
     where e.household_id = p_household and e.voided_at is null
       and e.kind in ('charge', 'credit', 'interest', 'fee') and e.date between p_from and p_to
       and (p_accounts is null or e.account_id = any(p_accounts))
       and (p_member is null or e.created_by = p_member)
    union all
    -- crédito avulso no cartão (migration 052): receita no fechamento da fatura
    select ci.day, 'income', ci.amount
      from private.card_income_items(p_household, p_from, p_to) ci
     where p_accounts is null
       and (ci.paid or p_include_planned)
       and (p_member is null or ci.created_by = p_member)
    union all
    select i.due_date, 'expense',
           i.face - coalesce((select sum(e.amount) from public.debt_events e
                               where e.installment_id = i.id and e.kind in ('charge', 'cancel') and e.voided_at is null), 0)
      from public.debt_installments i
     where p_include_planned and p_accounts is null and p_member is null
       and i.household_id = p_household and i.due_date between p_from and p_to
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
    select (case p_step when 'day' then g::date when 'week' then date_trunc('week', g)::date
                        else date_trunc('month', g)::date end) as inicio
      from generate_series(p_from::timestamp, p_to::timestamp,
                           case p_step when 'day' then interval '1 day' when 'week' then interval '1 week'
                                       else interval '1 month' end) g
  ), unicos as (
    select distinct b.inicio from baldes b
    union
    select (case p_step when 'day' then p_to when 'week' then date_trunc('week', p_to)::date
                        else date_trunc('month', p_to)::date end)
  ), somas as (
    select u.inicio,
           coalesce(sum(x.valor) filter (where x.tipo = 'income'), 0) as entrada,
           coalesce(sum(x.valor) filter (where x.tipo = 'expense'), 0) as saida
      from unicos u
      left join itens x on (case p_step when 'day' then x.dia when 'week' then date_trunc('week', x.dia)::date
                                        else date_trunc('month', x.dia)::date end) = u.inicio
     group by u.inicio
  )
  select s.inicio, s.entrada, s.saida, s.entrada - s.saida,
         sum(s.entrada - s.saida) over (order by s.inicio),
         sum(s.entrada) over (), sum(s.saida) over ()
    from somas s
   where (select private.is_member(p_household))
   order by s.inicio;
end $$;

-- income_regularity: versão da migration 012 + crédito avulso do cartão (regular ou eventual pela categoria)
create or replace function public.income_regularity(p_household uuid, p_from date, p_to date)
returns table (income_regular numeric, income_eventual numeric, expense_paid numeric, coverage_pct numeric)
language sql stable security invoker set search_path = '' as $$
  select s.reg, s.ev, e.expense_paid,
         case when e.expense_paid > 0 then round(100 * s.reg / e.expense_paid, 1) end
    from (
      select coalesce(sum(r.amount) filter (where not (c.eventual or coalesce(p.eventual, false))), 0) as reg,
             coalesce(sum(r.amount) filter (where c.eventual or coalesce(p.eventual, false)), 0)       as ev
        from (
          select t.category_id, t.amount
            from public.transactions t
           where t.household_id = p_household and t.deleted_at is null
             and t.type = 'income' and t.status = 'paid'
             and t.date between p_from and p_to
          union all
          -- só o realizado (como os lançamentos pagos): crédito de fatura que ainda não fechou fica de fora
          select ci.category_id, ci.amount from private.card_income_items(p_household, p_from, p_to) ci where ci.paid
        ) r
        left join public.categories c on c.household_id = p_household and c.id = r.category_id
        left join public.categories p on p.household_id = c.household_id and p.id = c.parent_id
    ) s
   cross join lateral (select ps.expense_paid from public.period_summary(p_household, p_from, p_to) ps) e
   where (select private.is_member(p_household))
$$;

-- budget_rule_report: versão da migration 032; a base de renda passa a incluir o crédito avulso do cartão
create or replace function public.budget_rule_report(p_household uuid, p_from date, p_to date)
returns table (grp text, amount numeric, share_expense numeric, share_income numeric)
language sql stable security invoker set search_path = '' as $$
  with itens as (
    select coalesce(p.budget_group, c.budget_group, 'none') as grp, x.amount
      from private.expense_items(p_household, p_from, p_to) x
      join public.categories c on c.household_id = p_household and c.id = x.category_id
      left join public.categories p on p.household_id = c.household_id and p.id = c.parent_id
  ), por_grupo as (
    select g.grp, coalesce(sum(i.amount), 0) as total
      from (values ('essential'), ('lifestyle'), ('investment'), ('none')) g(grp)
      left join itens i on i.grp = g.grp group by g.grp
  ), renda as (
    select coalesce((select sum(t.amount)
                       from public.transactions t
                      where t.household_id = p_household and t.type = 'income' and t.status = 'paid'
                        and t.deleted_at is null and t.date between p_from and p_to), 0)
           + coalesce((select sum(ci.amount) from private.card_income_items(p_household, p_from, p_to) ci where ci.paid), 0) as total
  )
  select g.grp, g.total,
         case when sum(g.total) over () = 0 then 0 else round(100 * g.total / sum(g.total) over (), 1) end,
         case when r.total = 0 then null else round(100 * g.total / r.total, 1) end
    from por_grupo g cross join renda r
   where (select private.is_member(p_household))
   order by array_position(array['essential', 'lifestyle', 'investment', 'none'], g.grp)
$$;

-- ---------------------------------------------------------------------------
-- 6. Fatura: card_months (versão da migration 014) com os créditos avulsos
-- ---------------------------------------------------------------------------
-- credits = créditos avulsos da fatura (mês do fechamento); charged passa a descontá-los. O total nunca fica negativo:
-- o que o crédito tiver a mais que a fatura vira adiantamento (junto com o excedente de pagamento), quita primeiro o
-- saldo de referência e depois abate as próximas faturas. Mês só com crédito aparece como fatura (itens = 0).
-- A coluna nova muda o tipo de retorno: drop + create (as funções que leem card_months são SQL e leem por nome).
drop function public.card_months(uuid);
create function public.card_months(p_debt uuid)
returns table (label text, closing_date date, due_date date, charged numeric, pending numeric,
               total numeric, paid numeric, items integer, invoice_id uuid,
               previous_open numeric, advance_in numeric, advance_out numeric, credits numeric)
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_d record; r record; v_credit numeric; v_prev numeric := 0; v_ref numeric; v_s0 numeric; v_link numeric; v_total numeric;
  v_use numeric; v_surplus numeric; v_paid numeric; v_due date; v_b date; v_first boolean := true;
begin
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
     and e.kind in ('payment', 'extra_principal') and e.invoice_id is null;
  v_ref := v_d.reference_balance;
  v_s0 := least(v_credit, v_ref);
  v_ref := v_ref - v_s0;
  v_credit := v_credit - v_s0;

  for r in
    with parc as (
      select i.id, i.due_date, i.face, i.closing_day, i.due_day,
             coalesce((select sum(case e.kind when 'charge' then e.amount when 'credit' then -e.amount else 0 end)
                         from public.debt_events e
                        where e.installment_id = i.id and e.voided_at is null and e.kind in ('charge', 'credit')), 0) as cobrado,
             i.face - coalesce((select sum(e.amount) from public.debt_events e
                                 where e.installment_id = i.id and e.voided_at is null
                                   and e.kind in ('charge', 'cancel')), 0) as resta,
             coalesce((select sum(e.amount) from public.debt_events e
                        where e.installment_id = i.id and e.voided_at is null and e.kind = 'cancel'), 0) as cancelado
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
         and e.kind = 'income_credit'
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
                        and e.kind in ('payment', 'extra_principal')), 0) as pago_fatura
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
           and e.kind = 'refund_cash' and e.date < r.closing_date), 0));
      v_first := false;
    end if;

    v_total   := greatest(0, r.charged + r.pending);
    v_link    := r.pago_fatura;
    v_use     := least(v_credit, greatest(0, v_total - v_link));
    -- excedente: pagamento acima da fatura + crédito avulso acima da fatura (migration 052)
    v_surplus := greatest(0, v_link - v_total) + greatest(0, -(r.charged + r.pending));
    v_paid    := least(v_total, v_link) + v_use;

    label := r.label; closing_date := r.closing_date; due_date := v_due;
    charged := r.charged; pending := r.pending; total := v_total; paid := v_paid;
    items := r.items; invoice_id := r.inv_id; credits := r.credits;
    previous_open := v_prev + v_ref; advance_in := v_credit;
    v_s0 := least(v_surplus, v_ref);
    v_ref := v_ref - v_s0;
    v_credit := v_credit - v_use + (v_surplus - v_s0);
    -- devoluções feitas depois deste fechamento (inclusive) e antes do próximo: levam o crédito que existia então
    -- (inclui a sobra desta fatura); greatest(0, …) só protege a tela, debt_chk já garante a ordem
    v_credit := v_credit - coalesce((
      select sum(e.amount) from public.debt_events e
       where e.household_id = v_d.household_id and e.debt_id = v_d.id and e.voided_at is null
         and e.kind = 'refund_cash' and e.date >= r.closing_date
         and (r.next_closing is null or e.date < r.next_closing)), 0);
    if v_credit < 0 then v_credit := 0; end if;
    advance_out := v_credit;
    v_prev := v_prev + (v_total - v_paid);
    return next;
  end loop;
end $$;

revoke execute on function public.card_months(uuid) from public, anon;
grant execute on function public.card_months(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Limite: o crédito avulso devolve o limite NA DATA DO CRÉDITO (decisão do dono, 04/11/2026)
-- ---------------------------------------------------------------------------
-- card_limits (versão da migration 011). Até o fechamento o crédito ainda não está no saldo (debt_balances conta pela
-- data do evento = fechamento); aqui ele já abate o comprometido a partir de credit_date. Depois do fechamento ele está
-- no saldo e sai desta parcela extra: não conta duas vezes.
create or replace function public.card_limits(p_household uuid, p_as_of date)
returns table (debt_id uuid, credit_limit numeric, committed numeric, available numeric)
language sql stable security invoker set search_path = '' as $$
  select d.id, d.credit_limit,
         -- nunca negativo: crédito a mais não faz o disponível passar do limite
         greatest(0, b.debt + b.planned_remaining - b.credit_receivable - coalesce(c.antecipado, 0)),
         d.credit_limit - greatest(0, b.debt + b.planned_remaining - b.credit_receivable - coalesce(c.antecipado, 0))
    from public.debts d
    join public.debt_balances(p_household, p_as_of) b on b.debt_id = d.id
    left join lateral (
      select sum(e.amount) as antecipado
        from public.debt_events e
       where e.household_id = d.household_id and e.debt_id = d.id and e.voided_at is null
         and e.kind = 'income_credit' and e.credit_date <= p_as_of and e.date > p_as_of
    ) c on true
   where d.household_id = p_household and d.kind = 'card' and d.credit_limit is not null
     and (select private.is_member(p_household))
   order by d.name
$$;
revoke execute on function public.card_limits(uuid, date) from public, anon;
grant execute on function public.card_limits(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Arquivar: cartão com crédito avulso numa fatura que ainda não fechou não arquiva
-- ---------------------------------------------------------------------------
-- debt_archive (versão da migration 045). O crédito futuro ainda não está no saldo de hoje, mas entra no patrimônio
-- no fechamento: arquivado, sumiria da tela de Cartões e continuaria no patrimônio.
create or replace function public.debt_archive(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.debts%rowtype; b record; v_fecha date;
begin
  v := private.debt_lock(p_id);
  select * into b from public.debt_balances(v.household_id, private.today_sp()) x where x.debt_id = v.id;
  if found and (b.balance <> 0 or b.planned_remaining <> 0) then
    raise exception 'tem saldo ou parcelas a vencer: quite ou cancele antes de arquivar' using errcode = '23514';
  end if;
  select min(e.date) into v_fecha from public.debt_events e
   where e.debt_id = v.id and e.household_id = v.household_id and e.voided_at is null
     and e.kind = 'income_credit' and e.date > private.today_sp();
  if v_fecha is not null then
    raise exception 'tem crédito numa fatura que ainda não fechou (fecha em %): espere o fechamento ou anule o crédito antes de arquivar',
      to_char(v_fecha, 'DD/MM/YYYY') using errcode = '23514';
  end if;
  if exists (select 1 from public.recurrences r where r.debt_id = v.id and r.active) then
    raise exception 'tem recorrente ativo nesta dívida: exclua antes de arquivar' using errcode = '23514';
  end if;
  update public.debt_payment_schedule
     set status = 'cancelled', updated_at = now()
   where debt_id = v.id and household_id = v.household_id and status = 'planned';
  update public.debts
     set active = false,
         remaining_installments = case when remaining_installments is null then null else 0 end
   where id = v.id;
end $$;
revoke execute on function public.debt_archive(uuid) from public, anon;
grant execute on function public.debt_archive(uuid) to authenticated;
