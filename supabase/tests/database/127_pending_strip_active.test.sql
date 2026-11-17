-- 127_pending_strip_active: migration 135 e os cenários de fatura que a 126 não cobria (achado do revisor-dinheiro na #409):
-- pagamento parcial, pagamento sem fatura, crédito avulso maior que a fatura e cartão arquivado. O cartão arquivado falha
-- sem a 135. O "vencido fantasma" de cartão ativo (pagamento numa fatura mais nova cobrindo a anterior) é limite conhecido
-- da card_months: a asserção P5 registra o comportamento de hoje até a PR B.
-- A função vai por SQL dinâmico: sem ela as asserções falham sem abortar o arquivo.
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
create function pg_temp.faixa(p_h uuid, p_hoje date, p_ate date) returns text[] language plpgsql as $f$
declare r text[];
begin
  execute 'select coalesce(array_agg(kind || ''|'' || item_count || ''|'' || total::numeric(14,2) || ''|'' || first_date order by ord), ''{}'')
             from (select f.*, row_number() over () as ord from public.pending_strip($1, $2, $3) f) q'
    into r using p_h, p_hoje, p_ate;
  return r;
exception when others then return array['ERRO ' || sqlstate];
end $f$;
create function pg_temp.fatura(p_debt uuid, p_label text) returns uuid language sql as $f$
  select id from public.debt_invoices where debt_id = p_debt and label = p_label
$f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.faixa(uuid, date, date), pg_temp.fatura(uuid, text) to public;

insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-0000-0000-0000000127a1', 'g1@teste.com', now());
select pg_temp.login('00000000-0000-0000-0000-0000000127a1');
insert into fixture select 'h', public.create_household('Casa das Faturas');
insert into fixture select 'cat', id from public.categories where household_id = pg_temp.fx('h') and name = 'Mercado';
insert into fixture select 'rec', id from public.categories where household_id = pg_temp.fx('h') and type = 'income' order by name limit 1;
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 5000.00, '2026-01-01') returning id)
  insert into fixture select 'brl', id from i;

-- Cartão: fecha 18, vence 25. Setembro 150,00 (venceu 25/09) e outubro 300,00 (venceu 25/10). Hoje = 17/11.
insert into fixture select 'card', public.create_debt('Cartão', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('card'), 18, 25);
select public.card_purchase(pg_temp.fx('card'), '2026-09-05', 150.00, 1, pg_temp.fx('cat'), 'Setembro');
select public.card_purchase(pg_temp.fx('card'), '2026-10-05', 300.00, 1, pg_temp.fx('cat'), 'Outubro');
select public.card_bill_due('2026-10-31'); -- fecha as faturas de setembro e outubro (debt_invoices)

select is(pg_temp.faixa(pg_temp.fx('h'), '2026-11-17', '2026-11-30'), array['overdue_payable|2|450.00|2026-09-25'],
  'B0 sem pagamento: as duas faturas fechadas, vencidas');

savepoint s;
select public.debt_pay(pg_temp.fx('card'), '2026-09-26', pg_temp.fx('brl'), 50.00, pg_temp.fatura(pg_temp.fx('card'), '2026-09'), false);
select is(pg_temp.faixa(pg_temp.fx('h'), '2026-11-17', '2026-11-30'), array['overdue_payable|2|400.00|2026-09-25'],
  'P1 pagamento parcial de 50,00 em setembro: entra o que FALTA (total - pago), não o total');
rollback to savepoint s;

select public.debt_pay(pg_temp.fx('card'), '2026-10-26', pg_temp.fx('brl'), 400.00, null, false);
select is(pg_temp.faixa(pg_temp.fx('h'), '2026-11-17', '2026-11-30'), array['overdue_payable|1|50.00|2026-10-25'],
  'P2 pagamento de 400,00 sem fatura: quita setembro e 250 de outubro; sobra 50,00 vencidos desde 25/10');
rollback to savepoint s;

select public.card_credit_income(pg_temp.fx('card'), '2026-10-10', 500.00, pg_temp.fx('rec'), 'Reembolso', null, null);
select is(pg_temp.faixa(pg_temp.fx('h'), '2026-11-17', '2026-11-30'), array['overdue_payable|1|150.00|2026-09-25'],
  'P3 crédito avulso de 500,00 em outubro: outubro zera (fica fora); setembro continua');
rollback to savepoint s;

-- pagamento de 450,00 vinculado a OUTUBRO (cobre setembro também): a dívida zera
select public.debt_pay(pg_temp.fx('card'), '2026-10-26', pg_temp.fx('brl'), 450.00, pg_temp.fatura(pg_temp.fx('card'), '2026-10'), false);
select is((select balance::numeric(14,2) from public.debt_balances(pg_temp.fx('h'), '2026-11-17') where debt_id = pg_temp.fx('card')), 0.00::numeric(14,2),
  'P4 pagamento de 450,00 em outubro: saldo do cartão zera');
-- LIMITE CONHECIDO (PR B): card_months manda a sobra só para as faturas seguintes, então setembro continua com 150,00
-- "vencidos" com a dívida zerada. Esta asserção registra o comportamento de hoje; a PR B troca o esperado por '{}'.
select is(pg_temp.faixa(pg_temp.fx('h'), '2026-11-17', '2026-11-30'), array['overdue_payable|1|150.00|2026-09-25'],
  'P5 limite conhecido (PR B): dívida zerada mas setembro aparece como vencido (sobra foi para as faturas seguintes)');
-- cartão arquivado (saldo 0): nada dele na faixa
select public.debt_archive(pg_temp.fx('card'));
select is(pg_temp.faixa(pg_temp.fx('h'), '2026-11-17', '2026-11-30'), '{}'::text[],
  'A1 cartão arquivado não aparece na faixa (migration 135)');
rollback to savepoint s;

select * from finish();
rollback;
