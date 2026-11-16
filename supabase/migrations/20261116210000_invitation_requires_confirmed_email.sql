-- Tudo Azul — migration 129: aceitar convite exige e-mail confirmado
--
-- Achado da revisão externa de 16/11/2026 (prioridade média, condicional): public.accept_invitation (migration
-- 20261013120400_household_rpcs.sql) compara o e-mail da conta com o do convite, mas não olha se esse e-mail foi
-- confirmado. Se o Auth hospedado deixar entrar uma conta com e-mail ainda não confirmado, quem criasse uma conta com o
-- e-mail de outra pessoa e tivesse o link do convite entraria na família dela sem provar que é dona da caixa postal.
-- A configuração do Auth hospedado não foi conferida; a trava fica no banco de qualquer jeito (não depende só dela).
--
-- O que muda (create or replace; nenhuma migration anterior é editada):
--   * Logo depois de "não autenticado", e ANTES de procurar o convite: se auth.users.email_confirmed_at da conta for nulo,
--     recusa com 55000 e "confirme o seu e-mail antes de aceitar o convite". A ordem é de propósito: a resposta não diz se
--     o link é válido, de quem é nem para que família aponta.
--   * O resto do corpo é idêntico ao da 20261013120400 (token, e-mail igual ao do convite, quem já tem família, limite de
--     membros, gravação). Mesma assinatura, SECURITY DEFINER e search_path vazio; os grants da função continuam (create
--     or replace preserva), e o 00_audit não muda (a função já está nas listas).
-- Teste: 05_rpc (conta não confirmada recusada com convite válido e com token inválido; depois de confirmar, aceita).

create or replace function public.accept_invitation(p_token text) returns uuid
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

  -- e-mail ainda não confirmado: recusa antes de olhar o convite (não revela se o link vale)
  if not exists (select 1 from auth.users u where u.id = v_uid and u.email_confirmed_at is not null) then
    raise exception 'confirme o seu e-mail antes de aceitar o convite' using errcode = '55000';
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
