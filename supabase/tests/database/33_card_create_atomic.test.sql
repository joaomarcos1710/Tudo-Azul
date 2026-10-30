-- 33_card_create_atomic: migration 026. O cadastro inteiro confirma ou reverte.
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
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.anon(), pg_temp.sqlstate_of(text) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000032a1', 'atomic1@teste.com'),
  ('00000000-0000-0000-0000-0000000032a2', 'atomic2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000032a1');
insert into fixture select 'h1', public.create_household('Casa Atômica');
insert into public.accounts (household_id, name, type, initial_balance, opening_date)
values (pg_temp.fx('h1'), 'Conta principal', 'checking', 1000, '2026-01-01');
insert into fixture select 'a1', id from public.accounts where household_id = pg_temp.fx('h1') and name = 'Conta principal';

-- Cadastro completo em uma chamada: saldo inicial da dívida, ciclo, emissor, bandeira e conta pagadora.
insert into fixture select 'card', public.create_card(
  'Cartão completo', '2026-10-29', 123.45, 17, 25, 'nubank', 'mastercard', pg_temp.fx('a1')
);
select is((select name from public.debts where id = pg_temp.fx('card')), 'Cartão completo', 'CA1 cartão criado');
select is((select reference_balance from public.debts where id = pg_temp.fx('card')), 123.45::numeric, 'CA2 saldo de referência gravado');
select is((select closing_day::integer from public.debts where id = pg_temp.fx('card')), 17, 'CA3 fechamento gravado');
select is((select due_day::integer from public.debts where id = pg_temp.fx('card')), 25, 'CA4 vencimento gravado');
select is((select issuer from public.debts where id = pg_temp.fx('card')), 'nubank', 'CA5 emissor gravado');
select is((select brand from public.debts where id = pg_temp.fx('card')), 'mastercard', 'CA6 bandeira gravada');
select is((select pay_account_id from public.debts where id = pg_temp.fx('card')), pg_temp.fx('a1'), 'CA7 conta pagadora gravada');

-- Prepara uma conta de outra família: falhar no último passo precisa reverter inclusive a dívida e o ciclo.
select pg_temp.login('00000000-0000-0000-0000-0000000032a2');
insert into fixture select 'h2', public.create_household('Outra Casa');
insert into public.accounts (household_id, name, type, initial_balance, opening_date)
values (pg_temp.fx('h2'), 'Conta alheia', 'checking', 0, '2026-01-01');
insert into fixture select 'foreign', id from public.accounts where household_id = pg_temp.fx('h2') and name = 'Conta alheia';

select pg_temp.login('00000000-0000-0000-0000-0000000032a1');
select is(pg_temp.sqlstate_of(format(
  'select public.create_card(%L,%L,%L,%L,%L,%L,%L,%L)',
  'Falha pagadora', '2026-10-29', 0, 17, 25, 'nubank', 'visa', pg_temp.fx('foreign')
)), '42501', 'CA8 conta de outra família é recusada');
select is((select count(*) from public.debts where household_id = pg_temp.fx('h1') and name = 'Falha pagadora'), 0::bigint,
          'CA9 falha na conta pagadora reverte a criação inteira');

select is(pg_temp.sqlstate_of(format(
  'select public.create_card(%L,%L,%L,%L,%L,%L,%L,%L)',
  'Falha ciclo', '2026-10-29', 0, 32, 25, null, null, null
)), '22023', 'CA10 dia de fechamento inválido é recusado');
select is((select count(*) from public.debts where household_id = pg_temp.fx('h1') and name = 'Falha ciclo'), 0::bigint,
          'CA11 falha no ciclo não deixa cartão parcial');

select pg_temp.anon();
select is(pg_temp.sqlstate_of(format(
  'select public.create_card(%L,%L,%L,%L,%L,%L,%L,%L)',
  'Anônimo', '2026-10-29', 0, 17, 25, null, null, null
)), '42501', 'CA12 anon não pode criar cartão');

select * from finish();
rollback;
