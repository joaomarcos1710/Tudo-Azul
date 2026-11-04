-- 054: "zerar tudo" passa a cobrir as tabelas criadas depois da migration 009.
-- O reset_household da 009 não conhecia investimentos (028/035), bens da família (036) nem a agenda de parcelas
-- do contrato de dívida (037). Reproduzido no Postgres local (teste 54): o reset NÃO quebrava, mas deixava para trás
-- ativos de investimento, operações, avaliações, bens e avaliações de bens (o patrimônio continuava aparecendo
-- depois de "zerar tudo"). Proventos e agenda já sumiam por cascata (transactions e debts), mas sem contagem.
-- Agora a prévia conta e o reset apaga, explicitamente e na ordem das FKs, cada uma dessas tabelas; o jsonb e o
-- registro em household_resets ganham as contagens novas.
-- Ficam como estavam: família, membros, categorias, configuração do aviso diário (daily_digest_settings, é
-- preferência de cada pessoa, não dado financeiro) e o próprio histórico de household_resets.
-- Segurança igual à 009: só o dono, frase conferida aqui, lock da família, SECURITY DEFINER com search_path vazio.

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
    'family_asset_valuations',  (select count(*) from public.family_asset_valuations where household_id = p_household)
  )
  where (select private.is_member(p_household))
$$;

create or replace function public.reset_household(p_household uuid, p_confirmation text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_counts jsonb;
  v_n_tx bigint; v_n_acc bigint; v_n_debt bigint; v_n_inst bigint; v_n_ev bigint; v_n_sched bigint;
  v_n_rec bigint; v_n_recon bigint; v_n_bud bigint;
  v_n_ia bigint; v_n_io bigint; v_n_iv bigint; v_n_id bigint; v_n_fa bigint; v_n_fav bigint;
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

  v_counts := jsonb_build_object(
    'transactions', v_n_tx, 'accounts', v_n_acc, 'debts', v_n_debt, 'installments', v_n_inst, 'events', v_n_ev,
    'schedule', v_n_sched, 'recurrences', v_n_rec, 'reconciliations', v_n_recon, 'budgets', v_n_bud,
    'investment_assets', v_n_ia, 'investment_operations', v_n_io, 'investment_valuations', v_n_iv,
    'investment_distributions', v_n_id, 'family_assets', v_n_fa, 'family_asset_valuations', v_n_fav);
  -- zerar uma família que já está vazia (duplo clique, duas abas) não gera registro
  if v_n_tx + v_n_acc + v_n_debt + v_n_inst + v_n_ev + v_n_sched + v_n_rec + v_n_recon + v_n_bud
     + v_n_ia + v_n_io + v_n_iv + v_n_id + v_n_fa + v_n_fav > 0 then
    insert into public.household_resets (household_id, done_by, counts) values (p_household, v_uid, v_counts);
  end if;
  return v_counts;
end $$;

revoke execute on function public.reset_preview(uuid), public.reset_household(uuid, text) from public, anon;
grant execute on function public.reset_preview(uuid), public.reset_household(uuid, text) to authenticated;
