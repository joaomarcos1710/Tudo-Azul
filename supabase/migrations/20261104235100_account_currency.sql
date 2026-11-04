-- Tudo Azul — migration 055: moeda da conta (multimoeda, fase 1).
-- Decisão do dono (04/11/2026): multimoeda em fases. Esta é a F1: cada conta tem uma moeda e os saldos ficam
-- separados por moeda. Nada é convertido aqui (cotação PTAX e total convertido ficam para a F4).
--
-- O que muda:
--   1. accounts.currency_code (BRL padrão; referência ao catálogo public.currencies da migration 027).
--      A moeda só muda enquanto a conta não tem NENHUM movimento: lançamento (inclusive na lixeira, como origem ou
--      destino), evento de dívida, recorrente, conferência, cartão/dívida que a usa para pagamento. Provento é um
--      lançamento de receita (035), então está coberto. Regra no accounts_guard.
--   2. Bloqueio provisório (liberado na F2/F3): conta que não é BRL ainda não aceita lançamento (receita, despesa,
--      transferência, origem ou destino), recorrente, evento de dívida nem ser a conta de pagamento de cartão/dívida.
--      Uma regra só (private.account_brl_only), chamada pelos gatilhos que já existiam: transactions_guard,
--      recurrences_money_guard, debt_events_guard e debt_money_guard. Assim, por enquanto, o saldo de uma conta
--      estrangeira é só o saldo inicial.
--   3. account_balances e account_balances_projected ganham currency_code (drop + create: o tipo de retorno muda;
--      grants refeitos como na 001/032). O saldo de cada conta continua na moeda dela.
--   4. Os totais que somam saldos de contas passam a somar SÓ contas BRL (nunca somar moedas sem conversão):
--      balance_totals, balance_totals_by_type, balance_totals_projected, net_worth, net_worth_with_assets.
--      daily_digest usa balance_totals_projected e herda o filtro sem ser recriado. reconcile_account e
--      account_movements são por conta (uma moeda só) e não mudam.
--   5. balance_totals_by_currency(p_household, p_as_of): total e total das ativas por moeda, mesma base de
--      account_balances, sem conversão.
-- Relatórios de receita/despesa (period_summary, budget_usage, ...) não mudam nesta fase: como a conta estrangeira
-- não aceita lançamento, todo lançamento continua em reais.
-- Testes: 55_account_currency.

-- ---------------------------------------------------------------------------
-- 1. Coluna
-- ---------------------------------------------------------------------------
alter table public.accounts
  add column currency_code text not null default 'BRL'
  constraint accounts_currency_fk references public.currencies (code);

grant insert (currency_code) on public.accounts to authenticated;
grant update (currency_code) on public.accounts to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Bloqueio provisório: uma regra só
-- ---------------------------------------------------------------------------
-- Recusa movimento em conta que não é BRL. Trava a conta (FOR SHARE) como o transactions_guard: trocar a moeda
-- (UPDATE na conta) e gravar um movimento nunca acontecem ao mesmo tempo sem que um enxergue o outro.
-- Conta inexistente (ou de outra família): não faz nada, as FKs compostas reportam o erro.
create function private.account_brl_only(p_household uuid, p_account uuid) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v_moeda text;
begin
  if p_account is null then
    return;
  end if;
  select a.currency_code into v_moeda from public.accounts a
   where a.household_id = p_household and a.id = p_account for share;
  if found and v_moeda <> 'BRL' then
    raise exception 'contas em moeda estrangeira (%) ainda não aceitam lançamentos, recorrentes nem pagamentos (em breve)', v_moeda
      using errcode = '23514';
  end if;
end $$;
revoke execute on function private.account_brl_only(uuid, uuid) from public, anon, authenticated;
-- os gatilhos rodam como o chamador
grant execute on function private.account_brl_only(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. accounts_guard (create or replace da 008): moeda válida e só troca sem movimento
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

  -- Moeda: só uma habilitada no catálogo (a FK garante que existe).
  if (tg_op = 'INSERT' or new.currency_code is distinct from old.currency_code)
     and not exists (select 1 from public.currencies c where c.code = new.currency_code and c.enabled) then
    raise exception 'moeda % não está disponível', new.currency_code using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' then
    if new.household_id is distinct from old.household_id then
      raise exception 'household_id não pode ser alterado' using errcode = '42501';
    end if;

    -- Moeda: só muda enquanto a conta não tem NENHUM movimento (o saldo inicial é da moeda nova).
    if new.currency_code is distinct from old.currency_code and (
         exists (select 1 from public.transactions t           -- inclusive na lixeira
                  where t.household_id = new.household_id
                    and (t.account_id = new.id or t.destination_account_id = new.id))
      or exists (select 1 from public.debt_events e            -- inclusive anulados
                  where e.household_id = new.household_id and e.account_id = new.id)
      or exists (select 1 from public.recurrences r
                  where r.household_id = new.household_id
                    and (r.account_id = new.id or r.destination_account_id = new.id))
      or exists (select 1 from public.account_reconciliations c
                  where c.household_id = new.household_id and c.account_id = new.id)
      or exists (select 1 from public.debts d
                  where d.household_id = new.household_id
                    and (d.pay_account_id = new.id or d.payment_account_id = new.id))
    ) then
      raise exception 'a moeda da conta só muda enquanto ela não tem nenhum movimento (lançamento, inclusive na lixeira, recorrente, pagamento de dívida, cartão ou dívida que a usa, conferência)'
        using errcode = '23514';
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
-- 4. Gatilhos que já existiam passam a chamar a regra do item 2
-- ---------------------------------------------------------------------------
-- transactions_guard (create or replace da 001): igual, mais a moeda das duas contas.
create or replace function private.transactions_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_src public.accounts%rowtype;
  v_dst public.accounts%rowtype;
  v_have_src boolean := false;
  v_have_dst boolean := false;
  v_restoring boolean := false;
  v_src_changed boolean := true;
  v_dst_changed boolean := true;
begin
  if tg_op = 'UPDATE' then
    if new.household_id is distinct from old.household_id then
      raise exception 'household_id não pode ser alterado' using errcode = '42501';
    end if;
    v_restoring   := old.deleted_at is not null;
    v_src_changed := new.account_id is distinct from old.account_id;
    v_dst_changed := new.destination_account_id is distinct from old.destination_account_id;
  end if;

  -- Dinheiro (N2): recusa mais de 2 casas e normaliza para escala 2.
  -- O CHECK da coluna roda DEPOIS deste trigger, então a recusa precisa estar aqui.
  if new.amount is not null then
    if new.amount <> round(new.amount, 2) then
      raise exception 'valor com mais de 2 casas decimais: %', new.amount using errcode = '22003';
    end if;
    new.amount := round(new.amount, 2);
  end if;

  -- Lançamento na lixeira não passa pelas regras de conta.
  if new.deleted_at is not null then
    return new;
  end if;

  -- Trava as contas envolvidas (FOR SHARE). O UPDATE em accounts toma bloqueio
  -- exclusivo da linha, então inserir lançamento e desativar/mudar a abertura da
  -- conta nunca acontecem ao mesmo tempo sem que um enxergue o outro.
  select * into v_src from public.accounts
   where household_id = new.household_id and id = new.account_id for share;
  v_have_src := found;
  if new.destination_account_id is not null then
    select * into v_dst from public.accounts
     where household_id = new.household_id and id = new.destination_account_id for share;
    v_have_dst := found;
  end if;
  -- Conta inexistente (ou de outra família): as FKs compostas reportam o erro.

  -- Multimoeda F1 (055): conta que não é BRL ainda não aceita lançamento, como origem ou destino.
  perform private.account_brl_only(new.household_id, new.account_id);
  perform private.account_brl_only(new.household_id, new.destination_account_id);

  -- Decisão 8: transferência não pode ser anterior à abertura de NENHUMA das contas.
  if new.type = 'transfer' then
    if v_have_src and new.date < v_src.opening_date then
      raise exception 'transferência anterior à abertura da conta de origem (%)', v_src.opening_date
        using errcode = '23514';
    end if;
    if v_have_dst and new.date < v_dst.opening_date then
      raise exception 'transferência anterior à abertura da conta de destino (%)', v_dst.opening_date
        using errcode = '23514';
    end if;
  end if;

  -- active só controla NOVAS movimentações: inserir, restaurar da lixeira ou
  -- trocar a conta. Editar lançamento existente em conta desativada é permitido.
  if tg_op = 'INSERT' or v_restoring or v_src_changed then
    if v_have_src and not v_src.active then
      raise exception 'conta de origem desativada' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'INSERT' or v_restoring or v_dst_changed then
    if v_have_dst and not v_dst.active then
      raise exception 'conta de destino desativada' using errcode = '23514';
    end if;
  end if;

  return new;
end $$;

-- recurrences_money_guard (create or replace da 010): igual, mais a moeda das contas do recorrente.
create or replace function private.recurrences_money_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.amount <> round(new.amount, 2) then
    raise exception 'valor com mais de 2 casas decimais: %', new.amount using errcode = '22003';
  end if;
  new.amount := round(new.amount, 2);
  perform private.account_brl_only(new.household_id, new.account_id);
  perform private.account_brl_only(new.household_id, new.destination_account_id);
  return new;
end $$;

-- debt_money_guard (create or replace da 002): igual, mais a moeda da conta de pagamento do cartão/dívida.
create or replace function private.debt_money_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_table_name = 'debts' then
    if new.reference_balance <> round(new.reference_balance, 2) then
      raise exception 'valor com mais de 2 casas decimais: %', new.reference_balance using errcode = '22003';
    end if;
    new.reference_balance := round(new.reference_balance, 2);
    perform private.account_brl_only(new.household_id, new.pay_account_id);
    perform private.account_brl_only(new.household_id, new.payment_account_id);
  else
    if new.face <> round(new.face, 2) then
      raise exception 'valor com mais de 2 casas decimais: %', new.face using errcode = '22003';
    end if;
    new.face := round(new.face, 2);
  end if;
  return new;
end $$;

-- debt_events_guard (create or replace da 052): igual, mais a moeda da conta do evento.
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
  if (new.id,new.household_id,new.debt_id,new.date,new.kind,new.amount,new.account_id,new.installment_id,
      new.invoice_id,new.category_id,new.op_id,new.note,new.created_by,new.created_at,new.schedule_id,
      new.category_type,new.credit_date)
     is distinct from
     (old.id,old.household_id,old.debt_id,old.date,old.kind,old.amount,old.account_id,old.installment_id,
      old.invoice_id,old.category_id,old.op_id,old.note,old.created_by,old.created_at,old.schedule_id,
      old.category_type,old.credit_date) then
    raise exception 'evento é imutável: use a anulação' using errcode = '42501';
  end if;
  return new;
end
$$;

revoke execute on function private.accounts_guard(), private.transactions_guard(), private.recurrences_money_guard(),
  private.debt_money_guard(), private.debt_events_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Saldos por conta: ganham a moeda (drop + create, o tipo de retorno muda)
-- ---------------------------------------------------------------------------
-- Nenhuma view depende delas; as funções SQL que as chamam são resolvidas na execução e voltam a funcionar
-- assim que as novas existem (todas recriadas abaixo ou conferidas no cabeçalho).
drop function public.balance_totals_projected(uuid, date, boolean);
drop function public.account_balances_projected(uuid, date, boolean);
drop function public.account_balances(uuid, date);

-- Saldo de cada conta na data, NA MOEDA DA CONTA (create da 002 + currency_code). Não filtra por active.
create function public.account_balances(p_household uuid, p_as_of date)
returns table (account_id uuid, name text, type text, active boolean, balance numeric, currency_code text)
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
              and e.date >= a.opening_date and e.date <= p_as_of), 0),
         a.currency_code
    from public.accounts a
    left join public.transactions t
      on t.household_id = a.household_id
     and t.deleted_at is null
     and t.status = 'paid'
     and t.date >= a.opening_date
     and t.date <= p_as_of
     and (t.account_id = a.id or t.destination_account_id = a.id)
   where a.household_id = p_household and a.opening_date <= p_as_of
   group by a.id, a.name, a.type, a.active, a.initial_balance, a.currency_code
$$;

-- Saldo projetado por conta (create or replace da 037 + currency_code), na moeda da conta.
create function public.account_balances_projected(
  p_household uuid, p_as_of date, p_include_planned boolean default true
)
returns table(account_id uuid,name text,type text,active boolean,realized numeric,planned numeric,invoices numeric,balance numeric,
              currency_code text)
language sql stable security invoker set search_path = '' as $$
  select b.account_id,b.name,b.type,b.active,b.balance,
    case when p_include_planned then coalesce(pl.delta,0) - coalesce(ds.rem,0) else 0 end,
    case when p_include_planned then coalesce(inv.rem,0) else 0 end,
    b.balance
      + case when p_include_planned then coalesce(pl.delta,0) - coalesce(ds.rem,0) else 0 end
      - case when p_include_planned then coalesce(inv.rem,0) else 0 end,
    b.currency_code
  from public.account_balances(p_household,p_as_of) b
  join public.accounts a on a.id=b.account_id
  left join lateral (
    select sum(case
      when t.type='income' and t.account_id=a.id then t.amount
      when t.type='expense' and t.account_id=a.id then -t.amount
      when t.type='transfer' and t.account_id=a.id then -t.amount
      when t.type='transfer' and t.destination_account_id=a.id then t.amount
    end) as delta
    from public.transactions t
    where t.household_id=a.household_id and t.deleted_at is null and t.status='planned'
      and t.date>=a.opening_date and t.date<=p_as_of
      and (t.account_id=a.id or t.destination_account_id=a.id)
  ) pl on true
  left join lateral (
    select sum(s.amount) as rem
    from public.debt_payment_schedule s
    join public.debts d on d.household_id=s.household_id and d.id=s.debt_id
    where s.household_id=a.household_id and s.status='planned' and s.due_date<=p_as_of
      and d.payment_method='account_debit' and d.payment_account_id=a.id
  ) ds on true
  left join lateral (
    select sum(greatest(m.total-m.paid,0)) as rem
    from public.debts d
    cross join lateral public.card_months(d.id) m
    where d.household_id=a.household_id and d.kind='card' and d.pay_account_id=a.id
      and m.due_date<=p_as_of
  ) inv on true
  where (select private.is_member(p_household))
  order by b.name
$$;

-- ---------------------------------------------------------------------------
-- 6. Totais: só contas BRL (nunca somar moedas sem conversão)
-- ---------------------------------------------------------------------------
-- (create or replace da 001) Invariante: total = total_active + total_inactive.
create or replace function public.balance_totals(p_household uuid, p_as_of date)
returns table (total numeric, total_active numeric, total_inactive numeric)
language sql stable security invoker set search_path = '' as $$
  select s.* from (
    select coalesce(sum(b.balance), 0),
           coalesce(sum(b.balance) filter (where b.active), 0),
           coalesce(sum(b.balance) filter (where not b.active), 0)
      from public.account_balances(p_household, p_as_of) b
     where b.currency_code = 'BRL'
  ) s
  where (select private.is_member(p_household))
$$;

-- (create or replace da 044) por tipo, só BRL.
create or replace function public.balance_totals_by_type(p_household uuid, p_as_of date)
returns table (account_type text, total numeric, total_active numeric)
language sql stable security invoker set search_path = '' as $$
  select b.type,
         coalesce(sum(b.balance), 0),
         coalesce(sum(b.balance) filter (where b.active), 0)
    from public.account_balances(p_household, p_as_of) b
   where (select private.is_member(p_household)) and b.currency_code = 'BRL'
   group by b.type
   order by case b.type when 'checking' then 1 when 'savings' then 2 when 'investment' then 3
                        when 'cash' then 4 else 5 end
$$;

-- (create da 037, recriada porque foi derrubada acima) realizado e planejado só das contas BRL. Faturas e agenda
-- sem conta continuam no total: são em reais (cartão e dívida só pagam por conta BRL, item 2).
create function public.balance_totals_projected(
  p_household uuid, p_as_of date, p_include_planned boolean default true
)
returns table(realized numeric,planned numeric,invoices numeric,unassigned_invoices numeric,total numeric)
language sql stable security invoker set search_path = '' as $$
  with c as (
    select coalesce(sum(b.realized),0) as realized,coalesce(sum(b.planned),0) as planned
    from public.account_balances_projected(p_household,p_as_of,p_include_planned) b
    where b.currency_code = 'BRL'
  ), f as (
    select coalesce(sum(greatest(m.total-m.paid,0)),0) as todas,
      coalesce(sum(greatest(m.total-m.paid,0)) filter (where d.pay_account_id is null),0) as sem_conta
    from public.debts d
    cross join lateral public.card_months(d.id) m
    where d.household_id=p_household and d.kind='card' and m.due_date<=p_as_of
  ), s as (
    select coalesce(sum(sch.amount),0) as sem_conta
    from public.debt_payment_schedule sch
    join public.debts d on d.household_id=sch.household_id and d.id=sch.debt_id
    where sch.household_id=p_household and sch.status='planned' and sch.due_date<=p_as_of
      and d.payment_method in ('boleto','manual')
  )
  select c.realized,c.planned,
    case when p_include_planned then f.todas+s.sem_conta else 0 end,
    case when p_include_planned then f.sem_conta+s.sem_conta else 0 end,
    c.realized+c.planned-case when p_include_planned then f.todas+s.sem_conta else 0 end
  from c cross join f cross join s
  where (select private.is_member(p_household))
$$;

-- (create da 002) disponível só das contas BRL.
create or replace function public.net_worth(p_household uuid, p_as_of date)
returns table (available numeric, debt numeric, credit_receivable numeric, net_worth numeric,
               planned_commitments numeric)
language sql stable security invoker set search_path = '' as $$
  select s.available, s.debt, s.cr, s.available + s.cr - s.debt, s.pc
    from (
      select coalesce((select sum(b.balance) from public.account_balances(p_household, p_as_of) b
                        where b.currency_code = 'BRL'), 0) as available,
             coalesce((select sum(x.debt) from public.debt_balances(p_household, p_as_of) x), 0) as debt,
             coalesce((select sum(x.credit_receivable) from public.debt_balances(p_household, p_as_of) x), 0) as cr,
             coalesce((select sum(x.planned_remaining) from public.debt_balances(p_household, p_as_of) x), 0) as pc
    ) s
   where (select private.is_member(p_household))
$$;

-- (create da 038) disponível só das contas BRL (os bens já eram só BRL).
create or replace function public.net_worth_with_assets(p_household uuid, p_as_of date)
returns table(
  available numeric,
  debt numeric,
  credit_receivable numeric,
  family_assets_brl numeric,
  net_worth numeric,
  planned_commitments numeric
)
language sql stable security invoker set search_path = '' as $$
  select s.available, s.debt, s.cr, s.family_assets_brl,
         s.available + s.cr + s.family_assets_brl - s.debt,
         s.pc
    from (
      select
        coalesce((select sum(b.balance) from public.account_balances(p_household, p_as_of) b
                   where b.currency_code = 'BRL'), 0) as available,
        coalesce((select sum(x.debt) from public.debt_balances(p_household, p_as_of) x), 0) as debt,
        coalesce((select sum(x.credit_receivable) from public.debt_balances(p_household, p_as_of) x), 0) as cr,
        coalesce((
          select sum(v.total_value * a.household_share / 100)
            from public.family_assets a
            join lateral (
              select x.total_value from public.family_asset_valuations x
               where x.household_id = a.household_id and x.asset_id = a.id
                 and x.valuation_date <= p_as_of
               order by x.valuation_date desc, x.created_at desc limit 1
            ) v on true
           where a.household_id = p_household and a.currency_code = 'BRL'
             and coalesce(a.acquired_on, a.created_at::date) <= p_as_of
             and (a.status = 'active' or (a.status in ('sold','disposed') and a.ended_on > p_as_of))
        ), 0) as family_assets_brl,
        coalesce((select sum(x.planned_remaining) from public.debt_balances(p_household, p_as_of) x), 0) as pc
    ) s
   where (select private.is_member(p_household))
$$;

-- ---------------------------------------------------------------------------
-- 7. Total por moeda (sem conversão): mesma base de account_balances
-- ---------------------------------------------------------------------------
create function public.balance_totals_by_currency(p_household uuid, p_as_of date)
returns table (currency_code text, total numeric, total_active numeric)
language sql stable security invoker set search_path = '' as $$
  select b.currency_code,
         coalesce(sum(b.balance), 0),
         coalesce(sum(b.balance) filter (where b.active), 0)
    from public.account_balances(p_household, p_as_of) b
   where (select private.is_member(p_household))
   group by b.currency_code
   order by (b.currency_code <> 'BRL'), b.currency_code
$$;

revoke execute on function public.account_balances(uuid, date), public.account_balances_projected(uuid, date, boolean),
  public.balance_totals_projected(uuid, date, boolean), public.balance_totals_by_currency(uuid, date)
  from public, anon;
grant execute on function public.account_balances(uuid, date), public.account_balances_projected(uuid, date, boolean),
  public.balance_totals_projected(uuid, date, boolean), public.balance_totals_by_currency(uuid, date)
  to authenticated;
