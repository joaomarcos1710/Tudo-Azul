-- Tudo Azul — migration 072: etiquetas livres nas contas (decisão do dono de 06/11/2026).
-- Os 7 tipos de conta da 070 continuam FIXOS (os cálculos dependem deles). Em cima disso, cada família cria, renomeia
-- e apaga as próprias etiquetas ("Reserva de emergência", "Conjunta", "PJ"…) e marca quantas quiser em cada conta.
-- Motivo: pensando em um dia vender o app, cada usuário organiza as contas do jeito dele sem quebrar os indicadores.
--
-- Etiqueta NÃO entra em nenhum cálculo de dinheiro nem em relatório nesta migration (nenhuma função de saldo muda).
--
-- 1. public.account_tags: id, household_id, name (1..30 caracteres, sem espaço nas pontas), created_at.
--    Nome único na família sem diferenciar maiúscula (lower(name)). Sem cor por enquanto (selo neutro, contraste fixo).
-- 2. public.account_tag_links: (household_id, account_id, tag_id), PK (account_id, tag_id). As duas FKs são compostas
--    com household_id (o mesmo padrão de transactions -> accounts): ligar etiqueta de outra família, ou a conta de
--    outra família, é recusado pelo próprio banco (23503). Apagar a etiqueta ou a conta apaga as ligações (cascade).
-- 3. Limites: até 50 etiquetas por família e até 10 por conta (trigger, 23514 com texto para a tela).
--    atalho: a contagem do trigger não trava a família; duas inserções simultâneas podem passar 1 do limite. O limite
--    é de organização (não de dinheiro); melhorar com lock só se aparecer abuso.
-- 4. public.account_tags_set(p_account, p_tags): troca as etiquetas de uma conta numa transação só (SECURITY INVOKER:
--    a RLS do chamador decide; nada de SECURITY DEFINER).
-- 5. RLS e grants no padrão das tabelas da família (security.sql, migration 001): uma policy por operação, TO
--    authenticated, private.is_member(household_id); privilégio por coluna; anon sem nada.
-- 6. "Zerar tudo" (reset_household, 054) não muda: as ligações somem junto com as contas (cascade) e as etiquetas
--    ficam, como as categorias (são a organização da família, não dado financeiro). Excluir a família apaga tudo
--    (cascade de households).

create table public.account_tags (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name         text not null check (name = btrim(name) and char_length(name) between 1 and 30),
  created_at   timestamptz not null default now(),
  unique (household_id, id)
);
create unique index account_tags_name_uq on public.account_tags (household_id, lower(name));

create table public.account_tag_links (
  household_id uuid not null references public.households (id) on delete cascade,
  account_id   uuid not null,
  tag_id       uuid not null,
  created_at   timestamptz not null default now(),
  primary key (account_id, tag_id),
  constraint account_tag_links_account_fk foreign key (household_id, account_id)
    references public.accounts (household_id, id) on delete cascade,
  constraint account_tag_links_tag_fk foreign key (household_id, tag_id)
    references public.account_tags (household_id, id) on delete cascade
);
create index account_tag_links_tag_idx on public.account_tag_links (household_id, tag_id);

-- ---- limites (organização, não dinheiro) ----
create function private.account_tags_limit_guard()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_table_name = 'account_tags' then
    if (select count(*) from public.account_tags t where t.household_id = new.household_id) >= 50 then
      raise exception 'limite de 50 etiquetas por família: apague uma que não usa antes de criar outra' using errcode = '23514';
    end if;
  else
    -- a própria ligação não conta: reenviar uma que já existe (on conflict do nothing) não esbarra no limite
    if (select count(*) from public.account_tag_links l
         where l.account_id = new.account_id and l.tag_id <> new.tag_id) >= 10 then
      raise exception 'limite de 10 etiquetas por conta' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
revoke execute on function private.account_tags_limit_guard() from public, anon, authenticated;

create trigger account_tags_limit before insert on public.account_tags
  for each row execute function private.account_tags_limit_guard();
create trigger account_tag_links_limit before insert on public.account_tag_links
  for each row execute function private.account_tags_limit_guard();

-- ---- trocar as etiquetas de uma conta de uma vez ----
create function public.account_tags_set(p_account uuid, p_tags uuid[])
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_household uuid;
  v_tags uuid[] := array_remove(coalesce(p_tags, '{}'), null);
begin
  select a.household_id into v_household from public.accounts a where a.id = p_account;
  if v_household is null or not (select private.is_member(v_household)) then
    raise exception 'conta não encontrada' using errcode = '42501';
  end if;
  delete from public.account_tag_links l
   where l.account_id = p_account and not (l.tag_id = any (v_tags));
  insert into public.account_tag_links (household_id, account_id, tag_id)
  select v_household, p_account, t from unnest(v_tags) as u(t)
   group by t
  on conflict (account_id, tag_id) do nothing;
end $$;
revoke execute on function public.account_tags_set(uuid, uuid[]) from public, anon;
grant execute on function public.account_tags_set(uuid, uuid[]) to authenticated;

-- ---- privilégios (por coluna) e RLS ----
revoke all on public.account_tags, public.account_tag_links from anon, authenticated;
grant select, delete on public.account_tags to authenticated;
grant insert (household_id, name) on public.account_tags to authenticated;
grant update (name) on public.account_tags to authenticated;
grant select, delete on public.account_tag_links to authenticated;
grant insert (household_id, account_id, tag_id) on public.account_tag_links to authenticated;

alter table public.account_tags      enable row level security;
alter table public.account_tag_links enable row level security;

create policy account_tags_select on public.account_tags for select to authenticated
  using ((select private.is_member(household_id)));
create policy account_tags_insert on public.account_tags for insert to authenticated
  with check ((select private.is_member(household_id)));
create policy account_tags_update on public.account_tags for update to authenticated
  using ((select private.is_member(household_id))) with check ((select private.is_member(household_id)));
create policy account_tags_delete on public.account_tags for delete to authenticated
  using ((select private.is_member(household_id)));

create policy account_tag_links_select on public.account_tag_links for select to authenticated
  using ((select private.is_member(household_id)));
create policy account_tag_links_insert on public.account_tag_links for insert to authenticated
  with check ((select private.is_member(household_id)));
create policy account_tag_links_delete on public.account_tag_links for delete to authenticated
  using ((select private.is_member(household_id)));
