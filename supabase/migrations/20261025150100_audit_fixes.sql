-- Tudo Azul — migration 014: correções da auditoria (valor e integridade)
--
-- Achados dos testes adversariais e da auditoria de consistência. Nenhuma tabela perde dados; as migrations
-- já aplicadas NÃO são editadas (as funções são redefinidas aqui com create or replace).
--   B1  card_months ignorava debts.reference_balance (cartão criado com "saldo atual" mostrava fatura paga sem pagar)
--   A1  categoria não pode ser mãe de si mesma
--   A2  debt_void só anula eventos da própria dívida; debt_pay recusa chave de idempotência de outra dívida;
--       card_void_events só mexe na família do chamador
--   A3  evento de dívida não entra por conta desativada (como já é nos lançamentos)
--   A4  nome de conta/categoria com limite bruto de tamanho
--   A5  anulação concorrente relê o evento depois do lock (erro 55000 em vez de "0 anulados")
--   A6  conta não é apagada pela API (só desativada): o delete cascateava a conciliação e o saldo conferido

-- B1 (auditoria): o saldo de referência do cartão (dívida que já existia na data de referência) entra como
-- "anterior em aberto". Pagamento sem fatura e a sobra de pagamento ligado a fatura quitam primeiro esse saldo;
-- antes, eles viravam "adiantamento" e davam fatura nova como paga sem ter sido.
create or replace function public.card_months(p_debt uuid)
returns table (label text, closing_date date, due_date date, charged numeric, pending numeric,
               total numeric, paid numeric, items integer, invoice_id uuid,
               previous_open numeric, advance_in numeric, advance_out numeric)
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_d record; r record; v_credit numeric; v_prev numeric := 0; v_ref numeric; v_s0 numeric; v_link numeric; v_total numeric;
  v_use numeric; v_surplus numeric; v_paid numeric; v_due date; v_b date;
begin
  select d.id, d.household_id, d.closing_day, d.due_day, greatest(0, d.reference_balance) as reference_balance into v_d from public.debts d
   where d.id = p_debt and d.kind = 'card' and (select private.is_member(d.household_id));
  if not found then return; end if;

  -- pagamentos sem fatura: entram como adiantamento; a devolução em dinheiro (refund_cash) tira do crédito
  -- (migration 010: antes, devolver o adiantamento deixava a fatura aparecendo como paga sem estar)
  select greatest(0, coalesce(sum(case when e.kind = 'refund_cash' then -e.amount else e.amount end), 0)) into v_credit
    from public.debt_events e
   where e.household_id = v_d.household_id and e.debt_id = v_d.id and e.voided_at is null
     and e.kind in ('payment', 'extra_principal', 'refund_cash') and e.invoice_id is null;
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
    previous_open := v_prev + v_ref; advance_in := v_credit;
    v_s0 := least(v_surplus, v_ref);
    v_ref := v_ref - v_s0;
    v_credit := v_credit - v_use + (v_surplus - v_s0);
    advance_out := v_credit;
    v_prev := v_prev + (v_total - v_paid);
    return next;
  end loop;
end $$;


-- A1 + A4 -------------------------------------------------------------------
alter table public.categories add constraint categories_not_self_parent check (parent_id is null or parent_id <> id);
alter table public.categories add constraint categories_name_len check (char_length(name) <= 120);
alter table public.accounts add constraint accounts_name_len check (char_length(name) <= 120);

-- A2 ------------------------------------------------------------------------
create or replace function private.card_void_events(p_ids uuid[], p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_n integer := 0;
begin
  if p_ids is null or coalesce(array_length(p_ids, 1), 0) = 0 then return 0; end if;
  update public.debt_events
     set voided_at = now(), voided_by = (select auth.uid()), void_reason = btrim(p_reason)
   where id = any (p_ids) and voided_at is null and household_id = private.current_household();
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke execute on function private.card_void_events(uuid[], text) from public, anon, authenticated;

-- A2 + A5 -------------------------------------------------------------------
create or replace function public.debt_void(p_event uuid, p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_e public.debt_events%rowtype; v_d public.debts%rowtype; v_n integer;
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
  update public.debt_events
     set voided_at = now(), voided_by = (select auth.uid()), void_reason = btrim(p_reason)
   where household_id = v_d.household_id and debt_id = v_d.id and voided_at is null
     and (id = v_e.id or (v_e.op_id is not null and op_id = v_e.op_id));
  get diagnostics v_n = row_count;
  perform private.debt_chk(v_d.id);
  return v_n;
end $$;

create or replace function public.debt_pay(p_debt uuid, p_date date, p_account uuid, p_amount numeric,
                                p_invoice uuid default null, p_extra boolean default false,
                                p_idem uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_d public.debts%rowtype; v_id uuid;
begin
  v_d := private.debt_lock(p_debt);
  if p_idem is not null then
    select e.id into v_id from public.debt_events e
     where e.household_id = v_d.household_id and e.debt_id = v_d.id and e.op_id = p_idem
       and e.kind in ('payment', 'extra_principal') and e.voided_at is null
     limit 1;
    if found then return v_id; end if;
    -- a mesma chave em outra dívida faria debt_void anular os dois pagamentos (op_id compartilhado)
    if exists (select 1 from public.debt_events e
                where e.household_id = v_d.household_id and e.debt_id <> v_d.id and e.op_id = p_idem) then
      raise exception 'chave de idempotência já usada em outra dívida' using errcode = '22023';
    end if;
  end if;
  insert into public.debt_events (household_id, debt_id, date, kind, amount, account_id, invoice_id, op_id)
  values (v_d.household_id, v_d.id, p_date, case when p_extra then 'extra_principal' else 'payment' end,
          p_amount, p_account, p_invoice, p_idem)
  returning id into v_id;
  perform private.debt_chk(v_d.id);
  return v_id;
end $$;

-- A3 ------------------------------------------------------------------------
create or replace function private.debt_events_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.amount is not null then
      if new.amount <> round(new.amount, 2) then
        raise exception 'valor com mais de 2 casas decimais: %', new.amount using errcode = '22003';
      end if;
      new.amount := round(new.amount, 2);
    end if;
    -- active só controla NOVAS movimentações (mesma regra de transactions_guard)
    if new.account_id is not null and exists (
         select 1 from public.accounts a
          where a.household_id = new.household_id and a.id = new.account_id and not a.active) then
      raise exception 'conta desativada' using errcode = '23514';
    end if;
    return new;
  end if;
  -- UPDATE: somente voided_at / voided_by / void_reason, e uma única vez
  if old.voided_at is not null then
    raise exception 'evento já anulado não pode ser alterado' using errcode = '55000';
  end if;
  if (new.id, new.household_id, new.debt_id, new.date, new.kind, new.amount, new.account_id, new.installment_id,
      new.invoice_id, new.category_id, new.op_id, new.note, new.created_by, new.created_at)
     is distinct from
     (old.id, old.household_id, old.debt_id, old.date, old.kind, old.amount, old.account_id, old.installment_id,
      old.invoice_id, old.category_id, old.op_id, old.note, old.created_by, old.created_at) then
    raise exception 'evento é imutável: use a anulação' using errcode = '42501';
  end if;
  return new;
end $$;

-- A6 ------------------------------------------------------------------------
-- Conta com histórico é desativada, nunca apagada. O app não apaga conta; o delete direto cascateava a
-- conciliação. RPCs SECURITY DEFINER (reset_household, delete_household) continuam funcionando.
revoke delete on public.accounts from authenticated;
