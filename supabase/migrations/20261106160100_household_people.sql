-- Tudo Azul — migration 078: pessoas da família para classificação financeira (PR #205)
-- Pessoas aqui não são usuários. Dados sem cadastro global, sempre isolados por household_id.
-- "Toda a família" será escopo analítico futuro, nunca linha nesta tabela.
-- Esta fase não adiciona person_id a transações, parcelas ou recorrências.

create table public.household_people (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  photo_url text check (photo_url is null or (char_length(photo_url) <= 2048 and photo_url ~ '^https://')),
  birthdate date,
  relationship text not null check (relationship in (
    'Conhecido', 'Familiar', 'Companheiro(a)', 'Pai/Mãe', 'Filho(a)', 'Irmão/Irmã', 'Pet', 'Amigo(a)'
  )),
  status boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, id)
);

create index household_people_active_name_idx on public.household_people (household_id, name) where status;

create trigger household_people_touch before update on public.household_people
  for each row execute function private.touch_updated_at();

-- Sem DELETE: inativação preserva histórico futuro.
revoke all on public.household_people from anon, authenticated;
grant select on public.household_people to authenticated;
grant insert (household_id, name, photo_url, birthdate, relationship, status)
  on public.household_people to authenticated;
grant update (name, photo_url, birthdate, relationship, status)
  on public.household_people to authenticated;

alter table public.household_people enable row level security;

create policy household_people_select on public.household_people
  for select to authenticated using ((select private.is_member(household_id)));
create policy household_people_insert on public.household_people
  for insert to authenticated with check ((select private.is_member(household_id)));
create policy household_people_update on public.household_people
  for update to authenticated
  using ((select private.is_member(household_id)))
  with check ((select private.is_member(household_id)));
