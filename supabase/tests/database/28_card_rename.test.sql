-- 28_card_rename: migration 021. Renomear cartão e a mensagem de exclusão que conta o que existe.
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
create function pg_temp.anon() returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('role', 'anon', true);
end $f$;
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
create function pg_temp.msg_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlerrm; end $f$;
create function pg_temp.mes(n integer) returns date language sql as $f$
  select (date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date) + make_interval(months => n))::date $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.anon(), pg_temp.sqlstate_of(text),
  pg_temp.msg_of(text), pg_temp.mes(integer) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000028a1', 'rn1@teste.com'),
  ('00000000-0000-0000-0000-0000000028a2', 'rn2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000028a1');
insert into fixture select 'h', public.create_household('Casa Renomear');
insert into fixture select 'cexp', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';
insert into fixture select 'c1', public.create_debt('Cartão Azull', 'card', pg_temp.mes(-6), 0);
insert into fixture select 'c2', public.create_debt('Outro cartão', 'card', pg_temp.mes(-6), 0);
select public.set_card_cycle(pg_temp.fx('c1'), 17, 25);

-- ---- renomear ----
select lives_ok($$select public.debt_rename(pg_temp.fx('c1'), '  Cartão Azul  ')$$, 'RN1 renomeia');
select is((select name from public.debts where id = pg_temp.fx('c1')), 'Cartão Azul', 'RN1.1 o nome novo vale e vem aparado');
select lives_ok($$select public.debt_rename(pg_temp.fx('c1'), 'Cartão Azul')$$, 'RN2 repetir o próprio nome não é conflito');
select is(pg_temp.sqlstate_of($$select public.debt_rename(pg_temp.fx('c1'), 'outro CARTÃO')$$), '23505', 'RN3 nome de outro cartão (sem maiúscula/minúscula): 23505');
select is(pg_temp.sqlstate_of($$select public.debt_rename(pg_temp.fx('c1'), '   ')$$), '22023', 'RN4 nome vazio: 22023');
select is(pg_temp.sqlstate_of(format($q$select public.debt_rename(pg_temp.fx('c1'), %L)$q$, repeat('x', 61))), '22023', 'RN5 nome com 61 caracteres: 22023');
select is(pg_temp.sqlstate_of($$select public.debt_rename(pg_temp.fx('c1'), null)$$), '22023', 'RN6 nome nulo: 22023');
select is((select name from public.debts where id = pg_temp.fx('c1')), 'Cartão Azul', 'RN6.1 nada mudou nas tentativas recusadas');

-- renomear não mexe no dinheiro nem no histórico
insert into fixture select 'plano', public.card_purchase(pg_temp.fx('c1'), pg_temp.mes(0), 300.00, 3, pg_temp.fx('cexp'), 'Geladeira');
create temp table antes as select debt, planned_remaining from public.debt_balances(pg_temp.fx('h'), (now() at time zone 'America/Sao_Paulo')::date) where debt_id = pg_temp.fx('c1');
select public.debt_rename(pg_temp.fx('c1'), 'Cartão Principal');
select is((select array[debt, planned_remaining] from public.debt_balances(pg_temp.fx('h'), (now() at time zone 'America/Sao_Paulo')::date) where debt_id = pg_temp.fx('c1')),
          (select array[debt, planned_remaining] from antes), 'RN7 renomear com compra não muda dívida nem compromissos');
select is((select count(*) from public.debt_installments where debt_id = pg_temp.fx('c1')), 3::bigint, 'RN7.1 as 3 parcelas continuam no cartão');

-- ---- mensagem de exclusão conta o que existe ----
select is(pg_temp.msg_of($$select public.debt_delete(pg_temp.fx('c1'))$$),
          'tem histórico (3 parcelas): só é possível arquivar', 'DM1 a recusa diz o que existe (as 3 parcelas da compra)');
select is(pg_temp.sqlstate_of($$select public.debt_delete(pg_temp.fx('c1'))$$), '23503', 'DM1.1 continua 23503');
insert into public.accounts (household_id, name, type, initial_balance, opening_date)
  values (pg_temp.fx('h'), 'Banco', 'checking', 100, pg_temp.mes(-12));
insert into fixture select 'banco', id from public.accounts where household_id = pg_temp.fx('h') and name = 'Banco';
insert into public.transactions (household_id, account_id, category_id, type, amount, date, status)
  values (pg_temp.fx('h'), pg_temp.fx('banco'), pg_temp.fx('cexp'), 'expense', 10, pg_temp.mes(-1), 'paid');
select is(pg_temp.msg_of($$select public.account_delete(pg_temp.fx('banco'))$$),
          'tem histórico (1 lançamento): só é possível arquivar', 'DM2 conta: a recusa conta os lançamentos');
select lives_ok($$select public.debt_delete(pg_temp.fx('c2'))$$, 'DM3 cartão realmente vazio continua podendo ser excluído');

-- ---- outra família e anon ----
select pg_temp.login('00000000-0000-0000-0000-0000000028a2');
insert into fixture select 'h2', public.create_household('Casa Outra');
select is(pg_temp.sqlstate_of($$select public.debt_rename(pg_temp.fx('c1'), 'Roubado')$$), '42501', 'RI1 renomear cartão de outra família: 42501');
select pg_temp.anon();
select is(pg_temp.sqlstate_of($$select public.debt_rename(pg_temp.fx('c1'), 'Roubado')$$), '42501', 'RA1 anon não renomeia');

select pg_temp.login('00000000-0000-0000-0000-0000000028a1');
select is((select name from public.debts where id = pg_temp.fx('c1')), 'Cartão Principal', 'RI2 o nome continua o do dono');

select * from finish();
rollback;
