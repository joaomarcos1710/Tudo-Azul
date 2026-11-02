-- Tudo Azul — migration 031: recorrentes encerrados são excluídos, não arquivados
--
-- Regras já encerradas deixam de ocupar a lista/arquivo. ON DELETE SET NULL preserva os
-- lançamentos pagos e as parcelas de cartão no histórico, sem manter vínculo com a regra.
-- Planejados até a data final permanecem como compromissos; planejados posteriores já
-- são enviados à lixeira pela operação de encerramento.
--
-- A parcela do cartão é imutável. O sinal app.card_edit permite somente o ON DELETE SET NULL
-- de recurrence_id, conforme a proteção estabelecida na migration 018.

create or replace function public.recurrence_end(p_id uuid, p_end date default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.recurrences%rowtype;
  v_end date;
begin
  v := private.recurrence_lock(p_id);
  v_end := greatest(coalesce(p_end, private.today_sp()), v.start_date);

  update public.transactions
     set deleted_at = now()
   where recurrence_id = v.id
     and status = 'planned'
     and deleted_at is null
     and date > v_end;

  perform set_config('app.card_edit', 'on', true);
  delete from public.recurrences where id = v.id;
  perform set_config('app.card_edit', 'off', true);
end
$$;

revoke execute on function public.recurrence_end(uuid, date) from public, anon;
grant execute on function public.recurrence_end(uuid, date) to authenticated;

-- Limpeza única do arquivo legado. Os vínculos são desfeitos por ON DELETE SET NULL,
-- preservando os lançamentos efetivos e as parcelas que já pertencem ao histórico.
do $cleanup$
begin
  perform set_config('app.card_edit', 'on', true);
  delete from public.recurrences where active = false;
  perform set_config('app.card_edit', 'off', true);
end
$cleanup$;
