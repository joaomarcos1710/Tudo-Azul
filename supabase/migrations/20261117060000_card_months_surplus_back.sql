-- Tudo Azul — migration 136: a sobra de uma fatura quita primeiro o que ficou em aberto nas faturas ANTERIORES (PR B).
--
-- Bug de valor (achado do revisor-dinheiro na #409, reproduzido): o cartão tinha setembro 150,00 sem pagar e outubro
-- 300,00; a família pagou 450,00 vinculado à fatura de outubro (o "total a pagar" com o saldo anterior). card_months
-- mandava os 150,00 que sobraram em outubro só para as faturas SEGUINTES (adiantamento): setembro continuava com 150,00 em
-- aberto ("vencida") com a dívida zerada, e a fatura seguinte aparecia 150,00 menor. O número errado aparecia na faixa
-- de pendências (134/135), nos avisos do Início (home_alerts), no Calendário, no saldo previsto e em Cartões; e, pela
-- private.card_months_as_of (a mesma conta numa data), no Dinheiro Livre e nas tabelas de parcelas e compromissos.
--
-- Correção, no código comum: public.card_months e private.card_months_as_of (create or replace; mesmas assinaturas,
-- colunas e grants; 00_audit não muda). Corpos em vigor: 20261111130000_card_payment_move.sql (110), com só esta mudança,
-- marcada "migration 136": as linhas ficam guardadas até o fim do laço; a sobra (pagamento ou crédito avulso acima da
-- fatura) quita primeiro o saldo de referência (como antes), depois o que está em aberto nas faturas anteriores, da mais
-- antiga para a mais nova, e só o resto vira adiantamento. O "saldo anterior" (previous_open) mantém o significado de
-- antes: o que estava em aberto antes dos pagamentos daquela fatura.
-- Não muda: o saldo da dívida (debt_balances não lê card_months), o pagamento sem fatura (já seguia a ordem certa) e o
-- caso sem sobra. Efeito visível: a fatura anterior passa a "paga" (e travada, como toda fatura paga, 064); o adiantamento
-- e o "saldo anterior" das seguintes caem pelo valor quitado.
-- Teste: 128_card_months_surplus (falha sem esta migration); 12, 52, 104, P3/P5 do 127 e a cópia de referência do 92
-- atualizados (o 92 confere a otimização de 10/11, não a regra da sobra).

CREATE OR REPLACE FUNCTION public.card_months(p_debt uuid)
 RETURNS TABLE(label text, closing_date date, due_date date, charged numeric, pending numeric, total numeric, paid numeric, items integer, invoice_id uuid, previous_open numeric, advance_in numeric, advance_out numeric, credits numeric)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_d record; r record; v_credit numeric; v_prev numeric := 0; v_ref numeric; v_s0 numeric; v_link numeric; v_total numeric;
  v_use numeric; v_surplus numeric; v_paid numeric; v_due date; v_b date; v_first boolean := true;
  -- migration 136: linhas guardadas até o fim; a sobra de uma fatura pode quitar o que ficou em aberto nas ANTERIORES
  a_label text[] := '{}'; a_closing date[] := '{}'; a_due date[] := '{}'; a_charged numeric[] := '{}'; a_pending numeric[] := '{}';
  a_total numeric[] := '{}'; a_paid numeric[] := '{}'; a_items integer[] := '{}'; a_inv uuid[] := '{}'; a_prev numeric[] := '{}';
  a_adv_in numeric[] := '{}'; a_adv_out numeric[] := '{}'; a_credits numeric[] := '{}';
  n integer := 0; k integer; v_take numeric;
begin
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
     and e.kind in ('payment', 'extra_principal') and e.invoice_id is null;
  v_ref := v_d.reference_balance;
  v_s0 := least(v_credit, v_ref);
  v_ref := v_ref - v_s0;
  v_credit := v_credit - v_s0;

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
    ), meses_parc as (
      select to_char(p.due_date, 'YYYY-MM') as label, min(p.due_date) as closing_date,
             sum(p.cobrado) as charged, sum(p.resta) as pending, count(*)::int as items,
             max(p.closing_day) as cd, max(p.due_day) as dd
        from parc p where p.cancelado < p.face group by 1
    ), cred as (
      select to_char(e.date, 'YYYY-MM') as label, min(e.date) as closing_date, sum(e.amount) as credits
        from public.debt_events e
       where e.household_id = v_d.household_id and e.debt_id = v_d.id and e.voided_at is null
         and e.kind = 'income_credit'
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
                        and e.kind in ('payment', 'extra_principal')), 0) as pago_fatura,
           -- migration 110: pagamentos ligados a uma fatura cujo mês deixou de existir (perdeu as parcelas e os créditos)
           coalesce((select sum(e.amount) from public.debt_events e
                      join public.debt_invoices io on io.id = e.invoice_id
                     where e.household_id = v_d.household_id and e.debt_id = v_d.id and e.voided_at is null
                       and e.kind in ('payment', 'extra_principal')
                       and io.label not in (select mm.label from meses mm)), 0) as pago_orfao
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
      -- migration 110: o pagamento de uma fatura que deixou de existir conta como adiantamento, como o pagamento sem
      -- fatura (antes não contava em lugar nenhum e as faturas mostravam esse valor a mais). Mesma ordem do adiantamento:
      -- primeiro cobre o saldo de referência, depois as devoluções de antes do primeiro fechamento saem dele.
      v_s0 := least(r.pago_orfao, v_ref);
      v_ref := v_ref - v_s0;
      v_credit := v_credit + r.pago_orfao - v_s0;
      v_credit := greatest(0, v_credit - coalesce((
        select sum(e.amount) from public.debt_events e
         where e.household_id = v_d.household_id and e.debt_id = v_d.id and e.voided_at is null
           and e.kind = 'refund_cash' and e.date < r.closing_date), 0));
      v_first := false;
    end if;

    v_total   := greatest(0, r.charged + r.pending);
    v_link    := r.pago_fatura;
    v_use     := least(v_credit, greatest(0, v_total - v_link));
    -- excedente: pagamento acima da fatura + crédito avulso acima da fatura (migration 052)
    v_surplus := greatest(0, v_link - v_total) + greatest(0, -(r.charged + r.pending));
    v_paid    := least(v_total, v_link) + v_use;

    n := n + 1;
    a_label[n] := r.label; a_closing[n] := r.closing_date; a_due[n] := v_due;
    a_charged[n] := r.charged; a_pending[n] := r.pending; a_total[n] := v_total; a_paid[n] := v_paid;
    a_items[n] := r.items; a_inv[n] := r.inv_id; a_credits[n] := r.credits;
    a_prev[n] := v_prev + v_ref; a_adv_in[n] := v_credit;
    -- migration 136: a sobra quita primeiro o saldo de referência (a dívida mais antiga, como antes), depois o que ficou
    -- em aberto nas faturas anteriores, da mais antiga para a mais nova, e só o resto vira adiantamento das próximas.
    -- O "saldo anterior" desta fatura continua sendo o que estava em aberto ANTES dos pagamentos dela (regra da tela,
    -- teste 21 B1.1); quem passa a "paga" é a fatura anterior.
    v_s0 := least(v_surplus, v_ref);
    v_ref := v_ref - v_s0;
    v_surplus := v_surplus - v_s0;
    k := 1;
    while v_surplus > 0 and k < n loop
      v_take := least(v_surplus, greatest(0, a_total[k] - a_paid[k]));
      if v_take > 0 then
        a_paid[k] := a_paid[k] + v_take;
        v_prev := v_prev - v_take;
        v_surplus := v_surplus - v_take;
      end if;
      k := k + 1;
    end loop;
    v_credit := v_credit - v_use + v_surplus;
    -- devoluções feitas depois deste fechamento (inclusive) e antes do próximo: levam o crédito que existia então
    -- (inclui a sobra desta fatura); greatest(0, …) só protege a tela, debt_chk já garante a ordem
    v_credit := v_credit - coalesce((
      select sum(e.amount) from public.debt_events e
       where e.household_id = v_d.household_id and e.debt_id = v_d.id and e.voided_at is null
         and e.kind = 'refund_cash' and e.date >= r.closing_date
         and (r.next_closing is null or e.date < r.next_closing)), 0);
    if v_credit < 0 then v_credit := 0; end if;
    a_adv_out[n] := v_credit;
    v_prev := v_prev + (v_total - v_paid);
  end loop;

  for k in 1 .. n loop
    label := a_label[k]; closing_date := a_closing[k]; due_date := a_due[k];
    charged := a_charged[k]; pending := a_pending[k]; total := a_total[k]; paid := a_paid[k];
    items := a_items[k]; invoice_id := a_inv[k]; credits := a_credits[k];
    previous_open := a_prev[k]; advance_in := a_adv_in[k]; advance_out := a_adv_out[k];
    return next;
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION private.card_months_as_of(p_debt uuid, p_as_of date)
 RETURNS TABLE(label text, due_date date, charged numeric, pending numeric, total numeric, paid numeric, invoice_id uuid)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_d record; r record; v_credit numeric; v_ref numeric; v_s0 numeric; v_link numeric; v_total numeric;
  v_use numeric; v_surplus numeric; v_paid numeric; v_due date; v_b date; v_first boolean := true;
  -- migration 136: linhas guardadas até o fim; a sobra de uma fatura pode quitar o que ficou em aberto nas ANTERIORES
  a_label text[] := '{}'; a_due date[] := '{}'; a_charged numeric[] := '{}'; a_pending numeric[] := '{}';
  a_total numeric[] := '{}'; a_paid numeric[] := '{}'; a_inv uuid[] := '{}';
  n integer := 0; k integer; v_take numeric;
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
                        and e.kind in ('payment', 'extra_principal') and e.date <= p_as_of), 0) as pago_fatura,
           -- migration 110: pagamentos ligados a uma fatura cujo mês deixou de existir (perdeu as parcelas e os créditos)
           coalesce((select sum(e.amount) from public.debt_events e
                      join public.debt_invoices io on io.id = e.invoice_id
                     where e.household_id = v_d.household_id and e.debt_id = v_d.id and e.voided_at is null
                       and e.kind in ('payment', 'extra_principal') and e.date <= p_as_of
                       and io.label not in (select mm.label from meses mm)), 0) as pago_orfao
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
      -- migration 110: o pagamento de uma fatura que deixou de existir conta como adiantamento, como o pagamento sem
      -- fatura (antes não contava em lugar nenhum e as faturas mostravam esse valor a mais). Mesma ordem do adiantamento:
      -- primeiro cobre o saldo de referência, depois as devoluções de antes do primeiro fechamento saem dele.
      v_s0 := least(r.pago_orfao, v_ref);
      v_ref := v_ref - v_s0;
      v_credit := v_credit + r.pago_orfao - v_s0;
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

    n := n + 1;
    a_label[n] := r.label; a_due[n] := v_due; a_inv[n] := r.inv_id;
    a_charged[n] := r.charged; a_pending[n] := r.pending; a_total[n] := v_total; a_paid[n] := v_paid;
    -- migration 136: mesma ordem de public.card_months (referência, faturas anteriores da mais antiga, adiantamento)
    v_s0 := least(v_surplus, v_ref);
    v_ref := v_ref - v_s0;
    v_surplus := v_surplus - v_s0;
    k := 1;
    while v_surplus > 0 and k < n loop
      v_take := least(v_surplus, greatest(0, a_total[k] - a_paid[k]));
      if v_take > 0 then
        a_paid[k] := a_paid[k] + v_take;
        v_surplus := v_surplus - v_take;
      end if;
      k := k + 1;
    end loop;
    v_credit := v_credit - v_use + v_surplus;
    -- devoluções feitas depois deste fechamento (inclusive) e antes do próximo: levam o crédito que existia então
    -- (inclui a sobra desta fatura); greatest(0, …) só protege a tela, debt_chk já garante a ordem
    v_credit := v_credit - coalesce((
      select sum(e.amount) from public.debt_events e
       where e.household_id = v_d.household_id and e.debt_id = v_d.id and e.voided_at is null
         and e.kind = 'refund_cash' and e.date >= r.closing_date and e.date <= p_as_of
         and (r.next_closing is null or e.date < r.next_closing)), 0);
    if v_credit < 0 then v_credit := 0; end if;
  end loop;

  for k in 1 .. n loop
    label := a_label[k]; due_date := a_due[k]; invoice_id := a_inv[k];
    charged := a_charged[k]; pending := a_pending[k]; total := a_total[k]; paid := a_paid[k];
    return next;
  end loop;
end $function$;
