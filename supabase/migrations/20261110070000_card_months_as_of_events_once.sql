-- card_months_as_of: soma os eventos das parcelas uma vez (antes: três subconsultas por parcela) + índice por fatura.
--
-- Medido em 10/11/2026 (EXPLAIN ANALYZE em produção e perfil em banco local com dados sintéticos): num cartão com milhares de
-- parcelas, o custo da função era quase todo o das ~13.500 buscas por parcela (3 x parcelas), cada uma ainda passando pela
-- política de linha. A saída é a mesma (a conferência antigo x novo está em 92_card_months_as_of_eventos_agregados.test.sql);
-- só mudou a forma de somar. Corpo igual ao da 20261109050000, trocando apenas a CTE `parc`.
--
-- Também: o laço lia todos os eventos do cartão uma vez por fatura para somar os pagamentos (sem índice por invoice_id).

create or replace function private.card_months_as_of(p_debt uuid, p_as_of date)
returns table (label text, due_date date, charged numeric, pending numeric, total numeric, paid numeric, invoice_id uuid)
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_d record; r record; v_credit numeric; v_ref numeric; v_s0 numeric; v_link numeric; v_total numeric;
  v_use numeric; v_surplus numeric; v_paid numeric; v_due date; v_b date; v_first boolean := true;
begin
  if p_as_of is null then raise exception 'data de corte obrigatória' using errcode = '22023'; end if;
  select d.id, d.household_id, d.closing_day, d.due_day, greatest(0, d.reference_balance) as reference_balance into v_d from public.debts d
   where d.id = p_debt and d.kind = 'card' and (select private.is_member(d.household_id));
  if not found then return; end if;

  -- pagamentos sem fatura: entram como adiantamento. A devolução em dinheiro (refund_cash) tira do adiantamento NA ORDEM
  -- DAS DATAS (correção da 052): a de antes do primeiro fechamento sai daqui; as outras saem no loop, depois da sobra
  -- da fatura cujo fechamento a antecede. Antes ela era descontada no começo, só do que existia sem fatura: a sobra de
  -- uma fatura (pagamento ou crédito avulso acima dela) já devolvida reaparecia como adiantamento.
  select coalesce(sum(e.amount), 0) into v_credit
    from public.debt_events e
   where e.household_id = v_d.household_id and e.debt_id = v_d.id and e.voided_at is null
     and e.kind in ('payment', 'extra_principal') and e.invoice_id is null and e.date <= p_as_of;
  v_ref := v_d.reference_balance;
  v_s0 := least(v_credit, v_ref);
  v_ref := v_ref - v_s0;
  v_credit := v_credit - v_s0;

  for r in
    with ev as (
      -- Eventos das parcelas, somados UMA vez por parcela (antes eram três subconsultas por parcela: com milhares de
      -- parcelas, dezenas de milhares de buscas por chamada). A chave estrangeira (household_id, installment_id, debt_id)
      -- garante que os eventos de uma parcela são do mesmo cartão e da mesma família, então filtrar por eles não perde nada.
      select e.installment_id,
             coalesce(sum(case e.kind when 'charge' then e.amount when 'credit' then -e.amount end), 0) as cobrado,
             coalesce(sum(e.amount) filter (where e.kind in ('charge', 'cancel')), 0) as cobrado_e_cancelado,
             coalesce(sum(e.amount) filter (where e.kind = 'cancel'), 0) as cancelado
        from public.debt_events e
       where e.household_id = v_d.household_id and e.debt_id = v_d.id and e.installment_id is not null
         and e.voided_at is null and e.kind in ('charge', 'credit', 'cancel') and e.date <= p_as_of
       group by e.installment_id
    ), parc as (
      select i.id, i.due_date, i.face, i.closing_day, i.due_day,
             coalesce(ev.cobrado, 0) as cobrado,
             i.face - coalesce(ev.cobrado_e_cancelado, 0) as resta,
             coalesce(ev.cancelado, 0) as cancelado
        from public.debt_installments i
        left join ev on ev.installment_id = i.id
       where i.household_id = v_d.household_id and i.debt_id = v_d.id
    ), meses_parc as (
      select to_char(p.due_date, 'YYYY-MM') as label, min(p.due_date) as closing_date,
             sum(p.cobrado) as charged, sum(p.resta) as pending, count(*)::int as items,
             max(p.closing_day) as cd, max(p.due_day) as dd
        from parc p where p.cancelado < p.face group by 1
    ), cred as (
      -- income_credit.date identifica a fatura escolhida; credit_date registra quando o crédito foi efetivamente concedido.
      -- Assim, crédito já recebido reduz a fatura futura sem antecipar crédito que ainda não ocorreu.
      select to_char(e.date, 'YYYY-MM') as label, min(e.date) as closing_date, sum(e.amount) as credits
        from public.debt_events e
       where e.household_id = v_d.household_id and e.debt_id = v_d.id and e.voided_at is null
         and e.kind = 'income_credit' and coalesce(e.credit_date, e.date) <= p_as_of
       group by 1
    ), meses as (
      select coalesce(m.label, c.label) as label, coalesce(m.closing_date, c.closing_date) as closing_date,
             coalesce(m.charged, 0) - coalesce(c.credits, 0) as charged, coalesce(m.pending, 0) as pending,
             coalesce(m.items, 0) as items, m.cd, m.dd, coalesce(c.credits, 0) as credits
        from meses_parc m full join cred c on c.label = m.label
    )
    select m.label, m.closing_date, m.charged, m.pending, m.items, m.cd, m.dd, m.credits, inv.id as inv_id, inv.due_date as inv_due,
           lead(m.closing_date) over (order by m.label) as next_closing,
           coalesce((select sum(e.amount) from public.debt_events e
                      where e.invoice_id = inv.id and e.voided_at is null
                        and e.kind in ('payment', 'extra_principal') and e.date <= p_as_of), 0) as pago_fatura
      from meses m
      left join public.debt_invoices inv
        on inv.household_id = v_d.household_id and inv.debt_id = v_d.id and inv.label = m.label
     order by m.label
  loop
    -- vencimento: o da fatura (se já existe) ou o calculado pelo ciclo da parcela (senão, o do cartão); mesma regra de
    -- private.card_due_date (migration 004), escrita aqui porque este relatório roda como o chamador
    v_due := r.inv_due;
    if v_due is null and coalesce(r.cd, v_d.closing_day) is not null then
      v_b := (date_trunc('month', r.closing_date)
              + case when coalesce(r.dd, v_d.due_day) > coalesce(r.cd, v_d.closing_day)
                     then interval '0' else interval '1 month' end)::date;
      v_due := make_date(extract(year from v_b)::int, extract(month from v_b)::int,
                         least(coalesce(r.dd, v_d.due_day),
                               extract(day from (v_b + interval '1 month - 1 day'))::int));
    end if;

    -- devoluções de antes do primeiro fechamento: saem do adiantamento sem fatura
    if v_first then
      v_credit := greatest(0, v_credit - coalesce((
        select sum(e.amount) from public.debt_events e
         where e.household_id = v_d.household_id and e.debt_id = v_d.id and e.voided_at is null
           and e.kind = 'refund_cash' and e.date < r.closing_date and e.date <= p_as_of), 0));
      v_first := false;
    end if;

    v_total   := greatest(0, r.charged + r.pending);
    v_link    := r.pago_fatura;
    v_use     := least(v_credit, greatest(0, v_total - v_link));
    -- excedente: pagamento acima da fatura + crédito avulso acima da fatura (migration 052)
    v_surplus := greatest(0, v_link - v_total) + greatest(0, -(r.charged + r.pending));
    v_paid    := least(v_total, v_link) + v_use;

    label := r.label; due_date := v_due; invoice_id := r.inv_id;
    charged := r.charged; pending := r.pending; total := v_total; paid := v_paid;
    
    v_s0 := least(v_surplus, v_ref);
    v_ref := v_ref - v_s0;
    v_credit := v_credit - v_use + (v_surplus - v_s0);
    -- devoluções feitas depois deste fechamento (inclusive) e antes do próximo: levam o crédito que existia então
    -- (inclui a sobra desta fatura); greatest(0, …) só protege a tela, debt_chk já garante a ordem
    v_credit := v_credit - coalesce((
      select sum(e.amount) from public.debt_events e
       where e.household_id = v_d.household_id and e.debt_id = v_d.id and e.voided_at is null
         and e.kind = 'refund_cash' and e.date >= r.closing_date and e.date <= p_as_of
         and (r.next_closing is null or e.date < r.next_closing)), 0);
    if v_credit < 0 then v_credit := 0; end if;
    return next;
  end loop;
end $$;

create index if not exists debt_events_invoice_idx on public.debt_events (invoice_id)
  where invoice_id is not null and voided_at is null;

revoke execute on function private.card_months_as_of(uuid, date) from public, anon;
grant execute on function private.card_months_as_of(uuid, date) to authenticated;
