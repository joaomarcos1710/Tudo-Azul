-- Tudo Azul — migration 048: lançamento parcelado fora do cartão e recorrência em dias.
-- Pedido do dono (04/11/2026), a partir do Organizze: "Repetir → Lançamento parcelado" (N parcelas, sobra na
-- primeira) e o período "Dias".
--
-- 1. Recorrência a cada N dias (freq_unit = 'day', 1–365): a série é start_date + k×N, como a semanal.
-- 2. Parcelado: public.transaction_installments_create cria as N parcelas de uma vez (todas ou nenhuma), com o
--    valor dividido em centavos exatos e a sobra somada à PRIMEIRA. Cada parcela é um lançamento comum
--    (receita, despesa ou transferência) marcado com o grupo e "k/N"; nada muda em saldo e relatórios, que já
--    contam lançamentos. Só a RPC grava as colunas novas (o cliente não tem INSERT/UPDATE nelas).

-- 1. recorrência em dias -----------------------------------------------------
alter table public.recurrences drop constraint recurrences_frequency;
alter table public.recurrences add constraint recurrences_frequency check (
     (freq_unit = 'month' and freq_every between 1 and 12  and day is not null)
  or (freq_unit = 'week'  and freq_every between 1 and 4   and day is null)
  or (freq_unit = 'day'   and freq_every between 1 and 365 and day is null)
);

create or replace function private.recurrence_occurrences(r public.recurrences, p_from date, p_to date)
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
     union all
     -- dia: start_date + k×N
     select r.start_date + k * r.freq_every
       from generate_series(0, greatest(-1, (lim.ate - r.start_date) / r.freq_every)) k
      where r.freq_unit = 'day'
   ) o
   where o.d between lim.de and lim.ate
   order by o.d
$$;

create or replace function public.recurrence_create(p_kind text, p_description text, p_amount numeric, p_day integer,
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
                  or (p_freq_unit = 'week' and p_freq_every between 1 and 4)
                  or (p_freq_unit = 'day' and p_freq_every between 1 and 365), false) then
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
          case when p_freq_unit = 'month' then p_day end, p_start, p_end,
          p_account, p_destination, p_debt, p_category, p_freq_unit, p_freq_every)
  returning id into v_id;
  return v_id;
end $$;

-- 2. parcelado ---------------------------------------------------------------
alter table public.transactions
  add column installment_group  uuid,
  add column installment_number smallint,
  add column installment_count  smallint,
  add constraint transactions_installment check (
       (installment_group is null and installment_number is null and installment_count is null)
    or (installment_group is not null and installment_count between 2 and 360
        and installment_number between 1 and installment_count)
  );
create index transactions_installment_group_idx on public.transactions (household_id, installment_group)
  where installment_group is not null;

-- Cria as N parcelas. Valor: floor(total/N) em centavos em cada uma e a sobra na primeira (10,00 em 3 = 3,34 + 3,33 + 3,33).
-- Datas: a cada N dias, semanas ou meses a partir da primeira; no mês, o dia da primeira (limitado ao último dia do mês).
-- p_first_paid: a primeira já paga (as outras sempre planejadas). Devolve o id do grupo.
create function public.transaction_installments_create(
  p_kind text, p_description text, p_total numeric, p_count integer, p_unit text, p_every integer, p_first date,
  p_account uuid, p_destination uuid default null, p_category uuid default null, p_first_paid boolean default false
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_h uuid := private.current_household();
  v_g uuid := gen_random_uuid();
  v_cents bigint; v_base bigint; v_k integer; v_d date; v_desc text := btrim(coalesce(p_description, ''));
begin
  if (select auth.uid()) is null or v_h is null then
    raise exception 'não autenticado ou sem família' using errcode = '42501';
  end if;
  if p_kind not in ('income', 'expense', 'transfer') or p_total is null or p_total <= 0 or p_total <> round(p_total, 2)
     or p_count is null or p_count not between 2 and 360 or p_first is null or p_every is null
     or not coalesce((p_unit = 'month' and p_every between 1 and 12) or (p_unit = 'week' and p_every between 1 and 4)
                  or (p_unit = 'day' and p_every between 1 and 365), false)
     or v_desc = '' or char_length(v_desc) > 190 then
    raise exception 'parâmetros inválidos' using errcode = '22023';
  end if;
  v_cents := (p_total * 100)::bigint;
  v_base := v_cents / p_count;
  if v_base < 1 then
    raise exception 'valor pequeno demais para % parcelas', p_count using errcode = '22023';
  end if;
  for v_k in 0 .. p_count - 1 loop
    v_d := case p_unit
      when 'day'  then p_first + v_k * p_every
      when 'week' then p_first + v_k * 7 * p_every
      else (select make_date(extract(year from m)::int, extract(month from m)::int,
                             least(extract(day from p_first)::int, extract(day from (m + interval '1 month - 1 day'))::int))
              from (select (date_trunc('month', p_first) + make_interval(months => v_k * p_every))::date as m) x)
    end;
    insert into public.transactions (household_id, account_id, destination_account_id, category_id, type, description,
                                     amount, date, status, installment_group, installment_number, installment_count)
    values (v_h, p_account, case when p_kind = 'transfer' then p_destination end,
            case when p_kind = 'transfer' then null else p_category end, p_kind,
            v_desc || ' ' || (v_k + 1) || '/' || p_count,
            (case when v_k = 0 then v_cents - v_base * (p_count - 1) else v_base end)::numeric / 100,
            v_d, case when v_k = 0 and p_first_paid then 'paid' else 'planned' end, v_g, v_k + 1, p_count);
  end loop;
  return v_g;
end $$;

revoke execute on function public.transaction_installments_create(text, text, numeric, integer, text, integer, date, uuid, uuid, uuid, boolean)
  from public, anon;
grant execute on function public.transaction_installments_create(text, text, numeric, integer, text, integer, date, uuid, uuid, uuid, boolean)
  to authenticated;
