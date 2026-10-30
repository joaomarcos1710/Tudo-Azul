-- Tudo Azul — migration 027: catálogo de moedas e fundação de câmbio
--
-- Esta etapa NÃO habilita contas ou lançamentos em moeda estrangeira. Isso só
-- será feito numa migration posterior que também substitua, de forma compatível,
-- todas as RPCs de saldo, projeção, orçamento e relatórios.
--
-- A fundação oferece catálogo BRL/USD/EUR, moeda de consolidação por família,
-- armazenamento auditável de cotações e consulta direta/inversa com limite de 7 dias.
-- Não há ingestão automática nesta etapa.

create table public.currencies (
  code       text primary key check (code ~ '^[A-Z]{3}$'),
  name       text not null check (char_length(btrim(name)) between 1 and 80),
  symbol     text not null check (char_length(symbol) between 1 and 8),
  minor_unit smallint not null check (minor_unit between 0 and 4),
  enabled    boolean not null default true
);

insert into public.currencies (code, name, symbol, minor_unit) values
  ('BRL', 'Real brasileiro', 'R$', 2),
  ('USD', 'Dólar americano', 'US$', 2),
  ('EUR', 'Euro', '€', 2);

alter table public.households
  add column report_currency text not null default 'BRL'
  constraint households_report_currency_fk references public.currencies(code);

grant select on public.currencies to authenticated;
grant update (report_currency) on public.households to authenticated;

alter table public.currencies enable row level security;
create policy currencies_select on public.currencies
  for select to authenticated using (true);

-- Taxa = unidades da moeda quote por 1 unidade da moeda base.
create table public.fx_rates (
  id         bigint generated always as identity primary key,
  base       text not null references public.currencies(code),
  quote      text not null references public.currencies(code),
  rate       numeric not null check (rate > 0 and rate < 1e12),
  rate_date  date not null check (rate_date <= current_date),
  source     text not null check (char_length(btrim(source)) between 1 and 80),
  fetched_at timestamptz not null default now(),
  check (base <> quote),
  unique (base, quote, rate_date)
);

create index fx_rates_lookup_idx on public.fx_rates (base, quote, rate_date desc);

grant select on public.fx_rates to authenticated;
alter table public.fx_rates enable row level security;
create policy fx_rates_select on public.fx_rates
  for select to authenticated using (true);

create function private.fx_rates_immutable() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'cotação é imutável; registre uma correção auditável' using errcode = '42501';
end $$;

create trigger fx_rates_immutable
  before update or delete on public.fx_rates
  for each row execute function private.fx_rates_immutable();

create function public.fx_rate_at(p_base text, p_quote text, p_date date)
returns table (rate numeric, rate_date date, derived boolean, legs smallint, age_days integer)
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_rate numeric;
  v_date date;
begin
  if p_base is null or p_quote is null or p_date is null then return; end if;

  if not exists (select 1 from public.currencies c where c.code = p_base and c.enabled)
     or not exists (select 1 from public.currencies c where c.code = p_quote and c.enabled) then
    return;
  end if;

  if p_base = p_quote then
    return query select 1::numeric, p_date, false, 0::smallint, 0;
    return;
  end if;

  select r.rate, r.rate_date into v_rate, v_date
    from public.fx_rates r
   where r.base = p_base and r.quote = p_quote
     and r.rate_date <= p_date and r.rate_date >= p_date - 7
   order by r.rate_date desc limit 1;

  if found then
    return query select v_rate, v_date, false, 1::smallint, (p_date - v_date);
    return;
  end if;

  select r.rate, r.rate_date into v_rate, v_date
    from public.fx_rates r
   where r.base = p_quote and r.quote = p_base
     and r.rate_date <= p_date and r.rate_date >= p_date - 7
   order by r.rate_date desc limit 1;

  if found then
    return query select 1::numeric / v_rate, v_date, true, 1::smallint, (p_date - v_date);
    return;
  end if;
  return;
end $$;

revoke execute on function public.fx_rate_at(text, text, date) from public, anon;
grant execute on function public.fx_rate_at(text, text, date) to authenticated;

revoke all on public.currencies, public.fx_rates from anon, authenticated;
grant select on public.currencies, public.fx_rates to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.currencies, public.fx_rates
  from anon, authenticated;

-- report_currency é alterável somente pelo owner, pois reutiliza a policy
-- households_update existente. Nenhuma outra coluna administrativa é liberada.
