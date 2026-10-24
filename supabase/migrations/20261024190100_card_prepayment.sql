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
-- Muda a regra de pagamento em private.debt_chk (o restante da função é idêntico ao da migration 003) e faz
-- public.card_months descontar a devolução em dinheiro do crédito (senão a fatura apareceria paga sem estar).

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

-- Relatório das faturas: o crédito do adiantamento deixa de contar o que foi devolvido em dinheiro.
create or replace function public.card_months(p_debt uuid)
returns table (label text, closing_date date, due_date date, charged numeric, pending numeric,
               total numeric, paid numeric, items integer, invoice_id uuid,
               previous_open numeric, advance_in numeric, advance_out numeric)
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_d record; r record; v_credit numeric; v_prev numeric := 0; v_link numeric; v_total numeric;
  v_use numeric; v_surplus numeric; v_paid numeric; v_due date; v_b date;
begin
  select d.id, d.household_id, d.closing_day, d.due_day into v_d from public.debts d
   where d.id = p_debt and d.kind = 'card' and (select private.is_member(d.household_id));
  if not found then return; end if;

  -- pagamentos sem fatura: entram como adiantamento; a devolução em dinheiro (refund_cash) tira do crédito
  -- (migration 010: antes, devolver o adiantamento deixava a fatura aparecendo como paga sem estar)
  select greatest(0, coalesce(sum(case when e.kind = 'refund_cash' then -e.amount else e.amount end), 0)) into v_credit
    from public.debt_events e
   where e.household_id = v_d.household_id and e.debt_id = v_d.id and e.voided_at is null
     and e.kind in ('payment', 'extra_principal', 'refund_cash') and e.invoice_id is null;

  for r in
    with parc as (
      select i.id, i.due_date, i.face, i.closing_day, i.due_day,
             coalesce((select sum(case e.kind when 'charge' then e.amount when 'credit' then -e.amount else 0 end)
                         from public.debt_events e
                        where e.installment_id = i.id and e.voided_at is null and e.kind in ('charge', 'credit')), 0) as cobrado,
             i.face - coalesce((select sum(e.amount) from public.debt_events e
                                 where e.installment_id = i.id and e.voided_at is null
                                   and e.kind in ('charge', 'cancel')), 0) as resta,
             coalesce((select sum(e.amount) from public.debt_events e
                        where e.installment_id = i.id and e.voided_at is null and e.kind = 'cancel'), 0) as cancelado
        from public.debt_installments i
       where i.household_id = v_d.household_id and i.debt_id = v_d.id
    ), meses as (
      select to_char(p.due_date, 'YYYY-MM') as label, min(p.due_date) as closing_date,
             sum(p.cobrado) as charged, sum(p.resta) as pending, count(*)::int as items,
             max(p.closing_day) as cd, max(p.due_day) as dd
        from parc p where p.cancelado < p.face group by 1
    )
    select m.label, m.closing_date, m.charged, m.pending, m.items, m.cd, m.dd, inv.id as inv_id, inv.due_date as inv_due,
           coalesce((select sum(e.amount) from public.debt_events e
                      where e.invoice_id = inv.id and e.voided_at is null
                        and e.kind in ('payment', 'extra_principal')), 0) as pago_fatura
      from meses m
      left join public.debt_invoices inv
        on inv.household_id = v_d.household_id and inv.debt_id = v_d.id and inv.label = m.label
     order by m.label
  loop
    -- vencimento: o da fatura (se já existe) ou o calculado pelo ciclo da parcela (senão, o do cartão).
    -- mesma regra de private.card_due_date (migration 004): este relatório roda como o chamador, que não
    -- executa funções de private. Vence no mesmo mês se o dia de vencimento for depois do de fechamento,
    -- senão no mês seguinte; dia inexistente vira o último do mês.
    v_due := r.inv_due;
    if v_due is null and coalesce(r.cd, v_d.closing_day) is not null then
      v_b := (date_trunc('month', r.closing_date)
              + case when coalesce(r.dd, v_d.due_day) > coalesce(r.cd, v_d.closing_day)
                     then interval '0' else interval '1 month' end)::date;
      v_due := make_date(extract(year from v_b)::int, extract(month from v_b)::int,
                         least(coalesce(r.dd, v_d.due_day),
                               extract(day from (v_b + interval '1 month - 1 day'))::int));
    end if;

    v_total   := r.charged + r.pending;
    v_link    := r.pago_fatura;
    v_use     := least(v_credit, greatest(0, v_total - v_link));
    v_surplus := greatest(0, v_link - v_total);
    v_paid    := least(v_total, v_link) + v_use;

    label := r.label; closing_date := r.closing_date; due_date := v_due;
    charged := r.charged; pending := r.pending; total := v_total; paid := v_paid;
    items := r.items; invoice_id := r.inv_id;
    previous_open := v_prev; advance_in := v_credit;
    v_credit := v_credit - v_use + v_surplus;
    advance_out := v_credit;
    v_prev := v_prev + (v_total - v_paid);
    return next;
  end loop;
end $$;
