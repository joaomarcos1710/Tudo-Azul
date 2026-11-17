-- 127_pending_strip_active: migration 135 e os cenários de fatura que a 126 não cobria (achado do revisor-dinheiro na #409):
-- pagamento parcial, pagamento sem fatura, crédito avulso maior que a fatura e cartão arquivado. O cartão arquivado falha
-- sem a 135. O "vencido fantasma" de cartão ativo (pagamento numa fatura mais nova cobrindo a anterior) era da card_months:
-- corrigido na migration 136 (P5).
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

-- Cada cenário numa família própria (um usuário cada): rollback to savepoint desfaria também a contagem do pgTAP.
-- Cartão: fecha 18, vence 25. Setembro 150,00 (venceu 25/09) e outubro 300,00 (venceu 25/10). Hoje = 17/11.
create function pg_temp.cenario(p_k text, p_uid uuid) returns void language plpgsql as $f$
declare v_h uuid; v_cat uuid; v_rec uuid; v_conta uuid; v_card uuid;
begin
  insert into auth.users (id, email, email_confirmed_at) values (p_uid, p_k || '@teste127.com', now());
  perform pg_temp.login(p_uid);
  v_h := public.create_household('Casa ' || p_k);
  select id into v_cat from public.categories where household_id = v_h and name = 'Mercado';
  select id into v_rec from public.categories where household_id = v_h and type = 'income' order by name limit 1;
  insert into public.accounts (household_id, name, type, initial_balance, opening_date)
    values (v_h, 'Banco', 'checking', 5000.00, '2026-01-01') returning id into v_conta;
  v_card := public.create_debt('Cartão', 'card', '2026-01-01', 0);
  perform public.set_card_cycle(v_card, 18, 25);
  perform public.card_purchase(v_card, '2026-09-05', 150.00, 1, v_cat, 'Setembro');
  perform public.card_purchase(v_card, '2026-10-05', 300.00, 1, v_cat, 'Outubro');
  perform public.card_bill_due('2026-10-31'); -- fecha as faturas de setembro e outubro (debt_invoices)
  insert into fixture values (p_k || ':h', v_h), (p_k || ':card', v_card), (p_k || ':conta', v_conta), (p_k || ':rec', v_rec);
end $f$;
grant execute on function pg_temp.cenario(text, uuid) to public;

reset role;
select pg_temp.cenario('b0', '00000000-0000-0000-0000-0000000127b0');
select is(pg_temp.faixa(pg_temp.fx('b0:h'), '2026-11-17', '2026-11-30'), array['overdue_payable|2|450.00|2026-09-25'],
  'B0 sem pagamento: as duas faturas fechadas, vencidas');

reset role;
select pg_temp.cenario('p1', '00000000-0000-0000-0000-0000000127b1');
select public.debt_pay(pg_temp.fx('p1:card'), '2026-09-26', pg_temp.fx('p1:conta'), 50.00, pg_temp.fatura(pg_temp.fx('p1:card'), '2026-09'), false);
select is(pg_temp.faixa(pg_temp.fx('p1:h'), '2026-11-17', '2026-11-30'), array['overdue_payable|2|400.00|2026-09-25'],
  'P1 pagamento parcial de 50,00 em setembro: entra o que FALTA (total - pago), não o total');

reset role;
select pg_temp.cenario('p2', '00000000-0000-0000-0000-0000000127b2');
select public.debt_pay(pg_temp.fx('p2:card'), '2026-10-26', pg_temp.fx('p2:conta'), 400.00, null, false);
select is(pg_temp.faixa(pg_temp.fx('p2:h'), '2026-11-17', '2026-11-30'), array['overdue_payable|1|50.00|2026-10-25'],
  'P2 pagamento de 400,00 sem fatura: quita setembro e 250 de outubro; sobra 50,00 vencidos desde 25/10');

reset role;
select pg_temp.cenario('p3', '00000000-0000-0000-0000-0000000127b3');
select public.card_credit_income(pg_temp.fx('p3:card'), '2026-10-10', 500.00, pg_temp.fx('p3:rec'), 'Reembolso', null, null);
select is(pg_temp.faixa(pg_temp.fx('p3:h'), '2026-11-17', '2026-11-30'), '{}'::text[],
  'P3 crédito avulso de 500,00 em outubro: outubro zera e os 200,00 a mais quitam setembro (migration 136)');

-- pagamento de 450,00 vinculado a OUTUBRO (cobre setembro também): a dívida zera
reset role;
select pg_temp.cenario('p4', '00000000-0000-0000-0000-0000000127b4');
select public.debt_pay(pg_temp.fx('p4:card'), '2026-10-26', pg_temp.fx('p4:conta'), 450.00, pg_temp.fatura(pg_temp.fx('p4:card'), '2026-10'), false);
select is((select balance::numeric(14,2) from public.debt_balances(pg_temp.fx('p4:h'), '2026-11-17') where debt_id = pg_temp.fx('p4:card')), 0.00::numeric(14,2),
  'P4 pagamento de 450,00 em outubro: saldo do cartão zera');
-- até a migration 136 (PR B), card_months mandava a sobra só para as faturas seguintes e setembro ficava com 150,00
-- "vencidos" com a dívida zerada; agora a sobra quita setembro
select is(pg_temp.faixa(pg_temp.fx('p4:h'), '2026-11-17', '2026-11-30'), '{}'::text[],
  'P5 dívida zerada: nada vencido (a sobra de outubro quitou setembro, migration 136)');
-- cartão arquivado (saldo 0): nada dele na faixa
select public.debt_archive(pg_temp.fx('p4:card'));
select is(pg_temp.faixa(pg_temp.fx('p4:h'), '2026-11-17', '2026-11-30'), '{}'::text[],
  'A1 cartão arquivado não aparece na faixa (migration 135)');

select * from finish();
rollback;
