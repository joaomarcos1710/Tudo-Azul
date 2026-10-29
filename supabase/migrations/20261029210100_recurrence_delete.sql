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

create function public.recurrence_delete(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.recurrences%rowtype;
  v_card_edit text := current_setting('app.card_edit', true);
begin
  v := private.recurrence_lock(p_id);

  -- O futuro planejado deixa de ser compromisso recorrente e vai para a lixeira.
  -- O que já foi pago, o que ficou no passado e o que foi corrigido manualmente permanece.
  update public.transactions
     set deleted_at = now()
   where recurrence_id = v.id
     and status = 'planned'
     and deleted_at is null
     and date > private.today_sp();

  -- debt_installments tem trigger de imutabilidade. A flag interna permite somente
  -- a mudança de recurrence_id (as demais colunas protegidas continuam idênticas).
  -- Restauramos o valor anterior para não abrir essa exceção a outras operações da transação.
  perform set_config('app.card_edit', 'on', true);
  delete from public.recurrences where id = v.id;
  perform set_config('app.card_edit', coalesce(v_card_edit, ''), true);
  -- As FKs ON DELETE SET NULL preservam transactions e debt_installments,
  -- inclusive parcelas de cartão que já representam compras reais.
end $$;

revoke execute on function public.recurrence_delete(uuid) from public, anon;
grant execute on function public.recurrence_delete(uuid) to authenticated;
