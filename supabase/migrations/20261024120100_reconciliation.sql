-- Tudo Azul — migration 007: conciliação de contas (conferir com o extrato do banco)
--
-- Objetivo: tornar verificável o critério 1 do corte do Organizze ("saldos batendo com o extrato por
-- 2 semanas"). Inspirado na conciliação do Actual Budget (docs/PESQUISA-IDEIAS.md).
--
-- Como funciona:
--   1. O usuário escolhe a conta, a data do extrato e o saldo que o banco mostra nessa data.
--   2. A tela lista os movimentos pagos até a data (lançamentos e pagamentos de fatura/dívida) e mostra
--      o saldo do app na data (account_balances) e a diferença. Tudo calculado aqui, não no front.
--   3. Quando a diferença é zero, reconcile_account grava a conciliação e marca como CONFERIDOS os
--      lançamentos pagos da conta até a data. Diferença diferente de zero é recusada (23514).
--   4. Lançamento conferido não muda valor, data, conta, tipo, status nem vai para a lixeira sem antes
--      desfazer a conferência (unreconcile_transaction): protege o saldo já batido com o banco.
--
-- Nenhuma regra de saldo muda: conferir é só uma marca + um registro histórico.
-- Códigos de erro: 22023 parâmetro; 22003 casas decimais; 23514 diferença ≠ 0; 42501 permissão;
-- 55000 lançamento conferido.

-- ---------------------------------------------------------------------------
-- 1. Marca de conferido e histórico de conciliações
-- ---------------------------------------------------------------------------
alter table public.transactions add column reconciled_at timestamptz;
-- o cliente não tem grant em reconciled_at: só as RPCs abaixo mudam a marca

create table public.account_reconciliations (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references public.households (id) on delete cascade,
  account_id        uuid not null,
  as_of             date not null check (as_of between date '2000-01-01' and date '2100-01-01'),
  statement_balance numeric not null check (statement_balance = round(statement_balance, 2) and abs(statement_balance) < 1e12),
  transactions      integer not null default 0,
  created_by        uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  constraint account_reconciliations_account_fk foreign key (household_id, account_id)
    references public.accounts (household_id, id) on delete cascade deferrable initially immediate
);
create index account_reconciliations_account_idx on public.account_reconciliations (household_id, account_id, as_of desc);

grant select on public.account_reconciliations to authenticated;
alter table public.account_reconciliations enable row level security;
create policy account_reconciliations_select on public.account_reconciliations for select to authenticated
  using ((select private.is_member(household_id)));

-- ---------------------------------------------------------------------------
-- 2. Proteção do lançamento conferido
-- ---------------------------------------------------------------------------
create function private.transactions_reconciled_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  -- desfazer a conferência (reconciled_at -> null) é a única mudança permitida junto com outras
  if old.reconciled_at is not null and new.reconciled_at is not null
     and (new.amount, new.date, new.account_id, new.destination_account_id, new.type, new.status, new.deleted_at)
         is distinct from
         (old.amount, old.date, old.account_id, old.destination_account_id, old.type, old.status, old.deleted_at) then
    raise exception 'lançamento conferido com o extrato: desfaça a conferência antes de mudar valor, data, conta, tipo ou situação'
      using errcode = '55000';
  end if;
  return new;
end $$;
create trigger transactions_reconciled_guard before update on public.transactions
  for each row execute function private.transactions_reconciled_guard();
revoke execute on function private.transactions_reconciled_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Relatório: movimentos da conta até a data (SECURITY INVOKER, a RLS decide)
--    amount já com sinal do ponto de vista da conta (+ entra, − sai).
-- ---------------------------------------------------------------------------
create function public.account_movements(p_account uuid, p_to date)
returns table (source text, id uuid, date date, description text, amount numeric, reconciled boolean)
language sql stable security invoker set search_path = '' as $$
  select 'transaction', t.id, t.date, t.description,
         case when t.type = 'income' then t.amount
              when t.type = 'expense' then -t.amount
              when t.account_id = p_account then -t.amount   -- transferência saindo
              else t.amount end,                              -- transferência entrando
         t.reconciled_at is not null
    from public.transactions t
    join public.accounts a on a.household_id = t.household_id and a.id = p_account
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
         true  -- eventos de dívida não têm marca própria: entram como já conferidos
    from public.debt_events e
    join public.debts d on d.household_id = e.household_id and d.id = e.debt_id
    join public.accounts a on a.household_id = e.household_id and a.id = p_account
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
  v_app numeric; v_n integer; v_id uuid;
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
  if p_statement_balance <> round(p_statement_balance, 2) then
    raise exception 'valor com mais de 2 casas decimais: %', p_statement_balance using errcode = '22003';
  end if;
  select b.balance into v_app from public.account_balances(v_h, p_as_of) b where b.account_id = p_account;
  if v_app is distinct from p_statement_balance then
    raise exception 'o saldo do app em % é % e o do extrato é %: diferença de %',
      p_as_of, coalesce(v_app, 0), p_statement_balance, p_statement_balance - coalesce(v_app, 0)
      using errcode = '23514';
  end if;
  update public.transactions t set reconciled_at = now()
   where t.household_id = v_h and (t.account_id = p_account or t.destination_account_id = p_account)
     and t.deleted_at is null and t.status = 'paid' and t.reconciled_at is null
     and t.date >= v_acc.opening_date and t.date <= p_as_of;
  get diagnostics v_n = row_count;
  insert into public.account_reconciliations (household_id, account_id, as_of, statement_balance, transactions)
  values (v_h, p_account, p_as_of, p_statement_balance, v_n) returning id into v_id;
  return v_id;
end $$;

-- Desfaz a conferência de um lançamento (para poder corrigi-lo).
create function public.unreconcile_transaction(p_transaction uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_h uuid := private.current_household();
begin
  if (select auth.uid()) is null or v_h is null then
    raise exception 'não autenticado ou sem família' using errcode = '42501';
  end if;
  update public.transactions set reconciled_at = null
   where id = p_transaction and household_id = v_h;
  if not found then raise exception 'registro não encontrado' using errcode = '42501'; end if;
end $$;

revoke execute on function public.reconcile_account(uuid, date, numeric), public.unreconcile_transaction(uuid)
  from public, anon;
grant execute on function public.reconcile_account(uuid, date, numeric), public.unreconcile_transaction(uuid)
  to authenticated;
