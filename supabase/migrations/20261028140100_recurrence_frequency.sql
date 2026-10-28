-- Tudo Azul — migration 016: frequências de recorrência (semanal, quinzenal, mensal, bimestral, trimestral,
-- semestral, anual e personalizada)
--
-- Antes: toda regra era mensal num dia fixo, e essa regra estava escrita em DOIS lugares —
-- recurrence_materialize (gera as ocorrências) e private.card_recurrence_pending (projeção/orçamento das
-- assinaturas de cartão ainda sem parcela). Agora a série de datas sai de UMA função,
-- private.recurrence_occurrences, usada pelos dois.
--
-- Modelo: freq_unit ('month' | 'week') + freq_every (meses 1–12; semanas 1–4).
--   Semanal = week/1 · Quinzenal (14 dias) = week/2 · Mensal = month/1 · Bimestral = month/2
--   Trimestral = month/3 · Semestral = month/6 · Anual = month/12 · Personalizada = a cada X semanas ou meses.
--
-- Regras de calendário:
--   * Mês: âncora no DIA fixo (day), nunca na ocorrência anterior (não "escorrega"). Meses da série: o mês de
--     start_date + k×N. Dia que o mês não tem = último dia do mês (mesma regra de sempre): mensal dia 31 →
--     31/01, 28/02 (29/02 no bissexto), 31/03, 30/04; anual dia 29 a partir de fev/2028 → 29/02/2028,
--     28/02/2029 … 29/02/2032. A primeira ocorrência é a primeira data da série >= start_date.
--   * Semana: âncora em start_date (o dia da semana sai dela); start_date + k×7×N. day fica nulo.
--   * end_date: última ocorrência possível (como antes).
--
-- Compatibilidade: as regras existentes ficam month/1 (padrão das colunas) e geram EXATAMENTE as mesmas datas
-- (teste RF1 compara com a fórmula antiga). Frequência, dia e início não mudam depois de criados — a proteção
-- contra duplicação (único (recurrence_id, occurrence_date)) depende de a série ser sempre a mesma. Para mudar
-- a frequência: encerrar a regra e criar outra.
--
-- Regra iniciada no passado (decisão de 28/10/2026): a MENSAL continua gerando desde start_date (como sempre);
-- as frequências NOVAS geram a partir do dia do cadastro (em São Paulo), para uma semanal antiga não criar
-- dezenas de planejados atrasados de uma vez.
--
-- recurrence_create ganha p_freq_unit e p_freq_every (opcionais, padrão mensal). A versão antiga é removida
-- (DROP FUNCTION, nenhum dado envolvido): com as duas, o PostgREST não saberia qual chamar. Quem chama sem os
-- parâmetros novos (o app atual) continua criando regra mensal.
--
-- Nenhuma migration anterior é editada (create or replace / drop + create aqui).

-- ---------------------------------------------------------------------------
-- 1. Colunas
-- ---------------------------------------------------------------------------
alter table public.recurrences
  add column freq_unit  text     not null default 'month',
  add column freq_every smallint not null default 1;

alter table public.recurrences alter column day drop not null;

alter table public.recurrences add constraint recurrences_frequency check (
     (freq_unit = 'month' and freq_every between 1 and 12 and day is not null)
  or (freq_unit = 'week'  and freq_every between 1 and 4  and day is null)
);

-- ---------------------------------------------------------------------------
-- 2. A série de datas (fonte única)
-- ---------------------------------------------------------------------------
-- Datas de ocorrência da regra r dentro de [p_from, p_to], respeitando início, fim e, nas frequências novas,
-- o dia do cadastro. Não lê tabela (stable só por causa do fuso): SECURITY INVOKER e executável pelo cliente, porque
-- card_recurrence_pending (SECURITY INVOKER, chamada pela projeção) a usa.
create function private.recurrence_occurrences(r public.recurrences, p_from date, p_to date)
returns setof date language sql stable set search_path = '' as $$
  with lim as (
    select greatest(p_from, r.start_date,
                    case when r.freq_unit = 'month' and r.freq_every = 1 then r.start_date
                         else (r.created_at at time zone 'America/Sao_Paulo')::date end) as de,
           least(p_to, coalesce(r.end_date, p_to)) as ate
  )
  select o.d
    from lim
   cross join lateral (
     -- mês: k-ésimo mês da série a partir do mês de start_date; dia limitado ao último do mês
     select make_date(extract(year from m.mes)::int, extract(month from m.mes)::int,
                      least(r.day, extract(day from (m.mes + interval '1 month - 1 day'))::int)) as d
       from generate_series(0, ((extract(year from lim.ate)::int * 12 + extract(month from lim.ate)::int)
                               - (extract(year from r.start_date)::int * 12 + extract(month from r.start_date)::int))
                               / r.freq_every) k
      cross join lateral (select (date_trunc('month', r.start_date) + make_interval(months => k * r.freq_every))::date as mes) m
      where r.freq_unit = 'month'
     union all
     -- semana: start_date + k×7×N
     select r.start_date + k * 7 * r.freq_every
       from generate_series(0, greatest(-1, (lim.ate - r.start_date) / (7 * r.freq_every))) k
      where r.freq_unit = 'week'
   ) o
   where o.d between lim.de and lim.ate
   order by o.d
$$;
revoke execute on function private.recurrence_occurrences(public.recurrences, date, date) from public, anon;
grant execute on function private.recurrence_occurrences(public.recurrences, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Geração (mesma lógica da migration 006; só a série de datas mudou de lugar)
-- ---------------------------------------------------------------------------
create or replace function public.recurrence_materialize()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_h uuid := private.current_household();
  v_today date := private.today_sp();
  -- conta: até o fim do mês daqui a 2 meses
  v_horizon date := (date_trunc('month', v_today) + interval '3 months - 1 day')::date;
  r public.recurrences%rowtype; v_d public.debts%rowtype;
  v_occ date; v_until date; v_n integer := 0; v_rows integer;
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
    for v_occ in select * from private.recurrence_occurrences(r, r.start_date, v_until) loop
      if r.kind = 'card' then
        if v_occ > v_d.reference_date then
          -- ciclo gravado na parcela, como em card_purchase (migration 20261017135000)
          insert into public.debt_installments (household_id, debt_id, plan, seq, due_date, face, category_id,
                                                description, purchase_date, closing_day, due_day,
                                                recurrence_id, occurrence_date)
          values (r.household_id, r.debt_id, gen_random_uuid()::text, 1,
                  private.card_first_closing(v_occ, v_d.closing_day), r.amount, r.category_id,
                  r.description, v_occ, v_d.closing_day, v_d.due_day, r.id, v_occ)
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
-- 4. Projeção das assinaturas de cartão (mesma série de datas)
-- ---------------------------------------------------------------------------
-- Ocorrências de recorrência de CARTÃO ainda sem parcela cuja fatura fecha dentro de [p_first, p_last].
-- Candidatas: do 1º dia do mês anterior a p_first até p_last (a fatura de um mês pega compras do mês anterior).
create or replace function private.card_recurrence_pending(p_household uuid, p_first date, p_last date)
returns table (category_id uuid, amount numeric)
language sql stable security invoker set search_path = '' as $$
  select r.category_id, r.amount
    from public.recurrences r
    join public.debts d on d.household_id = r.household_id and d.id = r.debt_id
   cross join lateral private.recurrence_occurrences(r, (date_trunc('month', p_first) - interval '1 month')::date, p_last) o(occ)
   cross join lateral (
     select make_date(extract(year from o.occ)::int, extract(month from o.occ)::int,
                      least(d.closing_day, extract(day from (date_trunc('month', o.occ) + interval '1 month - 1 day'))::int)) as fecha_mes,
            (date_trunc('month', o.occ) + interval '1 month')::date as prox
   ) f
   cross join lateral (
     select case when o.occ < f.fecha_mes then f.fecha_mes
                 else make_date(extract(year from f.prox)::int, extract(month from f.prox)::int,
                                least(d.closing_day, extract(day from (f.prox + interval '1 month - 1 day'))::int)) end as fecha
   ) c
   where r.household_id = p_household and r.kind = 'card' and r.active and d.closing_day is not null
     and o.occ > d.reference_date
     and c.fecha between p_first and p_last
     and not exists (select 1 from public.debt_installments i
                      where i.recurrence_id = r.id and i.occurrence_date = o.occ)
$$;

-- ---------------------------------------------------------------------------
-- 5. Cadastro com frequência
-- ---------------------------------------------------------------------------
drop function public.recurrence_create(text, text, numeric, integer, date, uuid, uuid, uuid, uuid, date);

create function public.recurrence_create(p_kind text, p_description text, p_amount numeric, p_day integer,
                                         p_start date, p_account uuid default null, p_destination uuid default null,
                                         p_debt uuid default null, p_category uuid default null, p_end date default null,
                                         p_freq_unit text default 'month', p_freq_every integer default 1)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_h uuid := private.current_household(); v_id uuid; v_kind text;
begin
  if (select auth.uid()) is null or v_h is null then
    raise exception 'não autenticado ou sem família' using errcode = '42501';
  end if;
  if p_kind is null or p_start is null or p_amount is null or p_amount <= 0
     or p_freq_unit is null or p_freq_every is null
     -- coalesce: com p_day nulo a comparação dá null, e "not null" deixaria passar
     or not coalesce((p_freq_unit = 'month' and p_freq_every between 1 and 12 and p_day between 1 and 31)
                  or (p_freq_unit = 'week' and p_freq_every between 1 and 4), false) then
    raise exception 'parâmetros inválidos' using errcode = '22023';
  end if;
  if p_kind = 'card' then
    select kind into v_kind from public.debts where household_id = v_h and id = p_debt;
    if v_kind is distinct from 'card' then
      raise exception 'assinatura só em cartão desta família' using errcode = '23514';
    end if;
  end if;
  insert into public.recurrences (household_id, kind, description, amount, day, start_date, end_date,
                                  account_id, destination_account_id, debt_id, category_id, freq_unit, freq_every)
  values (v_h, p_kind, btrim(p_description), p_amount,
          case when p_freq_unit = 'week' then null else p_day end, p_start, p_end,
          p_account, p_destination, p_debt, p_category, p_freq_unit, p_freq_every)
  returning id into v_id;
  return v_id;
end $$;

revoke execute on function
  public.recurrence_create(text, text, numeric, integer, date, uuid, uuid, uuid, uuid, date, text, integer)
  from public, anon;
grant execute on function
  public.recurrence_create(text, text, numeric, integer, date, uuid, uuid, uuid, uuid, date, text, integer)
  to authenticated;
