-- 132: "Corrigir saldo pelo extrato" de empréstimo e financiamento (pedido do dono, 17/11/2026).
--
-- Problema: o saldo da dívida no app é o saldo informado no cadastro (reference_balance) mais/menos os movimentos. Os juros
-- que o banco soma dia a dia não entram (o app não calcula juros), então o número do banco e o do app se afastam. A âncora
-- é imutável de propósito (private.debts_immutable) e não havia como dizer "hoje o banco diz X". O único caminho era a
-- amortização extra sem conta, que só baixa o saldo e fica no histórico como amortização (não foi o que aconteceu).
--
-- Solução: dois tipos novos de movimento da dívida, sem conta, sem categoria, sem parcela e sem fatura:
--   'adjust_up'   aumenta o saldo (ex.: juros dos dias corridos);
--   'adjust_down' diminui o saldo.
-- E a RPC public.debt_set_balance(p_debt, p_date, p_balance): grava a diferença entre o saldo do app na data e o saldo
-- informado (só a diferença; nada quando já bate). Só empréstimo e financiamento (no cartão o saldo é a soma das faturas).
--
-- Decisão do dono (17/11/2026): o ajuste só corrige o saldo; NÃO é despesa nem receita. Por isso nenhum relatório muda:
--   * entra no saldo da dívida: private.debt_effect (usada por private.debt_balance) e public.debt_balances, que são as duas
--     fórmulas do saldo; daí vale para patrimônio, Início e o que mais lê o saldo da dívida;
--   * NÃO entra em conta nem em fluxo de caixa: account_balances, account_movements, cash_flow e o Calendário só olham
--     eventos com conta (account_id), e o ajuste não tem conta (a forma obriga);
--   * NÃO entra em despesa: expense_items e os relatórios de gasto listam os tipos que são gasto (juros, tarifa, principal
--     pago de empréstimo); os tipos novos não estão lá;
--   * anular: public.debt_void serve para qualquer evento (não olha estes tipos).
-- debt_chk (trigger) continua valendo: pagamento depois do ajuste não pode deixar o saldo negativo.
-- Teste: 124_debt_balance_adjust (falha sem esta migration).

-- 1. tipos e forma ------------------------------------------------------------
alter table public.debt_events drop constraint debt_events_kind_check;
alter table public.debt_events add constraint debt_events_kind_check
  check (kind = any (array['disbursement','charge','payment','extra_principal','interest','fee','credit','refund_cash',
                           'cancel','payroll_payment','income_credit','adjust_up','adjust_down']));

-- ajuste: nada de fatura nem de parcela do contrato (conta, categoria e parcela de cartão já ficam nulas pela debt_events_shape,
-- porque os tipos novos não estão em nenhuma das listas que as exigem)
alter table public.debt_events add constraint debt_events_adjust_shape check (
  kind not in ('adjust_up', 'adjust_down') or (account_id is null and invoice_id is null and schedule_id is null)
);

-- 2. as duas fórmulas do saldo (create or replace a partir da 048, só com os tipos novos) ----------------------
create or replace function private.debt_effect(p_kind text, p_amount numeric)
returns numeric language sql immutable set search_path = '' as $$
  select case when p_kind in ('disbursement','charge','refund_cash','adjust_up') then p_amount
              when p_kind in ('payment','extra_principal','credit','payroll_payment','income_credit','adjust_down') then -p_amount
              else 0 end
$$;

create or replace function public.debt_balances(p_household uuid, p_as_of date)
returns table(debt_id uuid, name text, kind text, balance numeric, debt numeric, credit_receivable numeric, planned_remaining numeric)
language sql stable security invoker set search_path = '' as $$
  select d.id, d.name, d.kind, b.bal, greatest(b.bal, 0), greatest(-b.bal, 0), coalesce(p.rem, 0)
  from public.debts d
  cross join lateral (
    select d.reference_balance + coalesce(sum(case
      when e.kind in ('disbursement','charge','refund_cash','adjust_up') then e.amount
      when e.kind in ('payment','extra_principal','credit','payroll_payment','income_credit','adjust_down') then -e.amount
      else 0 end), 0) as bal
    from public.debt_events e
    where e.household_id = d.household_id and e.debt_id = d.id
      and e.voided_at is null and e.date <= p_as_of
  ) b
  left join lateral (
    select sum(i.face - coalesce((
      select sum(e.amount) from public.debt_events e
      where e.household_id = i.household_id and e.installment_id = i.id
        and e.kind in ('charge','cancel') and e.voided_at is null and e.date <= p_as_of
    ), 0)) as rem
    from public.debt_installments i
    where i.household_id = d.household_id and i.debt_id = d.id
  ) p on true
  where d.household_id = p_household and d.reference_date <= p_as_of
    and (select private.is_member(p_household))
  order by d.name
$$;

-- 3. a ação -------------------------------------------------------------------
-- Devolve o id do ajuste, ou nulo quando o saldo do app na data já é o informado (nada a gravar).
create function public.debt_set_balance(p_debt uuid, p_date date, p_balance numeric)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_d public.debts%rowtype;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_atual numeric;
  v_dif numeric;
  v_id uuid;
begin
  v_d := private.debt_lock(p_debt);
  if v_d.kind not in ('loan', 'financing') then
    raise exception 'corrigir saldo só vale para empréstimo e financiamento' using errcode = '23514';
  end if;
  if p_date is null or p_date > v_hoje then
    raise exception 'escolha a data do extrato (hoje ou antes)' using errcode = '22023';
  end if;
  if p_date <= v_d.reference_date then
    raise exception 'a data precisa ser depois de % (data do saldo informado no cadastro)', to_char(v_d.reference_date, 'DD/MM/YYYY')
      using errcode = '22023';
  end if;
  if p_balance is null or p_balance < 0 or p_balance <> round(p_balance, 2) or p_balance >= 1e12 then
    raise exception 'saldo inválido' using errcode = '22023';
  end if;

  v_atual := private.debt_balance(p_debt, p_date);
  v_dif := p_balance - v_atual;
  if v_dif = 0 then
    return null;
  end if;

  insert into public.debt_events (household_id, debt_id, date, kind, amount, op_id, note)
  values (v_d.household_id, p_debt, p_date, case when v_dif > 0 then 'adjust_up' else 'adjust_down' end, abs(v_dif),
          gen_random_uuid(), 'ajuste pelo extrato: saldo informado ' || to_char(p_balance, 'FM999999999990.00'))
  returning id into v_id;
  return v_id;
end $$;

revoke execute on function public.debt_set_balance(uuid, date, numeric) from public, anon;
grant execute on function public.debt_set_balance(uuid, date, numeric) to authenticated;
