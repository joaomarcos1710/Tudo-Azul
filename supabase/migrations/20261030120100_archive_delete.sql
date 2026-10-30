-- Tudo Azul — migration 020: arquivar e excluir cartão (dívida) e excluir conta
--
-- Pedido do dono (30/10/2026): cartão criado não tinha onde excluir nem arquivar. A mesma regra vale para contas e,
-- no futuro, para investimentos:
--   * ARQUIVAR: some das escolhas e da lista principal, o histórico fica; aparece numa seção "Arquivados" e pode ser reativado.
--   * EXCLUIR: só quando nunca teve movimento (criado por engano). Com qualquer histórico o banco recusa e manda arquivar.
--
-- O que esta migration acrescenta (nada é alterado nem apagado nas migrations anteriores):
--   debt_archive(p_id)    desliga debts.active. Recusa se a dívida tem saldo ou parcelas a vencer (a dívida sumiria da lista
--                         sem ter sido paga) ou se ainda tem recorrente ativo (a regra continuaria gerando compra num
--                         cartão invisível). debt_balances não filtra por active: a dívida continua nos totais.
--   debt_unarchive(p_id)  liga debts.active de novo.
--   debt_delete(p_id)     apaga a dívida só se não há fatura, parcela, evento nem recorrente (ativo ou não) ligados a ela.
--   account_delete(p_id)  apaga a conta só se não há lançamento (nem na lixeira, nem como destino de transferência),
--                         evento de dívida, recorrente nem conferência ligados a ela. A API não apaga conta direto
--                         (migration 20261025150100): este é o único caminho.
--   Arquivar conta continua sendo accounts.active (UPDATE já permitido); o dinheiro dela segue nos saldos e totais.
--
-- Limite conhecido: o banco não recusa compra nem lançamento numa dívida arquivada; a tela é que não a oferece.
--
-- Códigos de erro: 42501 registro de outra família ou inexistente (a mesma resposta para os dois casos);
-- 23514 não pode arquivar (saldo, parcelas a vencer ou recorrente ativo); 23503 tem histórico, só pode arquivar.

create function public.debt_archive(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.debts%rowtype; b record;
begin
  v := private.debt_lock(p_id);
  select * into b from public.debt_balances(v.household_id, private.today_sp()) x where x.debt_id = v.id;
  if found and (b.balance <> 0 or b.planned_remaining <> 0) then
    raise exception 'tem saldo ou parcelas a vencer: quite ou cancele antes de arquivar' using errcode = '23514';
  end if;
  if exists (select 1 from public.recurrences r where r.debt_id = v.id and r.active) then
    raise exception 'tem recorrente ativo neste cartão: exclua antes de arquivar' using errcode = '23514';
  end if;
  update public.debts set active = false where id = v.id;
end $$;

create function public.debt_unarchive(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.debts%rowtype;
begin
  v := private.debt_lock(p_id);
  update public.debts set active = true where id = v.id;
end $$;

create function public.debt_delete(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.debts%rowtype;
begin
  v := private.debt_lock(p_id);
  if exists (select 1 from public.debt_invoices where debt_id = v.id)
     or exists (select 1 from public.debt_installments where debt_id = v.id)
     or exists (select 1 from public.debt_events where debt_id = v.id)
     or exists (select 1 from public.recurrences where debt_id = v.id) then
    raise exception 'tem histórico: só é possível arquivar' using errcode = '23503';
  end if;
  delete from public.debts where id = v.id;
end $$;

create function public.account_delete(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.accounts%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'não autenticado' using errcode = '42501';
  end if;
  select * into v from public.accounts where id = p_id and household_id = private.current_household() for update;
  if not found then
    raise exception 'registro não encontrado' using errcode = '42501';
  end if;
  if exists (select 1 from public.transactions t where t.account_id = v.id or t.destination_account_id = v.id)
     or exists (select 1 from public.debt_events e where e.account_id = v.id)
     or exists (select 1 from public.recurrences r where r.account_id = v.id or r.destination_account_id = v.id)
     or exists (select 1 from public.account_reconciliations c where c.account_id = v.id) then
    raise exception 'tem histórico: só é possível arquivar' using errcode = '23503';
  end if;
  delete from public.accounts where id = v.id;
end $$;

revoke execute on function public.debt_archive(uuid), public.debt_unarchive(uuid), public.debt_delete(uuid),
  public.account_delete(uuid) from public, anon;
grant execute on function public.debt_archive(uuid), public.debt_unarchive(uuid), public.debt_delete(uuid),
  public.account_delete(uuid) to authenticated;
