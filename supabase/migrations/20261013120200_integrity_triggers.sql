-- Tudo Azul — migration 001 (2/5): triggers de integridade
-- Regras que chaves estrangeiras e CHECK não expressam. Todas as funções têm
-- search_path fixo e nomes qualificados. Nenhuma recebe EXECUTE de ninguém
-- (o privilégio de EXECUTE de função de trigger é checado na criação do trigger).

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
create function private.touch_updated_at() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- transactions: dinheiro, transferência x abertura, conta ativa
-- ---------------------------------------------------------------------------
create function private.transactions_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_src public.accounts%rowtype;
  v_dst public.accounts%rowtype;
  v_have_src boolean := false;
  v_have_dst boolean := false;
  v_restoring boolean := false;
  v_src_changed boolean := true;
  v_dst_changed boolean := true;
begin
  if tg_op = 'UPDATE' then
    if new.household_id is distinct from old.household_id then
      raise exception 'household_id não pode ser alterado' using errcode = '42501';
    end if;
    v_restoring   := old.deleted_at is not null;
    v_src_changed := new.account_id is distinct from old.account_id;
    v_dst_changed := new.destination_account_id is distinct from old.destination_account_id;
  end if;

  -- Dinheiro (N2): recusa mais de 2 casas e normaliza para escala 2.
  -- O CHECK da coluna roda DEPOIS deste trigger, então a recusa precisa estar aqui.
  if new.amount is not null then
    if new.amount <> round(new.amount, 2) then
      raise exception 'valor com mais de 2 casas decimais: %', new.amount using errcode = '22003';
    end if;
    new.amount := round(new.amount, 2);
  end if;

  -- Lançamento na lixeira não passa pelas regras de conta.
  if new.deleted_at is not null then
    return new;
  end if;

  -- Trava as contas envolvidas (FOR SHARE). O UPDATE em accounts toma bloqueio
  -- exclusivo da linha, então inserir lançamento e desativar/mudar a abertura da
  -- conta nunca acontecem ao mesmo tempo sem que um enxergue o outro.
  select * into v_src from public.accounts
   where household_id = new.household_id and id = new.account_id for share;
  v_have_src := found;
  if new.destination_account_id is not null then
    select * into v_dst from public.accounts
     where household_id = new.household_id and id = new.destination_account_id for share;
    v_have_dst := found;
  end if;
  -- Conta inexistente (ou de outra família): as FKs compostas reportam o erro.

  -- Decisão 8: transferência não pode ser anterior à abertura de NENHUMA das contas.
  if new.type = 'transfer' then
    if v_have_src and new.date < v_src.opening_date then
      raise exception 'transferência anterior à abertura da conta de origem (%)', v_src.opening_date
        using errcode = '23514';
    end if;
    if v_have_dst and new.date < v_dst.opening_date then
      raise exception 'transferência anterior à abertura da conta de destino (%)', v_dst.opening_date
        using errcode = '23514';
    end if;
  end if;

  -- active só controla NOVAS movimentações: inserir, restaurar da lixeira ou
  -- trocar a conta. Editar lançamento existente em conta desativada é permitido.
  if tg_op = 'INSERT' or v_restoring or v_src_changed then
    if v_have_src and not v_src.active then
      raise exception 'conta de origem desativada' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'INSERT' or v_restoring or v_dst_changed then
    if v_have_dst and not v_dst.active then
      raise exception 'conta de destino desativada' using errcode = '23514';
    end if;
  end if;

  return new;
end $$;

create trigger transactions_guard
  before insert or update on public.transactions
  for each row execute function private.transactions_guard();
create trigger transactions_touch
  before update on public.transactions
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- accounts: dinheiro, abertura x transferências, desativar x planejados
-- ---------------------------------------------------------------------------
create function private.accounts_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.initial_balance is not null then
    if new.initial_balance <> round(new.initial_balance, 2) then
      raise exception 'valor com mais de 2 casas decimais: %', new.initial_balance using errcode = '22003';
    end if;
    new.initial_balance := round(new.initial_balance, 2);
  end if;

  if tg_op = 'UPDATE' then
    if new.household_id is distinct from old.household_id then
      raise exception 'household_id não pode ser alterado' using errcode = '42501';
    end if;

    -- Mudar a abertura não pode deixar uma transferência (não excluída) anterior a ela.
    if new.opening_date is distinct from old.opening_date and exists (
      select 1 from public.transactions t
       where t.household_id = new.household_id
         and t.deleted_at is null
         and t.type = 'transfer'
         and (t.account_id = new.id or t.destination_account_id = new.id)
         and t.date < new.opening_date
    ) then
      raise exception 'há transferência anterior à nova data de abertura' using errcode = '23514';
    end if;

    -- Desativar: recusado se houver lançamento planejado em aberto na conta.
    if old.active and not new.active and exists (
      select 1 from public.transactions t
       where t.household_id = new.household_id
         and t.deleted_at is null
         and t.status = 'planned'
         and (t.account_id = new.id or t.destination_account_id = new.id)
    ) then
      raise exception 'conta com lançamento planejado em aberto não pode ser desativada'
        using errcode = '23514';
    end if;
  end if;

  return new;
end $$;

create trigger accounts_guard
  before insert or update on public.accounts
  for each row execute function private.accounts_guard();

-- ---------------------------------------------------------------------------
-- categories: 1 nível, "Sem categoria" imutável
-- ---------------------------------------------------------------------------
create function private.categories_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_parent public.categories%rowtype;
begin
  if tg_op = 'DELETE' then
    -- "Sem categoria" não se exclui, exceto na exclusão em cascata da família.
    if old.system_key is not null and exists (
      select 1 from public.households h where h.id = old.household_id
    ) then
      raise exception 'a categoria "Sem categoria" não pode ser excluída' using errcode = '23514';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if new.household_id is distinct from old.household_id then
      raise exception 'household_id não pode ser alterado' using errcode = '42501';
    end if;
    if new.system_key is distinct from old.system_key then
      raise exception 'system_key não pode ser alterado' using errcode = '23514';
    end if;
    if old.system_key is not null and (
         new.name is distinct from old.name
      or new.type is distinct from old.type
      or new.parent_id is distinct from old.parent_id
      or new.active is distinct from old.active
    ) then
      raise exception 'a categoria "Sem categoria" não pode ser alterada' using errcode = '23514';
    end if;
  end if;

  if new.parent_id is not null then
    select * into v_parent from public.categories
     where household_id = new.household_id and id = new.parent_id for share;
    if found then
      if v_parent.parent_id is not null then
        raise exception 'subcategoria só pode ter 1 nível' using errcode = '23514';
      end if;
      if v_parent.system_key is not null then
        raise exception 'a categoria "Sem categoria" não pode ter subcategorias' using errcode = '23514';
      end if;
    end if;
    -- quem já tem filhas ou orçamento não vira subcategoria
    if tg_op = 'UPDATE' then
      if exists (select 1 from public.categories c
                  where c.household_id = new.household_id and c.parent_id = new.id) then
        raise exception 'categoria com subcategorias não pode virar subcategoria' using errcode = '23514';
      end if;
      if exists (select 1 from public.budgets b
                  where b.household_id = new.household_id and b.category_id = new.id) then
        raise exception 'categoria com orçamento não pode virar subcategoria' using errcode = '23514';
      end if;
    end if;
  end if;

  return new;
end $$;

create trigger categories_guard
  before insert or update or delete on public.categories
  for each row execute function private.categories_guard();

-- ---------------------------------------------------------------------------
-- budgets: dinheiro e categoria raiz
-- ---------------------------------------------------------------------------
create function private.budgets_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_parent_id uuid;
  v_found boolean;
begin
  if tg_op = 'UPDATE' and new.household_id is distinct from old.household_id then
    raise exception 'household_id não pode ser alterado' using errcode = '42501';
  end if;

  if new.amount_limit is not null then
    if new.amount_limit <> round(new.amount_limit, 2) then
      raise exception 'valor com mais de 2 casas decimais: %', new.amount_limit using errcode = '22003';
    end if;
    new.amount_limit := round(new.amount_limit, 2);
  end if;

  -- Orçamento só em categoria raiz; trava a categoria para que ela não vire
  -- subcategoria ao mesmo tempo.
  select c.parent_id, true into v_parent_id, v_found
    from public.categories c
   where c.household_id = new.household_id and c.id = new.category_id for share;
  if coalesce(v_found, false) and v_parent_id is not null then
    raise exception 'orçamento só é permitido em categoria raiz' using errcode = '23514';
  end if;

  return new;
end $$;

create trigger budgets_guard
  before insert or update on public.budgets
  for each row execute function private.budgets_guard();

-- ---------------------------------------------------------------------------
-- household_members: limite de membros e pelo menos um owner
-- ---------------------------------------------------------------------------
create function private.members_limit_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_limit smallint;
  v_count integer;
begin
  select member_limit into v_limit from public.households
   where id = new.household_id for update;
  select count(*) into v_count from public.household_members where household_id = new.household_id;
  if v_limit is not null and v_count >= v_limit then
    raise exception 'limite de membros da família atingido (%)', v_limit using errcode = '55000';
  end if;
  return new;
end $$;

create trigger members_limit_guard
  before insert on public.household_members
  for each row execute function private.members_limit_guard();

-- SECURITY DEFINER de propósito: roda no commit (adiado) e precisa enxergar todos
-- os membros, sem depender de RLS nem de quem estiver "logado" naquele momento.
create function private.members_owner_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.households h where h.id = old.household_id)
     and not exists (select 1 from public.household_members m
                      where m.household_id = old.household_id and m.role = 'owner') then
    raise exception 'a família precisa ter pelo menos um owner' using errcode = '23514';
  end if;
  return null;
end $$;

create constraint trigger members_owner_guard
  after delete or update of role, household_id on public.household_members
  deferrable initially deferred
  for each row execute function private.members_owner_guard();

-- ---------------------------------------------------------------------------
-- Cadastro: cria o perfil quando nasce um usuário em auth.users.
-- SECURITY DEFINER: o trigger roda no contexto do serviço de autenticação.
-- O nome vem de raw_user_meta_data SÓ para exibição; nunca para autorização.
-- ---------------------------------------------------------------------------
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
begin
  v_name := left(btrim(coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'Usuário'
  )), 80);
  insert into public.profiles (id, name) values (new.id, v_name);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();
