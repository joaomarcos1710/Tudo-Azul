-- 46_account_type_investment: migration 044. Conta do tipo Investimento e saldo por tipo.
-- Desde a 070 o tipo 'investment' não existe mais: a conta de investimento de liquidez (CDB) é 'fixed_income'.
-- Datas relativas a hoje em São Paulo; nada depende de data fixa nem do fuso do servidor.
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
create function pg_temp.hoje() returns date language sql as $f$ select (now() at time zone 'America/Sao_Paulo')::date $f$;
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
create function pg_temp.conta(p_nome text, p_tipo text, p_saldo numeric) returns uuid language plpgsql as $f$
declare v uuid;
begin
  insert into public.accounts (household_id, name, type, initial_balance, opening_date)
  values (pg_temp.fx('h'), p_nome, p_tipo, p_saldo, pg_temp.hoje() - 30) returning id into v;
  return v;
end $f$;
create function pg_temp.por_tipo(p_tipo text) returns text language sql as $f$
  select total::text || '|' || total_active::text from public.balance_totals_by_type(pg_temp.fx('h'), pg_temp.hoje())
   where account_type = p_tipo $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.hoje(), pg_temp.sqlstate_of(text),
  pg_temp.conta(text, text, numeric), pg_temp.por_tipo(text) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000046a1', 'a1@teste.com'),
  ('00000000-0000-0000-0000-0000000046a2', 'a2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000046a1');
insert into fixture select 'h', public.create_household('Casa Contas');

select lives_ok($$select pg_temp.conta('CDB Caixinha', 'fixed_income', 2000)$$, 'T1 aceita conta de investimento (renda fixa, 070)');
select is(pg_temp.sqlstate_of($$select pg_temp.conta('Fundo', 'fund', 10)$$), '23514', 'T2 tipo desconhecido continua recusado');
insert into fixture select 'cc', pg_temp.conta('Corrente', 'checking', 1000);
insert into fixture select 'pp', pg_temp.conta('Poupança', 'savings', 300);
insert into fixture select 'p2', pg_temp.conta('Poupança antiga', 'savings', 50);
update public.accounts set active = false where id = pg_temp.fx('p2');
insert into fixture select 'inv', id from public.accounts where household_id = pg_temp.fx('h') and name = 'CDB Caixinha';

-- aplicação = transferência da corrente para o investimento: sai de um, entra no outro, o consolidado não muda
insert into public.transactions (household_id, type, status, date, amount, description, account_id, destination_account_id)
values (pg_temp.fx('h'), 'transfer', 'paid', pg_temp.hoje() - 1, 400, 'Aplicação CDB', pg_temp.fx('cc'), pg_temp.fx('inv'));

select is(pg_temp.por_tipo('checking'), '600.00|600.00', 'T3 corrente: 1000 - 400 aplicados');
select is(pg_temp.por_tipo('fixed_income'), '2400.00|2400.00', 'T4 renda fixa: 2000 + 400 aplicados');
select is(pg_temp.por_tipo('savings'), '350.00|300.00', 'T5 poupança: total inclui a arquivada (50), ativas só 300');
select is((select sum(total) from public.balance_totals_by_type(pg_temp.fx('h'), pg_temp.hoje())),
          (select total from public.balance_totals(pg_temp.fx('h'), pg_temp.hoje())),
          'T6 a soma por tipo bate com o saldo total da família');
select is((select array_agg(account_type) from public.balance_totals_by_type(pg_temp.fx('h'), pg_temp.hoje())),
          array['checking', 'savings', 'fixed_income']::text[], 'T7 ordem: corrente, poupança, renda fixa');

select pg_temp.login('00000000-0000-0000-0000-0000000046a2');
select is((select count(*) from public.balance_totals_by_type(pg_temp.fx('h'), pg_temp.hoje())), 0::bigint, 'T8 quem não é da família não vê nada');

select * from finish();
rollback;
