-- Tudo Azul — regras automáticas de classificação (edição 2026.3)
-- Regras sugerem categorias; não alteram lançamentos existentes nem valores.
create table public.transaction_rules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description_contains text not null check (char_length(btrim(description_contains)) between 1 and 100),
  type text not null check (type in ('income', 'expense')),
  category_id uuid not null,
  category_type text generated always as (type) stored,
  priority smallint not null default 0 check (priority between -1000 and 1000),
  active boolean not null default true,
  created_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transaction_rules_category_fk foreign key (household_id, category_id, category_type)
    references public.categories (household_id, id, type) deferrable initially immediate
);
create index transaction_rules_household_active_idx
  on public.transaction_rules (household_id, active, priority desc);
create unique index transaction_rules_name_uq
  on public.transaction_rules (household_id, lower(btrim(name)));

alter table public.transaction_rules enable row level security;

grant select on public.transaction_rules to authenticated;
grant insert (household_id, name, description_contains, type, category_id, priority, active)
  on public.transaction_rules to authenticated;
grant update (name, description_contains, type, category_id, priority, active)
  on public.transaction_rules to authenticated;
grant delete on public.transaction_rules to authenticated;

create policy transaction_rules_select on public.transaction_rules
  for select to authenticated using ((select private.is_member(household_id)));
create policy transaction_rules_insert on public.transaction_rules
  for insert to authenticated
  with check ((select private.is_member(household_id)) and created_by = (select auth.uid()));
create policy transaction_rules_update on public.transaction_rules
  for update to authenticated
  using ((select private.is_member(household_id)))
  with check ((select private.is_member(household_id)));
create policy transaction_rules_delete on public.transaction_rules
  for delete to authenticated using ((select private.is_member(household_id)));

create trigger transaction_rules_updated_at
  before update on public.transaction_rules
  for each row execute function private.touch_updated_at();
