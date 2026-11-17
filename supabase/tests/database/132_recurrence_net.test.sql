-- 132_recurrence_net: migration 140. A "sobra por mês" dos recorrentes (entra − sai), somada no banco, da mesma base de
-- recurrence_overview (recorte 'all'). Prova: números fixos (mensal e anual exatos, PLR de 6 em 6 meses), despesa de cartão
-- entra, USD e transferência ficam fora, sobra negativa quando sai mais do que entra, sem recorrente = nenhuma linha, fecha com
-- a visão geral, outra família não vê nada, anônimo sem execute, SECURITY INVOKER. A função vai por SQL dinâmico: sem a
-- migration as asserções falham sem abortar o arquivo. Sem dado real.
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
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);
end $f$;
create function pg_temp.hoje() returns date language sql stable as $f$ select (now() at time zone 'America/Sao_Paulo')::date $f$;
-- "entra/sai/sobra mês/sobra ano" da família, ou '-' se não vier linha; 'erro: ...' se a função falhar ou não existir
create function pg_temp.sobra(p_h uuid) returns text language plpgsql as $f$
declare r text;
begin
  execute $q$select coalesce(string_agg(concat_ws('/', income_monthly::numeric(14,2), expense_monthly::numeric(14,2),
                                                   net_monthly::numeric(14,2), net_yearly::numeric(14,2)), ' ; '), '-')
               from public.recurrence_net($1)$q$ into r using p_h;
  return r;
exception when others then return 'erro: ' || sqlerrm;
end $f$;
-- a diferença feita aqui, a partir da própria visão geral, para provar que as duas fecham
create function pg_temp.sobra_da_visao(p_h uuid) returns numeric language plpgsql as $f$
declare r numeric;
begin
  execute $q$select coalesce(sum(total_monthly) filter (where kind = 'income'), 0) - coalesce(sum(total_monthly) filter (where kind = 'expense'), 0)
               from public.recurrence_overview($1) where klass = 'all'$q$ into r using p_h;
  return r;
end $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.anon(), pg_temp.hoje(), pg_temp.sobra(uuid), pg_temp.sobra_da_visao(uuid) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000132001', 'n1@teste132.com'),
  ('00000000-0000-0000-0000-000000132002', 'n2@teste132.com'),
  ('00000000-0000-0000-0000-000000132003', 'n3@teste132.com');

-- Família 1: receitas 5000,00/mês e PLR de 3000,00 a cada 6 meses; despesas 1500,00/mês e 29,90/mês no cartão; USD e transferência fora
select pg_temp.login('00000000-0000-0000-0000-000000132001');
insert into fixture select 'h', public.create_household('Casa da sobra');
with a as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 1000.00, '2020-01-01') returning id)
  insert into fixture select 'bank', id from a;
with a as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Poupança', 'checking', 0, '2020-01-01') returning id)
  insert into fixture select 'bank2', id from a;
with a as (insert into public.accounts (household_id, name, type, initial_balance, opening_date, currency_code)
           values (pg_temp.fx('h'), 'Banco USD', 'checking', 100.00, '2020-01-01', 'USD') returning id)
  insert into fixture select 'usd', id from a;
insert into fixture select 'cexp', id from public.categories where household_id = pg_temp.fx('h') and type = 'expense' order by name limit 1;
insert into fixture select 'cinc', id from public.categories where household_id = pg_temp.fx('h') and type = 'income' order by name limit 1;
insert into fixture select 'card', public.create_debt('Cartão R', 'card', '2020-01-01', 0);
select public.set_card_cycle(pg_temp.fx('card'), 17, 25);

select is(pg_temp.sobra(pg_temp.fx('h')), '-', 'N1 sem recorrentes: nenhuma linha (a tela não mostra sobra)');

insert into fixture select 'salario', public.recurrence_create('income', 'Salário', 5000.00, 5, pg_temp.hoje(), pg_temp.fx('bank'), null, null, pg_temp.fx('cinc'), null, 'month', 1);
insert into fixture select 'plr', public.recurrence_create('income', 'PLR', 3000.00, 5, pg_temp.hoje(), pg_temp.fx('bank'), null, null, pg_temp.fx('cinc'), null, 'month', 6);
insert into fixture select 'aluguel', public.recurrence_create('expense', 'Aluguel', 1500.00, 5, pg_temp.hoje(), pg_temp.fx('bank'), null, null, pg_temp.fx('cexp'), null, 'month', 1);
insert into fixture select 'stream', public.recurrence_create('card', 'Streaming', 29.90, 5, pg_temp.hoje(), null, null, pg_temp.fx('card'), pg_temp.fx('cexp'), null, 'month', 1);
-- ficam fora: conta em dólar e transferência
insert into fixture select 'usdtaxa', public.recurrence_create('expense', 'Taxa USD', 50.00, 5, pg_temp.hoje(), pg_temp.fx('usd'), null, null, pg_temp.fx('cexp'), null, 'month', 1);
insert into fixture select 'trf', public.recurrence_create('transfer', 'Reserva', 100.00, 5, pg_temp.hoje(), pg_temp.fx('bank'), pg_temp.fx('bank2'), null, null, null, 'month', 1);

-- Entra: 5000 + 3000/6 = 5500,00 por mês e 5000×12 + 3000×2 = 66000,00 por ano. Sai: 1500 + 29,90 = 1529,90 por mês e 1500×12 + 29,90×12 = 18358,80.
select is(pg_temp.sobra(pg_temp.fx('h')), '5500.00/1529.90/3970.10/47641.20',
  'N2 entra 5500,00 e sai 1529,90 por mês: sobra 3970,10 por mês e 47641,20 por ano (anual exato, não 12 × o mensal)');
select is(pg_temp.sobra_da_visao(pg_temp.fx('h')), 3970.10::numeric, 'N3 fecha com a visão geral (recurrence_overview): a mesma base');

-- Ao encerrar um recorrente, a sobra acompanha
select public.recurrence_end(pg_temp.fx('stream'), (pg_temp.hoje() - 1));
select is(pg_temp.sobra(pg_temp.fx('h')), '5500.00/1500.00/4000.00/48000.00', 'N4 recorrente encerrado sai da conta: sobra 4000,00 por mês');

-- Família 2: só despesa, então a sobra é negativa
select pg_temp.login('00000000-0000-0000-0000-000000132002');
insert into fixture select 'h2', public.create_household('Casa do aperto');
with a as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h2'), 'Banco', 'checking', 0, '2020-01-01') returning id)
  insert into fixture select 'bank_b', id from a;
insert into fixture select 'cexp_b', id from public.categories where household_id = pg_temp.fx('h2') and type = 'expense' order by name limit 1;
insert into fixture select 'luz', public.recurrence_create('expense', 'Luz', 100.00, 5, pg_temp.hoje(), pg_temp.fx('bank_b'), null, null, pg_temp.fx('cexp_b'), null, 'month', 1);
select is(pg_temp.sobra(pg_temp.fx('h2')), '0.00/100.00/-100.00/-1200.00', 'N5 só despesa: sobra negativa (−100,00 por mês, −1200,00 por ano)');

-- Isolamento: outra família não vê nada de nenhuma
select pg_temp.login('00000000-0000-0000-0000-000000132003');
select is(pg_temp.sobra(pg_temp.fx('h')), '-', 'S1 quem não é da família não vê a sobra dela');
select is(pg_temp.sobra(pg_temp.fx('h2')), '-', 'S2 nem a da outra');

-- Privilégios
select pg_temp.anon();
select ok(not has_function_privilege('anon', 'public.recurrence_net(uuid)', 'EXECUTE'), 'P1 anon sem EXECUTE');
select pg_temp.login('00000000-0000-0000-0000-000000132001');
select ok(has_function_privilege('authenticated', 'public.recurrence_net(uuid)', 'EXECUTE'), 'P2 authenticated com EXECUTE');
select ok(not (select prosecdef from pg_proc where oid = 'public.recurrence_net(uuid)'::regprocedure), 'P3 SECURITY INVOKER');

select * from finish();
rollback;
