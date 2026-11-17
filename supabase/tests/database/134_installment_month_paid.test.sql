-- 134_installment_month_paid: migration 142. O resumo do mês dos parcelamentos conta a parcela do mês de um parcelamento já QUITADO
-- (achado do revisor de dinheiro na #427): marcar como paga a última parcela não pode fazer o valor sumir do mês nem a linha da moeda
-- desaparecer. Também prova a parcela de cartão no mês, a quitada em mês anterior fora, e a sobra "depois das parcelas" (migration
-- 141) que depende disso. Data de corte explícita ('2026-11-12'). Sem dado real. Sem a migration 142 este arquivo falha.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create temp table fixture (k text primary key, v uuid);
grant all on fixture to public;
create function pg_temp.fx(p_k text) returns uuid language sql as $f$ select v from fixture where k = p_k $f$;
create function pg_temp.login(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $f$;
create function pg_temp.hoje() returns date language sql stable as $f$ select (now() at time zone 'America/Sao_Paulo')::date $f$;
create function pg_temp.tx(p_desc text, p_n int) returns uuid language sql as $f$
  select id from public.transactions where description like p_desc || ' %' and installment_number = p_n $f$;
create function pg_temp.fat(p_card uuid, p_label text) returns uuid language sql as $f$
  select id from public.debt_invoices where debt_id = p_card and label = p_label $f$;
-- a linha da moeda como "ativos|com parcela no mês|total|pago|falta|exemplos", ou '-' se não houver linha
create function pg_temp.resumo(p_moeda text) returns text language sql as $f$
  select coalesce((select active_count || '|' || month_count || '|' || month_total::numeric(14,2) || '|' || paid_total::numeric(14,2) || '|' || pending_total::numeric(14,2) || '|' || examples::text
    from public.installment_month_summary(pg_temp.fx('h'), date '2026-11-12') where currency_code = p_moeda), '-') $f$;
create function pg_temp.depois() returns text language sql as $f$
  select coalesce((select net_monthly::numeric(14,2) || '/' || installments_month::numeric(14,2) || '/' || net_after::numeric(14,2)
    from public.recurrence_net_after_installments(pg_temp.fx('h'), date '2026-11-12')), '-') $f$;
grant execute on all functions in schema pg_temp to public;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000134001', 'q1@teste134.com');
select pg_temp.login('00000000-0000-0000-0000-000000134001');
insert into fixture select 'h', public.create_household('Casa dos carnês quitados');
with a as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 1000.00, '2020-01-01') returning id)
  insert into fixture select 'bank', id from a;
with a as (insert into public.accounts (household_id, name, type, initial_balance, opening_date, currency_code)
           values (pg_temp.fx('h'), 'Banco USD', 'checking', 100.00, '2020-01-01', 'USD') returning id)
  insert into fixture select 'usd', id from a;
insert into fixture select 'cat', id from public.categories where household_id = pg_temp.fx('h') and type = 'expense' order by name limit 1;
insert into fixture select 'cinc', id from public.categories where household_id = pg_temp.fx('h') and type = 'income' order by name limit 1;
insert into fixture select 'salario', public.recurrence_create('income', 'Salário', 5000.00, 5, pg_temp.hoje(), pg_temp.fx('bank'), null, null, pg_temp.fx('cinc'), null, 'month', 1);
insert into fixture select 'aluguel', public.recurrence_create('expense', 'Aluguel', 1500.00, 5, pg_temp.hoje(), pg_temp.fx('bank'), null, null, pg_temp.fx('cat'), null, 'month', 1);

select is(pg_temp.resumo('BRL'), '-', 'Q0 sem parcelamentos: nenhuma linha');

-- Carnê "Quitado": 3 parcelas de 100,00 em 12/09, 12/10 e 12/11. As duas primeiras pagas; a de novembro (a ÚLTIMA) ainda não.
select public.transaction_installments_create('expense', 'Quitado', 300, 3, 'month', 1, '2026-09-12', pg_temp.fx('bank'), null, pg_temp.fx('cat'), false);
select public.transactions_bulk_mark_paid(array[pg_temp.tx('Quitado', 1)], '2026-09-12');
select public.transactions_bulk_mark_paid(array[pg_temp.tx('Quitado', 2)], '2026-10-12');
select is(pg_temp.resumo('BRL'), '1|1|100.00|0.00|100.00|{Quitado}', 'Q1 antes de pagar a última: 1 ativo, 100,00 no mês, nada pago');
select is(pg_temp.depois(), '3500.00/100.00/3400.00', 'Q2 sobra depois das parcelas: 3500,00 − 100,00 = 3400,00');

-- pagar a ÚLTIMA parcela (a do mês): o plano fica quitado; o valor do mês NÃO pode sumir
select public.transactions_bulk_mark_paid(array[pg_temp.tx('Quitado', 3)], '2026-11-12');
select is(pg_temp.resumo('BRL'), '0|1|100.00|100.00|0.00|{}',
  'Q3 depois de pagar a última: nenhum ativo, mas a parcela de 100,00 segue no mês, agora paga (e a linha da moeda continua)');
select is(pg_temp.depois(), '3500.00/100.00/3400.00', 'Q4 a sobra depois das parcelas NÃO muda ao pagar a última parcela (continua 3400,00)');

-- quitado em MESES ANTERIORES não entra no mês: 2 parcelas em 12/09 e 12/10, ambas pagas
select public.transaction_installments_create('expense', 'Antigo', 200, 2, 'month', 1, '2026-09-12', pg_temp.fx('bank'), null, pg_temp.fx('cat'), false);
select public.transactions_bulk_mark_paid(array[pg_temp.tx('Antigo', 1)], '2026-09-12');
select public.transactions_bulk_mark_paid(array[pg_temp.tx('Antigo', 2)], '2026-10-12');
select is(pg_temp.resumo('BRL'), '0|1|100.00|100.00|0.00|{}', 'Q6 o parcelamento quitado em outubro não entra em novembro');

-- em dólar: só parcelamento quitado neste mês: a linha da moeda existe (antes sumia)
select public.transaction_installments_create('expense', 'Dólar quitado', 200, 2, 'month', 1, '2026-10-12', pg_temp.fx('usd'), null, pg_temp.fx('cat'), false);
select public.transactions_bulk_mark_paid(array[pg_temp.tx('Dólar quitado', 1)], '2026-10-12');
select public.transactions_bulk_mark_paid(array[pg_temp.tx('Dólar quitado', 2)], '2026-11-12');
select is(pg_temp.resumo('USD'), '0|1|100.00|100.00|0.00|{}', 'Q7 em dólar: só quitado no mês: a linha existe e a parcela do mês conta, sem misturar com reais');
select is(pg_temp.depois(), '3500.00/100.00/3400.00', 'Q8 a parcela em dólar continua fora da sobra (só reais)');

-- Cartão: Notebook 3x R$ 300 em 10/09 (fecha 5, vence 15): faturas 2026-10, 2026-11 e 2026-12; a de novembro vence em 15/11 (no mês)
insert into fixture select 'c', public.create_debt('Cartão C', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('c'), 5, 15);
select public.card_purchase(pg_temp.fx('c'), '2026-09-10', 300.00, 3, pg_temp.fx('cat'), 'Notebook');
select is(pg_temp.resumo('BRL'), '1|2|200.00|100.00|100.00|{Notebook}',
  'Q9 cartão: a parcela de novembro do Notebook (100,00) entra no mês junto com a do carnê quitado: 2 parcelamentos, 200,00');
select is(pg_temp.depois(), '3500.00/200.00/3300.00', 'Q10 a parcela do cartão desconta da sobra: 3500,00 − 200,00 = 3300,00');
-- pagar a fatura de novembro, a última do cartão a pagar? (as de outubro e dezembro seguem); o total do mês não muda
select public.debt_pay(pg_temp.fx('c'), '2026-11-16', pg_temp.fx('bank'), 100.00, pg_temp.fat(pg_temp.fx('c'), '2026-11'), false);
select is((select month_total from public.installment_month_summary(pg_temp.fx('h'), date '2026-11-12') where currency_code = 'BRL'), 200.00::numeric,
  'Q11 pagar a fatura do cartão não muda o total do mês (parcela paga continua sendo do mês)');

select * from finish();
rollback;
