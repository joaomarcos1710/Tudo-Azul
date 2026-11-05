-- Tudo Azul — migration 061: troca dos dias do cartão sem dois fechamentos no mesmo mês.
--
-- Problema (achado no teste 58, corrigido por decisão do dono em 05/11/2026): a fatura é por MÊS (debt_invoices.label
-- AAAA-MM, card_months agrupa por mês). set_card_cycle mudava os dias na hora; então, num cartão que fechava dia 5
-- (vence 15) e passa a fechar dia 25 (vence 5), a compra de 01/12 ficava na fatura de 05/12 e a de 10/12 caía na de
-- 25/12: duas faturas fundidas numa só ("2026-12", com o fechamento da primeira) e, antes de a fatura existir, um
-- vencimento montado com o maior dia de fechamento e o maior de vencimento das parcelas (15/01, de nenhum dos ciclos).
--
-- Regra nova (opção (b) da análise; a (a), separar a fatura por data de fechamento, foi descartada: mexe em várias
-- funções e na chave das faturas já gravadas para um caso raro — ver 30 - Decisões):
--   * a troca passa a valer a partir do ciclo SEGUINTE ao da fatura aberta hoje. A fatura aberta continua com os dias
--     antigos; a primeira com os dias novos é a do mês seguinte ao dela. Ex.: hoje 01/12, fechava 5 → passa a 25: a
--     aberta fecha em 05/12 (dias antigos) e a seguinte em 25/01 (dias novos); compra entre 05/12 e 24/01 cai em 25/01.
--     Assim cada mês tem um único fechamento.
--   * guardado no cartão: closing_day/due_day = os dias NOVOS (o que a pessoa escolheu); cycle_from = 1º dia do mês da
--     primeira fatura com eles; prev_closing_day/prev_due_day = os dias que valem nas faturas de meses anteriores.
--     Sem troca (cycle_from nulo), tudo como antes.
--   * se mesmo assim ficariam dois fechamentos no mesmo mês — o cartão já tem parcelas (compra parcelada), créditos
--     avulsos ou fatura em mês a partir de cycle_from em data/vencimento do ciclo atual —, set_card_cycle RECUSA
--     (23514) e diz até qual fatura há lançamento, a partir de qual fatura os dias novos podem valer e a partir de que
--     dia a troca pode ser feita.
--   * pedir de novo os dias que valem na fatura aberta desfaz uma troca ainda não iniciada. Primeira definição dos dias
--     (cartão sem ciclo) vale na hora, como antes.
--   * nada já gravado é alterado: parcelas, créditos e faturas ficam onde estão (cada parcela já guarda o próprio ciclo
--     desde a migration 20261017135000).
--
-- Quem calcula o fechamento de uma compra passa a usar o ciclo do MÊS (private.card_cycle_*), recriadas a partir da
-- última versão de cada uma, com o mesmo corpo fora isso:
--   public.set_card_cycle            (20261017120100)
--   public.card_purchase             (20261017135000)
--   public.card_purchase_at          (20261104200100)
--   public.recurrence_materialize    (20261030180100)
--   public.card_credit_income        (20261104210100)
--   private.card_recurrence_pending  (20261105020100)
--   public.card_pending_subscriptions(20261105020100)
-- Não mudam: card_bill_due e card_months (usam o ciclo gravado em cada parcela), card_invoices_due,
-- card_invoices_month, card_limits, debt_pay (leem card_months/debt_invoices).
--
-- Teste: 59_card_cycle_change (falha sem esta migration).

-- ---------------------------------------------------------------------------
-- 1. Colunas da troca
-- ---------------------------------------------------------------------------
alter table public.debts
  add column cycle_from       date,
  add column prev_closing_day smallint,
  add column prev_due_day     smallint,
  add constraint debts_cycle_change check (
        (cycle_from is null) = (prev_closing_day is null)
    and (cycle_from is null) = (prev_due_day is null)
    and (cycle_from is null or (closing_day is not null
                                and extract(day from cycle_from) = 1
                                and prev_closing_day between 1 and 31 and prev_due_day between 1 and 31)));

-- ---------------------------------------------------------------------------
-- 2. Calendário do ciclo por mês (funções puras: só leem os argumentos)
-- ---------------------------------------------------------------------------
-- Executáveis por authenticated porque card_recurrence_pending e card_pending_subscriptions rodam como o chamador.
-- Por isso o "dia no mês" é escrito aqui em vez de chamar private.card_day_in_month (que authenticated não executa).

-- Dia de fechamento / de vencimento que vale na fatura do mês de p_month.
create function private.card_cycle_closing_day(p_d public.debts, p_month date) returns integer
language sql immutable set search_path = '' as $$
  select case when p_d.cycle_from is not null and date_trunc('month', p_month)::date < p_d.cycle_from
              then p_d.prev_closing_day else p_d.closing_day end
$$;

create function private.card_cycle_due_day(p_d public.debts, p_month date) returns integer
language sql immutable set search_path = '' as $$
  select case when p_d.cycle_from is not null and date_trunc('month', p_month)::date < p_d.cycle_from
              then p_d.prev_due_day else p_d.due_day end
$$;

-- Fechamento da fatura do mês de p_month (em mês mais curto, o último dia).
create function private.card_cycle_closing(p_d public.debts, p_month date) returns date
language sql immutable set search_path = '' as $$
  select make_date(extract(year from p_month)::int, extract(month from p_month)::int,
                   least(private.card_cycle_closing_day(p_d, p_month),
                         extract(day from (date_trunc('month', p_month) + interval '1 month - 1 day'))::int))
$$;

-- Fechamento da fatura em que cai uma compra feita em p_date: a do mês, se a compra é antes do fechamento dele; no dia
-- do fechamento ou depois, a do mês seguinte (mesma regra de private.card_first_closing, com o dia de cada mês).
create function private.card_cycle_first(p_d public.debts, p_date date) returns date
language sql immutable set search_path = '' as $$
  select case when p_date < private.card_cycle_closing(p_d, p_date) then private.card_cycle_closing(p_d, p_date)
              else private.card_cycle_closing(p_d, (date_trunc('month', p_date) + interval '1 month')::date) end
$$;

-- Vencimento da fatura que fecha em p_closing, com os dias do mês dela (mesma regra de private.card_due_date).
create function private.card_cycle_due(p_d public.debts, p_closing date) returns date
language sql immutable set search_path = '' as $$
  select make_date(extract(year from b)::int, extract(month from b)::int,
                   least(private.card_cycle_due_day(p_d, p_closing), extract(day from (b + interval '1 month - 1 day'))::int))
    from (select (date_trunc('month', p_closing)
                  + case when private.card_cycle_due_day(p_d, p_closing) > private.card_cycle_closing_day(p_d, p_closing)
                         then interval '0' else interval '1 month' end)::date as b) x
$$;

revoke execute on function
  private.card_cycle_closing_day(public.debts, date), private.card_cycle_due_day(public.debts, date),
  private.card_cycle_closing(public.debts, date), private.card_cycle_first(public.debts, date),
  private.card_cycle_due(public.debts, date)
  from public, anon;
grant execute on function
  private.card_cycle_closing_day(public.debts, date), private.card_cycle_due_day(public.debts, date),
  private.card_cycle_closing(public.debts, date), private.card_cycle_first(public.debts, date),
  private.card_cycle_due(public.debts, date)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Trocar os dias (a partir de 20261017120100)
-- ---------------------------------------------------------------------------
create or replace function public.set_card_cycle(p_debt uuid, p_closing_day integer, p_due_day integer)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_d public.debts%rowtype; v_open date; v_oc integer; v_od integer; v_from date; v_last date;
begin
  v_d := private.debt_lock(p_debt);
  if v_d.kind <> 'card' then
    raise exception 'fechamento e vencimento só existem em cartão' using errcode = '23514';
  end if;
  if p_closing_day is null or p_due_day is null
     or p_closing_day not between 1 and 31 or p_due_day not between 1 and 31 then
    raise exception 'dia de fechamento e de vencimento devem estar entre 1 e 31' using errcode = '22023';
  end if;
  -- primeira definição: vale já (não há fatura de outro ciclo)
  if v_d.closing_day is null then
    update public.debts set closing_day = p_closing_day, due_day = p_due_day where id = v_d.id;
    return;
  end if;

  -- a fatura aberta hoje e os dias que valem nela
  v_open := private.card_cycle_first(v_d, private.today_sp());
  v_oc := private.card_cycle_closing_day(v_d, v_open);
  v_od := private.card_cycle_due_day(v_d, v_open);
  if p_closing_day = v_oc and p_due_day = v_od then
    -- são os dias da fatura aberta: desfaz a troca ainda não iniciada, se houver; senão nada muda
    if v_d.cycle_from is not null and v_d.cycle_from > date_trunc('month', v_open)::date then
      update public.debts set closing_day = v_oc, due_day = v_od, cycle_from = null, prev_closing_day = null, prev_due_day = null
       where id = v_d.id;
    end if;
    return;
  end if;

  -- os dias novos valem a partir da fatura do mês seguinte ao da aberta
  v_from := (date_trunc('month', v_open) + interval '1 month')::date;
  -- lançamento já gravado a partir desse mês com fechamento ou vencimento diferente do novo = dois fechamentos no mês
  select max(x.d) into v_last from (
    select i.due_date as d from public.debt_installments i
     where i.household_id = v_d.household_id and i.debt_id = v_d.id and i.due_date >= v_from
       and i.face > coalesce((select sum(e.amount) from public.debt_events e
                               where e.installment_id = i.id and e.kind = 'cancel' and e.voided_at is null), 0)
       and (i.due_date <> private.card_day_in_month(i.due_date, p_closing_day)
            or private.card_due_date(i.due_date, coalesce(i.closing_day, v_oc), coalesce(i.due_day, v_od))
               <> private.card_due_date(i.due_date, p_closing_day, p_due_day))
    union all
    select e.date from public.debt_events e
     where e.household_id = v_d.household_id and e.debt_id = v_d.id and e.kind = 'income_credit' and e.voided_at is null
       and e.date >= v_from and e.date <> private.card_day_in_month(e.date, p_closing_day)
    union all
    select private.card_day_in_month(to_date(inv.label, 'YYYY-MM'), v_oc) from public.debt_invoices inv
     where inv.household_id = v_d.household_id and inv.debt_id = v_d.id and inv.label ~ '^\d{4}-\d{2}$'
       and to_date(inv.label, 'YYYY-MM') >= v_from
       and inv.due_date is distinct from private.card_due_date(
             private.card_day_in_month(to_date(inv.label, 'YYYY-MM'), p_closing_day), p_closing_day, p_due_day)
  ) x;
  if v_last is not null then
    raise exception 'não dá para trocar os dias agora: o cartão já tem parcelas ou créditos no ciclo atual até a fatura que fecha em %, e com a troca ficariam dois fechamentos no mesmo mês. Os dias novos podem valer a partir da fatura que fecha em %: faça a troca a partir de %.',
      to_char(v_last, 'DD/MM/YYYY'),
      to_char(private.card_day_in_month((date_trunc('month', v_last) + interval '1 month')::date, p_closing_day), 'DD/MM/YYYY'),
      to_char(private.card_cycle_closing(v_d, (date_trunc('month', v_last) - interval '1 month')::date), 'DD/MM/YYYY')
      using errcode = '23514';
  end if;

  update public.debts
     set closing_day = p_closing_day, due_day = p_due_day,
         cycle_from = v_from, prev_closing_day = v_oc, prev_due_day = v_od
   where id = v_d.id;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Compra (a partir de 20261017135000) e compra escolhendo a fatura (a partir de 20261104200100)
-- ---------------------------------------------------------------------------
create or replace function public.card_purchase(p_debt uuid, p_date date, p_total numeric, p_count integer,
                                                p_category uuid, p_description text, p_idem uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_d public.debts%rowtype; v_plan uuid; v_face numeric; v_first numeric; v_closing date; k integer;
  v_refund date; v_m date;
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

  v_closing := private.card_cycle_first(v_d, p_date);
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
    -- cada parcela com o ciclo do mês dela (troca de dias: migration 061)
    v_m := (date_trunc('month', v_closing) + make_interval(months => k))::date;
    insert into public.debt_installments (household_id, debt_id, plan, seq, due_date, face, category_id,
                                          description, purchase_date, closing_day, due_day)
    values (v_d.household_id, v_d.id, v_plan::text, k + 1, private.card_cycle_closing(v_d, v_m),
            case when k = 0 then v_first else v_face end, p_category,
            nullif(btrim(p_description), ''), p_date,
            private.card_cycle_closing_day(v_d, v_m), private.card_cycle_due_day(v_d, v_m));
  end loop;
  perform private.debt_chk(v_d.id);
  return v_plan;
end $$;

create or replace function public.card_purchase_at(p_debt uuid, p_date date, p_total numeric, p_count integer,
                                                   p_category uuid, p_description text, p_invoice_offset integer default 0,
                                                   p_idem uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_d public.debts%rowtype; v_plan uuid; v_face numeric; v_first numeric; v_closing date; k integer;
  v_refund date; v_m date;
begin
  v_d := private.debt_lock(p_debt);
  if v_d.kind <> 'card' then
    raise exception 'compra parcelada só existe em cartão' using errcode = '23514';
  end if;
  if v_d.closing_day is null then
    raise exception 'defina o dia de fechamento e de vencimento do cartão antes de lançar compras'
      using errcode = '55000';
  end if;
  if p_idem is not null and exists (select 1 from public.debt_installments i
       where i.household_id = v_d.household_id and i.debt_id = v_d.id and i.plan = p_idem::text) then
    return p_idem;
  end if;
  if p_date is null or p_count is null or p_count not between 1 and 72
     or p_total is null or p_total <= 0 or p_total >= 1e12
     or p_invoice_offset is null or p_invoice_offset not between -3 and 3 then
    raise exception 'parâmetros inválidos' using errcode = '22023';
  end if;
  if p_total <> round(p_total, 2) then
    raise exception 'valor com mais de 2 casas decimais: %', p_total using errcode = '22003';
  end if;
  v_face  := trunc(p_total / p_count, 2);
  v_first := p_total - v_face * (p_count - 1);
  if v_face <= 0 then
    raise exception 'valor pequeno demais para % parcelas', p_count using errcode = '22023';
  end if;

  v_closing := private.card_cycle_first(v_d, p_date);
  v_closing := private.card_cycle_closing(v_d, (date_trunc('month', v_closing) + make_interval(months => p_invoice_offset))::date);
  -- o que fecha até a data de referência já está no saldo de referência
  if v_closing <= v_d.reference_date then
    raise exception 'esta fatura fecha em %, até o início do cartão (%): recue o início do cartão', v_closing, v_d.reference_date
      using errcode = '23514';
  end if;
  select max(e.date) into v_refund from public.debt_events e
   where e.debt_id = v_d.id and e.kind = 'refund_cash' and e.voided_at is null;
  if v_refund is not null and v_closing <= v_refund then
    raise exception 'esta compra fecharia em % , antes de uma devolução já lançada em %: exclua a devolução ou escolha outra fatura',
      v_closing, v_refund using errcode = '23514';
  end if;

  v_plan := coalesce(p_idem, gen_random_uuid());
  for k in 0 .. p_count - 1 loop
    v_m := (date_trunc('month', v_closing) + make_interval(months => k))::date;
    insert into public.debt_installments (household_id, debt_id, plan, seq, due_date, face, category_id,
                                          description, purchase_date, closing_day, due_day)
    values (v_d.household_id, v_d.id, v_plan::text, k + 1, private.card_cycle_closing(v_d, v_m),
            case when k = 0 then v_first else v_face end, p_category,
            nullif(btrim(p_description), ''), p_date,
            private.card_cycle_closing_day(v_d, v_m), private.card_cycle_due_day(v_d, v_m));
  end loop;
  perform private.debt_chk(v_d.id);
  return v_plan;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Assinatura de cartão vira parcela (a partir de 20261030180100)
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
        if v_occ > v_d.reference_date then
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
-- 6. Crédito avulso no cartão (a partir de 20261104210100)
-- ---------------------------------------------------------------------------
create or replace function public.card_credit_income(p_debt uuid, p_date date, p_amount numeric, p_category uuid,
                                                     p_description text, p_closing date default null, p_idem uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_d public.debts%rowtype; v_natural date; v_ultima date; v_closing date;
  v_desc text := nullif(btrim(p_description), ''); v_id uuid; v_voided boolean;
begin
  v_d := private.debt_lock(p_debt);
  if v_d.kind <> 'card' then
    raise exception 'crédito avulso só existe em cartão' using errcode = '23514';
  end if;
  if v_d.closing_day is null then
    raise exception 'defina o dia de fechamento e de vencimento do cartão antes de lançar créditos' using errcode = '55000';
  end if;
  if p_date is null or p_amount is null or p_amount <= 0 or p_amount >= 1e12 then
    raise exception 'data ou valor do crédito inválido' using errcode = '22023';
  end if;
  if p_amount <> round(p_amount, 2) then
    raise exception 'valor com mais de 2 casas decimais: %', p_amount using errcode = '22003';
  end if;
  if v_desc is null or char_length(v_desc) > 80 then
    raise exception 'informe a descrição do crédito (até 80 caracteres)' using errcode = '22023';
  end if;
  if p_category is null or not exists (
    select 1 from public.categories c
     where c.household_id = v_d.household_id and c.id = p_category and c.type = 'income' and c.active
  ) then
    raise exception 'categoria de receita inválida ou inativa' using errcode = '23514';
  end if;

  -- fatura natural: a aberta na data do crédito (mesma regra da compra). A escolhida (p_closing) vai da natural até
  -- 3 faturas depois (como a 051 na compra), nunca antes; e tem de ser um fechamento do cartão: o dia do ciclo daquele
  -- mês (troca de dias: migration 061) ou o fechamento de uma fatura que já existe (ciclo antigo)
  v_natural := private.card_cycle_first(v_d, p_date);
  if p_closing is null then
    v_closing := v_natural;
  else
    v_ultima := private.card_cycle_closing(v_d, (date_trunc('month', v_natural) + interval '3 months')::date);
    if p_closing < v_natural or p_closing > v_ultima then
      raise exception 'a fatura escolhida precisa fechar entre % e % (a aberta na data do crédito e até 3 depois)',
        v_natural, v_ultima using errcode = '22023';
    end if;
    if p_closing <> private.card_cycle_closing(v_d, p_closing)
       and not exists (select 1 from public.debt_installments i
                        where i.household_id = v_d.household_id and i.debt_id = v_d.id and i.due_date = p_closing) then
      raise exception 'a data escolhida não é um fechamento deste cartão' using errcode = '22023';
    end if;
    v_closing := p_closing;
  end if;
  -- o que FECHA até a data de referência já está no saldo de referência (mesma trava da compra na 051: vale a data
  -- do fechamento, não a do crédito)
  if v_closing <= v_d.reference_date then
    raise exception 'esta fatura fecha em %, até o início do cartão (%): recue o início do cartão', v_closing, v_d.reference_date
      using errcode = '23514';
  end if;

  -- idempotência: a chave só vale para ESTE crédito. Em qualquer outro evento (deste ou de outro cartão) ela faria
  -- debt_void anular os dois juntos (op_id compartilhado): recusa. Crédito com a mesma chave já ANULADO: recusa em vez
  -- de regravar ou de devolver o anulado como se tivesse gravado (a tela gera chave nova a cada formulário).
  if p_idem is not null then
    if exists (select 1 from public.debt_events e
                where e.household_id = v_d.household_id and e.op_id = p_idem
                  and (e.debt_id <> v_d.id or e.kind <> 'income_credit')) then
      raise exception 'chave de idempotência já usada em outro movimento' using errcode = '22023';
    end if;
    select e.id, e.voided_at is not null into v_id, v_voided from public.debt_events e
     where e.household_id = v_d.household_id and e.debt_id = v_d.id and e.op_id = p_idem and e.kind = 'income_credit'
     order by (e.voided_at is null) desc
     limit 1;
    if found then
      if v_voided then
        raise exception 'esta chave é de um crédito já anulado: lance de novo' using errcode = '22023';
      end if;
      return v_id;
    end if;
  end if;

  insert into public.debt_events (household_id, debt_id, date, kind, amount, category_id, category_type,
                                  credit_date, op_id, note)
  values (v_d.household_id, v_d.id, v_closing, 'income_credit', p_amount, p_category, 'income',
          p_date, p_idem, v_desc)
  returning id into v_id;
  perform private.debt_chk(v_d.id);
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Assinaturas previstas (a partir de 20261105020100; mesmas colunas)
-- ---------------------------------------------------------------------------
create or replace function private.card_recurrence_pending(p_household uuid, p_first date, p_last date)
returns table (category_id uuid, amount numeric, debt_id uuid, occurrence_date date, closing_date date)
language sql stable security invoker set search_path = '' as $$
  select r.category_id, r.amount, r.debt_id, o.occ, c.fecha
    from public.recurrences r
    join public.debts d on d.household_id = r.household_id and d.id = r.debt_id
   cross join lateral private.recurrence_occurrences(r, (date_trunc('month', p_first) - interval '1 month')::date, p_last) o(occ)
   -- mesma regra de recurrence_materialize: a fatura aberta na data da ocorrência, com o ciclo do mês (migration 061)
   cross join lateral (select private.card_cycle_first(d, o.occ) as fecha) c
   where r.household_id = p_household and r.kind = 'card' and r.active and d.closing_day is not null
     and o.occ > d.reference_date
     and c.fecha between p_first and p_last
     and not exists (select 1 from public.debt_installments i
                      where i.recurrence_id = r.id and i.occurrence_date = o.occ)
$$;

-- Vencimento: o da fatura, se já existe (debt_invoices); senão o calculado pelo ciclo do mês dela.
create or replace function public.card_pending_subscriptions(p_household uuid, p_as_of date)
returns table (debt_id uuid, closing_date date, due_date date, total numeric)
language sql stable security invoker set search_path = '' as $$
  select d.id, a.fecha, coalesce(inv.due_date, private.card_cycle_due(d, a.fecha)), s.total
    from public.debts d
   -- no dia do fechamento ou depois, a aberta é a seguinte (mesma regra da compra)
   cross join lateral (select private.card_cycle_first(d, p_as_of) as fecha) a
   cross join lateral (
     select sum(x.amount) as total
       from private.card_recurrence_pending(p_household, a.fecha, a.fecha) x
      where x.debt_id = d.id
   ) s
    left join public.debt_invoices inv
      on inv.household_id = d.household_id and inv.debt_id = d.id and inv.label = to_char(a.fecha, 'YYYY-MM')
   where d.household_id = p_household and d.kind = 'card' and d.closing_day is not null and d.due_day is not null
     and p_as_of is not null and s.total > 0
     and (select private.is_member(p_household))
   order by d.name, d.id
$$;
