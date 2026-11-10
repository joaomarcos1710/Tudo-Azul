-- Tudo Azul — recorrência no cartão estilo Organizze, etapa 4: "só esta" e "esta e as próximas"
--
-- Decisões do dono (10/11/2026, docs/projeto/28): ao mudar o dia ou cancelar uma assinatura de cartão, o app pergunta
-- "só esta" ou "esta e as próximas", como no Organizze (e como já faz para conta, migration 074).
--
-- 1. Quem lê respeita as exceções (item editado, cancelado ou convertido):
--    * private.card_recurrence_pending: a ocorrência que tem item agendado não vem mais da regra; o item scheduled vale
--      com o valor, a data e a fatura dele; cancelada e convertida somem (convertida já é parcela). Mesmas colunas.
--    * public.card_subscription_previews: mesma lógica, e devolve também o id do item, a data de cobrança e se foi
--      editada à mão (precisa recriar a função: ganhou colunas).
--    * public.recurrence_materialize: a geração no dia não cria parcela para ocorrência que já tem item (senão uma
--      cobrança cancelada voltaria sozinha no dia). Só o corpo muda; é a mesma função de 20261105050100.
-- 2. Quem muda (SECURITY DEFINER, só a família de quem chama, só item ainda `scheduled`):
--    * card_scheduled_item_update: "só esta" editar (data, valor, descrição, categoria).
--    * card_scheduled_item_cancel: "só esta" cancelar.
--    * card_scheduled_from_here: "esta e as próximas": encerrar ou mudar. Mudar divide a regra em duas (a antiga termina
--      na véspera desta ocorrência, uma nova começa na data nova), porque parcela é imutável e mudar o dia da mesma regra
--      deslocaria as ocorrências já geradas. O que já virou parcela fica como está.
-- Item já convertido em parcela não muda por aqui (é compra comum): recusa com 55000.
-- Erros: 42501 sem família ou item de outra família; 22023 parâmetro inválido; 22003 mais de 2 casas; 23514 regra de
-- integridade; 55000 o item não está mais agendado.

-- ---------------------------------------------------------------------------
-- 1a. Previstas que respeitam as exceções (mesmas colunas de 20261105140100)
-- ---------------------------------------------------------------------------
create or replace function private.card_recurrence_pending(p_household uuid, p_first date, p_last date)
returns table (category_id uuid, amount numeric, debt_id uuid, occurrence_date date, closing_date date)
language sql stable security invoker set search_path = '' as $$
  select r.category_id, r.amount, r.debt_id, o.occ, c.fecha
    from public.recurrences r
    join public.debts d on d.household_id = r.household_id and d.id = r.debt_id
   cross join lateral (
     select x.occ from private.recurrence_occurrences(r, (date_trunc('month', p_first) - interval '1 month')::date, p_last) x(occ)
      where x.occ > d.reference_date
        and not exists (select 1 from public.debt_installments i
                         where i.recurrence_id = r.id and i.occurrence_date = x.occ)
        and not exists (select 1 from public.card_scheduled_items s
                         where s.recurrence_id = r.id and s.occurrence_date = x.occ)
      offset 0
   ) o
   cross join lateral (select private.card_cycle_first(d, o.occ) as fecha offset 0) c
   where r.household_id = p_household and r.kind = 'card' and r.active and d.closing_day is not null
     and c.fecha between p_first and p_last
  union all
  select s.category_id, s.amount, s.debt_id, s.charge_date, s.closing_date
    from public.card_scheduled_items s
    join public.recurrences r on r.id = s.recurrence_id and r.active
    join public.debts d on d.household_id = s.household_id and d.id = s.debt_id
   where s.household_id = p_household and s.status = 'scheduled' and d.closing_day is not null
     and s.closing_date between p_first and p_last
$$;

-- ---------------------------------------------------------------------------
-- 1b. Lista da fatura: item (editado ou não) quando existe; senão a ocorrência da regra
-- ---------------------------------------------------------------------------
drop function public.card_subscription_previews(uuid, text);
create function public.card_subscription_previews(p_debt uuid, p_label text)
returns table (recurrence_id uuid, occurrence_date date, description text, amount numeric,
               category_id uuid, closing_date date, item_id uuid, charge_date date, edited boolean)
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_d public.debts%rowtype; v_closing date;
begin
  if p_label is null or p_label !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'fatura inválida: use AAAA-MM' using errcode = '22023';
  end if;
  select * into v_d from public.debts where id = p_debt and kind = 'card';
  if not found or v_d.closing_day is null or not (select private.is_member(v_d.household_id)) then
    return;
  end if;
  v_closing := private.card_cycle_closing(v_d, (p_label || '-01')::date);
  return query
  select u.recurrence_id, u.occurrence_date, u.description, u.amount, u.category_id, u.closing_date, u.item_id, u.charge_date, u.edited
    from (
      select r.id as recurrence_id, o.occ as occurrence_date, r.description, r.amount, r.category_id, v_closing as closing_date,
             null::uuid as item_id, o.occ as charge_date, false as edited
        from public.recurrences r
       cross join lateral private.recurrence_occurrences(r, (date_trunc('month', v_closing) - interval '1 month')::date, v_closing) o(occ)
       where r.household_id = v_d.household_id and r.kind = 'card' and r.debt_id = v_d.id and r.active
         and o.occ > v_d.reference_date
         and private.card_cycle_first(v_d, o.occ) = v_closing
         and not exists (select 1 from public.debt_installments i
                          where i.recurrence_id = r.id and i.occurrence_date = o.occ)
         and not exists (select 1 from public.card_scheduled_items s
                          where s.recurrence_id = r.id and s.occurrence_date = o.occ)
      union all
      select s.recurrence_id, s.occurrence_date, s.description, s.amount, s.category_id, s.closing_date,
             s.id, s.charge_date, s.edited
        from public.card_scheduled_items s
        join public.recurrences r on r.id = s.recurrence_id and r.active
       where s.household_id = v_d.household_id and s.debt_id = v_d.id and s.status = 'scheduled'
         and s.closing_date = v_closing
    ) u
   order by u.charge_date, u.description, u.recurrence_id;
end $$;
revoke execute on function public.card_subscription_previews(uuid, text) from public, anon;
grant execute on function public.card_subscription_previews(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 1c. Geração no dia: não cria parcela para ocorrência que já tem item agendado
-- ---------------------------------------------------------------------------
create or replace function public.recurrence_materialize()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_h uuid := private.current_household();
  v_today date := private.today_sp();
  -- sem data final: até o fim do mês daqui a 12 meses
  v_open date := (date_trunc('month', v_today) + interval '13 months - 1 day')::date;
  -- com data final: teto de 360 meses (mensal) e 24 meses (semanal)
  v_cap_mes date := (date_trunc('month', v_today) + interval '361 months - 1 day')::date;
  v_cap_sem date := (date_trunc('month', v_today) + interval '25 months - 1 day')::date;
  r public.recurrences%rowtype; v_d public.debts%rowtype;
  v_occ date; v_until date; v_n integer := 0; v_rows integer; v_closing date;
begin
  if (select auth.uid()) is null or v_h is null then
    raise exception 'não autenticado ou sem família' using errcode = '42501';
  end if;
  for r in select * from public.recurrences where household_id = v_h and active order by id for update loop
    v_until := case
      when r.kind = 'card' then least(v_today, coalesce(r.end_date, v_today))
      when r.end_date is null then v_open
      else least(r.end_date, case when r.freq_unit = 'week' then v_cap_sem else v_cap_mes end)
    end;
    if r.kind = 'card' then
      v_d := private.debt_lock(r.debt_id);
      -- cartão sem ciclo não recebe compra (card_purchase também recusa)
      continue when v_d.closing_day is null;
    end if;
    for v_occ in select * from private.recurrence_occurrences(r, r.start_date, v_until) loop
      if r.kind = 'card' then
        -- etapa 4: ocorrência que já tem item agendado (editada, cancelada ou aguardando a fatura abrir) é do
        -- card_scheduled_convert; a geração do dia só cria a que não tem item (ex.: regra nova que ainda não passou pelo sync)
        if v_occ > v_d.reference_date and not exists (
             select 1 from public.card_scheduled_items s
              where s.recurrence_id = r.id and s.occurrence_date = v_occ) then
          -- ciclo do mês da fatura gravado na parcela, como em card_purchase (troca de dias: migration 061)
          v_closing := private.card_cycle_first(v_d, v_occ);
          insert into public.debt_installments (household_id, debt_id, plan, seq, due_date, face, category_id,
                                                description, purchase_date, closing_day, due_day,
                                                recurrence_id, occurrence_date)
          values (r.household_id, r.debt_id, gen_random_uuid()::text, 1,
                  v_closing, r.amount, r.category_id,
                  r.description, v_occ, private.card_cycle_closing_day(v_d, v_closing),
                  private.card_cycle_due_day(v_d, v_closing), r.id, v_occ)
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
        -- conta desativada ou ainda não aberta: pula a ocorrência (o guard recusaria)
        insert into public.transactions (household_id, account_id, destination_account_id, category_id, type,
                                         description, amount, date, status, created_by, recurrence_id, occurrence_date)
        values (r.household_id, r.account_id, r.destination_account_id, r.category_id, r.kind,
                r.description, r.amount, v_occ, 'planned', r.created_by, r.id, v_occ)
        on conflict (recurrence_id, occurrence_date) where recurrence_id is not null do nothing;
        get diagnostics v_rows = row_count;
        v_n := v_n + v_rows;
      end if;
    end loop;
    if r.kind = 'card' then perform private.debt_chk(r.debt_id); end if;
  end loop;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- 2. "Só esta" e "esta e as próximas"
-- ---------------------------------------------------------------------------
create function private.card_scheduled_check(
  p_household uuid, p_debt public.debts, p_date date, p_amount numeric, p_description text, p_category uuid
) returns date language plpgsql stable security definer set search_path = '' as $$
declare v_desc text := btrim(coalesce(p_description, '')); v_closing date;
begin
  if p_date is null or p_date <= private.today_sp() then
    raise exception 'a data da cobrança precisa ser depois de hoje' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount >= 1e12 then
    raise exception 'valor inválido' using errcode = '22023';
  end if;
  if p_amount <> round(p_amount, 2) then
    raise exception 'valor com mais de 2 casas decimais: %', p_amount using errcode = '22003';
  end if;
  if char_length(v_desc) not between 1 and 80 then
    raise exception 'informe a descrição (até 80 caracteres)' using errcode = '22023';
  end if;
  if p_category is null or not exists (
    select 1 from public.categories c
     where c.household_id = p_household and c.id = p_category and c.type = 'expense' and c.active
  ) then
    raise exception 'categoria de despesa inválida ou inativa' using errcode = '23514';
  end if;
  v_closing := private.card_cycle_first(p_debt, p_date);
  if v_closing <= p_debt.reference_date then
    raise exception 'esta data cai antes do início do cartão (%)', p_debt.reference_date using errcode = '23514';
  end if;
  return v_closing;
end $$;
revoke execute on function private.card_scheduled_check(uuid, public.debts, date, numeric, text, uuid) from public, anon, authenticated;

create function private.card_scheduled_item_lock(p_item uuid) returns public.card_scheduled_items
language plpgsql security definer set search_path = '' as $$
declare v_h uuid := private.current_household(); s public.card_scheduled_items%rowtype;
begin
  if (select auth.uid()) is null or v_h is null then
    raise exception 'não autenticado ou sem família' using errcode = '42501';
  end if;
  select * into s from public.card_scheduled_items where id = p_item and household_id = v_h for update;
  if not found then
    raise exception 'registro não encontrado' using errcode = '42501';
  end if;
  if s.status <> 'scheduled' then
    raise exception 'esta cobrança já não está agendada (%): para mexer, use a compra na fatura', s.status using errcode = '55000';
  end if;
  return s;
end $$;
revoke execute on function private.card_scheduled_item_lock(uuid) from public, anon, authenticated;

create function public.card_scheduled_item_update(
  p_item uuid, p_charge_date date, p_amount numeric, p_description text, p_category uuid
) returns void language plpgsql security definer set search_path = '' as $$
declare s public.card_scheduled_items%rowtype; v_d public.debts%rowtype; v_closing date;
begin
  s := private.card_scheduled_item_lock(p_item);
  v_d := private.debt_lock(s.debt_id);
  v_closing := private.card_scheduled_check(s.household_id, v_d, p_charge_date, p_amount, p_description, p_category);
  update public.card_scheduled_items
     set charge_date = p_charge_date, closing_date = v_closing, amount = round(p_amount, 2),
         description = btrim(p_description), category_id = p_category, edited = true, updated_at = now()
   where id = s.id;
end $$;
revoke execute on function public.card_scheduled_item_update(uuid, date, numeric, text, uuid) from public, anon;
grant execute on function public.card_scheduled_item_update(uuid, date, numeric, text, uuid) to authenticated;

create function public.card_scheduled_item_cancel(p_item uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.card_scheduled_items%rowtype;
begin
  s := private.card_scheduled_item_lock(p_item);
  update public.card_scheduled_items set status = 'cancelled', updated_at = now() where id = s.id;
end $$;
revoke execute on function public.card_scheduled_item_cancel(uuid) from public, anon;
grant execute on function public.card_scheduled_item_cancel(uuid) to authenticated;

-- "Esta e as próximas". p_action = 'end' (encerrar daqui) ou 'update' (mudar daqui em diante; dados novos obrigatórios).
-- Devolve quantos itens agendados foram removidos (esta e as próximas).
create function public.card_scheduled_from_here(
  p_item uuid, p_action text, p_charge_date date default null, p_amount numeric default null,
  p_description text default null, p_category uuid default null
) returns integer language plpgsql security definer set search_path = '' as $$
declare
  s public.card_scheduled_items%rowtype; r public.recurrences%rowtype; v_d public.debts%rowtype;
  v_prev date; v_n integer;
begin
  if p_action is null or p_action not in ('end', 'update') then
    raise exception 'ação inválida: use end ou update' using errcode = '22023';
  end if;
  s := private.card_scheduled_item_lock(p_item);
  r := private.recurrence_lock(s.recurrence_id);
  if r.kind <> 'card' then
    raise exception 'só vale para assinatura de cartão' using errcode = '22023';
  end if;
  v_d := private.debt_lock(s.debt_id);

  -- a ocorrência anterior da regra (já gerada, agendada, cancelada ou convertida)
  select max(x.d) into v_prev from (
    select i.occurrence_date as d from public.card_scheduled_items i
     where i.recurrence_id = r.id and i.occurrence_date < s.occurrence_date
    union all
    select p.occurrence_date from public.debt_installments p
     where p.recurrence_id = r.id and p.occurrence_date < s.occurrence_date
  ) x;

  if p_action = 'update' then
    perform private.card_scheduled_check(s.household_id, v_d, p_charge_date, p_amount, p_description, p_category);
    if v_prev is not null and p_charge_date <= v_prev then
      raise exception 'a data nova precisa ser depois da cobrança anterior (%)', v_prev using errcode = '22023';
    end if;
  end if;

  -- esta e as próximas, ainda agendadas, saem (as já convertidas em parcela ficam)
  delete from public.card_scheduled_items
   where recurrence_id = r.id and status = 'scheduled' and occurrence_date >= s.occurrence_date;
  get diagnostics v_n = row_count;

  if v_prev is null then
    -- nada antes desta: a regra inteira deixa de existir (o que já foi parcela, não há)
    perform set_config('app.card_edit', 'on', true);
    delete from public.recurrences where id = r.id;
    perform set_config('app.card_edit', 'off', true);
  else
    update public.recurrences set end_date = s.occurrence_date - 1 where id = r.id;
  end if;

  if p_action = 'update' then
    perform public.recurrence_create_classified(
      'card', btrim(p_description), round(p_amount, 2),
      case when r.freq_unit = 'month' then extract(day from p_charge_date)::int else null end,
      p_charge_date, null, null, r.debt_id, p_category, r.end_date, r.freq_unit, r.freq_every,
      r.person_id, r.is_shared_expense);
    perform public.card_scheduled_sync();
  end if;
  return v_n;
end $$;
revoke execute on function public.card_scheduled_from_here(uuid, text, date, numeric, text, uuid) from public, anon;
grant execute on function public.card_scheduled_from_here(uuid, text, date, numeric, text, uuid) to authenticated;
