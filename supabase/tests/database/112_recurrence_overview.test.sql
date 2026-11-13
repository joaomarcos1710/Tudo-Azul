-- 112_recurrence_overview: visão geral dos recorrentes por mês e por ano, e fixo × variável (migration 20261113120000).
-- Leitura pura. Prova: o por ano é valor × ocorrências por ano (não 12 × o mensal arredondado); a natureza marcada vence a sugestão;
-- sem natureza, o histórico das últimas cobranças pagas decide (valores diferentes = variável; iguais ou sem histórico = fixo);
-- cartão e conta entram juntos na despesa; USD e transferência ficam fora; o total fecha com recurrence_summary; outra família
-- não vê nada; anônimo sem execute. Sem dado real.
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
-- as linhas como texto "tipo/recorte/qtde/sugeridas/mensal/anual"
create function pg_temp.visao(p_h uuid) returns text language plpgsql as $f$
declare r text;
begin
  execute $q$select coalesce(string_agg(concat_ws('/', kind, klass, item_count, suggested_count, total_monthly::numeric(14,2), total_yearly::numeric(14,2)), ' ; '
                                         order by kind, array_position(array['all','fixed','variable'], klass)), '-')
               from public.recurrence_overview($1)$q$ into r using p_h;
  return r;
exception when others then return 'erro: ' || sqlerrm;
end $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.anon(), pg_temp.hoje(), pg_temp.sqlstate_of(text),
  pg_temp.visao(uuid) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000112001', 'ov1@teste.com'),
  ('00000000-0000-0000-0000-000000112002', 'ov2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-000000112001');
insert into fixture select 'h', public.create_household('Casa da visão geral');
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

select is(pg_temp.visao(pg_temp.fx('h')), '-', 'V1 sem recorrentes: nenhuma linha');

-- despesas (começo no passado só onde o histórico decide a sugestão)
insert into fixture select 'aluguel', public.recurrence_create('expense', 'Aluguel', 1500.00, 5, (pg_temp.hoje() - interval '3 months')::date, pg_temp.fx('bank'), null, null, pg_temp.fx('cexp'), null, 'month', 1);
insert into fixture select 'luz', public.recurrence_create('expense', 'Luz', 180.00, 5, (pg_temp.hoje() - interval '3 months')::date, pg_temp.fx('bank'), null, null, pg_temp.fx('cexp'), null, 'month', 1);
insert into fixture select 'internet', public.recurrence_create('expense', 'Internet', 120.00, 5, (pg_temp.hoje() - interval '3 months')::date, pg_temp.fx('bank'), null, null, pg_temp.fx('cexp'), null, 'month', 1);
insert into fixture select 'seguro', public.recurrence_create('expense', 'Seguro', 1200.00, 5, pg_temp.hoje(), pg_temp.fx('bank'), null, null, pg_temp.fx('cexp'), null, 'month', 12);
insert into fixture select 'stream', public.recurrence_create('card', 'Streaming', 29.90, 5, pg_temp.hoje(), null, null, pg_temp.fx('card'), pg_temp.fx('cexp'), null, 'month', 1);
insert into fixture select 'stream2', public.recurrence_create('card', 'Outro streaming', 40.00, 5, pg_temp.hoje(), null, null, pg_temp.fx('card'), pg_temp.fx('cexp'), null, 'month', 1);
insert into fixture select 'feira', public.recurrence_create('expense', 'Feira', 100.00, null, pg_temp.hoje(), pg_temp.fx('bank'), null, null, pg_temp.fx('cexp'), null, 'week', 1);
insert into fixture select 'plano7', public.recurrence_create('expense', 'Plano de 7 meses', 100.00, 5, pg_temp.hoje(), pg_temp.fx('bank'), null, null, pg_temp.fx('cexp'), null, 'month', 7);
insert into fixture select 'usdtaxa', public.recurrence_create('expense', 'Taxa USD', 50.00, 5, pg_temp.hoje(), pg_temp.fx('usd'), null, null, pg_temp.fx('cexp'), null, 'month', 1);
insert into fixture select 'trf', public.recurrence_create('transfer', 'Reserva', 100.00, 5, pg_temp.hoje(), pg_temp.fx('bank'), pg_temp.fx('bank2'), null, null, null, 'month', 1);
-- receitas
insert into fixture select 'salario', public.recurrence_create('income', 'Salário', 5000.00, 5, pg_temp.hoje(), pg_temp.fx('bank'), null, null, pg_temp.fx('cinc'), null, 'month', 1);
insert into fixture select 'plr', public.recurrence_create('income', 'PLR', 3000.00, 5, pg_temp.hoje(), pg_temp.fx('bank'), null, null, pg_temp.fx('cinc'), null, 'month', 6);
select public.recurrence_set_nature(pg_temp.fx('internet'), 'variable');
select public.recurrence_set_nature(pg_temp.fx('stream'), 'subscription');

-- gera as ocorrências e dá histórico: Aluguel pago sempre 1500; Luz paga com valores diferentes; Internet (natureza variável) com valor igual
select public.recurrence_materialize();
update public.transactions set status = 'paid', amount = 1500.00 where recurrence_id = pg_temp.fx('aluguel') and date <= pg_temp.hoje();
with t as (select id, row_number() over (order by date) as rn from public.transactions where recurrence_id = pg_temp.fx('luz') and date <= pg_temp.hoje())
  update public.transactions x set status = 'paid', amount = 150.00 + t.rn * 10 from t where x.id = t.id;
update public.transactions set status = 'paid', amount = 120.00 where recurrence_id = pg_temp.fx('internet') and date <= pg_temp.hoje();

select ok((select count(*) from public.transactions where recurrence_id = pg_temp.fx('luz') and status = 'paid') >= 2,
  'V2 pré-condição: a Luz tem pelo menos duas cobranças pagas');
select ok((select count(distinct amount) from public.transactions where recurrence_id = pg_temp.fx('luz') and status = 'paid') > 1,
  'V3 pré-condição: valores diferentes na Luz');

-- todas: 8 despesas (conta + cartão; o 'Outro streaming' no cartão, sem natureza, é sugestão de fixo pelo histórico das parcelas), 2 receitas. Mensal e anual por regra: Aluguel 1500/18000, Luz 180/2160, Internet 120/1440,
-- Seguro 100/1200, Streaming 29,90/358,80, Outro streaming 40/480, Feira 433,33/5200, Plano 14,29/171,43.
-- fixo: Aluguel (sug.), Seguro (sug.), Streaming (manual), Outro streaming (sug.), Feira (sug.), Plano (sug.) = 6, 5 sugeridas
-- variável: Luz (sug., histórico), Internet (manual) = 2, 1 sugerida
select is(pg_temp.visao(pg_temp.fx('h')),
  'expense/all/8/6/2417.52/29010.23 ; expense/fixed/6/5/2117.52/25410.23 ; expense/variable/2/1/300.00/3600.00 ; '
  || 'income/all/2/0/5500.00/66000.00',
  'V4 mês e ano por tipo; fixo × variável (natureza vence, histórico sugere); USD e transferência fora; receita só o total');

-- o por ano NÃO é 12 × o mensal arredondado: Plano de 7 meses = 100 × 12 ÷ 7 = 171,43, e 12 × 14,29 = 171,48
select is((select total_yearly::numeric(14,2) from public.recurrence_overview(pg_temp.fx('h')) where kind = 'expense' and klass = 'all')
          - (select 12 * total_monthly::numeric(14,2) from public.recurrence_overview(pg_temp.fx('h')) where kind = 'expense' and klass = 'all'),
          29010.23 - 12 * 2417.52,
          'V5 o anual vem do valor × ocorrências por ano, não de 12 × o mensal');
select is((select total_yearly::numeric(14,2) from public.recurrence_overview(pg_temp.fx('h')) where kind = 'expense' and klass = 'all'),
          29010.23::numeric(14,2), 'V6 anual da despesa');

-- fixo + variável = total; o mensal fecha com o recurrence_summary e com recurrence_nature_summary
select is((select sum(total_monthly)::numeric(14,2) from public.recurrence_overview(pg_temp.fx('h')) where kind = 'expense' and klass in ('fixed','variable')),
          (select total_monthly::numeric(14,2) from public.recurrence_overview(pg_temp.fx('h')) where kind = 'expense' and klass = 'all'),
          'V7 fixo + variável = total da despesa');
select is((select total_monthly::numeric(14,2) from public.recurrence_overview(pg_temp.fx('h')) where kind = 'expense' and klass = 'all'),
          (select sum(total_monthly)::numeric(14,2) from public.recurrence_summary(pg_temp.fx('h')) where grouping_level = 'medium' and kind = 'expense'),
          'V8 mensal da despesa = recurrence_summary');
select is((select total_monthly::numeric(14,2) from public.recurrence_overview(pg_temp.fx('h')) where kind = 'income' and klass = 'all'),
          (select sum(total_monthly)::numeric(14,2) from public.recurrence_summary(pg_temp.fx('h')) where grouping_level = 'medium' and kind = 'income'),
          'V9 mensal da receita = recurrence_summary');

-- a natureza marcada vence a sugestão: marcar a Luz como "fixo" (custo fixo) tira a sugestão e move para fixo
select public.recurrence_set_nature(pg_temp.fx('luz'), 'fixed');
select is(pg_temp.visao(pg_temp.fx('h')),
  'expense/all/8/5/2417.52/29010.23 ; expense/fixed/7/5/2297.52/27570.23 ; expense/variable/1/0/120.00/1440.00 ; '
  || 'income/all/2/0/5500.00/66000.00',
  'V10 marcar a Luz como custo fixo move 180 para fixo e ela deixa de ser sugestão');

-- regra encerrada (data final passada) sai
select public.recurrence_delete(pg_temp.fx('plano7'));
select is((select item_count from public.recurrence_overview(pg_temp.fx('h')) where kind = 'expense' and klass = 'all'), 7,
  'V11 regra excluída sai da visão');

-- isolamento, anônimo e grants
select pg_temp.login('00000000-0000-0000-0000-000000112002');
select is(pg_temp.visao(pg_temp.fx('h')), '-', 'V12 outro usuário não vê a visão da nossa família');
select pg_temp.anon();
select is(pg_temp.sqlstate_of($q$select * from public.recurrence_overview(pg_temp.fx('h'))$q$), '42501', 'V13 anônimo sem execute');
select pg_temp.login('00000000-0000-0000-0000-000000112001');
select is(has_function_privilege('authenticated', 'public.recurrence_overview(uuid)', 'execute'), true, 'V14 authenticated executa');
select is(has_function_privilege('anon', 'public.recurrence_overview(uuid)', 'execute'), false, 'V15 anon não executa');

select * from finish();
rollback;
