-- Migration 149: pagar a fatura e a parcela do empréstimo cobrado no cartão de uma vez.
--
-- Pedido do dono (22/11/2026): o parcelamento da fatura tem de ser visto e pago pelo cartão, não em Dívidas. O banco debita
-- um valor só (fatura + parcela); com a 148 o app pedia dois registros (Pagar fatura e, em Dívidas, a parcela). Agora o
-- "Pagar fatura" faz os dois NUMA transação: ou tudo entra, ou nada.
--
-- O empréstimo continua sendo empréstimo por baixo (de propósito): as compras parceladas já contaram como despesa quando
-- foram feitas; lançar as parcelas como compra de novo contaria o gasto duas vezes. Só os juros de cada parcela são despesa
-- nova, e saem daqui pela mesma regra de debt_schedule_record_payment.
--
-- O que muda:
--   * private.debt_installment_interest: quanto de uma parcela é juro (saldo × taxa do contrato), sem deixar o principal
--     passar do saldo; na última parcela do contrato o principal é o saldo que sobrou (a dívida fecha em zero).
--   * card_linked_due(cartão, fatura, data): as parcelas ainda não pagas dos empréstimos vinculados que caem nessa fatura
--     (ou ficaram para trás de faturas anteriores), com a divisão juros/principal na data. Só leitura.
--   * card_pay_with_linked(...): paga a fatura (debt_pay, mesma idempotência) e baixa essas parcelas
--     (debt_schedule_record_payment). Devolve quantas parcelas baixou.
-- Nada do que existia muda: debt_pay, debt_schedule_record_payment, card_months, debt_balances.

create function private.debt_installment_interest(p_balance numeric, p_rate_bps integer, p_amount numeric, p_last boolean)
returns numeric language sql immutable set search_path = '' as $$
  select case
    when p_balance <= 0 then p_amount
    -- última parcela do contrato: o principal é o saldo que sobrou (zera a dívida); o resto da parcela é juro
    when p_last then greatest(p_amount - p_balance, 0)
    else greatest(p_amount - p_balance, least(p_amount, round(p_balance * p_rate_bps / 10000.0, 2)))
  end
$$;
revoke execute on function private.debt_installment_interest(numeric, integer, numeric, boolean) from public, anon;
grant execute on function private.debt_installment_interest(numeric, integer, numeric, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- card_linked_due: uma linha por parcela 'planned' de empréstimo vinculado que card_linked_invoices põe na fatura p_label
-- OU numa fatura anterior (parcela que ficou para trás: o contrato exige baixar na ordem, então ela vai junto).
-- Ficam de fora, e seguem sendo baixadas em Dívidas: consignado (não sai de conta) e empréstimo sem saldo devedor (a
-- parcela inteira viraria juro em silêncio).
-- interest/principal usam o saldo devedor do empréstimo em p_date; com duas parcelas do MESMO empréstimo (atrasada + a do
-- mês), a prévia da segunda usa o mesmo saldo (o pagamento recalcula a cada parcela).
-- ---------------------------------------------------------------------------
create function public.card_linked_due(p_debt uuid, p_label text, p_date date)
returns table (schedule_id uuid, linked_debt_id uuid, linked_name text, installment_number integer, installment_count integer,
               due_date date, amount numeric, interest numeric, principal numeric, payment_account_id uuid)
language sql stable security invoker set search_path = '' as $$
  select s.id, l.id, l.name, s.installment_number, f.installment_count, s.due_date, s.amount, j.interest,
         s.amount - j.interest, l.payment_account_id
    from public.card_linked_invoices(p_debt) f
    join public.debts l on l.id = f.linked_debt_id
    join public.debt_payment_schedule s
      on s.household_id = l.household_id and s.debt_id = l.id and s.installment_number = f.installment_number
    join public.debt_balances(l.household_id, p_date) b on b.debt_id = l.id and b.debt > 0
    cross join lateral (
      select private.debt_installment_interest(b.debt, l.monthly_rate_bps, s.amount,
               not exists (select 1 from public.debt_payment_schedule x
                           where x.household_id = l.household_id and x.debt_id = l.id and x.status = 'planned'
                             and x.installment_number > s.installment_number)) as interest
    ) j
   where f.label <= p_label and s.status = 'planned' and l.payment_method is distinct from 'payroll'
   order by l.name, s.installment_number
$$;
revoke execute on function public.card_linked_due(uuid, text, date) from public, anon;
grant execute on function public.card_linked_due(uuid, text, date) to authenticated;

-- ---------------------------------------------------------------------------
-- card_pay_with_linked: p_amount é a parte da FATURA (0 = só as parcelas); as mesmas parcelas de card_linked_due (as da
-- fatura p_label e as atrasadas, na ordem do contrato) saem da mesma conta, na mesma data, cada uma pelo valor do contrato. p_category é a categoria de despesa dos juros (exigida por
-- debt_schedule_record_payment quando há juros). Repetir com a mesma p_idem não paga duas vezes: debt_pay devolve o
-- pagamento já feito e as parcelas já baixadas não estão mais 'planned'.
-- ---------------------------------------------------------------------------
create function public.card_pay_with_linked(p_card uuid, p_date date, p_account uuid, p_amount numeric, p_invoice uuid,
                                            p_label text, p_category uuid default null, p_idem uuid default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v public.debts%rowtype;
  r record;
  v_saldo numeric;
  v_juros numeric;
  v_n integer := 0;
begin
  v := private.debt_lock(p_card);
  if v.kind <> 'card' then
    raise exception 'só cartão tem fatura para pagar' using errcode = '22023';
  end if;
  if p_label is null or p_label !~ '^\d{4}-\d{2}$' or p_date is null or p_amount is null or p_amount < 0 then
    raise exception 'dados do pagamento inválidos' using errcode = '22023';
  end if;
  if p_amount > 0 then
    perform public.debt_pay(p_card, p_date, p_account, p_amount, p_invoice, false, p_idem);
  end if;
  for r in
    select s.id, l.id as debt_id, l.monthly_rate_bps, s.amount,
           not exists (select 1 from public.debt_payment_schedule x
                     where x.household_id = l.household_id and x.debt_id = l.id and x.status = 'planned'
                       and x.installment_number > s.installment_number) as ultima
      from public.card_linked_invoices(p_card) f
      join public.debts l on l.household_id = v.household_id and l.id = f.linked_debt_id
      join public.debt_payment_schedule s
        on s.household_id = l.household_id and s.debt_id = l.id and s.installment_number = f.installment_number
     where f.label <= p_label and s.status = 'planned' and l.payment_method is distinct from 'payroll'
     order by l.name, s.installment_number
  loop
    select b.debt into v_saldo from public.debt_balances(v.household_id, p_date) b where b.debt_id = r.debt_id;
    -- sem saldo devedor (corrigido para zero ou quitado por fora): não baixa aqui; a parcela inteira viraria despesa de juros
    continue when coalesce(v_saldo, 0) <= 0;
    v_juros := private.debt_installment_interest(v_saldo, r.monthly_rate_bps, r.amount, r.ultima);
    perform public.debt_schedule_record_payment(r.id, p_date, p_account, r.amount - v_juros, v_juros, 0,
                                                case when v_juros > 0 then p_category end, false);
    v_n := v_n + 1;
  end loop;
  if p_amount = 0 and v_n = 0 then
    raise exception 'nada a pagar nesta fatura' using errcode = '22023';
  end if;
  return v_n;
end $$;
revoke execute on function public.card_pay_with_linked(uuid, date, uuid, numeric, uuid, text, uuid, uuid) from public, anon;
grant execute on function public.card_pay_with_linked(uuid, date, uuid, numeric, uuid, text, uuid, uuid) to authenticated;
