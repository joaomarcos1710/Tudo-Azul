-- 31_card_pay_account: migration 024. Conta de pagamento padrão do cartão.
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
create function pg_temp.pagadora(p_card text) returns uuid language sql as $f$
  select pay_account_id from public.debts where id = pg_temp.fx(p_card) $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.anon(), pg_temp.sqlstate_of(text),
  pg_temp.msg_of(text), pg_temp.pagadora(text) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000031a1', 'pa1@teste.com'),
  ('00000000-0000-0000-0000-0000000031a2', 'pa2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000031a1');
insert into fixture select 'h', public.create_household('Casa Pagadora');
insert into public.accounts (household_id, name, type, initial_balance, opening_date) values
  (pg_temp.fx('h'), 'Caixa', 'checking', 1000, '2026-01-01'),
  (pg_temp.fx('h'), 'Inter', 'checking', 500, '2026-01-01'),
  (pg_temp.fx('h'), 'Antiga', 'checking', 0, '2026-01-01');
insert into fixture select 'caixa', id from public.accounts where household_id = pg_temp.fx('h') and name = 'Caixa';
insert into fixture select 'inter', id from public.accounts where household_id = pg_temp.fx('h') and name = 'Inter';
insert into fixture select 'antiga', id from public.accounts where household_id = pg_temp.fx('h') and name = 'Antiga';
update public.accounts set active = false where id = pg_temp.fx('antiga');
insert into fixture select 'cartao', public.create_debt('Cartão', 'card', '2026-01-01', 0);
insert into fixture select 'emp', public.create_debt('Empréstimo', 'loan', '2026-01-01', 0);

-- começa sem conta
select is(pg_temp.pagadora('cartao'), null::uuid, 'PA0 cartão novo nasce sem conta de pagamento');
-- define, muda, limpa
select lives_ok($$select public.set_card_pay_account(pg_temp.fx('cartao'), pg_temp.fx('caixa'))$$, 'PA1 define a conta');
select is(pg_temp.pagadora('cartao'), pg_temp.fx('caixa'), 'PA1.1 gravada');
select lives_ok($$select public.set_card_pay_account(pg_temp.fx('cartao'), pg_temp.fx('inter'))$$, 'PA2 muda a conta');
select is(pg_temp.pagadora('cartao'), pg_temp.fx('inter'), 'PA2.1 gravada');
-- recusas
select is(pg_temp.sqlstate_of($$select public.set_card_pay_account(pg_temp.fx('cartao'), pg_temp.fx('antiga'))$$), '23514',
          'PA3 conta arquivada não pode pagar o cartão');
select is(pg_temp.sqlstate_of($$select public.set_card_pay_account(pg_temp.fx('emp'), pg_temp.fx('caixa'))$$), '23514',
          'PA4 só cartão tem conta de pagamento (empréstimo recusado)');
select is(pg_temp.sqlstate_of($$select public.set_card_pay_account(pg_temp.fx('cartao'), gen_random_uuid())$$), '42501',
          'PA5 conta inexistente: 42501');
select is(pg_temp.pagadora('cartao'), pg_temp.fx('inter'), 'PA5.1 as recusas não mudaram nada');
-- conta ligada a cartão não é excluída, só arquivada
select is(pg_temp.msg_of($$select public.account_delete(pg_temp.fx('inter'))$$),
          'tem histórico (1 cartão que usa a conta): só é possível arquivar', 'PA6 conta pagadora de cartão: exclusão recusada, com o motivo');
select is(pg_temp.sqlstate_of($$select public.account_delete(pg_temp.fx('inter'))$$), '23503', 'PA6.1 sqlstate 23503');
select lives_ok($$select public.account_delete(pg_temp.fx('caixa'))$$, 'PA7 conta que não paga cartão nenhum e nunca teve movimento: excluída');
-- limpar
select lives_ok($$select public.set_card_pay_account(pg_temp.fx('cartao'), null)$$, 'PA8 limpa a conta');
select is(pg_temp.pagadora('cartao'), null::uuid, 'PA8.1 de volta a sem conta');
select lives_ok($$select public.account_delete(pg_temp.fx('inter'))$$, 'PA8.2 sem o cartão ligado, a conta Inter agora pode ser excluída');

-- outra família: não usa conta nem cartão de ninguém
select pg_temp.login('00000000-0000-0000-0000-0000000031a2');
insert into fixture select 'h2', public.create_household('Casa Outra');
insert into public.accounts (household_id, name, type, initial_balance, opening_date) values (pg_temp.fx('h2'), 'Banco B', 'checking', 0, '2026-01-01');
insert into fixture select 'bancob', id from public.accounts where household_id = pg_temp.fx('h2') and name = 'Banco B';
insert into fixture select 'cartaob', public.create_debt('Cartão B', 'card', '2026-01-01', 0);
select is(pg_temp.sqlstate_of($$select public.set_card_pay_account(pg_temp.fx('cartao'), pg_temp.fx('bancob'))$$), '42501',
          'PI1 cartão de outra família: 42501');
select is(pg_temp.sqlstate_of($$select public.set_card_pay_account(pg_temp.fx('cartaob'), pg_temp.fx('inter'))$$), '42501',
          'PI2 conta de outra família: 42501 (nem o cartão próprio aceita)');

-- anon
select pg_temp.anon();
select is(pg_temp.sqlstate_of($$select public.set_card_pay_account(pg_temp.fx('cartaob'), pg_temp.fx('bancob'))$$), '42501', 'PN1 anon não executa');

select * from finish();
rollback;
