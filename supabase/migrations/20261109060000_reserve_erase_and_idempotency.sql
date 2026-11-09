-- Tudo Azul: reservas no "Zerar tudo" e na exclusão da família, e idempotência completa.
-- Ledger de reservas continua append-only nas operações normais. A única exceção é a
-- apagar a família inteira, liberada por app.reserve_erase = <household_id>, ligada
-- só dentro de reset_household e delete_household (ambas SECURITY DEFINER e só para o dono).
-- SECURITY INVOKER nas funções de reserva: RLS e privilégios do chamador continuam valendo.

-- ---------------------------------------------------------------------------
-- 1) Guards: DELETE só com o bypass da própria família.

create or replace function private.reserve_allocations_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_reserve public.reserves%rowtype;
  v_balance numeric;
  v_tx public.transactions%rowtype;
  v_currency text;
begin
  if tg_op = 'DELETE' then
    if current_setting('app.reserve_erase', true) is distinct from old.household_id::text then
      raise exception 'ledger de reservas é imutável: registre um lançamento compensatório'
        using errcode = '42501';
    end if;
    return old;
  end if;
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

-- Reservas só saem junto com a família inteira (ou pelo zerar tudo). Arquivar é o caminho normal.
create function private.reserves_delete_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if current_setting('app.reserve_erase', true) is distinct from old.household_id::text then
    raise exception 'reserva não pode ser excluída; arquive-a' using errcode = '23514';
  end if;
  return old;
end $$;

create trigger reserves_delete_guard
before delete on public.reserves
for each row execute function private.reserves_delete_guard();

revoke execute on function private.reserves_delete_guard() from public, anon, authenticated;

-- Despesa vinculada: DELETE só no apagamento da família; UPDATE continua bloqueado.
create or replace function private.reserve_linked_transaction_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(old.id::text, 0));

  if exists (
    select 1
      from public.reserve_allocations a
     where a.linked_transaction_id = old.id
  ) then
    if tg_op = 'DELETE' then
      if current_setting('app.reserve_erase', true) is distinct from old.household_id::text then
        raise exception 'despesa vinculada a envelope não pode ser excluída; registre correção compensatória'
          using errcode = '23514';
      end if;
    elsif (new.household_id, new.account_id, new.destination_account_id, new.category_id,
        new.type, new.amount, new.date, new.status, new.deleted_at,
        new.installment_group, new.installment_number, new.installment_count, new.recurrence_id, new.occurrence_date)
       is distinct from
       (old.household_id, old.account_id, old.destination_account_id, old.category_id,
        old.type, old.amount, old.date, old.status, old.deleted_at,
        old.installment_group, old.installment_number, old.installment_count, old.recurrence_id, old.occurrence_date) then
      raise exception 'dados financeiros de despesa vinculada a envelope são imutáveis; registre correção compensatória'
        using errcode = '23514';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

-- Descrição enviada à despesa, guardada no ledger. A descrição da transação continua editável
-- (correção de texto), então o reenvio idempotente compara com este campo, não com a transação.
-- Linhas anteriores à 060000 ficam nulas e caem na comparação com a transação, como antes.
alter table public.reserve_allocations add column expense_description text;
grant insert (expense_description) on public.reserve_allocations to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Escritores de reserva: travam a família em FOR SHARE antes da reserva.
-- O zerar tudo e a exclusão da família travam a mesma linha em FOR UPDATE; assim um aporte
-- concorrente espera o apagamento e, depois, não encontra a reserva. Sem deadlock: a ordem
-- é sempre família -> reserva.

create or replace function public.record_reserve_allocation(
  p_reserve_id uuid,
  p_amount numeric,
  p_date date,
  p_description text,
  p_idempotency_key uuid
) returns uuid
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_household_id uuid;
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

  select r.household_id into v_household_id
    from public.reserves r
   where r.id = p_reserve_id
     and (select private.is_member(r.household_id));
  if not found then
    raise exception 'reserva não encontrada ou acesso negado' using errcode = '42501';
  end if;
  perform 1 from public.households h where h.id = v_household_id for share;

  select * into v_reserve
    from public.reserves r
   where r.id = p_reserve_id
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

-- Despesa + resgate idempotentes. O reenvio compara o payload COMPLETO (valor, conta,
-- categoria, data e descrições da despesa e do resgate). Chave antiga sem vínculo (aporte manual)
-- continua sendo conflito. Chaves de outras famílias são independentes.
create or replace function public.record_reserve_expense(
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
  v_household_id uuid;
  v_reserve public.reserves%rowtype;
  v_tx_id uuid;
  v_allocation_id uuid;
  v_existing_reserve_id uuid;
  v_existing_amount numeric;
  v_existing_account_id uuid;
  v_existing_category_id uuid;
  v_existing_allocation_amount numeric;
  v_existing_tx_date date;
  v_existing_tx_description text;
  v_existing_alloc_date date;
  v_existing_alloc_description text;
  v_existing_expense_description text;
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

  select r.household_id into v_household_id
    from public.reserves r
   where r.id = p_reserve_id
     and (select private.is_member(r.household_id));
  if not found then
    raise exception 'reserva não encontrada ou acesso negado' using errcode = '42501';
  end if;
  perform 1 from public.households h where h.id = v_household_id for share;

  select * into v_reserve from public.reserves r
   where r.id = p_reserve_id
   for update;
  if not found then
    raise exception 'reserva não encontrada ou acesso negado' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_reserve.household_id::text || ':' || p_idempotency_key::text, 0)
  );

  select a.id, a.linked_transaction_id, a.reserve_id, a.amount, a.date, a.description,
         t.amount, t.date, t.description, t.account_id, t.category_id, a.expense_description
    into v_allocation_id, v_tx_id, v_existing_reserve_id, v_existing_allocation_amount,
         v_existing_alloc_date, v_existing_alloc_description,
         v_existing_amount, v_existing_tx_date, v_existing_tx_description,
         v_existing_account_id, v_existing_category_id, v_existing_expense_description
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
       or v_existing_category_id is distinct from p_category_id
       or v_existing_tx_date is distinct from p_date
       or coalesce(v_existing_expense_description, v_existing_tx_description) is distinct from coalesce(p_description, '')
       or v_existing_alloc_date is distinct from p_date
       or v_existing_alloc_description is distinct from p_reserve_description then
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
    (household_id, reserve_id, amount, date, description, linked_transaction_id, idempotency_key, expense_description)
  values
    (v_reserve.household_id, v_reserve.id, -p_amount, p_date,
     p_reserve_description, v_tx_id, p_idempotency_key, coalesce(p_description, ''))
  returning id into v_allocation_id;

  return query select v_tx_id, v_allocation_id;
end $$;

-- ---------------------------------------------------------------------------
-- 3) Prévia do zerar tudo: agora conta reservas e aportes.

create or replace function public.reset_preview(p_household uuid)
returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'transactions',             (select count(*) from public.transactions where household_id = p_household),
    'accounts',                 (select count(*) from public.accounts where household_id = p_household),
    'debts',                    (select count(*) from public.debts where household_id = p_household),
    'installments',             (select count(*) from public.debt_installments where household_id = p_household),
    'events',                   (select count(*) from public.debt_events where household_id = p_household),
    'schedule',                 (select count(*) from public.debt_payment_schedule where household_id = p_household),
    'recurrences',              (select count(*) from public.recurrences where household_id = p_household),
    'reconciliations',          (select count(*) from public.account_reconciliations where household_id = p_household),
    'budgets',                  (select count(*) from public.budgets where household_id = p_household),
    'investment_assets',        (select count(*) from public.investment_assets where household_id = p_household),
    'investment_operations',    (select count(*) from public.investment_operations where household_id = p_household),
    'investment_valuations',    (select count(*) from public.investment_valuations where household_id = p_household),
    'investment_distributions', (select count(*) from public.investment_distributions where household_id = p_household),
    'family_assets',            (select count(*) from public.family_assets where household_id = p_household),
    'family_asset_valuations',  (select count(*) from public.family_asset_valuations where household_id = p_household),
    'reserves',                 (select count(*) from public.reserves where household_id = p_household),
    'reserve_allocations',      (select count(*) from public.reserve_allocations where household_id = p_household)
  )
  where (select private.is_member(p_household))
$$;

-- ---------------------------------------------------------------------------
-- 4) Zerar tudo: mesmo contrato da 20261104230100 (dono, frase "zerar tudo", uma transação),
-- com reservas e aportes. Ordem: ledger, reservas e só então as transações vinculadas
-- (a FK do vínculo é RESTRICT). Se qualquer passo falhar, a transação inteira é desfeita.

create or replace function public.reset_household(p_household uuid, p_confirmation text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_counts jsonb;
  v_n_tx bigint; v_n_acc bigint; v_n_debt bigint; v_n_inst bigint; v_n_ev bigint; v_n_sched bigint;
  v_n_rec bigint; v_n_recon bigint; v_n_bud bigint;
  v_n_ia bigint; v_n_io bigint; v_n_iv bigint; v_n_id bigint; v_n_fa bigint; v_n_fav bigint;
  v_n_ra bigint; v_n_rs bigint;
begin
  if v_uid is null then
    raise exception 'não autenticado' using errcode = '42501';
  end if;
  if p_household is null or not private.is_owner(p_household) then
    raise exception 'somente o dono da família pode zerar tudo' using errcode = '42501';
  end if;
  if lower(btrim(coalesce(p_confirmation, ''))) <> 'zerar tudo' then
    raise exception 'confirmação incorreta: escreva "zerar tudo"' using errcode = '22023';
  end if;

  -- uma operação por vez na família; os escritores de reserva esperam este lock (FOR SHARE)
  perform 1 from public.households where id = p_household for update;
  set constraints all deferred;
  -- liberação restrita a esta família, só nesta transação
  perform set_config('app.reserve_erase', p_household::text, true);

  -- envelopes: aportes/resgates antes das transações vinculadas; depois as reservas
  with d as (delete from public.reserve_allocations where household_id = p_household returning 1)
    select count(*) into v_n_ra from d;
  with d as (delete from public.reserves where household_id = p_household returning 1)
    select count(*) into v_n_rs from d;

  -- investimentos: proventos antes dos lançamentos (senão somem por cascata sem contagem), depois o resto do ativo
  with d as (delete from public.investment_distributions where household_id = p_household returning 1)
    select count(*) into v_n_id from d;
  with d as (delete from public.investment_operations where household_id = p_household returning 1)
    select count(*) into v_n_io from d;
  with d as (delete from public.investment_valuations where household_id = p_household returning 1)
    select count(*) into v_n_iv from d;
  with d as (delete from public.investment_assets where household_id = p_household returning 1)
    select count(*) into v_n_ia from d;
  -- bens: avaliações antes do bem (essa FK não é adiável)
  with d as (delete from public.family_asset_valuations where household_id = p_household returning 1)
    select count(*) into v_n_fav from d;
  with d as (delete from public.family_assets where household_id = p_household returning 1)
    select count(*) into v_n_fa from d;

  with d as (delete from public.account_reconciliations where household_id = p_household returning 1)
    select count(*) into v_n_recon from d;
  with d as (delete from public.transactions where household_id = p_household returning 1)
    select count(*) into v_n_tx from d;
  with d as (delete from public.debt_events where household_id = p_household returning 1)
    select count(*) into v_n_ev from d;
  -- agenda do contrato: depois dos eventos (que apontam para ela) e antes das dívidas (senão some por cascata)
  with d as (delete from public.debt_payment_schedule where household_id = p_household returning 1)
    select count(*) into v_n_sched from d;
  delete from public.debt_installment_edits where household_id = p_household;
  with d as (delete from public.debt_installments where household_id = p_household returning 1)
    select count(*) into v_n_inst from d;
  delete from public.debt_invoices where household_id = p_household;
  with d as (delete from public.recurrences where household_id = p_household returning 1)
    select count(*) into v_n_rec from d;
  with d as (delete from public.budgets where household_id = p_household returning 1)
    select count(*) into v_n_bud from d;
  with d as (delete from public.debts where household_id = p_household returning 1)
    select count(*) into v_n_debt from d;
  with d as (delete from public.accounts where household_id = p_household returning 1)
    select count(*) into v_n_acc from d;

  perform set_config('app.reserve_erase', '', true);

  v_counts := jsonb_build_object(
    'transactions', v_n_tx, 'accounts', v_n_acc, 'debts', v_n_debt, 'installments', v_n_inst, 'events', v_n_ev,
    'schedule', v_n_sched, 'recurrences', v_n_rec, 'reconciliations', v_n_recon, 'budgets', v_n_bud,
    'investment_assets', v_n_ia, 'investment_operations', v_n_io, 'investment_valuations', v_n_iv,
    'investment_distributions', v_n_id, 'family_assets', v_n_fa, 'family_asset_valuations', v_n_fav,
    'reserves', v_n_rs, 'reserve_allocations', v_n_ra);
  -- zerar uma família que já está vazia (duplo clique, duas abas) não gera registro
  if v_n_tx + v_n_acc + v_n_debt + v_n_inst + v_n_ev + v_n_sched + v_n_rec + v_n_recon + v_n_bud
     + v_n_ia + v_n_io + v_n_iv + v_n_id + v_n_fa + v_n_fav + v_n_rs + v_n_ra > 0 then
    insert into public.household_resets (household_id, done_by, counts) values (p_household, v_uid, v_counts);
  end if;
  return v_counts;
end $$;

revoke execute on function public.reset_preview(uuid), public.reset_household(uuid, text) from public, anon;
grant execute on function public.reset_preview(uuid), public.reset_household(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) Excluir a família: mesmo contrato da 20261013120400 (só o owner). Antes da cascata,
-- o ledger e as reservas saem explicitamente, com o mesmo bypass restrito à família.

create or replace function public.delete_household() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_h   uuid;
begin
  if v_uid is null then
    raise exception 'não autenticado' using errcode = '42501';
  end if;
  select m.household_id into v_h from public.household_members m
   where m.user_id = v_uid and m.role = 'owner';
  if v_h is null then
    raise exception 'somente o owner da família pode excluí-la' using errcode = '42501';
  end if;
  -- mesmo lock dos escritores de reserva: um aporte concorrente espera a exclusão
  perform 1 from public.households where id = v_h for update;
  -- As FKs entre tabelas filhas são DEFERRABLE: adiá-las até o commit evita que a
  -- ordem da cascata (contas antes de lançamentos, por exemplo) cause falso erro.
  set constraints all deferred;
  perform set_config('app.reserve_erase', v_h::text, true);
  delete from public.reserve_allocations where household_id = v_h;
  delete from public.reserves where household_id = v_h;
  delete from public.households where id = v_h; -- cascata em tudo
  perform set_config('app.reserve_erase', '', true);
end $$;
