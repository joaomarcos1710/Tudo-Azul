-- 128_card_months_surplus: migration 136. A sobra de uma fatura (pagamento ou crédito avulso acima dela) quita primeiro
-- o que ficou em aberto nas faturas ANTERIORES, da mais antiga para a mais nova, e só o resto vira adiantamento.
-- Antes, a sobra ia só para as seguintes: a anterior ficava "vencida" com a dívida zerada. Falha sem a migration 136.
-- Cada cenário numa família própria (rollback to savepoint desfaria também a contagem do pgTAP).
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
-- "mês|total|pago|saldo anterior|adiantamento que sai" de cada fatura, em ordem. O saldo anterior é o que estava em
-- aberto ANTES dos pagamentos daquela fatura (regra de sempre, teste 21 B1.1)
create function pg_temp.meses(p_card uuid) returns text[] language sql as $f$
  select coalesce(array_agg(label || '|' || total::numeric(14,2) || '|' || paid::numeric(14,2) || '|'
                            || previous_open::numeric(14,2) || '|' || advance_out::numeric(14,2) order by label), '{}')
    from public.card_months(p_card)
$f$;
create function pg_temp.fatura(p_debt uuid, p_label text) returns uuid language sql as $f$
  select id from public.debt_invoices where debt_id = p_debt and label = p_label
$f$;
-- cartão que fecha 18 e vence 25: setembro 150,00, outubro 300,00 e novembro 80,00 (aberta)
create function pg_temp.cenario(p_k text, p_uid uuid) returns void language plpgsql as $f$
declare v_h uuid; v_cat uuid; v_rec uuid; v_conta uuid; v_card uuid;
begin
  insert into auth.users (id, email, email_confirmed_at) values (p_uid, p_k || '@teste128.com', now());
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
  perform public.card_purchase(v_card, '2026-10-20', 80.00, 1, v_cat, 'Novembro');
  perform public.card_bill_due('2026-10-31');
  insert into fixture values (p_k || ':h', v_h), (p_k || ':card', v_card), (p_k || ':conta', v_conta), (p_k || ':rec', v_rec);
end $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.meses(uuid), pg_temp.fatura(uuid, text),
  pg_temp.cenario(text, uuid) to public;

-- 1. Pagamento de 450,00 vinculado a outubro (o total com o saldo anterior): setembro fica pago, nada sobra
reset role;
select pg_temp.cenario('s1', '00000000-0000-0000-0000-0000000128a1');
select public.debt_pay(pg_temp.fx('s1:card'), '2026-10-26', pg_temp.fx('s1:conta'), 450.00, pg_temp.fatura(pg_temp.fx('s1:card'), '2026-10'), false);
select is(pg_temp.meses(pg_temp.fx('s1:card')), array[
  '2026-09|150.00|150.00|0.00|0.00',
  '2026-10|300.00|300.00|150.00|0.00',
  '2026-11|80.00|0.00|0.00|0.00'],
  'S1 sobra de 150,00 em outubro quita setembro; nenhum adiantamento; novembro inteiro a pagar (antes: 80 - 150 de adiantamento)');
-- o saldo da dívida não depende de card_months: igual antes e depois da 136
select is((select balance::numeric(14,2) from public.debt_balances(pg_temp.fx('s1:h'), '2026-11-17') where debt_id = pg_temp.fx('s1:card')), 0.00::numeric(14,2),
  'B1 saldo do cartão (debt_balances) em 17/11 = 450 cobrados - 450 pagos = 0 (novembro ainda não fechou)');

-- 2. Pagamento de 400,00 em outubro: a sobra de 100,00 quita parte de setembro (fica 50,00)
reset role;
select pg_temp.cenario('s2', '00000000-0000-0000-0000-0000000128a2');
select public.debt_pay(pg_temp.fx('s2:card'), '2026-10-26', pg_temp.fx('s2:conta'), 400.00, pg_temp.fatura(pg_temp.fx('s2:card'), '2026-10'), false);
select is(pg_temp.meses(pg_temp.fx('s2:card')), array[
  '2026-09|150.00|100.00|0.00|0.00',
  '2026-10|300.00|300.00|150.00|0.00',
  '2026-11|80.00|0.00|50.00|0.00'],
  'S2 sobra parcial: setembro fica com 50,00 em aberto, que aparece como saldo anterior de novembro');

-- 3. Pagamento de 600,00 em outubro: quita setembro e sobram 150,00 de adiantamento, que abatem novembro
reset role;
select pg_temp.cenario('s3', '00000000-0000-0000-0000-0000000128a3');
select public.debt_pay(pg_temp.fx('s3:card'), '2026-10-26', pg_temp.fx('s3:conta'), 600.00, pg_temp.fatura(pg_temp.fx('s3:card'), '2026-10'), false);
select is(pg_temp.meses(pg_temp.fx('s3:card')), array[
  '2026-09|150.00|150.00|0.00|0.00',
  '2026-10|300.00|300.00|150.00|150.00',
  '2026-11|80.00|80.00|0.00|70.00'],
  'S3 o que sobra depois de quitar as anteriores vira adiantamento das seguintes (como antes)');

-- 4. Crédito avulso de 500,00 em outubro (maior que a fatura): os 200,00 a mais quitam setembro (150) e sobram 50
reset role;
select pg_temp.cenario('s4', '00000000-0000-0000-0000-0000000128a4');
select public.card_credit_income(pg_temp.fx('s4:card'), '2026-10-10', 500.00, pg_temp.fx('s4:rec'), 'Reembolso', null, null);
select is(pg_temp.meses(pg_temp.fx('s4:card')), array[
  '2026-09|150.00|150.00|0.00|0.00',
  '2026-10|0.00|0.00|150.00|50.00',
  '2026-11|80.00|50.00|0.00|0.00'],
  'S4 crédito avulso acima da fatura também quita a anterior antes de virar adiantamento');

-- 5. Sem sobra: nada muda (pagamento exato de setembro)
reset role;
select pg_temp.cenario('s5', '00000000-0000-0000-0000-0000000128a5');
select public.debt_pay(pg_temp.fx('s5:card'), '2026-09-26', pg_temp.fx('s5:conta'), 150.00, pg_temp.fatura(pg_temp.fx('s5:card'), '2026-09'), false);
select is(pg_temp.meses(pg_temp.fx('s5:card')), array[
  '2026-09|150.00|150.00|0.00|0.00',
  '2026-10|300.00|0.00|0.00|0.00',
  '2026-11|80.00|0.00|300.00|0.00'],
  'S5 sem sobra, o resultado é o de sempre');


-- 6. Crédito avulso numa fatura FUTURA (ainda não fechou) não quita hoje a fatura vencida (achado do revisor-dinheiro)
reset role;
select pg_temp.cenario('s6', '00000000-0000-0000-0000-0000000128a6');
select public.debt_pay(pg_temp.fx('s6:card'), '2026-10-26', pg_temp.fx('s6:conta'), 300.00, pg_temp.fatura(pg_temp.fx('s6:card'), '2026-10'), false);
select public.card_credit_income(pg_temp.fx('s6:card'), '2099-12-01', 200.00, pg_temp.fx('s6:rec'), 'Reembolso futuro', null, null);
select is((select paid::numeric(14,2) from public.card_months(pg_temp.fx('s6:card')) where label = '2026-09'), 0.00::numeric(14,2),
  'S6 crédito com data futura (fatura ainda aberta): setembro continua em aberto (a dívida ainda não caiu)');
select is((select advance_out::numeric(14,2) from public.card_months(pg_temp.fx('s6:card')) where label = '2099-12'), 200.00::numeric(14,2),
  'S6 a sobra do crédito futuro segue para a frente, como antes da 136');

-- 7. Duas faturas anteriores em aberto: a sobra quita da mais antiga para a mais nova
reset role;
select pg_temp.cenario('s7', '00000000-0000-0000-0000-0000000128a7');
select public.card_purchase(pg_temp.fx('s7:card'), '2026-08-05', 50.00, 1, (select id from public.categories where household_id = pg_temp.fx('s7:h') and name = 'Mercado'), 'Agosto');
select public.card_bill_due('2026-10-31');
select public.debt_pay(pg_temp.fx('s7:card'), '2026-10-26', pg_temp.fx('s7:conta'), 420.00, pg_temp.fatura(pg_temp.fx('s7:card'), '2026-10'), false);
select is((select array_agg(label || '|' || paid::numeric(14,2) order by label) from public.card_months(pg_temp.fx('s7:card')) where label < '2026-11'),
  array['2026-08|50.00', '2026-09|70.00', '2026-10|300.00'],
  'S7 sobra de 120,00: agosto (50) primeiro, depois 70 de setembro');

-- 8. Exceção das 24 h (decisão do dono, 17/11/2026): anular o pagamento recém-lançado que quitou setembro pela sobra
select pg_temp.login('00000000-0000-0000-0000-0000000128a1');
select lives_ok(format($$select public.debt_void(%L, 'digitei errado')$$,
  (select id from public.debt_events where debt_id = pg_temp.fx('s1:card') and kind = 'payment' and voided_at is null)),
  'V1 o último pagamento, recém-lançado, pode ser anulado mesmo tendo quitado setembro pela sobra');
select is(pg_temp.meses(pg_temp.fx('s1:card')), array[
  '2026-09|150.00|0.00|0.00|0.00',
  '2026-10|300.00|0.00|150.00|0.00',
  '2026-11|80.00|0.00|450.00|0.00'],
  'V2 depois de anular, tudo volta a como estava antes do pagamento');

-- 9. card_months_as_of (a mesma conta numa data de corte) tem a mesma regra (privada: roda como dono, com o usuário da
-- família s2 nos claims, para private.is_member enxergar o cartão)
select pg_temp.login('00000000-0000-0000-0000-0000000128a2');
reset role;
select is((select array_agg(label || '|' || paid::numeric(14,2) order by label) from private.card_months_as_of(pg_temp.fx('s2:card'), '2026-11-17') where label < '2026-11'),
  array['2026-09|100.00', '2026-10|300.00'], 'A1 as_of em 17/11: a sobra de 100 de outubro quita parte de setembro');
select is((select array_agg(label || '|' || paid::numeric(14,2) order by label) from private.card_months_as_of(pg_temp.fx('s2:card'), '2026-10-25') where label < '2026-11'),
  array['2026-09|0.00', '2026-10|0.00'], 'A2 as_of em 25/10 (antes do pagamento): nada pago');

select * from finish();
rollback;
