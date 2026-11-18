-- Tudo Azul — migration 143: "Já foi cobrada" numa assinatura de cartão agendada (pedido do dono, 18/11/2026).
--
-- Caso real: o Meli+ estava agendado para 24/11, mas o Mercado Livre cobrou no cartão em 17/11. Para acertar, o dono tentou mudar a
-- data da cobrança agendada para hoje e o app recusou ("a data da cobrança precisa ser depois de hoje"). A regra está certa (uma
-- cobrança AGENDADA é futura; o que já aconteceu é COMPRA), mas faltava o caminho "isto já foi cobrado": hoje só dava para cancelar
-- a cobrança e lançar a compra à mão, em dois passos, sem nada ligando uma coisa à outra.
--
--   public.card_scheduled_charged(p_item uuid, p_charge_date date) → uuid
--   Vira UMA cobrança agendada em compra (debt_installments) na data em que ela de fato aconteceu (hoje ou antes). Faz o mesmo que
--   card_scheduled_convert (110040000) faz no fechamento da fatura anterior: a compra leva o recurrence_id e o occurrence_date do
--   item, a categoria e a descrição dele, e o item vira `converted` guardando o id da compra. Por isso nada é contado duas vezes:
--   card_scheduled_sync, card_subscription_previews, recurrence_materialize e card_scheduled_convert já ignoram a ocorrência que
--   virou compra (par recurrence_id + occurrence_date). Devolve o id da compra.
--
--   * a data é a da cobrança real: hoje ou antes (data futura continua sendo "editar a cobrança agendada");
--   * a fatura é a do ciclo daquela data (card_cycle_first), como numa compra comum; antes do início do cartão é recusada;
--   * fatura FECHADA e PAGA fica travada (064): se a data cair numa, a compra mudaria o total dela sem que o pago mudasse, e a fatura
--     voltaria a aparecer aberta. Por isso, como card_payment_move e card_installment_move, tira a foto das faturas travadas antes
--     (card_paid_snapshot) e confere depois (card_paid_lock_check): recusa com 55000, sem exceção; para corrigir, lança-se a compra
--     na fatura atual (achado do `revisor-dinheiro` na #433);
--   * como card_purchase_at: se a fatura da data fecharia antes de uma devolução em dinheiro já lançada, recusa (23514);
--   * só as demais cobranças da assinatura seguem agendadas, nos dias de antes: acertar o dia das próximas continua sendo "Editar
--     › Esta e as próximas" (a regra de data dessa edição não muda);
--   * cobrança que já não está agendada (convertida ou cancelada) é recusada (55000); outra família, 42501.
-- SECURITY DEFINER pelo mesmo motivo de card_scheduled_convert (o app não escreve nas tabelas); só mexe na família de quem chama
-- e trava o cartão antes (private.debt_lock). Teste: 135_card_scheduled_charged (falha sem esta migration).

create function public.card_scheduled_charged(p_item uuid, p_charge_date date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  s public.card_scheduled_items%rowtype; v_d public.debts%rowtype; v_closing date; v_id uuid; v_lock jsonb; v_refund date;
begin
  s := private.card_scheduled_item_lock(p_item);
  v_d := private.debt_lock(s.debt_id);
  if v_d.kind <> 'card' or v_d.closing_day is null then
    raise exception 'só vale para cartão com ciclo definido' using errcode = '22023';
  end if;
  if p_charge_date is null or p_charge_date > private.today_sp() then
    raise exception 'a data da cobrança precisa ser hoje ou antes; para uma data futura, edite a cobrança agendada' using errcode = '22023';
  end if;
  v_closing := private.card_cycle_first(v_d, p_charge_date);
  if v_closing <= v_d.reference_date then
    raise exception 'esta data cai antes do início do cartão (%)', v_d.reference_date using errcode = '23514';
  end if;
  select max(e.date) into v_refund from public.debt_events e
   where e.debt_id = v_d.id and e.kind = 'refund_cash' and e.voided_at is null;
  if v_refund is not null and v_closing <= v_refund then
    raise exception 'esta compra fecharia em %, antes de uma devolução já lançada em %: exclua a devolução ou escolha outra data',
      v_closing, v_refund using errcode = '23514';
  end if;
  v_lock := private.card_paid_snapshot(v_d.id);

  insert into public.debt_installments (household_id, debt_id, plan, seq, due_date, face, category_id,
                                        description, purchase_date, closing_day, due_day,
                                        recurrence_id, occurrence_date)
  values (s.household_id, s.debt_id, gen_random_uuid()::text, 1, v_closing, s.amount, s.category_id,
          s.description, p_charge_date, private.card_cycle_closing_day(v_d, v_closing),
          private.card_cycle_due_day(v_d, v_closing), s.recurrence_id, s.occurrence_date)
  on conflict (recurrence_id, occurrence_date) where recurrence_id is not null do nothing
  returning id into v_id;
  if v_id is null then
    raise exception 'esta cobrança já virou compra' using errcode = '55000';
  end if;

  update public.card_scheduled_items
     set status = 'converted', installment_id = v_id, charge_date = p_charge_date, closing_date = v_closing, updated_at = now()
   where id = s.id;
  perform private.debt_chk(s.debt_id);
  perform private.card_paid_lock_check(s.debt_id, v_lock);
  return v_id;
end $$;

revoke execute on function public.card_scheduled_charged(uuid, date) from public, anon;
grant execute on function public.card_scheduled_charged(uuid, date) to authenticated;
