-- Preferências individuais e saída segura da família.
create table public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  ordem_lancamentos text not null default 'desc' check (ordem_lancamentos in ('asc','desc')),
  periodo_padrao text not null default 'monthly' check (periodo_padrao in ('daily','weekly','monthly')),
  saldo_diario boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.user_preferences enable row level security;
revoke all on public.user_preferences from public, anon;
grant select on public.user_preferences to authenticated;
grant insert (user_id, ordem_lancamentos, periodo_padrao, saldo_diario, updated_at),
  update (ordem_lancamentos, periodo_padrao, saldo_diario, updated_at)
  on public.user_preferences to authenticated;
grant all on public.user_preferences to service_role;
create policy user_preferences_select_own on public.user_preferences
  for select to authenticated using ((select auth.uid()) = user_id);
create policy user_preferences_insert_own on public.user_preferences
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy user_preferences_update_own on public.user_preferences
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Preserva registros históricos ao apagar o perfil: remove apenas a autoria pessoal, não o dado familiar.
alter table public.family_assets alter column created_by drop not null;
alter table public.family_assets drop constraint family_assets_created_by_fkey;
alter table public.family_assets add constraint family_assets_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;
alter table public.family_asset_valuations alter column created_by drop not null;
alter table public.family_asset_valuations drop constraint family_asset_valuations_created_by_fkey;
alter table public.family_asset_valuations add constraint family_asset_valuations_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;
alter table public.investment_distributions alter column created_by drop not null;
alter table public.investment_distributions drop constraint investment_distributions_created_by_fkey;
alter table public.investment_distributions add constraint investment_distributions_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;
alter table public.investment_operations alter column created_by drop not null;
alter table public.investment_operations drop constraint investment_operations_created_by_fkey;
alter table public.investment_operations add constraint investment_operations_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;
alter table public.investment_operations drop constraint investment_operations_voided_by_fkey;
alter table public.investment_operations add constraint investment_operations_voided_by_fkey
  foreign key (voided_by) references public.profiles(id) on delete set null;
alter table public.investment_valuations alter column created_by drop not null;
alter table public.investment_valuations drop constraint investment_valuations_created_by_fkey;
alter table public.investment_valuations add constraint investment_valuations_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

-- Executada apenas pela Edge Function após validar o JWT do próprio usuário.
-- O lock da família serializa a transferência com convites/remoções de membros.
create or replace function public.prepare_account_deletion(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household uuid;
  v_role text;
  v_successor uuid;
  v_other_members integer;
  v_has_storage boolean := false;
begin
  if p_user_id is null then
    raise exception 'Usuário inválido.' using errcode = '22023';
  end if;

  if to_regclass('storage.objects') is not null then
    execute 'select exists (select 1 from storage.objects where owner = $1 or owner_id = $2)'
      into v_has_storage using p_user_id, p_user_id::text;
    if v_has_storage then
      raise exception 'Sua conta ainda possui arquivos no armazenamento. Transfira ou remova esses arquivos antes de excluir a conta.';
    end if;
  end if;

  select hm.household_id, hm.role into v_household, v_role
  from public.household_members hm
  where hm.user_id = p_user_id;

  if not found then
    return jsonb_build_object('household_id', null, 'previous_role', null, 'successor_id', null);
  end if;

  perform 1 from public.households h where h.id = v_household for update;
  select hm.household_id, hm.role into v_household, v_role
  from public.household_members hm
  where hm.user_id = p_user_id for update;

  if v_role = 'owner' then
    select count(*) into v_other_members
    from public.household_members hm
    where hm.household_id = v_household and hm.user_id <> p_user_id;
    if v_other_members <> 1 then
      raise exception 'Para preservar a família, deixe exatamente um outro membro antes de excluir esta conta.';
    end if;

    select hm.user_id into v_successor
    from public.household_members hm
    where hm.household_id = v_household and hm.user_id <> p_user_id
    for update;

    update public.household_members
    set role = 'owner'
    where household_id = v_household and user_id = v_successor;
  end if;

  return jsonb_build_object(
    'household_id', v_household,
    'previous_role', v_role,
    'successor_id', v_successor
  );
end;
$$;
revoke all on function public.prepare_account_deletion(uuid) from public, anon, authenticated;
grant execute on function public.prepare_account_deletion(uuid) to service_role;

-- Se a API Auth recusar a exclusão, desfaz a promoção para não deixar dois titulares.
create or replace function public.rollback_account_deletion(p_state jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household uuid := nullif(p_state->>'household_id', '')::uuid;
  v_role text := p_state->>'previous_role';
  v_successor uuid := nullif(p_state->>'successor_id', '')::uuid;
  v_user uuid := nullif(p_state->>'user_id', '')::uuid;
begin
  if v_household is null or v_role is distinct from 'owner' or v_successor is null or v_user is null then
    return;
  end if;
  perform 1 from public.households h where h.id = v_household for update;
  update public.household_members set role = 'member'
  where household_id = v_household and user_id = v_successor;
  update public.household_members set role = 'owner'
  where household_id = v_household and user_id = v_user;
end;
$$;
revoke all on function public.rollback_account_deletion(jsonb) from public, anon, authenticated;
grant execute on function public.rollback_account_deletion(jsonb) to service_role;



-- Série de saldos de fechamento por dia, usando a mesma fonte oficial de saldo das contas.
-- Não converte moedas: devolve um total separado para cada moeda em cada data.
create or replace function public.account_balances_daily(p_household uuid, p_from date, p_to date)
returns table(balance_date date, currency_code text, balance numeric)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_household is null or p_from is null or p_to is null or p_to < p_from or (p_to - p_from) > 366 then
    raise exception 'Informe um intervalo válido de até 367 dias.' using errcode = '22023';
  end if;
  if not private.is_member(p_household) then
    raise exception 'Você não participa desta família.' using errcode = '42501';
  end if;
  return query
  select dias.dia::date, b.currency_code, sum(b.balance)::numeric
  from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') as dias(dia)
  cross join lateral public.account_balances(p_household, dias.dia::date) b
  group by dias.dia::date, b.currency_code
  order by dias.dia::date, b.currency_code;
end;
$$;
revoke all on function public.account_balances_daily(uuid, date, date) from public, anon;
grant execute on function public.account_balances_daily(uuid, date, date) to authenticated;

-- Limpa somente os lançamentos da família. Contas, categorias, cartões, contratos,
-- recorrências, investimentos e bens ficam. Proventos ligados a um lançamento são
-- dependentes desse lançamento e seguem a FK ON DELETE CASCADE existente.
create or replace function public.clear_household_transactions(p_household uuid, p_confirmation text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_deleted bigint;
  v_distributions bigint;
begin
  if v_uid is null then
    raise exception 'Não autenticado.' using errcode = '42501';
  end if;
  if p_household is null or not private.is_owner(p_household) then
    raise exception 'Somente o titular da família pode excluir os lançamentos.' using errcode = '42501';
  end if;
  if lower(btrim(coalesce(p_confirmation, ''))) <> 'excluir transações' then
    raise exception 'Confirmação incorreta. Escreva "excluir transações".' using errcode = '22023';
  end if;

  perform 1 from public.households h where h.id = p_household for update;
  select count(*) into v_distributions
  from public.investment_distributions d
  join public.transactions t on t.id = d.transaction_id
  where t.household_id = p_household;

  with deleted as (
    delete from public.transactions t
    where t.household_id = p_household
    returning 1
  )
  select count(*) into v_deleted from deleted;

  return jsonb_build_object('transactions_deleted', v_deleted, 'investment_distributions_deleted', v_distributions);
end;
$$;
revoke all on function public.clear_household_transactions(uuid, text) from public, anon;
grant execute on function public.clear_household_transactions(uuid, text) to authenticated;
