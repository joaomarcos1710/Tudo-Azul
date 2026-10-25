-- 18_card_limit: migration 011. Limite do cartão e limite disponível (limite − dívida − parcelas futuras + crédito).
-- Datas fixas e card_bill_due com limite explícito, para o teste não depender do dia em que roda (hoje real >= 24/10/2026).
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
create function pg_temp.lim(p_debt uuid) returns text language sql as $f$
  select credit_limit::numeric(14,2) || '|' || committed::numeric(14,2) || '|' || available::numeric(14,2)
    from public.card_limits(pg_temp.fx('h'), '2026-10-31') where debt_id = p_debt $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.sqlstate_of(text), pg_temp.lim(uuid) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000018a1', 'l1@teste.com'),
  ('00000000-0000-0000-0000-0000000018a2', 'l2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000018a1');
insert into fixture select 'h', public.create_household('Casa do Limite');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 5000.00, '2026-10-01') returning id)
  insert into fixture select 'bank', id from i;
insert into fixture select 'cat', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';

-- Cartão A: compra de 200,00 em 2x ainda por cobrar (17/11 e 17/12): 200,00 de parcelas futuras
insert into fixture select 'a', public.create_debt('Cartão A', 'card', '2026-10-01', 0);
select public.set_card_cycle(pg_temp.fx('a'), 17, 25);
select public.card_purchase(pg_temp.fx('a'), '2026-10-20', 200.00, 2, pg_temp.fx('cat'), 'Compra A');
-- Cartão B: fatura fechada de 200,00 (17/09 e 17/10 já cobradas)
insert into fixture select 'b', public.create_debt('Cartão B', 'card', '2026-07-01', 0);
select public.set_card_cycle(pg_temp.fx('b'), 17, 25);
select public.card_purchase(pg_temp.fx('b'), '2026-08-20', 200.00, 2, pg_temp.fx('cat'), 'Compra B');
select public.card_bill_due('2026-10-31');

select is((select count(*) from public.card_limits(pg_temp.fx('h'), '2026-10-31')), 0::bigint,
          'L1 sem limite definido, o cartão não aparece em card_limits');

select public.set_card_limit(pg_temp.fx('a'), 1000.00);
select public.set_card_limit(pg_temp.fx('b'), 500.00);
select is(pg_temp.lim(pg_temp.fx('a')), '1000.00|200.00|800.00', 'L2 parcelas futuras de 200,00 comprometem o limite: sobram 800,00');
select is(pg_temp.lim(pg_temp.fx('b')), '500.00|200.00|300.00', 'L3 fatura fechada de 200,00 compromete o limite: sobram 300,00');

-- pagar a fatura devolve limite
select public.debt_pay(pg_temp.fx('b'), '2026-10-26', pg_temp.fx('bank'), 100.00);
select is(pg_temp.lim(pg_temp.fx('b')), '500.00|100.00|400.00', 'L4 pagar 100,00 da fatura libera 100,00 de limite');

-- pagamento adiantado vira crédito e também libera limite
select public.debt_pay(pg_temp.fx('a'), '2026-10-24', pg_temp.fx('bank'), 120.00);
select is(pg_temp.lim(pg_temp.fx('a')), '1000.00|80.00|920.00', 'L5 adiantamento de 120,00 (crédito no cartão) abate o comprometido');

-- passou do limite: disponível negativo, sem recusar nada
select public.set_card_limit(pg_temp.fx('a'), 50.00);
select is(pg_temp.lim(pg_temp.fx('a')), '50.00|80.00|-30.00', 'L6 limite menor que o comprometido: disponível negativo (aviso, não bloqueio)');

-- trocar o limite não mexe em dívida nem em saldo
select is((select debt from public.debt_balances(pg_temp.fx('h'), '2026-10-31') where debt_id = pg_temp.fx('b')), 100.00::numeric,
          'L7 a dívida do cartão B continua 100,00 depois de mexer nos limites');

-- limpar o limite tira o cartão da lista
select public.set_card_limit(pg_temp.fx('a'), null);
select is((select count(*) from public.card_limits(pg_temp.fx('h'), '2026-10-31') where debt_id = pg_temp.fx('a')), 0::bigint,
          'L8 limite nulo: o cartão deixa de aparecer');

-- validações
select is(pg_temp.sqlstate_of(format($$select public.set_card_limit(%L, 0)$$, pg_temp.fx('a'))), '22023', 'L9 limite zero é recusado');
select is(pg_temp.sqlstate_of(format($$select public.set_card_limit(%L, -10)$$, pg_temp.fx('a'))), '22023', 'L10 limite negativo é recusado');
select is(pg_temp.sqlstate_of(format($$select public.set_card_limit(%L, 10.005)$$, pg_temp.fx('a'))), '22003', 'L11 mais de 2 casas decimais é recusado');
insert into fixture select 'loan', public.create_debt('Empréstimo', 'loan', '2026-10-01', 0);
select is(pg_temp.sqlstate_of(format($$select public.set_card_limit(%L, 1000)$$, pg_temp.fx('loan'))), '23514', 'L12 empréstimo não tem limite de cartão');
select is(pg_temp.sqlstate_of(format($$update public.debts set credit_limit = 1000 where id = %L$$, pg_temp.fx('loan'))), '42501',
          'L13 o cliente não grava credit_limit direto (só pela função)');

-- isolamento entre famílias
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000018a2');
insert into fixture select 'h2', public.create_household('Casa Alheia');
select is(pg_temp.sqlstate_of(format($$select public.set_card_limit(%L, 999)$$, pg_temp.fx('b'))), '42501', 'L14 outra família não mexe no limite do meu cartão');
select is((select count(*) from public.card_limits(pg_temp.fx('h'), '2026-10-31')), 0::bigint, 'L15 outra família não lê os meus limites');
reset role;

select pg_temp.login('00000000-0000-0000-0000-0000000018a1');
select is(pg_temp.sqlstate_of($$set constraints all immediate$$), null, 'L16 as checagens adiadas passam');

select * from finish();
rollback;
