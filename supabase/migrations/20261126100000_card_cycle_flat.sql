-- Migration 150: as funções de ciclo do cartão sem chamadas aninhadas.
--
-- Medição em produção (26/11/2026, depois da 149): get_home_decision_month levava 1,1 s, e metade era
-- dashboard_commitment_matrix (560 ms). Dentro dela, quase tudo estava em duas funções pequenas:
--     private.card_cycle_due    1.335 µs por chamada
--     private.card_cycle_first    363 µs por chamada
-- contra 9 µs de private.card_cycle_closing_day, que faz uma conta parecida. A diferença: as duas chamam outras funções
-- SQL (card_cycle_closing, card_cycle_closing_day, card_cycle_due_day), e cada uma tem "set search_path". Trocar o
-- search_path na entrada de cada função aninhada joga fora o plano guardado, então cada chamada replanejava três ou
-- quatro consultas. Com 183 assinaturas agendadas e dezenas de ocorrências, eram centenas de chamadas por tela.
--
-- O que muda: card_cycle_closing, card_cycle_first e card_cycle_due passam a fazer a mesma conta numa expressão só, sem
-- chamar outra função. Mesma assinatura, mesmo resultado para qualquer cartão e qualquer data (o teste 144 compara com a
-- fórmula antiga numa grade de cartões e datas). As duas funções "_day" ficam como estão e continuam valendo para quem as
-- chama direto.
--
-- A regra, que não muda (migration 061): se o cartão trocou de dias (cycle_from) e o mês é anterior à troca, valem os
-- dias antigos (prev_closing_day/prev_due_day); senão os atuais. O dia é limitado ao último dia do mês. O vencimento cai
-- no mês do fechamento quando o dia de vencimento é maior que o de fechamento; senão, no mês seguinte.

create or replace function private.card_cycle_closing(p_d public.debts, p_month date) returns date
language sql immutable set search_path = '' as $$
  select make_date(extract(year from p_month)::int, extract(month from p_month)::int,
                   least(case when p_d.cycle_from is not null and date_trunc('month', p_month)::date < p_d.cycle_from
                              then p_d.prev_closing_day else p_d.closing_day end,
                         extract(day from (date_trunc('month', p_month) + interval '1 month - 1 day'))::int))
$$;

create or replace function private.card_cycle_first(p_d public.debts, p_date date) returns date
language sql immutable set search_path = '' as $$
  select case when p_date < a.fecha then a.fecha else b.fecha end
    from (
      -- fechamento do mês da data
      select make_date(extract(year from p_date)::int, extract(month from p_date)::int,
                       least(case when p_d.cycle_from is not null and date_trunc('month', p_date)::date < p_d.cycle_from
                                  then p_d.prev_closing_day else p_d.closing_day end,
                             extract(day from (date_trunc('month', p_date) + interval '1 month - 1 day'))::int)) as fecha
    ) a
    cross join (
      -- fechamento do mês seguinte
      select make_date(extract(year from m.mes)::int, extract(month from m.mes)::int,
                       least(case when p_d.cycle_from is not null and date_trunc('month', m.mes)::date < p_d.cycle_from
                                  then p_d.prev_closing_day else p_d.closing_day end,
                             extract(day from (date_trunc('month', m.mes) + interval '1 month - 1 day'))::int)) as fecha
        from (select (date_trunc('month', p_date) + interval '1 month')::date as mes) m
    ) b
$$;

create or replace function private.card_cycle_due(p_d public.debts, p_closing date) returns date
language sql immutable set search_path = '' as $$
  select make_date(extract(year from x.b)::int, extract(month from x.b)::int,
                   least(x.dia_venc, extract(day from (x.b + interval '1 month - 1 day'))::int))
    from (
      select y.dia_venc,
             (date_trunc('month', p_closing)
              + case when y.dia_venc > y.dia_fecha then interval '0' else interval '1 month' end)::date as b
        from (
          select case when p_d.cycle_from is not null and date_trunc('month', p_closing)::date < p_d.cycle_from
                      then p_d.prev_due_day else p_d.due_day end as dia_venc,
                 case when p_d.cycle_from is not null and date_trunc('month', p_closing)::date < p_d.cycle_from
                      then p_d.prev_closing_day else p_d.closing_day end as dia_fecha
        ) y
    ) x
$$;
