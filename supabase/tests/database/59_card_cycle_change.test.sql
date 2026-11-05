-- 59_card_cycle_change: migration 061. Troca dos dias do cartão sem dois fechamentos no mesmo mês: a troca vale a
-- partir do ciclo seguinte ao da fatura aberta hoje; se ainda assim houver lançamento do ciclo atual num mês em que os
-- dias novos valeriam (ex.: compra parcelada), set_card_cycle recusa com mensagem clara. A regra depende de HOJE, então
-- as datas esperadas são calculadas a partir de hoje em São Paulo: O = fechamento da fatura aberta hoje com o dia 5
-- (ciclo antigo: fecha 5, vence 15); m(k, dia) = o dia no mês de O + k. Dias usados (5, 10, 15, 20, 25) existem em
-- todo mês, então não há ajuste de fim de mês.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create temp table fixture (k text primary key, v uuid);
create temp table datas (k text primary key, d date);
grant all on fixture, datas to public;
create function pg_temp.fx(p_k text) returns uuid language sql as $f$ select v from fixture where k = p_k $f$;
create function pg_temp.dt(p_k text) returns date language sql as $f$ select d from datas where k = p_k $f$;
create function pg_temp.login(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $f$;
create function pg_temp.msg_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate || ' ' || sqlerrm; end $f$;
create function pg_temp.hoje() returns date language sql stable as $f$ select (now() at time zone 'America/Sao_Paulo')::date $f$;
-- dia p_day do mês de O + p_k
create function pg_temp.m(p_k int, p_day int) returns date language sql as $f$
  select (date_trunc('month', pg_temp.dt('O')) + make_interval(months => p_k, days => p_day - 1))::date $f$;
create function pg_temp.br(p_d date) returns text language sql as $f$ select to_char(p_d, 'DD/MM/YYYY') $f$;
-- fechamentos das parcelas de uma compra
create function pg_temp.fecha(p_card uuid, p_desc text) returns date[] language sql as $f$
  select array_agg(due_date order by seq) from public.debt_installments where debt_id = p_card and description = p_desc $f$;
-- faturas do cartão: mês|fechamento|vencimento|total|itens
create function pg_temp.faturas(p_card uuid) returns text[] language sql as $f$
  select coalesce(array_agg(label || '|' || closing_date || '|' || due_date || '|' || total::numeric(14,2) || '|' || items order by label), '{}')
    from public.card_months(p_card) $f$;
-- quantos meses do cartão têm mais de um fechamento entre as parcelas vivas
create function pg_temp.fundidas(p_card uuid) returns bigint language sql as $f$
  select count(*) from (select 1 from public.debt_installments where debt_id = p_card
                         group by to_char(due_date, 'YYYY-MM') having count(distinct due_date) > 1) x $f$;
grant execute on function pg_temp.fx(text), pg_temp.dt(text), pg_temp.login(uuid), pg_temp.msg_of(text), pg_temp.hoje(),
  pg_temp.m(int, int), pg_temp.br(date), pg_temp.fecha(uuid, text), pg_temp.faturas(uuid), pg_temp.fundidas(uuid) to public;

-- O: a fatura aberta hoje num cartão que fecha dia 5 (função do ciclo da migration 004, que esta migration não muda)
insert into datas select 'O', private.card_first_closing(pg_temp.hoje(), 5);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000059a1', 'ciclo@teste.com');
select pg_temp.login('00000000-0000-0000-0000-0000000059a1');
insert into fixture select 'h', public.create_household('Casa do Ciclo');
insert into fixture select 'cat', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';
insert into fixture select 'rec', id from public.categories where household_id = pg_temp.fx('h') and type = 'income' and active limit 1;

-- ---------------------------------------------------------------------------
-- 1. O caso do achado: fechava 5/vencia 15, passa a 25/5, compras antes e depois da troca
-- ---------------------------------------------------------------------------
insert into fixture select 'cy', public.create_debt('Cartão Ciclo', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('cy'), 5, 15);
select public.card_purchase(pg_temp.fx('cy'), pg_temp.hoje(), 100.00, 1, pg_temp.fx('cat'), 'Antes');
select public.set_card_cycle(pg_temp.fx('cy'), 25, 5);
-- depois da troca: hoje (ainda a fatura aberta), no dia seguinte ao fechamento dela e no 1º dia do mês seguinte
select public.card_purchase(pg_temp.fx('cy'), pg_temp.hoje(), 10.00, 1, pg_temp.fx('cat'), 'Hoje');
select public.card_purchase(pg_temp.fx('cy'), pg_temp.dt('O') + 1, 40.00, 1, pg_temp.fx('cat'), 'Depois');
select public.card_purchase(pg_temp.fx('cy'), pg_temp.m(1, 1), 7.00, 1, pg_temp.fx('cat'), 'Mês seguinte');

select is(pg_temp.fecha(pg_temp.fx('cy'), 'Antes') || pg_temp.fecha(pg_temp.fx('cy'), 'Hoje'), array[pg_temp.dt('O'), pg_temp.dt('O')],
          'CY1 a fatura aberta hoje continua com os dias antigos: antes e depois da troca, a compra de hoje fecha em O');
select is(pg_temp.fecha(pg_temp.fx('cy'), 'Depois') || pg_temp.fecha(pg_temp.fx('cy'), 'Mês seguinte'), array[pg_temp.m(1, 25), pg_temp.m(1, 25)],
          'CY2 compra no dia seguinte ao fechamento O vai para a primeira fatura do ciclo novo (dia 25 do mês seguinte), não para o dia 25 do mês de O');
select is(pg_temp.fundidas(pg_temp.fx('cy')), 0::bigint, 'CY3 (a) nenhum mês com dois fechamentos');
select is(pg_temp.faturas(pg_temp.fx('cy')),
          array[to_char(pg_temp.dt('O'), 'YYYY-MM') || '|' || pg_temp.dt('O') || '|' || pg_temp.m(0, 15) || '|110.00|2',
                to_char(pg_temp.m(1, 1), 'YYYY-MM') || '|' || pg_temp.m(1, 25) || '|' || pg_temp.m(2, 5) || '|47.00|2'],
          'CY4 (a)+(b) duas faturas separadas: O vence dia 15 do mesmo mês (ciclo antigo) e a do dia 25 vence dia 5 do mês seguinte (ciclo novo)');
select is((select array_agg(closing_day || '/' || due_day order by due_date, description) from public.debt_installments where debt_id = pg_temp.fx('cy')),
          array['5/15', '5/15', '25/5', '25/5'], 'CY5 cada parcela grava o ciclo da fatura dela');

-- compra parcelada feita hoje, depois da troca: 1ª parcela no ciclo antigo (O), as seguintes no novo
select public.card_purchase(pg_temp.fx('cy'), pg_temp.hoje(), 90.00, 3, pg_temp.fx('cat'), 'Parcelada');
select is(pg_temp.fecha(pg_temp.fx('cy'), 'Parcelada'), array[pg_temp.dt('O'), pg_temp.m(1, 25), pg_temp.m(2, 25)],
          'CY6 parcelada de hoje: O, depois dia 25 dos meses seguintes');
-- escolhendo a fatura seguinte (card_purchase_at +1): a primeira do ciclo novo
select public.card_purchase_at(pg_temp.fx('cy'), pg_temp.hoje(), 5.00, 1, pg_temp.fx('cat'), 'Escolhida', 1);
select is(pg_temp.fecha(pg_temp.fx('cy'), 'Escolhida'), array[pg_temp.m(1, 25)], 'CY7 compra com fatura +1: dia 25 do mês seguinte');
select is(pg_temp.fundidas(pg_temp.fx('cy')), 0::bigint, 'CY8 ainda nenhum mês com dois fechamentos');

-- crédito avulso no dia seguinte ao fechamento O: fatura natural = a primeira do ciclo novo
select public.card_credit_income(pg_temp.fx('cy'), pg_temp.dt('O') + 1, 3.00, pg_temp.fx('rec'), 'Cashback');
select is((select date from public.debt_events where debt_id = pg_temp.fx('cy') and kind = 'income_credit'), pg_temp.m(1, 25),
          'CY9 crédito avulso depois de O cai na fatura do dia 25 do mês seguinte');
select is(pg_temp.msg_of(format($$select public.card_credit_income(%L, %L, 1.00, %L, 'x', %L)$$,
                                pg_temp.fx('cy'), pg_temp.hoje(), pg_temp.fx('rec'), pg_temp.m(2, 5))),
          '22023 a data escolhida não é um fechamento deste cartão',
          'CY10 o dia 5 do ciclo antigo não é mais fechamento depois da troca');

-- assinatura que ainda não virou parcela: prevista na fatura do ciclo novo, com o vencimento dele
select public.recurrence_create('card', 'Streaming', 50.00, extract(day from pg_temp.dt('O') + 2)::int, pg_temp.dt('O') + 2,
                                null, null, pg_temp.fx('cy'), pg_temp.fx('cat'));
select is((select closing_date || '|' || due_date || '|' || total::numeric(14,2)
             from public.card_pending_subscriptions(pg_temp.fx('h'), pg_temp.dt('O')) where debt_id = pg_temp.fx('cy')),
          pg_temp.m(1, 25) || '|' || pg_temp.m(2, 5) || '|100.00',
          'CY11 em O a aberta é a do dia 25 do mês seguinte (vence dia 5): duas ocorrências do streaming (50 + 50)');

-- assinatura cobrada hoje (recurrence_materialize): fica na fatura aberta, com o ciclo antigo
select public.recurrence_create('card', 'Jornal', 8.00, extract(day from pg_temp.hoje())::int, pg_temp.hoje(),
                                null, null, pg_temp.fx('cy'), pg_temp.fx('cat'));
select public.recurrence_materialize();
select is((select due_date || '|' || closing_day || '/' || due_day from public.debt_installments
            where debt_id = pg_temp.fx('cy') and description = 'Jornal'),
          pg_temp.dt('O') || '|5/15', 'CY12 assinatura de hoje vira parcela na fatura aberta O, com os dias antigos');
select is(pg_temp.fundidas(pg_temp.fx('cy')), 0::bigint, 'CY13 no fim, nenhum mês com dois fechamentos');

-- ---------------------------------------------------------------------------
-- 2. Recusa: o ciclo atual já tem parcelas nos meses em que os dias novos valeriam
-- ---------------------------------------------------------------------------
insert into fixture select 'p', public.create_debt('Cartão Parcelado', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('p'), 5, 15);
select public.card_purchase(pg_temp.fx('p'), pg_temp.hoje(), 300.00, 3, pg_temp.fx('cat'), 'TV');
select is(pg_temp.msg_of(format('select public.set_card_cycle(%L, 25, 5)', pg_temp.fx('p'))),
          format('23514 não dá para trocar os dias agora: o cartão já tem parcelas ou créditos no ciclo atual até a fatura que fecha em %s, e com a troca ficariam dois fechamentos no mesmo mês. Os dias novos podem valer a partir da fatura que fecha em %s: faça a troca a partir de %s.',
                 pg_temp.br(pg_temp.m(2, 5)), pg_temp.br(pg_temp.m(3, 25)), pg_temp.br(pg_temp.m(1, 5))),
          'RC1 parcelas em O, dia 5 e dia 5 dos dois meses seguintes: recusa e explica as datas');
select is(pg_temp.msg_of(format('select public.set_card_cycle(%L, 5, 20)', pg_temp.fx('p'))) like '23514 não dá para trocar os dias agora:%', true,
          'RC2 só o vencimento: também recusa (o vencimento da fatura ficaria misturado)');
select is((select closing_day || '/' || due_day || '|' || coalesce(cycle_from::text, '-') from public.debts where id = pg_temp.fx('p')), '5/15|-',
          'RC3 nada mudou no cartão');
-- parcela cancelada não conta: cancelando as duas últimas, a troca passa
select public.debt_refund((select id from public.debt_installments where debt_id = pg_temp.fx('p') and seq = 2), pg_temp.hoje(), 100.00);
select public.debt_refund((select id from public.debt_installments where debt_id = pg_temp.fx('p') and seq = 3), pg_temp.hoje(), 100.00);
select is(pg_temp.msg_of(format('select public.set_card_cycle(%L, 25, 5)', pg_temp.fx('p'))), null, 'RC4 sem parcela viva nos meses seguintes: aceita');
select is((select closing_day || '/' || due_day || '|' || cycle_from || '|' || prev_closing_day || '/' || prev_due_day from public.debts where id = pg_temp.fx('p')),
          '25/5|' || pg_temp.m(1, 1) || '|5/15', 'RC5 grava os dias novos, o mês em que passam a valer e os antigos');

-- ---------------------------------------------------------------------------
-- 3. Desfazer, corrigir de novo e primeira definição
-- ---------------------------------------------------------------------------
insert into fixture select 'u', public.create_debt('Cartão Volta', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('u'), 5, 15);
select public.set_card_cycle(pg_temp.fx('u'), 25, 5);
select public.set_card_cycle(pg_temp.fx('u'), 5, 15);
select is((select closing_day || '/' || due_day || '|' || coalesce(cycle_from::text, '-') from public.debts where id = pg_temp.fx('u')), '5/15|-',
          'DF1 voltar aos dias da fatura aberta desfaz a troca que ainda não começou');
select public.card_purchase(pg_temp.fx('u'), pg_temp.dt('O') + 1, 10.00, 1, pg_temp.fx('cat'), 'Volta');
select is(pg_temp.fecha(pg_temp.fx('u'), 'Volta'), array[pg_temp.m(1, 5)], 'DF2 e o ciclo antigo segue valendo (dia 5 do mês seguinte)');
-- a compra de DF2 é do ciclo antigo num mês em que os dias novos valeriam: trocar agora é recusado
select is(pg_temp.msg_of(format('select public.set_card_cycle(%L, 25, 5)', pg_temp.fx('u'))) like '23514 não dá para trocar os dias agora:%', true,
          'DF3 com a compra do dia 5 do mês seguinte já lançada, a troca é recusada');
-- trocar duas vezes antes de começar (cartão sem compras): vale a última escolha, a partir do mesmo mês
insert into fixture select 'u2', public.create_debt('Cartão Duas Vezes', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('u2'), 5, 15);
select public.set_card_cycle(pg_temp.fx('u2'), 25, 5);
select public.set_card_cycle(pg_temp.fx('u2'), 20, 10);
select is((select closing_day || '/' || due_day || '|' || cycle_from || '|' || prev_closing_day || '/' || prev_due_day from public.debts where id = pg_temp.fx('u2')),
          '20/10|' || pg_temp.m(1, 1) || '|5/15', 'DF4 segunda troca antes de começar: dias 20/10, mesmo mês, antigos 5/15');
select public.card_purchase(pg_temp.fx('u2'), pg_temp.dt('O') + 1, 10.00, 2, pg_temp.fx('cat'), 'Duas');
select is(pg_temp.fecha(pg_temp.fx('u2'), 'Duas'), array[pg_temp.m(1, 20), pg_temp.m(2, 20)], 'DF5 e a compra depois de O usa o dia 20');

-- primeira definição (cartão sem ciclo): vale na hora
insert into fixture select 'n', public.create_debt('Cartão Novo', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('n'), 25, 5);
select is((select coalesce(cycle_from::text, '-') from public.debts where id = pg_temp.fx('n')), '-', 'PD1 primeira definição dos dias: sem troca pendente');
select public.card_purchase(pg_temp.fx('n'), pg_temp.hoje(), 10.00, 1, pg_temp.fx('cat'), 'Primeira');
select is(pg_temp.fecha(pg_temp.fx('n'), 'Primeira'), array[private_closing], 'PD2 a compra de hoje já usa o dia 25')
  from (select case when pg_temp.hoje() < (date_trunc('month', pg_temp.hoje()) + interval '24 days')::date
                    then (date_trunc('month', pg_temp.hoje()) + interval '24 days')::date
                    else (date_trunc('month', pg_temp.hoje()) + interval '1 month 24 days')::date end as private_closing) x;

select * from finish();
rollback;
