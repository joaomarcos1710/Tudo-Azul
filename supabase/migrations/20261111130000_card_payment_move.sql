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
--
-- Códigos de erro: 42501 não autenticado ou pagamento de outra família/inexistente; 22023 não é pagamento de cartão
-- ativo, fatura de destino inválida, inexistente ou igual à atual; 55000 fatura paga (trava); 23514 integridade.
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
