-- 32_projected_balances: migration 025. Faturas por vencimento (Calendário) e saldo projetado (total e por conta).
-- Decisão do dono: no saldo "efetuados + planejados" a fatura desconta da conta pagadora do cartão no dia do vencimento.
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
create function pg_temp.anon() returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('role', 'anon', true);
end $f$;
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
-- saldo projetado de uma conta, como texto "efetuado|planejado|faturas|saldo"
create function pg_temp.conta(p_conta text, p_ate date, p_planejado boolean) returns text language sql as $f$
  select realized || '|' || planned || '|' || invoices || '|' || balance
    from public.account_balances_projected(pg_temp.fx('h'), p_ate, p_planejado) where account_id = pg_temp.fx(p_conta) $f$;
create function pg_temp.total(p_ate date, p_planejado boolean) returns text language sql as $f$
  select realized || '|' || planned || '|' || invoices || '|' || unassigned_invoices || '|' || total
    from public.balance_totals_projected(pg_temp.fx('h'), p_ate, p_planejado) $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.anon(), pg_temp.sqlstate_of(text),
  pg_temp.conta(text, date, boolean), pg_temp.total(date, boolean) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000032a1', 'sp1@teste.com'),
  ('00000000-0000-0000-0000-0000000032a2', 'sp2@teste.com');

-- Datas fixas de propósito: nada aqui depende do dia em que o teste roda.
select pg_temp.login('00000000-0000-0000-0000-0000000032a1');
insert into fixture select 'h', public.create_household('Casa Projetada');
insert into public.accounts (household_id, name, type, initial_balance, opening_date) values
  (pg_temp.fx('h'), 'Caixa', 'checking', 1000, '2026-01-01'),
  (pg_temp.fx('h'), 'Inter', 'checking', 500, '2026-01-01');
insert into fixture select 'caixa', id from public.accounts where household_id = pg_temp.fx('h') and name = 'Caixa';
insert into fixture select 'inter', id from public.accounts where household_id = pg_temp.fx('h') and name = 'Inter';
insert into fixture select 'cexp', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';
insert into fixture select 'cinc', id from public.categories where household_id = pg_temp.fx('h') and type = 'income' and system_key is null order by name limit 1;

-- efetuados na Caixa: receita 200 (+) e despesa 50 (-) em março => 1000 + 200 - 50 = 1150
insert into public.transactions (household_id, account_id, category_id, type, amount, date, status) values
  (pg_temp.fx('h'), pg_temp.fx('caixa'), pg_temp.fx('cinc'), 'income', 200, '2026-03-02', 'paid'),
  (pg_temp.fx('h'), pg_temp.fx('caixa'), pg_temp.fx('cexp'), 'expense', 50, '2026-03-03', 'paid');
-- planejados: despesa 100 na Caixa (10/04), receita 300 na Caixa (20/04), transferência 70 Caixa -> Inter (15/04),
--             despesa planejada excluída (lixeira) 999 (nunca conta) e uma de maio (fora do período de abril)
insert into public.transactions (household_id, account_id, category_id, type, amount, date, status) values
  (pg_temp.fx('h'), pg_temp.fx('caixa'), pg_temp.fx('cexp'), 'expense', 100, '2026-04-10', 'planned'),
  (pg_temp.fx('h'), pg_temp.fx('caixa'), pg_temp.fx('cinc'), 'income', 300, '2026-04-20', 'planned'),
  (pg_temp.fx('h'), pg_temp.fx('caixa'), pg_temp.fx('cexp'), 'expense', 999, '2026-04-12', 'planned'),
  (pg_temp.fx('h'), pg_temp.fx('caixa'), pg_temp.fx('cexp'), 'expense', 40, '2026-05-05', 'planned');
insert into public.transactions (household_id, account_id, destination_account_id, type, amount, date, status)
  values (pg_temp.fx('h'), pg_temp.fx('caixa'), pg_temp.fx('inter'), 'transfer', 70, '2026-04-15', 'planned');
update public.transactions set deleted_at = now() where amount = 999;

-- cartões: A paga pela Caixa; B não tem conta escolhida. Ambos fecham dia 17 e vencem dia 25.
insert into fixture select 'a', public.create_debt('Cartão A', 'card', '2026-01-01', 0);
insert into fixture select 'b', public.create_debt('Cartão B', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('a'), 17, 25);
select public.set_card_cycle(pg_temp.fx('b'), 17, 25);
select public.set_card_pay_account(pg_temp.fx('a'), pg_temp.fx('caixa'));
select public.card_purchase(pg_temp.fx('a'), '2026-03-10', 250.00, 1, pg_temp.fx('cexp'), 'A março');   -- fatura 2026-03, vence 25/03
select public.card_purchase(pg_temp.fx('a'), '2026-04-05', 80.00, 1, pg_temp.fx('cexp'), 'A abril');    -- vence 25/04
select public.card_purchase(pg_temp.fx('b'), '2026-04-05', 60.00, 1, pg_temp.fx('cexp'), 'B abril');    -- vence 25/04, sem conta

-- ---- só efetuados: igual a account_balances, planejado e faturas zerados ----
select is(pg_temp.conta('caixa', '2026-04-30', false), '1150.00|0|0|1150.00', 'SP1 só efetuados: Caixa = 1000 + 200 - 50, nada de planejado nem de fatura');
select is(pg_temp.conta('inter', '2026-04-30', false), '500.00|0|0|500.00', 'SP1.1 só efetuados: Inter = 500');
select is((select balance from public.account_balances(pg_temp.fx('h'), '2026-04-30') where account_id = pg_temp.fx('caixa')), 1150.00,
          'SP1.2 e é o mesmo número de account_balances');

-- ---- efetuados + planejados, até 30/04 ----
-- Caixa: planejados -100 +300 -70 = +130; faturas do cartão A que vencem até 30/04: 250 (25/03) + 80 (25/04) = 330
-- saldo = 1150 + 130 - 330 = 950
select is(pg_temp.conta('caixa', '2026-04-30', true), '1150.00|130.00|330.00|950.00', 'SP2 Caixa: efetuado 1150, planejado +130, faturas 330, saldo 950');
-- Inter: recebe a transferência de 70; nenhum cartão paga por ela => 500 + 70
select is(pg_temp.conta('inter', '2026-04-30', true), '500.00|70.00|0|570.00', 'SP3 Inter: +70 da transferência, sem fatura (nenhum cartão a paga)');
-- total: efetuado 1650; planejado líquido 200 (-100 + 300; a transferência soma zero entre as contas);
-- faturas 390 = 330 (A, paga pela Caixa) + 60 (B, SEM conta: só no total); saldo = 1650 + 200 - 390
select is(pg_temp.total('2026-04-30', true), '1650.00|200.00|390.00|60.00|1460.00',
          'SP4 total: 1650 + 200 planejado - 390 de faturas; 60 da cartão B sem conta aparecem só no total');
select is(pg_temp.total('2026-04-30', false), '1650.00|0|0|0|1650.00', 'SP5 só efetuados no total: sem planejado, sem fatura');
-- a soma das contas só fecha com o total quando todo cartão tem conta: aqui a diferença é exatamente a fatura sem conta
select is((select sum(balance) from public.account_balances_projected(pg_temp.fx('h'), '2026-04-30', true)) - 60.00,
          (select total from public.balance_totals_projected(pg_temp.fx('h'), '2026-04-30', true)),
          'SP6 soma dos saldos por conta - fatura sem conta = total');

-- ---- data antes dos planejados: só a fatura de 25/03 já venceu ----
select is(pg_temp.conta('caixa', '2026-03-31', true), '1150.00|0|250.00|900.00', 'SP7 até 31/03: Caixa já deve a fatura de março (250), sem planejado de abril');
select is(pg_temp.total('2026-03-31', true), '1650.00|0|250.00|0|1400.00', 'SP7.1 total até 31/03');
-- ---- data depois: entra o planejado de maio (-40) ----
select is(pg_temp.conta('caixa', '2026-05-31', true), '1150.00|90.00|330.00|910.00', 'SP8 até 31/05: planejado 130 - 40 = 90');

-- ---- pagar a fatura não muda o saldo projetado (o dinheiro sai da conta e a fatura deixa de faltar) ----
select public.card_bill_due('2026-03-31');
select public.debt_pay(pg_temp.fx('a'), '2026-03-25', pg_temp.fx('caixa'), 100.00,
                       (select id from public.debt_invoices where debt_id = pg_temp.fx('a') and label = '2026-03'));
select is(pg_temp.conta('caixa', '2026-04-30', true), '1050.00|130.00|230.00|950.00',
          'SP9 pagou 100 da fatura de março: efetuado 1050, faltam 150 + 80 = 230, saldo projetado continua 950');
select is(pg_temp.total('2026-04-30', true), '1550.00|200.00|290.00|60.00|1460.00', 'SP9.1 total também continua 1460');

-- ---- faturas por vencimento (Calendário) ----
select is((select count(*) from public.card_invoices_due(pg_temp.fx('h'), '2026-04-01', '2026-04-30')), 2::bigint,
          'FD1 abril: 2 faturas vencem (A e B)');
select is((select array[total, paid, remaining] from public.card_invoices_due(pg_temp.fx('h'), '2026-03-01', '2026-03-31') where card_name = 'Cartão A'),
          array[250.00, 100.00, 150.00], 'FD2 a de março do A: total 250, pago 100, falta 150');
select is((select pay_account_id from public.card_invoices_due(pg_temp.fx('h'), '2026-04-01', '2026-04-30') where card_name = 'Cartão A'),
          pg_temp.fx('caixa'), 'FD3 traz a conta pagadora do A');
select is((select pay_account_id from public.card_invoices_due(pg_temp.fx('h'), '2026-04-01', '2026-04-30') where card_name = 'Cartão B'),
          null::uuid, 'FD3.1 o B não tem conta pagadora');
select is((select string_agg(card_name, ',' order by due_date, card_name) from public.card_invoices_due(pg_temp.fx('h'), '2026-03-01', '2026-04-30')),
          'Cartão A,Cartão A,Cartão B', 'FD4 ordenadas por vencimento');
select is((select count(*) from public.card_invoices_due(pg_temp.fx('h'), '2026-06-01', '2026-06-30')), 0::bigint, 'FD5 mês sem fatura: nenhuma linha');

-- ---- outra família e anon ----
select pg_temp.login('00000000-0000-0000-0000-0000000032a2');
insert into fixture select 'h2', public.create_household('Casa Outra');
select is((select count(*) from public.card_invoices_due(pg_temp.fx('h'), '2026-01-01', '2026-12-31')), 0::bigint, 'OF1 outra família não vê faturas');
select is((select count(*) from public.account_balances_projected(pg_temp.fx('h'), '2026-04-30', true)), 0::bigint, 'OF2 outra família não vê saldos');
select is((select count(*) from public.balance_totals_projected(pg_temp.fx('h'), '2026-04-30', true)), 0::bigint, 'OF3 outra família não vê o total');
select pg_temp.anon();
select is(pg_temp.sqlstate_of($$select * from public.account_balances_projected(pg_temp.fx('h'), '2026-04-30', true)$$), '42501', 'AN1 anon não executa o saldo projetado');
select is(pg_temp.sqlstate_of($$select * from public.balance_totals_projected(pg_temp.fx('h'), '2026-04-30', true)$$), '42501', 'AN2 anon não executa o total');
select is(pg_temp.sqlstate_of($$select * from public.card_invoices_due(pg_temp.fx('h'), '2026-01-01', '2026-12-31')$$), '42501', 'AN3 anon não executa as faturas');

select * from finish();
rollback;
