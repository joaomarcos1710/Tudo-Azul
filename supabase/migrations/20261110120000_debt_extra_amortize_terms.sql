-- Tudo Azul — migration 103: amortização extra que reduz o prazo ou a parcela, numa operação só
--
-- Pedido do dono (10/11/2026): em todos os contratos a amortização extra pode ser abatida no prazo (menos parcelas, mesma
-- parcela) ou na parcela (mesmo prazo, parcela menor). Até aqui a amortização só diminuía o saldo; prazo e parcela do
-- contrato ficavam como estavam e a agenda não mudava.
--
-- Decisão do dono: o app NÃO calcula nada. Quem informa o novo prazo ou a nova parcela é o extrato do banco (o financiamento é
-- SAC, em que a conta do banco difere de uma fórmula simples). O banco aqui só grava o que foi informado, com as travas.
--
--   public.debt_extra_amortize(p_debt, p_date, p_account, p_principal, p_mode, p_remaining, p_installment,
--                              p_interest, p_fee, p_category)
--     1. registra a amortização com debt_record_payment(..., p_extra => true) (aceita conta nula, ex.: FGTS, migration 102);
--     2. p_mode = 'term': o prazo restante passa a p_remaining (menor ou igual ao atual) e a parcela fica igual;
--        p_mode = 'installment': a parcela passa a p_installment (menor ou igual à atual) e o prazo fica igual;
--     3. refaz as parcelas planejadas com debt_contract_set (as já pagas não mudam; o número da próxima parcela é mantido).
--   Tudo na mesma transação: se qualquer passo falhar, nem a amortização fica registrada.
--
-- Só empréstimo/financiamento com contrato (parcelas cadastradas) e com parcela em aberto. Sem grants novos além de authenticated.
-- Teste: 97_debt_extra_amortize_terms (falha sem esta migration).

create function public.debt_extra_amortize(
  p_debt uuid,
  p_date date,
  p_account uuid,
  p_principal numeric,
  p_mode text,
  p_remaining integer default null,
  p_installment numeric default null,
  p_interest numeric default 0,
  p_fee numeric default 0,
  p_category uuid default null
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_d public.debts%rowtype;
  v_op uuid;
  v_first date;
  v_original integer;
  v_remaining integer;
  v_amount numeric;
begin
  v_d := private.debt_lock(p_debt);

  if v_d.kind not in ('loan','financing') then
    raise exception 'amortização com ajuste de contrato só para empréstimo ou financiamento' using errcode = '22023';
  end if;
  if v_d.original_installments is null or coalesce(v_d.remaining_installments, 0) = 0 then
    raise exception 'esta dívida não tem parcelas em aberto para ajustar; use o pagamento comum' using errcode = '22023';
  end if;
  if p_mode is null or p_mode not in ('term','installment') then
    raise exception 'informe se a amortização reduziu o prazo ou a parcela' using errcode = '22023';
  end if;

  v_original := v_d.original_installments;
  v_remaining := v_d.remaining_installments;
  v_amount := v_d.installment_amount;

  if p_mode = 'term' then
    if p_remaining is null or p_remaining < 0 or p_remaining > v_d.remaining_installments then
      raise exception 'o prazo restante novo não pode ser maior que o atual (%)', v_d.remaining_installments using errcode = '22023';
    end if;
    -- tirar parcelas do fim: o total do contrato diminui na mesma medida, então a numeração da próxima parcela não muda
    v_original := v_d.original_installments - (v_d.remaining_installments - p_remaining);
    v_remaining := p_remaining;
  else
    if p_installment is null or p_installment <= 0 or p_installment > v_d.installment_amount then
      raise exception 'a parcela nova deve ser maior que zero e não maior que a atual' using errcode = '22023';
    end if;
    if p_installment <> round(p_installment, 2) then
      raise exception 'valor com mais de 2 casas decimais' using errcode = '22003';
    end if;
    v_amount := p_installment;
  end if;

  -- a próxima parcela em aberto continua sendo a primeira da agenda refeita
  select min(s.due_date) into v_first
  from public.debt_payment_schedule s
  where s.debt_id = v_d.id and s.status = 'planned';
  if v_first is null then
    raise exception 'esta dívida não tem parcela planejada para ajustar' using errcode = '22023';
  end if;

  v_op := public.debt_record_payment(p_debt, p_date, p_account, p_principal, p_interest, p_fee, p_category, true);

  perform public.debt_contract_set(
    p_debt, v_d.creditor, v_d.contract_number, v_original, v_remaining, v_amount,
    v_d.payment_day, v_d.payment_method, v_d.payment_account_id, v_first
  );
  return v_op;
end $$;

revoke execute on function public.debt_extra_amortize(uuid, date, uuid, numeric, text, integer, numeric, numeric, numeric, uuid)
  from public, anon;
grant execute on function public.debt_extra_amortize(uuid, date, uuid, numeric, text, integer, numeric, numeric, numeric, uuid)
  to authenticated;
