-- Tudo Azul — migration 018: excluir recorrente
--
-- Pedido do dono (29/10/2026): ao finalizar um recorrente ele não deve ficar guardado como "Encerrado"; deve ser excluído.
--
-- O que esta migration acrescenta (nada é alterado nem apagado nas migrations anteriores):
--   recurrence_delete(p_id): apaga a regra (ativa ou já encerrada) e devolve quantos planejados foram para a lixeira.
--     - planejados não pagos de hoje em diante (e ainda fora da lixeira) vão para a lixeira (podem ser restaurados);
--     - planejados já vencidos e não pagos ficam, para a pessoa pagar ou excluir (são compromissos que existiram);
--     - lançamentos pagos e compras já geradas no cartão (parcelas) ficam intactos: só perdem o vínculo com a regra
--       (transactions.recurrence_id e debt_installments.recurrence_id viram null pelo ON DELETE SET NULL da migration 006).
--
-- A parcela de cartão é imutável (private.debt_installments_immutable), e o ON DELETE SET NULL é um UPDATE. Por isso a
-- função liga o mesmo sinal que a edição de parcela usa (app.card_edit), só durante o DELETE e só dentro da transação:
-- a guarda continua conferindo que nenhuma outra coluna da parcela muda (o vínculo com a regra não faz parte dela).
--
-- Códigos de erro: 42501 regra de outra família ou inexistente (a mesma resposta para os dois casos).

create function public.recurrence_delete(p_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v public.recurrences%rowtype; v_n integer;
begin
  v := private.recurrence_lock(p_id);
  update public.transactions set deleted_at = now()
   where recurrence_id = v.id and status = 'planned' and deleted_at is null and date >= private.today_sp();
  get diagnostics v_n = row_count;
  perform set_config('app.card_edit', 'on', true);
  delete from public.recurrences where id = v.id;
  perform set_config('app.card_edit', 'off', true);
  return v_n;
end $$;

revoke execute on function public.recurrence_delete(uuid) from public, anon;
grant execute on function public.recurrence_delete(uuid) to authenticated;
