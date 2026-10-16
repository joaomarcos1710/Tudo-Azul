-- Tudo Azul — migration 001 (4/5): RPCs de família, convite e membros
--
-- Todas SECURITY DEFINER, portanto IGNORAM a RLS. A segurança de cada uma depende
-- das verificações explícitas abaixo (auditadas em docs/MIGRATION-001-PLANO.md,
-- seção 6.1, e cobertas por supabase/tests/database/01_isolation e 05_rpc).
-- Regras comuns: (1) auth.uid() nulo => erro; (2) nenhum id de família vindo do
-- chamador é confiável: a família é sempre a do próprio auth.uid(); (3)
-- search_path = ''; (4) nunca se usa user_metadata; (5) EXECUTE só para authenticated.
--
-- Códigos de erro: 42501 sem permissão/não autenticado; 22023 parâmetro ou convite
-- inválido; 55000 estado que não permite a operação (já em família, limite, etc.).

-- Categorias padrão (decisão 4), copiadas para cada família na criação.
create function private.seed_default_categories(p_household uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.categories (household_id, name, type) values
    (p_household, 'Salário', 'income'),
    (p_household, 'Rendimentos', 'income'),
    (p_household, 'Outras receitas', 'income'),
    (p_household, 'Moradia', 'expense'),
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

-- ---------------------------------------------------------------------------
create function public.create_household(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := auth.uid();
  v_name text := btrim(p_name);
  v_id   uuid;
begin
  if v_uid is null then
    raise exception 'não autenticado' using errcode = '42501';
  end if;
  if v_name is null or char_length(v_name) not between 1 and 80 then
    raise exception 'nome da família inválido' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'perfil não encontrado' using errcode = '55000';
  end if;
  if exists (select 1 from public.household_members where user_id = v_uid) then
    raise exception 'o usuário já pertence a uma família' using errcode = '55000';
  end if;

  insert into public.households (name, created_by) values (v_name, v_uid) returning id into v_id;
  insert into public.household_members (household_id, user_id, role) values (v_id, v_uid, 'owner');
  perform private.seed_default_categories(v_id);
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Devolve o token UMA vez; no banco fica só o hash (sha256 em hexadecimal).
create function public.create_invitation(p_email text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  v_email text := lower(btrim(p_email));
  v_h     uuid;
  v_limit smallint;
  v_count integer;
  v_token text;
begin
  if v_uid is null then
    raise exception 'não autenticado' using errcode = '42501';
  end if;
  if v_email is null or char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'e-mail inválido' using errcode = '22023';
  end if;

  -- A família é a do próprio chamador, e ele precisa ser owner dela.
  select m.household_id into v_h from public.household_members m
   where m.user_id = v_uid and m.role = 'owner';
  if v_h is null then
    raise exception 'somente o owner da família pode convidar' using errcode = '42501';
  end if;

  select member_limit into v_limit from public.households where id = v_h for update;

  -- Reenvio: o convite pendente anterior para o mesmo e-mail é descartado.
  delete from public.invitations
   where household_id = v_h and email = v_email and accepted_at is null;

  select (select count(*) from public.household_members where household_id = v_h)
       + (select count(*) from public.invitations
           where household_id = v_h and accepted_at is null and expires_at > now())
    into v_count;
  if v_count >= v_limit then
    raise exception 'limite de membros da família atingido (%)', v_limit using errcode = '55000';
  end if;

  -- 2 UUIDs v4 (CSPRNG do servidor) => 64 caracteres hexadecimais.
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.invitations (household_id, email, token_hash, invited_by, expires_at)
  values (v_h, v_email, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_uid, now() + interval '7 days');
  return v_token;
end $$;

-- ---------------------------------------------------------------------------
create function public.accept_invitation(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  v_inv   public.invitations%rowtype;
  v_email text;
  v_limit smallint;
  v_count integer;
begin
  if v_uid is null then
    raise exception 'não autenticado' using errcode = '42501';
  end if;
  if p_token is null or char_length(p_token) not between 16 and 200 then
    raise exception 'convite inválido ou expirado' using errcode = '22023';
  end if;

  select * into v_inv from public.invitations
   where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') for update;
  if not found or v_inv.accepted_at is not null or v_inv.expires_at <= now() then
    raise exception 'convite inválido ou expirado' using errcode = '22023';
  end if;

  -- N5: o e-mail da conta que aceita precisa ser o e-mail do convite (vem de
  -- auth.users, nunca de user_metadata). Mesma mensagem genérica de propósito.
  select lower(email) into v_email from auth.users where id = v_uid;
  if v_email is distinct from v_inv.email then
    raise exception 'convite inválido ou expirado' using errcode = '22023';
  end if;

  if exists (select 1 from public.household_members where user_id = v_uid) then
    raise exception 'o usuário já pertence a uma família' using errcode = '55000';
  end if;

  select member_limit into v_limit from public.households where id = v_inv.household_id for update;
  select count(*) into v_count from public.household_members where household_id = v_inv.household_id;
  if v_count >= v_limit then
    raise exception 'limite de membros da família atingido (%)', v_limit using errcode = '55000';
  end if;

  insert into public.household_members (household_id, user_id, role)
  values (v_inv.household_id, v_uid, 'member');
  update public.invitations set accepted_at = now(), accepted_by = v_uid where id = v_inv.id;
  return v_inv.household_id;
end $$;

-- ---------------------------------------------------------------------------
create function public.remove_member(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_h   uuid;
  v_n   integer;
begin
  if v_uid is null then
    raise exception 'não autenticado' using errcode = '42501';
  end if;
  select m.household_id into v_h from public.household_members m
   where m.user_id = v_uid and m.role = 'owner';
  if v_h is null then
    raise exception 'somente o owner da família pode remover membros' using errcode = '42501';
  end if;
  if p_user is null or p_user = v_uid then
    raise exception 'use leave_household() para sair da família' using errcode = '22023';
  end if;
  -- o alvo precisa ser membro DA MESMA família do chamador
  delete from public.household_members where household_id = v_h and user_id = p_user;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'membro não encontrado na sua família' using errcode = '22023';
  end if;
end $$;

-- ---------------------------------------------------------------------------
create function public.leave_household() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := auth.uid();
  v_h    uuid;
  v_role text;
begin
  if v_uid is null then
    raise exception 'não autenticado' using errcode = '42501';
  end if;
  select household_id, role into v_h, v_role from public.household_members where user_id = v_uid;
  if v_h is null then
    raise exception 'o usuário não pertence a uma família' using errcode = '55000';
  end if;
  if v_role = 'owner' and not exists (
    select 1 from public.household_members
     where household_id = v_h and role = 'owner' and user_id <> v_uid
  ) then
    raise exception 'o único owner não pode sair: exclua a família ou transfira a propriedade'
      using errcode = '55000';
  end if;
  delete from public.household_members where household_id = v_h and user_id = v_uid;
end $$;

-- ---------------------------------------------------------------------------
-- Sem parâmetro: a família é a do chamador (N1), que precisa ser owner.
create function public.delete_household() returns void
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
  -- As FKs entre tabelas filhas são DEFERRABLE: adiá-las até o commit evita que a
  -- ordem da cascata (contas antes de lançamentos, por exemplo) cause falso erro.
  set constraints all deferred;
  delete from public.households where id = v_h; -- cascata em tudo
end $$;

-- ---------------------------------------------------------------------------
-- EXECUTE: ninguém por padrão; só authenticated nas RPCs públicas.
revoke execute on function
  public.create_household(text), public.create_invitation(text), public.accept_invitation(text),
  public.remove_member(uuid), public.leave_household(), public.delete_household()
  from public, anon;
grant execute on function
  public.create_household(text), public.create_invitation(text), public.accept_invitation(text),
  public.remove_member(uuid), public.leave_household(), public.delete_household()
  to authenticated;
