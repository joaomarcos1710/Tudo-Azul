-- 39_investment_allocation: migration 034. Subclasse do ativo e alocação por macroclasse/subclasse, por moeda.
-- Datas relativas a hoje em São Paulo (a RPC de operação recusa data futura); nada depende de data fixa.
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
-- "nivel|macro|subclasse|valor|%" de cada linha de uma moeda, separado por ;
create function pg_temp.aloc(p_moeda text) returns text language sql as $f$
  select string_agg(level || '|' || macro || '|' || coalesce(subclass, '-') || '|' || market_value::numeric(14,2) || '|' || share, ';'
                    order by (level = 'macro') desc, macro, market_value desc, subclass)
    from public.investment_allocation(pg_temp.fx('h'), pg_temp.hoje()) where currency_code = p_moeda $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.hoje(), pg_temp.sqlstate_of(text), pg_temp.aloc(text) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000039a1', 'i1@teste.com'),
  ('00000000-0000-0000-0000-0000000039a2', 'i2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000039a1');
insert into fixture select 'h', public.create_household('Casa Carteira');
insert into fixture select 'tes', public.investment_asset_create(pg_temp.fx('h'), 'Tesouro Selic', null, 'fixed_income', 'BRL');
insert into fixture select 'cdb', public.investment_asset_create(pg_temp.fx('h'), 'CDB Banco X', null, 'fixed_income', 'BRL');
insert into fixture select 'acao', public.investment_asset_create(pg_temp.fx('h'), 'Ação Y', 'AAAA3', 'equity', 'BRL');
insert into fixture select 'fii', public.investment_asset_create(pg_temp.fx('h'), 'FII Z', 'ZZZZ11', 'reit', 'BRL');
insert into fixture select 'fundo', public.investment_asset_create(pg_temp.fx('h'), 'Fundo W', null, 'fund', 'BRL');
insert into fixture select 'usa', public.investment_asset_create(pg_temp.fx('h'), 'ETF Global', 'GLOB', 'etf', 'USD');
insert into fixture select 'zerado', public.investment_asset_create(pg_temp.fx('h'), 'Já vendido', null, 'equity', 'BRL');

-- posições: valor = quantidade x preço (sem avaliação, o custo é a referência)
select public.investment_operation_record(pg_temp.fx('tes'),   pg_temp.hoje() - 10, 'buy', 1, 600.00);
select public.investment_operation_record(pg_temp.fx('cdb'),   pg_temp.hoje() - 10, 'buy', 1, 200.00);
select public.investment_operation_record(pg_temp.fx('acao'),  pg_temp.hoje() - 10, 'buy', 10, 10.00);
select public.investment_operation_record(pg_temp.fx('fii'),   pg_temp.hoje() - 10, 'buy', 1, 50.00);
select public.investment_operation_record(pg_temp.fx('fundo'), pg_temp.hoje() - 10, 'buy', 1, 50.00);
select public.investment_operation_record(pg_temp.fx('usa'),   pg_temp.hoje() - 10, 'buy', 2, 100.00);
select public.investment_operation_record(pg_temp.fx('zerado'), pg_temp.hoje() - 10, 'buy', 1, 999.00);
select public.investment_operation_record(pg_temp.fx('zerado'), pg_temp.hoje() - 5, 'sell', 1, 999.00);

-- S0 nenhum ativo nasce com subclasse (nem é inventada)
select is((select count(*) from public.investment_assets where household_id = pg_temp.fx('h') and subclass is not null), 0::bigint,
          'S0 ninguém nasce com subclasse');

-- A1 sem subclasse: macroclasse derivada da classe; % sobre o total da moeda (BRL = 1000); ativo vendido por inteiro não entra
select is(pg_temp.aloc('BRL'),
  'macro|fixed_income|-|800.00|80.0;macro|other|-|50.00|5.0;macro|variable|-|150.00|15.0;'
  'subclass|fixed_income|-|800.00|80.0;subclass|other|-|50.00|5.0;subclass|variable|-|150.00|15.0',
  'A1 renda fixa 600+200; variável = ação 100 + FII 50; fundo vai para other; vendido por inteiro fica de fora');
-- A2 moedas nunca se somam: o USD tem total e % próprios
select is(pg_temp.aloc('USD'), 'macro|variable|-|200.00|100.0;subclass|variable|-|200.00|100.0', 'A2 USD separado, 100% dele');

-- B1 definir subclasse
select lives_ok($$select public.investment_asset_set_subclass(pg_temp.fx('tes'), '  Tesouro Direto ')$$, 'B1 define (aparando espaços)');
select public.investment_asset_set_subclass(pg_temp.fx('cdb'), 'CDB');
select public.investment_asset_set_subclass(pg_temp.fx('acao'), 'Ações');
select public.investment_asset_set_subclass(pg_temp.fx('fii'), 'FIIs');
select is((select subclass from public.investment_assets where id = pg_temp.fx('tes')), 'Tesouro Direto', 'B1.1 gravou sem os espaços');
select is(pg_temp.aloc('BRL'),
  'macro|fixed_income|-|800.00|80.0;macro|other|-|50.00|5.0;macro|variable|-|150.00|15.0;'
  'subclass|fixed_income|Tesouro Direto|600.00|60.0;subclass|fixed_income|CDB|200.00|20.0;'
  'subclass|other|-|50.00|5.0;'
  'subclass|variable|Ações|100.00|10.0;subclass|variable|FIIs|50.00|5.0',
  'B2 por subclasse, maior primeiro dentro da macro; o fundo segue sem subclasse');
-- B3 invariante: a soma das linhas macro de cada moeda = investment_totals.market_value
select is((select sum(market_value) from public.investment_allocation(pg_temp.fx('h'), pg_temp.hoje()) where level = 'macro' and currency_code = 'BRL'),
          (select market_value from public.investment_totals(pg_temp.fx('h'), pg_temp.hoje()) where currency_code = 'BRL'),
          'B3 soma dos macro BRL = investment_totals');
select is((select sum(market_value) from public.investment_allocation(pg_temp.fx('h'), pg_temp.hoje()) where level = 'subclass' and currency_code = 'BRL'),
          (select market_value from public.investment_totals(pg_temp.fx('h'), pg_temp.hoje()) where currency_code = 'BRL'),
          'B3.1 soma dos subclass BRL = investment_totals');

-- C1 limpar e validar
select public.investment_asset_set_subclass(pg_temp.fx('cdb'), '   ');
select is((select subclass from public.investment_assets where id = pg_temp.fx('cdb')), null, 'C1 vazio limpa a subclasse');
select public.investment_asset_set_subclass(pg_temp.fx('cdb'), null);
select is((select subclass from public.investment_assets where id = pg_temp.fx('cdb')), null, 'C1.1 nulo também limpa');
select is(pg_temp.sqlstate_of($$select public.investment_asset_set_subclass(pg_temp.fx('cdb'), repeat('x', 41))$$), '22023', 'C2 41 caracteres: recusa');
select lives_ok($$select public.investment_asset_set_subclass(pg_temp.fx('cdb'), repeat('x', 40))$$, 'C2.1 40 caracteres: aceita');
select is(pg_temp.sqlstate_of($$update public.investment_assets set subclass = 'direto' where id = pg_temp.fx('cdb')$$), '42501', 'C3 o cliente não escreve direto na tabela');

-- D1 outra família e anon
select pg_temp.login('00000000-0000-0000-0000-0000000039a2');
insert into fixture select 'h2', public.create_household('Casa Outra');
select is(pg_temp.sqlstate_of($$select public.investment_asset_set_subclass(pg_temp.fx('tes'), 'Invadido')$$), '42501', 'D1 ativo de outra família: 42501');
select is((select subclass from public.investment_assets where id = pg_temp.fx('tes')), null, 'D1.1 e a outra família nem enxerga o ativo (RLS)');
select is((select count(*) from public.investment_allocation(pg_temp.fx('h'), pg_temp.hoje())), 0::bigint, 'D2 quem não é da família recebe zero linhas');
select set_config('request.jwt.claims', '{}', true), set_config('role', 'anon', true);
select is(pg_temp.sqlstate_of($$select public.investment_asset_set_subclass(pg_temp.fx('tes'), 'x')$$), '42501', 'D3 anon não define subclasse');
select is(pg_temp.sqlstate_of($$select * from public.investment_allocation(pg_temp.fx('h'), pg_temp.hoje())$$), '42501', 'D3.1 anon não lê a alocação');

select * from finish();
rollback;
