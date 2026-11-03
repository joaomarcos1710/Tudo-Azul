-- 45_investment_operation_void: migration 043. Extrato do ativo e anulação auditada de operação.
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
create function pg_temp.msg_de(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlerrm; end $f$;
create function pg_temp.pos(p_k text) returns text language sql as $f$
  select coalesce((select quantity::numeric(20,4) || '|' || cost_basis::numeric(14,2)
    from public.investment_portfolio(pg_temp.fx('h'), pg_temp.hoje()) where asset_id = pg_temp.fx(p_k)), 'sem posição') $f$;
create function pg_temp.custo_hist() returns numeric language sql as $f$
  select cost_basis from public.investment_history(pg_temp.fx('h'), pg_temp.hoje(), pg_temp.hoje()) where currency_code = 'BRL' $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.hoje(), pg_temp.sqlstate_of(text),
  pg_temp.msg_de(text), pg_temp.pos(text), pg_temp.custo_hist() to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000045a1', 'v1@teste.com'),
  ('00000000-0000-0000-0000-0000000045a2', 'v2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000045a1');
insert into fixture select 'h', public.create_household('Casa Anula');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Corretora', 'checking', 0, pg_temp.hoje() - 90) returning id)
  insert into fixture select 'conta', id from i;
insert into fixture select 'a', public.investment_asset_create(pg_temp.fx('h'), 'Ação teste', 'TEST3', 'equity', 'BRL');
insert into fixture select 'c1', public.investment_operation_record(pg_temp.fx('a'), pg_temp.hoje() - 20, 'buy', 10, 10.00, 1.00);
insert into fixture select 'errada', public.investment_operation_record(pg_temp.fx('a'), pg_temp.hoje() - 15, 'buy', 100, 20.00);
insert into fixture select 'c2', public.investment_operation_record(pg_temp.fx('a'), pg_temp.hoje() - 12, 'buy', 5, 12.00);
insert into fixture select 'v1', public.investment_operation_record(pg_temp.fx('a'), pg_temp.hoje() - 5, 'sell', 12, 15.00, 0.50);
select public.investment_valuation_record(pg_temp.fx('a'), pg_temp.hoje() - 3, 11.00, 'manual');
select public.investment_distribution_record(pg_temp.fx('a'), 'dividend', pg_temp.hoje() - 2, 3.50, pg_temp.fx('conta'));

-- antes: 10 + 100 + 5 - 12 = 103
select is((select quantity from public.investment_portfolio(pg_temp.fx('h'), pg_temp.hoje()) where asset_id = pg_temp.fx('a')), 103::numeric, 'P0.1 103 unidades');

-- ---- validações ----
select is(pg_temp.sqlstate_of($$select public.investment_operation_void(pg_temp.fx('errada'), '  ')$$), '22023', 'V1 motivo vazio: recusa');
select is(pg_temp.sqlstate_of($$select public.investment_operation_void(pg_temp.fx('errada'), 'ab')$$), '22023', 'V1.1 motivo com 2 caracteres: recusa');
select is(pg_temp.sqlstate_of($$select public.investment_operation_void(pg_temp.fx('errada'), repeat('x', 201))$$), '22023', 'V1.2 motivo com 201 caracteres: recusa');
select is(pg_temp.sqlstate_of($$select public.investment_operation_void(pg_temp.fx('errada'), null)$$), '22023', 'V1.3 motivo nulo: recusa');

-- ---- anular a compra errada ----
select lives_ok($$select public.investment_operation_void(pg_temp.fx('errada'), '  digitei 100 em vez de 10 ')$$, 'A1 anula a compra errada');
select is((select quantity from public.investment_portfolio(pg_temp.fx('h'), pg_temp.hoje()) where asset_id = pg_temp.fx('a')), 3::numeric, 'A1.1 saiu da posição: 10 + 5 - 12 = 3');
-- custo: (10*10+1) + 5*12 = 161; venda de 12 ao custo médio 161/15 → resta 161*3/15 = 32.20
select is((select cost_basis from public.investment_portfolio(pg_temp.fx('h'), pg_temp.hoje()) where asset_id = pg_temp.fx('a')), 32.20::numeric, 'A1.2 saiu do custo');
select is(pg_temp.custo_hist(), 32.20::numeric, 'A1.3 saiu do histórico');
select is((select void_reason || '|' || (voided_by = '00000000-0000-0000-0000-0000000045a1') || '|' || (voided_at is not null)
             from public.investment_operations where id = pg_temp.fx('errada')), 'digitei 100 em vez de 10|true|true', 'A1.4 auditoria: motivo aparado, autor e data');
select is((select count(*) from public.investment_operations where asset_id = pg_temp.fx('a')), 4::bigint, 'A1.5 nada foi apagado');
select is(pg_temp.sqlstate_of($$select public.investment_operation_void(pg_temp.fx('errada'), 'de novo')$$), '55000', 'A2 anular de novo: recusa');

-- ---- anular compra que cobre venda posterior ----
-- sem c1: 5 - 12 = -7 no dia da venda
select is(pg_temp.sqlstate_of($$select public.investment_operation_void(pg_temp.fx('c1'), 'teste de cobertura')$$), '23514', 'C1 anular compra que cobre venda: recusa');
select matches(pg_temp.msg_de($$select public.investment_operation_void(pg_temp.fx('c1'), 'teste de cobertura')$$), 'Anule a venda antes', 'C1.1 mensagem clara');
select is((select voided_at from public.investment_operations where id = pg_temp.fx('c1')), null::timestamptz, 'C1.2 e nada mudou');
select is((select quantity from public.investment_portfolio(pg_temp.fx('h'), pg_temp.hoje()) where asset_id = pg_temp.fx('a')), 3::numeric, 'C1.3 posição intacta');

-- ---- escrita direta bloqueada ----
select is(pg_temp.sqlstate_of($$update public.investment_operations set voided_at = now(), voided_by = auth.uid(), void_reason = 'direto' where id = pg_temp.fx('c1')$$), '42501', 'D1 cliente não grava a anulação direto na tabela');

-- ---- outra família ----
select pg_temp.login('00000000-0000-0000-0000-0000000045a2');
insert into fixture select 'h2', public.create_household('Casa Outra');
select is(pg_temp.sqlstate_of($$select public.investment_operation_void(pg_temp.fx('c2'), 'invasão')$$), '42501', 'F1 outra família: recusa');
select is((select count(*) from public.investment_asset_statement(pg_temp.fx('h'), pg_temp.fx('a'))), 0::bigint, 'F2 outra família não lê o extrato');
select pg_temp.login('00000000-0000-0000-0000-0000000045a1');
select is((select voided_at from public.investment_operations where id = pg_temp.fx('c2')), null::timestamptz, 'F1.1 c2 continua valendo');

-- ---- extrato ----
select is((select string_agg(entry_kind || ':' || voided, ',' order by entry_date)
             from public.investment_asset_statement(pg_temp.fx('h'), pg_temp.fx('a'))),
          'buy:false,buy:true,buy:false,sell:false,valuation:false,distribution:false', 'X1 extrato em ordem de data com todos os tipos');
select is((select void_reason from public.investment_asset_statement(pg_temp.fx('h'), pg_temp.fx('a')) where entry_id = pg_temp.fx('errada')),
          'digitei 100 em vez de 10', 'X2 anulada aparece com o motivo');
select is((select balance_quantity from public.investment_asset_statement(pg_temp.fx('h'), pg_temp.fx('a')) where entry_id = pg_temp.fx('errada')),
          null::numeric, 'X3 anulada não tem saldo');
select is((select string_agg(balance_quantity::numeric(20,0)::text, ',' order by entry_date)
             from public.investment_asset_statement(pg_temp.fx('h'), pg_temp.fx('a')) where balance_quantity is not null),
          '10,15,3', 'X4 acumulado ignora a anulada');
select is((select amount from public.investment_asset_statement(pg_temp.fx('h'), pg_temp.fx('a')) where entry_id = pg_temp.fx('c1')), 101.00::numeric, 'X5 compra = qtd × preço + taxa');
select is((select amount from public.investment_asset_statement(pg_temp.fx('h'), pg_temp.fx('a')) where entry_id = pg_temp.fx('v1')), 179.50::numeric, 'X6 venda = qtd × preço − taxa');
select is((select amount || '|' || distribution_kind || '|' || distribution_status from public.investment_asset_statement(pg_temp.fx('h'), pg_temp.fx('a')) where entry_kind = 'distribution'),
          '3.50|dividend|paid', 'X7 provento com valor e status');

-- ---- venda nova respeita a posição sem a anulada ----
select is(pg_temp.sqlstate_of($$select public.investment_operation_record(pg_temp.fx('a'), pg_temp.hoje(), 'sell', 4, 15.00)$$), '23514', 'S1 vender 4 com 3 disponíveis: recusa');
select lives_ok($$select public.investment_operation_record(pg_temp.fx('a'), pg_temp.hoje(), 'sell', 3, 15.00)$$, 'S2 vender 3: aceita');
select lives_ok($$select public.investment_asset_archive(pg_temp.fx('a'))$$, 'S3 zerado sem a anulada: arquiva');

select * from finish();
rollback;
