-- 55_account_currency: migration 055. Moeda da conta (multimoeda F1): saldos separados por moeda, troca de moeda só
-- sem movimento e bloqueio provisório de movimento em conta que não é BRL.
-- Datas relativas a hoje em São Paulo; nada depende de data fixa nem do fuso do servidor. Sem dado real.
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
create function pg_temp.hoje() returns date language sql as $f$ select (now() at time zone 'America/Sao_Paulo')::date $f$;
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
create function pg_temp.erro_de(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlerrm; end $f$;
-- a moeda vai por SQL dinâmico: sem a migration a coluna não existe e o teste falha nas asserções, sem abortar o arquivo
create function pg_temp.conta(p_k text, p_nome text, p_saldo numeric, p_moeda text) returns uuid language plpgsql as $f$
declare v uuid;
begin
  execute format('insert into public.accounts (household_id, name, type, initial_balance, opening_date, currency_code)
                  values (%L, %L, %L, %s, %L, %L) returning id',
                 pg_temp.fx('h'), p_nome, 'checking', p_saldo, pg_temp.hoje() - 30, p_moeda) into v;
  insert into fixture values (p_k, v);
  return v;
end $f$;
create function pg_temp.por_moeda(p_h uuid, p_moeda text) returns text language plpgsql as $f$
declare r text;
begin
  execute 'select total::text || ''|'' || total_active::text from public.balance_totals_by_currency($1, $2) where currency_code = $3'
    into r using p_h, pg_temp.hoje(), p_moeda;
  return r;
end $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.hoje(), pg_temp.sqlstate_of(text),
  pg_temp.erro_de(text), pg_temp.conta(text, text, numeric, text), pg_temp.por_moeda(uuid, text) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000055a1', 'a1@teste.com'),
  ('00000000-0000-0000-0000-0000000055a2', 'a2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000055a1');
insert into fixture select 'h', public.create_household('Casa Moedas');
insert into fixture select 'cexp', id from public.categories
 where household_id = pg_temp.fx('h') and system_key = 'uncategorized' and type = 'expense';

-- 1. criação e saldos separados ------------------------------------------------
select lives_ok($$select pg_temp.conta('brl', 'Corrente', 1000, 'BRL')$$, 'M1 cria conta em BRL');
select lives_ok($$select pg_temp.conta('usd', 'Conta em dólar', 250.50, 'USD')$$, 'M2 cria conta em USD com saldo inicial');
select lives_ok($$select pg_temp.conta('eur', 'Conta em euro', 80, 'EUR')$$, 'M3 cria conta em EUR');
select is(pg_temp.sqlstate_of($$select pg_temp.conta('xxx', 'Moeda inventada', 1, 'XYZ')$$), '23514', 'M4 moeda fora do catálogo é recusada');

select is((select total from public.balance_totals(pg_temp.fx('h'), pg_temp.hoje())), 1000.00::numeric,
          'M5 balance_totals soma só as contas BRL (a USD e a EUR ficam de fora)');
select is((select sum(total) from public.balance_totals_by_type(pg_temp.fx('h'), pg_temp.hoje())), 1000.00::numeric,
          'M6 balance_totals_by_type também só BRL');
select is((select available from public.net_worth(pg_temp.fx('h'), pg_temp.hoje())), 1000.00::numeric,
          'M7 net_worth: disponível só BRL');
select is((select available from public.net_worth_with_assets(pg_temp.fx('h'), pg_temp.hoje())), 1000.00::numeric,
          'M8 net_worth_with_assets: disponível só BRL');
select is((select realized from public.balance_totals_projected(pg_temp.fx('h'), pg_temp.hoje(), true)), 1000.00::numeric,
          'M9 balance_totals_projected: realizado só BRL');
select is(pg_temp.por_moeda(pg_temp.fx('h'), 'USD'), '250.50|250.50', 'M10 balance_totals_by_currency mostra o USD sem converter');
select is(pg_temp.por_moeda(pg_temp.fx('h'), 'EUR'), '80.00|80.00', 'M11 ...e o EUR');
select is(pg_temp.por_moeda(pg_temp.fx('h'), 'BRL'), '1000.00|1000.00', 'M12 ...e o BRL, igual ao balance_totals');
select is((select balance::text || ' ' || currency_code from public.account_balances(pg_temp.fx('h'), pg_temp.hoje())
            where account_id = pg_temp.fx('usd')), '250.50 USD', 'M13 account_balances: saldo da conta na moeda dela');
select is((select balance::text || ' ' || currency_code from public.account_balances_projected(pg_temp.fx('h'), pg_temp.hoje(), true)
            where account_id = pg_temp.fx('usd')), '250.50 USD', 'M14 account_balances_projected também traz a moeda');

-- arquivar a conta EUR: sai do total das ativas da moeda, continua no total
update public.accounts set active = false where id = pg_temp.fx('eur');
select is(pg_temp.por_moeda(pg_temp.fx('h'), 'EUR'), '80.00|0', 'M15 arquivada: entra no total da moeda, não no das ativas');
update public.accounts set active = true where id = pg_temp.fx('eur');

-- 2. bloqueio provisório ------------------------------------------------------
-- Receita e despesa em conta USD foram liberadas na F2 (migration 056, teste 56); aqui fica o que segue recusado.
select is(pg_temp.sqlstate_of($$insert into public.transactions (household_id, type, status, date, amount, description, account_id, destination_account_id)
  values (pg_temp.fx('h'), 'transfer', 'paid', pg_temp.hoje(), 10, 'Câmbio', pg_temp.fx('brl'), pg_temp.fx('eur'))$$), '23514',
  'B1 transferência BRL → EUR é recusada (F3)');
select matches(pg_temp.erro_de($$insert into public.transactions (household_id, type, status, date, amount, description, account_id, destination_account_id)
  values (pg_temp.fx('h'), 'transfer', 'paid', pg_temp.hoje(), 10, 'Câmbio', pg_temp.fx('brl'), pg_temp.fx('eur'))$$),
  'moedas diferentes', 'B1.1 com mensagem clara em português');
select is(pg_temp.sqlstate_of($$insert into public.transactions (household_id, type, status, date, amount, description, account_id, destination_account_id)
  values (pg_temp.fx('h'), 'transfer', 'paid', pg_temp.hoje(), 10, 'Envio', pg_temp.fx('brl'), pg_temp.fx('usd'))$$), '23514',
  'B2 transferência para conta USD (destino) é recusada');
select is(pg_temp.sqlstate_of($$insert into public.transactions (household_id, type, status, date, amount, description, account_id, destination_account_id)
  values (pg_temp.fx('h'), 'transfer', 'paid', pg_temp.hoje(), 10, 'Volta', pg_temp.fx('usd'), pg_temp.fx('brl'))$$), '23514',
  'B3 transferência saindo de conta USD (origem) é recusada');
select is(pg_temp.sqlstate_of($$select public.recurrence_create('transfer', 'Envio mensal', 10, 5, pg_temp.hoje(), pg_temp.fx('brl'), pg_temp.fx('usd'), null, null)$$),
  '23514', 'B4 recorrente de transferência BRL → USD é recusado');
insert into fixture select 'loan', public.create_debt('Empréstimo teste', 'loan', pg_temp.hoje() - 10, 0);
select is(pg_temp.sqlstate_of($$select public.debt_loan_event(pg_temp.fx('loan'), pg_temp.hoje(), 'disbursement', pg_temp.fx('usd'), 100)$$),
  '23514', 'B5 evento de dívida em conta USD é recusado');
insert into fixture select 'card', public.create_card('Cartão teste', pg_temp.hoje() - 10, 0, 5, 12, null, null, null);
select is(pg_temp.sqlstate_of($$select public.set_card_pay_account(pg_temp.fx('card'), pg_temp.fx('usd'))$$),
  '23514', 'B6 conta USD não pode ser a conta de pagamento do cartão');
select lives_ok($$select public.set_card_pay_account(pg_temp.fx('card'), pg_temp.fx('brl'))$$, 'B7 conta BRL continua aceita para pagar o cartão');
select lives_ok($$insert into public.transactions (household_id, type, status, date, amount, description, account_id, category_id)
  values (pg_temp.fx('h'), 'expense', 'paid', pg_temp.hoje(), 10, 'Pão', pg_temp.fx('brl'), pg_temp.fx('cexp'))$$,
  'B8 lançamento em conta BRL segue normal');
select is((select total from public.balance_totals(pg_temp.fx('h'), pg_temp.hoje())), 990.00::numeric, 'B9 e só ele mexe no total BRL');

-- 3. trocar a moeda ------------------------------------------------------------
select lives_ok($$update public.accounts set currency_code = 'EUR' where id = pg_temp.fx('usd')$$, 'C1 conta sem movimento troca de moeda');
select is((select currency_code from public.accounts where id = pg_temp.fx('usd')), 'EUR', 'C1.1 trocou');
select lives_ok($$update public.accounts set currency_code = 'USD' where id = pg_temp.fx('usd')$$, 'C1.2 e volta');
select is(pg_temp.sqlstate_of($$update public.accounts set currency_code = 'USD' where id = pg_temp.fx('brl')$$), '23514',
  'C2 conta com lançamento não troca de moeda');
-- lançamento na lixeira também conta como movimento
select pg_temp.conta('lix', 'Conta com lixeira', 0, 'BRL');
insert into public.transactions (household_id, type, status, date, amount, description, account_id, category_id)
values (pg_temp.fx('h'), 'expense', 'paid', pg_temp.hoje(), 5, 'Apagado', pg_temp.fx('lix'), pg_temp.fx('cexp'));
update public.transactions set deleted_at = now() where account_id = pg_temp.fx('lix');
select is(pg_temp.sqlstate_of($$update public.accounts set currency_code = 'USD' where id = pg_temp.fx('lix')$$), '23514',
  'C3 lançamento na lixeira também impede trocar a moeda');
-- conta de pagamento do cartão (sem nenhum lançamento) também
select pg_temp.conta('pag', 'Conta do cartão', 0, 'BRL');
select public.set_card_pay_account(pg_temp.fx('card'), pg_temp.fx('pag'));
select is(pg_temp.sqlstate_of($$update public.accounts set currency_code = 'USD' where id = pg_temp.fx('pag')$$), '23514',
  'C4 conta usada para pagar cartão não troca de moeda');
-- recorrente também
select pg_temp.conta('rec', 'Conta do recorrente', 0, 'BRL');
select public.recurrence_create('expense', 'Luz', 10, 5, pg_temp.hoje() + 40, pg_temp.fx('rec'), null, null, pg_temp.fx('cexp'));
select is(pg_temp.sqlstate_of($$update public.accounts set currency_code = 'USD' where id = pg_temp.fx('rec')$$), '23514',
  'C5 conta com recorrente não troca de moeda');
-- evento de dívida também
select pg_temp.conta('dev', 'Conta do empréstimo', 0, 'BRL');
select public.debt_loan_event(pg_temp.fx('loan'), pg_temp.hoje(), 'disbursement', pg_temp.fx('dev'), 100);
select is(pg_temp.sqlstate_of($$update public.accounts set currency_code = 'USD' where id = pg_temp.fx('dev')$$), '23514',
  'C6 conta com evento de dívida não troca de moeda');

-- 4. família vizinha -----------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000055a2');
select is((select count(*) from public.balance_totals_by_currency(pg_temp.fx('h'), pg_temp.hoje())), 0::bigint,
  'V1 quem não é da família não vê nada no total por moeda');
insert into fixture select 'h2', public.create_household('Casa Vizinha');
select is((select count(*) from public.balance_totals_by_currency(pg_temp.fx('h2'), pg_temp.hoje())), 0::bigint,
  'V2 a família vizinha (sem contas) não enxerga as moedas da outra');
select is((select count(*) from public.accounts where household_id = pg_temp.fx('h')), 0::bigint, 'V3 nem as contas');

select ok(has_function_privilege('service_role', 'public.balance_totals_projected(uuid, date, boolean)', 'execute'),
  'G1 o aviso diário (service_role) continua podendo chamar balance_totals_projected depois de recriada');

select * from finish();
rollback;
