-- Tudo Azul — migration 137: gasto por dia e ritmo de UMA fatura de cartão (somente leitura)
--
-- Pedido do dono (17/11/2026): "nos cartões tem um botão de categoria; a gente conseguiria criar um botão com os gastos do
-- dia, mostrando quanto está gastando por dia". Escolheu as duas leituras: barras por dia e o ritmo (média por dia,
-- projeção do fechamento e comparação com a fatura anterior no mesmo ponto do ciclo). O front não soma dinheiro de
-- relatório: os totais, a média e a projeção saem daqui.
--
-- Ciclo da fatura: do dia seguinte ao fechamento da fatura anterior (card_months) até o fechamento desta. Sem fatura
-- anterior, um mês antes do fechamento. Base = public.card_items(cartão, rótulo), a mesma lista da fatura e de
-- card_invoice_categories (líquido da parcela: valor − cancelado − estornado).
--   * compra do ciclo: purchase_date dentro do ciclo, no dia da compra;
--   * "já vinha": parcela de compra de antes do ciclo (o 3/10), sem data de compra (parcela antiga) ou com data depois do
--     fechamento (compra lançada para uma fatura seguinte). Fica à parte (carried): senão viraria um pico falso num dia.
-- Não entram (como em card_invoice_categories): crédito avulso (receita) e assinatura prevista ainda não lançada.
--
-- public.card_invoice_daily(p_debt, p_label): um dia por linha, do início do ciclo ao fechamento, com o gasto do dia
--   (compras do ciclo; 0 nos dias sem compra) e o acumulado; carried repetido em cada linha (o front só mostra).
-- public.card_invoice_pace(p_debt, p_label, p_today): uma linha com o ciclo, os dias passados (até p_today, no máximo o
--   ciclo inteiro), o gasto do ciclo até p_today, o que já vinha, a média por dia, a projeção do fechamento
--   (já vinha + gasto até hoje / dias passados × dias do ciclo; com o ciclo encerrado, já vinha + gasto do ciclo) e a
--   fatura anterior no mesmo dia do ciclo (gasto do ciclo dela até o mesmo número de dias). Média e projeção com 2 casas.
--   Antes do início do ciclo: dias passados 0, média e projeção nulas.
-- SECURITY INVOKER: a RLS do chamador decide; cartão de outra família, rótulo inexistente ou dívida que não é cartão: vazio.
-- Teste: 129_card_invoice_daily (falha sem esta migration).

create function public.card_invoice_daily(p_debt uuid, p_label text)
returns table (day date, amount numeric, cumulative numeric, carried numeric)
language sql stable security invoker set search_path = '' as $$
  with fatura as (
    select m.closing_date as fecha,
           coalesce((select max(a.closing_date) from public.card_months(p_debt) a where a.label < p_label),
                    (m.closing_date - interval '1 month')::date) + 1 as inicio
      from public.card_months(p_debt) m
     where m.label = p_label
  ), itens as (
    select x.purchase_date, x.face from public.card_items(p_debt, p_label) x
  ), dias as (
    select g::date as d from fatura f, generate_series(f.inicio, f.fecha, interval '1 day') g
  ), por_dia as (
    select d.d, coalesce(sum(i.face), 0) as v
      from dias d left join itens i on i.purchase_date = d.d
     group by d.d
  )
  select p.d, p.v, sum(p.v) over (order by p.d),
         coalesce((select sum(i.face) from itens i, fatura f
                    where i.purchase_date is null or i.purchase_date < f.inicio or i.purchase_date > f.fecha), 0)
    from por_dia p
   order by p.d
$$;

create function public.card_invoice_pace(p_debt uuid, p_label text, p_today date)
returns table (cycle_start date, closing_date date, days_total integer, days_elapsed integer, spent numeric, carried numeric,
               per_day numeric, projected numeric, previous_label text, previous_spent numeric)
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_inicio date; v_fecha date; v_total integer; v_passados integer; v_gasto numeric; v_veio numeric; v_ant text;
begin
  if p_today is null then
    raise exception 'data de hoje obrigatória' using errcode = '22023';
  end if;
  select min(d.day), max(d.day), count(*)::integer, max(d.carried),
         coalesce(sum(d.amount) filter (where d.day <= p_today), 0)
    into v_inicio, v_fecha, v_total, v_veio, v_gasto
    from public.card_invoice_daily(p_debt, p_label) d;
  if v_total is null or v_total = 0 then return; end if;
  v_passados := greatest(0, least(v_total, (p_today - v_inicio) + 1));
  select max(a.label) into v_ant from public.card_months(p_debt) a where a.label < p_label;

  cycle_start := v_inicio; closing_date := v_fecha; days_total := v_total; days_elapsed := v_passados;
  spent := v_gasto; carried := v_veio; previous_label := v_ant;
  per_day := case when v_passados > 0 then round(v_gasto / v_passados, 2) end;
  projected := case when v_passados = 0 then null
                    when v_passados >= v_total then v_veio + v_gasto
                    else v_veio + round(v_gasto * v_total / v_passados, 2) end;
  previous_spent := case when v_ant is null or v_passados = 0 then null else
    (select coalesce(sum(d.amount), 0) from (
       select d.amount, row_number() over (order by d.day) as n from public.card_invoice_daily(p_debt, v_ant) d) d
      where d.n <= v_passados) end;
  return next;
end $$;

revoke execute on function public.card_invoice_daily(uuid, text), public.card_invoice_pace(uuid, text, date) from public, anon;
grant execute on function public.card_invoice_daily(uuid, text), public.card_invoice_pace(uuid, text, date) to authenticated;
