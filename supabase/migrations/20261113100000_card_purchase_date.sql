-- Tudo Azul — migration 115: corrigir a DATA DA COMPRA de uma compra de cartão já lançada.
--
-- Problema (dono, 13/11/2026): uma compra foi lançada no dia errado e não há como alterar a data. A parcela de cartão
-- (debt_installments) é imutável, e nenhuma RPC mexia em purchase_date.
--
-- Desenho: public.card_purchase_set_date(p_debt, p_plan, p_date) returns integer. Muda SÓ purchase_date, de TODAS as
-- parcelas da compra (mesmo plan: a data da compra é uma só). A FATURA em que cada parcela cai NÃO muda (due_date,
-- closing_day e due_day ficam como estão): quem quiser outra fatura usa "Enviar para a fatura anterior/próxima"
-- (card_installment_move, migration 111). Assim nenhum valor de fatura, saldo, limite ou orçamento muda por causa de uma data.
--
-- O que a data muda de fato: só a ordem da fatura e o relatório de despesas por categoria quando o dono escolhe a base
-- "data da compra" ou "data da parcela" (migration 062, expenses_by_category_basis). Na base padrão (fatura) e em
-- card_months, period_summary, saldo e projeções nada se mexe. Por isso, como a troca de pessoa (migration 111), vale
-- também para parcela já cobrada e de fatura paga e travada: NÃO chama private.card_paid_lock_check.
--
-- Recusas: 42501 não autenticado / dívida de outra família; 22023 dívida que não é cartão, data nula, futura (data de hoje
-- em São Paulo) ou anterior a 2000-01-01; 55000 compra inexistente; 55000 assinatura de cartão (parcela com recurrence_id:
-- a data é a da cobrança e a geração das assinaturas confere por ela, então mudar poderia duplicar a cobrança).
-- Devolve quantas parcelas mudaram de fato (as que já tinham a data não são regravadas).
--
-- A brecha no gatilho de imutabilidade é uma marca de sessão nova, app.card_purchase_date = 'on', que só deixa passar
-- purchase_date (todo o resto da tupla tem de ficar igual). private.debt_installments_immutable é recriado a partir do corpo
-- da migration 20261112110000 (111), sem mudar nenhum outro ramo. A marca é ligada só em volta do UPDATE e o valor
-- anterior é restaurado.

create or replace function private.debt_installments_immutable()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  -- RPC de classificação: somente person_id/is_shared_expense podem mudar.
  if current_setting('app.person_classification', true) = 'on'
     and (new.id, new.household_id, new.debt_id, new.plan, new.seq, new.due_date, new.face,
          new.category_id, new.category_type, new.created_at, new.description, new.purchase_date,
          new.closing_day, new.due_day, new.recurrence_id, new.occurrence_date)
         is not distinct from
         (old.id, old.household_id, old.debt_id, old.plan, old.seq, old.due_date, old.face,
          old.category_id, old.category_type, old.created_at, old.description, old.purchase_date,
          old.closing_day, old.due_day, old.recurrence_id, old.occurrence_date) then
    return new;
  end if;
  -- Edição financeira autorizada de parcela e ON DELETE SET NULL do vínculo recorrente.
  if current_setting('app.card_edit', true) = 'on'
     and (new.id, new.household_id, new.debt_id, new.plan, new.seq, new.due_date, new.category_id,
          new.category_type, new.created_at, new.description, new.purchase_date, new.closing_day,
          new.due_day, new.person_id, new.is_shared_expense)
         is not distinct from
         (old.id, old.household_id, old.debt_id, old.plan, old.seq, old.due_date, old.category_id,
          old.category_type, old.created_at, old.description, old.purchase_date, old.closing_day,
          old.due_day, old.person_id, old.is_shared_expense) then
    return new;
  end if;
  -- Sincronização de categoria das parcelas de recorrência (migration 036): somente category_id muda.
  if current_setting('app.recurrence_category', true) = 'on'
     and (new.id, new.household_id, new.debt_id, new.plan, new.seq, new.due_date, new.face,
          new.category_type, new.created_at, new.description, new.purchase_date, new.closing_day,
          new.due_day, new.recurrence_id, new.occurrence_date, new.person_id, new.is_shared_expense)
         is not distinct from
         (old.id, old.household_id, old.debt_id, old.plan, old.seq, old.due_date, old.face,
          old.category_type, old.created_at, old.description, old.purchase_date, old.closing_day,
          old.due_day, old.recurrence_id, old.occurrence_date, old.person_id, old.is_shared_expense) then
    return new;
  end if;
  -- Migration 111: mudar a parcela de fatura (card_installment_move): só a data de fechamento (due_date) e os dias do
  -- ciclo gravados nela (closing_day, due_day). Todo o resto tem de ficar igual.
  if current_setting('app.card_installment_move', true) = 'on'
     and (new.id, new.household_id, new.debt_id, new.plan, new.seq, new.face, new.category_id, new.category_type,
          new.created_at, new.description, new.purchase_date, new.recurrence_id, new.occurrence_date,
          new.person_id, new.is_shared_expense)
         is not distinct from
         (old.id, old.household_id, old.debt_id, old.plan, old.seq, old.face, old.category_id, old.category_type,
          old.created_at, old.description, old.purchase_date, old.recurrence_id, old.occurrence_date,
          old.person_id, old.is_shared_expense) then
    return new;
  end if;
  -- Migration 115: corrigir a data da compra (card_purchase_set_date): só purchase_date muda. A fatura (due_date e os dias do
  -- ciclo), o valor, a descrição, a categoria, a pessoa e o vínculo com assinatura têm de ficar iguais.
  if current_setting('app.card_purchase_date', true) = 'on'
     and (new.id, new.household_id, new.debt_id, new.plan, new.seq, new.due_date, new.face, new.category_id,
          new.category_type, new.created_at, new.description, new.closing_day, new.due_day, new.recurrence_id,
          new.occurrence_date, new.person_id, new.is_shared_expense)
         is not distinct from
         (old.id, old.household_id, old.debt_id, old.plan, old.seq, old.due_date, old.face, old.category_id,
          old.category_type, old.created_at, old.description, old.closing_day, old.due_day, old.recurrence_id,
          old.occurrence_date, old.person_id, old.is_shared_expense) then
    return new;
  end if;
  raise exception 'parcela é imutável: use o cancelamento' using errcode = '42501';
end $$;

create function public.card_purchase_set_date(p_debt uuid, p_plan text, p_date date)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_d public.debts%rowtype;
  v_n integer;
  v_marca text;
begin
  -- autenticado, membro da família e dívida travada (como as outras RPCs de cartão)
  v_d := private.debt_lock(p_debt);
  if v_d.kind <> 'card' then
    raise exception 'só compra de cartão muda de data' using errcode = '22023';
  end if;
  if p_date is null then
    raise exception 'informe a data da compra' using errcode = '22023';
  end if;
  if p_date > (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'a data da compra não pode ser futura' using errcode = '22023';
  end if;
  if p_date < date '2000-01-01' then
    raise exception 'data da compra inválida' using errcode = '22023';
  end if;
  if p_plan is null or not exists (
    select 1 from public.debt_installments i
     where i.household_id = v_d.household_id and i.debt_id = p_debt and i.plan = p_plan
  ) then
    raise exception 'compra não encontrada' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.debt_installments i
     where i.household_id = v_d.household_id and i.debt_id = p_debt and i.plan = p_plan and i.recurrence_id is not null
  ) then
    raise exception 'assinatura de cartão: a data é a da cobrança e não muda' using errcode = '55000';
  end if;

  v_marca := coalesce(current_setting('app.card_purchase_date', true), '');
  perform set_config('app.card_purchase_date', 'on', true);
  update public.debt_installments i
     set purchase_date = p_date
   where i.household_id = v_d.household_id and i.debt_id = p_debt and i.plan = p_plan
     and i.purchase_date is distinct from p_date;
  get diagnostics v_n = row_count;
  perform set_config('app.card_purchase_date', v_marca, true);
  return v_n;
end $$;

revoke execute on function public.card_purchase_set_date(uuid, text, date) from public, anon;
grant execute on function public.card_purchase_set_date(uuid, text, date) to authenticated;
