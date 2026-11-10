-- Tudo Azul — recorrência no cartão estilo Organizze, etapa 3: converter o item agendado em parcela
--
-- Decisão do dono (10/11/2026, docs/projeto/28): a recorrência de cartão já está lançada nas faturas futuras, mas só
-- ocupa o limite quando a fatura ANTERIOR fecha. Quando ela fecha, a fatura seguinte vira a aberta: é nesse momento
-- que os itens agendados dela viram parcela (debt_installments), com a data de cobrança de cada um.
--
--   public.card_scheduled_convert() → integer
--   Para cada cartão da família de quem chama, converte em parcela os itens `scheduled` cuja fatura já é a aberta (ou
--   anterior): closing_date <= private.card_cycle_first(cartão, hoje). Os itens das faturas mais adiante continuam
--   agendados e não ocupam o limite. A parcela entra na fatura (due_date = fechamento) com o ciclo do mês dela, a mesma
--   categoria e descrição do item, e a data de cobrança do item como data da compra (pode ser depois de hoje). O item
--   vira `converted` e guarda o id da parcela. Devolve quantos itens foram convertidos.
--
-- Por que nada é contado duas vezes: private.card_recurrence_pending, card_subscription_previews e card_scheduled_sync
-- já ignoram a ocorrência que virou parcela (par recurrence_id + occurrence_date); recurrence_materialize, no dia da
-- cobrança, usa o mesmo par com `on conflict do nothing` e não cria outra. Depois da conversão a ocorrência passa a
-- valer em card_months, "A cobrar" e card_limits pelas contas que já existem, sem código novo nelas.
--
-- Parcela é imutável (só o valor muda, por card_installment_edit): mudar o dia de um item já convertido não é possível.
-- Decisão do dono sobre isso ("talvez"): continua em aberto; esta migration não muda a imutabilidade.
--
-- SECURITY DEFINER pelo mesmo motivo de card_scheduled_sync (o app não escreve nas tabelas); só mexe na família de quem
-- chama e trava o cartão antes (private.debt_lock), como recurrence_materialize.

create function public.card_scheduled_convert() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_h uuid := private.current_household();
  v_today date := private.today_sp();
  v_debt uuid; v_d public.debts%rowtype; s public.card_scheduled_items%rowtype;
  v_id uuid; v_n integer := 0;
begin
  if (select auth.uid()) is null or v_h is null then
    raise exception 'não autenticado ou sem família' using errcode = '42501';
  end if;

  for v_debt in
    select distinct i.debt_id from public.card_scheduled_items i
     where i.household_id = v_h and i.status = 'scheduled' order by i.debt_id
  loop
    v_d := private.debt_lock(v_debt);
    continue when v_d.kind <> 'card' or v_d.closing_day is null;

    for s in
      select * from public.card_scheduled_items i
       where i.household_id = v_h and i.debt_id = v_debt and i.status = 'scheduled'
         and i.closing_date <= private.card_cycle_first(v_d, v_today)
       order by i.occurrence_date, i.id
       for update
    loop
      v_id := null;
      insert into public.debt_installments (household_id, debt_id, plan, seq, due_date, face, category_id,
                                            description, purchase_date, closing_day, due_day,
                                            recurrence_id, occurrence_date)
      values (s.household_id, s.debt_id, gen_random_uuid()::text, 1, s.closing_date, s.amount, s.category_id,
              s.description, s.charge_date, private.card_cycle_closing_day(v_d, s.closing_date),
              private.card_cycle_due_day(v_d, s.closing_date), s.recurrence_id, s.occurrence_date)
      on conflict (recurrence_id, occurrence_date) where recurrence_id is not null do nothing
      returning id into v_id;
      if v_id is not null then
        update public.card_scheduled_items set status = 'converted', installment_id = v_id, updated_at = now()
         where id = s.id;
        v_n := v_n + 1;
      end if;
    end loop;
    perform private.debt_chk(v_debt);
  end loop;
  return v_n;
end $$;

revoke execute on function public.card_scheduled_convert() from public, anon;
grant execute on function public.card_scheduled_convert() to authenticated;
