-- Tudo Azul — migration 010: pagamento adiantado de fatura vira crédito no cartão
--
-- Decisão do dono (24/10/2026): "o app libera o pagamento adiantado como crédito no cartão".
-- Antes, o banco recusava pagamento de cartão acima da dívida ("pagamento acima do saldo devedor"), então
-- era impossível pagar antes do fechamento. Agora, em CARTÃO, o pagamento pode passar da dívida:
--   * o dinheiro sai da conta na data do pagamento (saldo da conta);
--   * o excedente aparece como "crédito a receber" do cartão (debt_balances.credit_receivable) e entra no
--     patrimônio como crédito: o patrimônio não muda (a conta cai, o crédito sobe);
--   * não é despesa: as compras continuam contando no mês de cada fatura;
--   * as faturas seguintes consomem o crédito sozinhas (card_months já mostra "adiantamento").
-- Empréstimo, financiamento e amortização extra continuam sem poder passar do saldo devedor.
-- Só muda a regra de private.debt_chk; o restante da função é idêntico ao da migration 003.

create or replace function private.debt_chk(p_debt uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_d public.debts%rowtype;
  r record;
begin
  select * into v_d from public.debts where id = p_debt;
  if not found then return; end if; -- dívida apagada (exclusão da família)

  if exists (select 1 from public.debt_events e
              where e.debt_id = p_debt and e.voided_at is null and e.date <= v_d.reference_date) then
    raise exception 'evento anterior ou igual à data de referência da dívida (%)', v_d.reference_date
      using errcode = '23514';
  end if;
  if exists (select 1 from public.debt_events e
               join public.accounts a on a.household_id = e.household_id and a.id = e.account_id
              where e.debt_id = p_debt and e.voided_at is null and e.date < a.opening_date) then
    raise exception 'evento anterior à abertura da conta' using errcode = '23514';
  end if;

  for r in select distinct e.date, e.kind from public.debt_events e
            where e.debt_id = p_debt and e.voided_at is null
              and e.kind in ('payment', 'extra_principal', 'refund_cash') loop
    -- CARTÃO: o pagamento pode passar da dívida; o excedente vira crédito no cartão e abate as próximas faturas
    -- (decisão do dono, 24/10/2026). Empréstimo, financiamento e amortização extra continuam sem poder passar.
    if r.kind <> 'refund_cash' and not (r.kind = 'payment' and v_d.kind = 'card')
       and private.debt_balance(p_debt, r.date) < 0 then
      raise exception 'pagamento acima do saldo devedor (use a antecipação para parcelas futuras)'
        using errcode = '23514';
    end if;
    if r.kind = 'refund_cash' and private.debt_balance(p_debt, r.date) > 0 then
      raise exception 'devolução acima do crédito a receber' using errcode = '23514';
    end if;
  end loop;

  if exists (
    select 1 from public.debt_installments i
     where i.debt_id = p_debt
       and (select coalesce(sum(e.amount), 0) from public.debt_events e
             where e.installment_id = i.id and e.kind in ('charge', 'cancel') and e.voided_at is null) > i.face
  ) then
    raise exception 'cobrança ou cancelamento acima do valor da parcela' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.debt_installments i
     where i.debt_id = p_debt
       and (select coalesce(sum(e.amount), 0) from public.debt_events e
             where e.installment_id = i.id and e.kind = 'credit' and e.voided_at is null)
         > (select coalesce(sum(e.amount), 0) from public.debt_events e
             where e.installment_id = i.id and e.kind = 'charge' and e.voided_at is null)
  ) then
    raise exception 'estorno acima do valor cobrado' using errcode = '23514';
  end if;
end $$;
