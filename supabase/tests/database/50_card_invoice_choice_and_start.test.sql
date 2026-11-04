-- 50_card_invoice_choice_and_start: migration 051. Escolher a fatura (-3..+3) e recuar o início do cartão.
-- Datas fixas e relativas ao início do cartão (não a hoje): o cálculo da fatura não depende de hoje.
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
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
create function pg_temp.fechamentos(p_plan uuid) returns text language sql as $f$
  select string_agg(due_date::text || '=' || face::text, ',' order by seq) from public.debt_installments where plan = p_plan::text $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.sqlstate_of(text), pg_temp.fechamentos(uuid) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000050a1', 'c1@teste.com'),
  ('00000000-0000-0000-0000-0000000050a2', 'c2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000050a1');
insert into fixture select 'h', public.create_household('Casa Cartão');
insert into fixture select 'cat', id from public.categories where household_id = pg_temp.fx('h') and type = 'expense' limit 1;
-- cartão começa em 01/06/2026, fecha dia 18, vence 28
insert into fixture select 'card', public.create_card('Cartão', date '2026-06-01', 0, 18, 28);

-- 1. fatura escolhida ---------------------------------------------------------
-- compra em 10/07: a fatura natural fecha em 18/07
insert into fixture select 'p0', public.card_purchase_at(pg_temp.fx('card'), date '2026-07-10', 100.00, 1, pg_temp.fx('cat'), 'natural');
select is(pg_temp.fechamentos(pg_temp.fx('p0')), '2026-07-18=100.00', 'F1 deslocamento 0: a fatura que a data dá (igual a card_purchase)');
insert into fixture select 'p1', public.card_purchase_at(pg_temp.fx('card'), date '2026-07-10', 100.00, 1, pg_temp.fx('cat'), 'depois', 1);
select is(pg_temp.fechamentos(pg_temp.fx('p1')), '2026-08-18=100.00', 'F2 +1: a fatura seguinte');
insert into fixture select 'p3', public.card_purchase_at(pg_temp.fx('card'), date '2026-07-10', 100.00, 1, pg_temp.fx('cat'), '3 depois', 3);
select is(pg_temp.fechamentos(pg_temp.fx('p3')), '2026-10-18=100.00', 'F3 +3: três faturas depois');
insert into fixture select 'pm', public.card_purchase_at(pg_temp.fx('card'), date '2026-09-10', 10.00, 3, pg_temp.fx('cat'), 'antes', -1);
select is(pg_temp.fechamentos(pg_temp.fx('pm')), '2026-08-18=3.34,2026-09-18=3.33,2026-10-18=3.33',
  'F4 -1 em 3x: começa uma fatura antes e as parcelas seguem mês a mês, sobra na 1ª');
select is(pg_temp.sqlstate_of($$select public.card_purchase_at(pg_temp.fx('card'), date '2026-07-10', 1, 1, pg_temp.fx('cat'), 'x', 4)$$),
  '22023', 'F5 além de +3: recusa');
select is(pg_temp.sqlstate_of($$select public.card_purchase_at(pg_temp.fx('card'), date '2026-09-10', 1, 1, pg_temp.fx('cat'), 'x', -4)$$),
  '22023', 'F6 além de -3: recusa');
select is(pg_temp.sqlstate_of($$select public.card_purchase_at(pg_temp.fx('card'), date '2026-06-10', 1, 1, pg_temp.fx('cat'), 'x', -1)$$),
  '23514', 'F7 fatura que fecha até o início do cartão (18/05): recusa (já está no saldo de referência)');
-- compra ANTES do início mas que fecha DEPOIS: agora entra (antes card_purchase recusava pela data da compra)
select is(pg_temp.sqlstate_of($$select public.card_purchase(pg_temp.fx('card'), date '2026-05-25', 1, 1, pg_temp.fx('cat'), 'x')$$),
  '23514', 'F8 card_purchase continua igual: recusa a data anterior ao início');
insert into fixture select 'pa', public.card_purchase_at(pg_temp.fx('card'), date '2026-05-25', 50.00, 1, pg_temp.fx('cat'), 'antes do início');
select is(pg_temp.fechamentos(pg_temp.fx('pa')), '2026-06-18=50.00', 'F9 card_purchase_at aceita compra anterior ao início que fecha depois');
select is(public.card_purchase_at(pg_temp.fx('card'), date '2026-07-10', 1, 1, pg_temp.fx('cat'), 'x', 0, pg_temp.fx('p0')), pg_temp.fx('p0'),
  'F10 mesma chave: devolve a mesma compra, sem duplicar');

-- 2. recuar o início ----------------------------------------------------------
select is(pg_temp.sqlstate_of($$update public.debts set reference_date = date '2025-01-01' where id = pg_temp.fx('card')$$), '42501',
  'S1 UPDATE direto da âncora continua proibido');
select is(pg_temp.sqlstate_of($$select public.card_set_start(pg_temp.fx('card'), date '2026-07-01', 0)$$), '22023', 'S2 só recua');
select is(pg_temp.sqlstate_of($$select public.card_set_start(pg_temp.fx('card'), date '2026-06-01', 0)$$), '22023',
  'S3 a mesma data também não (precisa ser antes)');
select lives_ok($$select public.card_set_start(pg_temp.fx('card'), date '2024-10-31', 0)$$, 'S4 recua para antes de tudo');
select is((select reference_date from public.debts where id = pg_temp.fx('card')), date '2024-10-31', 'S4.1 novo início gravado');
select is(current_setting('app.debt_anchor_edit', true), 'off', 'S4.2 a marca é desligada no fim da chamada');
select is(pg_temp.sqlstate_of($$update public.debts set reference_balance = 10 where id = pg_temp.fx('card')$$), '42501',
  'S4.3 depois da chamada, UPDATE direto volta a ser proibido');
select lives_ok($$select public.card_purchase(pg_temp.fx('card'), date '2025-01-10', 20.00, 1, pg_temp.fx('cat'), 'passado')$$,
  'S5 agora compra antiga entra');
select is(pg_temp.sqlstate_of($$select public.card_set_start(pg_temp.fx('card'), date '2024-10-01', -1)$$), '22023', 'S6 saldo negativo: recusa');

select pg_temp.login('00000000-0000-0000-0000-0000000050a2');
select is(pg_temp.sqlstate_of($$select public.card_set_start(pg_temp.fx('card'), date '2024-01-01', 0)$$), '42501', 'S7 outra família: recusa');
select is(pg_temp.sqlstate_of($$select public.card_purchase_at(pg_temp.fx('card'), date '2026-07-10', 1, 1, null, 'x')$$), '42501', 'S8 outra família não compra');

select * from finish();
rollback;
