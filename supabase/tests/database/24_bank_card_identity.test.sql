-- 24_bank_card_identity: migration 017. Banco da conta (accounts.bank), emissor e bandeira do cartão (debts.issuer, debts.brand).
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
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.sqlstate_of(text) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000024a1', 'b1@teste.com'),
  ('00000000-0000-0000-0000-0000000024a2', 'b2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000024a1');
insert into fixture select 'h', public.create_household('Casa do Banco');

-- conta: nasce sem banco, o membro grava, troca e limpa
with a as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Corrente', 'checking', 100.00, '2026-10-01') returning id)
  insert into fixture select 'c', id from a;
select is((select bank from public.accounts where id = pg_temp.fx('c')), null, 'BC1 conta nasce sem banco');

update public.accounts set bank = 'caixa' where id = pg_temp.fx('c');
select is((select bank from public.accounts where id = pg_temp.fx('c')), 'caixa', 'BC2 membro grava o banco da conta');
update public.accounts set bank = null where id = pg_temp.fx('c');
select is((select bank from public.accounts where id = pg_temp.fx('c')), null, 'BC3 limpar volta para sem banco');

with a as (insert into public.accounts (household_id, name, type, initial_balance, opening_date, bank)
           values (pg_temp.fx('h'), 'Poupança', 'savings', 0, '2026-10-01', 'nubank') returning id)
  insert into fixture select 'p', id from a;
select is((select bank from public.accounts where id = pg_temp.fx('p')), 'nubank', 'BC4 conta já pode nascer com banco');

select is(pg_temp.sqlstate_of(format('update public.accounts set bank = %L where id = %L', 'Caixa Econômica', pg_temp.fx('c'))), '23514',
          'BC5 banco fora do formato (maiúscula, acento, espaço) é recusado');
select is(pg_temp.sqlstate_of(format('update public.accounts set bank = %L where id = %L', 'x', pg_temp.fx('c'))), '23514',
          'BC6 chave curta demais é recusada');

with a as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Carteira', 'cash', 0, '2026-10-01') returning id)
  insert into fixture select 'cash', id from a;
select is(pg_temp.sqlstate_of(format('update public.accounts set bank = %L where id = %L', 'caixa', pg_temp.fx('cash'))), '23514',
          'BC7 carteira em dinheiro não tem banco');

-- Metadados da conta podem mudar independentemente do histórico financeiro.
update public.accounts set bank = 'itau' where id = pg_temp.fx('c');
select is((select bank from public.accounts where id = pg_temp.fx('c')), 'itau', 'BC8 conta aceita trocar o banco');

-- cartão
insert into fixture select 'k', public.create_debt('Cartão principal', 'card', '2026-10-01', 0);
select is((select (issuer, brand)::text from public.debts where id = pg_temp.fx('k')), '(,)', 'BC9 cartão nasce sem emissor e sem bandeira');

select public.set_card_identity(pg_temp.fx('k'), 'nubank', 'mastercard');
select is((select issuer || '|' || brand from public.debts where id = pg_temp.fx('k')), 'nubank|mastercard', 'BC10 grava emissor e bandeira');
select public.set_card_identity(pg_temp.fx('k'), 'nubank', null);
select is((select issuer || '|' || coalesce(brand, '-') from public.debts where id = pg_temp.fx('k')), 'nubank|-', 'BC11 limpar só a bandeira mantém o emissor');
select public.set_card_identity(pg_temp.fx('k'), null, null);
select is((select (issuer, brand)::text from public.debts where id = pg_temp.fx('k')), '(,)', 'BC12 limpar os dois');

select public.set_card_identity(pg_temp.fx('k'), 'nubank', 'elo');
select public.set_card_identity(pg_temp.fx('k'), 'nubank', 'elo');
select is((select issuer || '|' || brand from public.debts where id = pg_temp.fx('k')), 'nubank|elo', 'BC13 chamar duas vezes é idempotente');

select is(pg_temp.sqlstate_of(format('select public.set_card_identity(%L, %L, %L)', pg_temp.fx('k'), 'nubank', 'bitcoin')), '22023',
          'BC14 bandeira desconhecida é recusada');
select is(pg_temp.sqlstate_of(format('select public.set_card_identity(%L, %L, %L)', pg_temp.fx('k'), 'Nu Bank!', 'visa')), '22023',
          'BC15 emissor fora do formato é recusado');

insert into fixture select 'loan', public.create_debt('Empréstimo', 'loan', '2026-10-01', 1000);
select is(pg_temp.sqlstate_of(format('select public.set_card_identity(%L, %L, %L)', pg_temp.fx('loan'), 'caixa', 'visa')), '23514',
          'BC16 empréstimo não tem emissor nem bandeira');

-- privilégio: cliente não escreve direto em debts
select is(pg_temp.sqlstate_of(format('update public.debts set issuer = %L where id = %L', 'itau', pg_temp.fx('k'))), '42501',
          'BC17 o cliente não grava emissor direto na tabela (só pela função)');

-- outra família não mexe
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000024a2');
select is(pg_temp.sqlstate_of(format('select public.set_card_identity(%L, %L, %L)', pg_temp.fx('k'), 'itau', 'visa')), '42501',
          'BC18 quem não é da família não muda o cartão');
update public.accounts set bank = 'bradesco' where id = pg_temp.fx('p');
reset role;
select is((select bank from public.accounts where id = pg_temp.fx('p')), 'nubank', 'BC19 quem não é da família não muda o banco da conta (RLS)');

select * from finish();
rollback;
