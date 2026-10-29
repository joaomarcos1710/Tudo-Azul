-- Tudo Azul — migration 018: finalizar recorrente exclui a regra, preservando o histórico
--
-- Antes: recurrence_end marcava active=false e mantinha a regra na seção "Encerrados".
-- Agora: recurrence_delete remove a regra definitivamente. Lançamentos futuros ainda não pagos
-- vão para a lixeira; lançamentos históricos e parcelas de cartão já materializadas permanecem.
--
-- As FKs transactions.recurrence_id e debt_installments.recurrence_id usam ON DELETE SET NULL,
-- portanto o histórico fica preservado e apenas perde o vínculo com a regra excluída.
-- A RPC trava a regra com recurrence_lock, impedindo corrida com recurrence_materialize.
-- Não altera migrations anteriores nem apaga dados financeiros.

-- A ligação recurrence_id/occurrence_date foi adicionada depois do trigger de imutabilidade.
-- A edição normal do cartão continua podendo mudar só face; a exclusão da regra pode mudar só
-- recurrence_id. Cada operação tem uma flag transacional própria e restrições explícitas.
create or replace function private.debt_installments_immutable() returns trigger
language plpgsql security invoker set search_path = '' as $
begin
  if current_setting('app.card_edit', true) = 'on'
     and (new.id, new.household_id, new.debt_id, new.plan, new.seq, new.due_date, new.category_id,
          new.category_type, new.created_at, new.description, new.purchase_date, new.closing_day, new.due_day,
          new.recurrence_id, new.occurrence_date)
         is not distinct from
         (old.id, old.household_id, old.debt_id, old.plan, old.seq, old.due_date, old.category_id,
          old.category_type, old.created_at, old.description, old.purchase_date, old.closing_day, old.due_day,
          old.recurrence_id, old.occurrence_date) then
    return new;
  end if;

  if current_setting('app.recurrence_delete', true) = 'on'
     and (new.id, new.household_id, new.debt_id, new.plan, new.seq, new.due_date, new.face, new.category_id,
          new.category_type, new.created_at, new.description, new.purchase_date, new.closing_day, new.due_day,
          new.occurrence_date)
         is not distinct from
         (old.id, old.household_id, old.debt_id, old.plan, old.seq, old.due_date, old.face, old.category_id,
          old.category_type, old.created_at, old.description, old.purchase_date, old.closing_day, old.due_day,
          old.occurrence_date) then
    return new;
  end if;

  raise exception 'parcela é imutável: use o cancelamento' using errcode = '42501';
end $;

create function public.recurrence_delete(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.recurrences%rowtype;
  v_recurrence_delete text := current_setting('app.recurrence_delete', true);
begin
  v := private.recurrence_lock(p_id);

  -- O futuro planejado deixa de ser compromisso recorrente e vai para a lixeira.
  -- Lançamentos pagos e ocorrências históricas permanecem; todo planejado futuro não pago vai para a lixeira.
  update public.transactions
     set deleted_at = now()
   where recurrence_id = v.id
     and status = 'planned'
     and deleted_at is null
     and date > private.today_sp();

  -- debt_installments tem trigger de imutabilidade. A flag própria permite somente
  -- a mudança de recurrence_id; face, datas, valores e demais campos continuam protegidos.
  -- A função restaura a flag anterior ao terminar.
  perform set_config('app.recurrence_delete', 'on', true);
  delete from public.recurrences where id = v.id;
  perform set_config('app.recurrence_delete', coalesce(v_recurrence_delete, ''), true);
  -- As FKs ON DELETE SET NULL preservam transactions e debt_installments,
  -- inclusive parcelas de cartão que já representam compras reais.
end $$;

revoke execute on function public.recurrence_delete(uuid) from public, anon;
grant execute on function public.recurrence_delete(uuid) to authenticated;
