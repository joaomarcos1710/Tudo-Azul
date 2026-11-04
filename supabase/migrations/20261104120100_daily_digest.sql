-- Tudo Azul — migration 047: aviso diário por e-mail (parte do banco).
-- Decisão do dono (04/11/2026): canal e-mail, "esconder valores" ligado por padrão, e a opção 1 para o acesso do
-- servidor: private.is_member passa a dizer "sim" também para a service_role (a chave do servidor, que só existe nos
-- Secrets da Edge Function). Ela já ignora a RLS e lê tudo; a exceção só faz as funções de leitura (saldo previsto,
-- faturas, vencidos) responderem para a rotina das 7h, que roda sem ninguém logado. Uma fonte só para os números:
-- o aviso usa as mesmas funções que o app. Usuário comum: nada muda.
--
-- Esta migration cria:
--   * public.daily_digest_settings — preferência de cada pessoa (ligado, hora, esconder valores);
--   * private.daily_digest_log    — um envio por pessoa por dia (nunca dois);
--   * public.daily_digest(household, data) — o resumo do dia, calculado no banco;
--   * public.daily_digest_recipients / public.daily_digest_mark — só para a service_role (a Edge Function).
-- O agendamento (pg_cron) e a Edge Function vêm na PR 3.

-- 1. is_member: exceção para a service_role ----------------------------------
create or replace function private.is_member(p_household uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select auth.role()) = 'service_role', false)
      or coalesce((
           select true from public.household_members m
            where m.household_id = p_household and m.user_id = (select auth.uid())
         ), false)
$$;

grant usage on schema private to service_role;
grant execute on function private.is_member(uuid) to service_role;

-- 2. preferências ------------------------------------------------------------
create table public.daily_digest_settings (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  enabled      boolean not null default false,
  send_hour    smallint not null default 7 check (send_hour between 5 and 22),
  hide_values  boolean not null default true,
  updated_at   timestamptz not null default now()
);
alter table public.daily_digest_settings enable row level security;

-- cada pessoa vê e muda só a própria preferência, e só numa família da qual faz parte
create policy daily_digest_settings_select on public.daily_digest_settings for select to authenticated
  using (user_id = (select auth.uid()));
create policy daily_digest_settings_insert on public.daily_digest_settings for insert to authenticated
  with check (user_id = (select auth.uid()) and (select private.is_member(household_id)));
create policy daily_digest_settings_update on public.daily_digest_settings for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (select private.is_member(household_id)));

revoke all on public.daily_digest_settings from anon, authenticated;
grant select on public.daily_digest_settings to authenticated;
grant insert (user_id, household_id, enabled, send_hour, hide_values) on public.daily_digest_settings to authenticated;
grant update (household_id, enabled, send_hour, hide_values, updated_at) on public.daily_digest_settings to authenticated;

create trigger daily_digest_settings_touch before update on public.daily_digest_settings
  for each row execute function private.touch_updated_at();

-- 3. registro de envios ------------------------------------------------------
create table private.daily_digest_log (
  user_id      uuid not null references auth.users(id) on delete cascade,
  sent_on      date not null,
  household_id uuid not null references public.households(id) on delete cascade,
  status       text not null check (status in ('sent', 'skipped', 'failed')),
  detail       text check (char_length(detail) <= 500),
  created_at   timestamptz not null default now(),
  primary key (user_id, sent_on)
);
revoke all on private.daily_digest_log from public, anon, authenticated;

-- 4. o resumo do dia (mesmas fontes do app; nada calculado fora do banco) ----
create function public.daily_digest(p_household uuid, p_date date)
returns table (
  overdue_count     integer,  -- planejados que passaram da data (lançamentos e parcelas de dívida)
  overdue_expense   numeric,  -- quanto deles é saída
  today_count       integer,  -- planejados com data de hoje
  today_expense     numeric,
  invoices_count    integer,  -- faturas de cartão a pagar que vencem de hoje a hoje + 3
  invoices_due      numeric,
  next_invoice_date date,
  month_end         date,
  projected_balance numeric   -- saldo previsto no fim do mês (balance_totals_projected, o mesmo do Início)
)
language sql stable security invoker set search_path = '' as $$
  with lanc as (
    select t.date, t.type, t.amount
      from public.transactions t
     where t.household_id = p_household and t.status = 'planned' and t.deleted_at is null and t.date <= p_date
  ), parc as (
    select s.due_date as date, s.amount
      from public.debt_payment_schedule s
      join public.debts d on d.household_id = s.household_id and d.id = s.debt_id and d.active
     where s.household_id = p_household and s.status = 'planned' and s.due_date <= p_date
  ), fat as (
    select f.due_date, f.remaining
      from public.card_invoices_due(p_household, p_date, p_date + 3) f
     where f.remaining > 0
  ), fim as (
    select (date_trunc('month', p_date) + interval '1 month - 1 day')::date as d
  )
  select
    ((select count(*) from lanc where date < p_date) + (select count(*) from parc where date < p_date))::int,
    coalesce((select sum(amount) from lanc where date < p_date and type = 'expense'), 0)
      + coalesce((select sum(amount) from parc where date < p_date), 0),
    ((select count(*) from lanc where date = p_date) + (select count(*) from parc where date = p_date))::int,
    coalesce((select sum(amount) from lanc where date = p_date and type = 'expense'), 0)
      + coalesce((select sum(amount) from parc where date = p_date), 0),
    (select count(*) from fat)::int,
    coalesce((select sum(remaining) from fat), 0),
    (select min(due_date) from fat),
    (select d from fim),
    (select b.total from public.balance_totals_projected(p_household, (select d from fim), true) b)
   where (select private.is_member(p_household))
$$;

revoke execute on function public.daily_digest(uuid, date) from public, anon;
grant execute on function public.daily_digest(uuid, date) to authenticated, service_role;

-- 5. só para a Edge Function (service_role) ----------------------------------
-- Quem recebe agora: aviso ligado, hora certa, ainda sem registro de hoje, e ainda membro da família.
create function public.daily_digest_recipients(p_date date, p_hour smallint)
returns table (user_id uuid, household_id uuid, email text, hide_values boolean)
language sql stable security definer set search_path = '' as $$
  select s.user_id, s.household_id, u.email::text, s.hide_values
    from public.daily_digest_settings s
    join auth.users u on u.id = s.user_id
    join public.household_members m on m.household_id = s.household_id and m.user_id = s.user_id
   where s.enabled and s.send_hour = p_hour and u.email is not null
     and not exists (select 1 from private.daily_digest_log l where l.user_id = s.user_id and l.sent_on = p_date)
$$;

-- Registra o resultado (uma vez por pessoa por dia: a segunda chamada não sobrescreve).
create function public.daily_digest_mark(p_user uuid, p_household uuid, p_date date, p_status text, p_detail text default null)
returns boolean language sql volatile security definer set search_path = '' as $$
  with i as (
    insert into private.daily_digest_log (user_id, sent_on, household_id, status, detail)
    values (p_user, p_date, p_household, p_status, left(p_detail, 500))
    on conflict (user_id, sent_on) do nothing
    returning 1
  )
  select exists (select 1 from i)
$$;

revoke execute on function public.daily_digest_recipients(date, smallint), public.daily_digest_mark(uuid, uuid, date, text, text)
  from public, anon, authenticated;
grant execute on function public.daily_digest_recipients(date, smallint), public.daily_digest_mark(uuid, uuid, date, text, text)
  to service_role;
