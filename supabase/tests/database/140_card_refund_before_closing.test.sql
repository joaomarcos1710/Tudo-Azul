-- 140_card_refund_before_closing: migration 146. Devolução em dinheiro (refund_cash) feita ANTES do fechamento da fatura
-- cujo pagamento gerou a sobra. Bug de valor achado pelo revisor-dinheiro na #413: card_months descontava a devolução na
-- iteração da fatura anterior, quando a sobra ainda não existia; a devolução se perdia e a sobra já devolvida reaparecia
-- como adiantamento, "pagando" a fatura seguinte. A dívida (debt_balances) sempre esteve certa; errado era o pago das
-- faturas. Falha sem a migration 146. Datas no passado (2026-03 a 2026-05); cada cenário numa família própria.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ---- auxiliares de teste (temporários; somem no rollback) ----
create temp table fixture (k text primary key, v uuid);
grant all on fixture to public;
create function pg_temp.fx(p_k text) returns uuid language sql as $f$ select v from fixture where k = p_k $f$;
create function pg_temp.login(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $f$;
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
create function pg_temp.parcelas(p_plan uuid) returns text language sql as $f$
  select string_agg(seq || ':' || due_date || ':' || face, ' ' order by seq)
    from public.debt_installments where plan = p_plan::text $f$;
create function pg_temp.uid(p_n integer) returns uuid language sql as $f$
  select ('00000000-0000-0000-0000-000000' || lpad(p_n::text, 6, '0'))::uuid $f$;
-- Cria família, conta "Banco" (5000), categoria de despesa e cartão "Cartão" (fecha 17, vence 25).
create function pg_temp.mk(p_tag text, p_n integer) returns void language plpgsql as $f$
declare v_h uuid; v_acc uuid;
begin
  perform pg_temp.login(pg_temp.uid(p_n));
  v_h := public.create_household('Casa ' || p_tag);
  insert into public.accounts (household_id, name, type, initial_balance, opening_date)
  values (v_h, 'Banco', 'checking', 5000, '2026-01-01') returning id into v_acc;
  insert into fixture values (p_tag || 'h', v_h), (p_tag || 'bank', v_acc);
  insert into fixture select p_tag || 'cat', id from public.categories
   where household_id = v_h and name = 'Compras pessoais';
  insert into fixture select p_tag || 'card', public.create_debt('Cartão', 'card', '2026-01-01', 0);
  perform public.set_card_cycle((select v from fixture where k = p_tag || 'card'), 17, 25);
end $f$;
-- Saldo da conta "Banco" e id da fatura (por rótulo) do cartão do cenário.
create function pg_temp.banco(p_tag text) returns numeric language sql as $f$
  select balance from public.account_balances(pg_temp.fx(p_tag || 'h'), '2099-12-31') where name = 'Banco' $f$;
create function pg_temp.fat(p_tag text, p_label text) returns uuid language sql as $f$
  select id from public.debt_invoices where debt_id = pg_temp.fx(p_tag || 'card') and label = p_label $f$;
grant execute on function pg_temp.fx(text), pg_temp.sqlstate_of(text), pg_temp.parcelas(uuid), pg_temp.uid(integer),
  pg_temp.mk(text, integer), pg_temp.banco(text), pg_temp.fat(text, text), pg_temp.login(uuid) to public;

insert into auth.users (id, email) select pg_temp.uid(n), 'rb' || n || '@teste.com' from generate_series(140001, 140009) n;
-- "mês|total|pago|adiantamento que sai" de cada fatura, em ordem
create function pg_temp.meses(p_tag text) returns text language sql as $f$
  select string_agg(label || '|' || total::numeric(14,2) || '|' || paid::numeric(14,2) || '|' || advance_out::numeric(14,2), ' ' order by label)
    from public.card_months(pg_temp.fx(p_tag || 'card')) $f$;
create function pg_temp.divida(p_tag text, p_data date) returns numeric language sql as $f$
  select debt from public.debt_balances(pg_temp.fx(p_tag || 'h'), p_data) where name = 'Cartão' $f$;
-- o que as faturas dizem que falta pagar; tem de ser igual à dívida
create function pg_temp.em_aberto(p_tag text) returns numeric language sql as $f$
  select sum(total - paid)::numeric(14,2) from public.card_months(pg_temp.fx(p_tag || 'card')) $f$;
grant execute on function pg_temp.meses(text), pg_temp.divida(text, date), pg_temp.em_aberto(text) to public;

-- =====================================================================================
-- A. O caso do revisor: paga a mais ANTES do fechamento, a operadora devolve antes do fechamento
-- =====================================================================================
select pg_temp.mk('a', 140001);
select public.card_purchase(pg_temp.fx('acard'), '2026-03-01', 100.00, 1, pg_temp.fx('acat'), 'Março');
select public.card_purchase(pg_temp.fx('acard'), '2026-04-01', 200.00, 1, pg_temp.fx('acat'), 'Abril');
select public.card_purchase(pg_temp.fx('acard'), '2026-05-01', 50.00, 1, pg_temp.fx('acat'), 'Maio');
select is(public.card_bill_due('2026-05-31'), 3, 'A0 março, abril e maio cobrados');
select lives_ok($$select public.debt_pay(pg_temp.fx('acard'), '2026-03-25', pg_temp.fx('abank'), 100.00, pg_temp.fat('a', '2026-03'))$$, 'A0 março pago');
select lives_ok($$select public.debt_pay(pg_temp.fx('acard'), '2026-04-10', pg_temp.fx('abank'), 280.00, pg_temp.fat('a', '2026-04'))$$,
                'A0 abril pago com 80 a mais, em 10/04 (antes do fechamento de 17/04)');
select lives_ok($$select public.debt_return(pg_temp.fx('acard'), '2026-04-12', pg_temp.fx('abank'), 80.00)$$,
                'A0 a operadora devolve os 80 em 12/04, ainda antes do fechamento');
select is(pg_temp.banco('a'), 4700.00, 'A1 conta: 5000 − 100 − 280 + 80');
select is(pg_temp.divida('a', '2026-05-31'), 50.00, 'A1 a dívida é só a fatura de maio');
select is(pg_temp.meses('a'), '2026-03|100.00|100.00|0.00 2026-04|200.00|200.00|0.00 2026-05|50.00|0.00|0.00',
          'A1 os 80 devolvidos não viram adiantamento: maio continua sem pagamento (antes: maio "paga" com 50 e 30 de adiantamento)');
select is(pg_temp.em_aberto('a'), pg_temp.divida('a', '2026-05-31'), 'A1 o em aberto das faturas bate com a dívida');
reset role;
select is((select string_agg(label || '|' || paid::numeric(14,2), ' ' order by label) from private.card_months_as_of(pg_temp.fx('acard'), '2026-05-31')),
          '2026-03|100.00 2026-04|200.00 2026-05|0.00', 'A2 card_months_as_of (data de corte) tem a mesma regra');
select is((select string_agg(label || '|' || paid::numeric(14,2), ' ' order by label) from private.card_months_as_of(pg_temp.fx('acard'), '2026-04-11')),
          '2026-03|100.00 2026-04|200.00 2026-05|50.00', 'A2 em 11/04 (antes da devolução) os 80 ainda eram crédito e cobriam maio');

-- =====================================================================================
-- B. Primeira fatura do cartão: a devolução vem antes do primeiro fechamento
-- =====================================================================================
select pg_temp.mk('b', 140002);
select public.card_purchase(pg_temp.fx('bcard'), '2026-03-01', 100.00, 1, pg_temp.fx('bcat'), 'Março');
select public.card_purchase(pg_temp.fx('bcard'), '2026-04-01', 30.00, 1, pg_temp.fx('bcat'), 'Abril');
select is(public.card_bill_due('2026-04-30'), 2, 'B0 março e abril cobrados');
select public.debt_pay(pg_temp.fx('bcard'), '2026-03-10', pg_temp.fx('bbank'), 150.00, pg_temp.fat('b', '2026-03'));
select public.debt_return(pg_temp.fx('bcard'), '2026-03-12', pg_temp.fx('bbank'), 50.00);
select is(pg_temp.meses('b'), '2026-03|100.00|100.00|0.00 2026-04|30.00|0.00|0.00',
          'B1 devolução antes do primeiro fechamento: abril continua sem pagamento');
select is(pg_temp.em_aberto('b'), pg_temp.divida('b', '2026-04-30'), 'B1 o em aberto das faturas bate com a dívida');

-- =====================================================================================
-- C. Devolução parcial: só o que foi devolvido deixa de ser adiantamento
-- =====================================================================================
reset role;
select pg_temp.mk('c', 140003);
select public.card_purchase(pg_temp.fx('ccard'), '2026-03-01', 100.00, 1, pg_temp.fx('ccat'), 'Março');
select public.card_purchase(pg_temp.fx('ccard'), '2026-04-01', 200.00, 1, pg_temp.fx('ccat'), 'Abril');
select public.card_purchase(pg_temp.fx('ccard'), '2026-05-01', 50.00, 1, pg_temp.fx('ccat'), 'Maio');
select is(public.card_bill_due('2026-05-31'), 3, 'C0 três faturas cobradas');
select public.debt_pay(pg_temp.fx('ccard'), '2026-03-25', pg_temp.fx('cbank'), 100.00, pg_temp.fat('c', '2026-03'));
select public.debt_pay(pg_temp.fx('ccard'), '2026-04-10', pg_temp.fx('cbank'), 280.00, pg_temp.fat('c', '2026-04'));
select public.debt_return(pg_temp.fx('ccard'), '2026-04-12', pg_temp.fx('cbank'), 60.00);
select is(pg_temp.meses('c'), '2026-03|100.00|100.00|0.00 2026-04|200.00|200.00|20.00 2026-05|50.00|20.00|0.00',
          'C1 dos 80 a mais, 60 voltaram: só 20 seguem como adiantamento para maio');
select is(pg_temp.em_aberto('c'), pg_temp.divida('c', '2026-05-31'), 'C1 o em aberto das faturas bate com a dívida');

-- =====================================================================================
-- D. Não regride: devolução DEPOIS do fechamento (já funcionava) e sobra sem devolução
-- =====================================================================================
reset role;
select pg_temp.mk('d', 140004);
select public.card_purchase(pg_temp.fx('dcard'), '2026-03-01', 100.00, 1, pg_temp.fx('dcat'), 'Março');
select public.card_purchase(pg_temp.fx('dcard'), '2026-04-01', 200.00, 1, pg_temp.fx('dcat'), 'Abril');
select public.card_purchase(pg_temp.fx('dcard'), '2026-05-01', 50.00, 1, pg_temp.fx('dcat'), 'Maio');
select is(public.card_bill_due('2026-05-31'), 3, 'D0 três faturas cobradas');
select public.debt_pay(pg_temp.fx('dcard'), '2026-03-25', pg_temp.fx('dbank'), 100.00, pg_temp.fat('d', '2026-03'));
select public.debt_pay(pg_temp.fx('dcard'), '2026-04-20', pg_temp.fx('dbank'), 280.00, pg_temp.fat('d', '2026-04'));
select is(pg_temp.meses('d'), '2026-03|100.00|100.00|0.00 2026-04|200.00|200.00|80.00 2026-05|50.00|50.00|30.00',
          'D1 sobra sem devolução: os 80 seguem como adiantamento (regra de sempre)');
select public.debt_return(pg_temp.fx('dcard'), '2026-04-22', pg_temp.fx('dbank'), 80.00);
select is(pg_temp.meses('d'), '2026-03|100.00|100.00|0.00 2026-04|200.00|200.00|0.00 2026-05|50.00|0.00|0.00',
          'D2 devolução depois do fechamento: os 80 saem do adiantamento (já era assim)');
select is(pg_temp.em_aberto('d'), pg_temp.divida('d', '2026-05-31'), 'D2 o em aberto das faturas bate com a dívida');

-- as_of também no bloco da primeira fatura (cenário B) e no próprio dia da devolução (privada: roda como dono do banco,
-- com o usuário da família no JWT)
reset role;
select pg_temp.login(pg_temp.uid(140002));
reset role;
select is((select string_agg(label || '|' || paid::numeric(14,2), ' ' order by label) from private.card_months_as_of(pg_temp.fx('bcard'), '2026-04-30')),
          '2026-03|100.00 2026-04|0.00', 'B2 card_months_as_of: devolução antes do primeiro fechamento');
select pg_temp.login(pg_temp.uid(140001));
reset role;
select is((select string_agg(label || '|' || paid::numeric(14,2), ' ' order by label) from private.card_months_as_of(pg_temp.fx('acard'), '2026-04-12')),
          '2026-03|100.00 2026-04|200.00 2026-05|0.00', 'A3 card_months_as_of no dia da devolução (12/04): os 80 já não contam');

-- =====================================================================================
-- E. Devolução MAIOR que a sobra: o pagamento inteiro volta antes do fechamento (achado do revisor-dinheiro, #462).
--    debt_chk aceita (a cobrança de abril é datada no fechamento); a fatura tem de continuar em aberto.
-- =====================================================================================
select pg_temp.mk('e', 140005);
select public.card_purchase(pg_temp.fx('ecard'), '2026-03-01', 100.00, 1, pg_temp.fx('ecat'), 'Março');
select public.card_purchase(pg_temp.fx('ecard'), '2026-04-01', 200.00, 1, pg_temp.fx('ecat'), 'Abril');
select public.card_purchase(pg_temp.fx('ecard'), '2026-05-01', 50.00, 1, pg_temp.fx('ecat'), 'Maio');
select is(public.card_bill_due('2026-05-31'), 3, 'E0 três faturas cobradas');
select public.debt_pay(pg_temp.fx('ecard'), '2026-03-25', pg_temp.fx('ebank'), 100.00, pg_temp.fat('e', '2026-03'));
select public.debt_pay(pg_temp.fx('ecard'), '2026-04-10', pg_temp.fx('ebank'), 200.00, pg_temp.fat('e', '2026-04'));
select lives_ok($$select public.debt_return(pg_temp.fx('ecard'), '2026-04-12', pg_temp.fx('ebank'), 200.00)$$,
                'E0 a operadora devolve os 200 em 12/04 (aceito: antes do fechamento o saldo é 0)');
select is(pg_temp.meses('e'), '2026-03|100.00|100.00|0.00 2026-04|200.00|0.00|0.00 2026-05|50.00|0.00|0.00',
          'E1 abril continua em aberto: o pagamento foi devolvido (tirando só da sobra, ficava "paga" com 200 de dívida)');
select is(pg_temp.em_aberto('e'), pg_temp.divida('e', '2026-05-31'), 'E1 o em aberto das faturas bate com a dívida (250)');
select is(pg_temp.divida('e', '2026-05-31'), 250.00, 'E1 a dívida é abril + maio');
-- depois disso, um pagamento a mais em maio vira adiantamento normal: nada ficou "devendo"
select public.card_purchase(pg_temp.fx('ecard'), '2026-06-01', 40.00, 1, pg_temp.fx('ecat'), 'Junho');
select is(public.card_bill_due('2026-06-30'), 1, 'E2 junho cobrado');
select public.debt_pay(pg_temp.fx('ecard'), '2026-05-25', pg_temp.fx('ebank'), 280.00, pg_temp.fat('e', '2026-05'));
select is(pg_temp.meses('e'), '2026-03|100.00|100.00|0.00 2026-04|200.00|200.00|0.00 2026-05|50.00|50.00|30.00 2026-06|40.00|30.00|0.00',
          'E2 280 em maio: 50 de maio, 200 voltam para abril (136) e 30 seguem para junho');
select is(pg_temp.em_aberto('e'), pg_temp.divida('e', '2026-06-30'), 'E2 o em aberto das faturas bate com a dívida');

-- =====================================================================================
-- F. Fatura anterior em aberto + sobra devolvida: a sobra devolvida NÃO quita a anterior (regra da 136)
-- =====================================================================================
reset role;
select pg_temp.mk('f', 140006);
select public.card_purchase(pg_temp.fx('fcard'), '2026-03-01', 100.00, 1, pg_temp.fx('fcat'), 'Março');
select public.card_purchase(pg_temp.fx('fcard'), '2026-04-01', 200.00, 1, pg_temp.fx('fcat'), 'Abril');
select is(public.card_bill_due('2026-04-30'), 2, 'F0 março e abril cobrados; março fica sem pagar');
select public.debt_pay(pg_temp.fx('fcard'), '2026-04-10', pg_temp.fx('fbank'), 280.00, pg_temp.fat('f', '2026-04'));
select is(pg_temp.meses('f'), '2026-03|100.00|80.00|0.00 2026-04|200.00|200.00|0.00', 'F0 sem devolução, os 80 a mais abatem março (136)');
select public.debt_return(pg_temp.fx('fcard'), '2026-04-12', pg_temp.fx('fbank'), 80.00);
select is(pg_temp.meses('f'), '2026-03|100.00|0.00|0.00 2026-04|200.00|200.00|0.00', 'F1 devolvidos os 80, março volta a ficar inteira em aberto');
select is(pg_temp.em_aberto('f'), pg_temp.divida('f', '2026-04-30'), 'F1 o em aberto das faturas bate com a dívida (100)');

-- =====================================================================================
-- G. Adiantamento sem fatura + sobra de fatura: a devolução leva primeiro o adiantamento que já existia
-- =====================================================================================
reset role;
select pg_temp.mk('g', 140007);
select public.card_purchase(pg_temp.fx('gcard'), '2026-03-01', 100.00, 1, pg_temp.fx('gcat'), 'Março');
select public.card_purchase(pg_temp.fx('gcard'), '2026-04-01', 200.00, 1, pg_temp.fx('gcat'), 'Abril');
select public.card_purchase(pg_temp.fx('gcard'), '2026-05-01', 50.00, 1, pg_temp.fx('gcat'), 'Maio');
select is(public.card_bill_due('2026-05-31'), 3, 'G0 três faturas cobradas');
select public.debt_pay(pg_temp.fx('gcard'), '2026-03-25', pg_temp.fx('gbank'), 100.00, pg_temp.fat('g', '2026-03'));
select public.debt_pay(pg_temp.fx('gcard'), '2026-04-10', pg_temp.fx('gbank'), 280.00, pg_temp.fat('g', '2026-04'));
select public.debt_pay(pg_temp.fx('gcard'), '2026-04-11', pg_temp.fx('gbank'), 30.00);
select public.debt_return(pg_temp.fx('gcard'), '2026-04-12', pg_temp.fx('gbank'), 80.00);
select is(pg_temp.em_aberto('g'), pg_temp.divida('g', '2026-05-31'), 'G1 o em aberto das faturas bate com a dívida (20)');
select is(pg_temp.divida('g', '2026-05-31'), 20.00, 'G1 dívida: 350 de compras − 410 pagos + 80 devolvidos');
select is((select paid::numeric(14,2) from public.card_months(pg_temp.fx('gcard')) where label = '2026-05'), 30.00,
          'G1 dos 110 a mais, 80 voltaram: 30 pagam maio');

-- =====================================================================================
-- H. A devolução é lastreada no pagamento de OUTRA fatura (maio, pago adiantado); abril foi pago certinho.
--    A dívida é cobrada pela ordem das faturas, mas a sobra de maio volta e quita abril: o total fecha.
-- =====================================================================================
reset role;
select pg_temp.mk('h', 140008);
select public.card_purchase(pg_temp.fx('hcard'), '2026-03-01', 100.00, 1, pg_temp.fx('hcat'), 'Março');
select public.card_purchase(pg_temp.fx('hcard'), '2026-04-01', 200.00, 1, pg_temp.fx('hcat'), 'Abril');
select public.card_purchase(pg_temp.fx('hcard'), '2026-05-01', 50.00, 1, pg_temp.fx('hcat'), 'Maio');
select is(public.card_bill_due('2026-05-31'), 3, 'H0 três faturas cobradas');
select public.debt_pay(pg_temp.fx('hcard'), '2026-03-25', pg_temp.fx('hbank'), 100.00, pg_temp.fat('h', '2026-03'));
select public.debt_pay(pg_temp.fx('hcard'), '2026-04-10', pg_temp.fx('hbank'), 130.00, pg_temp.fat('h', '2026-05'));
select public.debt_return(pg_temp.fx('hcard'), '2026-04-12', pg_temp.fx('hbank'), 80.00);
select public.debt_pay(pg_temp.fx('hcard'), '2026-04-20', pg_temp.fx('hbank'), 200.00, pg_temp.fat('h', '2026-04'));
select is(pg_temp.meses('h'), '2026-03|100.00|100.00|0.00 2026-04|200.00|200.00|0.00 2026-05|50.00|50.00|0.00',
          'H1 abril e maio pagas, sem adiantamento: os 80 devolvidos saíram de maio');
select is(pg_temp.em_aberto('h'), pg_temp.divida('h', '2026-05-31'), 'H1 o em aberto das faturas bate com a dívida (0)');

-- =====================================================================================
-- I. Saldo inicial do cartão (referência) + sobra devolvida: a sobra devolvida não abate o saldo inicial
-- =====================================================================================
reset role;
select pg_temp.login(pg_temp.uid(140009));
insert into fixture select 'ih', public.create_household('Casa i');
insert into public.accounts (household_id, name, type, initial_balance, opening_date)
values (pg_temp.fx('ih'), 'Banco', 'checking', 5000, '2026-01-01');
insert into fixture select 'ibank', id from public.accounts where household_id = pg_temp.fx('ih') and name = 'Banco';
insert into fixture select 'icat', id from public.categories where household_id = pg_temp.fx('ih') and name = 'Compras pessoais';
insert into fixture select 'icard', public.create_debt('Cartão', 'card', '2026-01-01', 300.00);
select public.set_card_cycle(pg_temp.fx('icard'), 17, 25);
select public.card_purchase(pg_temp.fx('icard'), '2026-04-01', 200.00, 1, pg_temp.fx('icat'), 'Abril');
select is(public.card_bill_due('2026-04-30'), 1, 'I0 abril cobrado; o cartão nasceu devendo 300');
select public.debt_pay(pg_temp.fx('icard'), '2026-04-20', pg_temp.fx('ibank'), 580.00, pg_temp.fat('i', '2026-04'));
select is((select credit_receivable from public.debt_balances(pg_temp.fx('ih'), '2026-04-30') where name = 'Cartão'), 80.00,
          'I0 580 pagos contra 500 de dívida: 80 de crédito a receber');
select public.debt_return(pg_temp.fx('icard'), '2026-04-22', pg_temp.fx('ibank'), 80.00);
select is(pg_temp.divida('i', '2026-04-30'), 0.00, 'I1 devolvidos os 80, a dívida zera');
select is((select total::numeric(14,2) || '|' || paid::numeric(14,2) || '|' || advance_out::numeric(14,2) from public.card_months(pg_temp.fx('icard')) where label = '2026-04'),
          '200.00|200.00|0.00', 'I1 abril paga e sem adiantamento');

select * from finish();
rollback;
