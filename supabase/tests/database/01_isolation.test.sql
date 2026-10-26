-- 01_isolation: isolamento entre famílias, anon, owner x membro, privilégios de coluna.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ---- auxiliares de teste (temporários; somem no rollback) ----
create temp table fixture (k text primary key, v uuid, t text);
grant all on fixture to public;

create function pg_temp.fx(p_k text) returns uuid language sql as $f$ select v from fixture where k = p_k $f$;
create function pg_temp.fxt(p_k text) returns text language sql as $f$ select t from fixture where k = p_k $f$;
create function pg_temp.mkuser(p_id uuid, p_email text, p_name text default null) returns void language sql as $f$
  insert into auth.users (id, email, raw_user_meta_data)
  values (p_id, p_email, case when p_name is null then '{}'::jsonb else jsonb_build_object('name', p_name) end)
$f$;
-- Troca para um papel REAL (authenticated/anon). Sem isso a RLS não é exercitada.
create function pg_temp.login(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $f$;
create function pg_temp.login_anon() returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
end $f$;
-- Executa um comando e devolve o SQLSTATE do erro (ou NULL se não houve erro)
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
create function pg_temp.msg_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate || ' ' || sqlerrm; end $f$;

create function pg_temp.rows_of(p_sql text) returns bigint language plpgsql as $f$
declare n bigint; begin execute p_sql; get diagnostics n = row_count; return n; end $f$;
grant execute on function pg_temp.rows_of(text), pg_temp.fx(text), pg_temp.fxt(text), pg_temp.sqlstate_of(text), pg_temp.msg_of(text) to public;

-- usuários fixos
select pg_temp.mkuser('00000000-0000-0000-0000-0000000000a1', 'u1@teste.com', 'Ana');
select pg_temp.mkuser('00000000-0000-0000-0000-0000000000a2', 'u2@teste.com', 'Bia');
select pg_temp.mkuser('00000000-0000-0000-0000-0000000000a3', 'u3@teste.com', 'Caio');
select pg_temp.mkuser('00000000-0000-0000-0000-0000000000a4', 'u4@teste.com');

-- Cenário: U1 (owner) e U2 (membro) na família H1; U3 (owner) na H2; U4 sem família.

-- ---- fixture montada pelas próprias RPCs, como cada usuário ----
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
insert into fixture select 'h1', public.create_household('Casa 1'), null;
insert into fixture select 'tok2', null, public.create_invitation('u2@teste.com');
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select public.accept_invitation(pg_temp.fxt('tok2'));
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
insert into fixture select 'h2', public.create_household('Casa 2'), null;
reset role;

select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
with i as (insert into public.accounts (household_id, name, type, opening_date)
           values (pg_temp.fx('h1'), 'Conta A1', 'checking', '2026-01-01') returning id)
  insert into fixture select 'a1', id, null from i;
insert into fixture select 'c1', id, null from public.categories
  where household_id = pg_temp.fx('h1') and name = 'Mercado';
insert into fixture select 'inc1', id, null from public.categories
  where household_id = pg_temp.fx('h1') and name = 'Salário';
with i as (insert into public.transactions (household_id, account_id, category_id, type, amount, date, description)
           values (pg_temp.fx('h1'), pg_temp.fx('a1'), pg_temp.fx('c1'), 'expense', 10, '2026-02-01', 'compra H1') returning id)
  insert into fixture select 'tx1', id, null from i;
with i as (insert into public.budgets (household_id, category_id, month, amount_limit)
           values (pg_temp.fx('h1'), pg_temp.fx('c1'), '2026-02-01', 100) returning id)
  insert into fixture select 'b1', id, null from i;
reset role;

select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
with i as (insert into public.accounts (household_id, name, type, opening_date)
           values (pg_temp.fx('h2'), 'Conta A3', 'checking', '2026-01-01') returning id)
  insert into fixture select 'a3', id, null from i;
insert into fixture select 'c3', id, null from public.categories
  where household_id = pg_temp.fx('h2') and name = 'Mercado';
with i as (insert into public.transactions (household_id, account_id, category_id, type, amount, date)
           values (pg_temp.fx('h2'), pg_temp.fx('a3'), pg_temp.fx('c3'), 'expense', 20, '2026-02-01') returning id)
  insert into fixture select 'tx3', id, null from i;
reset role;

-- ---- prova de que os testes rodam com papel de verdade ----
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select is(current_user::text, 'authenticated', 'o teste está rodando como authenticated (a RLS vale)');
select is((select auth.uid())::text, '00000000-0000-0000-0000-0000000000a3', 'auth.uid() é o usuário simulado');

-- ======== U3 (família H2) tentando alcançar a família H1 ========
select is((select count(*) from public.households        where id = pg_temp.fx('h1')), 0::bigint, 'U3 não vê a família H1');
select is((select count(*) from public.household_members where household_id = pg_temp.fx('h1')), 0::bigint, 'U3 não vê membros da H1');
select is((select count(*) from public.accounts          where household_id = pg_temp.fx('h1')), 0::bigint, 'U3 não vê contas da H1');
select is((select count(*) from public.categories        where household_id = pg_temp.fx('h1')), 0::bigint, 'U3 não vê categorias da H1');
select is((select count(*) from public.transactions      where household_id = pg_temp.fx('h1')), 0::bigint, 'U3 não vê lançamentos da H1');
select is((select count(*) from public.budgets           where household_id = pg_temp.fx('h1')), 0::bigint, 'U3 não vê orçamentos da H1');
select is((select count(*) from public.invitations       where household_id = pg_temp.fx('h1')), 0::bigint, 'U3 não vê convites da H1');
select is((select count(*) from public.profiles          where id = '00000000-0000-0000-0000-0000000000a1'), 0::bigint, 'U3 não vê o perfil de U1');
select is((select count(*) from public.accounts), 1::bigint, 'U3 vê exatamente as contas da própria família');

select is(pg_temp.sqlstate_of(format($$insert into public.accounts (household_id, name, type, opening_date) values (%L, 'invasora', 'cash', '2026-01-01')$$, pg_temp.fx('h1'))),
  '42501', 'U3 não insere conta na H1 (RLS)');
select is(pg_temp.sqlstate_of(format($$insert into public.categories (household_id, name, type) values (%L, 'invasora', 'expense')$$, pg_temp.fx('h1'))),
  '42501', 'U3 não insere categoria na H1 (RLS)');
select is(pg_temp.sqlstate_of(format($$insert into public.transactions (household_id, account_id, category_id, type, amount, date) values (%L, %L, %L, 'expense', 1, '2026-02-01')$$, pg_temp.fx('h1'), pg_temp.fx('a1'), pg_temp.fx('c1'))),
  '42501', 'U3 não insere lançamento na H1 (RLS)');
select is(pg_temp.sqlstate_of(format($$insert into public.budgets (household_id, category_id, month, amount_limit) values (%L, %L, '2026-03-01', 5)$$, pg_temp.fx('h1'), pg_temp.fx('c1'))),
  '42501', 'U3 não insere orçamento na H1 (RLS)');

select is(pg_temp.rows_of($q$update public.accounts set name = 'hackeada' where id = pg_temp.fx('a1')$q$), 0::bigint, 'U3 não atualiza conta da H1');
select is(pg_temp.rows_of($q$update public.categories set name = 'hackeada' where id = pg_temp.fx('c1')$q$), 0::bigint, 'U3 não atualiza categoria da H1');
select is(pg_temp.rows_of($q$update public.transactions set description = 'hackeado' where id = pg_temp.fx('tx1')$q$), 0::bigint, 'U3 não atualiza lançamento da H1');
select is(pg_temp.rows_of($q$update public.transactions set deleted_at = now() where id = pg_temp.fx('tx1')$q$), 0::bigint, 'U3 não manda lançamento da H1 para a lixeira');
select is(pg_temp.rows_of($q$update public.budgets set amount_limit = 1 where id = pg_temp.fx('b1')$q$), 0::bigint, 'U3 não atualiza orçamento da H1');
select is(pg_temp.rows_of($q$update public.households set name = 'hackeada' where id = pg_temp.fx('h1')$q$), 0::bigint, 'U3 não renomeia a H1');
-- migration 014: ninguém apaga conta pela API (nem a própria família): o privilégio DELETE foi revogado
select is(pg_temp.sqlstate_of($q$delete from public.accounts where id = pg_temp.fx('a1')$q$), '42501', 'U3 não apaga conta da H1 (sem privilégio de delete)');
select is(pg_temp.rows_of($q$delete from public.budgets where id = pg_temp.fx('b1')$q$), 0::bigint, 'U3 não apaga orçamento da H1');
select is(pg_temp.rows_of($q$delete from public.categories where id = pg_temp.fx('c1')$q$), 0::bigint, 'U3 não apaga categoria da H1');

-- Referências cruzadas: mesmo U3 inserindo na PRÓPRIA família, apontando para dados da H1
select is(pg_temp.sqlstate_of(format($$insert into public.transactions (household_id, account_id, category_id, type, amount, date) values (%L, %L, %L, 'expense', 1, '2026-02-01')$$, pg_temp.fx('h2'), pg_temp.fx('a1'), pg_temp.fx('c3'))),
  '23503', 'FK composta: lançamento da H2 não aponta para conta da H1');
select is(pg_temp.sqlstate_of(format($$insert into public.transactions (household_id, account_id, category_id, type, amount, date) values (%L, %L, %L, 'expense', 1, '2026-02-01')$$, pg_temp.fx('h2'), pg_temp.fx('a3'), pg_temp.fx('c1'))),
  '23503', 'FK composta: lançamento da H2 não aponta para categoria da H1');
select is(pg_temp.sqlstate_of(format($$insert into public.transactions (household_id, account_id, destination_account_id, type, amount, date) values (%L, %L, %L, 'transfer', 1, '2026-02-01')$$, pg_temp.fx('h2'), pg_temp.fx('a3'), pg_temp.fx('a1'))),
  '23503', 'FK composta: transferência da H2 não tem destino na H1');
select is(pg_temp.sqlstate_of(format($$insert into public.budgets (household_id, category_id, month, amount_limit) values (%L, %L, '2026-03-01', 5)$$, pg_temp.fx('h2'), pg_temp.fx('c1'))),
  '23503', 'FK composta: orçamento da H2 não aponta para categoria da H1');

-- Relatórios chamados com o id da família alheia: ZERO linhas
select is((select count(*) from public.account_balances(pg_temp.fx('h1'), '2026-12-31')), 0::bigint, 'account_balances da H1 por U3: vazio');
select is((select count(*) from public.balance_totals(pg_temp.fx('h1'), '2026-12-31')), 0::bigint, 'balance_totals da H1 por U3: nenhuma linha');
select is((select count(*) from public.period_summary(pg_temp.fx('h1'), '2026-01-01', '2026-12-31')), 0::bigint, 'period_summary da H1 por U3: nenhuma linha');
select is((select count(*) from public.budget_usage(pg_temp.fx('h1'), '2026-02-01')), 0::bigint, 'budget_usage da H1 por U3: nenhuma linha');
-- ...e para a própria família os relatórios funcionam
select is((select count(*) from public.account_balances(pg_temp.fx('h2'), '2026-12-31')), 1::bigint, 'U3 vê o saldo da própria família');
select is((select count(*) from public.balance_totals(pg_temp.fx('h2'), '2026-12-31')), 1::bigint, 'U3 vê os totais da própria família');

-- RPCs: ninguém age sobre a família de outro
select is(pg_temp.sqlstate_of(format($$select public.remove_member('00000000-0000-0000-0000-0000000000a2')$$)), '22023', 'U3 (owner da H2) não remove membro da H1');
reset role;

-- ======== U2 (membro comum da H1) ========
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select is((select count(*) from public.accounts where household_id = pg_temp.fx('h1')), 1::bigint, 'membro vê as contas da família');
select is((select count(*) from public.transactions where household_id = pg_temp.fx('h1')), 1::bigint, 'membro vê os lançamentos da família');
select is((select count(*) from public.household_members where household_id = pg_temp.fx('h1')), 2::bigint, 'membro vê os membros da própria família');
select is((select count(*) from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'), 1::bigint, 'membro vê o perfil do colega de família');
select is((select count(*) from public.profiles where id = '00000000-0000-0000-0000-0000000000a3'), 0::bigint, 'membro não vê perfil de outra família');
select is((select count(*) from public.invitations), 0::bigint, 'membro comum não vê convites');
select is(pg_temp.sqlstate_of('select token_hash from public.invitations'), '42501', 'ninguém lê token_hash');
select is(pg_temp.sqlstate_of('select * from public.invitations'), '42501', 'select * em invitations é negado (inclui token_hash)');
select is(pg_temp.rows_of($q$update public.households set name = 'renomeada pelo membro' where id = pg_temp.fx('h1')$q$), 0::bigint, 'membro comum não renomeia a família');
select is(pg_temp.sqlstate_of($$select public.create_invitation('x@teste.com')$$), '42501', 'membro comum não convida');
select is(pg_temp.sqlstate_of('select public.remove_member(''00000000-0000-0000-0000-0000000000a1'')'), '42501', 'membro comum não remove membros');
select is(pg_temp.sqlstate_of('select public.delete_household()'), '42501', 'membro comum não exclui a família');
-- membro pode escrever dados financeiros (decisão 1)
select is(pg_temp.sqlstate_of(format($$insert into public.accounts (household_id, name, type, opening_date) values (%L, 'Conta do membro', 'cash', '2026-01-01')$$, pg_temp.fx('h1'))),
  null, 'membro comum cria conta (permissões iguais para dados financeiros)');
select is(pg_temp.sqlstate_of(format($$insert into public.transactions (household_id, account_id, category_id, type, amount, date) values (%L, %L, %L, 'expense', 5, '2026-02-02')$$, pg_temp.fx('h1'), pg_temp.fx('a1'), pg_temp.fx('c1'))),
  null, 'membro comum cria lançamento');
reset role;

-- ======== U1 (owner) ========
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select is((select count(*) from public.invitations where household_id = pg_temp.fx('h1')), 1::bigint, 'owner vê os convites (sem token_hash)');
select is((select count(*) from public.invitations where accepted_at is null), 0::bigint, 'nenhum convite pendente (o único foi aceito)');
select is(pg_temp.sqlstate_of($$select public.create_invitation('terceiro@teste.com')$$), '55000', 'família cheia (2/2) não gera novo convite');
select is(pg_temp.rows_of($q$update public.households set name = 'Casa 1 renomeada' where id = pg_temp.fx('h1')$q$), 1::bigint, 'owner renomeia a família');
select is(pg_temp.sqlstate_of(format($$update public.households set member_limit = 9 where id = %L$$, pg_temp.fx('h1'))), '42501', 'owner não altera member_limit pelo cliente');

-- Colunas imutáveis / não informáveis
select is(pg_temp.sqlstate_of(format($$update public.accounts set household_id = %L where id = %L$$, pg_temp.fx('h2'), pg_temp.fx('a1'))), '42501', 'não move conta para outra família');
select is(pg_temp.sqlstate_of(format($$update public.transactions set household_id = %L where id = %L$$, pg_temp.fx('h2'), pg_temp.fx('tx1'))), '42501', 'não move lançamento para outra família');
select is(pg_temp.sqlstate_of(format($$update public.transactions set created_by = '00000000-0000-0000-0000-0000000000a2' where id = %L$$, pg_temp.fx('tx1'))), '42501', 'não altera created_by');
select is(pg_temp.sqlstate_of(format($$insert into public.transactions (household_id, account_id, category_id, type, amount, date, created_by) values (%L, %L, %L, 'expense', 1, '2026-02-01', '00000000-0000-0000-0000-0000000000a2')$$, pg_temp.fx('h1'), pg_temp.fx('a1'), pg_temp.fx('c1'))),
  '42501', 'não falsifica created_by na inserção');
select is((select created_by::text from public.transactions where id = pg_temp.fx('tx1')), '00000000-0000-0000-0000-0000000000a1', 'created_by veio de auth.uid()');
select is(pg_temp.sqlstate_of(format($$update public.budgets set category_id = %L where id = %L$$, pg_temp.fx('inc1'), pg_temp.fx('b1'))), '42501', 'orçamento não troca de categoria');
select is(pg_temp.sqlstate_of(format($$insert into public.budgets (household_id, category_id, category_type, month, amount_limit) values (%L, %L, 'income', '2026-04-01', 5)$$, pg_temp.fx('h1'), pg_temp.fx('c1'))), '42501', 'category_type não é informável');

-- Escritas que só existem por RPC
select is(pg_temp.sqlstate_of(format($$insert into public.households (name) values ('direta')$$)), '42501', 'INSERT direto em households negado');
select is(pg_temp.sqlstate_of(format($$insert into public.household_members (household_id, user_id, role) values (%L, '00000000-0000-0000-0000-0000000000a4', 'member')$$, pg_temp.fx('h1'))), '42501', 'INSERT direto em household_members negado');
select is(pg_temp.sqlstate_of(format($$update public.household_members set role = 'owner' where household_id = %L$$, pg_temp.fx('h1'))), '42501', 'UPDATE direto em household_members negado');
select is(pg_temp.sqlstate_of(format($$delete from public.household_members where household_id = %L$$, pg_temp.fx('h1'))), '42501', 'DELETE direto em household_members negado');
select is(pg_temp.sqlstate_of(format($$insert into public.invitations (household_id, email, token_hash, expires_at) values (%L, 'a@b.com', 'x', now() + interval '1 day')$$, pg_temp.fx('h1'))), '42501', 'INSERT direto em invitations negado');
select is(pg_temp.sqlstate_of(format($$delete from public.invitations where household_id = %L$$, pg_temp.fx('h1'))), '42501', 'DELETE direto em invitations negado');
select is(pg_temp.sqlstate_of(format($$delete from public.households where id = %L$$, pg_temp.fx('h1'))), '42501', 'DELETE direto em households negado');
select is(pg_temp.sqlstate_of(format($$delete from public.transactions where id = %L$$, pg_temp.fx('tx1'))), '42501', 'DELETE direto em lançamentos negado (lixeira = UPDATE deleted_at)');
select is(pg_temp.sqlstate_of(format($$insert into public.profiles (id, name) values ('00000000-0000-0000-0000-0000000000a4', 'x')$$)), '42501', 'INSERT direto em profiles negado');
select is(pg_temp.sqlstate_of(format($$update public.profiles set id = '00000000-0000-0000-0000-0000000000a9' where id = '00000000-0000-0000-0000-0000000000a1'$$)), '42501', 'id do perfil imutável');
select is(pg_temp.rows_of($q$update public.profiles set name = 'Ana Maria' where id = '00000000-0000-0000-0000-0000000000a1'$q$), 1::bigint, 'usuário renomeia o próprio perfil');
select is(pg_temp.rows_of($q$update public.profiles set name = 'Outra' where id = '00000000-0000-0000-0000-0000000000a2'$q$), 0::bigint, 'usuário não altera perfil alheio');
reset role;

-- ======== anon: nada em nenhuma tabela, nenhuma função ========
select pg_temp.login_anon();
select is(current_user::text, 'anon', 'agora o teste roda como anon');
select is(pg_temp.sqlstate_of('select * from public.profiles'), '42501', 'anon não lê profiles');
select is(pg_temp.sqlstate_of('select * from public.households'), '42501', 'anon não lê households');
select is(pg_temp.sqlstate_of('select * from public.household_members'), '42501', 'anon não lê household_members');
select is(pg_temp.sqlstate_of('select * from public.invitations'), '42501', 'anon não lê invitations');
select is(pg_temp.sqlstate_of('select * from public.accounts'), '42501', 'anon não lê accounts');
select is(pg_temp.sqlstate_of('select * from public.categories'), '42501', 'anon não lê categories');
select is(pg_temp.sqlstate_of('select * from public.transactions'), '42501', 'anon não lê transactions');
select is(pg_temp.sqlstate_of('select * from public.budgets'), '42501', 'anon não lê budgets');
select is(pg_temp.sqlstate_of(format($$insert into public.accounts (household_id, name, type, opening_date) values (%L, 'anon', 'cash', '2026-01-01')$$, pg_temp.fx('h1'))), '42501', 'anon não escreve em accounts');
select is(pg_temp.sqlstate_of(format($$select public.account_balances(%L, '2026-12-31')$$, pg_temp.fx('h1'))), '42501', 'anon não executa account_balances');
select is(pg_temp.sqlstate_of($$select public.create_household('anon')$$), '42501', 'anon não executa create_household');
select is(pg_temp.sqlstate_of($$select public.create_invitation('a@b.com')$$), '42501', 'anon não executa create_invitation');
select is(pg_temp.sqlstate_of($$select public.accept_invitation('0123456789abcdef0123456789abcdef')$$), '42501', 'anon não executa accept_invitation');
select is(pg_temp.sqlstate_of('select public.delete_household()'), '42501', 'anon não executa delete_household');
select is(pg_temp.sqlstate_of('select private.is_member(gen_random_uuid())'), '42501', 'anon não alcança o schema private');
reset role;

-- ======== autenticado sem sub (token sem usuário) ========
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
set local role authenticated;
select is(pg_temp.sqlstate_of($$select public.create_household('sem usuário')$$), '42501', 'create_household sem auth.uid() => erro');
select is(pg_temp.sqlstate_of($$select public.create_invitation('a@b.com')$$), '42501', 'create_invitation sem auth.uid() => erro');
select is(pg_temp.sqlstate_of($$select public.accept_invitation('0123456789abcdef0123456789abcdef')$$), '42501', 'accept_invitation sem auth.uid() => erro');
select is(pg_temp.sqlstate_of('select public.remove_member(gen_random_uuid())'), '42501', 'remove_member sem auth.uid() => erro');
select is(pg_temp.sqlstate_of('select public.leave_household()'), '42501', 'leave_household sem auth.uid() => erro');
select is(pg_temp.sqlstate_of('select public.delete_household()'), '42501', 'delete_household sem auth.uid() => erro');
select is((select count(*) from public.accounts), 0::bigint, 'sem auth.uid() nenhuma conta é visível');
reset role;

select * from finish();
rollback;
