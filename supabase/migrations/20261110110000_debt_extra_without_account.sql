-- Tudo Azul — migration 102: amortização extra de empréstimo/financiamento sem conta (ex.: FGTS)
--
-- Pedido do dono (10/11/2026): o financiamento imobiliário recebe amortizações extraordinárias pagas com FGTS, dinheiro
-- que não está em nenhuma conta do app. Até aqui public.debt_record_payment (029, 20261031160100_debt_module.sql) exigia
-- p_account e a tabela também: debt_events_shape (002, refeita na 048, 20261104210100_card_credit_income.sql) obriga
-- conta em 'disbursement', 'payment', 'extra_principal', 'interest', 'fee' e 'refund_cash'.
--
-- O que muda:
--   1. debt_events_shape: 'extra_principal' passa a aceitar account_id nulo. Sem conta, o evento não pode ter fatura
--      (invoice_id) nem parcela do contrato (schedule_id): é só a amortização avulsa. Todo o resto da forma é o da 048.
--   2. public.debt_record_payment: mesma assinatura, mesma segurança (SECURITY DEFINER, search_path vazio) e mesmos
--      grants. p_account pode ser nulo SÓ quando p_extra = true, p_interest = 0, p_fee = 0 e a dívida é empréstimo ou
--      financiamento; aí grava um único evento 'extra_principal' sem conta, nota "amortização extra sem conta (ex.: FGTS)".
--      Conta nula em qualquer outro caso: 22023 com mensagem clara. Com conta, o comportamento é idêntico ao da 029.
--      Cartão fica de fora de propósito: no cartão o 'extra_principal' é caixa (cash_flow_series conta todo pagamento de
--      cartão como saída quando não há filtro de contas) e entra no "pago" da fatura; sem conta, viraria saída fantasma.
--
-- Por que nenhum relatório precisa mudar (conferido nas definições vigentes; teste 96 cobre os números):
--   * saldo da dívida: debt_balances / private.debt_balance usam o tipo, não a conta → cai pelo valor;
--   * contas: account_balances (100) e account_movements casam e.account_id = a.id → evento sem conta não mexe em conta;
--     account_balances_projected e account_flow_report partem de account_balances;
--   * despesa: principal de empréstimo/financiamento entra por private.loan_principal_items (046), que já exige
--     e.account_id is not null → period_summary, cash_flow_report, cash_flow_series, budget_usage e expense_items não o
--     contam (o FGTS não saiu do bolso da família no mês); juros/tarifa/compra de cartão não são deste tipo;
--   * fluxo de caixa de cartão (cash_flow_series) só lê dívida 'card', que aqui continua exigindo conta;
--   * private.debt_chk ignora a data de abertura quando não há conta (o join não casa) e mantém a regra de não
--     amortizar acima do saldo devedor; debt_void anula o evento como qualquer outro.
-- Teste: 96_debt_extra_without_account (falha sem esta migration).

alter table public.debt_events drop constraint debt_events_shape;
alter table public.debt_events add constraint debt_events_shape check (
      (kind = 'extra_principal'
         or ((kind in ('disbursement', 'payment', 'interest', 'fee', 'refund_cash')) = (account_id is not null)))
  and (kind <> 'extra_principal' or account_id is not null or (invoice_id is null and schedule_id is null))
  and ((kind in ('charge', 'credit', 'cancel')) = (installment_id is not null))
  and ((kind in ('interest', 'fee', 'income_credit')) = (category_id is not null))
);

create or replace function public.debt_record_payment(
  p_debt uuid,
  p_date date,
  p_account uuid,
  p_principal numeric,
  p_interest numeric default 0,
  p_fee numeric default 0,
  p_category uuid default null,
  p_extra boolean default false
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_d public.debts%rowtype;
  v_op uuid := gen_random_uuid();
  v_sem_conta boolean;
begin
  v_d := private.debt_lock(p_debt);

  if p_date is null or p_principal is null or p_interest is null or p_fee is null
     or p_principal < 0 or p_interest < 0 or p_fee < 0
     or coalesce(p_principal, 0) + coalesce(p_interest, 0) + coalesce(p_fee, 0) <= 0 then
    raise exception 'valores e data do pagamento inválidos' using errcode = '22023';
  end if;
  if p_principal <> round(p_principal, 2)
     or p_interest <> round(p_interest, 2)
     or p_fee <> round(p_fee, 2) then
    raise exception 'valor com mais de 2 casas decimais' using errcode = '22003';
  end if;

  -- (102) sem conta: só amortização extra pura de empréstimo/financiamento (ex.: FGTS)
  v_sem_conta := p_account is null;
  if v_sem_conta then
    if not coalesce(p_extra, false) or p_interest <> 0 or p_fee <> 0 then
      raise exception 'selecione a conta do pagamento (sem conta, só amortização extra sem juros nem tarifa, ex.: FGTS)'
        using errcode = '22023';
    end if;
    if v_d.kind not in ('loan', 'financing') then
      raise exception 'amortização sem conta só em empréstimo ou financiamento' using errcode = '22023';
    end if;
  end if;

  if (p_interest > 0 or p_fee > 0) and p_category is null then
    raise exception 'juros e tarifas exigem uma categoria de despesa' using errcode = '22023';
  end if;
  if not v_sem_conta and not exists (
    select 1 from public.accounts a
     where a.household_id = v_d.household_id and a.id = p_account
       and a.active and a.opening_date <= p_date
  ) then
    raise exception 'conta de pagamento inexistente, arquivada ou ainda não aberta' using errcode = '23514';
  end if;
  if p_category is not null and not exists (
    select 1 from public.categories c
     where c.household_id = v_d.household_id and c.id = p_category
       and c.type = 'expense' and c.active
  ) then
    raise exception 'categoria de despesa inválida ou inativa' using errcode = '23514';
  end if;

  if p_principal > 0 then
    insert into public.debt_events
      (household_id, debt_id, date, kind, amount, account_id, op_id, note)
    values
      (v_d.household_id, v_d.id, p_date,
       case when coalesce(p_extra, false) then 'extra_principal' else 'payment' end,
       p_principal, p_account, v_op,
       case when v_sem_conta then 'amortização extra sem conta (ex.: FGTS)'
            else 'pagamento registrado no módulo de dívidas' end);
  end if;

  if p_interest > 0 then
    insert into public.debt_events
      (household_id, debt_id, date, kind, amount, account_id, category_id, op_id, note)
    values (v_d.household_id, v_d.id, p_date, 'interest', p_interest, p_account, p_category, v_op, 'juros do pagamento');
  end if;

  if p_fee > 0 then
    insert into public.debt_events
      (household_id, debt_id, date, kind, amount, account_id, category_id, op_id, note)
    values (v_d.household_id, v_d.id, p_date, 'fee', p_fee, p_account, p_category, v_op, 'tarifa do pagamento');
  end if;

  perform private.debt_chk(v_d.id);
  return v_op;
end $$;

revoke execute on function public.debt_record_payment(uuid, date, uuid, numeric, numeric, numeric, uuid, boolean)
  from public, anon;
grant execute on function public.debt_record_payment(uuid, date, uuid, numeric, numeric, numeric, uuid, boolean)
  to authenticated;
