-- Tudo Azul — migration 036: trocar a categoria de um recorrente vale para TODAS as ocorrências
--
-- Pedido do dono (02/11/2026): "mudei a categoria do lançamento recorrente e não alterou nos extratos". Decisão dele:
-- a nova categoria vai para as ocorrências passadas e futuras, EXCETO as que ele já tinha mudado à mão.
--
-- Defeito (duas lacunas em recurrence_update, migrations 006 e 015):
--   1. só os planejados de hoje em diante acompanhavam a regra; ocorrência paga ou passada ficava na categoria antiga;
--   2. recorrente de CARTÃO gera parcelas (debt_installments), não lançamentos, e a função só atualizava transactions:
--      a categoria de uma assinatura de cartão nunca propagava, nem para o futuro.
--
-- Regra desta migration (a mesma lógica da 015, agora para todas as ocorrências):
--   a ocorrência acompanha a regra se a categoria dela ainda é IGUAL à que a regra tinha antes da troca. Categoria
--   diferente = escolhida à mão = fica como está. Vale para ocorrência paga, planejada, passada, futura e na lixeira
--   (restaurar não traz a categoria velha de volta). Nada mais muda nelas: valor, data, conta, descrição, status e
--   conciliação ficam como estão (o gatilho de período já ignora mudança só de categoria). Valor e descrição continuam
--   valendo só para os planejados de hoje em diante, como na 015.
--
-- Parcela de cartão: a trava de imutabilidade (debt_installments_immutable) passa a aceitar a mudança de
-- category_id, e SOMENTE ela, quando a função liga o sinal app.recurrence_category dentro da transação (mesmo padrão
-- de app.card_edit). Qualquer outra coluna, ou qualquer outro caminho, continua barrado.
--
-- Limite conhecido: "editar" a categoria de uma ocorrência para exatamente a categoria da regra não deixa rastro e
-- continua acompanhando a regra. Edições sobrescritas antes desta migration não podem ser recuperadas.
-- Valor e descrição de parcelas de cartão continuam sem acompanhar a regra (fora do pedido).

create or replace function private.debt_installments_immutable() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if current_setting('app.card_edit', true) = 'on'
     and (new.id, new.household_id, new.debt_id, new.plan, new.seq, new.due_date, new.category_id,
          new.category_type, new.created_at, new.description, new.purchase_date, new.closing_day, new.due_day)
         is not distinct from
         (old.id, old.household_id, old.debt_id, old.plan, old.seq, old.due_date, old.category_id,
          old.category_type, old.created_at, old.description, old.purchase_date, old.closing_day, old.due_day) then
    return new;
  end if;
  -- troca de categoria vinda de recurrence_update: tudo o mais da parcela (inclusive o valor) tem de ficar igual
  if current_setting('app.recurrence_category', true) = 'on'
     and (new.id, new.household_id, new.debt_id, new.plan, new.seq, new.due_date, new.face,
          new.category_type, new.created_at, new.description, new.purchase_date, new.closing_day, new.due_day,
          new.recurrence_id, new.occurrence_date)
         is not distinct from
         (old.id, old.household_id, old.debt_id, old.plan, old.seq, old.due_date, old.face,
          old.category_type, old.created_at, old.description, old.purchase_date, old.closing_day, old.due_day,
          old.recurrence_id, old.occurrence_date) then
    return new;
  end if;
  raise exception 'parcela é imutável: use o cancelamento' using errcode = '42501';
end $$;

create or replace function public.recurrence_update(p_id uuid, p_description text, p_amount numeric, p_category uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.recurrences%rowtype;  -- a regra ANTES do reajuste (lida sob lock)
  v_new_cat uuid;
begin
  v := private.recurrence_lock(p_id);
  if p_amount is null or p_amount <= 0 then
    raise exception 'parâmetros inválidos' using errcode = '22023';
  end if;
  v_new_cat := case when v.kind = 'transfer' then null else coalesce(p_category, v.category_id) end;
  update public.recurrences
     set description = btrim(p_description), amount = p_amount, category_id = v_new_cat
   where id = v.id;
  -- planejados de hoje em diante: valor, descrição e categoria acompanham a regra (campo a campo, como na 015)
  update public.transactions t
     set amount      = case when t.amount = v.amount then p_amount else t.amount end,
         description = case when t.description = v.description then btrim(p_description) else t.description end,
         category_id = case when v.kind = 'transfer' then null
                            when t.category_id is not distinct from v.category_id then v_new_cat
                            else t.category_id end
   where t.recurrence_id = v.id and t.status = 'planned' and t.deleted_at is null and t.date >= private.today_sp();
  -- categoria nas DEMAIS ocorrências (pagas, passadas, na lixeira): só se ainda for a da regra antiga
  if v.kind <> 'transfer' and v_new_cat is distinct from v.category_id then
    update public.transactions t
       set category_id = v_new_cat
     where t.recurrence_id = v.id and t.category_id is not distinct from v.category_id
       and not (t.status = 'planned' and t.deleted_at is null and t.date >= private.today_sp());
    if v.kind = 'card' then
      perform set_config('app.recurrence_category', 'on', true);
      update public.debt_installments i
         set category_id = v_new_cat
       where i.recurrence_id = v.id and i.category_id = v.category_id;
      perform set_config('app.recurrence_category', 'off', true);
    end if;
  end if;
end $$;
