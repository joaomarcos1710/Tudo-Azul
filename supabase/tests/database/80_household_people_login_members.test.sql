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

select * from finish();
rollback;
