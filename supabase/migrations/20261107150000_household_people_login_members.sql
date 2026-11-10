-- Tudo Azul — migration 080: integrantes com login também são pessoas financeiras.
-- A linha é criada automaticamente ao entrar na família e continua separada de household_members.
-- household_people continua sendo a referência analítica usada por transações, parcelas e recorrências.

alter table public.household_people
  add column user_id uuid references auth.users (id) on delete set null;

create unique index household_people_user_link_uidx
  on public.household_people (household_id, user_id)
  where user_id is not null;

create function private.ensure_household_person_for_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  select coalesce(
    nullif(btrim(p.name), ''),
    nullif(split_part(u.email, '@', 1), ''),
    'Integrante'
  )
    into v_name
    from auth.users u
    left join public.profiles p on p.id = u.id
   where u.id = new.user_id;

  insert into public.household_people (household_id, user_id, name, relationship, status)
  values (new.household_id, new.user_id, coalesce(v_name, 'Integrante'), 'Familiar', true)
  on conflict (household_id, user_id) where user_id is not null do nothing;

  return new;
end
$$;

revoke execute on function private.ensure_household_person_for_member() from public, anon, authenticated;

create trigger household_members_create_financial_person
  after insert on public.household_members
  for each row execute function private.ensure_household_person_for_member();

-- Corrige também famílias já existentes: titular e membros convidados passam a aparecer no seletor.
insert into public.household_people (household_id, user_id, name, relationship, status)
select
  m.household_id,
  m.user_id,
  coalesce(
    nullif(btrim(p.name), ''),
    nullif(split_part(u.email, '@', 1), ''),
    'Integrante'
  ),
  'Familiar',
  true
from public.household_members m
join auth.users u on u.id = m.user_id
left join public.profiles p on p.id = m.user_id
on conflict (household_id, user_id) where user_id is not null do nothing;
