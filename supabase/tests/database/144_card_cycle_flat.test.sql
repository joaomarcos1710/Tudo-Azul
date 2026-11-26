-- 144_card_cycle_flat: migration 150. card_cycle_closing, card_cycle_first e card_cycle_due fazem a conta numa expressão
-- só (sem chamar outra função: era o que deixava cada chamada mais de 40 vezes mais lenta) e devolvem EXATAMENTE o que
-- a fórmula antiga devolvia.
--   * a fórmula antiga está copiada aqui (pg_temp.antiga_*), e a comparação roda numa grade de cartões (dias de
--     fechamento e vencimento, com e sem troca de dias da 061) por dois anos de datas;
--   * as três funções não chamam mais nenhuma private.card_cycle_* (falha sem a migration).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- A fórmula antiga, como estava na migration 20261105050100 (as duas "_day" continuam existindo e iguais)
create function pg_temp.antiga_closing(p_d public.debts, p_month date) returns date language sql immutable as $f$
  select make_date(extract(year from p_month)::int, extract(month from p_month)::int,
                   least(private.card_cycle_closing_day(p_d, p_month),
                         extract(day from (date_trunc('month', p_month) + interval '1 month - 1 day'))::int))
$f$;
create function pg_temp.antiga_first(p_d public.debts, p_date date) returns date language sql immutable as $f$
  select case when p_date < pg_temp.antiga_closing(p_d, p_date) then pg_temp.antiga_closing(p_d, p_date)
              else pg_temp.antiga_closing(p_d, (date_trunc('month', p_date) + interval '1 month')::date) end
$f$;
create function pg_temp.antiga_due(p_d public.debts, p_closing date) returns date language sql immutable as $f$
  select make_date(extract(year from b)::int, extract(month from b)::int,
                   least(private.card_cycle_due_day(p_d, p_closing), extract(day from (b + interval '1 month - 1 day'))::int))
    from (select (date_trunc('month', p_closing)
                  + case when private.card_cycle_due_day(p_d, p_closing) > private.card_cycle_closing_day(p_d, p_closing)
                         then interval '0' else interval '1 month' end)::date as b) x
$f$;

-- Grade de cartões: fechamento x vencimento, sem troca de dias e com troca em 01/06/2026 (dois jeitos de dias antigos)
create temp table cartoes as
  select jsonb_populate_record(null::public.debts, jsonb_build_object(
           'closing_day', f, 'due_day', v, 'cycle_from', t.cycle_from,
           'prev_closing_day', t.prev_f, 'prev_due_day', t.prev_v)) as d,
         f, v, t.rotulo
    from unnest(array[1, 10, 18, 28, 31]) f
   cross join unnest(array[1, 5, 10, 28, 31]) v
   cross join (values (null::date, null::int, null::int, 'sem troca'),
                      ('2026-06-01'::date, 10, 20, 'troca, antes 10/20'),
                      ('2026-06-01'::date, 28, 5, 'troca, antes 28/5')) t(cycle_from, prev_f, prev_v, rotulo);
-- dois anos, um dia sim e dois não, mais todos os fins e começos de mês (onde o limite do dia importa)
create temp table datas as
  select g::date as dia from generate_series('2026-01-01'::date, '2027-12-31'::date, interval '3 days') g
  union
  select (m + o)::date from generate_series('2026-01-01'::date, '2027-12-01'::date, interval '1 month') m
   cross join unnest(array[interval '0', interval '1 month - 1 day', interval '1 month - 2 days']) o;

select is((select count(*)::int from cartoes), 75, 'grade: 75 cartões');
select ok((select count(*) from datas) > 280, 'grade: mais de 280 datas');

select is((select count(*)::int from cartoes c cross join datas x
            where private.card_cycle_closing(c.d, x.dia) is distinct from pg_temp.antiga_closing(c.d, x.dia)), 0,
  'card_cycle_closing: igual à fórmula antiga em toda a grade');
select is((select count(*)::int from cartoes c cross join datas x
            where private.card_cycle_first(c.d, x.dia) is distinct from pg_temp.antiga_first(c.d, x.dia)), 0,
  'card_cycle_first: igual à fórmula antiga em toda a grade');
select is((select count(*)::int from cartoes c cross join datas x
            where private.card_cycle_due(c.d, x.dia) is distinct from pg_temp.antiga_due(c.d, x.dia)), 0,
  'card_cycle_due: igual à fórmula antiga em toda a grade');

-- valores conhecidos, para a grade não ser a única prova
select is(private.card_cycle_closing((select d from cartoes where f = 18 and v = 28 and rotulo = 'sem troca'), '2026-11-05'),
  '2026-11-18'::date, 'fecha 18: novembro fecha em 18/11');
select is(private.card_cycle_first((select d from cartoes where f = 18 and v = 28 and rotulo = 'sem troca'), '2026-11-18'),
  '2026-12-18'::date, 'compra no dia do fechamento já é da fatura seguinte');
select is(private.card_cycle_due((select d from cartoes where f = 18 and v = 28 and rotulo = 'sem troca'), '2026-11-18'),
  '2026-11-28'::date, 'fecha 18, vence 28: vence no mesmo mês');
select is(private.card_cycle_due((select d from cartoes where f = 28 and v = 5 and rotulo = 'sem troca'), '2026-12-28'),
  '2027-01-05'::date, 'fecha 28, vence 5: vence no mês seguinte, virando o ano');
select is(private.card_cycle_closing((select d from cartoes where f = 31 and v = 10 and rotulo = 'sem troca'), '2027-02-10'),
  '2027-02-28'::date, 'fecha 31 em fevereiro: último dia do mês');
select is(private.card_cycle_due((select d from cartoes where f = 18 and v = 28 and rotulo = 'troca, antes 10/20'), '2026-05-10'),
  '2026-05-20'::date, 'antes da troca de dias valem os dias antigos');

-- sem chamadas aninhadas: é o que tornava cada chamada lenta (cada função com set search_path replanejava as de dentro)
select is((select string_agg(p.proname, ', ' order by p.proname)
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'private' and p.proname in ('card_cycle_closing', 'card_cycle_first', 'card_cycle_due')
              and p.prosrc ~ 'card_cycle_'), null,
  'as três funções não chamam outra função de ciclo');

select * from finish();
rollback;
