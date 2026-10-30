-- 34_fx_foundation: catálogo, isolamento, imutabilidade e consulta de câmbio.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create temp table fixture (k text primary key, v uuid);
grant all on fixture to public;

create function pg_temp.mkuser(p_id uuid, p_email text) returns void
language sql as $f$
  insert into auth.users (id, email, raw_user_meta_data)
  values (p_id, p_email, '{}'::jsonb)
$f$;
create function pg_temp.login(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $f$;
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
grant execute on function pg_temp.mkuser(uuid,text), pg_temp.login(uuid), pg_temp.sqlstate_of(text) to public;

insert into public.fx_rates (base, quote, rate, rate_date, source) values
  ('USD', 'BRL', 5.25, current_date - 1, 'teste'),
  ('EUR', 'USD', 1.10, current_date - 1, 'teste'),
  ('BRL', 'EUR', 0.18, current_date - 10, 'teste');

select is((select count(*) from public.currencies), 3::bigint, 'catálogo inicial contém BRL, USD e EUR');
select is((select minor_unit from public.currencies where code = 'BRL'), 2::smallint, 'BRL usa duas casas decimais');
select is((select minor_unit from public.currencies where code = 'USD'), 2::smallint, 'USD usa duas casas decimais');
select is((select minor_unit from public.currencies where code = 'EUR'), 2::smallint, 'EUR usa duas casas decimais');
select is(pg_temp.sqlstate_of($$insert into public.fx_rates (base,quote,rate,rate_date,source) values ('USD','USD',1,current_date,'teste')$$),
  '23514', 'par identidade não pode ser armazenado como cotação');
select is(pg_temp.sqlstate_of($$insert into public.fx_rates (base,quote,rate,rate_date,source) values ('USD','BRL',0,current_date,'teste')$$),
  '23514', 'taxa zero é recusada');
select is(pg_temp.sqlstate_of($$insert into public.fx_rates (base,quote,rate,rate_date,source) values ('USD','BRL',1,current_date - 1,'outro')$$),
  '23505', 'não aceita duas taxas para o mesmo par e data');

select is((select rate from public.fx_rate_at('USD','BRL',current_date)), 5.25::numeric, 'consulta retorna taxa direta');
select is((select rate_date from public.fx_rate_at('USD','BRL',current_date)), current_date - 1, 'consulta informa data efetiva da taxa');
select is((select derived from public.fx_rate_at('USD','BRL',current_date)), false, 'taxa direta não é marcada como derivada');
select is((select rate from public.fx_rate_at('BRL','USD',current_date)), (1::numeric / 5.25::numeric), 'consulta calcula taxa inversa em numeric');
select is((select derived from public.fx_rate_at('BRL','USD',current_date)), true, 'taxa inversa é marcada como derivada');
select is((select rate from public.fx_rate_at('EUR','EUR',current_date)), 1::numeric, 'mesma moeda retorna taxa 1 sem cotação');
select is((select legs from public.fx_rate_at('EUR','EUR',current_date)), 0::smallint, 'conversão identidade não usa perna externa');
select is((select count(*) from public.fx_rate_at('BRL','EUR',current_date)), 0::bigint, 'cotação com mais de sete dias não é usada');
select is((select count(*) from public.fx_rate_at('XXX','BRL',current_date)), 0::bigint, 'moeda desconhecida não retorna taxa');

select pg_temp.mkuser('00000000-0000-0000-0000-0000000000b1', 'fx-owner@test.com');
select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
insert into fixture select 'h', public.create_household('Casa FX');
select is((select report_currency from public.households where id = (select v from fixture where k='h')),
  'BRL', 'moeda de consolidação padrão é BRL');
update public.households set report_currency = 'EUR' where id = (select v from fixture where k='h');
select is((select report_currency from public.households where id = (select v from fixture where k='h')),
  'EUR', 'owner pode alterar moeda de consolidação');

select ok(has_table_privilege(current_user, 'public.currencies', 'SELECT'), 'authenticated lê catálogo de moedas');
select ok(has_table_privilege(current_user, 'public.fx_rates', 'SELECT'), 'authenticated lê cotações');
select ok(not has_any_column_privilege(current_user, 'public.fx_rates', 'INSERT'), 'authenticated não insere cotações diretamente');
select ok(not has_any_column_privilege(current_user, 'public.fx_rates', 'UPDATE'), 'authenticated não altera cotações diretamente');
select ok(not has_any_column_privilege(current_user, 'public.fx_rates', 'DELETE'), 'authenticated não apaga cotações diretamente');
select is(pg_temp.sqlstate_of(format($$update public.fx_rates set rate = 99 where base='USD' and quote='BRL' and rate_date=current_date - 1$$)),
  '42501', 'authenticated não consegue alterar cotação');

select * from finish();
rollback;
