-- 108_recurrence_nature_summary: resumo dos recorrentes por natureza (migration 20261112150000, recurrence_nature_summary).
-- Leitura pura: por natureza e por tipo (despesa em conta + cartão; receita) a contagem e o equivalente por mês, mais o total
-- do tipo ('all'). Mesma base do recurrence_summary: só em reais, transferência fora, equivalente
-- arredondado por regra. Prova ainda que o total por natureza fecha com o total do recurrence_summary e que a outra família
-- não vê nada. A função nova vai por SQL dinâmico: sem a migration as asserções falham, sem abortar o arquivo. Sem dado real.
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
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
-- as linhas como texto "natureza/tipo/qtde/total", numa ordem fixa
create function pg_temp.resumo(p_h uuid) returns text language plpgsql as $f$
declare r text;
begin
  execute $q$select coalesce(string_agg(concat_ws('/', nature, kind, item_count, total_monthly::numeric(14,2)), ' ; '
                                         order by kind, nature), '-')
               from public.recurrence_nature_summary($1)$q$ into r using p_h;
  return r;
exception when others then return 'erro: ' || sqlerrm;
end $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.anon(), pg_temp.hoje(), pg_temp.sqlstate_of(text),
  pg_temp.resumo(uuid) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000108001', 'ns1@teste.com'),
  ('00000000-0000-0000-0000-000000108002', 'ns2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-000000108001');
insert into fixture select 'h', public.create_household('Casa do resumo por natureza');
with a as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 1000.00, '2026-01-01') returning id)
  insert into fixture select 'bank', id from a;
with a as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Poupança', 'checking', 0, '2026-01-01') returning id)
  insert into fixture select 'bank2', id from a;
with a as (insert into public.accounts (household_id, name, type, initial_balance, opening_date, currency_code)
           values (pg_temp.fx('h'), 'Banco USD', 'checking', 100.00, '2026-01-01', 'USD') returning id)
  insert into fixture select 'usd', id from a;
insert into fixture select 'cexp', id from public.categories where household_id = pg_temp.fx('h') and type = 'expense' order by name limit 1;
insert into fixture select 'cinc', id from public.categories where household_id = pg_temp.fx('h') and type = 'income' order by name limit 1;
insert into fixture select 'card', public.create_debt('Cartão R', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('card'), 17, 25);

-- ---------------------------------------------------------------------------
-- Antes de qualquer regra: vazio
-- ---------------------------------------------------------------------------
select is(pg_temp.resumo(pg_temp.fx('h')), '-', 'N1 sem recorrentes: nenhuma linha');

-- despesa: Aluguel 1500 mensal (custo fixo), Seguro 1200 anual (variável = 100/mês), Internet 120 sem natureza,
-- Streaming 29,90 no cartão (assinatura), Taxa 50 em USD (fica fora), transferência (fica fora)
insert into fixture select 'aluguel', public.recurrence_create('expense', 'Aluguel', 1500.00, 5, pg_temp.hoje(), pg_temp.fx('bank'), null, null, pg_temp.fx('cexp'), null, 'month', 1);
insert into fixture select 'seguro', public.recurrence_create('expense', 'Seguro', 1200.00, 5, pg_temp.hoje(), pg_temp.fx('bank'), null, null, pg_temp.fx('cexp'), null, 'month', 12);
insert into fixture select 'internet', public.recurrence_create('expense', 'Internet', 120.00, 5, pg_temp.hoje(), pg_temp.fx('bank'), null, null, pg_temp.fx('cexp'), null, 'month', 1);
insert into fixture select 'stream', public.recurrence_create('card', 'Streaming', 29.90, 5, pg_temp.hoje(), null, null, pg_temp.fx('card'), pg_temp.fx('cexp'), null, 'month', 1);
insert into fixture select 'usdtaxa', public.recurrence_create('expense', 'Taxa USD', 50.00, 5, pg_temp.hoje(), pg_temp.fx('usd'), null, null, pg_temp.fx('cexp'), null, 'month', 1);
insert into fixture select 'trf', public.recurrence_create('transfer', 'Reserva', 100.00, 5, pg_temp.hoje(), pg_temp.fx('bank'), pg_temp.fx('bank2'), null, null, null, 'month', 1);
insert into fixture select 'reemb', public.recurrence_create('income', 'Reembolso plano', 250.50, 5, pg_temp.hoje(), pg_temp.fx('bank'), null, null, pg_temp.fx('cinc'), null, 'month', 1);
insert into fixture select 'salario', public.recurrence_create('income', 'Salário', 5000.00, 5, pg_temp.hoje(), pg_temp.fx('bank'), null, null, pg_temp.fx('cinc'), null, 'month', 1);
select public.recurrence_set_nature(pg_temp.fx('aluguel'), 'fixed');
select public.recurrence_set_nature(pg_temp.fx('seguro'), 'variable');
select public.recurrence_set_nature(pg_temp.fx('stream'), 'subscription');
select public.recurrence_set_nature(pg_temp.fx('usdtaxa'), 'fixed');
select public.recurrence_set_nature(pg_temp.fx('reemb'), 'reimbursement');

select is(pg_temp.resumo(pg_temp.fx('h')),
  'all/expense/4/1749.90 ; fixed/expense/1/1500.00 ; none/expense/1/120.00 ; subscription/expense/1/29.90 ; variable/expense/1/100.00 ; '
  || 'all/income/2/5250.50 ; none/income/1/5000.00 ; reimbursement/income/1/250.50',
  'N2 por natureza e tipo: anual vira 1/12, cartão entra na despesa, USD e transferência ficam fora, sem natureza = none');

-- o total do tipo ('all') fecha com o recurrence_summary (mesma base)
select is((select total_monthly::numeric(14,2) from public.recurrence_nature_summary(pg_temp.fx('h')) where nature = 'all' and kind = 'expense'),
          (select sum(total_monthly)::numeric(14,2) from public.recurrence_summary(pg_temp.fx('h')) where grouping_level = 'medium' and kind = 'expense'),
          'N3 total de despesa = recurrence_summary (conta + cartão)');
select is((select total_monthly::numeric(14,2) from public.recurrence_nature_summary(pg_temp.fx('h')) where nature = 'all' and kind = 'income'),
          (select sum(total_monthly)::numeric(14,2) from public.recurrence_summary(pg_temp.fx('h')) where grouping_level = 'medium' and kind = 'income'),
          'N4 total de receita = recurrence_summary');
-- a soma das naturezas fecha com o total do tipo
select is((select sum(total_monthly)::numeric(14,2) from public.recurrence_nature_summary(pg_temp.fx('h')) where nature <> 'all' and kind = 'expense'),
          (select total_monthly::numeric(14,2) from public.recurrence_nature_summary(pg_temp.fx('h')) where nature = 'all' and kind = 'expense'),
          'N5 soma das naturezas = total do tipo');

-- mudar a natureza move a regra de recorte e não mexe no total
select public.recurrence_set_nature(pg_temp.fx('internet'), 'fixed');
select is(pg_temp.resumo(pg_temp.fx('h')),
  'all/expense/4/1749.90 ; fixed/expense/2/1620.00 ; subscription/expense/1/29.90 ; variable/expense/1/100.00 ; '
  || 'all/income/2/5250.50 ; none/income/1/5000.00 ; reimbursement/income/1/250.50',
  'N6 classificar a Internet move 120 de none para fixed, sem mudar o total');

-- ---------------------------------------------------------------------------
-- Isolamento, anônimo e grants
-- ---------------------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-000000108002');
select is(pg_temp.resumo(pg_temp.fx('h')), '-', 'N8 outro usuário não vê o resumo da nossa família');
select pg_temp.anon();
select is(pg_temp.sqlstate_of($q$select * from public.recurrence_nature_summary(pg_temp.fx('h'))$q$), '42501', 'N9 anônimo sem execute');
select pg_temp.login('00000000-0000-0000-0000-000000108001');
select is(has_function_privilege('authenticated', 'public.recurrence_nature_summary(uuid)', 'execute'), true, 'N10 authenticated executa');
select is(has_function_privilege('anon', 'public.recurrence_nature_summary(uuid)', 'execute'), false, 'N11 anon não executa');

select * from finish();
rollback;
