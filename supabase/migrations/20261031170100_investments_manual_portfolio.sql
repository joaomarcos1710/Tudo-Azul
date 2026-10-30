-- Tudo Azul — migration 030: carteira de investimentos manual
-- A posição é derivada do livro de operações; avaliações são observações históricas.
-- Esta etapa não movimenta contas bancárias nem altera despesas/receitas.
-- A integração de caixa será feita numa fase própria para evitar dupla contagem.

create table public.investment_assets (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  name          text not null check (char_length(btrim(name)) between 1 and 100),
  ticker        text check (ticker is null or char_length(btrim(ticker)) between 1 and 20),
  asset_class   text not null check (asset_class in ('fixed_income','equity','fund','reit','etf','crypto','other')),
  currency_code text not null references public.currencies(code),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (household_id, id)
);
create index investment_assets_household_idx on public.investment_assets(household_id, active, name);
create unique index investment_assets_name_uq
  on public.investment_assets(household_id, lower(btrim(name)), currency_code);

create table public.investment_operations (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  asset_id      uuid not null,
  operation_date date not null check (operation_date between date '2000-01-01' and date '2100-01-01'),
  kind          text not null check (kind in ('buy','sell')),
  quantity      numeric not null check (quantity > 0 and quantity = round(quantity, 12) and abs(quantity) < 1e18),
  unit_price    numeric not null check (unit_price > 0 and unit_price = round(unit_price, 10) and abs(unit_price) < 1e12),
  fees          numeric not null default 0 check (fees >= 0 and fees = round(fees, 2) and abs(fees) < 1e12),
  notes         text check (char_length(notes) <= 500),
  created_by    uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at    timestamptz not null default now(),
  constraint investment_operations_asset_fk foreign key (household_id, asset_id)
    references public.investment_assets(household_id, id) deferrable initially immediate
);
create index investment_operations_asset_date_idx
  on public.investment_operations(household_id, asset_id, operation_date, created_at);

create table public.investment_valuations (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references public.households(id) on delete cascade,
  asset_id       uuid not null,
  valuation_date date not null check (valuation_date between date '2000-01-01' and date '2100-01-01'),
  unit_price     numeric not null check (unit_price > 0 and unit_price = round(unit_price, 10) and abs(unit_price) < 1e12),
  source         text not null check (char_length(btrim(source)) between 1 and 80),
  created_by     uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at     timestamptz not null default now(),
  constraint investment_valuations_asset_fk foreign key (household_id, asset_id)
    references public.investment_assets(household_id, id) deferrable initially immediate
);
create index investment_valuations_asset_date_idx
  on public.investment_valuations(household_id, asset_id, valuation_date desc, created_at desc);

alter table public.investment_assets enable row level security;
alter table public.investment_operations enable row level security;
alter table public.investment_valuations enable row level security;

create policy investment_assets_select on public.investment_assets
  for select to authenticated using ((select private.is_member(household_id)));
create policy investment_operations_select on public.investment_operations
  for select to authenticated using ((select private.is_member(household_id)));
create policy investment_valuations_select on public.investment_valuations
  for select to authenticated using ((select private.is_member(household_id)));

-- Sem escrita direta no cliente: criação, operações e avaliações passam pelas RPCs.
revoke all on public.investment_assets, public.investment_operations, public.investment_valuations
  from public, anon, authenticated;
grant select on public.investment_assets, public.investment_operations, public.investment_valuations
  to authenticated;

create function public.investment_asset_create(
  p_household uuid, p_name text, p_ticker text, p_class text, p_currency text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'não autenticado' using errcode = '42501'; end if;
  if p_household is null or not private.is_member(p_household) then
    raise exception 'família não autorizada' using errcode = '42501';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 100
     or (p_ticker is not null and char_length(btrim(p_ticker)) not between 1 and 20)
     or p_class not in ('fixed_income','equity','fund','reit','etf','crypto','other') then
    raise exception 'dados do ativo inválidos' using errcode = '22023';
  end if;
  if not exists (select 1 from public.currencies c where c.code = p_currency and c.enabled) then
    raise exception 'moeda não habilitada' using errcode = '22023';
  end if;
  insert into public.investment_assets(household_id,name,ticker,asset_class,currency_code)
  values (p_household,btrim(p_name),nullif(btrim(p_ticker),''),p_class,p_currency)
  returning id into v_id;
  return v_id;
end $$;

create function public.investment_operation_record(
  p_asset uuid, p_date date, p_kind text, p_quantity numeric,
  p_unit_price numeric, p_fees numeric default 0, p_notes text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_asset public.investment_assets%rowtype;
  v_held numeric;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'não autenticado' using errcode = '42501'; end if;
  select * into v_asset from public.investment_assets where id = p_asset for update;
  if not found or not private.is_member(v_asset.household_id) then
    raise exception 'ativo não encontrado' using errcode = '42501';
  end if;
  if not v_asset.active then raise exception 'ativo arquivado' using errcode = '55000'; end if;
  if p_date is null or p_date > current_date or p_date < date '2000-01-01'
     or p_kind not in ('buy','sell') or p_quantity is null or p_quantity <= 0
     or p_quantity <> round(p_quantity,12)
     or p_unit_price is null or p_unit_price <= 0 or p_unit_price <> round(p_unit_price,10)
     or p_fees is null or p_fees < 0 or p_fees <> round(p_fees,2)
     or abs(p_quantity) >= 1e18 or abs(p_unit_price) >= 1e12 or abs(p_fees) >= 1e12
     or (p_notes is not null and char_length(p_notes) > 500) then
    raise exception 'dados da operação inválidos' using errcode = '22023';
  end if;
  if p_kind = 'sell' then
    select coalesce(sum(case when o.kind='buy' then o.quantity else -o.quantity end),0)
      into v_held from public.investment_operations o
     where o.asset_id = v_asset.id and o.household_id = v_asset.household_id
       and o.operation_date <= p_date;
    if p_quantity > v_held then
      raise exception 'quantidade vendida supera a posição disponível' using errcode = '23514';
    end if;
  end if;
  insert into public.investment_operations
    (household_id,asset_id,operation_date,kind,quantity,unit_price,fees,notes,created_by)
  values (v_asset.household_id,v_asset.id,p_date,p_kind,p_quantity,p_unit_price,p_fees,p_notes,auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create function public.investment_valuation_record(
  p_asset uuid, p_date date, p_unit_price numeric, p_source text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_asset public.investment_assets%rowtype; v_id uuid;
begin
  if auth.uid() is null then raise exception 'não autenticado' using errcode = '42501'; end if;
  select * into v_asset from public.investment_assets where id = p_asset for update;
  if not found or not private.is_member(v_asset.household_id) then
    raise exception 'ativo não encontrado' using errcode = '42501';
  end if;
  if p_date is null or p_date > current_date or p_date < date '2000-01-01'
     or p_unit_price is null or p_unit_price <= 0 or p_unit_price <> round(p_unit_price,10)
     or abs(p_unit_price) >= 1e12
     or p_source is null or char_length(btrim(p_source)) not between 1 and 80 then
    raise exception 'dados da avaliação inválidos' using errcode = '22023';
  end if;
  insert into public.investment_valuations
    (household_id,asset_id,valuation_date,unit_price,source,created_by)
  values (v_asset.household_id,v_asset.id,p_date,p_unit_price,btrim(p_source),auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Posição por ativo: custo médio ponderado das compras, já incluindo taxas de compra.
-- Vendas reduzem unidades pelo mesmo custo médio. Sem cotação manual, o custo é o valor de referência.
create or replace function public.investment_portfolio(p_household uuid, p_as_of date)
returns table (
  asset_id uuid, name text, ticker text, asset_class text, currency_code text,
  quantity numeric, average_cost numeric, cost_basis numeric, unit_price numeric,
  market_value numeric, unrealized_result numeric, valuation_date date, valuation_source text
)
language sql stable security invoker set search_path = '' as $$
  with recursive operations as (
    select o.asset_id, o.kind, o.quantity, o.unit_price, o.fees, o.operation_date, o.created_at, o.id,
      row_number() over (partition by o.asset_id order by o.operation_date, o.created_at, o.id) as rn
    from public.investment_operations o
    join public.investment_assets a on a.id=o.asset_id and a.household_id=o.household_id
    where o.household_id=p_household and o.operation_date <= p_as_of and a.active
  ), ledger as (
    select o.asset_id, o.rn,
      o.quantity as quantity,
      o.quantity*o.unit_price + o.fees as cost_basis
    from operations o where o.rn=1 and o.kind='buy'
    union all
    select o.asset_id, o.rn,
      case when o.kind='buy' then l.quantity+o.quantity else l.quantity-o.quantity end,
      case when o.kind='buy' then l.cost_basis + o.quantity*o.unit_price + o.fees
           else l.cost_basis - (l.cost_basis/nullif(l.quantity,0))*o.quantity end
    from ledger l
    join operations o on o.asset_id=l.asset_id and o.rn=l.rn+1
  ), positions as (
    select distinct on (l.asset_id) l.asset_id,l.quantity,l.cost_basis,
      case when l.quantity>0 then l.cost_basis/l.quantity else 0 end as avg_cost
    from ledger l order by l.asset_id,l.rn desc
  )
  select a.id,a.name,a.ticker,a.asset_class,a.currency_code,p.quantity,
    round(p.avg_cost,10),round(p.cost_basis,2),
    coalesce(v.unit_price,p.avg_cost),
    round(p.quantity*coalesce(v.unit_price,p.avg_cost),2),
    round(p.quantity*coalesce(v.unit_price,p.avg_cost)-p.cost_basis,2),
    v.valuation_date,v.source
  from positions p
  join public.investment_assets a on a.id=p.asset_id and a.household_id=p_household
  left join lateral (
    select x.unit_price,x.valuation_date,x.source
    from public.investment_valuations x
    where x.asset_id=p.asset_id and x.household_id=p_household and x.valuation_date<=p_as_of
    order by x.valuation_date desc,x.created_at desc limit 1
  ) v on true
  where p.quantity>0 and a.active
  order by a.currency_code,a.name
$$;

create function public.investment_totals(p_household uuid, p_as_of date)
returns table(currency_code text, cost_basis numeric, market_value numeric, unrealized_result numeric)
language sql stable security invoker set search_path = '' as $$
  select p.currency_code, sum(p.cost_basis), sum(p.market_value), sum(p.unrealized_result)
    from public.investment_portfolio(p_household,p_as_of) p
   group by p.currency_code order by p.currency_code
$$;

revoke execute on function public.investment_asset_create(uuid,text,text,text,text),
  public.investment_operation_record(uuid,date,text,numeric,numeric,numeric,text),
  public.investment_valuation_record(uuid,date,numeric,text),
  public.investment_portfolio(uuid,date), public.investment_totals(uuid,date)
  from public, anon;
grant execute on function public.investment_asset_create(uuid,text,text,text,text),
  public.investment_operation_record(uuid,date,text,numeric,numeric,numeric,text),
  public.investment_valuation_record(uuid,date,numeric,text),
  public.investment_portfolio(uuid,date), public.investment_totals(uuid,date)
  to authenticated;
