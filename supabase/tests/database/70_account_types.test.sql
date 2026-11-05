-- 70_account_types: migration 070. Os 7 tipos de conta (onde o dinheiro está), a conversão genérica dos tipos antigos,
-- o saldo por tipo na ordem nova, a carteira sem banco e o isolamento entre famílias.
-- Dados inventados; datas relativas a hoje em São Paulo.
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

-- ---- constraint ----
select is(
  (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.accounts'::regclass and conname = 'accounts_type_check'),
  $$CHECK ((type = ANY (ARRAY['checking'::text, 'savings'::text, 'brokerage'::text, 'fixed_income'::text, 'variable_income'::text, 'crypto'::text, 'cash'::text])))$$,
  'K1 accounts.type aceita exatamente os 7 tipos');

-- ---- conversão genérica (a regra que a migration aplicou nas contas existentes) ----
select is(private.account_type_from_legacy('investment'), 'fixed_income', 'C1 investment vira renda fixa');
select is(private.account_type_from_legacy('other'), 'checking', 'C2 other vira conta corrente');
select is(
  array(select private.account_type_from_legacy(t)
          from unnest(array['checking', 'savings', 'brokerage', 'fixed_income', 'variable_income', 'crypto', 'cash']) t),
  array['checking', 'savings', 'brokerage', 'fixed_income', 'variable_income', 'crypto', 'cash'],
  'C3 os 7 tipos novos não mudam');
select is((select count(*) from public.accounts where type in ('investment', 'other')), 0::bigint,
  'C4 nenhuma conta ficou com tipo antigo');
select ok(not has_function_privilege('authenticated', 'private.account_type_from_legacy(text)', 'EXECUTE'),
  'C5 a regra de conversão não é chamável pelo app');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000070a1', 'a1@teste.com'),
  ('00000000-0000-0000-0000-0000000070a2', 'a2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000070a1');
insert into fixture select 'h', public.create_household('Casa Tipos');

select lives_ok($$select pg_temp.conta('Conta do dia a dia', 'checking', 1000)$$, 'T1 aceita conta corrente');
select lives_ok($$select pg_temp.conta('Reserva de emergência', 'savings', 500)$$, 'T2 aceita poupança / reserva');
select lives_ok($$select pg_temp.conta('Saldo na corretora', 'brokerage', 300)$$, 'T3 aceita corretora (saldo a aplicar)');
select lives_ok($$select pg_temp.conta('Tesouro de teste', 'fixed_income', 2000)$$, 'T4 aceita renda fixa');
select lives_ok($$select pg_temp.conta('Ações de teste', 'variable_income', 700)$$, 'T5 aceita renda variável');
select lives_ok($$select pg_temp.conta('Carteira cripto', 'crypto', 40)$$, 'T6 aceita cripto');
select lives_ok($$select pg_temp.conta('Carteira de bolso', 'cash', 25)$$, 'T7 aceita dinheiro (carteira)');
select is(pg_temp.sqlstate_of($$select pg_temp.conta('Antiga investimento', 'investment', 1)$$), '23514', 'T8 investment não é mais aceito');
select is(pg_temp.sqlstate_of($$select pg_temp.conta('Antiga outra', 'other', 1)$$), '23514', 'T9 other não é mais aceito');
select is(pg_temp.sqlstate_of($$select pg_temp.conta('Inventado', 'reserve', 1)$$), '23514', 'T10 tipo desconhecido recusado');
select is(pg_temp.sqlstate_of(format('update public.accounts set type = %L where household_id = %L and name = %L',
  'investment', pg_temp.fx('h'), 'Saldo na corretora')), '23514', 'T11 não dá para voltar uma conta para investment');

-- ---- carteira em dinheiro nunca tem banco; os outros tipos podem ter ----
select is(pg_temp.sqlstate_of(format('update public.accounts set bank = %L where household_id = %L and name = %L',
  'nubank', pg_temp.fx('h'), 'Carteira de bolso')), '23514', 'B1 dinheiro (carteira) continua sem banco');
select lives_ok(format('update public.accounts set bank = %L where household_id = %L and name = %L',
  'xp', pg_temp.fx('h'), 'Saldo na corretora'), 'B2 corretora pode ter banco');
select lives_ok(format('update public.accounts set type = %L where household_id = %L and name = %L',
  'variable_income', pg_temp.fx('h'), 'Saldo na corretora'), 'B3 trocar o tipo de uma conta com banco para outro tipo de investimento');
update public.accounts set type = 'brokerage' where household_id = pg_temp.fx('h') and name = 'Saldo na corretora';
select is(pg_temp.sqlstate_of(format('update public.accounts set type = %L where household_id = %L and name = %L',
  'cash', pg_temp.fx('h'), 'Saldo na corretora')), '23514', 'B4 conta com banco não vira dinheiro');

-- ---- saldo por tipo ----
insert into fixture select 'cc', id from public.accounts where household_id = pg_temp.fx('h') and name = 'Conta do dia a dia';
insert into fixture select 'br', id from public.accounts where household_id = pg_temp.fx('h') and name = 'Saldo na corretora';
insert into fixture select 'rf', id from public.accounts where household_id = pg_temp.fx('h') and name = 'Tesouro de teste';
-- a transferência entra na corretora (saldo a aplicar) e a aplicação vai dela para a renda fixa
insert into public.transactions (household_id, type, status, date, amount, description, account_id, destination_account_id)
values (pg_temp.fx('h'), 'transfer', 'paid', pg_temp.hoje() - 2, 400, 'Para a corretora', pg_temp.fx('cc'), pg_temp.fx('br')),
       (pg_temp.fx('h'), 'transfer', 'paid', pg_temp.hoje() - 1, 650, 'Aplicação', pg_temp.fx('br'), pg_temp.fx('rf'));
-- uma cripto arquivada: entra no total do tipo, não no das ativas
insert into fixture select 'cr2', pg_temp.conta('Cripto antiga', 'crypto', 10);
update public.accounts set active = false where id = pg_temp.fx('cr2');

select is(pg_temp.por_tipo('checking'), '600.00|600.00', 'S1 corrente: 1000 − 400');
select is(pg_temp.por_tipo('brokerage'), '50.00|50.00', 'S2 corretora: 300 + 400 − 650 aplicados');
select is(pg_temp.por_tipo('fixed_income'), '2650.00|2650.00', 'S3 renda fixa: 2000 + 650');
select is(pg_temp.por_tipo('crypto'), '50.00|40.00', 'S4 cripto: total inclui a arquivada (10), ativas só 40');
select is((select array_agg(account_type) from public.balance_totals_by_type(pg_temp.fx('h'), pg_temp.hoje())),
          array['checking', 'savings', 'brokerage', 'fixed_income', 'variable_income', 'crypto', 'cash']::text[],
          'S5 ordem: corrente, reserva, corretora, renda fixa, renda variável, cripto, dinheiro');
select is((select sum(total) from public.balance_totals_by_type(pg_temp.fx('h'), pg_temp.hoje())),
          (select total from public.balance_totals(pg_temp.fx('h'), pg_temp.hoje())),
          'S6 a soma por tipo bate com o saldo total da família');

-- conta em outra moeda continua fora do saldo por tipo (055)
insert into public.accounts (household_id, name, type, initial_balance, opening_date, currency_code)
values (pg_temp.fx('h'), 'Ações em dólar', 'variable_income', 999, pg_temp.hoje() - 30, 'USD');
select is(pg_temp.por_tipo('variable_income'), '700.00|700.00', 'S7 renda variável em dólar fica fora do total em reais');

-- ---- isolamento ----
select pg_temp.login('00000000-0000-0000-0000-0000000070a2');
select is((select count(*) from public.balance_totals_by_type(pg_temp.fx('h'), pg_temp.hoje())), 0::bigint, 'I1 quem não é da família não vê nada');
select is((select count(*) from public.accounts where household_id = pg_temp.fx('h')), 0::bigint, 'I2 nem as contas');

select * from finish();
rollback;
