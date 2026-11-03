-- Tudo Azul — migration 045: arquivar empréstimo/financiamento com contrato e agenda de parcelas.
-- debt_archive (migration 020) só olhava saldo, parcelas de cartão e recorrente. Desde a 038 um contrato
-- tem agenda (debt_payment_schedule): arquivar uma dívida quitada deixava parcelas "planejadas" soltas, que
-- seguiam aparecendo como compromissos futuros. Agora, com saldo zero, o arquivamento cancela as parcelas
-- planejadas que sobraram (status 'cancelled') e zera as parcelas restantes do contrato. Com saldo diferente
-- de zero continua recusando (23514). Reativar não recria as parcelas canceladas.
-- Excluir (debt_delete) não muda: parcela planejada sem pagamento não é movimento, e a agenda sai junto (cascade).

create or replace function public.debt_archive(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.debts%rowtype; b record;
begin
  v := private.debt_lock(p_id);
  select * into b from public.debt_balances(v.household_id, private.today_sp()) x where x.debt_id = v.id;
  if found and (b.balance <> 0 or b.planned_remaining <> 0) then
    raise exception 'tem saldo ou parcelas a vencer: quite ou cancele antes de arquivar' using errcode = '23514';
  end if;
  if exists (select 1 from public.recurrences r where r.debt_id = v.id and r.active) then
    raise exception 'tem recorrente ativo nesta dívida: exclua antes de arquivar' using errcode = '23514';
  end if;
  update public.debt_payment_schedule
     set status = 'cancelled', updated_at = now()
   where debt_id = v.id and household_id = v.household_id and status = 'planned';
  update public.debts
     set active = false,
         remaining_installments = case when remaining_installments is null then null else 0 end
   where id = v.id;
end $$;
