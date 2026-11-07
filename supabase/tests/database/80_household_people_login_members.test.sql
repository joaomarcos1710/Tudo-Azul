-- 80: integrantes com login são disponibilizados automaticamente para classificação financeira.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

select has_column('public', 'household_people', 'user_id',
  'pessoas financeiras podem ser vinculadas a um usuário autenticado');
select ok(exists (
  select 1 from pg_indexes
   where schemaname = 'public'
     and tablename = 'household_people'
     and indexname = 'household_people_user_link_uidx'
), 'cada usuário tem no máximo uma pessoa financeira por família');
select has_trigger('public', 'household_members', 'household_members_create_financial_person',
  'a entrada de um membro cria sua pessoa financeira');
select has_function('private', 'ensure_household_person_for_member',
  'trigger usa função privada para provisionar a pessoa');

-- Exercita o provisionamento real para o titular e para um membro convidado.
create temp table fixture (k text primary key, v uuid);
grant all on fixture to public;
create function pg_temp.fx(p_k text) returns uuid language sql as $f$
  select v from fixture where k = p_k
$f$;
create function pg_temp.login(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end
$f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid) to public;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000080a1', 'titular80@teste.com', '{"name":"Titular Teste"}'),
  ('00000000-0000-0000-0000-0000000080a2', 'membro80@teste.com', '{"name":"Membro Teste"}');

select pg_temp.login('00000000-0000-0000-0000-0000000080a1');
insert into fixture select 'household', public.create_household('Família de teste 80');
reset role;

select is((
  select count(*) from public.household_people
   where household_id = pg_temp.fx('household')
     and user_id = '00000000-0000-0000-0000-0000000080a1'
), 1::bigint, 'o titular recebe automaticamente uma pessoa financeira');
select is((
  select name from public.household_people
   where household_id = pg_temp.fx('household')
     and user_id = '00000000-0000-0000-0000-0000000080a1'
), 'Titular Teste', 'o nome do titular vem do perfil');

insert into public.household_members (household_id, user_id, role)
values (pg_temp.fx('household'), '00000000-0000-0000-0000-0000000080a2', 'member');
select is((
  select count(*) from public.household_people
   where household_id = pg_temp.fx('household')
     and user_id = '00000000-0000-0000-0000-0000000080a2'
), 1::bigint, 'um membro que entra por convite recebe automaticamente uma pessoa financeira');
select is((
  select name from public.household_people
   where household_id = pg_temp.fx('household')
     and user_id = '00000000-0000-0000-0000-0000000080a2'
), 'Membro Teste', 'o nome do membro vem do perfil');

select * from finish();
rollback;
