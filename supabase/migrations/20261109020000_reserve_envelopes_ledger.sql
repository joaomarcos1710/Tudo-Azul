-- Tudo Azul: Envelopes Virtuais com ledger append-only.
-- Família e moeda são dimensões obrigatórias. Nenhum aporte/resgate altera contas.
-- A despesa real é criada somente pela RPC atômica record_reserve_expense.

create table public.reserves (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  target_amount numeric,
  target_date date,
  currency_code text not null references public.currencies(code),
  icon text,
  color text,
  status text not null default 'active'
    check (status in ('active', 'completed', 'archived')),
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (household_id, id),
  check (target_amount is null or
    (target_amount > 0 and target_amount = round(target_amount, 2) and abs(target_amount) < 1e12))
);
create index reserves_household_status_idx on public.reserves(household_id, status);

create table public.reserve_allocations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  reserve_id uuid not null,
  amount numeric not null,
  date date not null default (now() at time zone 'America/Sao_Paulo')::date,
  description text check (description is null or char_length(description) <= 200),
  linked_transaction_id uuid references public.transactions(id) on delete restrict,
  idempotency_key uuid not null default gen_random_uuid(),
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint reserve_allocations_reserve_fk
    foreign key (household_id, reserve_id)
    references public.reserves(household_id, id) on delete cascade,
  check (amount <> 0 and amount = round(amount, 2) and abs(amount) < 1e12),
  check (linked_transaction_id is null or amount < 0),
  unique (linked_transaction_id),
  unique (household_id, idempotency_key)
);
create index reserve_allocations_balance_idx
  on public.reserve_allocations(household_id, reserve_id, date, created_at);

alter table public.reserves enable row level security;
alter table public.reserve_allocations enable row level security;

create policy reserves_select on public.reserves for select to authenticated
  using ((select private.is_member(household_id)));
create policy reserves_insert on public.reserves for insert to authenticated
  with check ((select private.is_member(household_id)) and created_by = (select auth.uid()));
create policy reserves_update on public.reserves for update to authenticated
  using ((select private.is_member(household_id)))
  with check ((select private.is_member(household_id)) and created_by = (select auth.uid()));

create policy reserve_allocations_select on public.reserve_allocations for select to authenticated
  using ((select private.is_member(household_id)));
create policy reserve_allocations_insert on public.reserve_allocations for insert to authenticated
  with check ((select private.is_member(household_id)) and created_by = (select auth.uid()));

grant select on public.reserves to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.reserves from public, anon, authenticated;
-- O cliente pode criar a reserva, mas não informar estado inicial, autoria ou identidade.
grant insert (household_id, name, target_amount, target_date, currency_code, icon, color)
  on public.reserves to authenticated;
-- O status só pode mudar por UPDATE validado pela trigger; nunca no INSERT.
grant update (name, target_amount, target_date, icon, color, status) on public.reserves to authenticated;

grant select on public.reserve_allocations to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.reserve_allocations
  from public, anon, authenticated;
-- Ledger append-only: INSERT somente nas colunas de negócio; a chave é necessária à RPC
-- invoker e tem default UUID para alocações manuais.
grant insert (household_id, reserve_id, amount, date, description, linked_transaction_id, idempotency_key)
  on public.reserve_allocations to authenticated;

create function private.reserves_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_balance numeric;
begin
  if tg_op = 'INSERT' then
    if new.currency_code is null or not exists (
      select 1 from public.currencies c where c.code = new.currency_code and c.enabled
    ) then
      raise exception 'moeda da reserva indisponível' using errcode = '23514';
    end if;
    if new.status <> 'active' then
      raise exception 'reserva deve nascer ativa' using errcode = '23514';
    end if;
    if new.created_by is distinct from (select auth.uid()) then
      raise exception 'created_by inválido' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.household_id is distinct from old.household_id
     or new.currency_code is distinct from old.currency_code
     or new.created_by is distinct from old.created_by
     or new.id is distinct from old.id then
    raise exception 'família, moeda e autoria da reserva são imutáveis' using errcode = '42501';
  end if;

  if old.status = 'archived' and new.status is distinct from old.status then
    raise exception 'reserva arquivada não pode ser reaberta' using errcode = '55000';
  end if;

  if new.status = 'archived' and old.status is distinct from 'archived' then
    -- UPDATE já mantém lock exclusivo na linha matriz. Revalidar o ledger sob esse lock.
    select coalesce(sum(a.amount), 0) into v_balance
      from public.reserve_allocations a
     where a.household_id = old.household_id and a.reserve_id = old.id;
    if v_balance <> 0 then
      raise exception 'não é possível arquivar reserva com saldo diferente de zero: %', v_balance
        using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

create function private.reserve_allocations_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_reserve public.reserves%rowtype;
  v_balance numeric;
  v_tx public.transactions%rowtype;
  v_currency text;
begin
  if tg_op <> 'INSERT' then
    raise exception 'ledger de reservas é imutável: registre um lançamento compensatório'
      using errcode = '42501';
  end if;

  -- Autoriza a família antes de consultar a reserva: evita que a FK revele a existência
  -- de uma reserva alheia e garante SQLSTATE 42501 sem elevar privilégios da trigger.
  if not coalesce((select private.is_member(new.household_id)), false) then
    raise exception 'acesso negado à família da reserva' using errcode = '42501';
  end if;

  -- Mesmo lock usado pela trigger de arquivamento. Serializa INSERT contra archive.
  select * into v_reserve
    from public.reserves r
   where r.household_id = new.household_id and r.id = new.reserve_id
   for update;
  if not found then
    raise exception 'reserva não encontrada nesta família' using errcode = '23503';
  end if;
  if v_reserve.status = 'archived' then
    raise exception 'não é permitido movimentar uma reserva arquivada' using errcode = '23514';
  end if;
  if new.created_by is distinct from (select auth.uid()) then
    raise exception 'created_by inválido' using errcode = '42501';
  end if;
  if new.amount <> round(new.amount, 2) then
    raise exception 'valor deve ter no máximo duas casas decimais' using errcode = '22003';
  end if;

  select coalesce(sum(a.amount), 0) into v_balance
    from public.reserve_allocations a
   where a.household_id = new.household_id and a.reserve_id = new.reserve_id;
  if new.amount > 0 and v_reserve.status <> 'active' then
    raise exception 'reservas concluídas não recebem novos aportes' using errcode = '23514';
  end if;
  if v_balance + new.amount < 0 then
    raise exception 'resgate excede o saldo da reserva' using errcode = '23514';
  end if;

  if new.linked_transaction_id is not null then
    if new.amount >= 0 then
      raise exception 'transação vinculada exige resgate' using errcode = '23514';
    end if;
    select t.* into v_tx
      from public.transactions t
     where t.id = new.linked_transaction_id
       and t.household_id = new.household_id
       and t.deleted_at is null
       and t.status = 'paid'
       and t.type = 'expense'
       and t.amount = abs(new.amount);
    if not found then
      raise exception 'transação vinculada deve ser despesa paga da mesma família e do mesmo valor'
        using errcode = '23514';
    end if;
    select a.currency_code into v_currency
      from public.accounts a
     where a.household_id = v_tx.household_id and a.id = v_tx.account_id;
    if v_currency is distinct from v_reserve.currency_code then
      raise exception 'moeda da despesa deve ser igual à moeda da reserva' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

create trigger reserves_guard
before insert or update on public.reserves
for each row execute function private.reserves_guard();

create trigger reserve_allocations_guard
before insert or update or delete on public.reserve_allocations
for each row execute function private.reserve_allocations_guard();

revoke execute on function private.reserves_guard(), private.reserve_allocations_guard()
  from public, anon, authenticated;

-- Troca o contrato anterior pela versão idempotente. Não mantém overload ambíguo.
drop function if exists public.record_reserve_expense(uuid, uuid, uuid, numeric, date, text, text);

-- Registra uma despesa paga e seu resgate no mesmo statement/transação.
-- A chave é serializada por família e consultada antes de qualquer escrita.
create function public.record_reserve_expense(
  p_reserve_id uuid,
  p_account_id uuid,
  p_category_id uuid,
  p_amount numeric,
  p_date date,
  p_description text,
  p_idempotency_key uuid,
  p_reserve_description text default null
) returns table (transaction_id uuid, allocation_id uuid)
language plpgsql security invoker set search_path = '' as $$
declare
  v_reserve public.reserves%rowtype;
  v_tx_id uuid;
  v_allocation_id uuid;
  v_existing_reserve_id uuid;
  v_existing_amount numeric;
  v_existing_account_id uuid;
  v_existing_category_id uuid;
  v_existing_allocation_amount numeric;
begin
  if (select auth.uid()) is null then
    raise exception 'autenticação necessária' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'chave de idempotência obrigatória' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'valor da despesa inválido' using errcode = '22003';
  end if;
  if p_date is null or p_date < date '2000-01-01' or p_date > date '2100-01-01' then
    raise exception 'data da despesa inválida' using errcode = '22023';
  end if;

  -- A associação familiar é validada antes da leitura/lock da reserva.
  select * into v_reserve from public.reserves r
   where r.id = p_reserve_id
     and (select private.is_member(r.household_id))
   for update;
  if not found then
    raise exception 'reserva não encontrada ou acesso negado' using errcode = '42501';
  end if;

  -- Chave serializada por household, inclusive se duas chamadas usarem reservas diferentes.
  perform pg_advisory_xact_lock(
    hashtextextended(v_reserve.household_id::text || ':' || p_idempotency_key::text, 0)
  );

  -- Reenvio: devolve exatamente os IDs originais sem criar uma segunda despesa.
  select a.id, a.linked_transaction_id, a.reserve_id, a.amount,
         t.amount, t.account_id, t.category_id
    into v_allocation_id, v_tx_id, v_existing_reserve_id, v_existing_allocation_amount,
         v_existing_amount, v_existing_account_id, v_existing_category_id
    from public.reserve_allocations a
    left join public.transactions t on t.id = a.linked_transaction_id
   where a.household_id = v_reserve.household_id
     and a.idempotency_key = p_idempotency_key;

  if found then
    if v_tx_id is null
       or v_existing_reserve_id is distinct from p_reserve_id
       or v_existing_allocation_amount is distinct from -p_amount
       or v_existing_amount is distinct from p_amount
       or v_existing_account_id is distinct from p_account_id
       or v_existing_category_id is distinct from p_category_id then
      raise exception 'Conflito de idempotência' using errcode = '40900';
    end if;
    return query select v_tx_id, v_allocation_id;
    return;
  end if;

  if v_reserve.status = 'archived' then
    raise exception 'reserva arquivada não pode ser utilizada' using errcode = '23514';
  end if;

  insert into public.transactions
    (household_id, account_id, category_id, type, description, amount, date, status)
  values
    (v_reserve.household_id, p_account_id, p_category_id, 'expense',
     coalesce(p_description, ''), p_amount, p_date, 'paid')
  returning id into v_tx_id;

  insert into public.reserve_allocations
    (household_id, reserve_id, amount, date, description, linked_transaction_id, idempotency_key)
  values
    (v_reserve.household_id, v_reserve.id, -p_amount, p_date,
     p_reserve_description, v_tx_id, p_idempotency_key)
  returning id into v_allocation_id;

  return query select v_tx_id, v_allocation_id;
end $$;

revoke execute on function public.record_reserve_expense(uuid, uuid, uuid, numeric, date, text, uuid, text)
  from public, anon;
grant execute on function public.record_reserve_expense(uuid, uuid, uuid, numeric, date, text, uuid, text)
  to authenticated;
