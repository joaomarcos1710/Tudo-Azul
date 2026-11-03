-- 43_investment_history_archived: migration 041. O histórico da carteira conta o ativo arquivado
-- nos meses em que ele tinha posição (a 039 perdia o passado ao arquivar).
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
create function pg_temp.mes(p_n integer) returns date language sql as $f$
  select (date_trunc('month', pg_temp.hoje()) + make_interval(months => p_n))::date $f$;
create function pg_temp.hist(p_mes date) returns text language sql as $f$
  select market_value::text || '|' || cost_basis::text
    from public.investment_history(pg_temp.fx('h'), pg_temp.mes(-3), pg_temp.hoje())
   where month = p_mes and currency_code = 'BRL' $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.hoje(), pg_temp.mes(integer), pg_temp.hist(date) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000043a1', 'a1@teste.com'),
  ('00000000-0000-0000-0000-0000000043a2', 'a2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000043a1');
insert into fixture select 'h', public.create_household('Casa Historico');
insert into fixture select 'x', public.investment_asset_create(pg_temp.fx('h'), 'Ação vendida', 'VEND3', 'equity', 'BRL');
insert into fixture select 'y', public.investment_asset_create(pg_temp.fx('h'), 'Ação mantida', 'MANT3', 'equity', 'BRL');

-- X: compra 10 a 10,00 no mês -2; vende tudo no mês -1 a 12,00. Y: compra 5 a 20,00 no mês -2 e segue.
select public.investment_operation_record(pg_temp.fx('x'), pg_temp.mes(-2) + 1, 'buy', 10, 10.00);
select public.investment_operation_record(pg_temp.fx('y'), pg_temp.mes(-2) + 1, 'buy', 5, 20.00);
select public.investment_operation_record(pg_temp.fx('x'), pg_temp.mes(-1) + 1, 'sell', 10, 12.00);

select is(pg_temp.hist(pg_temp.mes(-2)), '200.00|200.00', 'H1 mês -2: X (100) + Y (100)');
select is(pg_temp.hist(pg_temp.mes(-1)), '100.00|100.00', 'H2 mês -1: X já vendido; só Y');

select lives_ok($$select public.investment_asset_archive(pg_temp.fx('x'))$$, 'H3 arquiva o ativo zerado');
select is(pg_temp.hist(pg_temp.mes(-2)), '200.00|200.00', 'H4 depois de arquivar, o mês -2 continua com o X');
select is(pg_temp.hist(pg_temp.mes(-1)), '100.00|100.00', 'H5 e o mês -1 não muda');
select is(pg_temp.hist(pg_temp.mes(-3)), '0|0', 'H6 mês sem posição: zero');

-- avaliação posterior marca a mercado, também para o arquivado no mês em que tinha posição
select public.investment_valuation_record(pg_temp.fx('y'), pg_temp.mes(-1) + 2, 30.00, 'manual');
select is(pg_temp.hist(pg_temp.mes(-1)), '150.00|100.00', 'H7 mês -1: Y avaliado a 30,00 (5 x 30), custo 100');

-- outra família não enxerga
select pg_temp.login('00000000-0000-0000-0000-0000000043a2');
select is((select count(*) from public.investment_history(pg_temp.fx('h'), pg_temp.mes(-3), pg_temp.hoje())), 0::bigint, 'H8 quem não é da família não vê nada');

select * from finish();
rollback;
