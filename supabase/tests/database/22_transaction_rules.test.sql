-- 22_transaction_rules: integridade básica e isolamento por família.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create temp table fixture (k text primary key, v uuid);
grant all on fixture to public;
create function pg_temp.fx(p_k text) returns uuid language sql as $f$ select v from fixture where k = p_k $f$;
create function pg_temp.mkuser(p_id uuid, p_email text) returns void language sql as $f$
  insert into auth.users (id, email, raw_user_meta_data)
  values (p_id, p_email, '{}'::jsonb)
$f$;
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
create function pg_temp.login(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.sqlstate_of(text) to public;

select pg_temp.mkuser('00000000-0000-0000-0000-0000000000b1', 'rules1@teste.com');
select pg_temp.mkuser('00000000-0000-0000-0000-0000000000b2', 'rules2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
insert into fixture select 'h1', public.create_household('Casa Regras 1');
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000000b2');
insert into fixture select 'h2', public.create_household('Casa Regras 2');
reset role;

select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
with cat as (
  select id from public.categories where household_id = pg_temp.fx('h1') and type = 'expense' and name = 'Mercado'
), r as (
  insert into public.transaction_rules (household_id, name, description_contains, type, category_id, priority)
  select pg_temp.fx('h1'), 'Mercado', 'mercado', 'expense', id, 10 from cat returning id
)
insert into fixture select 'r1', id from r;
select is((select count(*) from public.transaction_rules where household_id = pg_temp.fx('h1')), 1::bigint,
  'a família consegue cadastrar e ler sua própria regra');
select is((select count(*) from public.transaction_rules where household_id = pg_temp.fx('h2')), 0::bigint,
  'a família não consegue ler regras de outra família');
select is((select count(*) from public.transaction_rules where id = pg_temp.fx('r1') and active), 1::bigint,
  'regra começa ativa por padrão');
select is(pg_temp.sqlstate_of(format(
  'insert into public.transaction_rules (household_id, name, description_contains, type, category_id) values (%L, %L, %L, %L, %L)',
  pg_temp.fx('h1'), 'Categoria incompatível', 'salario', 'income',
  (select id from public.categories where household_id = pg_temp.fx('h1') and type = 'expense' and name = 'Mercado')
)), '23503', 'banco rejeita categoria de tipo incompatível');
reset role;

select pg_temp.login('00000000-0000-0000-0000-0000000000b2');
select is((select count(*) from public.transaction_rules), 0::bigint,
  'outro usuário não enxerga regras de uma família da qual não participa');
reset role;

select * from finish();
rollback;
