-- Tudo Azul — migration 006: lançamentos recorrentes (contas mensais e assinaturas no cartão)
--
-- Decisões aprovadas em 17/10/2026:
--   * recorrência em tudo: receita, despesa e transferência em conta (aluguel, luz, salário,
--     condomínio) e assinatura no cartão (Netflix, Spotify);
--   * mensal, num dia fixo (1–31); dia que o mês não tem vira o último dia do mês;
--   * valor fixo (estimativa): cada mês é corrigido quando a conta chega;
--   * os próximos 2 meses aparecem como Planejado.
--
-- Como funciona (geração sob demanda, idempotente, sem agendador):
--   recurrence_materialize() é chamada pelo app ao abrir. Para cada regra ativa da família:
--   * conta: cria o lançamento PLANEJADO de cada mês até o fim do mês daqui a 2 meses. O usuário
--     corrige o valor e marca como pago na tela de Lançamentos, como qualquer planejado;
--   * cartão: no dia da ocorrência (nunca antes), cria a compra à vista no cartão, que entra na
--     fatura pela regra de fechamento da migration 004. Antes disso a assinatura aparece só na
--     lista de recorrências: parcela de cartão é imutável, então não se cria com antecedência.
--   O par (regra, data da ocorrência) é único em cada tabela: chamar de novo não duplica, e uma
--   ocorrência excluída (lixeira) não volta.
--
-- Mudar a regra (recurrence_update) vale para os planejados ainda não pagos de hoje em diante.
-- Encerrar (recurrence_end) para de gerar e manda para a lixeira os planejados futuros não pagos.
-- O que já foi pago ou cobrado nunca é alterado pela recorrência.
--
-- Códigos de erro: 22023 parâmetro inválido; 23514 regra de integridade; 42501 sem permissão.

-- ---------------------------------------------------------------------------
-- 1. Tabela de regras
-- ---------------------------------------------------------------------------
create table public.recurrences (
  id                     uuid primary key default gen_random_uuid(),
  household_id           uuid not null references public.households (id) on delete cascade,
  kind                   text not null check (kind in ('income', 'expense', 'transfer', 'card')),
  description            text not null check (char_length(btrim(description)) between 1 and 80),
  amount                 numeric not null check (amount > 0 and amount = round(amount, 2) and amount < 1e12),
  day                    smallint not null check (day between 1 and 31),
  start_date             date not null check (start_date between date '2000-01-01' and date '2100-01-01'),
  end_date               date check (end_date between date '2000-01-01' and date '2100-01-01'),
  account_id             uuid,
  destination_account_id uuid,
  debt_id                uuid,
  category_id            uuid,
  -- tipo da categoria exigido pela FK: receita => income; despesa e cartão => expense
  category_type          text generated always as (case when kind = 'income' then 'income' else 'expense' end) stored,
  active                 boolean not null default true,
  created_by             uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at             timestamptz not null default now(),
  constraint recurrences_shape check (
       (kind in ('income', 'expense') and account_id is not null and destination_account_id is null
          and debt_id is null and category_id is not null)
    or (kind = 'transfer' and account_id is not null and destination_account_id is not null
          and destination_account_id <> account_id and debt_id is null and category_id is null)
    or (kind = 'card' and debt_id is not null and account_id is null and destination_account_id is null
          and category_id is not null)
  ),
  constraint recurrences_end_after_start check (end_date is null or end_date >= start_date),
  constraint recurrences_account_fk foreign key (household_id, account_id)
    references public.accounts (household_id, id) deferrable initially immediate,
  constraint recurrences_destination_fk foreign key (household_id, destination_account_id)
    references public.accounts (household_id, id) deferrable initially immediate,
  constraint recurrences_debt_fk foreign key (household_id, debt_id)
    references public.debts (household_id, id) deferrable initially immediate,
  constraint recurrences_category_fk foreign key (household_id, category_id, category_type)
    references public.categories (household_id, id, type) deferrable initially immediate
);
create index recurrences_hh_idx on public.recurrences (household_id) where active;

-- Ligação das ocorrências com a regra (preenchida só pelas funções; o cliente não tem grant).
alter table public.transactions
  add column recurrence_id   uuid references public.recurrences (id) on delete set null,
  add column occurrence_date date;
create unique index transactions_recurrence_uq on public.transactions (recurrence_id, occurrence_date)
  where recurrence_id is not null;

alter table public.debt_installments
  add column recurrence_id   uuid references public.recurrences (id) on delete set null,
  add column occurrence_date date;
create unique index debt_installments_recurrence_uq on public.debt_installments (recurrence_id, occurrence_date)
  where recurrence_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Segurança: leitura pela RLS; escrita só por RPC
-- ---------------------------------------------------------------------------
grant select on public.recurrences to authenticated;
alter table public.recurrences enable row level security;
create policy recurrences_select on public.recurrences for select to authenticated
  using ((select private.is_member(household_id)));

-- Dinheiro (N2): recusa mais de 2 casas e normaliza.
create function private.recurrences_money_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.amount <> round(new.amount, 2) then
    raise exception 'valor com mais de 2 casas decimais: %', new.amount using errcode = '22003';
  end if;
  new.amount := round(new.amount, 2);
  return new;
end $$;
create trigger recurrences_money_guard before insert or update on public.recurrences
  for each row execute function private.recurrences_money_guard();

revoke execute on function private.recurrences_money_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Operações (RPC)
-- ---------------------------------------------------------------------------
create function private.recurrence_lock(p_id uuid) returns public.recurrences
language plpgsql security definer set search_path = '' as $$
declare v public.recurrences%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'não autenticado' using errcode = '42501';
  end if;
  select * into v from public.recurrences
   where id = p_id and household_id = private.current_household() for update;
  if not found then
    raise exception 'registro não encontrado' using errcode = '42501';
  end if;
  return v;
end $$;
revoke execute on function private.recurrence_lock(uuid) from public, anon, authenticated;

create function public.recurrence_create(p_kind text, p_description text, p_amount numeric, p_day integer,
                                         p_start date, p_account uuid default null, p_destination uuid default null,
                                         p_debt uuid default null, p_category uuid default null, p_end date default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_h uuid := private.current_household(); v_id uuid; v_kind text;
begin
  if (select auth.uid()) is null or v_h is null then
    raise exception 'não autenticado ou sem família' using errcode = '42501';
  end if;
  if p_kind is null or p_day is null or p_day not between 1 and 31 or p_start is null
     or p_amount is null or p_amount <= 0 then
    raise exception 'parâmetros inválidos' using errcode = '22023';
  end if;
  if p_kind = 'card' then
    select kind into v_kind from public.debts where household_id = v_h and id = p_debt;
    if v_kind is distinct from 'card' then
      raise exception 'assinatura só em cartão desta família' using errcode = '23514';
    end if;
  end if;
  insert into public.recurrences (household_id, kind, description, amount, day, start_date, end_date,
                                  account_id, destination_account_id, debt_id, category_id)
  values (v_h, p_kind, btrim(p_description), p_amount, p_day, p_start, p_end,
          p_account, p_destination, p_debt, p_category)
  returning id into v_id;
  return v_id;
end $$;

-- Muda valor, descrição e categoria. Vale para a regra e para os planejados ainda não pagos de hoje
-- em diante (conta). No cartão, vale para as próximas ocorrências (parcela criada é imutável).
create function public.recurrence_update(p_id uuid, p_description text, p_amount numeric, p_category uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.recurrences%rowtype;
begin
  v := private.recurrence_lock(p_id);
  if p_amount is null or p_amount <= 0 then
    raise exception 'parâmetros inválidos' using errcode = '22023';
  end if;
  update public.recurrences
     set description = btrim(p_description), amount = p_amount,
         category_id = case when v.kind = 'transfer' then null else coalesce(p_category, v.category_id) end
   where id = v.id;
  update public.transactions
     set description = btrim(p_description), amount = p_amount,
         category_id = case when v.kind = 'transfer' then null else coalesce(p_category, v.category_id) end
   where recurrence_id = v.id and status = 'planned' and deleted_at is null and date >= private.today_sp();
end $$;

-- Encerra a regra: última ocorrência possível em p_end (padrão: hoje). Planejados não pagos depois
-- dessa data vão para a lixeira (podem ser restaurados).
create function public.recurrence_end(p_id uuid, p_end date default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.recurrences%rowtype; v_end date;
begin
  v := private.recurrence_lock(p_id);
  v_end := greatest(coalesce(p_end, private.today_sp()), v.start_date);
  update public.recurrences set end_date = v_end, active = false where id = v.id;
  update public.transactions set deleted_at = now()
   where recurrence_id = v.id and status = 'planned' and deleted_at is null and date > v_end;
end $$;

-- Gera as ocorrências que faltam de todas as regras ativas da família. Devolve quantas criou.
create function public.recurrence_materialize()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_h uuid := private.current_household();
  v_today date := private.today_sp();
  -- conta: até o fim do mês daqui a 2 meses
  v_horizon date := (date_trunc('month', v_today) + interval '3 months - 1 day')::date;
  r public.recurrences%rowtype; v_d public.debts%rowtype;
  v_month date; v_occ date; v_until date; v_n integer := 0; v_rows integer;
begin
  if (select auth.uid()) is null or v_h is null then
    raise exception 'não autenticado ou sem família' using errcode = '42501';
  end if;
  for r in select * from public.recurrences where household_id = v_h and active order by id for update loop
    v_until := least(case when r.kind = 'card' then v_today else v_horizon end, coalesce(r.end_date, v_horizon));
    if r.kind = 'card' then
      v_d := private.debt_lock(r.debt_id);
      -- cartão sem ciclo não recebe compra (card_purchase também recusa)
      continue when v_d.closing_day is null;
    end if;
    v_month := date_trunc('month', r.start_date)::date;
    while v_month <= v_until loop
      v_occ := private.card_day_in_month(v_month, r.day);
      if v_occ >= r.start_date and v_occ <= v_until then
        if r.kind = 'card' then
          if v_occ > v_d.reference_date then
            insert into public.debt_installments (household_id, debt_id, plan, seq, due_date, face, category_id,
                                                  description, purchase_date, recurrence_id, occurrence_date)
            values (r.household_id, r.debt_id, gen_random_uuid()::text, 1,
                    private.card_first_closing(v_occ, v_d.closing_day), r.amount, r.category_id,
                    r.description, v_occ, r.id, v_occ)
            on conflict (recurrence_id, occurrence_date) where recurrence_id is not null do nothing;
            get diagnostics v_rows = row_count;
            v_n := v_n + v_rows;
          end if;
        elsif exists (select 1 from public.accounts a
                       where a.household_id = r.household_id and a.active and a.opening_date <= v_occ
                         and a.id = r.account_id)
              and (r.destination_account_id is null or exists (
                     select 1 from public.accounts a
                      where a.household_id = r.household_id and a.active and a.opening_date <= v_occ
                        and a.id = r.destination_account_id)) then
          -- conta desativada ou ainda não aberta: pula o mês (o guard recusaria)
          insert into public.transactions (household_id, account_id, destination_account_id, category_id, type,
                                           description, amount, date, status, created_by, recurrence_id, occurrence_date)
          values (r.household_id, r.account_id, r.destination_account_id, r.category_id, r.kind,
                  r.description, r.amount, v_occ, 'planned', r.created_by, r.id, v_occ)
          on conflict (recurrence_id, occurrence_date) where recurrence_id is not null do nothing;
          get diagnostics v_rows = row_count;
          v_n := v_n + v_rows;
        end if;
      end if;
      v_month := (v_month + interval '1 month')::date;
    end loop;
    if r.kind = 'card' then perform private.debt_chk(r.debt_id); end if;
  end loop;
  return v_n;
end $$;

revoke execute on function
  public.recurrence_create(text, text, numeric, integer, date, uuid, uuid, uuid, uuid, date),
  public.recurrence_update(uuid, text, numeric, uuid), public.recurrence_end(uuid, date),
  public.recurrence_materialize()
  from public, anon;
grant execute on function
  public.recurrence_create(text, text, numeric, integer, date, uuid, uuid, uuid, uuid, date),
  public.recurrence_update(uuid, text, numeric, uuid), public.recurrence_end(uuid, date),
  public.recurrence_materialize()
  to authenticated;
