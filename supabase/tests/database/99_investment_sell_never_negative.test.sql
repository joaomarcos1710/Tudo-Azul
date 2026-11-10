-- 99_investment_sell_never_negative: migration 105 (20261110140000_investment_sell_never_negative.sql).
-- A venda por unidades conferia só a posição até a data dela. Uma venda com data anterior a outra venda já gravada era
-- aceita: a posição ficava negativa e, com conta, o dinheiro voltava duas vezes (patrimônio + dinheiro que não existe).
-- Dados inventados; datas fixas em 2025; fotos em 31/10/2026.
-- Sem a migration este arquivo falha (N1 a N1.4, N4, N5).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create temp table fixture (k text primary key, v uuid);
grant all on fixture to public;
create temp table num (k text primary key, v numeric);
grant all on num to public;
create function pg_temp.fx(p_k text) returns uuid language sql as $f$ select v from fixture where k = p_k $f$;
create function pg_temp.n(p_k text) returns numeric language sql as $f$ select v from num where k = p_k $f$;
create function pg_temp.login(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $f$;
create function pg_temp.err_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $f$;
create function pg_temp.saldo() returns numeric language sql as $f$
  select balance from public.account_balances(pg_temp.fx('h'), date '2026-10-31') where account_id = pg_temp.fx('cc') $f$;
create function pg_temp.nw() returns numeric language sql as $f$
  select net_worth from public.net_worth_with_assets(pg_temp.fx('h'), date '2026-10-31') $f$;
create function pg_temp.qtd(p_k text) returns numeric language sql as $f$
  select coalesce(sum(case when kind = 'buy' then quantity else -quantity end), 0)
    from public.investment_operations where asset_id = pg_temp.fx(p_k) and voided_at is null $f$;
create function pg_temp.ops(p_k text) returns bigint language sql as $f$
  select count(*) from public.investment_operations where asset_id = pg_temp.fx(p_k) $f$;
create function pg_temp.novo(p_k text, p_nome text, p_ticker text) returns void language sql as $f$
  insert into fixture select p_k, public.investment_asset_create(pg_temp.fx('h'), p_nome, p_ticker, 'equity', 'BRL') $f$;
grant execute on function pg_temp.fx(text), pg_temp.n(text), pg_temp.login(uuid), pg_temp.err_of(text), pg_temp.saldo(),
  pg_temp.nw(), pg_temp.qtd(text), pg_temp.ops(text), pg_temp.novo(text, text, text) to public;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000099a1', 'n1@teste.com');
select pg_temp.login('00000000-0000-0000-0000-0000000099a1');
insert into fixture select 'h', public.create_household('Casa da Venda');
insert into public.accounts (household_id, name, type, initial_balance, opening_date, currency_code)
values (pg_temp.fx('h'), 'Corrente de teste', 'checking', 5000, date '2024-12-01', 'BRL');
insert into fixture select 'cc', id from public.accounts where household_id = pg_temp.fx('h') and name = 'Corrente de teste';

-- ---- N1: o caso do dinheiro em dobro ----
select pg_temp.novo('a', 'Ação de teste', 'TEST3');
select public.investment_operation_record(pg_temp.fx('a'), date '2025-01-10', 'buy', 10, 100, 0, null, pg_temp.fx('cc'));
select public.investment_operation_record(pg_temp.fx('a'), date '2025-03-10', 'sell', 10, 100, 0, null, pg_temp.fx('cc'));
select is(pg_temp.saldo(), 5000.00, 'N0 compra de 10 × 100 e venda de 10 × 100: a conta volta a 5.000,00');
select is(pg_temp.qtd('a'), 0::numeric, 'N0.1 posição zerada');
insert into num values ('nw', pg_temp.nw()), ('ops', pg_temp.ops('a'));
select is(pg_temp.err_of($$select public.investment_operation_record(pg_temp.fx('a'), date '2025-02-10', 'sell', 10, 100, 0, null, pg_temp.fx('cc'))$$),
          '23514: esta venda usaria unidades que já foram vendidas depois desta data; confira as vendas posteriores',
          'N1 venda de 10 com data ANTERIOR à venda total já gravada: recusada (23514)');
select is(pg_temp.saldo(), 5000.00, 'N1.1 a conta não recebe outra vez');
select is(pg_temp.qtd('a'), 0::numeric, 'N1.2 a posição não fica negativa');
select is(pg_temp.nw(), pg_temp.n('nw'), 'N1.3 o patrimônio não muda');
select is(pg_temp.ops('a')::numeric, pg_temp.n('ops'), 'N1.4 nenhuma operação foi gravada');

-- ---- N2: o que já era recusado continua com a mensagem de sempre ----
select is(pg_temp.err_of($$select public.investment_operation_record(pg_temp.fx('a'), date '2025-03-11', 'sell', 1, 100)$$),
          '23514: quantidade vendida supera a posição disponível', 'N2 venda depois de zerar: mensagem de sempre');
select is(pg_temp.err_of($$select public.investment_operation_record(pg_temp.fx('a'), date '2025-01-09', 'sell', 1, 100)$$),
          '23514: quantidade vendida supera a posição disponível', 'N2.1 venda antes da primeira compra: mensagem de sempre');

-- ---- N3: venda retroativa que CABE continua aceita ----
select pg_temp.novo('b', 'Fundo de teste', 'FUND11');
select public.investment_operation_record(pg_temp.fx('b'), date '2025-01-10', 'buy', 10, 50);
select public.investment_operation_record(pg_temp.fx('b'), date '2025-03-10', 'sell', 4, 50);
select lives_ok($$select public.investment_operation_record(pg_temp.fx('b'), date '2025-02-10', 'sell', 6, 50)$$,
                'N3 venda retroativa de 6 quando sobram 6 depois da venda de 4: aceita');
select is(pg_temp.qtd('b'), 0::numeric, 'N3.1 posição 10 − 4 − 6 = 0');

-- ---- N4: venda retroativa parcial que estoura só numa data posterior ----
select pg_temp.novo('c', 'FII de teste', 'FIIT11');
select public.investment_operation_record(pg_temp.fx('c'), date '2025-01-10', 'buy', 10, 50);
select public.investment_operation_record(pg_temp.fx('c'), date '2025-03-10', 'sell', 7, 50);
select public.investment_operation_record(pg_temp.fx('c'), date '2025-04-10', 'buy', 5, 50);
-- em 10/02 há 10; depois: 10/03 → 3; 10/04 → 8. Vender 4 em 10/02 deixaria −1 em 10/03, mesmo com 4 no fim.
select is(pg_temp.err_of($$select public.investment_operation_record(pg_temp.fx('c'), date '2025-02-10', 'sell', 4, 50)$$),
          '23514: esta venda usaria unidades que já foram vendidas depois desta data; confira as vendas posteriores',
          'N4 venda retroativa que deixa a posição negativa só numa data do meio (a compra posterior não salva): recusada');
select lives_ok($$select public.investment_operation_record(pg_temp.fx('c'), date '2025-02-10', 'sell', 3, 50)$$,
                'N4.1 a mesma venda com 3 unidades cabe: aceita');
select is(pg_temp.qtd('c'), 5::numeric, 'N4.2 posição 10 − 3 − 7 + 5 = 5');

-- ---- N5: venda anulada devolve as unidades para a conferência ----
select pg_temp.novo('d', 'ETF de teste', 'ETFT11');
select public.investment_operation_record(pg_temp.fx('d'), date '2025-01-10', 'buy', 10, 20);
insert into fixture select 'd_v', public.investment_operation_record(pg_temp.fx('d'), date '2025-03-10', 'sell', 10, 20);
select is(pg_temp.err_of($$select public.investment_operation_record(pg_temp.fx('d'), date '2025-02-10', 'sell', 10, 20)$$),
          '23514: esta venda usaria unidades que já foram vendidas depois desta data; confira as vendas posteriores',
          'N5 com a venda de 10/03 valendo, a venda retroativa é recusada');
select public.investment_operation_void(pg_temp.fx('d_v'), 'venda errada de teste');
select lives_ok($$select public.investment_operation_record(pg_temp.fx('d'), date '2025-02-10', 'sell', 10, 20)$$,
                'N5.1 anulada a venda de 10/03, a venda de 10/02 é aceita');
select is(pg_temp.qtd('d'), 0::numeric, 'N5.2 posição zerada, não negativa');

-- ---- N6: compra e venda no mesmo dia e a segurança não mudam ----
select pg_temp.novo('e', 'Mesmo dia de teste', 'DIAT3');
select public.investment_operation_record(pg_temp.fx('e'), date '2025-01-10', 'buy', 5, 10);
select lives_ok($$select public.investment_operation_record(pg_temp.fx('e'), date '2025-01-10', 'sell', 5, 10)$$,
                'N6 comprar e vender tudo no mesmo dia: aceita');
select ok(not has_function_privilege('anon', 'public.investment_operation_record(uuid,date,text,numeric,numeric,numeric,text,uuid)', 'execute')
          and has_function_privilege('authenticated', 'public.investment_operation_record(uuid,date,text,numeric,numeric,numeric,text,uuid)', 'execute'),
          'N6.1 anon continua sem execute; authenticated com execute');

select * from finish();
rollback;
