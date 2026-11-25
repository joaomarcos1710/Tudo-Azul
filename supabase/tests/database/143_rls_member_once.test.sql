-- 143_rls_member_once: migration 149. A regra de acesso confere a família uma vez por consulta (private.my_households),
-- não uma vez por linha (private.is_member(household_id)). O acesso é o mesmo de antes.
--   * my_households: as famílias de quem pergunta; vazio para quem não é de nenhuma; todas na leitura de serviço (098).
--   * nenhuma policy ficou no formato antigo (é o que deixava o banco lento: falha sem a migration).
--   * isolamento conferido de novo nas tabelas mais lidas: cada um vê só a sua família e não grava na do outro.
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
-- as famílias de quem pergunta, ordenadas; 'ERRO <sqlstate>' se a função não existe
create function pg_temp.minhas() returns text language plpgsql as $f$
declare r text;
begin
  execute 'select coalesce((select string_agg(x::text, '','' order by x) from unnest(private.my_households()) x), '''')' into r;
  return r;
exception when others then return 'ERRO ' || sqlstate;
end $f$;
-- quantas linhas o update alcançou, ou 'ERRO <sqlstate>'
create function pg_temp.renomear(p_conta uuid) returns text language plpgsql as $f$
declare n integer;
begin
  update public.accounts set name = 'Invadida' where id = p_conta;
  get diagnostics n = row_count;
  return n::text;
exception when others then return 'ERRO ' || sqlstate;
end $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.minhas(), pg_temp.renomear(uuid) to public;

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000143b1', 'r1@teste.com', now()),
  ('00000000-0000-0000-0000-0000000143b2', 'r2@teste.com', now()),
  ('00000000-0000-0000-0000-0000000143b3', 'r3@teste.com', now());

select pg_temp.login('00000000-0000-0000-0000-0000000143b2');
insert into fixture select 'h2', public.create_household('Casa Dois');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h2'), 'Banco Dois', 'checking', 10.00, '2026-01-01') returning id)
  insert into fixture select 'conta2', id from i;

select pg_temp.login('00000000-0000-0000-0000-0000000143b1');
insert into fixture select 'h1', public.create_household('Casa Um');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h1'), 'Banco Um', 'checking', 100.00, '2026-01-01') returning id)
  insert into fixture select 'conta1', id from i;
insert into fixture select 'cat1', id from public.categories where household_id = pg_temp.fx('h1') and name = 'Mercado';
insert into public.transactions (household_id, account_id, category_id, type, amount, date, description)
values (pg_temp.fx('h1'), pg_temp.fx('conta1'), pg_temp.fx('cat1'), 'expense', 30.00, '2026-02-01', 'Feira');
insert into fixture select 'cartao1', public.create_debt('Cartão Um', 'card', '2026-01-01', 0);

-- 1. my_households
select is(pg_temp.minhas(), pg_temp.fx('h1')::text, 'quem é de uma família recebe só ela');
select pg_temp.login('00000000-0000-0000-0000-0000000143b2');
select is(pg_temp.minhas(), pg_temp.fx('h2')::text, 'a outra pessoa recebe só a dela');
select pg_temp.login('00000000-0000-0000-0000-0000000143b3');
select is(pg_temp.minhas(), '', 'quem não é de nenhuma família recebe a lista vazia');

-- 2. isolamento: quem não é da família não vê nada dela
select is((select count(*)::int from public.accounts), 0, 'sem família: nenhuma conta');
select is((select count(*)::int from public.transactions), 0, 'sem família: nenhum lançamento');
select is((select count(*)::int from public.households), 0, 'sem família: nenhuma família');

select pg_temp.login('00000000-0000-0000-0000-0000000143b2');
select is((select array_agg(name order by name) from public.accounts), array['Banco Dois'], 'família 2 vê só a conta dela');
select is((select count(*)::int from public.transactions), 0, 'família 2 não vê o lançamento da família 1');
select is((select count(*)::int from public.debts), 0, 'família 2 não vê o cartão da família 1');
select is((select count(*)::int from public.categories where household_id = pg_temp.fx('h1')), 0, 'nem as categorias');
select is((select array_agg(name order by name) from public.households), array['Casa Dois'], 'nem a família em si');
select is((select count(*)::int from public.household_members where household_id = pg_temp.fx('h1')), 0, 'nem os membros');
-- gravar na família alheia continua recusado (with check)
select throws_ok($$ insert into public.categories (household_id, name, type) values (pg_temp.fx('h1'), 'Intrusa', 'expense') $$,
  '42501', null, 'família 2 não cria categoria na família 1');
select ok(pg_temp.renomear(pg_temp.fx('conta1')) in ('0', 'ERRO 42501'), 'família 2 não altera a conta da família 1');

select pg_temp.login('00000000-0000-0000-0000-0000000143b1');
select is((select array_agg(name order by name) from public.accounts), array['Banco Um'], 'família 1 vê só a conta dela');
select is((select array_agg(description) from public.transactions), array['Feira'], 'e o lançamento dela');
select is((select array_agg(name) from public.debts), array['Cartão Um'], 'e o cartão dela');
-- os números continuam os mesmos pelas funções (RLS por baixo): 100,00 − 30,00
select is((select balance from public.account_balances(pg_temp.fx('h1'), '2026-12-31') where account_id = pg_temp.fx('conta1')),
  70.00, 'saldo da conta pela função continua certo');
select is((select count(*)::int from public.account_balances(pg_temp.fx('h2'), '2026-12-31')), 0,
  'pedir os saldos da família alheia não devolve nada');

-- 3. nenhuma policy conferindo a família linha por linha (o formato lento), e as tabelas grandes no formato novo
reset role;
select is((select count(*)::int from pg_policies
            where schemaname = 'public'
              and (qual ~ '^\( SELECT private\.is_member\([a-z_]+\.household_id\) AS is_member\)$'
                or with_check ~ '^\( SELECT private\.is_member\([a-z_]+\.household_id\) AS is_member\)$'
                or qual ~ 'is_member\(households\.id\)')), 0,
  'nenhuma policy no formato que roda uma consulta por linha');
select is((select array_agg(tablename::text order by tablename) from pg_policies
            where schemaname = 'public' and cmd = 'SELECT' and qual ~ 'my_households'
              and tablename in ('accounts','categories','debt_events','debt_installments','debts','households','transactions')),
  array['accounts','categories','debt_events','debt_installments','debts','households','transactions'],
  'as tabelas mais lidas conferem a família uma vez por consulta');

-- 4. leitura de serviço (098): service_role com app.service_read ligado enxerga todas as famílias; desligado, nenhuma
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
select set_config('app.service_read', 'on', true);
select ok(private.my_households() @> array[pg_temp.fx('h1'), pg_temp.fx('h2')], 'leitura de serviço ligada: todas as famílias');
select set_config('app.service_read', '', true);
select is(private.my_households(), '{}'::uuid[], 'leitura de serviço desligada: nenhuma');

select * from finish();
rollback;
