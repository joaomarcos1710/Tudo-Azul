-- 125_debt_history_monthly: migration 133. Saldo das dívidas mês a mês, sem cartão: uma linha por empréstimo/financiamento
-- que já existia no fim do mês, mais o total do mês (somado no banco). Mês antes do cadastro não aparece (vazio, não zero).
-- A função nova vai por SQL dinâmico: sem a migration as asserções falham sem abortar.
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
-- "mês|data|nome|saldo" na ordem do banco
create function pg_temp.hist(p_h uuid, p_ate date, p_n integer) returns text[] language plpgsql as $f$
declare r text[];
begin
  execute 'select coalesce(array_agg(month || ''|'' || as_of || ''|'' || name || ''|'' || debt::numeric(14,2) order by ord), ''{}'')
             from (select h.*, row_number() over () as ord from public.debt_history_monthly($1, $2, $3) h) q'
    into r using p_h, p_ate, p_n;
  return r;
exception when others then return array['ERRO ' || sqlstate];
end $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.sqlstate_of(text), pg_temp.hist(uuid, date, integer) to public;

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000125a1', 'hist1@teste.com', now()),
  ('00000000-0000-0000-0000-0000000125a2', 'hist2@teste.com', now());

select pg_temp.login('00000000-0000-0000-0000-0000000125a1');
insert into fixture select 'h', public.create_household('Casa do Histórico');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Corrente', 'checking', 50000, date '2026-01-01') returning id)
  insert into fixture select 'conta', id from i;
insert into fixture select 'cat', id from public.categories where household_id = pg_temp.fx('h') and name = 'Mercado';
-- empréstimo cadastrado em 15/08 (1.000); financiamento em 10/09 (5.000); cartão com compra (não entra)
insert into fixture select 'emp', public.create_debt('Empréstimo', 'loan', date '2026-08-15', 1000);
insert into fixture select 'fin', public.create_debt('Financiamento', 'financing', date '2026-09-10', 5000);
insert into fixture select 'cartao', public.create_debt('Cartão', 'card', date '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('cartao'), 18, 25);
select public.card_purchase(pg_temp.fx('cartao'), date '2026-09-05', 300.00, 1, pg_temp.fx('cat'), 'Compra');
-- pagamento de 200 do empréstimo em 20/09; correção do financiamento pelo extrato em 05/11 para 5.100
select public.debt_record_payment(pg_temp.fx('emp'), date '2026-09-20', pg_temp.fx('conta'), 200);
select public.debt_set_balance(pg_temp.fx('fin'), date '2026-11-05', 5100);

-- ---------------------------------------------------------------------------
-- 1. Quatro meses até 20/11/2026
-- ---------------------------------------------------------------------------
select is(pg_temp.hist(pg_temp.fx('h'), date '2026-11-20', 4), array[
  '2026-08|2026-08-31|Empréstimo|1000.00',
  '2026-08|2026-08-31|Total|1000.00',
  '2026-09|2026-09-30|Empréstimo|800.00',
  '2026-09|2026-09-30|Financiamento|5000.00',
  '2026-09|2026-09-30|Total|5800.00',
  '2026-10|2026-10-31|Empréstimo|800.00',
  '2026-10|2026-10-31|Financiamento|5000.00',
  '2026-10|2026-10-31|Total|5800.00',
  '2026-11|2026-11-20|Empréstimo|800.00',
  '2026-11|2026-11-20|Financiamento|5100.00',
  '2026-11|2026-11-20|Total|5900.00'],
  'H1 cada dívida no fim do mês (o mês atual até a data pedida); o financiamento só a partir de setembro (cadastro); '
  'o pagamento e a correção pelo extrato entram; o cartão fica de fora; o total é somado no banco');
select is(pg_temp.hist(pg_temp.fx('h'), date '2026-07-31', 2), '{}'::text[],
  'H2 antes de qualquer cadastro: nenhuma linha (nem total zero)');
select is((select count(*)::int from public.debt_history_monthly(pg_temp.fx('h'), date '2026-11-20', 12)), 11,
  'H3 doze meses: só os meses com dívida têm linhas (os anteriores ficam vazios)');

-- ---------------------------------------------------------------------------
-- 2. Período inválido, privilégios e isolamento
-- ---------------------------------------------------------------------------
select is(pg_temp.hist(pg_temp.fx('h'), null, 12), array['ERRO 22023'], 'V1 data nula: recusada');
select is(pg_temp.hist(pg_temp.fx('h'), date '2026-11-20', 0), array['ERRO 22023'], 'V2 zero meses: recusado');
select is(pg_temp.hist(pg_temp.fx('h'), date '2026-11-20', 37), array['ERRO 22023'], 'V3 mais de 36 meses: recusado');
select ok(not has_function_privilege('anon', 'public.debt_history_monthly(uuid, date, integer)', 'EXECUTE'), 'V4 anon sem EXECUTE');
select ok(has_function_privilege('authenticated', 'public.debt_history_monthly(uuid, date, integer)', 'EXECUTE'), 'V5 authenticated com EXECUTE');
select ok(not (select prosecdef from pg_proc where oid = 'public.debt_history_monthly(uuid, date, integer)'::regprocedure), 'V6 SECURITY INVOKER');

select pg_temp.login('00000000-0000-0000-0000-0000000125a2');
insert into fixture select 'h2', public.create_household('Outra casa');
insert into fixture select 'emp2', public.create_debt('Da outra casa', 'loan', date '2026-08-01', 777);
select is(pg_temp.hist(pg_temp.fx('h'), date '2026-11-20', 4), '{}'::text[], 'S1 outra família não vê as dívidas desta');
select is(pg_temp.hist(pg_temp.fx('h2'), date '2026-08-31', 1), array['2026-08|2026-08-31|Da outra casa|777.00', '2026-08|2026-08-31|Total|777.00'],
  'S2 cada família vê só as suas, sem mistura');

select * from finish();
rollback;
