-- Tudo Azul — migration 009: "zerar tudo" (começar do zero)
--
-- Decisão do dono (24/10/2026): um botão que apaga TODOS os dados financeiros da família — lançamentos
-- (inclusive a lixeira), contas, cartões e dívidas, compras e parcelas, faturas, recorrências, conciliações
-- e orçamentos — para recomeçar com os saldos reais. A família, os membros e as categorias ficam.
--
-- Segurança:
--   * só o DONO da família (private.is_owner) e só com a frase de confirmação conferida AQUI, no banco;
--   * as travas de período conciliado valem para inserir e alterar, não para apagar; esta função é a única
--     porta de apagar tudo de uma vez, com registro (household_resets);
--   * a família de outro usuário nunca é tocada (tudo filtra por p_household, que precisa ser do chamador).
-- É IRREVERSÍVEL: a exportação CSV serve para consulta, não restaura.

create table public.household_resets (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  done_by      uuid references public.profiles (id) on delete set null,
  done_at      timestamptz not null default now(),
  counts       jsonb not null
);
-- só leitura para o cliente; quem grava é a função
grant select on public.household_resets to authenticated;
alter table public.household_resets enable row level security;
create policy household_resets_select on public.household_resets for select to authenticated
  using ((select private.is_member(household_id)));

-- Quanto existe hoje (para a tela mostrar o que será apagado). SECURITY INVOKER: a RLS decide.
create function public.reset_preview(p_household uuid)
returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'transactions',    (select count(*) from public.transactions where household_id = p_household),
    'accounts',        (select count(*) from public.accounts where household_id = p_household),
    'debts',           (select count(*) from public.debts where household_id = p_household),
    'installments',    (select count(*) from public.debt_installments where household_id = p_household),
    'events',          (select count(*) from public.debt_events where household_id = p_household),
    'recurrences',     (select count(*) from public.recurrences where household_id = p_household),
    'reconciliations', (select count(*) from public.account_reconciliations where household_id = p_household),
    'budgets',         (select count(*) from public.budgets where household_id = p_household)
  )
  where (select private.is_member(p_household))
$$;

create function public.reset_household(p_household uuid, p_confirmation text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_counts jsonb;
  v_n_tx bigint; v_n_acc bigint; v_n_debt bigint; v_n_inst bigint; v_n_ev bigint;
  v_n_rec bigint; v_n_recon bigint; v_n_bud bigint;
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

  -- uma operação por vez na família
  perform 1 from public.households where id = p_household for update;
  -- as FKs entre tabelas filhas são DEFERRABLE e a checagem de dívida é adiada ao commit (mesmo padrão de delete_household)
  set constraints all deferred;

  with d as (delete from public.account_reconciliations where household_id = p_household returning 1)
    select count(*) into v_n_recon from d;
  with d as (delete from public.transactions where household_id = p_household returning 1)
    select count(*) into v_n_tx from d;
  with d as (delete from public.debt_events where household_id = p_household returning 1)
    select count(*) into v_n_ev from d;
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

  v_counts := jsonb_build_object(
    'transactions', v_n_tx, 'accounts', v_n_acc, 'debts', v_n_debt, 'installments', v_n_inst, 'events', v_n_ev,
    'recurrences', v_n_rec, 'reconciliations', v_n_recon, 'budgets', v_n_bud);
  insert into public.household_resets (household_id, done_by, counts) values (p_household, v_uid, v_counts);
  return v_counts;
end $$;

revoke execute on function public.reset_preview(uuid), public.reset_household(uuid, text) from public, anon;
grant execute on function public.reset_preview(uuid), public.reset_household(uuid, text) to authenticated;
