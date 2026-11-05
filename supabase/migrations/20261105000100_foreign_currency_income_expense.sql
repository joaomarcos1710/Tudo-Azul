-- Tudo Azul — migration 056: receita e despesa em moeda estrangeira (multimoeda, fase 2).
-- Decisão do dono (04/11/2026): a F2 libera receita e despesa em conta que não é BRL e separa os relatórios por moeda.
-- Nada é convertido aqui (cotação PTAX e total convertido ficam para a F4).
--
-- O que muda:
--   1. Conta que não é BRL passa a aceitar:
--        * lançamento de RECEITA e DESPESA (avulso, parcelado em conta e recorrente);
--        * TRANSFERÊNCIA entre duas contas da MESMA moeda (USD → USD).
--      Continuam recusados (23514, mensagem clara):
--        * transferência entre moedas diferentes (BRL → USD, USD → EUR...): fica para a F3, com a cotação;
--        * evento de dívida/cartão com conta não-BRL e conta de pagamento de cartão/dívida não-BRL
--          (debt_events_guard e debt_money_guard já chamam private.account_brl_only: só a mensagem muda);
--        * provento de investimento em conta não-BRL (investment_distribution_record e, ao editar o lançamento do
--          provento, transactions_guard).
--      Regras: private.account_brl_only (create or replace da 055, mensagem nova) e private.transfer_same_currency
--      (nova). Os gatilhos só chamam as duas; nenhuma comparação de moeda fica escrita dentro de um gatilho.
--   2. Relatórios em reais continuam SÓ em reais: toda função que soma lançamentos ignora o lançamento cuja conta não é
--      BRL (filtro pela moeda da conta do lançamento). Recriadas a partir da última versão, mudando só o filtro:
--        private.expense_items (046)        → herdam: expenses_by_category, daily_expenses, budget_rule_report (gastos)
--        public.period_summary (052)        → herdam: income_regularity (despesa), month_projection (gasto e planejado)
--        public.cash_flow_report (052)
--        public.budget_usage (046)          → herda: budget_projection (gasto)
--        public.budget_rule_report (052)    (renda)
--        public.budget_projection (041)     (planejado e ritmo)
--        public.income_regularity (052)     (receitas)
--        public.month_projection (041)      (gasto variável)
--        public.daily_digest (049)          (planejados vencidos e de hoje; o saldo previsto já era só BRL desde a 055)
--      Não mudam: account_movements, reconcile_account (por conta, uma moeda só), saldos (já por moeda na 055),
--      investment_income_by_asset e investment_asset_statement (provento só em conta BRL).
--   3. period_summary_by_currency(p_household, p_from, p_to): receita, despesa e resultado PAGOS por moeda, só das
--      moedas que não são BRL (o BRL é o period_summary). Sem conversão.
--   4. Orçamento: só BRL. Despesa em conta estrangeira não consome limite de orçamento (budget_usage filtra).
-- Testes: 56_foreign_currency_income_expense.

-- ---------------------------------------------------------------------------
-- 1. Regras de moeda
-- ---------------------------------------------------------------------------
-- (create or replace da 055) Agora vale só onde a operação continua em reais: cartão, dívida e provento.
create or replace function private.account_brl_only(p_household uuid, p_account uuid) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v_moeda text;
begin
  if p_account is null then
    return;
  end if;
  select a.currency_code into v_moeda from public.accounts a
   where a.household_id = p_household and a.id = p_account for share;
  if found and v_moeda <> 'BRL' then
    raise exception 'cartão, dívida e provento só usam conta em reais (BRL); esta conta é em %', v_moeda
      using errcode = '23514';
  end if;
end $$;

-- Transferência só entre contas da mesma moeda (entre moedas diferentes: F3, com a cotação).
-- Trava as duas contas (FOR SHARE), como account_brl_only. Conta inexistente: as FKs compostas reportam o erro.
create function private.transfer_same_currency(p_household uuid, p_source uuid, p_destination uuid) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v_origem text;
  v_destino text;
begin
  if p_source is null or p_destination is null then
    return;
  end if;
  select a.currency_code into v_origem from public.accounts a
   where a.household_id = p_household and a.id = p_source for share;
  select a.currency_code into v_destino from public.accounts a
   where a.household_id = p_household and a.id = p_destination for share;
  if v_origem is not null and v_destino is not null and v_origem <> v_destino then
    raise exception 'transferência entre moedas diferentes (% → %) ainda não é aceita (em breve, com a cotação)', v_origem, v_destino
      using errcode = '23514';
  end if;
end $$;
revoke execute on function private.transfer_same_currency(uuid, uuid, uuid) from public, anon, authenticated;
-- os gatilhos rodam como o chamador
grant execute on function private.transfer_same_currency(uuid, uuid, uuid) to authenticated;

-- transactions_guard (create or replace da 055): receita e despesa em qualquer moeda; transferência só na mesma moeda;
-- lançamento de provento só em conta BRL.
create or replace function private.transactions_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_src public.accounts%rowtype;
  v_dst public.accounts%rowtype;
  v_have_src boolean := false;
  v_have_dst boolean := false;
  v_restoring boolean := false;
  v_src_changed boolean := true;
  v_dst_changed boolean := true;
begin
  if tg_op = 'UPDATE' then
    if new.household_id is distinct from old.household_id then
      raise exception 'household_id não pode ser alterado' using errcode = '42501';
    end if;
    v_restoring   := old.deleted_at is not null;
    v_src_changed := new.account_id is distinct from old.account_id;
    v_dst_changed := new.destination_account_id is distinct from old.destination_account_id;
  end if;

  -- Dinheiro (N2): recusa mais de 2 casas e normaliza para escala 2.
  -- O CHECK da coluna roda DEPOIS deste trigger, então a recusa precisa estar aqui.
  if new.amount is not null then
    if new.amount <> round(new.amount, 2) then
      raise exception 'valor com mais de 2 casas decimais: %', new.amount using errcode = '22003';
    end if;
    new.amount := round(new.amount, 2);
  end if;

  -- Lançamento na lixeira não passa pelas regras de conta.
  if new.deleted_at is not null then
    return new;
  end if;

  -- Trava as contas envolvidas (FOR SHARE). O UPDATE em accounts toma bloqueio
  -- exclusivo da linha, então inserir lançamento e desativar/mudar a abertura da
  -- conta nunca acontecem ao mesmo tempo sem que um enxergue o outro.
  select * into v_src from public.accounts
   where household_id = new.household_id and id = new.account_id for share;
  v_have_src := found;
  if new.destination_account_id is not null then
    select * into v_dst from public.accounts
     where household_id = new.household_id and id = new.destination_account_id for share;
    v_have_dst := found;
  end if;
  -- Conta inexistente (ou de outra família): as FKs compostas reportam o erro.

  -- Multimoeda F2 (056): receita e despesa em qualquer moeda; transferência só entre contas da mesma moeda;
  -- o lançamento de um provento (investment_distributions) só em conta BRL.
  if new.type = 'transfer' then
    perform private.transfer_same_currency(new.household_id, new.account_id, new.destination_account_id);
  end if;
  if tg_op = 'UPDATE' and exists (select 1 from public.investment_distributions d where d.transaction_id = new.id) then
    perform private.account_brl_only(new.household_id, new.account_id);
  end if;

  -- Decisão 8: transferência não pode ser anterior à abertura de NENHUMA das contas.
  if new.type = 'transfer' then
    if v_have_src and new.date < v_src.opening_date then
      raise exception 'transferência anterior à abertura da conta de origem (%)', v_src.opening_date
        using errcode = '23514';
    end if;
    if v_have_dst and new.date < v_dst.opening_date then
      raise exception 'transferência anterior à abertura da conta de destino (%)', v_dst.opening_date
        using errcode = '23514';
    end if;
  end if;

  -- active só controla NOVAS movimentações: inserir, restaurar da lixeira ou
  -- trocar a conta. Editar lançamento existente em conta desativada é permitido.
  if tg_op = 'INSERT' or v_restoring or v_src_changed then
    if v_have_src and not v_src.active then
      raise exception 'conta de origem desativada' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'INSERT' or v_restoring or v_dst_changed then
    if v_have_dst and not v_dst.active then
      raise exception 'conta de destino desativada' using errcode = '23514';
    end if;
  end if;

  return new;
end $$;

-- recurrences_money_guard (create or replace da 055): receita e despesa em qualquer moeda; transferência só na mesma
-- moeda. Recorrente de cartão não tem conta.
create or replace function private.recurrences_money_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.amount <> round(new.amount, 2) then
    raise exception 'valor com mais de 2 casas decimais: %', new.amount using errcode = '22003';
  end if;
  new.amount := round(new.amount, 2);
  if new.kind = 'transfer' then
    perform private.transfer_same_currency(new.household_id, new.account_id, new.destination_account_id);
  end if;
  return new;
end $$;

revoke execute on function private.transactions_guard(), private.recurrences_money_guard() from public, anon, authenticated;

-- investment_distribution_record (create da 035): igual, mais a conta do provento só em BRL (antes a 055 recusava
-- qualquer lançamento em conta não-BRL; agora receita é aceita, então a recusa do provento fica explícita aqui).
create or replace function public.investment_distribution_record(
  p_asset uuid, p_kind text, p_date date, p_amount numeric, p_account uuid,
  p_status text default 'paid', p_notes text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_asset public.investment_assets%rowtype;
  v_category uuid;
  v_tx uuid;
  v_label text;
begin
  if auth.uid() is null then raise exception 'não autenticado' using errcode = '42501'; end if;
  select * into v_asset from public.investment_assets where id = p_asset for share;
  if not found or not private.is_member(v_asset.household_id) then
    raise exception 'ativo não encontrado' using errcode = '42501';
  end if;
  if not v_asset.active then raise exception 'ativo arquivado' using errcode = '55000'; end if;
  if v_asset.currency_code <> 'BRL' then
    raise exception 'provento em conta só para ativos em BRL nesta fase (as contas ainda são só em reais)' using errcode = '22023';
  end if;
  if p_kind not in ('dividend', 'jcp', 'income') or p_status not in ('paid', 'planned')
     or p_date is null or p_date < date '2000-01-01' or p_date > date '2100-01-01'
     or p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) or abs(p_amount) >= 1e12
     or (p_notes is not null and char_length(p_notes) > 500) then
    raise exception 'dados do provento inválidos' using errcode = '22023';
  end if;
  if p_status = 'paid' and p_date > private.today_sp() then
    raise exception 'provento pago não pode ter data futura: use planejado' using errcode = '22023';
  end if;
  if p_account is null or not exists (
       select 1 from public.accounts a where a.id = p_account and a.household_id = v_asset.household_id and a.active) then
    raise exception 'conta não encontrada' using errcode = '42501';
  end if;
  -- Multimoeda F2 (056): provento só em conta BRL.
  perform private.account_brl_only(v_asset.household_id, p_account);

  select c.id into v_category from public.categories c
   where c.household_id = v_asset.household_id and c.type = 'income' and c.active
     and c.parent_id is null and c.system_key is null and lower(btrim(c.name)) = 'rendimentos'
   limit 1;
  if v_category is null then
    select c.id into v_category from public.categories c
     where c.household_id = v_asset.household_id and c.type = 'income' and c.system_key = 'uncategorized';
  end if;

  v_label := case p_kind when 'dividend' then 'Dividendos' when 'jcp' then 'JCP' else 'Rendimentos' end;
  insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status, notes)
  values (v_asset.household_id, p_account, v_category, 'income', left(v_label || ' · ' || v_asset.name, 200),
          p_amount, p_date, p_status, p_notes)
  returning id into v_tx;

  insert into public.investment_distributions (household_id, asset_id, transaction_id, kind)
  values (v_asset.household_id, v_asset.id, v_tx, p_kind);
  return v_tx;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Relatórios em reais: só lançamentos de contas BRL
-- ---------------------------------------------------------------------------
-- Filtro repetido em cada função (o mesmo texto): o lançamento entra só se a conta dele é BRL.
--   and exists (select 1 from public.accounts ac where ac.household_id = t.household_id and ac.id = t.account_id
--                 and ac.currency_code = 'BRL')
-- Eventos de dívida, faturas e agenda de empréstimo não precisam do filtro: só usam conta BRL (item 1).

-- (create or replace da 046)
create or replace function private.expense_items(p_household uuid, p_from date, p_to date)
returns table (day date, category_id uuid, amount numeric)
language sql stable security invoker set search_path = '' as $$
  select t.date, t.category_id, t.amount
    from public.transactions t
   where t.household_id = p_household and t.type = 'expense' and t.status = 'paid'
     and t.deleted_at is null and t.date between p_from and p_to
     and exists (select 1 from public.accounts ac where ac.household_id = t.household_id and ac.id = t.account_id
                   and ac.currency_code = 'BRL')
  union all
  select e.date, coalesce(e.category_id, i.category_id),
         case when e.kind = 'credit' then -e.amount else e.amount end
    from public.debt_events e
    left join public.debt_installments i on i.household_id = e.household_id and i.id = e.installment_id
   where e.household_id = p_household and e.voided_at is null
     and e.kind in ('charge', 'credit', 'interest', 'fee') and e.date between p_from and p_to
  union all
  -- principal pago de empréstimo/financiamento (migration 046): despesa do mês, na categoria da dívida
  select l.day, l.category_id, l.amount from private.loan_principal_items(p_household, p_from, p_to) l
$$;

-- (create or replace da 052)
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
         and exists (select 1 from public.accounts ac where ac.household_id = t.household_id and ac.id = t.account_id
                       and ac.currency_code = 'BRL')
    ) s
   where (select private.is_member(p_household))
$$;

-- (create or replace da 052)
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
       and exists (select 1 from public.accounts ac where ac.household_id = t.household_id and ac.id = t.account_id
                     and ac.currency_code = 'BRL')
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

-- (create or replace da 046) Orçamento: só BRL.
create or replace function public.budget_usage(p_household uuid, p_month date)
returns table (category_id uuid, category_name text, amount_limit numeric,
               spent numeric, remaining numeric, percent numeric)
language sql stable security invoker set search_path = '' as $$
  select b.category_id, c.name, b.amount_limit,
         coalesce(s.spent, 0),
         b.amount_limit - coalesce(s.spent, 0),
         round(100 * coalesce(s.spent, 0) / b.amount_limit, 1)
    from public.budgets b
    join public.categories c on c.household_id = b.household_id and c.id = b.category_id
    left join lateral (
      select sum(x.amt) as spent
        from (
          select t.amount as amt, t.category_id as cat
            from public.transactions t
           where t.household_id = b.household_id and t.type = 'expense' and t.status = 'paid'
             and t.deleted_at is null
             and t.date >= b.month and t.date < (b.month + interval '1 month')::date
             and exists (select 1 from public.accounts ac where ac.household_id = t.household_id and ac.id = t.account_id
                           and ac.currency_code = 'BRL')
          union all
          select case when e.kind = 'credit' then -e.amount else e.amount end,
                 coalesce(e.category_id, i.category_id)
            from public.debt_events e
            left join public.debt_installments i
              on i.household_id = e.household_id and i.id = e.installment_id
           where e.household_id = b.household_id and e.voided_at is null
             and e.kind in ('charge', 'credit', 'interest', 'fee')
             and e.date >= b.month and e.date < (b.month + interval '1 month')::date
          union all
          select l.amount, l.category_id
            from private.loan_principal_items(b.household_id, b.month, ((b.month + interval '1 month')::date - 1)) l
        ) x
        join public.categories tc on tc.household_id = b.household_id and tc.id = x.cat
       where tc.id = b.category_id or tc.parent_id = b.category_id
    ) s on true
   where b.household_id = p_household
     and b.month = date_trunc('month', p_month::timestamp)::date
     and (select private.is_member(p_household))
   order by c.name
$$;

-- (create or replace da 052) Os gastos vêm de expense_items (já filtrado); a renda ganha o filtro.
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
                        and t.deleted_at is null and t.date between p_from and p_to
                        and exists (select 1 from public.accounts ac where ac.household_id = t.household_id
                                      and ac.id = t.account_id and ac.currency_code = 'BRL')), 0)
           + coalesce((select sum(ci.amount) from private.card_income_items(p_household, p_from, p_to) ci where ci.paid), 0) as total
  )
  select g.grp, g.total,
         case when sum(g.total) over () = 0 then 0 else round(100 * g.total / sum(g.total) over (), 1) end,
         case when r.total = 0 then null else round(100 * g.total / r.total, 1) end
    from por_grupo g cross join renda r
   where (select private.is_member(p_household))
   order by array_position(array['essential', 'lifestyle', 'investment', 'none'], g.grp)
$$;

-- (create or replace da 041) O gasto vem de budget_usage (já filtrado); planejado e ritmo ganham o filtro.
create or replace function public.budget_projection(p_household uuid, p_month date, p_today date)
returns table (category_id uuid, category_name text, amount_limit numeric, spent numeric, planned numeric,
               pace_extra numeric, projected numeric, remaining numeric)
language sql stable security invoker set search_path = '' as $$
  with m as (
    select date_trunc('month', p_month::timestamp)::date as first_day,
           (date_trunc('month', p_month::timestamp) + interval '1 month - 1 day')::date as last_day
  ), d as (
    select m.first_day, m.last_day, (m.last_day - m.first_day + 1) as n,
           greatest(0, least(p_today, m.last_day) - m.first_day + 1) as elapsed
      from m
  )
  select u.category_id, u.category_name, u.amount_limit, u.spent,
         pl.planned, pc.pace_extra,
         u.spent + pl.planned + pc.pace_extra,
         u.amount_limit - (u.spent + pl.planned + pc.pace_extra)
    from d
   cross join lateral public.budget_usage(p_household, d.first_day) u
   cross join lateral (
     select coalesce((select sum(t.amount) from public.transactions t
                        join public.categories tc on tc.household_id = t.household_id and tc.id = t.category_id
                       where t.household_id = p_household and t.type = 'expense' and t.status = 'planned'
                         and t.deleted_at is null and t.date between d.first_day and d.last_day
                         and (tc.id = u.category_id or tc.parent_id = u.category_id)
                         and exists (select 1 from public.accounts ac where ac.household_id = t.household_id
                                       and ac.id = t.account_id and ac.currency_code = 'BRL')), 0)
          + coalesce((select sum(i.face - coalesce((select sum(e.amount) from public.debt_events e
                                                      where e.installment_id = i.id and e.kind in ('charge', 'cancel')
                                                        and e.voided_at is null), 0))
                        from public.debt_installments i
                        join public.categories ic on ic.household_id = i.household_id and ic.id = i.category_id
                       where i.household_id = p_household and i.due_date between d.first_day and d.last_day
                         and (ic.id = u.category_id or ic.parent_id = u.category_id)), 0)
          + coalesce((select sum(x.amount) from private.card_recurrence_pending(p_household, d.first_day, d.last_day) x
                        join public.categories xc on xc.household_id = p_household and xc.id = x.category_id
                       where (xc.id = u.category_id or xc.parent_id = u.category_id)), 0) as planned
   ) pl
   cross join lateral (
     select case when d.elapsed >= 7
                 then round(coalesce((select sum(t.amount) from public.transactions t
                                        join public.categories tc on tc.household_id = t.household_id and tc.id = t.category_id
                                       where t.household_id = p_household and t.type = 'expense' and t.status = 'paid'
                                         and t.deleted_at is null and t.occurrence_date is null
                                         and t.date between d.first_day and least(p_today, d.last_day)
                                         and (tc.id = u.category_id or tc.parent_id = u.category_id)
                                         and exists (select 1 from public.accounts ac where ac.household_id = t.household_id
                                                       and ac.id = t.account_id and ac.currency_code = 'BRL')), 0)
                            / d.elapsed * (d.n - d.elapsed), 2)
                 else 0 end as pace_extra
   ) pc
   where (select private.is_member(p_household))
   order by u.category_name
$$;

-- (create or replace da 052) A despesa vem de period_summary (já filtrado); as receitas ganham o filtro.
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
             and exists (select 1 from public.accounts ac where ac.household_id = t.household_id and ac.id = t.account_id
                           and ac.currency_code = 'BRL')
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

-- (create or replace da 041) Gasto e planejado vêm de period_summary (já filtrado); o gasto variável ganha o filtro.
create or replace function public.month_projection(p_household uuid, p_month date, p_today date)
returns table (days_in_month integer, days_elapsed integer, days_left integer,
               spent numeric, planned numeric, variable_so_far numeric, pace_per_day numeric,
               pace_extra numeric, projected numeric)
language sql stable security invoker set search_path = '' as $$
  with m as (
    select date_trunc('month', p_month::timestamp)::date as first_day,
           (date_trunc('month', p_month::timestamp) + interval '1 month - 1 day')::date as last_day
  ), d as (
    select m.first_day, m.last_day,
           (m.last_day - m.first_day + 1) as n,
           greatest(0, least(p_today, m.last_day) - m.first_day + 1) as elapsed
      from m
  ), v as (
    select d.*, coalesce((select sum(t.amount) from public.transactions t
                           where t.household_id = p_household and t.type = 'expense' and t.status = 'paid'
                             and t.deleted_at is null and t.occurrence_date is null
                             and t.date between d.first_day and least(p_today, d.last_day)
                             and exists (select 1 from public.accounts ac where ac.household_id = t.household_id
                                           and ac.id = t.account_id and ac.currency_code = 'BRL')), 0) as variable_paid,
           coalesce((select sum(x.amount) from private.card_recurrence_pending(p_household, d.first_day, d.last_day) x), 0) as card_rec
      from d
  ), s as (
    select v.*, ps.expense_paid, ps.expense_planned + v.card_rec as planned_total,
           -- ritmo só depois de 7 dias do mês
           case when v.elapsed >= 7 then round(v.variable_paid / v.elapsed * (v.n - v.elapsed), 2) else 0 end as extra
      from v cross join lateral public.period_summary(p_household, v.first_day, v.last_day) ps
  )
  select s.n::integer, s.elapsed::integer, (s.n - s.elapsed)::integer,
         s.expense_paid, s.planned_total, s.variable_paid,
         case when s.elapsed > 0 then round(s.variable_paid / s.elapsed, 2) else 0 end,
         s.extra,
         s.expense_paid + s.planned_total + s.extra
    from s
   where (select private.is_member(p_household))
$$;

-- (create da 049) Os planejados vencidos e de hoje só de contas BRL: o aviso fala em reais. O saldo previsto já vem
-- de balance_totals_projected, só BRL desde a 055.
-- atalho: planejado em conta estrangeira não entra no aviso diário; entra quando o aviso tiver bloco por moeda (F3+).
create or replace function public.daily_digest(p_household uuid, p_date date)
returns table (
  overdue_count     integer,  -- planejados que passaram da data (lançamentos e parcelas de dívida)
  overdue_expense   numeric,  -- quanto deles é saída
  today_count       integer,  -- planejados com data de hoje
  today_expense     numeric,
  invoices_count    integer,  -- faturas de cartão a pagar que vencem de hoje a hoje + 3
  invoices_due      numeric,
  next_invoice_date date,
  month_end         date,
  projected_balance numeric   -- saldo previsto no fim do mês (balance_totals_projected, o mesmo do Início)
)
language sql stable security invoker set search_path = '' as $$
  with lanc as (
    select t.date, t.type, t.amount
      from public.transactions t
     where t.household_id = p_household and t.status = 'planned' and t.deleted_at is null and t.date <= p_date
       and exists (select 1 from public.accounts ac where ac.household_id = t.household_id and ac.id = t.account_id
                     and ac.currency_code = 'BRL')
  ), parc as (
    select s.due_date as date, s.amount
      from public.debt_payment_schedule s
      join public.debts d on d.household_id = s.household_id and d.id = s.debt_id and d.active
     where s.household_id = p_household and s.status = 'planned' and s.due_date <= p_date
  ), fat as (
    select f.due_date, f.remaining
      from public.card_invoices_due(p_household, p_date, p_date + 3) f
     where f.remaining > 0
  ), fim as (
    select (date_trunc('month', p_date) + interval '1 month - 1 day')::date as d
  )
  select
    ((select count(*) from lanc where date < p_date) + (select count(*) from parc where date < p_date))::int,
    coalesce((select sum(amount) from lanc where date < p_date and type = 'expense'), 0)
      + coalesce((select sum(amount) from parc where date < p_date), 0),
    ((select count(*) from lanc where date = p_date) + (select count(*) from parc where date = p_date))::int,
    coalesce((select sum(amount) from lanc where date = p_date and type = 'expense'), 0)
      + coalesce((select sum(amount) from parc where date = p_date), 0),
    (select count(*) from fat)::int,
    coalesce((select sum(remaining) from fat), 0),
    (select min(due_date) from fat),
    (select d from fim),
    (select b.total from public.balance_totals_projected(p_household, (select d from fim), true) b)
   where (select private.is_member(p_household))
$$;

-- ---------------------------------------------------------------------------
-- 3. Resultado do período por moeda (sem conversão), só as moedas que não são BRL
-- ---------------------------------------------------------------------------
-- Mesma regra do period_summary para o realizado: lançamento pago, fora da lixeira, receita ou despesa.
-- Transferência não entra (como no period_summary). O BRL é o period_summary.
create function public.period_summary_by_currency(p_household uuid, p_from date, p_to date)
returns table (currency_code text, income numeric, expense numeric, result numeric)
language sql stable security invoker set search_path = '' as $$
  select ac.currency_code,
         coalesce(sum(t.amount) filter (where t.type = 'income'), 0),
         coalesce(sum(t.amount) filter (where t.type = 'expense'), 0),
         coalesce(sum(t.amount) filter (where t.type = 'income'), 0)
           - coalesce(sum(t.amount) filter (where t.type = 'expense'), 0)
    from public.transactions t
    join public.accounts ac on ac.household_id = t.household_id and ac.id = t.account_id
   where t.household_id = p_household
     and t.deleted_at is null and t.status = 'paid'
     and t.type in ('income', 'expense')
     and t.date between p_from and p_to
     and ac.currency_code <> 'BRL'
     and (select private.is_member(p_household))
   group by ac.currency_code
   order by ac.currency_code
$$;
revoke execute on function public.period_summary_by_currency(uuid, date, date) from public, anon;
grant execute on function public.period_summary_by_currency(uuid, date, date) to authenticated;
