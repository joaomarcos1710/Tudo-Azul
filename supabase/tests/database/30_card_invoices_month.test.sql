-- 30_card_invoices_month: migration 023. Total das faturas do mês (por vencimento), somando todos os cartões.
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
create function pg_temp.fat(p_card text, p_label text) returns uuid language sql as $f$
  select id from public.debt_invoices where debt_id = pg_temp.fx(p_card) and label = p_label $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.anon(), pg_temp.sqlstate_of(text),
  pg_temp.fat(text, text) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000030a1', 'ci1@teste.com'),
  ('00000000-0000-0000-0000-0000000030a2', 'ci2@teste.com');

-- Datas fixas de propósito: o total por fatura não depende do dia em que o teste roda.
select pg_temp.login('00000000-0000-0000-0000-0000000030a1');
insert into fixture select 'h', public.create_household('Casa Faturas');
insert into public.accounts (household_id, name, type, initial_balance, opening_date)
  values (pg_temp.fx('h'), 'Banco', 'checking', 5000, '2026-01-01');
insert into fixture select 'bank', id from public.accounts where household_id = pg_temp.fx('h') and name = 'Banco';
insert into fixture select 'cat', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';
-- A: fecha 17, vence 25 (vence no mesmo mês do fechamento). B: fecha 25, vence 5 (vence no mês seguinte).
insert into fixture select 'a', public.create_debt('Cartão A', 'card', '2026-01-01', 0);
insert into fixture select 'b', public.create_debt('Cartão B', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('a'), 17, 25);
select public.set_card_cycle(pg_temp.fx('b'), 25, 5);
select public.card_purchase(pg_temp.fx('a'), '2026-03-10', 100.00, 1, pg_temp.fx('cat'), 'A março');
select public.card_purchase(pg_temp.fx('a'), '2026-03-20', 50.00, 1, pg_temp.fx('cat'), 'A depois do fechamento');
select public.card_purchase(pg_temp.fx('b'), '2026-03-10', 200.00, 1, pg_temp.fx('cat'), 'B março');
select public.card_bill_due('2026-04-30');

-- mês 2026-03: só a fatura de A (vence 25/03); B fecha 25/03 mas vence 05/04
select is((select array[invoices::numeric, total, paid, remaining] from public.card_invoices_month(pg_temp.fx('h'), '2026-03-15')),
          array[1, 100.00, 0, 100.00]::numeric[], 'CI1 março: 1 fatura (A), 100,00; B vence só em abril');
-- mês 2026-04: A (50, fechou 17/04) + B (200, vence 05/04)
select is((select array[invoices::numeric, total, paid, remaining] from public.card_invoices_month(pg_temp.fx('h'), '2026-04-01')),
          array[2, 250.00, 0, 250.00]::numeric[], 'CI2 abril: 2 faturas, 50 + 200 = 250,00 (somado no banco, por vencimento)');
-- qualquer dia do mês vale
select is((select total from public.card_invoices_month(pg_temp.fx('h'), '2026-04-30')), 250.00,
          'CI2.1 o dia dentro do mês não muda o resultado');
-- mês sem fatura: zeros, sem erro
select is((select array[invoices::numeric, total, paid, remaining] from public.card_invoices_month(pg_temp.fx('h'), '2026-07-01')),
          array[0, 0, 0, 0]::numeric[], 'CI3 mês sem fatura: tudo zero');

-- pagamento parcial da fatura de março do cartão A: 40 pagos, faltam 60
select public.debt_pay(pg_temp.fx('a'), '2026-03-25', pg_temp.fx('bank'), 40.00, pg_temp.fat('a', '2026-03'));
select is((select array[invoices::numeric, total, paid, remaining] from public.card_invoices_month(pg_temp.fx('h'), '2026-03-01')),
          array[1, 100.00, 40.00, 60.00]::numeric[], 'CI4 pagamento parcial: total 100, pago 40, falta 60');
select is((select array[invoices::numeric, total, paid, remaining] from public.card_invoices_month(pg_temp.fx('h'), '2026-04-01')),
          array[2, 250.00, 0, 250.00]::numeric[], 'CI4.1 abril não muda com o pagamento de março');

-- é a mesma conta da tela de Cartões: soma das linhas de card_months com vencimento no mês
select is((select sum(m.total) from public.debts d cross join lateral public.card_months(d.id) m
            where d.household_id = pg_temp.fx('h') and m.due_date >= '2026-04-01' and m.due_date < '2026-05-01'),
          (select total from public.card_invoices_month(pg_temp.fx('h'), '2026-04-01')),
          'CI5 igual à soma de card_months (mesma fonte da tela de Cartões)');

-- outra família não vê nada da primeira
select pg_temp.login('00000000-0000-0000-0000-0000000030a2');
insert into fixture select 'h2', public.create_household('Casa Outra');
select is((select array[invoices::numeric, total] from public.card_invoices_month(pg_temp.fx('h'), '2026-04-01')),
          array[0, 0]::numeric[], 'CI6 outra família consultando a família 1: zeros');
select is((select array[invoices::numeric, total] from public.card_invoices_month(pg_temp.fx('h2'), '2026-04-01')),
          array[0, 0]::numeric[], 'CI6.1 a família 2 não tem faturas');

-- anon não executa
select pg_temp.anon();
select is(pg_temp.sqlstate_of($$select * from public.card_invoices_month(pg_temp.fx('h'), '2026-04-01')$$), '42501',
          'CI7 anon não executa');

select * from finish();
rollback;
