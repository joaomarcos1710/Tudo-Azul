-- Tudo Azul — migration 20261112100000: trocar "de quem foi a despesa" de uma compra de cartão já lançada.
--
-- Problema (dono, 12/11/2026): não dava para corrigir a pessoa de compras passadas. Em conta o lançamento já aceita a
-- troca pela edição normal; a parcela de cartão (debt_installments) é imutável, e a única RPC que mexe na pessoa é
-- recurrence_set_person (só parcelas futuras e ainda não cobradas de uma recorrência).
--
-- Desenho: public.card_purchase_set_person(p_debt, p_plan, p_person_id, p_is_shared_expense) returns integer.
--   * Muda SÓ person_id e is_shared_expense de TODAS as parcelas da compra (mesmo plan), inclusive as já cobradas e as
--     de fatura paga e travada (064): é classificação analítica, nada de dinheiro entra em card_months, saldo ou
--     period_summary. Mesma ideia de card_credit_set_category (077). Por isso NÃO chama private.card_paid_lock_check.
--   * A brecha no gatilho de imutabilidade já existe (migration 079, marca de sessão app.person_classification = 'on',
--     que só deixa passar person_id/is_shared_expense). Aqui a marca é ligada só em volta do UPDATE e o valor anterior
--     é restaurado (não derrubamos a marca de uma RPC que nos tenha chamado).
--   * Escopo validado por private.validate_person_scope (23514: pessoa inexistente, de outra família, inativa ou
--     compartilhada + pessoa). Pessoa inativa só é aceita se já for a atual em alguma parcela da compra (histórico).
--   * Devolve quantas parcelas mudaram de fato (as que já estavam assim não são regravadas).
-- Códigos: 42501 não autenticado / dívida de outra família; 22023 dívida que não é cartão; 55000 compra inexistente;
-- 23514 escopo/pessoa inválida (o mesmo código de validate_person_scope e das outras RPCs de classificação).

create function public.card_purchase_set_person(
  p_debt uuid, p_plan text, p_person_id uuid default null, p_is_shared_expense boolean default false
) returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_d public.debts%rowtype;
  v_n integer;
  v_marca text;
begin
  -- autenticado, membro da família e dívida travada (como as outras RPCs de cartão)
  v_d := private.debt_lock(p_debt);
  if v_d.kind <> 'card' then
    raise exception 'só compra de cartão troca de pessoa' using errcode = '22023';
  end if;
  if p_plan is null or not exists (
    select 1 from public.debt_installments i
     where i.household_id = v_d.household_id and i.debt_id = p_debt and i.plan = p_plan
  ) then
    raise exception 'compra não encontrada' using errcode = '55000';
  end if;
  -- Pessoa inativa já vinculada à compra pode ficar (histórico: o gatilho guard_person_active, 083, também deixa);
  -- qualquer outra pessoa passa por private.validate_person_scope (existe, é desta família, está ativa, escopo certo).
  if p_person_id is not null and not coalesce(p_is_shared_expense, false) and exists (
    select 1 from public.debt_installments i
     where i.household_id = v_d.household_id and i.debt_id = p_debt and i.plan = p_plan and i.person_id = p_person_id
  ) then
    null;
  else
    perform private.validate_person_scope(v_d.household_id, p_person_id, p_is_shared_expense);
  end if;

  v_marca := coalesce(current_setting('app.person_classification', true), '');
  perform set_config('app.person_classification', 'on', true);
  update public.debt_installments i
     set person_id = p_person_id, is_shared_expense = coalesce(p_is_shared_expense, false)
   where i.household_id = v_d.household_id and i.debt_id = p_debt and i.plan = p_plan
     and (i.person_id is distinct from p_person_id
          or i.is_shared_expense is distinct from coalesce(p_is_shared_expense, false));
  get diagnostics v_n = row_count;
  perform set_config('app.person_classification', v_marca, true);
  return v_n;
end $$;

revoke execute on function public.card_purchase_set_person(uuid, text, uuid, boolean) from public, anon;
grant execute on function public.card_purchase_set_person(uuid, text, uuid, boolean) to authenticated;
