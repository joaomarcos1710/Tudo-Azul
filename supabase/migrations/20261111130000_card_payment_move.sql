-- Tudo Azul — migration 110: mudar a fatura de um pagamento de cartão
--
-- Pedido do dono (11/11/2026): "um pagamento que caiu na fatura mas deveria ser na seguinte"; poder trocar a fatura do
-- pagamento em vez de anular e lançar de novo. Decisões do dono (11/11/2026, ver 30 - Decisões):
--   • mover, não reabrir: o pagamento continua o mesmo registro (data, valor, conta e o lançamento na conta não mudam);
--     muda só a fatura que ele quita. O extrato do banco continua batendo.
--   • fatura paga continua travada: se a fatura de origem ou a de destino estiver fechada e paga, a mudança é recusada.
--     É a mesma trava da migration 064 (card_paid_lock_check), sem exceção nova.
--
-- O que entra:
--   1. private.debt_events_guard (recriado a partir do corpo da migration 077, 20261106150100): o evento de dívida
--      continua imutável; a única mudança nova permitida é a fatura (invoice_id) de um pagamento (payment ou
--      extra_principal), e só com a marca de sessão app.card_payment_move = 'on', que só a função abaixo liga e
--      desliga (o app não tem UPDATE em debt_events nem chama set_config). Todo o resto do corpo é o da 077.
--   2. public.card_payment_move(p_event uuid, p_label text) returns uuid (a fatura de destino):
--      • p_event: pagamento do cartão (payment ou extra_principal), não anulado. Pode estar sem fatura (adiantamento).
--      • p_label: a fatura de destino, 'AAAA-MM', que tem de existir em card_months (fatura com parcela ou crédito):
--        aberta, futura ou fechada a pagar. Fatura igual à atual é recusada.
--      • cria a linha de public.debt_invoices do destino se ainda não existir, com o vencimento que card_months mostra.
--        O fechamento automático (card_bill_due) usa on conflict do nothing e continua igual.
--      • recusa (55000) se a fatura de origem ou a de destino estiver fechada e paga, mesmo quando os números dela
--        não mudariam: um pagamento a mais numa fatura quitada não muda o "pago" dela (a sobra vira crédito da
--        seguinte), e por isso card_paid_lock_check, que compara números, sozinho deixaria passar.
--      • confere a integridade (debt_chk) e a trava de fatura paga (card_paid_lock_check, sem exceção).
--      • conta conciliada não impede: a data e a conta do pagamento não mudam, e debt_events_period_guard só reage à
--        anulação.
--   3. public.card_months e private.card_months_as_of: o pagamento ligado a uma fatura cujo mês deixou de existir (perdeu
--      as parcelas e os créditos, ex.: compra excluída depois de o pagamento ir para ela) passa a contar como
--      adiantamento, como o pagamento sem fatura. Antes não contava em lugar nenhum. Sem pagamento assim, nada muda.
--
-- Códigos de erro: 42501 não autenticado ou pagamento de outra família/inexistente; 22023 não é pagamento de cartão
-- ativo, faz parte de uma operação com outros lançamentos (antecipação), fatura de destino inválida, inexistente ou
-- igual à atual; 55000 fatura paga (trava); 23514 integridade.
-- Teste: 104_card_payment_move (falha sem esta migration).

-- ---------------------------------------------------------------------------
-- 1. Guard: a fatura de um pagamento muda só pela RPC card_payment_move (marca de sessão)
-- ---------------------------------------------------------------------------
create or replace function private.debt_events_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.amount is not null then
      if new.amount <> round(new.amount,2) then
        raise exception 'valor com mais de 2 casas decimais: %',new.amount using errcode = '22003';
      end if;
      new.amount := round(new.amount,2);
    end if;
    if new.account_id is not null and exists (
      select 1 from public.accounts a
      where a.household_id=new.household_id and a.id=new.account_id and not a.active
    ) then
      raise exception 'conta desativada' using errcode = '23514';
    end if;
    perform private.account_brl_only(new.household_id, new.account_id);
    return new;
  end if;
  if old.voided_at is not null then
    raise exception 'evento já anulado não pode ser alterado' using errcode = '55000';
  end if;
  -- tudo, menos a fatura, continua imutável (a fatura tem a regra própria logo abaixo)
  if (new.id,new.household_id,new.debt_id,new.date,new.kind,new.amount,new.account_id,new.installment_id,
      new.op_id,new.note,new.created_by,new.created_at,new.schedule_id,
      new.category_type,new.credit_date)
     is distinct from
     (old.id,old.household_id,old.debt_id,old.date,old.kind,old.amount,old.account_id,old.installment_id,
      old.op_id,old.note,old.created_by,old.created_at,old.schedule_id,
      old.category_type,old.credit_date) then
    raise exception 'evento é imutável: use a anulação' using errcode = '42501';
  end if;
  -- migration 110: a fatura de um pagamento muda só pela RPC card_payment_move (marca de sessão)
  if new.invoice_id is distinct from old.invoice_id
     and not (old.kind in ('payment', 'extra_principal')
              and coalesce(current_setting('app.card_payment_move', true), '') = 'on') then
    raise exception 'evento é imutável: use a anulação' using errcode = '42501';
  end if;
  -- migration 077: a categoria do crédito avulso muda só pela RPC card_credit_set_category (marca de sessão)
  if new.category_id is distinct from old.category_id
     and not (old.kind = 'income_credit' and coalesce(current_setting('app.card_credit_category', true), '') = 'on') then
    raise exception 'evento é imutável: use a anulação' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke execute on function private.debt_events_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. RPC
-- ---------------------------------------------------------------------------
create function public.card_payment_move(p_event uuid, p_label text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_e public.debt_events%rowtype;
  v_d public.debts%rowtype;
  v_label text := btrim(p_label);
  v_due date;
  v_inv uuid;
  v_lock jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'não autenticado' using errcode = '42501';
  end if;
  select * into v_e from public.debt_events where id = p_event;
  if not found or not private.is_member(v_e.household_id) then
    raise exception 'pagamento não encontrado' using errcode = '42501';
  end if;
  -- trava o cartão (membro da família + FOR UPDATE) e relê o pagamento já com a trava
  v_d := private.debt_lock(v_e.debt_id);
  select * into v_e from public.debt_events where id = p_event for update;
  if v_d.kind <> 'card' or v_e.kind not in ('payment', 'extra_principal') then
    raise exception 'só pagamento de cartão muda de fatura' using errcode = '22023';
  end if;
  if v_e.voided_at is not null then
    raise exception 'pagamento anulado não muda de fatura' using errcode = '22023';
  end if;
  -- pagamento de uma operação com outros lançamentos (ex.: antecipação, que grava as cobranças e o pagamento juntos, com
  -- o mesmo op_id e a mesma fatura): mudar só o pagamento separaria a operação
  if v_e.op_id is not null and exists (select 1 from public.debt_events x
       where x.household_id = v_e.household_id and x.debt_id = v_e.debt_id and x.op_id = v_e.op_id
         and x.id <> v_e.id and x.voided_at is null) then
    raise exception 'este pagamento faz parte de uma operação com outros lançamentos (ex.: antecipação): ele não muda de fatura sozinho'
      using errcode = '22023';
  end if;
  if v_label is null or v_label !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'fatura de destino inválida' using errcode = '22023';
  end if;
  select m.due_date into v_due from public.card_months(v_d.id) m where m.label = v_label;
  if not found then
    raise exception 'este cartão não tem fatura em %: escolha uma fatura com compra ou crédito', v_label using errcode = '22023';
  end if;
  if exists (select 1 from public.debt_invoices i where i.id = v_e.invoice_id and i.label = v_label) then
    raise exception 'o pagamento já está nessa fatura' using errcode = '22023';
  end if;
  -- Fatura paga não muda (decisão do dono), nem quando os números dela ficariam iguais: um pagamento a mais numa
  -- fatura já quitada não muda o "pago" dela (a sobra vira crédito da seguinte), e card_paid_lock_check, que compara
  -- os números, deixaria passar. Mesma regra da migration 064: fechada (fechamento <= hoje) e paga (pago >= total).
  if exists (select 1 from public.card_months(v_d.id) m
              where m.label in (v_label, (select i.label from public.debt_invoices i where i.id = v_e.invoice_id))
                and m.closing_date <= private.today_sp() and m.paid >= m.total) then
    raise exception 'fatura paga não muda: a fatura de origem ou a de destino já está fechada e paga' using errcode = '55000';
  end if;

  v_lock := private.card_paid_snapshot(v_d.id);
  insert into public.debt_invoices (household_id, debt_id, label, due_date)
  values (v_d.household_id, v_d.id, v_label, v_due)
  on conflict (household_id, debt_id, label) do nothing;
  select i.id into v_inv from public.debt_invoices i
   where i.household_id = v_d.household_id and i.debt_id = v_d.id and i.label = v_label;

  perform set_config('app.card_payment_move', 'on', true);
  update public.debt_events set invoice_id = v_inv where id = v_e.id;
  perform set_config('app.card_payment_move', 'off', true);

  perform private.debt_chk(v_d.id);
  -- origem e destino: se algum estava fechado e pago, o total ou o pago dele mudou e a trava recusa (55000)
  perform private.card_paid_lock_check(v_d.id, v_lock);
  return v_inv;
end $$;

revoke execute on function public.card_payment_move(uuid, text) from public, anon;
grant execute on function public.card_payment_move(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. O pago de uma fatura que deixou de existir vira adiantamento (card_months e card_months_as_of)
-- ---------------------------------------------------------------------------
-- Achado da revisão da #306 (reproduzido): com esta migration um pagamento pode ir para uma fatura aberta ou futura,
-- que só existe enquanto tem parcela ou crédito. Se ela perde tudo (compra excluída, parcela estornada inteira,
-- assinatura cancelada), o mês some de card_months e o pagamento ligado a ela não contava em lugar nenhum: nem como
-- pago, nem como adiantamento. As faturas mostravam o valor dele a mais, e pela tela não havia como chegar nele.
-- Decisão do dono (11/11/2026, opção B): corrigir na causa. As duas funções que somam o pagamento por fatura passam a
-- contar como adiantamento o pagamento ligado a uma fatura cujo mês não está mais na lista. A definição de "mês que
-- existe" é a da própria função (o CTE meses), não uma cópia. Corpos em vigor (card_months: 20261104210100_card_credit_income.sql;
-- card_months_as_of: 20261110070000_card_months_as_of_events_once.sql), com só essas duas mudanças; mesmas assinaturas, colunas e grants. Sem pagamento órfão, o resultado é
-- idêntico ao de antes.
CREATE OR REPLACE FUNCTION public.card_months(p_debt uuid)
 RETURNS TABLE(label text, closing_date date, due_date date, charged numeric, pending numeric, total numeric, paid numeric, items integer, invoice_id uuid, previous_open numeric, advance_in numeric, advance_out numeric, credits numeric)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_d record; r record; v_credit numeric; v_prev numeric := 0; v_ref numeric; v_s0 numeric; v_link numeric; v_total numeric;
  v_use numeric; v_surplus numeric; v_paid numeric; v_due date; v_b date; v_first boolean := true;
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

    label := r.label; closing_date := r.closing_date; due_date := v_due;
    charged := r.charged; pending := r.pending; total := v_total; paid := v_paid;
    items := r.items; invoice_id := r.inv_id; credits := r.credits;
    previous_open := v_prev + v_ref; advance_in := v_credit;
    v_s0 := least(v_surplus, v_ref);
    v_ref := v_ref - v_s0;
    v_credit := v_credit - v_use + (v_surplus - v_s0);
    -- devoluções feitas depois deste fechamento (inclusive) e antes do próximo: levam o crédito que existia então
    -- (inclui a sobra desta fatura); greatest(0, …) só protege a tela, debt_chk já garante a ordem
    v_credit := v_credit - coalesce((
      select sum(e.amount) from public.debt_events e
       where e.household_id = v_d.household_id and e.debt_id = v_d.id and e.voided_at is null
         and e.kind = 'refund_cash' and e.date >= r.closing_date
         and (r.next_closing is null or e.date < r.next_closing)), 0);
    if v_credit < 0 then v_credit := 0; end if;
    advance_out := v_credit;
    v_prev := v_prev + (v_total - v_paid);
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
end $function$;
