-- 42_investment_asset_manage: migration 040. Editar, arquivar, reativar e excluir ativo de investimento.
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
-- a mensagem importa: a FK do Postgres também recusa (código 23503), mas com texto técnico; investment_asset_delete (migration 039, #125) dá o texto claro e o código 55000
create function pg_temp.msg_de(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlerrm; end $f$;
create function pg_temp.ativo(p_k text) returns text language sql as $f$
  select name || '|' || coalesce(ticker, '-') || '|' || asset_class || '|' || currency_code || '|' || active
    from public.investment_assets where id = pg_temp.fx(p_k) $f$;
create function pg_temp.na_carteira() returns text language sql as $f$
  select coalesce(string_agg(name, ',' order by name), '') from public.investment_portfolio(pg_temp.fx('h'), pg_temp.hoje()) $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.hoje(), pg_temp.sqlstate_of(text),
  pg_temp.msg_de(text), pg_temp.ativo(text), pg_temp.na_carteira() to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000042a1', 'a1@teste.com'),
  ('00000000-0000-0000-0000-0000000042a2', 'a2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000042a1');
insert into fixture select 'h', public.create_household('Casa Ativos');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Corretora', 'checking', 0, pg_temp.hoje() - 90) returning id)
  insert into fixture select 'conta', id from i;
insert into fixture select 'aberto', public.investment_asset_create(pg_temp.fx('h'), 'Ação aberta', 'ABRT3', 'equity', 'BRL');
insert into fixture select 'zerado', public.investment_asset_create(pg_temp.fx('h'), 'Ação zerada', 'ZERO3', 'equity', 'BRL');
insert into fixture select 'virgem', public.investment_asset_create(pg_temp.fx('h'), 'Nunca usado', null, 'other', 'BRL');
insert into fixture select 'aval', public.investment_asset_create(pg_temp.fx('h'), 'So avaliacao', null, 'fund', 'BRL');
insert into fixture select 'prov', public.investment_asset_create(pg_temp.fx('h'), 'Com provento', 'PROV11', 'reit', 'BRL');
insert into fixture select 'soprov', public.investment_asset_create(pg_temp.fx('h'), 'So provento', 'SOPR11', 'reit', 'BRL');
insert into fixture select 'usd', public.investment_asset_create(pg_temp.fx('h'), 'ETF dolar', 'GLOB', 'etf', 'USD');

select public.investment_operation_record(pg_temp.fx('aberto'), pg_temp.hoje() - 10, 'buy', 10, 10.00);
select public.investment_operation_record(pg_temp.fx('zerado'), pg_temp.hoje() - 10, 'buy', 4, 10.00);
select public.investment_operation_record(pg_temp.fx('zerado'), pg_temp.hoje() - 5, 'sell', 4, 12.00);
select public.investment_valuation_record(pg_temp.fx('aval'), pg_temp.hoje() - 3, 5.00, 'manual');
select public.investment_operation_record(pg_temp.fx('prov'), pg_temp.hoje() - 10, 'buy', 2, 50.00);
select public.investment_distribution_record(pg_temp.fx('prov'), 'dividend', pg_temp.hoje() - 1, 3.00, pg_temp.fx('conta'));
select public.investment_distribution_record(pg_temp.fx('soprov'), 'jcp', pg_temp.hoje() - 1, 4.00, pg_temp.fx('conta'));

-- ---- editar ----
select lives_ok($$select public.investment_asset_update(pg_temp.fx('virgem'), '  Renda Fixa X ', '  RFX1 ', 'fixed_income')$$, 'E1 edita nome, código e classe');
select is(pg_temp.ativo('virgem'), 'Renda Fixa X|RFX1|fixed_income|BRL|true', 'E1.1 aparou os espaços; a moeda continua BRL');
select lives_ok($$select public.investment_asset_update(pg_temp.fx('virgem'), 'Renda Fixa X', '   ', 'fixed_income')$$, 'E2 código em branco limpa o código');
select is(pg_temp.ativo('virgem'), 'Renda Fixa X|-|fixed_income|BRL|true', 'E2.1 sem código');
select is(pg_temp.sqlstate_of($$select public.investment_asset_update(pg_temp.fx('virgem'), '   ', null, 'equity')$$), '22023', 'E3 nome vazio: recusa');
select is(pg_temp.sqlstate_of($$select public.investment_asset_update(pg_temp.fx('virgem'), repeat('x', 101), null, 'equity')$$), '22023', 'E3.1 nome com 101 caracteres: recusa');
select is(pg_temp.sqlstate_of($$select public.investment_asset_update(pg_temp.fx('virgem'), 'X', repeat('y', 21), 'equity')$$), '22023', 'E3.2 código com 21 caracteres: recusa');
select is(pg_temp.sqlstate_of($$select public.investment_asset_update(pg_temp.fx('virgem'), 'X', null, 'cripto')$$), '22023', 'E3.3 classe inválida: recusa');
select is(pg_temp.sqlstate_of($$select public.investment_asset_update(pg_temp.fx('virgem'), 'Ação aberta', null, 'equity')$$), '23505', 'E4 nome já usado por outro ativo na mesma moeda: recusa');
select is(pg_temp.ativo('virgem'), 'Renda Fixa X|-|fixed_income|BRL|true', 'E4.1 e nada mudou');
-- editar um ativo com histórico não mexe nos valores
select public.investment_asset_update(pg_temp.fx('aberto'), 'Ação aberta renomeada', 'ABRT3', 'etf');
select is((select market_value::numeric(14,2) from public.investment_portfolio(pg_temp.fx('h'), pg_temp.hoje()) where name = 'Ação aberta renomeada'),
          100.00::numeric, 'E5 renomear ativo com histórico não muda o valor da posição');
select public.investment_asset_update(pg_temp.fx('aberto'), 'Ação aberta', 'ABRT3', 'equity');

-- ---- arquivar ----
select is(pg_temp.na_carteira(), 'Ação aberta,Com provento', 'A0 só os ativos com posição aberta estão na carteira (o zerado já não aparece)');
select is(pg_temp.sqlstate_of($$select public.investment_asset_archive(pg_temp.fx('aberto'))$$), '23514', 'A1 posição aberta: não arquiva');
select is((select active from public.investment_assets where id = pg_temp.fx('aberto')), true, 'A1.1 e continua ativo');
select lives_ok($$select public.investment_asset_archive(pg_temp.fx('zerado'))$$, 'A2 ativo zerado: arquiva');
select is((select active from public.investment_assets where id = pg_temp.fx('zerado')), false, 'A2.1 ficou arquivado');
select lives_ok($$select public.investment_asset_archive(pg_temp.fx('zerado'))$$, 'A2.2 arquivar de novo não faz nada nem dá erro');
select is((select count(*) from public.investment_operations where asset_id = pg_temp.fx('zerado')), 2::bigint, 'A2.3 o histórico de operações continua');
select is(pg_temp.sqlstate_of($$select public.investment_operation_record(pg_temp.fx('zerado'), pg_temp.hoje() - 1, 'buy', 1, 10.00)$$), '55000', 'A3 ativo arquivado não recebe operação');
select lives_ok($$select public.investment_asset_archive(pg_temp.fx('virgem'))$$, 'A4 ativo nunca usado também arquiva');

-- ---- reativar ----
select lives_ok($$select public.investment_asset_unarchive(pg_temp.fx('zerado'))$$, 'R1 reativa');
select is((select active from public.investment_assets where id = pg_temp.fx('zerado')), true, 'R1.1 voltou a ficar ativo');
select lives_ok($$select public.investment_operation_record(pg_temp.fx('zerado'), pg_temp.hoje() - 1, 'buy', 1, 10.00)$$, 'R1.2 e volta a aceitar operação');
select public.investment_operation_record(pg_temp.fx('zerado'), pg_temp.hoje() - 1, 'sell', 1, 10.00);

-- ---- excluir ----
select lives_ok($$select public.investment_asset_delete(pg_temp.fx('virgem'))$$, 'X1 ativo sem movimento é excluído');
select is((select count(*) from public.investment_assets where id = pg_temp.fx('virgem')), 0::bigint, 'X1.1 a linha sumiu');
select is(pg_temp.sqlstate_of($$select public.investment_asset_delete(pg_temp.fx('aberto'))$$), '55000', 'X2 com operação: só arquivar');
select is(pg_temp.msg_de($$select public.investment_asset_delete(pg_temp.fx('aberto'))$$), 'Este ativo possui operações, avaliações ou proventos. O histórico financeiro não pode ser excluído.', 'X2.1 com a mensagem clara');
select is(pg_temp.msg_de($$select public.investment_asset_delete(pg_temp.fx('zerado'))$$), 'Este ativo possui operações, avaliações ou proventos. O histórico financeiro não pode ser excluído.', 'X2.2 zerado (tem operações): só arquivar, mensagem clara');
select is(pg_temp.msg_de($$select public.investment_asset_delete(pg_temp.fx('aval'))$$), 'Este ativo possui operações, avaliações ou proventos. O histórico financeiro não pode ser excluído.', 'X3 só com avaliação: não exclui, mensagem clara');
select is(pg_temp.msg_de($$select public.investment_asset_delete(pg_temp.fx('soprov'))$$), 'Este ativo possui operações, avaliações ou proventos. O histórico financeiro não pode ser excluído.', 'X4 só com provento (sem operação): não exclui, mensagem clara');
select is(pg_temp.sqlstate_of($$select public.investment_asset_delete(pg_temp.fx('prov'))$$), '55000', 'X4.1 com operação e provento: não exclui');
select is((select count(*) from public.transactions where id = (select transaction_id from public.investment_distributions where asset_id = pg_temp.fx('soprov'))), 1::bigint,
          'X4.2 e o lançamento do provento continua lá (nada some em cascata)');
select lives_ok($$select public.investment_asset_delete(pg_temp.fx('usd'))$$, 'X5 ativo em USD sem movimento também exclui');

-- ---- outra família e anon ----
select pg_temp.login('00000000-0000-0000-0000-0000000042a2');
insert into fixture select 'h2', public.create_household('Casa Outra');
select is(pg_temp.sqlstate_of($$select public.investment_asset_update(pg_temp.fx('aberto'), 'Invadido', null, 'equity')$$), '42501', 'Z1 editar ativo de outra família: 42501');
select is(pg_temp.sqlstate_of($$select public.investment_asset_archive(pg_temp.fx('zerado'))$$), '42501', 'Z2 arquivar de outra família: 42501');
select is(pg_temp.sqlstate_of($$select public.investment_asset_unarchive(pg_temp.fx('zerado'))$$), '42501', 'Z3 reativar de outra família: 42501');
select is(pg_temp.sqlstate_of($$select public.investment_asset_delete(pg_temp.fx('aval'))$$), '42501', 'Z4 excluir de outra família: 42501');
select is((select count(*) from public.investment_assets where id = pg_temp.fx('aval')), 0::bigint, 'Z5 a outra família nem enxerga o ativo (RLS)');
select set_config('request.jwt.claims', '{}', true), set_config('role', 'anon', true);
select is(pg_temp.sqlstate_of($$select public.investment_asset_update(pg_temp.fx('aberto'), 'X', null, 'equity')$$), '42501', 'Z6 anon não edita');
select is(pg_temp.sqlstate_of($$select public.investment_asset_archive(pg_temp.fx('zerado'))$$), '42501', 'Z6.1 anon não arquiva');
select is(pg_temp.sqlstate_of($$select public.investment_asset_delete(pg_temp.fx('aval'))$$), '42501', 'Z6.2 anon não exclui');

select * from finish();
rollback;
