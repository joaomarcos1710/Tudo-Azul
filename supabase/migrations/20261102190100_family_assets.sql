-- Tudo Azul: módulo de bens e patrimônio familiar
-- Valores originais são preservados; participação familiar é aplicada no cálculo de cada avaliação.
create table public.family_assets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  asset_type text not null check (asset_type in ('real_estate','vehicle','collectible','other')),
  description text check (description is null or char_length(description) <= 1000),
  currency_code text not null references public.currencies(code),
  ownership_label text not null check (char_length(btrim(ownership_label)) between 1 and 100),
  household_share numeric not null check (household_share > 0 and household_share <= 100 and household_share = round(household_share, 4)),
  acquired_on date check (acquired_on is null or acquired_on between date '1900-01-01' and date '2100-01-01'),
  status text not null default 'active' check (status in ('active','sold','disposed')),
  ended_on date check (ended_on is null or ended_on between date '1900-01-01' and date '2100-01-01'),
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (household_id,id),
  check ((status='active' and ended_on is null) or (status<>'active' and ended_on is not null))
);
create index family_assets_household_idx on public.family_assets(household_id,status,name);

create table public.family_asset_valuations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  asset_id uuid not null,
  valuation_date date not null check (valuation_date between date '1900-01-01' and date '2100-01-01'),
  total_value numeric not null check (total_value > 0 and total_value = round(total_value,2) and abs(total_value) < 1e12),
  source text not null check (char_length(btrim(source)) between 1 and 100),
  notes text check (notes is null or char_length(notes) <= 500),
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint family_asset_valuations_asset_fk foreign key (household_id,asset_id)
    references public.family_assets(household_id,id)
);
create index family_asset_valuations_history_idx
  on public.family_asset_valuations(household_id,asset_id,valuation_date desc,created_at desc);

alter table public.family_assets enable row level security;
alter table public.family_asset_valuations enable row level security;
create policy family_assets_select on public.family_assets
  for select to authenticated using ((select private.is_member(household_id)));
create policy family_asset_valuations_select on public.family_asset_valuations
  for select to authenticated using ((select private.is_member(household_id)));
revoke all on public.family_assets,public.family_asset_valuations from public,anon,authenticated;
grant select on public.family_assets,public.family_asset_valuations to authenticated;

create function public.family_asset_create(
  p_household uuid,p_name text,p_type text,p_description text,p_currency text,
  p_owner text,p_share numeric,p_acquired date,p_initial_value numeric,p_valuation_date date,p_source text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'não autenticado' using errcode='42501'; end if;
  if p_household is null or not private.is_member(p_household) then
    raise exception 'família não autorizada' using errcode='42501';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 120
     or p_type not in ('real_estate','vehicle','collectible','other')
     or p_owner is null or char_length(btrim(p_owner)) not between 1 and 100
     or p_share is null or p_share<=0 or p_share>100 or p_share<>round(p_share,4)
     or not exists(select 1 from public.currencies c where c.code=p_currency and c.enabled)
     or p_initial_value is null or p_initial_value<=0 or p_initial_value<>round(p_initial_value,2)
     or abs(p_initial_value)>=1e12 or p_valuation_date is null
     or p_valuation_date>private.today_sp() or p_source is null
     or char_length(btrim(p_source)) not between 1 and 100
     or (p_acquired is not null and p_acquired>private.today_sp()) then
    raise exception 'dados do bem inválidos' using errcode='22023';
  end if;
  insert into public.family_assets(household_id,name,asset_type,description,currency_code,ownership_label,household_share,acquired_on,created_by)
  values(p_household,btrim(p_name),p_type,nullif(btrim(p_description),''),p_currency,btrim(p_owner),p_share,p_acquired,auth.uid())
  returning id into v_id;
  insert into public.family_asset_valuations(household_id,asset_id,valuation_date,total_value,source,created_by)
  values(p_household,v_id,p_valuation_date,p_initial_value,btrim(p_source),auth.uid());
  return v_id;
end $$;

create function public.family_asset_valuation_record(
  p_asset uuid,p_date date,p_value numeric,p_source text,p_notes text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_asset public.family_assets%rowtype; v_id uuid;
begin
  if auth.uid() is null then raise exception 'não autenticado' using errcode='42501'; end if;
  select * into v_asset from public.family_assets where id=p_asset for update;
  if not found or not private.is_member(v_asset.household_id) then
    raise exception 'bem não encontrado' using errcode='42501';
  end if;
  if v_asset.status<>'active' or p_date is null or p_date>private.today_sp()
     or p_value is null or p_value<=0 or p_value<>round(p_value,2) or abs(p_value)>=1e12
     or p_source is null or char_length(btrim(p_source)) not between 1 and 100
     or (p_notes is not null and char_length(p_notes)>500) then
    raise exception 'avaliação inválida' using errcode='22023';
  end if;
  insert into public.family_asset_valuations(household_id,asset_id,valuation_date,total_value,source,notes,created_by)
  values(v_asset.household_id,v_asset.id,p_date,p_value,btrim(p_source),p_notes,auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create function public.family_asset_end(p_asset uuid,p_status text,p_date date)
returns void language plpgsql security definer set search_path = '' as $$
declare v_asset public.family_assets%rowtype;
begin
  if auth.uid() is null then raise exception 'não autenticado' using errcode='42501'; end if;
  select * into v_asset from public.family_assets where id=p_asset for update;
  if not found or not private.is_member(v_asset.household_id) then
    raise exception 'bem não encontrado' using errcode='42501';
  end if;
  if v_asset.status<>'active' or p_status not in ('sold','disposed') or p_date is null
     or p_date>private.today_sp() then
    raise exception 'encerramento inválido' using errcode='22023';
  end if;
  update public.family_assets set status=p_status,ended_on=p_date where id=p_asset;
end $$;

revoke execute on function public.family_asset_create(uuid,text,text,text,text,text,numeric,date,numeric,date,text),
  public.family_asset_valuation_record(uuid,date,numeric,text,text),public.family_asset_end(uuid,text,date) from public,anon;
grant execute on function public.family_asset_create(uuid,text,text,text,text,text,numeric,date,numeric,date,text),
  public.family_asset_valuation_record(uuid,date,numeric,text,text),public.family_asset_end(uuid,text,date) to authenticated;
