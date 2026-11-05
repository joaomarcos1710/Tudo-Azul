-- Tudo Azul — migration 064: fatura de cartão PAGA fica travada.
--
-- Pedido do dono (05/11/2026, tela Cartões olhando setembro/outubro "Paga"): "se uma fatura já está fechada e paga, não
-- pode mudar o que já foi pago no cartão". Antes, a fatura paga podia ser reaberta (card_invoice_reopen desfazia os
-- pagamentos) e os itens dela editados, excluídos ou estornados; o histórico deixava de bater com o extrato do banco.
--
-- Regra (a mesma da tela, situacaoFatura em src/lib/cartoes.ts, sobre os números de card_months):
--   fatura TRAVADA = fechada (closing_date <= hoje em São Paulo) e paga (paid >= total).
--   "paid" de card_months já inclui o adiantamento aplicado; total nunca é negativo (fatura de R$ 0,00 fechada também é
--   "paga", como na tela).
--
-- Como a guarda funciona (um lugar só, sem repetir a regra em cada função):
--   1. private.card_paid_snapshot(debt): {label: [total, paid]} de cada fatura travada, lido de card_months;
--   2. a operação roda normalmente;
--   3. depois de debt_chk (as recusas de integridade, 23514, continuam com o mesmo código),
--      private.card_paid_lock_check(debt, foto, exceção): relê card_months e RECUSA (55000) se o total ou o pago de
--      qualquer fatura travada mudou (ou se ela sumiu). Assim pega também o efeito indireto (ex.: anular um pagamento
--      adiantado que quitou uma fatura antiga, anular uma antecipação que cobrou parcelas numa fatura paga).
--   O que não muda total nem pago de fatura travada continua permitido (pagar, lançar crédito na fatura atual, estornar
--   parcela de fatura aberta/futura, mexer em fatura fechada ainda não paga).
--
-- Exceção (decisão em 30 - Decisões): anular o pagamento que acabou de ser lançado errado. Só o pagamento (payment ou
-- extra_principal) mais recente do cartão (created_at) e lançado há menos de 24 horas; e só a fatura a que ele está
-- ligado fica liberada — as outras faturas travadas continuam conferidas.
--
-- Funções recriadas a partir da ÚLTIMA versão de cada uma, com o mesmo corpo fora a foto antes e a conferência depois:
--   public.debt_void              (20261025150100_audit_fixes)
--   public.debt_refund            (20261013130100_liabilities)
--   public.card_invoice_reopen    (20261017135000_card_corrections)
--   public.card_purchase_delete   (20261017135000_card_corrections)
--   public.card_installment_edit  (20261017135000_card_corrections) — mais uma checagem antecipada, para a mensagem de
--                                 fatura travada vir antes da antiga "reabra a fatura" (que não vale para fatura paga).
-- Não mudam: debt_pay, card_credit_income, card_purchase(_at), card_bill_due (não alteram fatura já paga; ver Pendências
-- sobre compra lançada com deslocamento para uma fatura passada).
--
-- Teste: 64_card_paid_invoice_lock (falha sem esta migration).

-- ---------------------------------------------------------------------------
-- 1. Guarda comum
-- ---------------------------------------------------------------------------
-- Faturas travadas do cartão: {"AAAA-MM": [total, pago]}. Fora de cartão (ou sem permissão), card_months não devolve
-- linha e a foto é vazia (nada a conferir: as RPCs já exigem membro pela debt_lock).
create function private.card_paid_snapshot(p_debt uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_object_agg(m.label, jsonb_build_array(m.total, m.paid)), '{}'::jsonb)
    from public.card_months(p_debt) m
   where m.closing_date <= private.today_sp() and m.paid >= m.total
$$;

create function private.card_paid_lock_raise(p_label text) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'a fatura de % já está paga e travada: não pode ser alterada', to_char(to_date(p_label, 'YYYY-MM'), 'MM/YYYY')
    using errcode = '55000',
          hint = 'para corrigir, lance um crédito ou estorno na fatura atual';
end $$;

-- Confere, depois da operação, que nenhuma fatura travada antes (p_before) mudou de total ou de pago.
-- p_except: a fatura liberada pela exceção do pagamento recém-lançado (null = nenhuma).
create function private.card_paid_lock_check(p_debt uuid, p_before jsonb, p_except text default null) returns void
language plpgsql stable security invoker set search_path = '' as $$
declare v_now jsonb; r record;
begin
  if p_before is null or p_before = '{}'::jsonb then return; end if;
  select coalesce(jsonb_object_agg(m.label, jsonb_build_array(m.total, m.paid)), '{}'::jsonb) into v_now
    from public.card_months(p_debt) m;
  for r in select key, value from jsonb_each(p_before) order by key loop
    if p_except is not null and r.key = p_except then continue; end if;
    if (v_now -> r.key) is distinct from r.value then
      perform private.card_paid_lock_raise(r.key);
    end if;
  end loop;
end $$;

revoke execute on function private.card_paid_snapshot(uuid), private.card_paid_lock_raise(text),
  private.card_paid_lock_check(uuid, jsonb, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. debt_void (versão 20261025150100) + trava + exceção do pagamento recém-lançado
-- ---------------------------------------------------------------------------
create or replace function public.debt_void(p_event uuid, p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_e public.debt_events%rowtype; v_d public.debts%rowtype; v_n integer; v_lock jsonb; v_except text;
begin
  select * into v_e from public.debt_events where id = p_event;
  if not found then raise exception 'registro não encontrado' using errcode = '42501'; end if;
  v_d := private.debt_lock(v_e.debt_id);
  -- relê depois do lock: uma anulação concorrente pode ter acontecido enquanto esperávamos
  select * into v_e from public.debt_events where id = p_event;
  if v_e.voided_at is not null then
    raise exception 'evento já anulado' using errcode = '55000';
  end if;
  if v_e.kind = 'charge' and v_e.installment_id is not null and v_e.op_id is null then
    raise exception 'cobrança de parcela de cartão não se anula avulsa: exclua a compra ou edite a parcela'
      using errcode = '55000';
  end if;
  v_lock := private.card_paid_snapshot(v_d.id);
  -- exceção: o último pagamento do cartão, lançado há menos de 24 h, pode ser anulado (pagamento lançado errado);
  -- libera só a fatura dele
  if v_e.kind in ('payment', 'extra_principal') and v_e.invoice_id is not null
     and v_e.created_at > now() - interval '24 hours'
     and not exists (select 1 from public.debt_events o
                      where o.household_id = v_d.household_id and o.debt_id = v_d.id and o.voided_at is null
                        and o.kind in ('payment', 'extra_principal') and o.created_at > v_e.created_at) then
    select inv.label into v_except from public.debt_invoices inv where inv.id = v_e.invoice_id;
  end if;
  update public.debt_events
     set voided_at = now(), voided_by = (select auth.uid()), void_reason = btrim(p_reason)
   where household_id = v_d.household_id and debt_id = v_d.id and voided_at is null
     and (id = v_e.id or (v_e.op_id is not null and op_id = v_e.op_id));
  get diagnostics v_n = row_count;
  perform private.debt_chk(v_d.id);
  perform private.card_paid_lock_check(v_d.id, v_lock, v_except);
  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- 3. debt_refund (versão 20261013130100) + trava
-- ---------------------------------------------------------------------------
create or replace function public.debt_refund(p_installment uuid, p_date date, p_amount numeric, p_invoice uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_i public.debt_installments%rowtype; v_d public.debts%rowtype; v_rem numeric;
  v_cancel numeric; v_credit numeric; v_op uuid := gen_random_uuid(); v_id uuid; v_lock jsonb;
begin
  select * into v_i from public.debt_installments where id = p_installment;
  if not found then raise exception 'registro não encontrado' using errcode = '42501'; end if;
  v_d := private.debt_lock(v_i.debt_id);
  if p_amount is null or p_amount <= 0 then
    raise exception 'valor do estorno inválido' using errcode = '22023';
  end if;
  v_lock := private.card_paid_snapshot(v_d.id);
  v_rem := v_i.face - coalesce((select sum(e.amount) from public.debt_events e
            where e.installment_id = v_i.id and e.kind in ('charge', 'cancel') and e.voided_at is null), 0);
  v_cancel := least(p_amount, v_rem);
  v_credit := p_amount - v_cancel;
  if v_cancel > 0 then
    insert into public.debt_events (household_id, debt_id, date, kind, amount, installment_id, op_id, note)
    values (v_d.household_id, v_d.id, p_date, 'cancel', v_cancel, v_i.id, v_op, 'estorno de parcela futura');
  end if;
  if v_credit > 0 then
    insert into public.debt_events (household_id, debt_id, date, kind, amount, installment_id, invoice_id, op_id, note)
    values (v_d.household_id, v_d.id, p_date, 'credit', v_credit, v_i.id, p_invoice, v_op, 'estorno')
    returning id into v_id;
  end if;
  perform private.debt_chk(v_d.id);
  perform private.card_paid_lock_check(v_d.id, v_lock);
  return coalesce(v_id, v_op);
end $$;

-- ---------------------------------------------------------------------------
-- 4. card_invoice_reopen (versão 20261017135000) + trava: fatura paga não reabre
-- ---------------------------------------------------------------------------
create or replace function public.card_invoice_reopen(p_debt uuid, p_label text, p_reason text default 'fatura reaberta')
returns integer language plpgsql security definer set search_path = '' as $$
declare v_d public.debts%rowtype; v_inv uuid; v_n integer; v_reason text := btrim(coalesce(p_reason, '')); v_lock jsonb;
begin
  v_d := private.debt_lock(p_debt);
  if v_d.kind <> 'card' then
    raise exception 'só cartão tem fatura' using errcode = '23514';
  end if;
  if char_length(v_reason) not between 3 and 200 then
    raise exception 'informe o motivo (3 a 200 caracteres)' using errcode = '22023';
  end if;
  select id into v_inv from public.debt_invoices
   where household_id = v_d.household_id and debt_id = v_d.id and label = btrim(p_label);
  if not found then
    raise exception 'fatura não encontrada' using errcode = '55000';
  end if;
  v_lock := private.card_paid_snapshot(v_d.id);
  v_n := private.card_reopen_invoice(v_d.id, v_inv, v_reason);
  perform private.debt_chk(v_d.id);
  perform private.card_paid_lock_check(v_d.id, v_lock);
  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- 5. card_purchase_delete (versão 20261017135000) + trava: compra com parcela em fatura paga não se exclui
-- ---------------------------------------------------------------------------
create or replace function public.card_purchase_delete(p_debt uuid, p_plan text, p_reason text default 'compra excluída')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_d public.debts%rowtype; v_op uuid := gen_random_uuid(); v_reason text := btrim(coalesce(p_reason, ''));
  v_inst uuid[]; v_ids uuid[]; v_ops uuid[]; r record; v_date date; v_lock jsonb;
begin
  v_d := private.debt_lock(p_debt);
  if v_d.kind <> 'card' then
    raise exception 'só compra de cartão pode ser excluída aqui' using errcode = '23514';
  end if;
  if char_length(v_reason) not between 3 and 200 then
    raise exception 'informe o motivo (3 a 200 caracteres)' using errcode = '22023';
  end if;
  select array_agg(i.id) into v_inst from public.debt_installments i
   where i.household_id = v_d.household_id and i.debt_id = v_d.id and i.plan = p_plan;
  if v_inst is null then
    raise exception 'compra não encontrada' using errcode = '55000';
  end if;
  if not exists (select 1 from public.debt_installments i
                  where i.id = any (v_inst)
                    and coalesce((select sum(e.amount) from public.debt_events e
                                   where e.installment_id = i.id and e.kind = 'cancel' and e.voided_at is null), 0) < i.face) then
    raise exception 'compra já excluída' using errcode = '55000';
  end if;
  v_lock := private.card_paid_snapshot(v_d.id);

  -- operações (ex.: antecipação) que envolvem esta compra: só se forem só desta compra
  select array_agg(distinct e.op_id) into v_ops from public.debt_events e
   where e.installment_id = any (v_inst) and e.kind in ('charge', 'credit') and e.op_id is not null
     and e.voided_at is null;
  if v_ops is not null and exists (select 1 from public.debt_events e
       where e.op_id = any (v_ops) and e.installment_id is not null and e.voided_at is null
         and not (e.installment_id = any (v_inst))) then
    raise exception 'esta compra faz parte de uma operação com outras compras (ex.: antecipação): anule a operação primeiro'
      using errcode = '55000';
  end if;

  -- 1. reabre as faturas envolvidas: os pagamentos ligados a elas são desfeitos (o dinheiro volta à conta)
  for r in select distinct e.invoice_id from public.debt_events e
            where e.installment_id = any (v_inst) and e.kind = 'charge' and e.voided_at is null
              and e.invoice_id is not null loop
    perform private.card_reopen_invoice(v_d.id, r.invoice_id, v_reason);
  end loop;

  -- 2. anula cobranças e estornos das parcelas, e os demais eventos das mesmas operações
  select array_agg(x.id) into v_ids from (
    select e.id from public.debt_events e
     where e.installment_id = any (v_inst) and e.kind in ('charge', 'credit') and e.voided_at is null
    union
    select e.id from public.debt_events e
     where v_ops is not null and e.op_id = any (v_ops) and e.voided_at is null
  ) x;
  perform private.card_void_events(v_ids, v_reason);

  -- 3. cancela o que resta de cada parcela: a cobrança automática não recria nada
  v_date := greatest(private.today_sp(), v_d.reference_date + 1);
  insert into public.debt_events (household_id, debt_id, date, kind, amount, installment_id, op_id, note)
  select v_d.household_id, v_d.id, v_date, 'cancel',
         i.face - coalesce((select sum(e.amount) from public.debt_events e
                             where e.installment_id = i.id and e.kind in ('charge', 'cancel') and e.voided_at is null), 0),
         i.id, v_op, 'compra excluída'
    from public.debt_installments i
   where i.id = any (v_inst)
     and i.face - coalesce((select sum(e.amount) from public.debt_events e
                             where e.installment_id = i.id and e.kind in ('charge', 'cancel') and e.voided_at is null), 0) > 0;

  perform private.debt_chk(v_d.id);
  perform private.card_paid_lock_check(v_d.id, v_lock);
  return v_op;
end $$;

-- ---------------------------------------------------------------------------
-- 6. card_installment_edit (versão 20261017135000) + trava
-- ---------------------------------------------------------------------------
create or replace function public.card_installment_edit(p_installment uuid, p_face numeric, p_reason text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_i public.debt_installments%rowtype; v_d public.debts%rowtype; v_charge public.debt_events%rowtype;
  v_n integer; v_id uuid := gen_random_uuid(); v_old numeric; v_lock jsonb; v_label text;
begin
  select * into v_i from public.debt_installments where id = p_installment;
  if not found then raise exception 'registro não encontrado' using errcode = '42501'; end if;
  v_d := private.debt_lock(v_i.debt_id);
  select * into v_i from public.debt_installments where id = p_installment;  -- relê com a dívida travada
  if p_face is null or p_face <= 0 or p_face >= 1e12 then
    raise exception 'valor da parcela inválido' using errcode = '22023';
  end if;
  if p_face <> round(p_face, 2) then
    raise exception 'valor com mais de 2 casas decimais: %', p_face using errcode = '22003';
  end if;
  if p_reason is not null and char_length(p_reason) > 200 then
    raise exception 'motivo longo demais (máximo 200 caracteres)' using errcode = '22023';
  end if;
  if p_face = v_i.face then
    raise exception 'o valor informado é igual ao atual' using errcode = '22023';
  end if;
  -- fatura travada (fechada e paga): a mensagem certa vem antes das outras recusas
  v_lock := private.card_paid_snapshot(v_d.id);
  v_label := to_char(v_i.due_date, 'YYYY-MM');
  if v_lock ? v_label then
    perform private.card_paid_lock_raise(v_label);
  end if;
  if exists (select 1 from public.debt_events e
              where e.installment_id = v_i.id and e.kind in ('cancel', 'credit') and e.voided_at is null) then
    raise exception 'parcela com cancelamento ou estorno não pode ser editada' using errcode = '55000';
  end if;

  select count(*) into v_n from public.debt_events e
   where e.installment_id = v_i.id and e.kind = 'charge' and e.voided_at is null;
  if v_n > 1 then
    raise exception 'parcela com mais de uma cobrança não pode ser editada' using errcode = '55000';
  end if;
  if v_n = 1 then
    select * into v_charge from public.debt_events e
     where e.installment_id = v_i.id and e.kind = 'charge' and e.voided_at is null;
    if v_charge.op_id is not null or v_charge.amount <> v_i.face then
      raise exception 'cobrança parcial ou de antecipação: a parcela não pode ser editada' using errcode = '55000';
    end if;
    -- fatura paga: só depois de reabrir (senão o saldo da conta deixaria de bater com o que saiu do banco)
    if v_charge.invoice_id is not null and exists (
         select 1 from public.debt_events e
          where e.debt_id = v_d.id and e.invoice_id = v_charge.invoice_id
            and e.kind in ('payment', 'extra_principal') and e.voided_at is null) then
      raise exception 'fatura com pagamento: reabra a fatura antes de editar a parcela' using errcode = '55000';
    end if;
    perform private.card_void_events(array[v_charge.id], 'edição do valor da parcela');
  end if;

  v_old := v_i.face;
  perform set_config('app.card_edit', 'on', true);
  update public.debt_installments set face = p_face where id = v_i.id;
  perform set_config('app.card_edit', 'off', true);

  if v_n = 1 then
    insert into public.debt_events (household_id, debt_id, date, kind, amount, installment_id, invoice_id, note)
    values (v_d.household_id, v_d.id, v_charge.date, 'charge', p_face, v_i.id, v_charge.invoice_id, v_charge.note);
  end if;
  insert into public.debt_installment_edits (id, household_id, debt_id, installment_id, old_face, new_face, reason)
  values (v_id, v_d.household_id, v_d.id, v_i.id, v_old, p_face, nullif(btrim(p_reason), ''));

  perform private.debt_chk(v_d.id);
  perform private.card_paid_lock_check(v_d.id, v_lock);
  return v_id;
end $$;
