-- Tudo Azul — migration 007: conciliação de contas (conferir com o extrato do banco)
--
-- Objetivo: tornar verificável o critério 1 do corte do Organizze ("saldos batendo com o extrato por
-- 2 semanas"). Inspirado na conciliação do Actual Budget (docs/PESQUISA-IDEIAS.md).
--
-- Como funciona:
--   1. O usuário escolhe a conta, a data do extrato e o saldo que o banco mostra nessa data.
--   2. A tela lista o saldo inicial e os movimentos pagos até a data (lançamentos e pagamentos de
--      fatura/dívida), o saldo do app na data (account_balances) e a diferença. Tudo vem daqui.
--   3. Quando a diferença é zero, reconcile_account grava a conciliação e marca como CONFERIDOS os
--      lançamentos pagos até a data. Diferença diferente de zero é recusada (23514).
--   4. PERÍODO TRAVADO (revisão de 24/10/2026): até a data da última conciliação da conta, nada que
--      mude o saldo é aceito — lançamento pago novo, editado, pago/desfeito, na lixeira ou restaurado;
--      evento de dívida novo ou anulado (pagamento de fatura, empréstimo); saldo inicial ou abertura da
--      conta. O caminho para corrigir é explícito: reconciliation_undo desfaz a última conciliação
--      (destrava até a anterior e tira a marca dos lançamentos que ela marcou).
--
-- Nenhuma regra de saldo muda: conciliar é marca + histórico + trava.
-- Códigos de erro: 22023 parâmetro; 22003 casas decimais; 23514 diferença ≠ 0; 42501 permissão;
-- 55000 período conciliado.

-- ---------------------------------------------------------------------------
-- 1. Histórico de conciliações e marca de conferido
-- ---------------------------------------------------------------------------
create table public.account_reconciliations (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references public.households (id) on delete cascade,
  account_id        uuid not null,
  as_of             date not null check (as_of between date '2000-01-01' and date '2100-01-01'),
  statement_balance numeric not null check (statement_balance = round(statement_balance, 2) and abs(statement_balance) < 1e12),
  transactions      integer not null default 0,
  created_by        uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  unique (household_id, account_id, as_of),
  constraint account_reconciliations_account_fk foreign key (household_id, account_id)
    references public.accounts (household_id, id) on delete cascade deferrable initially immediate
);

grant select on public.account_reconciliations to authenticated;
alter table public.account_reconciliations enable row level security;
create policy account_reconciliations_select on public.account_reconciliations for select to authenticated
  using ((select private.is_member(household_id)));

-- qual conciliação marcou o lançamento (o cliente não tem grant: só as RPCs mudam)
alter table public.transactions
  add column reconciliation_id uuid references public.account_reconciliations (id) on delete set null;

-- ---------------------------------------------------------------------------
-- 2. Trava do período conciliado
-- ---------------------------------------------------------------------------
-- Data da última conciliação da conta (null = nunca conciliada).
create function private.reconciled_until(p_account uuid) returns date
language sql stable security definer set search_path = '' as $$
  select max(as_of) from public.account_reconciliations
   where account_id = p_account and (select private.is_member(household_id))
$$;

-- Lançamento: compara o "efeito no saldo" antes e depois; se mudou e toca o período travado de
-- alguma conta envolvida (origem ou destino, antes ou depois), recusa.
create function private.transactions_period_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_old_ok boolean := tg_op = 'UPDATE' and old.status = 'paid' and old.deleted_at is null;
  v_new_ok boolean := new.status = 'paid' and new.deleted_at is null;
  v_acc uuid; v_date date; v_until date;
begin
  if tg_op = 'UPDATE' and v_old_ok = v_new_ok
     and (not v_new_ok or (new.amount, new.date, new.account_id, new.destination_account_id, new.type)
                          is not distinct from (old.amount, old.date, old.account_id, old.destination_account_id, old.type)) then
    return new;  -- nada que mexa em saldo (descrição, categoria, notas, planejado editado...)
  end if;
  for v_acc, v_date in
    select x.a, x.d from (values (case when v_new_ok then new.account_id end, new.date),
                                 (case when v_new_ok then new.destination_account_id end, new.date),
                                 (case when v_old_ok then old.account_id end, old.date),
                                 (case when v_old_ok then old.destination_account_id end, old.date)) as x(a, d)
     where x.a is not null
  loop
    v_until := private.reconciled_until(v_acc);
    if v_until is not null and v_date <= v_until then
      raise exception 'a conta já foi conciliada até % : lançamento pago nesse período não pode ser criado, alterado nem excluído. Desfaça a conciliação para corrigir', v_until
        using errcode = '55000';
    end if;
  end loop;
  return new;
end $$;
create trigger transactions_period_guard before insert or update on public.transactions
  for each row execute function private.transactions_period_guard();

-- Evento de dívida com conta (pagamento de fatura, empréstimo, juros...): novo ou anulado no período.
create function private.debt_events_period_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare v_until date;
begin
  if new.account_id is null then return new; end if;
  if tg_op = 'UPDATE' and (old.voided_at is not distinct from new.voided_at) then return new; end if;
  v_until := private.reconciled_until(new.account_id);
  if v_until is not null and new.date <= v_until then
    raise exception 'a conta já foi conciliada até % : movimento de cartão/dívida nesse período não pode ser lançado nem anulado. Desfaça a conciliação para corrigir', v_until
      using errcode = '55000';
  end if;
  return new;
end $$;
create trigger debt_events_period_guard before insert or update on public.debt_events
  for each row execute function private.debt_events_period_guard();

-- Conta conciliada: saldo inicial e abertura ficam fixos.
create function private.accounts_period_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if (new.initial_balance, new.opening_date) is distinct from (old.initial_balance, old.opening_date)
     and private.reconciled_until(new.id) is not null then
    raise exception 'conta já conciliada: o saldo inicial e a data de abertura não mudam. Desfaça as conciliações para corrigir'
      using errcode = '55000';
  end if;
  return new;
end $$;
create trigger accounts_period_guard before update on public.accounts
  for each row execute function private.accounts_period_guard();

revoke execute on function private.reconciled_until(uuid), private.transactions_period_guard(),
  private.debt_events_period_guard(), private.accounts_period_guard()
  from public, anon, authenticated;
-- os triggers rodam como o chamador e consultam a trava (só da própria família, pelo is_member)
grant execute on function private.reconciled_until(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Relatório: saldo inicial e movimentos da conta até a data (SECURITY INVOKER, a RLS decide)
--    amount já com sinal do ponto de vista da conta (+ entra, − sai). Saldo inicial + soma dos
--    movimentos = account_balances(p_to) (testado em pgTAP).
-- ---------------------------------------------------------------------------
create function public.account_movements(p_account uuid, p_to date)
returns table (source text, id uuid, date date, description text, amount numeric, reconciled boolean)
language sql stable security invoker set search_path = '' as $$
  with a as (
    select acc.id, acc.household_id, acc.opening_date, acc.initial_balance,
           (select max(r.as_of) from public.account_reconciliations r
             where r.household_id = acc.household_id and r.account_id = acc.id) as ate
      from public.accounts acc where acc.id = p_account and acc.opening_date <= p_to
  )
  select 'opening', a.id, a.opening_date, 'Saldo inicial', a.initial_balance, a.ate is not null
    from a
  union all
  select 'transaction', t.id, t.date, t.description,
         case when t.type = 'income' then t.amount
              when t.type = 'expense' then -t.amount
              when t.account_id = p_account then -t.amount   -- transferência saindo
              else t.amount end,                              -- transferência entrando
         t.reconciliation_id is not null
    from public.transactions t join a on a.household_id = t.household_id
   where (t.account_id = p_account or t.destination_account_id = p_account)
     and t.deleted_at is null and t.status = 'paid'
     and t.date >= a.opening_date and t.date <= p_to
  union all
  select 'debt', e.id, e.date,
         case e.kind when 'payment' then 'Pagamento de ' || d.name
                     when 'extra_principal' then 'Amortização de ' || d.name
                     when 'disbursement' then 'Crédito de ' || d.name
                     when 'refund_cash' then 'Devolução de ' || d.name
                     when 'interest' then 'Juros de ' || d.name
                     else 'Tarifa de ' || d.name end,
         case when e.kind in ('disbursement', 'refund_cash') then e.amount else -e.amount end,
         a.ate is not null and e.date <= a.ate   -- período travado: dentro dele, é o que foi conferido
    from public.debt_events e
    join a on a.household_id = e.household_id
    join public.debts d on d.household_id = e.household_id and d.id = e.debt_id
   where e.account_id = p_account and e.voided_at is null
     and e.date >= a.opening_date and e.date <= p_to
   order by 3 desc, 1
$$;
revoke execute on function public.account_movements(uuid, date) from public, anon;
grant execute on function public.account_movements(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Operações (RPC)
-- ---------------------------------------------------------------------------
-- Concilia: exige saldo do app na data = saldo do extrato. Marca os lançamentos pagos até a data.
create function public.reconcile_account(p_account uuid, p_as_of date, p_statement_balance numeric)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_h uuid := private.current_household(); v_acc public.accounts%rowtype;
  v_app numeric; v_n integer; v_id uuid; v_until date;
begin
  if (select auth.uid()) is null or v_h is null then
    raise exception 'não autenticado ou sem família' using errcode = '42501';
  end if;
  select * into v_acc from public.accounts where household_id = v_h and id = p_account for update;
  if not found then raise exception 'registro não encontrado' using errcode = '42501'; end if;
  if p_as_of is null or p_statement_balance is null or p_as_of < v_acc.opening_date then
    raise exception 'informe uma data a partir da abertura da conta (%) e o saldo do extrato', v_acc.opening_date
      using errcode = '22023';
  end if;
  if p_as_of > private.today_sp() then
    raise exception 'a data do extrato não pode ser futura' using errcode = '22023';
  end if;
  v_until := private.reconciled_until(p_account);
  if v_until is not null and p_as_of <= v_until then
    raise exception 'a conta já foi conciliada até %: escolha uma data posterior', v_until using errcode = '22023';
  end if;
  if p_statement_balance <> round(p_statement_balance, 2) then
    raise exception 'valor com mais de 2 casas decimais: %', p_statement_balance using errcode = '22003';
  end if;
  select b.balance into v_app from public.account_balances(v_h, p_as_of) b where b.account_id = p_account;
  if v_app is distinct from p_statement_balance then
    raise exception 'o saldo do app em % é % e o do extrato é %: diferença de %',
      p_as_of, coalesce(v_app, 0), p_statement_balance, p_statement_balance - coalesce(v_app, 0)
      using errcode = '23514';
  end if;
  insert into public.account_reconciliations (household_id, account_id, as_of, statement_balance)
  values (v_h, p_account, p_as_of, p_statement_balance) returning id into v_id;
  -- marca antes de... a trava só considera a conciliação depois deste insert, mas a marca não muda saldo
  update public.transactions t set reconciliation_id = v_id
   where t.household_id = v_h and (t.account_id = p_account or t.destination_account_id = p_account)
     and t.deleted_at is null and t.status = 'paid' and t.reconciliation_id is null
     and t.date >= v_acc.opening_date and t.date <= p_as_of;
  get diagnostics v_n = row_count;
  update public.account_reconciliations set transactions = v_n where id = v_id;
  return v_id;
end $$;

-- Desfaz a ÚLTIMA conciliação da conta: destrava o período até a anterior e tira a marca dos
-- lançamentos que ela marcou. Para corrigir algo antigo, desfaça uma a uma (da mais recente).
create function public.reconciliation_undo(p_account uuid)
returns date language plpgsql security definer set search_path = '' as $$
declare v_h uuid := private.current_household(); v_r public.account_reconciliations%rowtype;
begin
  if (select auth.uid()) is null or v_h is null then
    raise exception 'não autenticado ou sem família' using errcode = '42501';
  end if;
  perform 1 from public.accounts where household_id = v_h and id = p_account for update;
  if not found then raise exception 'registro não encontrado' using errcode = '42501'; end if;
  select * into v_r from public.account_reconciliations
   where household_id = v_h and account_id = p_account order by as_of desc limit 1;
  if not found then raise exception 'esta conta não tem conciliação para desfazer' using errcode = '55000'; end if;
  update public.transactions set reconciliation_id = null where reconciliation_id = v_r.id;
  delete from public.account_reconciliations where id = v_r.id;
  return private.reconciled_until(p_account);  -- nova data travada (null = nenhuma)
end $$;

revoke execute on function public.reconcile_account(uuid, date, numeric), public.reconciliation_undo(uuid)
  from public, anon;
grant execute on function public.reconcile_account(uuid, date, numeric), public.reconciliation_undo(uuid)
  to authenticated;
