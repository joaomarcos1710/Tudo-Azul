-- Tudo Azul: integridade transacional dos Envelopes Virtuais.
-- Serializa alterações de despesas vinculadas com a gravação do ledger.
-- SECURITY INVOKER: mantém RLS e privilégios do chamador.

-- Chaves de idempotência precisam ser fornecidas pelo cliente/RPC; não gerar
-- uma chave nova silenciosamente em cada repetição da mesma solicitação.
alter table public.reserve_allocations
  alter column idempotency_key drop default;

create or replace function private.reserve_allocations_guard() returns trigger
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

  if not coalesce((select private.is_member(new.household_id)), false) then
    raise exception 'acesso negado à família da reserva' using errcode = '42501';
  end if;

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
  if new.idempotency_key is null then
    raise exception 'chave de idempotência obrigatória' using errcode = '22023';
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

    -- Mesmo lock advisory da trigger de transactions: impede que uma edição
    -- concorrente passe entre a validação da despesa e a gravação do vínculo.
    perform pg_advisory_xact_lock(hashtextextended(new.linked_transaction_id::text, 0));

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

create function private.reserve_linked_transaction_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  -- Serializa também contra INSERT no ledger. Sem este lock, uma edição
  -- concorrente poderia passar antes de a alocação vinculada ficar visível.
  perform pg_advisory_xact_lock(hashtextextended(old.id::text, 0));

  if exists (
    select 1
      from public.reserve_allocations a
     where a.linked_transaction_id = old.id
  ) then
    if tg_op = 'DELETE' then
      raise exception 'despesa vinculada a envelope não pode ser excluída; registre correção compensatória'
        using errcode = '23514';
    end if;

    if (new.household_id, new.account_id, new.destination_account_id, new.category_id,
        new.type, new.amount, new.date, new.status, new.deleted_at,
        new.installment_id, new.recurrence_id, new.occurrence_date)
       is distinct from
       (old.household_id, old.account_id, old.destination_account_id, old.category_id,
        old.type, old.amount, old.date, old.status, old.deleted_at,
        old.installment_id, old.recurrence_id, old.occurrence_date) then
      raise exception 'dados financeiros de despesa vinculada a envelope são imutáveis; registre correção compensatória'
        using errcode = '23514';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

create trigger transactions_reserve_link_guard
before update or delete on public.transactions
for each row execute function private.reserve_linked_transaction_guard();

revoke execute on function private.reserve_linked_transaction_guard()
  from public, anon, authenticated;

-- Aporte/resgate manual idempotente. A mesma chave e o mesmo payload devolvem
-- o ID original; a mesma chave com outro payload é conflito, sem nova escrita.
create function public.record_reserve_allocation(
  p_reserve_id uuid,
  p_amount numeric,
  p_date date,
  p_description text,
  p_idempotency_key uuid
) returns uuid
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_reserve public.reserves%rowtype;
  v_id uuid;
  v_amount numeric;
  v_date date;
  v_description text;
  v_reserve_id uuid;
  v_linked_transaction_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'autenticação necessária' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'chave de idempotência obrigatória' using errcode = '22023';
  end if;
  if p_amount is null or p_amount = 0 or p_amount <> round(p_amount, 2)
     or abs(p_amount) >= 1e12 then
    raise exception 'valor da alocação inválido' using errcode = '22003';
  end if;
  if p_date is null or p_date < date '2000-01-01' or p_date > date '2100-01-01' then
    raise exception 'data da alocação inválida' using errcode = '22023';
  end if;
  if p_description is not null and char_length(p_description) > 200 then
    raise exception 'descrição excede 200 caracteres' using errcode = '22023';
  end if;

  select * into v_reserve
    from public.reserves r
   where r.id = p_reserve_id
     and (select private.is_member(r.household_id))
   for update;
  if not found then
    raise exception 'reserva não encontrada ou acesso negado' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_reserve.household_id::text || ':' || p_idempotency_key::text, 0)
  );

  select a.id, a.amount, a.date, a.description, a.reserve_id, a.linked_transaction_id
    into v_id, v_amount, v_date, v_description, v_reserve_id, v_linked_transaction_id
    from public.reserve_allocations a
   where a.household_id = v_reserve.household_id
     and a.idempotency_key = p_idempotency_key;

  if found then
    if v_reserve_id is distinct from p_reserve_id
       or v_amount is distinct from p_amount
       or v_date is distinct from p_date
       or v_description is distinct from p_description
       or v_linked_transaction_id is not null then
      raise exception 'Conflito de idempotência' using errcode = '40900';
    end if;
    return v_id;
  end if;

  insert into public.reserve_allocations
    (household_id, reserve_id, amount, date, description, idempotency_key)
  values
    (v_reserve.household_id, v_reserve.id, p_amount, p_date, p_description, p_idempotency_key)
  returning id into v_id;

  return v_id;
end $$;

revoke execute on function public.record_reserve_allocation(uuid, numeric, date, text, uuid)
  from public, anon;
grant execute on function public.record_reserve_allocation(uuid, numeric, date, text, uuid)
  to authenticated;
