-- Tudo Azul — migration 004b: correções do cartão (decisões de 24/10/2026)
--
-- Nome/ordem do arquivo: o timestamp fica ENTRE a 005 (20261017130100, já aplicada) e a 006 de recorrência
-- (20261017140100, PR #28, ainda não mergeada). Assim, esta migration se aplica agora com `db push` normal
-- e a 006 continua depois dela. Se a 006 for aplicada ANTES desta, o `db push` vai recusar por ordem.
--
-- Decisões do dono (24/10/2026), todas sobre o cartão:
--   1. Excluir não volta sozinho: a cobrança automática (card_bill_due) não recria o que foi excluído.
--      Por isso debt_void NÃO anula mais cobrança de parcela solta; o caminho é excluir a compra ou editar a parcela.
--   2. Exclui-se a COMPRA INTEIRA (card_purchase_delete), nunca uma parcela avulsa.
--   3. Fatura paga: para mexer, reabre-se a fatura (card_invoice_reopen = exclui os pagamentos ligados a ela) e o
--      dinheiro volta para a conta de onde saiu.
--   4. Uma única confirmação lista tudo o que será desfeito (card_purchase_delete_preview).
--   5. O valor de cada parcela pode ser editado (card_installment_edit), parcela por parcela: os bancos arredondam
--      de jeitos diferentes (1ª parcela com o resto, ou todas com 1 centavo a mais).
--   6. Parcela já cobrada e ainda não paga: edita direto (a fatura se ajusta). Fatura paga: só depois de reabrir.
--   7. Pagamento diferente da fatura: o que faltou vira "saldo anterior" da fatura seguinte; o excedente vira
--      "adiantamento" que abate a seguinte. Tudo derivado em card_months (nenhum evento novo).
--
-- Correções técnicas (revisões de 23/10/2026):
--   * mudar a abertura de uma conta não pode deixar pagamento de dívida anterior a ela (accounts_guard);
--   * compra retroativa que fecharia antes de uma devolução já lançada é recusada na hora (card_purchase);
--   * uma falha em um cartão não derruba a cobrança dos outros (card_bill_due);
--   * o ciclo (fechamento/vencimento) fica gravado em cada parcela: mudar o ciclo não altera vencimentos antigos;
--   * clique duplo / repetição de rede: chave opcional p_idem em card_purchase e debt_pay.
--
-- Nada é apagado: a "exclusão" é uma anulação auditada (eventos anulados) mais um cancelamento da parcela.
-- Parcela continua imutável, exceto o valor, e só pela RPC card_installment_edit (com trilha de auditoria).
--
-- Códigos de erro: 42501 sem permissão/registro de outra família; 22023 parâmetro inválido; 22003 mais de
-- 2 casas decimais; 23514 regra de integridade; 55000 estado não permite.

-- ---------------------------------------------------------------------------
-- 1. Ciclo por parcela e trilha de edições
-- ---------------------------------------------------------------------------
alter table public.debt_installments
  add column closing_day smallint check (closing_day between 1 and 31),
  add column due_day     smallint check (due_day between 1 and 31),
  add constraint debt_installments_cycle_pair check ((closing_day is null) = (due_day is null));

create table public.debt_installment_edits (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references public.households (id) on delete cascade,
  debt_id        uuid not null,
  installment_id uuid not null,
  old_face       numeric not null check (old_face > 0 and old_face = round(old_face, 2) and old_face < 1e12),
  new_face       numeric not null check (new_face > 0 and new_face = round(new_face, 2) and new_face < 1e12),
  reason         text check (char_length(reason) <= 200),
  edited_by      uuid default auth.uid() references public.profiles (id) on delete set null,
  edited_at      timestamptz not null default now(),
  constraint debt_installment_edits_fk foreign key (household_id, installment_id, debt_id)
    references public.debt_installments (household_id, id, debt_id) deferrable initially immediate
);
create index debt_installment_edits_idx on public.debt_installment_edits (household_id, installment_id, edited_at);

grant select on public.debt_installment_edits to authenticated;
alter table public.debt_installment_edits enable row level security;
create policy debt_installment_edits_select on public.debt_installment_edits for select to authenticated
  using ((select private.is_member(household_id)));

-- Parcela é imutável, EXCETO o valor (face) alterado pela RPC card_installment_edit (que liga app.card_edit
-- só durante o UPDATE). Qualquer outra coluna, ou qualquer outro caminho, continua barrado.
create or replace function private.debt_installments_immutable() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if current_setting('app.card_edit', true) = 'on'
     and (new.id, new.household_id, new.debt_id, new.plan, new.seq, new.due_date, new.category_id,
          new.category_type, new.created_at, new.description, new.purchase_date, new.closing_day, new.due_day)
         is not distinct from
         (old.id, old.household_id, old.debt_id, old.plan, old.seq, old.due_date, old.category_id,
          old.category_type, old.created_at, old.description, old.purchase_date, old.closing_day, old.due_day) then
    return new;
  end if;
  raise exception 'parcela é imutável: use o cancelamento' using errcode = '42501';
end $$;

-- ---------------------------------------------------------------------------
-- 2. Abertura da conta x pagamentos de dívida
-- ---------------------------------------------------------------------------
create or replace function private.accounts_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.initial_balance is not null then
    if new.initial_balance <> round(new.initial_balance, 2) then
      raise exception 'valor com mais de 2 casas decimais: %', new.initial_balance using errcode = '22003';
    end if;
    new.initial_balance := round(new.initial_balance, 2);
  end if;

  if tg_op = 'UPDATE' then
    if new.household_id is distinct from old.household_id then
      raise exception 'household_id não pode ser alterado' using errcode = '42501';
    end if;

    -- Mudar a abertura não pode deixar uma transferência (não excluída) anterior a ela.
    if new.opening_date is distinct from old.opening_date and exists (
      select 1 from public.transactions t
       where t.household_id = new.household_id
         and t.deleted_at is null
         and t.type = 'transfer'
         and (t.account_id = new.id or t.destination_account_id = new.id)
         and t.date < new.opening_date
    ) then
      raise exception 'há transferência anterior à nova data de abertura' using errcode = '23514';
    end if;

    -- ...nem um evento de dívida (pagamento, desembolso, juros...) anterior a ela: o saldo da conta
    -- deixaria de contar o evento enquanto a dívida continuaria quitada.
    if new.opening_date is distinct from old.opening_date and exists (
      select 1 from public.debt_events e
       where e.household_id = new.household_id
         and e.account_id = new.id
         and e.voided_at is null
         and e.date < new.opening_date
    ) then
      raise exception 'há evento de dívida anterior à nova data de abertura' using errcode = '23514';
    end if;

    -- Desativar: recusado se houver lançamento planejado em aberto na conta.
    if old.active and not new.active and exists (
      select 1 from public.transactions t
       where t.household_id = new.household_id
         and t.deleted_at is null
         and t.status = 'planned'
         and (t.account_id = new.id or t.destination_account_id = new.id)
    ) then
      raise exception 'conta com lançamento planejado em aberto não pode ser desativada'
        using errcode = '23514';
    end if;
  end if;

  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Auxiliares internos
-- ---------------------------------------------------------------------------
-- Anula eventos (auditado: quem, quando, por quê). Só chamada por RPC já autenticada e com a dívida travada.
create function private.card_void_events(p_ids uuid[], p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_n integer := 0;
begin
  if p_ids is null or coalesce(array_length(p_ids, 1), 0) = 0 then return 0; end if;
  update public.debt_events
     set voided_at = now(), voided_by = (select auth.uid()), void_reason = btrim(p_reason)
   where id = any (p_ids) and voided_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Reabre uma fatura: anula os pagamentos (e amortizações) ligados a ela; o dinheiro volta para a conta.
create function private.card_reopen_invoice(p_debt uuid, p_invoice uuid, p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_ids uuid[];
begin
  select array_agg(e.id) into v_ids from public.debt_events e
   where e.debt_id = p_debt and e.invoice_id = p_invoice
     and e.kind in ('payment', 'extra_principal') and e.voided_at is null;
  return private.card_void_events(v_ids, p_reason);
end $$;

revoke execute on function private.card_void_events(uuid[], text), private.card_reopen_invoice(uuid, uuid, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Cobrança de parcela não se anula "no solto"
-- ---------------------------------------------------------------------------
-- A cobrança automática cobra "o que ainda resta da parcela": anular a cobrança fazia a parcela voltar a
-- restar e ser cobrada de novo na próxima abertura do app (a correção se desfazia sozinha). Corrigir uma
-- compra passa a ser: excluir a compra (card_purchase_delete) ou editar a parcela (card_installment_edit).
-- Cobranças de uma operação (ex.: antecipação) continuam se anulando pela operação inteira.
create or replace function public.debt_void(p_event uuid, p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_e public.debt_events%rowtype; v_d public.debts%rowtype; v_n integer;
begin
  select * into v_e from public.debt_events where id = p_event;
  if not found then raise exception 'registro não encontrado' using errcode = '42501'; end if;
  v_d := private.debt_lock(v_e.debt_id);
  if v_e.voided_at is not null then
    raise exception 'evento já anulado' using errcode = '55000';
  end if;
  if v_e.kind = 'charge' and v_e.installment_id is not null and v_e.op_id is null then
    raise exception 'cobrança de parcela de cartão não se anula avulsa: exclua a compra ou edite a parcela'
      using errcode = '55000';
  end if;
  update public.debt_events
     set voided_at = now(), voided_by = (select auth.uid()), void_reason = btrim(p_reason)
   where household_id = v_d.household_id and voided_at is null
     and (id = v_e.id or (v_e.op_id is not null and op_id = v_e.op_id));
  get diagnostics v_n = row_count;
  perform private.debt_chk(v_d.id);
  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Compra parcelada: guarda o ciclo em cada parcela, recusa retroativa que quebra devolução, idempotente
-- ---------------------------------------------------------------------------
drop function public.card_purchase(uuid, date, numeric, integer, uuid, text);
create function public.card_purchase(p_debt uuid, p_date date, p_total numeric, p_count integer,
                                     p_category uuid, p_description text, p_idem uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_d public.debts%rowtype; v_plan uuid; v_face numeric; v_first numeric; v_closing date; k integer;
  v_refund date;
begin
  v_d := private.debt_lock(p_debt);
  if v_d.kind <> 'card' then
    raise exception 'compra parcelada só existe em cartão' using errcode = '23514';
  end if;
  if v_d.closing_day is null then
    raise exception 'defina o dia de fechamento e de vencimento do cartão antes de lançar compras'
      using errcode = '55000';
  end if;
  -- repetição (clique duplo, falha de rede): a mesma chave devolve a mesma compra, sem duplicar
  if p_idem is not null and exists (select 1 from public.debt_installments i
       where i.household_id = v_d.household_id and i.debt_id = v_d.id and i.plan = p_idem::text) then
    return p_idem;
  end if;
  if p_date is null or p_count is null or p_count not between 1 and 72
     or p_total is null or p_total <= 0 or p_total >= 1e12 then
    raise exception 'parâmetros inválidos' using errcode = '22023';
  end if;
  if p_total <> round(p_total, 2) then
    raise exception 'valor com mais de 2 casas decimais: %', p_total using errcode = '22003';
  end if;
  if p_date <= v_d.reference_date then
    raise exception 'compra anterior ou igual à data de referência do cartão (%)', v_d.reference_date
      using errcode = '23514';
  end if;

  -- parcelas iguais em centavos; o resto vai na 1ª (ex.: 100,00 em 3x = 33,34 + 33,33 + 33,33).
  -- O valor de cada parcela pode ser corrigido depois (card_installment_edit).
  v_face  := trunc(p_total / p_count, 2);
  v_first := p_total - v_face * (p_count - 1);
  if v_face <= 0 then
    raise exception 'valor pequeno demais para % parcelas', p_count using errcode = '22023';
  end if;

  v_closing := private.card_first_closing(p_date, v_d.closing_day);
  -- uma cobrança nessa data antes de uma devolução em dinheiro já lançada deixaria o crédito a receber
  -- negativo na data da devolução e travaria a cobrança automática do cartão
  select max(e.date) into v_refund from public.debt_events e
   where e.debt_id = v_d.id and e.kind = 'refund_cash' and e.voided_at is null;
  if v_refund is not null and v_closing <= v_refund then
    raise exception 'esta compra fecharia em % , antes de uma devolução já lançada em %: exclua a devolução ou use uma data de compra posterior',
      v_closing, v_refund using errcode = '23514';
  end if;

  v_plan := coalesce(p_idem, gen_random_uuid());
  for k in 0 .. p_count - 1 loop
    insert into public.debt_installments (household_id, debt_id, plan, seq, due_date, face, category_id,
                                          description, purchase_date, closing_day, due_day)
    values (v_d.household_id, v_d.id, v_plan::text, k + 1,
            private.card_day_in_month((date_trunc('month', v_closing) + make_interval(months => k))::date, v_d.closing_day),
            case when k = 0 then v_first else v_face end, p_category,
            nullif(btrim(p_description), ''), p_date, v_d.closing_day, v_d.due_day);
  end loop;
  perform private.debt_chk(v_d.id);
  return v_plan;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Pagamento idempotente
-- ---------------------------------------------------------------------------
drop function public.debt_pay(uuid, date, uuid, numeric, uuid, boolean);
create function public.debt_pay(p_debt uuid, p_date date, p_account uuid, p_amount numeric,
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
  end if;
  insert into public.debt_events (household_id, debt_id, date, kind, amount, account_id, invoice_id, op_id)
  values (v_d.household_id, v_d.id, p_date, case when p_extra then 'extra_principal' else 'payment' end,
          p_amount, p_account, p_invoice, p_idem)
  returning id into v_id;
  perform private.debt_chk(v_d.id);
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Cobrança automática: ciclo da parcela; uma falha não derruba os outros cartões
-- ---------------------------------------------------------------------------
create or replace function public.card_bill_due(p_until date default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_h uuid := private.current_household();
  v_until date := least(coalesce(p_until, private.today_sp()), private.today_sp());
  v_card uuid; v_d public.debts%rowtype; r record; v_inv uuid; v_label text; v_n integer := 0; v_c integer;
begin
  if (select auth.uid()) is null or v_h is null then
    raise exception 'não autenticado ou sem família' using errcode = '42501';
  end if;
  for v_card in select id from public.debts
                 where household_id = v_h and kind = 'card' and closing_day is not null
                 order by id loop
    -- cada cartão em seu próprio bloco: se as regras de integridade recusarem as cobranças de um cartão,
    -- só esse fica sem cobrar (com aviso no log) e os outros seguem
    begin
      v_d := private.debt_lock(v_card);
      v_c := 0;
      for r in
        select i.id, i.due_date, i.closing_day, i.due_day,
               i.face - coalesce((select sum(e.amount) from public.debt_events e
                                   where e.installment_id = i.id and e.kind in ('charge', 'cancel')
                                     and e.voided_at is null), 0) as rem
          from public.debt_installments i
         where i.household_id = v_d.household_id and i.debt_id = v_d.id
           and i.due_date <= v_until and i.due_date > v_d.reference_date
         order by i.due_date, i.seq
      loop
        continue when r.rem <= 0;
        v_label := to_char(r.due_date, 'YYYY-MM');
        insert into public.debt_invoices (household_id, debt_id, label, due_date)
        values (v_d.household_id, v_d.id, v_label,
                private.card_due_date(r.due_date, coalesce(r.closing_day, v_d.closing_day),
                                      coalesce(r.due_day, v_d.due_day)))
        on conflict (household_id, debt_id, label) do nothing;
        select id into v_inv from public.debt_invoices
         where household_id = v_d.household_id and debt_id = v_d.id and label = v_label;
        insert into public.debt_events (household_id, debt_id, date, kind, amount, installment_id, invoice_id, note)
        values (v_d.household_id, v_d.id, r.due_date, 'charge', r.rem, r.id, v_inv, 'fechamento da fatura');
        v_c := v_c + 1;
      end loop;
      perform private.debt_chk(v_d.id);
      v_n := v_n + v_c;
    exception when sqlstate '23514' or sqlstate '55000' or sqlstate '22023' then
      raise warning 'card_bill_due: cartão % ignorado (%: %)', v_card, sqlstate, sqlerrm;
    end;
  end loop;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- 8. Reabrir fatura, excluir compra inteira (com prévia) e editar parcela
-- ---------------------------------------------------------------------------
create function public.card_invoice_reopen(p_debt uuid, p_label text, p_reason text default 'fatura reaberta')
returns integer language plpgsql security definer set search_path = '' as $$
declare v_d public.debts%rowtype; v_inv uuid; v_n integer; v_reason text := btrim(coalesce(p_reason, ''));
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
  v_n := private.card_reopen_invoice(v_d.id, v_inv, v_reason);
  perform private.debt_chk(v_d.id);
  return v_n;
end $$;

-- Prévia da exclusão (para a tela de confirmação): tudo o que será desfeito, sem gravar nada.
--   charge/credit  = cobranças e estornos da compra, que serão anulados;
--   payment...     = pagamentos das faturas envolvidas (e eventos da mesma operação), que serão anulados
--                    (o dinheiro volta para a conta account_id);
--   cancel         = o que será cancelado de cada parcela, para a cobrança automática não recriar.
create function public.card_purchase_delete_preview(p_debt uuid, p_plan text)
returns table (item text, event_date date, amount numeric, account_id uuid, invoice_label text)
language sql stable security invoker set search_path = '' as $$
  with d as (
    select id, household_id from public.debts
     where id = p_debt and kind = 'card' and (select private.is_member(household_id))
  ), ins as (
    select i.* from public.debt_installments i join d on d.household_id = i.household_id and d.id = i.debt_id
     where i.plan = p_plan
  ), chg as (
    select e.* from public.debt_events e join ins on ins.id = e.installment_id
     where e.kind in ('charge', 'credit') and e.voided_at is null
  ), pay as (
    select e.* from public.debt_events e
     where e.debt_id = p_debt and e.voided_at is null and e.kind in ('payment', 'extra_principal')
       and e.invoice_id in (select c.invoice_id from chg c where c.kind = 'charge' and c.invoice_id is not null)
  ), sib as (
    select e.* from public.debt_events e
     where e.debt_id = p_debt and e.voided_at is null
       and e.op_id in (select c.op_id from chg c where c.op_id is not null)
  ), ev as (
    select * from chg union select * from pay union select * from sib
  )
  select ev.kind, ev.date, ev.amount, ev.account_id,
         (select inv.label from public.debt_invoices inv where inv.id = ev.invoice_id)
    from ev
  union all
  select 'cancel', ins.due_date,
         ins.face - coalesce((select sum(c.amount) from public.debt_events c
                               where c.installment_id = ins.id and c.kind = 'cancel' and c.voided_at is null
                                 and c.id not in (select s.id from sib s)), 0),
         null::uuid, null::text
    from ins
   where ins.face - coalesce((select sum(c.amount) from public.debt_events c
                               where c.installment_id = ins.id and c.kind = 'cancel' and c.voided_at is null
                                 and c.id not in (select s.id from sib s)), 0) > 0
$$;

create function public.card_purchase_delete(p_debt uuid, p_plan text, p_reason text default 'compra excluída')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_d public.debts%rowtype; v_op uuid := gen_random_uuid(); v_reason text := btrim(coalesce(p_reason, ''));
  v_inst uuid[]; v_ids uuid[]; v_ops uuid[]; r record; v_date date;
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
  return v_op;
end $$;

create function public.card_installment_edit(p_installment uuid, p_face numeric, p_reason text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_i public.debt_installments%rowtype; v_d public.debts%rowtype; v_charge public.debt_events%rowtype;
  v_n integer; v_id uuid := gen_random_uuid(); v_old numeric;
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
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 9. Relatórios: saldo anterior e adiantamento; parcela excluída não aparece
-- ---------------------------------------------------------------------------
-- Por fatura (mês do fechamento):
--   paid          pago da fatura = pagamentos ligados a ela (até o total) + adiantamento aplicado;
--   previous_open o que ficou sem pagar das faturas anteriores ("saldo anterior");
--   advance_in    adiantamento disponível ao chegar nesta fatura (excedente pago antes + pagamentos sem fatura);
--   advance_out   adiantamento que sobra depois desta fatura.
-- O adiantamento abate as faturas mais antigas em aberto. Dívida do cartão = Σ saldos anteriores − adiantamento final.
drop function public.card_months(uuid);
create function public.card_months(p_debt uuid)
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

  -- pagamentos sem fatura: entram como adiantamento
  select coalesce(sum(e.amount), 0) into v_credit from public.debt_events e
   where e.household_id = v_d.household_id and e.debt_id = v_d.id and e.voided_at is null
     and e.kind in ('payment', 'extra_principal') and e.invoice_id is null;

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

-- Itens da fatura: parcela totalmente cancelada (compra excluída) não aparece.
create or replace function public.card_items(p_debt uuid, p_label text)
returns table (installment_id uuid, plan text, seq integer, plan_count integer, description text,
               purchase_date date, closing_date date, face numeric, remaining numeric, category_id uuid)
language sql stable security invoker set search_path = '' as $$
  select i.id, i.plan, i.seq,
         (select count(*)::int from public.debt_installments x where x.debt_id = i.debt_id and x.plan = i.plan),
         i.description, i.purchase_date, i.due_date, i.face,
         i.face - coalesce((select sum(e.amount) from public.debt_events e
                             where e.installment_id = i.id and e.voided_at is null
                               and e.kind in ('charge', 'cancel')), 0),
         i.category_id
    from public.debt_installments i
   where i.debt_id = p_debt and to_char(i.due_date, 'YYYY-MM') = p_label
     and (select private.is_member(i.household_id))
     and coalesce((select sum(e.amount) from public.debt_events e
                    where e.installment_id = i.id and e.voided_at is null and e.kind = 'cancel'), 0) < i.face
   order by i.purchase_date nulls first, i.description, i.seq
$$;

-- ---------------------------------------------------------------------------
-- 10. Permissões das funções novas e recriadas
-- ---------------------------------------------------------------------------
revoke execute on function
  public.card_purchase(uuid, date, numeric, integer, uuid, text, uuid),
  public.debt_pay(uuid, date, uuid, numeric, uuid, boolean, uuid),
  public.card_months(uuid),
  public.card_invoice_reopen(uuid, text, text),
  public.card_purchase_delete_preview(uuid, text),
  public.card_purchase_delete(uuid, text, text),
  public.card_installment_edit(uuid, numeric, text)
  from public, anon;
grant execute on function
  public.card_purchase(uuid, date, numeric, integer, uuid, text, uuid),
  public.debt_pay(uuid, date, uuid, numeric, uuid, boolean, uuid),
  public.card_months(uuid),
  public.card_invoice_reopen(uuid, text, text),
  public.card_purchase_delete_preview(uuid, text),
  public.card_purchase_delete(uuid, text, text),
  public.card_installment_edit(uuid, numeric, text)
  to authenticated;
