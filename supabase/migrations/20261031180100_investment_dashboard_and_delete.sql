-- Tudo Azul — migration 031: integração patrimonial e histórico da carteira de investimentos.
-- Ativos sem eventos podem ser excluídos; operações e avaliações permanecem imutáveis.
-- BRL entra no patrimônio consolidado. USD/EUR seguem segregados até existir conversão validada.

create or replace function private.seed_default_categories(p_household uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.categories (household_id, name, type) values
    (p_household, 'Salário', 'income'),
    (p_household, 'Rendimentos', 'income'),
    (p_household, 'Outras receitas', 'income'),
    (p_household, 'Moradia', 'expense'),
    (p_household, 'Financiamento', 'expense'),
    (p_household, 'Mercado', 'expense'),
    (p_household, 'Restaurantes', 'expense'),
    (p_household, 'Transporte', 'expense'),
    (p_household, 'Saúde', 'expense'),
    (p_household, 'Educação', 'expense'),
    (p_household, 'Lazer', 'expense'),
    (p_household, 'Assinaturas', 'expense'),
    (p_household, 'Compras pessoais', 'expense'),
    (p_household, 'Viagens', 'expense'),
    (p_household, 'Impostos e taxas', 'expense'),
    (p_household, 'Outras despesas', 'expense');
  insert into public.categories (household_id, name, type, system_key) values
    (p_household, 'Sem categoria', 'income', 'uncategorized'),
    (p_household, 'Sem categoria', 'expense', 'uncategorized');
end $$;
revoke execute on function private.seed_default_categories(uuid) from public, anon, authenticated;

-- Corrige grafias antigas, quando existirem, e garante a categoria nas famílias já criadas.
update public.categories
   set name = 'Financiamento'
 where type = 'expense'
   and lower(btrim(name)) in ('financiamenyo', 'financiamyto', 'financiameto', 'financiamentoo');

insert into public.categories (household_id, name, type)
select h.id, 'Financiamento', 'expense'
  from public.households h
 where not exists (
   select 1 from public.categories c
    where c.household_id = h.id and c.type = 'expense'
      and lower(btrim(c.name)) = 'financiamento'
 );

create function public.family_asset_delete(p_asset uuid) returns void
language plpgsql security definer set search_path = '' as $
declare v_asset public.family_assets%rowtype; v_count integer;
begin
  if auth.uid() is null then raise exception 'não autenticado' using errcode = '42501'; end if;
  select * into v_asset from public.family_assets where id = p_asset for update;
  if not found or not private.is_member(v_asset.household_id) then
    raise exception 'bem não encontrado' using errcode = '42501';
  end if;
  if v_asset.status <> 'active' then
    raise exception 'bem vendido ou baixado não pode ser excluído; o histórico deve ser preservado.' using errcode = '55000';
  end if;
  select count(*) into v_count from public.family_asset_valuations
   where household_id = v_asset.household_id and asset_id = v_asset.id;
  if v_count > 1 then
    raise exception 'Este bem possui histórico de avaliações. Encerre o bem para preservar o histórico.' using errcode = '55000';
  end if;
  delete from public.family_asset_valuations where household_id = v_asset.household_id and asset_id = v_asset.id;
  delete from public.family_assets where household_id = v_asset.household_id and id = v_asset.id;
end $;

create function public.investment_asset_delete(p_asset uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_asset public.investment_assets%rowtype;
begin
  if auth.uid() is null then
    raise exception 'não autenticado' using errcode = '42501';
  end if;
  select * into v_asset
    from public.investment_assets
   where id = p_asset
   for update;
  if not found or not private.is_member(v_asset.household_id) then
    raise exception 'ativo não encontrado' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.investment_operations
     where household_id = v_asset.household_id and asset_id = v_asset.id
  ) or exists (
    select 1 from public.investment_valuations
     where household_id = v_asset.household_id and asset_id = v_asset.id
  ) then
    raise exception 'Este ativo possui operações ou avaliações. O histórico financeiro não pode ser excluído.'
      using errcode = '55000';
  end if;
  delete from public.investment_assets where id = v_asset.id and household_id = v_asset.household_id;
end $$;

create function public.investment_history(p_household uuid, p_from date, p_to date)
returns table(month date, currency_code text, market_value numeric, cost_basis numeric)
language sql stable security invoker set search_path = '' as $$
  with meses as (
    select generate_series(
      date_trunc('month', p_from)::date,
      date_trunc('month', p_to)::date,
      interval '1 month'
    )::date as mes
  ), moedas as (
    select distinct a.currency_code
      from public.investment_assets a
     where a.household_id = p_household and a.active
  )
  select m.mes, c.currency_code,
         coalesce(t.market_value, 0)::numeric,
         coalesce(t.cost_basis, 0)::numeric
    from meses m
    cross join moedas c
    left join lateral (
      select sum(p.market_value) as market_value, sum(p.cost_basis) as cost_basis
        from public.investment_portfolio(
          p_household,
          least((m.mes + interval '1 month - 1 day')::date, p_to)
        ) p
       where p.currency_code = c.currency_code
    ) t on true
   where p_household is not null and p_from is not null and p_to is not null
     and p_from <= p_to and private.is_member(p_household)
   order by m.mes, c.currency_code
$$;

create function public.net_worth_with_investments(p_household uuid, p_as_of date)
returns table(
  available numeric,
  debt numeric,
  credit_receivable numeric,
  investments_brl numeric,
  family_assets_brl numeric,
  net_worth numeric,
  planned_commitments numeric
)
language sql stable security invoker set search_path = '' as $$
  select s.available, s.debt, s.cr, s.investments_brl, s.family_assets_brl,
         s.available + s.cr + s.investments_brl + s.family_assets_brl - s.debt,
         s.pc
    from (
      select
        coalesce((select sum(b.balance) from public.account_balances(p_household, p_as_of) b), 0) as available,
        coalesce((select sum(x.debt) from public.debt_balances(p_household, p_as_of) x), 0) as debt,
        coalesce((select sum(x.credit_receivable) from public.debt_balances(p_household, p_as_of) x), 0) as cr,
        coalesce((
          select sum(t.market_value)
            from public.investment_totals(p_household, p_as_of) t
           where t.currency_code = 'BRL'
        ), 0) as investments_brl,
        coalesce((
          select sum(v.total_value * a.household_share / 100)
            from public.family_assets a
            join lateral (
              select x.total_value from public.family_asset_valuations x
               where x.household_id = a.household_id and x.asset_id = a.id
                 and x.valuation_date <= p_as_of
               order by x.valuation_date desc, x.created_at desc limit 1
            ) v on true
           where a.household_id = p_household and a.currency_code = 'BRL'
             and coalesce(a.acquired_on, a.created_at::date) <= p_as_of
             and (a.status = 'active' or (a.status in ('sold','disposed') and a.ended_on > p_as_of))
        ), 0) as family_assets_brl,
        coalesce((select sum(x.planned_remaining) from public.debt_balances(p_household, p_as_of) x), 0) as pc
    ) s
   where (select private.is_member(p_household))
$$;

revoke execute on function public.family_asset_delete(uuid), public.investment_asset_delete(uuid),
  public.investment_history(uuid,date,date),
  public.net_worth_with_investments(uuid,date)
  from public, anon;
grant execute on function public.family_asset_delete(uuid), public.investment_asset_delete(uuid),
  public.investment_history(uuid,date,date),
  public.net_worth_with_investments(uuid,date)
  to authenticated;
