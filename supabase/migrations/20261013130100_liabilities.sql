-- Tudo Azul — migration 002: dívidas, cartões e financiamentos (modelo B)
--
-- Decisão D-H3 (aprovada em 13/10/2026): o passivo NÃO é uma conta. O saldo
-- devedor é DERIVADO de uma tabela de eventos append-only; nenhum lançamento
-- genérico (transactions) pode tocar uma dívida. Dinheiro disponível, dívida,
-- crédito a receber, fluxo e patrimônio ficam em indicadores separados.
--
-- Desenho e protótipo executável: ver a descrição do PR. Em resumo:
--   * debts               a dívida (cartão, empréstimo, financiamento) e seu saldo de referência
--   * debt_invoices       faturas (rótulos) para conciliação
--   * debt_installments   compromissos futuros (parcelas); imutáveis
--   * debt_events         fonte única da verdade; append-only (correção = anulação auditada)
-- Escrita SÓ por RPC (SECURITY DEFINER, com membro verificado). authenticated tem apenas SELECT.
--
-- Sinais: débito do saldo = disbursement, charge, refund_cash (+) ; payment, extra_principal, credit (-).
-- Caixa:  disbursement, refund_cash (+) ; payment, extra_principal, interest, fee (-).
-- Fluxo:  despesa = charge, interest, fee ; credit ABATE a despesa da categoria (decisão de 13/10/2026).
-- 'cancel' reduz o compromisso de uma parcela (sem efeito em caixa, saldo ou fluxo).
--
-- Códigos de erro: 42501 sem permissão/registro inexistente; 22023 parâmetro inválido;
-- 22003 valor com mais de 2 casas; 23514 regra de integridade; 55000 estado inválido.

-- ---------------------------------------------------------------------------
-- 1. Tabelas
-- ---------------------------------------------------------------------------
create table public.debts (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references public.households (id) on delete cascade,
  name              text not null check (char_length(btrim(name)) between 1 and 60),
  kind              text not null check (kind in ('card', 'loan', 'financing')),
  reference_date    date not null check (reference_date between date '2000-01-01' and date '2100-01-01'),
  reference_balance numeric not null default 0
                    check (reference_balance >= 0 and reference_balance = round(reference_balance, 2)
                           and reference_balance < 1e12),
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  unique (household_id, id)
);
create unique index debts_name_uq on public.debts (household_id, lower(btrim(name)));

create table public.debt_invoices (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  debt_id      uuid not null,
  label        text not null check (char_length(btrim(label)) between 1 and 40),
  due_date     date check (due_date between date '2000-01-01' and date '2100-01-01'),
  created_at   timestamptz not null default now(),
  unique (household_id, id, debt_id),
  unique (household_id, debt_id, label),
  constraint debt_invoices_debt_fk foreign key (household_id, debt_id)
    references public.debts (household_id, id) deferrable initially immediate
);

create table public.debt_installments (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  debt_id       uuid not null,
  plan          text not null check (char_length(btrim(plan)) between 1 and 60),
  seq           integer not null check (seq between 1 and 1000),
  due_date      date not null check (due_date between date '2000-01-01' and date '2100-01-01'),
  face          numeric not null check (face > 0 and face = round(face, 2) and face < 1e12),
  category_id   uuid not null,
  category_type text not null default 'expense' check (category_type = 'expense'),
  created_at    timestamptz not null default now(),
  unique (household_id, id, debt_id),
  unique (household_id, debt_id, plan, seq),
  constraint debt_installments_debt_fk foreign key (household_id, debt_id)
    references public.debts (household_id, id) deferrable initially immediate,
  constraint debt_installments_category_fk foreign key (household_id, category_id, category_type)
    references public.categories (household_id, id, type) deferrable initially immediate
);

create table public.debt_events (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references public.households (id) on delete cascade,
  debt_id        uuid not null,
  date           date not null check (date between date '2000-01-01' and date '2100-01-01'),
  kind           text not null check (kind in ('disbursement', 'charge', 'payment', 'extra_principal',
                                               'interest', 'fee', 'credit', 'refund_cash', 'cancel')),
  amount         numeric not null check (amount > 0 and amount = round(amount, 2) and amount < 1e12),
  account_id     uuid,
  installment_id uuid,
  invoice_id     uuid,
  category_id    uuid,
  category_type  text not null default 'expense' check (category_type = 'expense'),
  op_id          uuid,
  note           text check (char_length(note) <= 200),
  created_by     uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  voided_at      timestamptz,
  voided_by      uuid references public.profiles (id) on delete set null,
  void_reason    text check (char_length(btrim(void_reason)) between 3 and 200),
  -- forma do evento: conta só nos que mexem em caixa; parcela só nos de parcela; categoria só em juros/tarifa
  constraint debt_events_shape check (
        ((kind in ('disbursement', 'payment', 'extra_principal', 'interest', 'fee', 'refund_cash'))
           = (account_id is not null))
    and ((kind in ('charge', 'credit', 'cancel')) = (installment_id is not null))
    and ((kind in ('interest', 'fee')) = (category_id is not null))
  ),
  constraint debt_events_void check ((voided_at is null) = (void_reason is null)),
  constraint debt_events_debt_fk foreign key (household_id, debt_id)
    references public.debts (household_id, id) deferrable initially immediate,
  constraint debt_events_account_fk foreign key (household_id, account_id)
    references public.accounts (household_id, id) deferrable initially immediate,
  constraint debt_events_installment_fk foreign key (household_id, installment_id, debt_id)
    references public.debt_installments (household_id, id, debt_id) deferrable initially immediate,
  constraint debt_events_invoice_fk foreign key (household_id, invoice_id, debt_id)
    references public.debt_invoices (household_id, id, debt_id) deferrable initially immediate,
  constraint debt_events_category_fk foreign key (household_id, category_id, category_type)
    references public.categories (household_id, id, type) deferrable initially immediate
);
create index debt_events_debt_idx on public.debt_events (household_id, debt_id, date) where voided_at is null;
create index debt_events_account_idx on public.debt_events (household_id, account_id, date)
  where account_id is not null and voided_at is null;
create index debt_events_installment_idx on public.debt_events (household_id, installment_id)
  where installment_id is not null and voided_at is null;
create index debt_events_op_idx on public.debt_events (op_id) where op_id is not null;
create index debt_installments_debt_idx on public.debt_installments (household_id, debt_id, due_date);

-- ---------------------------------------------------------------------------
-- 2. Segurança: só SELECT para authenticated; escrita exclusivamente por RPC
-- ---------------------------------------------------------------------------
grant select on public.debts, public.debt_invoices, public.debt_installments, public.debt_events to authenticated;

alter table public.debts             enable row level security;
alter table public.debt_invoices     enable row level security;
alter table public.debt_installments enable row level security;
alter table public.debt_events       enable row level security;

create policy debts_select on public.debts for select to authenticated
  using ((select private.is_member(household_id)));
create policy debt_invoices_select on public.debt_invoices for select to authenticated
  using ((select private.is_member(household_id)));
create policy debt_installments_select on public.debt_installments for select to authenticated
  using ((select private.is_member(household_id)));
create policy debt_events_select on public.debt_events for select to authenticated
  using ((select private.is_member(household_id)));

-- ---------------------------------------------------------------------------
-- 3. Funções internas (private): efeito dos eventos, saldo e verificação de integridade
-- ---------------------------------------------------------------------------
create function private.debt_effect(p_kind text, p_amount numeric) returns numeric
language sql immutable set search_path = '' as $$
  select case when p_kind in ('disbursement', 'charge', 'refund_cash') then p_amount
              when p_kind in ('payment', 'extra_principal', 'credit') then -p_amount
              else 0 end
$$;

-- Saldo devedor na data (positivo = dívida; negativo = crédito a receber).
create function private.debt_balance(p_debt uuid, p_as_of date) returns numeric
language sql stable security definer set search_path = '' as $$
  select d.reference_balance + coalesce((
           select sum(private.debt_effect(e.kind, e.amount))
             from public.debt_events e
            where e.debt_id = d.id and e.voided_at is null and e.date <= p_as_of), 0)
    from public.debts d where d.id = p_debt
$$;

-- Regras que FK e CHECK não expressam. Chamada ao fim de cada RPC (erro na hora)
-- e também por constraint trigger adiado (defesa para qualquer outro caminho).
create function private.debt_chk(p_debt uuid) returns void
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
    if r.kind <> 'refund_cash' and private.debt_balance(p_debt, r.date) < 0 then
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

create function private.debt_chk_trg() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then perform private.debt_chk(old.debt_id);
  else perform private.debt_chk(new.debt_id); end if;
  return null;
end $$;
create constraint trigger debt_events_chk after insert or update or delete on public.debt_events
  deferrable initially deferred for each row execute function private.debt_chk_trg();

-- Dinheiro (N2): recusa mais de 2 casas e normaliza. Evento: append-only, só a anulação muda.
create function private.debt_events_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.amount is not null then
      if new.amount <> round(new.amount, 2) then
        raise exception 'valor com mais de 2 casas decimais: %', new.amount using errcode = '22003';
      end if;
      new.amount := round(new.amount, 2);
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
create trigger debt_events_guard before insert or update on public.debt_events
  for each row execute function private.debt_events_guard();

create function private.debt_money_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_table_name = 'debts' then
    if new.reference_balance <> round(new.reference_balance, 2) then
      raise exception 'valor com mais de 2 casas decimais: %', new.reference_balance using errcode = '22003';
    end if;
    new.reference_balance := round(new.reference_balance, 2);
  else
    if new.face <> round(new.face, 2) then
      raise exception 'valor com mais de 2 casas decimais: %', new.face using errcode = '22003';
    end if;
    new.face := round(new.face, 2);
  end if;
  return new;
end $$;
create trigger debts_money_guard before insert or update on public.debts
  for each row execute function private.debt_money_guard();
create trigger debt_installments_money_guard before insert on public.debt_installments
  for each row execute function private.debt_money_guard();

-- Âncora do saldo e parcelas são imutáveis depois de criadas (correção = nova dívida/anulação).
create function private.debts_immutable() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if (new.household_id, new.kind, new.reference_date, new.reference_balance)
     is distinct from (old.household_id, old.kind, old.reference_date, old.reference_balance) then
    raise exception 'âncora da dívida é imutável' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger debts_immutable before update on public.debts
  for each row execute function private.debts_immutable();

create function private.debt_installments_immutable() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'parcela é imutável: use o cancelamento' using errcode = '42501';
end $$;
create trigger debt_installments_immutable before update on public.debt_installments
  for each row execute function private.debt_installments_immutable();

-- Família do chamador (N1) e dívida travada para escrita (serializa operações por dívida).
create function private.current_household() returns uuid
language sql stable security definer set search_path = '' as $$
  select household_id from public.household_members where user_id = (select auth.uid())
$$;

create function private.debt_lock(p_debt uuid) returns public.debts
language plpgsql security definer set search_path = '' as $$
declare v public.debts%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'não autenticado' using errcode = '42501';
  end if;
  select * into v from public.debts
   where id = p_debt and household_id = private.current_household() for update;
  if not found then
    raise exception 'registro não encontrado' using errcode = '42501';
  end if;
  return v;
end $$;

revoke execute on function
  private.debt_effect(text, numeric), private.debt_balance(uuid, date), private.debt_chk(uuid),
  private.debt_chk_trg(), private.debt_events_guard(), private.debt_money_guard(), private.debts_immutable(),
  private.debt_installments_immutable(), private.current_household(), private.debt_lock(uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Operações (RPC). Todas: autenticado, membro, dívida travada, regras verificadas ao fim.
-- ---------------------------------------------------------------------------
create function public.create_debt(p_name text, p_kind text, p_reference_date date, p_reference_balance numeric default 0)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_h uuid := private.current_household(); v_id uuid;
begin
  if (select auth.uid()) is null or v_h is null then
    raise exception 'não autenticado ou sem família' using errcode = '42501';
  end if;
  if p_kind not in ('card', 'loan', 'financing') or p_reference_date is null then
    raise exception 'parâmetros inválidos' using errcode = '22023';
  end if;
  insert into public.debts (household_id, name, kind, reference_date, reference_balance)
  values (v_h, btrim(p_name), p_kind, p_reference_date, coalesce(p_reference_balance, 0))
  returning id into v_id;
  return v_id;
end $$;

create function public.create_debt_invoice(p_debt uuid, p_label text, p_due_date date default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_d public.debts%rowtype; v_id uuid;
begin
  v_d := private.debt_lock(p_debt);
  insert into public.debt_invoices (household_id, debt_id, label, due_date)
  values (v_d.household_id, v_d.id, btrim(p_label), p_due_date) returning id into v_id;
  return v_id;
end $$;

-- Cria p_count parcelas mensais iguais (face = p_amount cada) a partir de p_first_due.
create function public.create_debt_installments(p_debt uuid, p_plan text, p_first_due date, p_count integer,
                                                p_amount numeric, p_category uuid, p_first_seq integer default 1)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_d public.debts%rowtype; k integer;
begin
  v_d := private.debt_lock(p_debt);
  if p_count is null or p_count not between 1 and 120 or p_first_seq is null or p_first_seq < 1 then
    raise exception 'parâmetros inválidos' using errcode = '22023';
  end if;
  for k in 0 .. p_count - 1 loop
    insert into public.debt_installments (household_id, debt_id, plan, seq, due_date, face, category_id)
    values (v_d.household_id, v_d.id, btrim(p_plan), p_first_seq + k,
            (p_first_due + make_interval(months => k))::date, p_amount, p_category);
  end loop;
  perform private.debt_chk(v_d.id);
  return p_count;
end $$;

-- Cobrança da parcela na fatura (despesa reconhecida na data da cobrança).
create function public.debt_bill(p_installment uuid, p_date date, p_invoice uuid default null, p_amount numeric default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_i public.debt_installments%rowtype; v_d public.debts%rowtype; v_rem numeric; v_id uuid;
begin
  select * into v_i from public.debt_installments where id = p_installment;
  if not found then raise exception 'registro não encontrado' using errcode = '42501'; end if;
  v_d := private.debt_lock(v_i.debt_id);
  v_rem := v_i.face - coalesce((select sum(e.amount) from public.debt_events e
            where e.installment_id = v_i.id and e.kind in ('charge', 'cancel') and e.voided_at is null), 0);
  if coalesce(p_amount, v_rem) <= 0 then
    raise exception 'não há valor a cobrar nesta parcela' using errcode = '55000';
  end if;
  insert into public.debt_events (household_id, debt_id, date, kind, amount, installment_id, invoice_id)
  values (v_d.household_id, v_d.id, p_date, 'charge', coalesce(p_amount, v_rem), v_i.id, p_invoice)
  returning id into v_id;
  perform private.debt_chk(v_d.id);
  return v_id;
end $$;

-- Pagamento (de fatura ou de parcela do empréstimo) a partir de uma conta.
create function public.debt_pay(p_debt uuid, p_date date, p_account uuid, p_amount numeric,
                                p_invoice uuid default null, p_extra boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_d public.debts%rowtype; v_id uuid;
begin
  v_d := private.debt_lock(p_debt);
  insert into public.debt_events (household_id, debt_id, date, kind, amount, account_id, invoice_id)
  values (v_d.household_id, v_d.id, p_date, case when p_extra then 'extra_principal' else 'payment' end,
          p_amount, p_account, p_invoice)
  returning id into v_id;
  perform private.debt_chk(v_d.id);
  return v_id;
end $$;

-- Desembolso, juros e tarifa de empréstimo/financiamento.
create function public.debt_loan_event(p_debt uuid, p_date date, p_kind text, p_account uuid, p_amount numeric,
                                       p_category uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_d public.debts%rowtype; v_id uuid;
begin
  v_d := private.debt_lock(p_debt);
  if p_kind not in ('disbursement', 'interest', 'fee') then
    raise exception 'tipo inválido (use debt_pay para pagamentos)' using errcode = '22023';
  end if;
  if (p_kind in ('interest', 'fee')) <> (p_category is not null) then
    raise exception 'juros e tarifa exigem categoria; desembolso não tem' using errcode = '22023';
  end if;
  insert into public.debt_events (household_id, debt_id, date, kind, amount, account_id, category_id)
  values (v_d.household_id, v_d.id, p_date, p_kind, p_amount, p_account, p_category)
  returning id into v_id;
  perform private.debt_chk(v_d.id);
  return v_id;
end $$;

-- Antecipação explícita: p_portions[k] é a parte do valor de face quitada da parcela p_installments[k];
-- p_discounts[k] é o desconto sobre essa parte (reduz o compromisso e a despesa). A despesa é reconhecida
-- na data da antecipação, pelo valor líquido. Tarifa e juros entram como despesas à parte.
create function public.debt_anticipate(p_debt uuid, p_date date, p_account uuid, p_installments uuid[],
                                       p_portions numeric[], p_discounts numeric[],
                                       p_fee numeric default 0, p_interest numeric default 0,
                                       p_fee_category uuid default null, p_invoice uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_d public.debts%rowtype; v_op uuid := gen_random_uuid(); v_total numeric := 0; v_net numeric; k integer;
begin
  v_d := private.debt_lock(p_debt);
  if p_installments is null or coalesce(array_length(p_installments, 1), 0) = 0
     or array_length(p_installments, 1) <> coalesce(array_length(p_portions, 1), -1)
     or array_length(p_installments, 1) <> coalesce(array_length(p_discounts, 1), -1) then
    raise exception 'listas de parcelas, valores e descontos devem ter o mesmo tamanho' using errcode = '22023';
  end if;
  if (coalesce(p_fee, 0) > 0 or coalesce(p_interest, 0) > 0) and p_fee_category is null then
    raise exception 'tarifa/juros exigem categoria' using errcode = '22023';
  end if;
  for k in 1 .. array_length(p_installments, 1) loop
    if p_portions[k] <= 0 or p_discounts[k] < 0 or p_discounts[k] >= p_portions[k] then
      raise exception 'valor ou desconto inválido na parcela %', k using errcode = '22023';
    end if;
    if not exists (select 1 from public.debt_installments i
                    where i.id = p_installments[k] and i.debt_id = v_d.id and i.household_id = v_d.household_id) then
      raise exception 'parcela % não pertence a esta dívida', k using errcode = '22023';
    end if;
    v_net := p_portions[k] - p_discounts[k];
    if p_discounts[k] > 0 then
      insert into public.debt_events (household_id, debt_id, date, kind, amount, installment_id, op_id, note)
      values (v_d.household_id, v_d.id, p_date, 'cancel', p_discounts[k], p_installments[k], v_op, 'desconto de antecipação');
    end if;
    insert into public.debt_events (household_id, debt_id, date, kind, amount, installment_id, invoice_id, op_id, note)
    values (v_d.household_id, v_d.id, p_date, 'charge', v_net, p_installments[k], p_invoice, v_op, 'antecipação');
    v_total := v_total + v_net;
  end loop;
  insert into public.debt_events (household_id, debt_id, date, kind, amount, account_id, invoice_id, op_id, note)
  values (v_d.household_id, v_d.id, p_date, 'payment', v_total, p_account, p_invoice, v_op, 'antecipação');
  if coalesce(p_fee, 0) > 0 then
    insert into public.debt_events (household_id, debt_id, date, kind, amount, account_id, category_id, op_id, note)
    values (v_d.household_id, v_d.id, p_date, 'fee', p_fee, p_account, p_fee_category, v_op, 'tarifa de antecipação');
  end if;
  if coalesce(p_interest, 0) > 0 then
    insert into public.debt_events (household_id, debt_id, date, kind, amount, account_id, category_id, op_id, note)
    values (v_d.household_id, v_d.id, p_date, 'interest', p_interest, p_account, p_fee_category, v_op, 'juros');
  end if;
  perform private.debt_chk(v_d.id);
  return v_op;
end $$;

-- Estorno de uma parcela: primeiro cancela o que ainda não foi cobrado (sem efeito em saldo),
-- depois credita o já cobrado (abate a despesa da categoria e pode virar crédito a receber).
create function public.debt_refund(p_installment uuid, p_date date, p_amount numeric, p_invoice uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_i public.debt_installments%rowtype; v_d public.debts%rowtype; v_rem numeric;
  v_cancel numeric; v_credit numeric; v_op uuid := gen_random_uuid(); v_id uuid;
begin
  select * into v_i from public.debt_installments where id = p_installment;
  if not found then raise exception 'registro não encontrado' using errcode = '42501'; end if;
  v_d := private.debt_lock(v_i.debt_id);
  if p_amount is null or p_amount <= 0 then
    raise exception 'valor do estorno inválido' using errcode = '22023';
  end if;
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
  return coalesce(v_id, v_op);
end $$;

-- Devolução em dinheiro da operadora: liquida o crédito a receber (não gera receita).
create function public.debt_return(p_debt uuid, p_date date, p_account uuid, p_amount numeric)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_d public.debts%rowtype; v_id uuid;
begin
  v_d := private.debt_lock(p_debt);
  insert into public.debt_events (household_id, debt_id, date, kind, amount, account_id, note)
  values (v_d.household_id, v_d.id, p_date, 'refund_cash', p_amount, p_account, 'devolução da operadora')
  returning id into v_id;
  perform private.debt_chk(v_d.id);
  return v_id;
end $$;

-- Anulação auditada de um evento avulso, ou de uma operação inteira (p_op).
create function public.debt_void(p_event uuid, p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_e public.debt_events%rowtype; v_d public.debts%rowtype; v_n integer;
begin
  select * into v_e from public.debt_events where id = p_event;
  if not found then raise exception 'registro não encontrado' using errcode = '42501'; end if;
  v_d := private.debt_lock(v_e.debt_id);
  if v_e.voided_at is not null then
    raise exception 'evento já anulado' using errcode = '55000';
  end if;
  update public.debt_events
     set voided_at = now(), voided_by = (select auth.uid()), void_reason = btrim(p_reason)
   where household_id = v_d.household_id and voided_at is null
     and (id = v_e.id or (v_e.op_id is not null and op_id = v_e.op_id));
  get diagnostics v_n = row_count;
  perform private.debt_chk(v_d.id);
  return v_n;
end $$;

revoke execute on function
  public.create_debt(text, text, date, numeric), public.create_debt_invoice(uuid, text, date),
  public.create_debt_installments(uuid, text, date, integer, numeric, uuid, integer),
  public.debt_bill(uuid, date, uuid, numeric), public.debt_pay(uuid, date, uuid, numeric, uuid, boolean),
  public.debt_loan_event(uuid, date, text, uuid, numeric, uuid),
  public.debt_anticipate(uuid, date, uuid, uuid[], numeric[], numeric[], numeric, numeric, uuid, uuid),
  public.debt_refund(uuid, date, numeric, uuid), public.debt_return(uuid, date, uuid, numeric),
  public.debt_void(uuid, text)
  from public, anon;
grant execute on function
  public.create_debt(text, text, date, numeric), public.create_debt_invoice(uuid, text, date),
  public.create_debt_installments(uuid, text, date, integer, numeric, uuid, integer),
  public.debt_bill(uuid, date, uuid, numeric), public.debt_pay(uuid, date, uuid, numeric, uuid, boolean),
  public.debt_loan_event(uuid, date, text, uuid, numeric, uuid),
  public.debt_anticipate(uuid, date, uuid, uuid[], numeric[], numeric[], numeric, numeric, uuid, uuid),
  public.debt_refund(uuid, date, numeric, uuid), public.debt_return(uuid, date, uuid, numeric),
  public.debt_void(uuid, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Relatórios (SECURITY INVOKER, como na migration 001)
-- ---------------------------------------------------------------------------
-- Saldo das contas passa a incluir o efeito de caixa dos eventos de dívida.
create or replace function public.account_balances(p_household uuid, p_as_of date)
returns table (account_id uuid, name text, type text, active boolean, balance numeric)
language sql stable security invoker set search_path = '' as $$
  select a.id, a.name, a.type, a.active,
         a.initial_balance + coalesce(sum(case
           when t.type = 'income'   and t.account_id = a.id             then  t.amount
           when t.type = 'expense'  and t.account_id = a.id             then -t.amount
           when t.type = 'transfer' and t.account_id = a.id             then -t.amount
           when t.type = 'transfer' and t.destination_account_id = a.id then  t.amount
         end), 0)
         + coalesce((
           select sum(case when e.kind in ('disbursement', 'refund_cash') then e.amount else -e.amount end)
             from public.debt_events e
            where e.household_id = a.household_id and e.account_id = a.id and e.voided_at is null
              and e.date >= a.opening_date and e.date <= p_as_of), 0)
    from public.accounts a
    left join public.transactions t
      on t.household_id = a.household_id
     and t.deleted_at is null
     and t.status = 'paid'
     and t.date >= a.opening_date
     and t.date <= p_as_of
     and (t.account_id = a.id or t.destination_account_id = a.id)
   where a.household_id = p_household and a.opening_date <= p_as_of
   group by a.id, a.name, a.type, a.active, a.initial_balance
$$;

-- Receitas e despesas do período. Cobranças, juros e tarifas de dívida são despesa; o estorno
-- ABATE a despesa. Planejado inclui o compromisso ainda não cobrado das parcelas que vencem no período.
create or replace function public.period_summary(p_household uuid, p_from date, p_to date)
returns table (income_paid numeric, expense_paid numeric, result numeric,
               income_planned numeric, expense_planned numeric)
language sql stable security invoker set search_path = '' as $$
  select s.income_paid, s.expense_paid, s.income_paid - s.expense_paid,
         s.income_planned, s.expense_planned
    from (
      select coalesce(sum(t.amount) filter (where t.type = 'income'  and t.status = 'paid'), 0)    as income_paid,
             coalesce(sum(t.amount) filter (where t.type = 'expense' and t.status = 'paid'), 0)
               + coalesce((select sum(case when e.kind = 'credit' then -e.amount else e.amount end)
                             from public.debt_events e
                            where e.household_id = p_household and e.voided_at is null
                              and e.kind in ('charge', 'credit', 'interest', 'fee')
                              and e.date between p_from and p_to), 0)                              as expense_paid,
             coalesce(sum(t.amount) filter (where t.type = 'income'  and t.status = 'planned'), 0) as income_planned,
             coalesce(sum(t.amount) filter (where t.type = 'expense' and t.status = 'planned'), 0)
               + coalesce((select sum(i.face - coalesce((select sum(e.amount) from public.debt_events e
                                    where e.installment_id = i.id and e.kind in ('charge', 'cancel')
                                      and e.voided_at is null), 0))
                             from public.debt_installments i
                            where i.household_id = p_household and i.due_date between p_from and p_to), 0) as expense_planned
        from (select 1) base
        left join public.transactions t
          on t.household_id = p_household
         and t.deleted_at is null
         and t.type in ('income', 'expense')
         and t.date between p_from and p_to
    ) s
   where (select private.is_member(p_household))
$$;

create or replace function public.budget_usage(p_household uuid, p_month date)
returns table (category_id uuid, category_name text, amount_limit numeric,
               spent numeric, remaining numeric, percent numeric)
language sql stable security invoker set search_path = '' as $$
  select b.category_id, c.name, b.amount_limit,
         coalesce(s.spent, 0),
         b.amount_limit - coalesce(s.spent, 0),
         round(100 * coalesce(s.spent, 0) / b.amount_limit, 1)
    from public.budgets b
    join public.categories c on c.household_id = b.household_id and c.id = b.category_id
    left join lateral (
      select sum(x.amt) as spent
        from (
          select t.amount as amt, t.category_id as cat
            from public.transactions t
           where t.household_id = b.household_id and t.type = 'expense' and t.status = 'paid'
             and t.deleted_at is null
             and t.date >= b.month and t.date < (b.month + interval '1 month')::date
          union all
          select case when e.kind = 'credit' then -e.amount else e.amount end,
                 coalesce(e.category_id, i.category_id)
            from public.debt_events e
            left join public.debt_installments i
              on i.household_id = e.household_id and i.id = e.installment_id
           where e.household_id = b.household_id and e.voided_at is null
             and e.kind in ('charge', 'credit', 'interest', 'fee')
             and e.date >= b.month and e.date < (b.month + interval '1 month')::date
        ) x
        join public.categories tc on tc.household_id = b.household_id and tc.id = x.cat
       where tc.id = b.category_id or tc.parent_id = b.category_id
    ) s on true
   where b.household_id = p_household
     and b.month = date_trunc('month', p_month::timestamp)::date
     and (select private.is_member(p_household))
   order by c.name
$$;

-- Saldo de cada dívida na data: dívida e crédito a receber SEPARADOS (nunca somados com sinal).
create function public.debt_balances(p_household uuid, p_as_of date)
returns table (debt_id uuid, name text, kind text, balance numeric, debt numeric,
               credit_receivable numeric, planned_remaining numeric)
language sql stable security invoker set search_path = '' as $$
  select d.id, d.name, d.kind, b.bal, greatest(b.bal, 0), greatest(-b.bal, 0), coalesce(p.rem, 0)
    from public.debts d
   cross join lateral (
     select d.reference_balance + coalesce(sum(case
              when e.kind in ('disbursement', 'charge', 'refund_cash') then  e.amount
              when e.kind in ('payment', 'extra_principal', 'credit')  then -e.amount
              else 0 end), 0) as bal
       from public.debt_events e
      where e.household_id = d.household_id and e.debt_id = d.id and e.voided_at is null and e.date <= p_as_of
   ) b
   left join lateral (
     select sum(i.face - coalesce((select sum(e.amount) from public.debt_events e
                                    where e.household_id = i.household_id and e.installment_id = i.id
                                      and e.kind in ('charge', 'cancel') and e.voided_at is null
                                      and e.date <= p_as_of), 0)) as rem
       from public.debt_installments i
      where i.household_id = d.household_id and i.debt_id = d.id
   ) p on true
   where d.household_id = p_household and d.reference_date <= p_as_of
     and (select private.is_member(p_household))
   order by d.name
$$;

-- Os quatro indicadores, separados: disponível (contas), dívida, crédito a receber e patrimônio líquido.
-- patrimônio = disponível + crédito a receber − dívida. Compromissos futuros ficam FORA do patrimônio.
create function public.net_worth(p_household uuid, p_as_of date)
returns table (available numeric, debt numeric, credit_receivable numeric, net_worth numeric,
               planned_commitments numeric)
language sql stable security invoker set search_path = '' as $$
  select s.available, s.debt, s.cr, s.available + s.cr - s.debt, s.pc
    from (
      select coalesce((select sum(b.balance) from public.account_balances(p_household, p_as_of) b), 0) as available,
             coalesce((select sum(x.debt) from public.debt_balances(p_household, p_as_of) x), 0) as debt,
             coalesce((select sum(x.credit_receivable) from public.debt_balances(p_household, p_as_of) x), 0) as cr,
             coalesce((select sum(x.planned_remaining) from public.debt_balances(p_household, p_as_of) x), 0) as pc
    ) s
   where (select private.is_member(p_household))
$$;

revoke execute on function public.debt_balances(uuid, date), public.net_worth(uuid, date) from public, anon;
grant execute on function public.debt_balances(uuid, date), public.net_worth(uuid, date) to authenticated;
