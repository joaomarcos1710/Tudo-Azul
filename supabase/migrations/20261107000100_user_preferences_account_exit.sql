create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  ordem_lancamentos text not null default 'desc' check (ordem_lancamentos in ('asc','desc')),
  periodo_padrao text not null default 'monthly' check (periodo_padrao in ('daily','weekly','monthly')),
  saldo_diario boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.user_preferences enable row level security;
create policy "user_preferences_select_own" on public.user_preferences for select to authenticated using (user_id = auth.uid());
create policy "user_preferences_insert_own" on public.user_preferences for insert to authenticated with check (user_id = auth.uid());
create policy "user_preferences_update_own" on public.user_preferences for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- O serviço de exclusão chama esta função somente depois de validar o token do usuário.
-- Transfere a titularidade para o membro mais antigo e remove apenas o vínculo do usuário que está saindo.
create or replace function public.prepare_account_deletion(p_user_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare
  v_household uuid;
  v_role text;
  v_successor uuid;
begin
  select household_id, role into v_household, v_role
  from public.household_members where user_id = p_user_id for update;
  if v_household is null then return; end if;
  if v_role = 'owner' then
    select user_id into v_successor from public.household_members
    where household_id = v_household and user_id <> p_user_id
    order by joined_at asc limit 1 for update;
    if v_successor is null then
      raise exception 'Não há outro membro para assumir a família. Adicione um membro antes de excluir esta conta.';
    end if;
    update public.household_members set role = 'owner'
    where household_id = v_household and user_id = v_successor;
  end if;
  delete from public.household_members where household_id = v_household and user_id = p_user_id;
end;
$$;
revoke all on function public.prepare_account_deletion(uuid) from public, anon, authenticated;
grant execute on function public.prepare_account_deletion(uuid) to service_role;
