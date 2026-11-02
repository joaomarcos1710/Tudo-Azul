-- 40_investment_distributions: migration 035. Proventos como receita na conta, ligados ao ativo, sem dupla contagem.
-- Datas relativas a hoje em São Paulo (provento pago não pode ser futuro); nada depende de data fixa.
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
-- "ativo:recebido/previsto" de cada linha do relatório do período
create function pg_temp.rel() returns text language sql as $f$
  select string_agg(name || ':' || received::numeric(14,2) || '/' || planned::numeric(14,2), ' ' order by name)
    from public.investment_income_by_asset(pg_temp.fx('h'), pg_temp.hoje() - 60, pg_temp.hoje() + 60) $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.hoje(), pg_temp.sqlstate_of(text), pg_temp.rel() to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000040a1', 'p1@teste.com'),
  ('00000000-0000-0000-0000-0000000040a2', 'p2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000040a1');
insert into fixture select 'h', public.create_household('Casa Proventos');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Corretora', 'checking', 1000, pg_temp.hoje() - 90) returning id)
  insert into fixture select 'conta', id from i;
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date, active)
           values (pg_temp.fx('h'), 'Conta antiga', 'checking', 0, pg_temp.hoje() - 90, false) returning id)
  insert into fixture select 'inativa', id from i;
insert into fixture select 'fii', public.investment_asset_create(pg_temp.fx('h'), 'FII Z', 'ZZZZ11', 'reit', 'BRL');
insert into fixture select 'acao', public.investment_asset_create(pg_temp.fx('h'), 'Ação Y', 'AAAA3', 'equity', 'BRL');
insert into fixture select 'usa', public.investment_asset_create(pg_temp.fx('h'), 'ETF Global', 'GLOB', 'etf', 'USD');
insert into fixture select 'rend', id from public.categories where household_id = pg_temp.fx('h') and name = 'Rendimentos' and type = 'income';
insert into fixture select 'sal', id from public.categories where household_id = pg_temp.fx('h') and name = 'Salário' and type = 'income';

-- A1 provento pago: vira receita na conta, categoria Rendimentos, descrição com o ativo, e vínculo com o ativo
insert into fixture select 'p1', public.investment_distribution_record(pg_temp.fx('fii'), 'dividend', pg_temp.hoje() - 10, 120.50, pg_temp.fx('conta'));
select is((select type || '|' || status || '|' || amount::numeric(14,2) || '|' || description || '|' || (category_id = pg_temp.fx('rend'))
             from public.transactions where id = pg_temp.fx('p1')),
          'income|paid|120.50|Dividendos · FII Z|true', 'A1 vira receita paga na categoria Rendimentos');
select is((select kind from public.investment_distributions where transaction_id = pg_temp.fx('p1')), 'dividend', 'A1.1 vínculo com o tipo');

-- A2 saldo da conta sobe uma vez só (1000 inicial + 120,50)
select is((select balance::numeric(14,2) from public.account_balances(pg_temp.fx('h'), pg_temp.hoje()) where account_id = pg_temp.fx('conta')),
          1120.50::numeric, 'A2 o saldo da conta subiu 120,50, uma vez');

-- B1 planejado e outros tipos
insert into fixture select 'p2', public.investment_distribution_record(pg_temp.fx('fii'), 'income', pg_temp.hoje() + 5, 30.00, pg_temp.fx('conta'), 'planned');
insert into fixture select 'p3', public.investment_distribution_record(pg_temp.fx('acao'), 'jcp', pg_temp.hoje() - 3, 85.00, pg_temp.fx('conta'), 'paid', 'JCP líquido');
select is(pg_temp.rel(), 'Ação Y:85.00/0.00 FII Z:120.50/30.00', 'B1 recebido só do pago, previsto só do planejado, por ativo');
select is((select balance::numeric(14,2) from public.account_balances(pg_temp.fx('h'), pg_temp.hoje()) where account_id = pg_temp.fx('conta')),
          1205.50::numeric, 'B1.1 planejado não mexe no saldo de hoje (1000 + 120,50 + 85)');

-- C1 sem dupla contagem: o provento está UMA vez em period_summary
select is((select income_paid from public.period_summary(pg_temp.fx('h'), pg_temp.hoje() - 60, pg_temp.hoje() + 60)),
          205.50::numeric, 'C1 period_summary.income_paid = 120,50 + 85 (cada provento uma vez)');
insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status)
  values (pg_temp.fx('h'), pg_temp.fx('conta'), pg_temp.fx('sal'), 'income', 'Salário', 1000.00, pg_temp.hoje() - 2, 'paid');
select is((select sum(received) from public.investment_income_by_asset(pg_temp.fx('h'), pg_temp.hoje() - 60, pg_temp.hoje() + 60)),
          205.50::numeric, 'C1.1 a receita comum (salário) não entra no total de proventos');
select is((select income_paid from public.period_summary(pg_temp.fx('h'), pg_temp.hoje() - 60, pg_temp.hoje() + 60)),
          1205.50::numeric, 'C1.2 já o period_summary soma tudo, provento incluído');

-- D1 período: o que está fora do intervalo não conta
select is((select count(*) from public.investment_income_by_asset(pg_temp.fx('h'), pg_temp.hoje() - 60, pg_temp.hoje() - 20)), 0::bigint,
          'D1 período sem proventos: nenhuma linha');

-- E1 lixeira: apagar o lançamento tira o provento do total do ativo
update public.transactions set deleted_at = now() where id = pg_temp.fx('p3');
select is(pg_temp.rel(), 'FII Z:120.50/30.00', 'E1 provento na lixeira some do total do ativo');
select is((select balance::numeric(14,2) from public.account_balances(pg_temp.fx('h'), pg_temp.hoje()) where account_id = pg_temp.fx('conta')),
          2120.50::numeric, 'E1.1 e do saldo (1000 + 120,50 + salário 1000)');

-- F validações
select is(pg_temp.sqlstate_of($$select public.investment_distribution_record(pg_temp.fx('usa'), 'dividend', pg_temp.hoje() - 1, 10, pg_temp.fx('conta'))$$),
          '22023', 'F1 ativo em USD: recusa (contas só em BRL)');
select is(pg_temp.sqlstate_of($$select public.investment_distribution_record(pg_temp.fx('fii'), 'bonus', pg_temp.hoje() - 1, 10, pg_temp.fx('conta'))$$), '22023', 'F2 tipo inválido');
select is(pg_temp.sqlstate_of($$select public.investment_distribution_record(pg_temp.fx('fii'), 'dividend', pg_temp.hoje() - 1, 0, pg_temp.fx('conta'))$$), '22023', 'F3 valor zero');
select is(pg_temp.sqlstate_of($$select public.investment_distribution_record(pg_temp.fx('fii'), 'dividend', pg_temp.hoje() - 1, 10.005, pg_temp.fx('conta'))$$), '22023', 'F3.1 mais de 2 casas');
select is(pg_temp.sqlstate_of($$select public.investment_distribution_record(pg_temp.fx('fii'), 'dividend', pg_temp.hoje() + 3, 10, pg_temp.fx('conta'), 'paid')$$), '22023', 'F4 pago com data futura: recusa');
select lives_ok($$select public.investment_distribution_record(pg_temp.fx('fii'), 'dividend', pg_temp.hoje() + 3, 10, pg_temp.fx('conta'), 'planned')$$, 'F4.1 planejado com data futura: aceita');
select is(pg_temp.sqlstate_of($$select public.investment_distribution_record(pg_temp.fx('fii'), 'dividend', pg_temp.hoje() - 1, 10, pg_temp.fx('inativa'))$$), '42501', 'F5 conta inativa: recusa');
select is(pg_temp.sqlstate_of($$select public.investment_distribution_record(pg_temp.fx('fii'), 'dividend', pg_temp.hoje() - 1, 10, null)$$), '42501', 'F5.1 sem conta: recusa');
-- F6 período já conciliado da conta: o gatilho recusa o lançamento pago e NADA fica pela metade (sem vínculo órfão)
select public.reconcile_account(pg_temp.fx('conta'), pg_temp.hoje() - 80, 1000);
select is(pg_temp.sqlstate_of($$select public.investment_distribution_record(pg_temp.fx('fii'), 'dividend', pg_temp.hoje() - 85, 10, pg_temp.fx('conta'))$$),
          '55000', 'F6 conta conciliada nesse período: os gatilhos de integridade continuam valendo');
select is((select count(*) from public.investment_distributions where household_id = pg_temp.fx('h')), 4::bigint,
          'F6.1 só os 4 proventos válidos têm vínculo (nenhum órfão do recusado)');

-- H outra família e anon
select pg_temp.login('00000000-0000-0000-0000-0000000040a2');
insert into fixture select 'h2', public.create_household('Casa Outra');
select is(pg_temp.sqlstate_of($$select public.investment_distribution_record(pg_temp.fx('fii'), 'dividend', pg_temp.hoje() - 1, 10, pg_temp.fx('conta'))$$),
          '42501', 'H1 ativo de outra família: 42501');
select is((select count(*) from public.investment_distributions), 0::bigint, 'H1.1 a outra família nem enxerga os vínculos (RLS)');
select is((select count(*) from public.investment_income_by_asset(pg_temp.fx('h'), pg_temp.hoje() - 60, pg_temp.hoje() + 60)), 0::bigint,
          'H2 quem não é da família recebe zero linhas no relatório');
select is(pg_temp.sqlstate_of($$insert into public.investment_distributions (household_id, asset_id, transaction_id, kind) values (pg_temp.fx('h2'), pg_temp.fx('fii'), pg_temp.fx('p1'), 'income')$$),
          '42501', 'H3 o cliente não escreve direto no vínculo');
select set_config('request.jwt.claims', '{}', true), set_config('role', 'anon', true);
select is(pg_temp.sqlstate_of($$select public.investment_distribution_record(pg_temp.fx('fii'), 'dividend', pg_temp.hoje() - 1, 10, pg_temp.fx('conta'))$$), '42501', 'H4 anon não registra provento');
select is(pg_temp.sqlstate_of($$select * from public.investment_income_by_asset(pg_temp.fx('h'), pg_temp.hoje() - 60, pg_temp.hoje() + 60)$$), '42501', 'H4.1 anon não lê o relatório');

select * from finish();
rollback;
