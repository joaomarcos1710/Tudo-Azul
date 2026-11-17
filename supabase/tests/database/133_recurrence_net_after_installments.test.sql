-- 133_recurrence_net_after_installments: migration 141. "Sobra deste mês depois das parcelas" = a sobra dos recorrentes (140) menos as
-- parcelas que vencem no mês (installment_month_summary), só em reais. Prova: números fixos com data de corte explícita (não
-- depende do dia em que roda); parcela em dólar fica de fora; o mês mudando muda as parcelas; sem parcela a sobra "depois" é a
-- própria sobra; sem recorrente não há linha; fecha com as duas funções-base; outra família não vê nada; anônimo sem execute;
-- SECURITY INVOKER. Sem dado real. A função vai por SQL dinâmico: sem a migration as asserções falham sem abortar o arquivo.
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
-- "sobra dos recorrentes / parcelas do mês / sobra depois / mês de referência", ou '-' se não vier linha; 'erro: ...' se falhar
create function pg_temp.depois(p_h uuid, p_as_of date) returns text language plpgsql as $f$
declare r text;
begin
  execute $q$select coalesce(string_agg(concat_ws('/', net_monthly::numeric(14,2), installments_month::numeric(14,2),
                                                   net_after::numeric(14,2), ref_month), ' ; '), '-')
               from public.recurrence_net_after_installments($1, $2)$q$ into r using p_h, p_as_of;
  return r;
exception when others then return 'erro: ' || sqlstate || ' ' || sqlerrm;
end $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.anon(), pg_temp.hoje(), pg_temp.depois(uuid, date) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000133001', 'd1@teste133.com'),
  ('00000000-0000-0000-0000-000000133002', 'd2@teste133.com'),
  ('00000000-0000-0000-0000-000000133003', 'd3@teste133.com'),
  ('00000000-0000-0000-0000-000000133004', 'd4@teste133.com');

-- Família 1: salário 5000,00 e aluguel 1500,00 por mês (sobra dos recorrentes: 3500,00)
select pg_temp.login('00000000-0000-0000-0000-000000133001');
insert into fixture select 'h', public.create_household('Casa das parcelas');
with a as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 1000.00, '2020-01-01') returning id)
  insert into fixture select 'bank', id from a;
with a as (insert into public.accounts (household_id, name, type, initial_balance, opening_date, currency_code)
           values (pg_temp.fx('h'), 'Banco USD', 'checking', 100.00, '2020-01-01', 'USD') returning id)
  insert into fixture select 'usd', id from a;
insert into fixture select 'cexp', id from public.categories where household_id = pg_temp.fx('h') and type = 'expense' order by name limit 1;
insert into fixture select 'cinc', id from public.categories where household_id = pg_temp.fx('h') and type = 'income' order by name limit 1;
insert into fixture select 'salario', public.recurrence_create('income', 'Salário', 5000.00, 5, pg_temp.hoje(), pg_temp.fx('bank'), null, null, pg_temp.fx('cinc'), null, 'month', 1);
insert into fixture select 'aluguel', public.recurrence_create('expense', 'Aluguel', 1500.00, 5, pg_temp.hoje(), pg_temp.fx('bank'), null, null, pg_temp.fx('cexp'), null, 'month', 1);

select is(pg_temp.depois(pg_temp.fx('h'), date '2026-11-12'), '3500.00/0.00/3500.00/2026-11-01',
  'P1 sem parcelas: a sobra "depois" é a própria sobra dos recorrentes (3500,00)');

-- Sofá: 5 parcelas de 100,00 a partir de 12/11/2026; Futuro: 3 parcelas de 100,00 a partir de 05/12/2026; USD: 3 parcelas em dólar
select public.transaction_installments_create('expense', 'Sofá', 500, 5, 'month', 1, '2026-11-12', pg_temp.fx('bank'), null, pg_temp.fx('cexp'), false);
select public.transaction_installments_create('expense', 'Futuro', 300, 3, 'month', 1, '2026-12-05', pg_temp.fx('bank'), null, pg_temp.fx('cexp'), false);
select public.transaction_installments_create('expense', 'Em dólar', 300, 3, 'month', 1, '2026-11-20', pg_temp.fx('usd'), null, pg_temp.fx('cexp'), false);

select is(pg_temp.depois(pg_temp.fx('h'), date '2026-11-12'), '3500.00/100.00/3400.00/2026-11-01',
  'P2 novembro: o Sofá vence 100,00 (a parcela em dólar não entra): sobra de 3500,00 vira 3400,00');
select is(pg_temp.depois(pg_temp.fx('h'), date '2026-12-10'), '3500.00/200.00/3300.00/2026-12-01',
  'P3 dezembro: Sofá e Futuro vencem 100,00 cada: parcelas 200,00 e sobra 3300,00 (muda de mês para mês)');
select is((select installments_month from public.recurrence_net_after_installments(pg_temp.fx('h'), date '2026-11-12')),
          (select month_total from public.installment_month_summary(pg_temp.fx('h'), date '2026-11-12') where currency_code = 'BRL'),
  'P4 as parcelas do mês fecham com installment_month_summary (a base do card "Parcelas e carnês")');
select is((select net_monthly from public.recurrence_net_after_installments(pg_temp.fx('h'), date '2026-11-12')),
          (select net_monthly from public.recurrence_net(pg_temp.fx('h'))),
  'P5 a sobra dos recorrentes é a mesma do card do topo (recurrence_net)');
select is(pg_temp.depois(pg_temp.fx('h'), null), (select string_agg(concat_ws('/', net_monthly::numeric(14,2), installments_month::numeric(14,2),
                                                net_after::numeric(14,2), ref_month), ' ; ') from public.recurrence_net_after_installments(pg_temp.fx('h'), pg_temp.hoje())),
  'P6 sem data de corte vale o mês de hoje (São Paulo)');

-- Família 2: parcela maior do que a sobra: negativa (falta)
select pg_temp.login('00000000-0000-0000-0000-000000133002');
insert into fixture select 'h2', public.create_household('Casa do aperto');
with a as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h2'), 'Banco', 'checking', 0, '2020-01-01') returning id)
  insert into fixture select 'bank2', id from a;
insert into fixture select 'cexp2', id from public.categories where household_id = pg_temp.fx('h2') and type = 'expense' order by name limit 1;
insert into fixture select 'cinc2', id from public.categories where household_id = pg_temp.fx('h2') and type = 'income' order by name limit 1;
insert into fixture select 'sal2', public.recurrence_create('income', 'Salário', 1000.00, 5, pg_temp.hoje(), pg_temp.fx('bank2'), null, null, pg_temp.fx('cinc2'), null, 'month', 1);
select public.transaction_installments_create('expense', 'TV', 3000, 3, 'month', 1, '2026-11-12', pg_temp.fx('bank2'), null, pg_temp.fx('cexp2'), false);
select is(pg_temp.depois(pg_temp.fx('h2'), date '2026-11-12'), '1000.00/1000.00/0.00/2026-11-01', 'N1 parcela igual à sobra: sobra depois 0,00');
select public.transaction_installments_create('expense', 'Geladeira', 600, 3, 'month', 1, '2026-11-15', pg_temp.fx('bank2'), null, pg_temp.fx('cexp2'), false);
select is(pg_temp.depois(pg_temp.fx('h2'), date '2026-11-12'), '1000.00/1200.00/-200.00/2026-11-01', 'N2 parcelas passam da sobra: negativa (−200,00)');

-- Família 3: só parcelas, sem recorrente: nenhuma linha (a tela não mostra a sobra)
select pg_temp.login('00000000-0000-0000-0000-000000133003');
insert into fixture select 'h3', public.create_household('Casa só com parcelas');
with a as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h3'), 'Banco', 'checking', 0, '2020-01-01') returning id)
  insert into fixture select 'bank3', id from a;
insert into fixture select 'cexp3', id from public.categories where household_id = pg_temp.fx('h3') and type = 'expense' order by name limit 1;
select public.transaction_installments_create('expense', 'Notebook', 300, 3, 'month', 1, '2026-11-12', pg_temp.fx('bank3'), null, pg_temp.fx('cexp3'), false);
select is(pg_temp.depois(pg_temp.fx('h3'), date '2026-11-12'), '-', 'N3 sem recorrente vigente: nenhuma linha');

-- Isolamento: quem não é da família não vê nada de nenhuma
select pg_temp.login('00000000-0000-0000-0000-000000133004');
select is(pg_temp.depois(pg_temp.fx('h'), date '2026-11-12'), '-', 'S1 quem não é da família não vê a sobra dela');
select is(pg_temp.depois(pg_temp.fx('h2'), date '2026-11-12'), '-', 'S2 nem a da outra');

-- Privilégios
select pg_temp.anon();
select ok(not has_function_privilege('anon', 'public.recurrence_net_after_installments(uuid, date)', 'EXECUTE'), 'V1 anon sem EXECUTE');
select pg_temp.login('00000000-0000-0000-0000-000000133001');
select ok(has_function_privilege('authenticated', 'public.recurrence_net_after_installments(uuid, date)', 'EXECUTE'), 'V2 authenticated com EXECUTE');
select ok(not (select prosecdef from pg_proc where oid = 'public.recurrence_net_after_installments(uuid, date)'::regprocedure), 'V3 SECURITY INVOKER');

select * from finish();
rollback;
