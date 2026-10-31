-- 13_reconciliation: o fluxo ativo foi descontinuado; marcas e checkpoints antigos permanecem como histórico.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create temp table fixture (k text primary key, v uuid);
grant all on fixture to public;
create function pg_temp.fx(p_k text) returns uuid language sql as $f$ select v from fixture where k = p_k $f$;
create function pg_temp.login(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $f$;
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
create function pg_temp.saldo(p_acc uuid, p_d date) returns numeric language sql as $f$
  select balance from public.account_balances(pg_temp.fx('h'), p_d) where account_id = p_acc $f$;
create function pg_temp.soma_mov(p_acc uuid, p_d date) returns numeric language sql as $f$
  select sum(amount) from public.account_movements(p_acc, p_d) $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.sqlstate_of(text),
  pg_temp.saldo(uuid, date), pg_temp.soma_mov(uuid, date) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000013a1', 'cc1@teste.com'),
  ('00000000-0000-0000-0000-0000000013a2', 'cc2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000013a1');
insert into fixture select 'h', public.create_household('Casa com histórico legado');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Itaú', 'checking', 1000.00, '2026-10-01') returning id)
  insert into fixture select 'itau', id from i;
insert into fixture select 'cexp', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';
with i as (insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status)
           values (pg_temp.fx('h'), pg_temp.fx('itau'), pg_temp.fx('cexp'), 'expense', 'Mercado', 250.00, '2026-10-05', 'paid') returning id)
  insert into fixture select 'mercado', id from i;
insert into fixture select 'loan', public.create_debt('Empréstimo', 'loan', '2026-10-01', 100.00);

-- Preparar somente como fixture um registro que existia antes da retirada dos RPCs.
-- Em execução normal o cliente só pode ler esta tabela; não pode criar nem alterar histórico.
reset role;
with r as (
  insert into public.account_reconciliations (household_id, account_id, as_of, statement_balance, transactions, created_by)
  values (pg_temp.fx('h'), pg_temp.fx('itau'), '2026-10-08', 750.00, 1, null)
  returning id
)
update public.transactions set reconciliation_id = (select id from r) where id = pg_temp.fx('mercado');
select pg_temp.login('00000000-0000-0000-0000-0000000013a1');

-- A API de gravação/desfazer e as três travas de período deixaram de existir.
select is(to_regprocedure('public.reconcile_account(uuid,date,numeric)')::text, null::text,
          'CC1 RPC de nova conferência removida');
select is(to_regprocedure('public.reconciliation_undo(uuid)')::text, null::text,
          'CC1 RPC de desfazer conferência removida');
select is((select count(*) from pg_trigger where not tgisinternal
            and tgname in ('transactions_period_guard','debt_events_period_guard','accounts_period_guard')), 0::bigint,
          'CC1 triggers de trava de período removidos');
select is(to_regprocedure('private.reconciled_until(uuid)')::text, null::text,
          'CC1 helper de período removido');

-- Os dados e a consulta de movimentos continuam para leitura/exportação.
select is((select count(*) from public.account_reconciliations where account_id = pg_temp.fx('itau')), 1::bigint,
          'CC2 checkpoint histórico preservado');
select is((select statement_balance from public.account_reconciliations where account_id = pg_temp.fx('itau')),
          750.00::numeric, 'CC2 saldo de extrato histórico não foi reescrito');
select is((select reconciliation_id is not null from public.transactions where id = pg_temp.fx('mercado')), true,
          'CC2 marca histórica do lançamento preservada');
select is((select array_agg(source || '|' || reconciled::text order by date, source)
             from public.account_movements(pg_temp.fx('itau'), '2026-10-08')),
          array['opening|true', 'transaction|true'], 'CC2 account_movements continua expondo a marca histórica para exportação');
select is(pg_temp.soma_mov(pg_temp.fx('itau'), '2026-10-08'), pg_temp.saldo(pg_temp.fx('itau'), '2026-10-08'),
          'CC2 soma exportável continua igual ao saldo oficial');
select is(pg_temp.sqlstate_of($$insert into public.account_reconciliations (household_id, account_id, as_of, statement_balance)
          values (pg_temp.fx('h'), pg_temp.fx('itau'), '2026-10-09', 750.00)$$), '42501',
          'CC2 cliente autenticado não pode criar novo histórico diretamente');

-- Os períodos antigos voltam a aceitar correções normais, sem remover o checkpoint histórico.
select lives_ok($$update public.transactions set amount = 260.00 where id = pg_temp.fx('mercado')$$,
          'CC3 lançamento dentro do período histórico pode ser corrigido');
select lives_ok($$update public.accounts set initial_balance = 1100.00 where id = pg_temp.fx('itau')$$,
          'CC3 saldo inicial pode ser corrigido');
select lives_ok($$update public.accounts set opening_date = '2026-10-02' where id = pg_temp.fx('itau')$$,
          'CC3 data de abertura pode ser corrigida se respeitar os movimentos existentes');
select is(pg_temp.sqlstate_of($$select public.debt_pay(pg_temp.fx('loan'), '2026-10-08', pg_temp.fx('itau'), 10.00)$$), null,
          'CC3 evento de dívida na data coberta pelo histórico pode ser registrado');
select is((select count(*) from public.account_reconciliations where account_id = pg_temp.fx('itau')), 1::bigint,
          'CC3 corrigir saldo não apaga o checkpoint histórico');
select is(pg_temp.soma_mov(pg_temp.fx('itau'), '2026-10-08'), pg_temp.saldo(pg_temp.fx('itau'), '2026-10-08'),
          'CC3 movimentos seguem reconstruindo o saldo após as correções');
select ok((select reconciled from public.account_movements(pg_temp.fx('itau'), '2026-10-08') where source = 'debt'),
          'CC3 exportação mantém a marca histórica nos eventos de dívida cobertos pela data');

-- Outra família não vê checkpoints, lançamentos ou movimentos da família dona.
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000013a2');
select public.create_household('Outra');
select is((select count(*) from public.account_reconciliations), 0::bigint, 'CC4 outra família não lê histórico');
select is((select count(*) from public.transactions), 0::bigint, 'CC4 outra família não lê lançamentos');
select is((select count(*) from public.account_movements(pg_temp.fx('itau'), '2026-10-31')), 0::bigint,
          'CC4 outra família não lê movimentos exportáveis');
select is(pg_temp.sqlstate_of($$select public.debt_pay(pg_temp.fx('loan'), '2026-10-08', pg_temp.fx('itau'), 1.00)$$), '42501',
          'CC4 outra família não grava evento na conta alheia');

select * from finish();
rollback;
