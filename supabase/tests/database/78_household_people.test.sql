-- 78_household_people: cadastro financeiro de pessoas isolado por família.
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
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.sqlstate_of(text) to public;

insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000078a1', 'pessoa1@teste.com', '{"name":"Pessoa 1"}'),
 ('00000000-0000-0000-0000-0000000078a2', 'pessoa2@teste.com', '{"name":"Pessoa 2"}');
select pg_temp.login('00000000-0000-0000-0000-0000000078a1');
insert into fixture select 'h1', public.create_household('Casa 1');
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000078a2');
insert into fixture select 'h2', public.create_household('Casa 2');
reset role;

select pg_temp.login('00000000-0000-0000-0000-0000000078a1');
with p as (
  insert into public.household_people (household_id, name, birthdate, relationship)
  values (pg_temp.fx('h1'), 'Pessoa da Casa 1', '2015-04-12', 'Filho(a)') returning id
)
insert into fixture select 'p1', id from p;
select is((select count(*) from public.household_people where household_id = pg_temp.fx('h1')), 2::bigint, 'família 1 lista titular automático e pessoa cadastrada');
select is((select status from public.household_people where id = pg_temp.fx('p1')), true, 'pessoa nasce ativa');
update public.household_people set name = 'Nome corrigido' where id = pg_temp.fx('p1');
update public.household_people set status = false where id = pg_temp.fx('p1');
select is((select name from public.household_people where id = pg_temp.fx('p1')), 'Nome corrigido', 'nome pode ser corrigido');
select is((select status from public.household_people where id = pg_temp.fx('p1')), false, 'inativação preserva o registro');
select is(pg_temp.sqlstate_of(format($$insert into public.household_people (household_id,name,relationship) values (%L,'Inválida','Namorado')$$, pg_temp.fx('h1'))),
 '23514', 'vínculo fora da lista é recusado');
select is(pg_temp.sqlstate_of(format($$insert into public.household_people (household_id,name,relationship) values (%L,'   ','Familiar')$$, pg_temp.fx('h1'))),
 '23514', 'nome vazio é recusado');
select is(pg_temp.sqlstate_of(format($$delete from public.household_people where id = %L$$, pg_temp.fx('p1'))),
 '42501', 'hard delete não é permitido ao cliente');
reset role;

select pg_temp.login('00000000-0000-0000-0000-0000000078a2');
select is((select count(*) from public.household_people where household_id = pg_temp.fx('h1')), 0::bigint, 'família 2 não enxerga pessoas da família 1');
select is((select count(*) from public.household_people where household_id = pg_temp.fx('h1')), 0::bigint, 'família 2 não enxerga nenhum registro da família 1');
select is(pg_temp.sqlstate_of(format($$insert into public.household_people (household_id,name,relationship) values (%L,'Invasão','Familiar')$$, pg_temp.fx('h1'))),
 '42501', 'RLS impede criar pessoa na família 1');
select is(pg_temp.sqlstate_of(format($$update public.household_people set name = 'Invasão' where id = %L$$, pg_temp.fx('p1'))),
 null, 'update alheio não altera nenhuma linha');
select is((select count(*) from public.household_people where household_id = pg_temp.fx('h1')), 0::bigint, 'update alheio continua sem expor o registro da família 1');
with p as (
  insert into public.household_people (household_id,name,relationship)
  values (pg_temp.fx('h2'),'Pessoa da Casa 2','Pet') returning id
)
insert into fixture select 'p2', id from p;
select is((select count(*) from public.household_people where household_id = pg_temp.fx('h2')), 2::bigint, 'família 2 lista seu integrante automático e seu pet');
reset role;
select * from finish();
rollback;
