-- Tudo Azul — migration 001 (3/5): privilégios, funções auxiliares e RLS
--
-- ATENÇÃO — RLS não protege funções SECURITY DEFINER: elas executam como o dono
-- e ignoram a RLS. As auxiliares abaixo só respondem sobre o próprio auth.uid().
-- A segurança das RPCs (migration 4) vem de verificações internas explícitas.

-- ---------------------------------------------------------------------------
-- 1. Revogar o que o Supabase concede por padrão
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
-- o EXECUTE para PUBLIC é um padrão global do PostgreSQL (não é por schema)
alter default privileges revoke execute on functions from public;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Funções auxiliares de RLS (SECURITY DEFINER, só sobre o próprio usuário)
-- ---------------------------------------------------------------------------
create function private.is_member(p_household uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select true from public.household_members m
     where m.household_id = p_household and m.user_id = (select auth.uid())
  ), false)
$$;

create function private.is_owner(p_household uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select true from public.household_members m
     where m.household_id = p_household and m.user_id = (select auth.uid()) and m.role = 'owner'
  ), false)
$$;

create function private.shares_household(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select true
      from public.household_members a
      join public.household_members b on b.household_id = a.household_id
     where a.user_id = (select auth.uid()) and b.user_id = p_user
     limit 1
  ), false)
$$;

revoke execute on function private.is_member(uuid), private.is_owner(uuid),
  private.shares_household(uuid) from public, anon;
grant execute on function private.is_member(uuid), private.is_owner(uuid),
  private.shares_household(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Privilégios de tabela e de coluna (authenticated). anon: nada.
-- ---------------------------------------------------------------------------
grant select on public.profiles to authenticated;
grant update (name) on public.profiles to authenticated;

grant select on public.households to authenticated;
grant update (name) on public.households to authenticated;       -- member_limit: só quem administra o banco

grant select on public.household_members to authenticated;       -- escrita: só por RPC

grant select (id, household_id, email, role, invited_by, created_at, expires_at, accepted_at, accepted_by)
  on public.invitations to authenticated;                        -- sem token_hash; escrita: só por RPC

grant select, delete on public.accounts to authenticated;
grant insert (household_id, name, type, initial_balance, opening_date, active) on public.accounts to authenticated;
grant update (name, type, initial_balance, opening_date, active) on public.accounts to authenticated;

grant select, delete on public.categories to authenticated;
grant insert (household_id, name, type, parent_id, color, icon, active) on public.categories to authenticated;
grant update (name, parent_id, color, icon, active) on public.categories to authenticated;

grant select on public.transactions to authenticated;            -- sem DELETE: lixeira = UPDATE deleted_at
grant insert (household_id, account_id, destination_account_id, category_id, type, description,
              amount, date, status, notes) on public.transactions to authenticated;
grant update (account_id, destination_account_id, category_id, type, description,
              amount, date, status, notes, deleted_at) on public.transactions to authenticated;

grant select, delete on public.budgets to authenticated;
grant insert (household_id, category_id, month, amount_limit) on public.budgets to authenticated;
grant update (amount_limit) on public.budgets to authenticated;

-- ---------------------------------------------------------------------------
-- 4. RLS: ligada em todas as tabelas; uma policy por operação, TO authenticated
-- ---------------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.households        enable row level security;
alter table public.household_members enable row level security;
alter table public.invitations       enable row level security;
alter table public.accounts          enable row level security;
alter table public.categories        enable row level security;
alter table public.transactions      enable row level security;
alter table public.budgets           enable row level security;

create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.shares_household(id)));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy households_select on public.households for select to authenticated
  using ((select private.is_member(id)));
create policy households_update on public.households for update to authenticated
  using ((select private.is_owner(id))) with check ((select private.is_owner(id)));

create policy household_members_select on public.household_members for select to authenticated
  using ((select private.is_member(household_id)));

create policy invitations_select on public.invitations for select to authenticated
  using ((select private.is_owner(household_id)));

create policy accounts_select on public.accounts for select to authenticated
  using ((select private.is_member(household_id)));
create policy accounts_insert on public.accounts for insert to authenticated
  with check ((select private.is_member(household_id)));
create policy accounts_update on public.accounts for update to authenticated
  using ((select private.is_member(household_id))) with check ((select private.is_member(household_id)));
create policy accounts_delete on public.accounts for delete to authenticated
  using ((select private.is_member(household_id)));

create policy categories_select on public.categories for select to authenticated
  using ((select private.is_member(household_id)));
create policy categories_insert on public.categories for insert to authenticated
  with check ((select private.is_member(household_id)));
create policy categories_update on public.categories for update to authenticated
  using ((select private.is_member(household_id))) with check ((select private.is_member(household_id)));
create policy categories_delete on public.categories for delete to authenticated
  using ((select private.is_member(household_id)));

create policy transactions_select on public.transactions for select to authenticated
  using ((select private.is_member(household_id)));
create policy transactions_insert on public.transactions for insert to authenticated
  with check ((select private.is_member(household_id)) and created_by = (select auth.uid()));
create policy transactions_update on public.transactions for update to authenticated
  using ((select private.is_member(household_id))) with check ((select private.is_member(household_id)));

create policy budgets_select on public.budgets for select to authenticated
  using ((select private.is_member(household_id)));
create policy budgets_insert on public.budgets for insert to authenticated
  with check ((select private.is_member(household_id)));
create policy budgets_update on public.budgets for update to authenticated
  using ((select private.is_member(household_id))) with check ((select private.is_member(household_id)));
create policy budgets_delete on public.budgets for delete to authenticated
  using ((select private.is_member(household_id)));
