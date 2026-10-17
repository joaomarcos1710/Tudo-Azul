-- Tudo Azul — migration 004: ciclo do cartão (fechamento e vencimento) e compra parcelada
--
-- Decisão aprovada em 17/10/2026 (proposta docs/PROPOSTA-CARTAO-RECORRENCIA.md, item A1):
--   cada parcela entra na fatura pela DATA DE FECHAMENTO do cartão, e é nessa data que vira despesa.
--   Exemplo: cartão fecha dia 17, compra em 3x no dia 15 => 1ª parcela na fatura que fecha em 17 deste
--   mês, 2ª na que fecha em 17 do mês seguinte, e assim por diante.
--   Compra NO DIA do fechamento (ou depois) vai para a fatura seguinte (o "melhor dia de compra").
--
-- O que esta migration acrescenta (nada é alterado nem apagado nas migrations 001–003):
--   1. debts.closing_day / debts.due_day: dia de fechamento e de vencimento, só em cartão.
--   2. debt_installments.description / purchase_date: o que foi comprado e quando (para a tela).
--   3. set_card_cycle: define ou muda o ciclo do cartão (parcelas já criadas não mudam: são imutáveis).
--   4. card_purchase: grava a compra parcelada já com a data de fechamento de cada parcela; o resto
--      dos centavos fica na 1ª parcela (regra do §5 do modelo de dados).
--   5. card_bill_due: cobra (debt_bill) as parcelas cujo fechamento já chegou, criando a fatura do mês
--      quando preciso. Idempotente: chamar de novo não duplica nada. O app chama ao abrir.
--
-- Despesa e compromisso, com as funções já existentes:
--   * antes do fechamento a parcela é compromisso (period_summary: "planejado" no mês do fechamento);
--   * no fechamento vira cobrança: despesa do mês e dívida do cartão;
--   * o pagamento da fatura (debt_pay) sai da conta e reduz a dívida, sem ser despesa.
--
-- Códigos de erro: 22023 parâmetro inválido; 23514 regra de integridade; 55000 estado não permite.

-- ---------------------------------------------------------------------------
-- 1. Colunas novas
-- ---------------------------------------------------------------------------
alter table public.debts
  add column closing_day smallint,
  add column due_day     smallint,
  add constraint debts_cycle_days check (
        (closing_day is null) = (due_day is null)
    and (closing_day is null or (closing_day between 1 and 31 and due_day between 1 and 31))),
  add constraint debts_cycle_card_only check (closing_day is null or kind = 'card');

alter table public.debt_installments
  add column description   text check (char_length(btrim(description)) between 1 and 80),
  add column purchase_date date check (purchase_date between date '2000-01-01' and date '2100-01-01');

-- ---------------------------------------------------------------------------
-- 2. Calendário do cartão (funções puras)
-- ---------------------------------------------------------------------------
-- Dia p_day do mês de p_month; em mês mais curto, o último dia (fecha dia 31 => 28/02, 30/04...).
create function private.card_day_in_month(p_month date, p_day integer) returns date
language sql immutable set search_path = '' as $$
  select make_date(extract(year from p_month)::int, extract(month from p_month)::int,
                   least(p_day, extract(day from (date_trunc('month', p_month) + interval '1 month - 1 day'))::int))
$$;

-- Fechamento da fatura em que cai uma compra feita em p_purchase.
-- Compra antes do fechamento do mês: fatura deste mês. No dia do fechamento ou depois: a seguinte.
create function private.card_first_closing(p_purchase date, p_closing_day integer) returns date
language sql immutable set search_path = '' as $$
  select case when p_purchase < private.card_day_in_month(p_purchase, p_closing_day)
              then private.card_day_in_month(p_purchase, p_closing_day)
              else private.card_day_in_month((date_trunc('month', p_purchase) + interval '1 month')::date, p_closing_day)
         end
$$;

-- Vencimento da fatura que fecha em p_closing. Vencimento depois do fechamento no calendário
-- (fecha 17, vence 25): mesmo mês. Senão (fecha 28, vence 5): mês seguinte.
create function private.card_due_date(p_closing date, p_closing_day integer, p_due_day integer) returns date
language sql immutable set search_path = '' as $$
  select case when p_due_day > p_closing_day
              then private.card_day_in_month(p_closing, p_due_day)
              else private.card_day_in_month((date_trunc('month', p_closing) + interval '1 month')::date, p_due_day)
         end
$$;

-- Hoje no fuso da família (o banco roda em UTC; às 22h de Brasília já seria "amanhã").
create function private.today_sp() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'America/Sao_Paulo')::date
$$;

revoke execute on function
  private.card_day_in_month(date, integer), private.card_first_closing(date, integer),
  private.card_due_date(date, integer, integer), private.today_sp()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Operações (RPC)
-- ---------------------------------------------------------------------------
create function public.set_card_cycle(p_debt uuid, p_closing_day integer, p_due_day integer)
returns void language plpgsql security definer set search_path = '' as $$
declare v_d public.debts%rowtype;
begin
  v_d := private.debt_lock(p_debt);
  if v_d.kind <> 'card' then
    raise exception 'fechamento e vencimento só existem em cartão' using errcode = '23514';
  end if;
  if p_closing_day is null or p_due_day is null
     or p_closing_day not between 1 and 31 or p_due_day not between 1 and 31 then
    raise exception 'dia de fechamento e de vencimento devem estar entre 1 e 31' using errcode = '22023';
  end if;
  update public.debts set closing_day = p_closing_day, due_day = p_due_day where id = v_d.id;
end $$;

-- Compra no cartão em p_count parcelas. Devolve o identificador da compra (plan das parcelas).
create function public.card_purchase(p_debt uuid, p_date date, p_total numeric, p_count integer,
                                     p_category uuid, p_description text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_d public.debts%rowtype; v_plan uuid := gen_random_uuid();
  v_face numeric; v_first numeric; v_closing date; k integer;
begin
  v_d := private.debt_lock(p_debt);
  if v_d.kind <> 'card' then
    raise exception 'compra parcelada só existe em cartão' using errcode = '23514';
  end if;
  if v_d.closing_day is null then
    raise exception 'defina o dia de fechamento e de vencimento do cartão antes de lançar compras'
      using errcode = '55000';
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

  -- parcelas iguais em centavos; o resto vai na 1ª (ex.: 100,00 em 3x = 33,34 + 33,33 + 33,33)
  v_face  := trunc(p_total / p_count, 2);
  v_first := p_total - v_face * (p_count - 1);
  if v_face <= 0 then
    raise exception 'valor pequeno demais para % parcelas', p_count using errcode = '22023';
  end if;

  v_closing := private.card_first_closing(p_date, v_d.closing_day);
  for k in 0 .. p_count - 1 loop
    insert into public.debt_installments (household_id, debt_id, plan, seq, due_date, face, category_id,
                                          description, purchase_date)
    values (v_d.household_id, v_d.id, v_plan::text, k + 1,
            private.card_day_in_month((date_trunc('month', v_closing) + make_interval(months => k))::date, v_d.closing_day),
            case when k = 0 then v_first else v_face end, p_category,
            nullif(btrim(p_description), ''), p_date);
  end loop;
  perform private.debt_chk(v_d.id);
  return v_plan;
end $$;

-- Cobra as parcelas de todos os cartões da família cujo fechamento já chegou (até p_until, nunca
-- além de hoje). Cada cobrança é datada no fechamento e ligada à fatura do mês (criada se faltar).
-- Idempotente: só cobra o que ainda resta da parcela. Devolve quantas cobranças criou.
create function public.card_bill_due(p_until date default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_h uuid := private.current_household();
  v_until date := least(coalesce(p_until, private.today_sp()), private.today_sp());
  v_card uuid; v_d public.debts%rowtype; r record; v_inv uuid; v_label text; v_n integer := 0;
begin
  if (select auth.uid()) is null or v_h is null then
    raise exception 'não autenticado ou sem família' using errcode = '42501';
  end if;
  for v_card in select id from public.debts
                 where household_id = v_h and kind = 'card' and closing_day is not null
                 order by id loop
    v_d := private.debt_lock(v_card);
    for r in
      select i.id, i.due_date,
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
              private.card_due_date(r.due_date, v_d.closing_day, v_d.due_day))
      on conflict (household_id, debt_id, label) do nothing;
      select id into v_inv from public.debt_invoices
       where household_id = v_d.household_id and debt_id = v_d.id and label = v_label;
      insert into public.debt_events (household_id, debt_id, date, kind, amount, installment_id, invoice_id, note)
      values (v_d.household_id, v_d.id, r.due_date, 'charge', r.rem, r.id, v_inv, 'fechamento da fatura');
      v_n := v_n + 1;
    end loop;
    perform private.debt_chk(v_d.id);
  end loop;
  return v_n;
end $$;

revoke execute on function
  public.set_card_cycle(uuid, integer, integer),
  public.card_purchase(uuid, date, numeric, integer, uuid, text),
  public.card_bill_due(date)
  from public, anon;
grant execute on function
  public.set_card_cycle(uuid, integer, integer),
  public.card_purchase(uuid, date, numeric, integer, uuid, text),
  public.card_bill_due(date)
  to authenticated;
