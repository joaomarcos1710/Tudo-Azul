-- Tudo Azul — migration 124: a DATA da cobrança de uma assinatura de cartão já lançada também pode ser corrigida.
--
-- Problema (dono, 15/11/2026): a cobrança do Claude (R$ 799,90) está na fatura com a data 12/11, mas o banco cobrou em 03/11.
-- card_purchase_set_date (migration 115) recusava assinatura de cartão (55000 "a data é a da cobrança e não muda"), e a
-- edição "só esta" (card_scheduled_item_update, 110) só vale para cobrança ainda agendada, antes de virar parcela.
--
-- Por que a recusa não precisa mais existir: a 115 temia que mudar a data duplicasse a cobrança. Hoje toda geração e toda
-- leitura ligam a parcela à ocorrência pela chave (recurrence_id, occurrence_date), com índice único (card_scheduled_sync,
-- card_scheduled_convert, recurrence_materialize, card_recurrence_pending, card_subscription_previews, recurrence_overview
-- e a matriz de compromissos usam occurrence_date, nunca purchase_date). purchase_date é só a data mostrada da compra.
--
-- O que muda: apenas a recusa de parcela com recurrence_id sai de card_purchase_set_date. O resto fica igual (corpo da 115):
-- muda SÓ purchase_date, a fatura (due_date, closing_day, due_day) e a occurrence_date não mudam, nenhum valor muda; data
-- futura, nula, anterior a 2000, dívida que não é cartão e compra inexistente continuam recusadas. Assinatura e grants iguais.

create or replace function public.card_purchase_set_date(p_debt uuid, p_plan text, p_date date)
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
