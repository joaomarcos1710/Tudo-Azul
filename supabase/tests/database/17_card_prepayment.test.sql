-- 17_card_prepayment: migration 010. Pagamento adiantado de CARTÃO vira crédito no cartão: sai da conta,
-- não é despesa, não muda o patrimônio, abate as próximas faturas; empréstimo e amortização extra
-- continuam sem poder passar do saldo devedor. Datas fixas e card_bill_due com limite explícito, para o teste
-- não depender do dia em que roda (hoje real >= 24/10/2026).
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
create function pg_temp.conta(p_acc uuid) returns numeric language sql as $f$
  select balance from public.account_balances(pg_temp.fx('h'), '2026-10-31') where account_id = p_acc $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.sqlstate_of(text), pg_temp.conta(uuid) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000017a1', 'p1@teste.com'),
  ('00000000-0000-0000-0000-0000000017a2', 'p2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000017a1');
insert into fixture select 'h', public.create_household('Casa Adiantada');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 5000.00, '2026-10-01') returning id)
  insert into fixture select 'bank', id from i;
insert into fixture select 'cat', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';

-- Cartão A: sem nenhuma fatura fechada. Compra de 200,00 em 2x no dia 20/10 (fecha dia 17): parcelas 17/11 e 17/12.
insert into fixture select 'a', public.create_debt('Cartão A', 'card', '2026-10-01', 0);
select public.set_card_cycle(pg_temp.fx('a'), 17, 25);
select public.card_purchase(pg_temp.fx('a'), '2026-10-20', 200.00, 2, pg_temp.fx('cat'), 'Compra A');
select public.card_bill_due('2026-10-31');

-- antes
create temp table antes as
  select (select available from public.net_worth(pg_temp.fx('h'), '2026-10-31')) as disponivel,
         (select net_worth from public.net_worth(pg_temp.fx('h'), '2026-10-31')) as patrimonio,
         (select expense_paid from public.period_summary(pg_temp.fx('h'), '2026-10-01', '2026-10-31')) as despesa;
grant select on antes to public;

select is(pg_temp.sqlstate_of(format($$select public.debt_pay(%L, '2026-10-24', %L, 120.00)$$, pg_temp.fx('a'), pg_temp.fx('bank'))),
          null, 'PA1 sem dívida nenhuma, pagar 120,00 adiantado funciona (antes: erro "acima do saldo devedor")');

select is((select debt from public.debt_balances(pg_temp.fx('h'), '2026-10-31') where debt_id = pg_temp.fx('a')), 0.00::numeric,
          'PA2 a dívida do cartão continua 0,00');
select is((select credit_receivable from public.debt_balances(pg_temp.fx('h'), '2026-10-31') where debt_id = pg_temp.fx('a')), 120.00::numeric,
          'PA3 o excedente vira crédito no cartão: 120,00');
select is((select planned_remaining from public.debt_balances(pg_temp.fx('h'), '2026-10-31') where debt_id = pg_temp.fx('a')), 200.00::numeric,
          'PA4 as parcelas futuras continuam 200,00 (o crédito não as apaga, só as abate quando cobradas)');
select is(pg_temp.conta(pg_temp.fx('bank')), 4880.00::numeric, 'PA5 o dinheiro saiu da conta na hora (5000 − 120)');
select is((select net_worth from public.net_worth(pg_temp.fx('h'), '2026-10-31')), (select patrimonio from antes),
          'PA6 o patrimônio não muda (a conta cai, o crédito do cartão sobe)');
select is((select expense_paid from public.period_summary(pg_temp.fx('h'), '2026-10-01', '2026-10-31')), (select despesa from antes),
          'PA7 pagamento adiantado NÃO é despesa');

-- as faturas seguintes consomem o crédito sozinhas (relatório existente, card_months)
select is((select array_agg(label || '|' || paid || '|' || advance_in || '|' || advance_out order by label) from public.card_months(pg_temp.fx('a'))),
          array['2026-11|100.00|120.00|20.00', '2026-12|20.00|20.00|0.00'],
          'PA8 fatura de nov paga com 100,00 do crédito (sobram 20,00); dez usa os 20,00 que restavam');

-- mais um adiantamento, agora maior que TUDO que o cartão tem a pagar: o banco aceita (a tela avisa)
select is(pg_temp.sqlstate_of(format($$select public.debt_pay(%L, '2026-10-25', %L, 500.00)$$, pg_temp.fx('a'), pg_temp.fx('bank'))),
          null, 'PA9 pagar mais que tudo o que o cartão deve é aceito (vira crédito; é decisão do dono, a tela confirma)');
select is((select credit_receivable from public.debt_balances(pg_temp.fx('h'), '2026-10-31') where debt_id = pg_temp.fx('a')), 620.00::numeric,
          'PA10 crédito acumulado: 120 + 500');

-- Cartão B: fatura já fechada (passado), pagamento maior que a dívida: o excedente vira crédito
insert into fixture select 'b', public.create_debt('Cartão B', 'card', '2026-07-01', 0);
select public.set_card_cycle(pg_temp.fx('b'), 17, 25);
select public.card_purchase(pg_temp.fx('b'), '2026-08-20', 200.00, 2, pg_temp.fx('cat'), 'Compra B');
select is(public.card_bill_due('2026-10-31'), 2, 'PB0 as duas parcelas (17/09 e 17/10) foram cobradas');
select is((select debt from public.debt_balances(pg_temp.fx('h'), '2026-10-31') where debt_id = pg_temp.fx('b')), 200.00::numeric, 'PB1 dívida de 200,00');
select is(pg_temp.sqlstate_of(format($$select public.debt_pay(%L, '2026-10-26', %L, 250.00)$$, pg_temp.fx('b'), pg_temp.fx('bank'))),
          null, 'PB2 pagar 250,00 com dívida de 200,00 funciona');
select is((select debt::numeric(14,2) || '|' || credit_receivable::numeric(14,2) from public.debt_balances(pg_temp.fx('h'), '2026-10-31') where debt_id = pg_temp.fx('b')),
          '0.00|50.00', 'PB3 quita a dívida e sobra 50,00 de crédito');

-- Cartão C: adiantei e depois devolvi o crédito em dinheiro; a fatura NÃO pode continuar aparecendo paga
insert into fixture select 'c', public.create_debt('Cartão C', 'card', '2026-10-01', 0);
select public.set_card_cycle(pg_temp.fx('c'), 17, 25);
select public.card_purchase(pg_temp.fx('c'), '2026-10-20', 200.00, 2, pg_temp.fx('cat'), 'Compra C');
select public.debt_pay(pg_temp.fx('c'), '2026-10-24', pg_temp.fx('bank'), 150.00);
select is((select array_agg(label || '|' || paid || '|' || advance_in order by label) from public.card_months(pg_temp.fx('c'))),
          array['2026-11|100.00|150.00', '2026-12|50.00|50.00'], 'PH1 com 150 adiantados, nov paga 100 e dez paga 50');
select public.debt_return(pg_temp.fx('c'), '2026-10-25', pg_temp.fx('bank'), 150.00);
select is((select credit_receivable from public.debt_balances(pg_temp.fx('h'), '2026-10-31') where debt_id = pg_temp.fx('c')), 0::numeric,
          'PH2 devolvi todo o crédito: o banco zera o crédito do cartão');
select is((select array_agg(label || '|' || paid || '|' || advance_in order by label) from public.card_months(pg_temp.fx('c'))),
          array['2026-11|0|0', '2026-12|0|0'], 'PH3 as faturas voltam a aparecer NÃO pagas (antes do ajuste ficavam pagas sem estar)');

-- o que NÃO mudou: empréstimo e amortização extra não passam do saldo
insert into fixture select 'loan', public.create_debt('Empréstimo', 'loan', '2026-10-01', 0);
select is(pg_temp.sqlstate_of(format($$select public.debt_pay(%L, '2026-10-24', %L, 10.00)$$, pg_temp.fx('loan'), pg_temp.fx('bank'))),
          '23514', 'PC1 empréstimo continua sem poder pagar acima do saldo devedor');
select is(pg_temp.sqlstate_of(format($$select public.debt_pay(%L, '2026-10-24', %L, 10.00, null, true)$$, pg_temp.fx('a'), pg_temp.fx('bank'))),
          '23514', 'PC2 amortização extra em cartão continua sem poder passar do saldo');
insert into fixture select 'fin', public.create_debt('Financiamento', 'financing', '2026-10-01', 0);
select is(pg_temp.sqlstate_of(format($$select public.debt_pay(%L, '2026-10-24', %L, 10.00)$$, pg_temp.fx('fin'), pg_temp.fx('bank'))),
          '23514', 'PC3 financiamento também continua sem poder pagar acima do saldo devedor');

-- Cartão D: anular o pagamento adiantado (tela de correção) devolve o dinheiro e zera o crédito
create temp table saldo_antes_d as select pg_temp.conta(pg_temp.fx('bank')) as v;
grant all on saldo_antes_d to public;
insert into fixture select 'dcard', public.create_debt('Cartão D', 'card', '2026-10-01', 0);
select public.set_card_cycle(pg_temp.fx('dcard'), 17, 25);
select public.debt_pay(pg_temp.fx('dcard'), '2026-10-24', pg_temp.fx('bank'), 100.00);
select is((select credit_receivable from public.debt_balances(pg_temp.fx('h'), '2026-10-31') where debt_id = pg_temp.fx('dcard')), 100.00::numeric,
          'PF0 pagamento sem dívida vira crédito de 100');
select public.debt_void((select id from public.debt_events where debt_id = pg_temp.fx('dcard') and kind = 'payment' and voided_at is null),
          'anulado pela tela (correção)');
select is((select credit_receivable from public.debt_balances(pg_temp.fx('h'), '2026-10-31') where debt_id = pg_temp.fx('dcard')), 0::numeric,
          'PF1 anular o pagamento zera o crédito do cartão');
select is(pg_temp.conta(pg_temp.fx('bank')), (select v from saldo_antes_d), 'PF2 o dinheiro voltou para a conta: saldo igual ao de antes do pagamento');

-- outra família não paga o meu cartão
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000017a2');
insert into fixture select 'h2', public.create_household('Casa Alheia');
select is(pg_temp.sqlstate_of(format($$select public.debt_pay(%L, '2026-10-24', %L, 1.00)$$, pg_temp.fx('a'), pg_temp.fx('bank'))),
          '42501', 'PD1 outra família não consegue pagar o meu cartão');
reset role;

-- em produção a checagem de dívida é adiada ao COMMIT; força o disparo agora
select pg_temp.login('00000000-0000-0000-0000-0000000017a1');
select is(pg_temp.sqlstate_of($$set constraints all immediate$$), null, 'PE1 as checagens adiadas passam com o crédito no cartão');

select * from finish();
rollback;
