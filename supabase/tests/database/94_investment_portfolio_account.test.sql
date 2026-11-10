-- 94_investment_portfolio_account: migration 100 (20261110090000_investment_portfolio_account.sql). Decisão do dono de
-- 10/11/2026: comprar investimento tira o dinheiro da conta sem virar despesa, e uma conta antiga de investimento pode
-- ser "movida para a carteira". O dinheiro vai para a conta INTERNA "Carteira de investimentos" (uma por família), que
-- fica fora de todas as somas (o patrimônio já soma os ativos desde a 099). Dados inventados; datas relativas a hoje
-- em São Paulo (a RPC de operação recusa data futura).
-- Sem a migration este arquivo falha (não existem a coluna system_role, o parâmetro p_account nem
-- account_move_to_portfolio).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create temp table fixture (k text primary key, v uuid);
grant all on fixture to public;
create temp table num (k text primary key, v numeric);
grant all on num to public;
create temp table txt (k text primary key, v text);
grant all on txt to public;
create function pg_temp.fx(p_k text) returns uuid language sql as $f$ select v from fixture where k = p_k $f$;
create function pg_temp.n(p_k text) returns numeric language sql as $f$ select v from num where k = p_k $f$;
create function pg_temp.login(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $f$;
create function pg_temp.hoje() returns date language sql as $f$ select (now() at time zone 'America/Sao_Paulo')::date $f$;
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
create function pg_temp.err_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $f$;
-- saldo de uma conta hoje (nulo se account_balances não a devolve)
create function pg_temp.saldo(p_h uuid, p_acc uuid) returns numeric language sql as $f$
  select balance from public.account_balances(p_h, pg_temp.hoje()) where account_id = p_acc $f$;
-- a Carteira da família (pela tabela, não pelas somas)
create function pg_temp.carteira(p_h uuid) returns uuid language sql as $f$
  select id from public.accounts where household_id = p_h and system_role = 'investment_portfolio' $f$;
-- foto do patrimônio: Início e Análises
create function pg_temp.foto(p_h uuid, p_pre text) returns void language sql as $f$
  insert into num
  select p_pre || x.k, x.v from public.home_indicators(p_h, pg_temp.hoje()) hi
   cross join lateral (values ('net_worth', hi.net_worth), ('available', hi.available), ('accounts_total', hi.accounts_total),
                              ('investments', hi.investments), ('investments_liquid', hi.investments_liquid),
                              ('investments_restricted', hi.investments_restricted), ('closed_months', hi.closed_months::numeric)) x(k, v)
  union all
  select p_pre || 'nw_net_worth', nw.net_worth from public.net_worth_with_assets(p_h, pg_temp.hoje()) nw
  on conflict (k) do update set v = excluded.v $f$;
grant execute on all functions in schema pg_temp to public;

-- ---- S: forma e permissões ----
select has_column('public', 'accounts', 'system_role', 'S1 accounts.system_role existe');
select col_is_null('public', 'accounts', 'system_role', 'S1.1 e é opcional (contas comuns ficam nulas)');
select has_column('public', 'investment_operations', 'transaction_id', 'S2 investment_operations.transaction_id existe');
select ok(not has_column_privilege('authenticated', 'public.accounts', 'system_role', 'INSERT'), 'S3 o cliente não informa system_role');
select ok(not has_column_privilege('authenticated', 'public.accounts', 'system_role', 'UPDATE'), 'S3.1 nem altera');
select ok(not has_column_privilege('authenticated', 'public.investment_operations', 'transaction_id', 'UPDATE'),
          'S3.2 nem escreve o vínculo da operação');
select is(pg_get_function_identity_arguments('public.investment_operation_record'::regproc),
          'p_asset uuid, p_date date, p_kind text, p_quantity numeric, p_unit_price numeric, p_fees numeric, p_notes text, p_account uuid',
          'S4 investment_operation_record: p_account no fim e sem sobrecarga');
select is((select count(*) from pg_proc where proname = 'investment_operation_record' and pronamespace = 'public'::regnamespace),
          1::bigint, 'S4.1 uma investment_operation_record só');
select ok(has_function_privilege('authenticated', 'public.investment_operation_record(uuid, date, text, numeric, numeric, numeric, text, uuid)', 'EXECUTE'),
          'S5 authenticated registra operação');
select ok(not has_function_privilege('anon', 'public.investment_operation_record(uuid, date, text, numeric, numeric, numeric, text, uuid)', 'EXECUTE'),
          'S5.1 anon não');
select ok(has_function_privilege('authenticated', 'public.account_move_to_portfolio(uuid, text, text, text, text, date)', 'EXECUTE'),
          'S6 authenticated move conta para a carteira');
select ok(not has_function_privilege('anon', 'public.account_move_to_portfolio(uuid, text, text, text, text, date)', 'EXECUTE'),
          'S6.1 anon não');
select ok((select prosecdef from pg_proc where oid = 'public.account_move_to_portfolio(uuid, text, text, text, text, date)'::regprocedure),
          'S6.2 account_move_to_portfolio é SECURITY DEFINER');
select is((select proconfig from pg_proc where oid = 'public.account_move_to_portfolio(uuid, text, text, text, text, date)'::regprocedure),
          array['search_path=""'], 'S6.3 com search_path vazio');
select ok(not has_function_privilege('authenticated', 'private.investment_portfolio_account(uuid)', 'EXECUTE'),
          'S7 o cliente não cria a Carteira diretamente');
select ok(not (select prosecdef from pg_proc where oid = 'public.account_balances(uuid, date)'::regprocedure),
          'S8 account_balances continua SECURITY INVOKER');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000094a1', 'c1@teste.com'),
  ('00000000-0000-0000-0000-0000000094a2', 'c2@teste.com');

-- ---- família 2 primeiro: sem Carteira, números conferidos à mão ----
select pg_temp.login('00000000-0000-0000-0000-0000000094a2');
insert into fixture select 'h2', public.create_household('Casa Dois');
insert into public.accounts (household_id, name, type, initial_balance, opening_date)
values (pg_temp.fx('h2'), 'Conta da casa dois', 'checking', 300, pg_temp.hoje() - 40);
insert into fixture select 'cc2', id from public.accounts where household_id = pg_temp.fx('h2') and name = 'Conta da casa dois';
insert into public.transactions (household_id, account_id, category_id, type, description, amount, date)
select pg_temp.fx('h2'), pg_temp.fx('cc2'), c.id, 'expense', 'Mercado de teste', 45.10, pg_temp.hoje() - 5
  from public.categories c where c.household_id = pg_temp.fx('h2') and c.type = 'expense' and c.parent_id is null
 order by c.name limit 1;
select is(pg_temp.saldo(pg_temp.fx('h2'), pg_temp.fx('cc2')), 254.90, 'N1 família sem Carteira: 300 − 45,10');
select is((select count(*) from public.account_balances(pg_temp.fx('h2'), pg_temp.hoje())),
          (select count(*) from public.accounts where household_id = pg_temp.fx('h2')),
          'N2 sem Carteira, account_balances devolve todas as contas da família (nenhuma some)');
select is((select net_worth || '|' || available || '|' || accounts_total from public.home_indicators(pg_temp.fx('h2'), pg_temp.hoje())),
          '254.90|254.90|254.90', 'N3 Início da família sem Carteira: os mesmos números de sempre');
select is((select total from public.balance_totals(pg_temp.fx('h2'), pg_temp.hoje())), 254.90, 'N4 balance_totals igual');
select is((select count(*) from public.accounts where household_id = pg_temp.fx('h2') and system_role is not null), 0::bigint,
          'N5 nenhuma Carteira nasce sem operação com conta');

-- ---- família 1 ----
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000094a1');
insert into fixture select 'h', public.create_household('Casa Carteira');
insert into public.accounts (household_id, name, type, initial_balance, opening_date, currency_code) values
  (pg_temp.fx('h'), 'Corrente de teste', 'checking', 10000, pg_temp.hoje() - 60, 'BRL'),
  (pg_temp.fx('h'), 'CDB antigo de teste', 'fixed_income', 5000, pg_temp.hoje() - 60, 'BRL'),
  (pg_temp.fx('h'), 'Reserva de teste', 'checking', 800, pg_temp.hoje() - 60, 'BRL'),
  (pg_temp.fx('h'), 'Conta vazia de teste', 'checking', 0, pg_temp.hoje() - 60, 'BRL'),
  (pg_temp.fx('h'), 'Conta velha de teste', 'checking', 50, pg_temp.hoje() - 60, 'BRL'),
  (pg_temp.fx('h'), 'Conta em dólar de teste', 'checking', 100, pg_temp.hoje() - 60, 'USD'),
  -- uma conta comum com o mesmo nome da conta interna: não pode colidir com ela
  (pg_temp.fx('h'), 'Carteira de investimentos', 'cash', 20, pg_temp.hoje() - 60, 'BRL');
insert into fixture select k, id from public.accounts a
  join (values ('cc', 'Corrente de teste'), ('cdb', 'CDB antigo de teste'), ('res', 'Reserva de teste'),
               ('vazia', 'Conta vazia de teste'), ('velha', 'Conta velha de teste'), ('usd', 'Conta em dólar de teste'),
               ('homonima', 'Carteira de investimentos')) x(k, nome)
    on a.name = x.nome where a.household_id = pg_temp.fx('h');
update public.accounts set active = false where id = pg_temp.fx('velha');
insert into fixture select 'tes',  public.investment_asset_create(pg_temp.fx('h'), 'Tesouro de teste', null, 'fixed_income', 'BRL');
insert into fixture select 'acao', public.investment_asset_create(pg_temp.fx('h'), 'Ação de teste', 'TEST3', 'equity', 'BRL');
insert into fixture select 'etf',  public.investment_asset_create(pg_temp.fx('h'), 'ETF em dólar de teste', 'TSTE', 'etf', 'USD');

-- ---- A: compra SEM conta = igual a hoje ----
select pg_temp.foto(pg_temp.fx('h'), 'a0_');
insert into txt select 'ps0', (select ps::text from public.period_summary(pg_temp.fx('h'), date_trunc('month', pg_temp.hoje())::date, pg_temp.hoje()) ps);
insert into fixture select 'op_sem', public.investment_operation_record(pg_temp.fx('acao'), pg_temp.hoje() - 20, 'buy', 10, 20.00);
select is((select transaction_id from public.investment_operations where id = pg_temp.fx('op_sem')), null, 'A1 sem conta: a operação não tem transferência');
select is((select count(*) from public.transactions where household_id = pg_temp.fx('h')), 0::bigint, 'A1.1 nenhum lançamento criado');
select is(pg_temp.carteira(pg_temp.fx('h')), null, 'A1.2 a Carteira não nasce sem operação com conta');
select is(pg_temp.saldo(pg_temp.fx('h'), pg_temp.fx('cc')), 10000.00, 'A1.3 a conta não muda');
select is((select net_worth from public.home_indicators(pg_temp.fx('h'), pg_temp.hoje())), pg_temp.n('a0_net_worth') + 200.00,
          'A1.4 o patrimônio sobe pelo ativo, como hoje (a carteira não movimenta conta)');

-- ---- B: compra COM conta ----
select pg_temp.foto(pg_temp.fx('h'), 'b0_');
insert into fixture select 'op_c1', public.investment_operation_record(pg_temp.fx('tes'), pg_temp.hoje() - 10, 'buy', 2, 1000.00, 10.00, null, pg_temp.fx('cc'));
insert into fixture select 'cart', pg_temp.carteira(pg_temp.fx('h'));
insert into fixture select 'tx_c1', transaction_id from public.investment_operations where id = pg_temp.fx('op_c1');
select isnt(pg_temp.fx('cart'), null, 'B1 a Carteira nasce na primeira operação com conta');
select is((select name || '|' || type || '|' || currency_code || '|' || initial_balance || '|' || opening_date || '|' || active
             from public.accounts where id = pg_temp.fx('cart')),
          'Carteira de investimentos|brokerage|BRL|0.00|2000-01-01|true', 'B1.1 nome, tipo, moeda, saldo inicial, abertura e ativa');
select is((select concat_ws('|', type, status, account_id = pg_temp.fx('cc'), destination_account_id = pg_temp.fx('cart'), amount,
                            date = pg_temp.hoje() - 10, description, category_id is null, deleted_at is null)
             from public.transactions where id = pg_temp.fx('tx_c1')),
          'transfer|paid|t|t|2010.00|t|Aporte: Tesouro de teste|t|t',
          'B2 transferência paga conta → Carteira de 2 × 1.000 + 10 de tarifa, na data, sem categoria');
select is(pg_temp.saldo(pg_temp.fx('h'), pg_temp.fx('cc')), 7990.00, 'B3 a conta cai exatamente 2.010,00');
select is((select count(*) from public.account_balances(pg_temp.fx('h'), pg_temp.hoje()) where account_id = pg_temp.fx('cart')),
          0::bigint, 'B4 account_balances não devolve a Carteira');
select is((select count(*) from public.account_balances_projected(pg_temp.fx('h'), pg_temp.hoje()) where account_id = pg_temp.fx('cart')),
          0::bigint, 'B4.1 nem account_balances_projected');
select is((select count(*) from public.account_flow_report(pg_temp.fx('h'), pg_temp.hoje() - 30, pg_temp.hoje()) where account_id = pg_temp.fx('cart')),
          0::bigint, 'B4.2 nem o relatório por conta');
select is(pg_temp.saldo(pg_temp.fx('h'), pg_temp.fx('homonima')), 20.00, 'B4.3 a conta comum de mesmo nome segue normal');
select is((select net_worth from public.home_indicators(pg_temp.fx('h'), pg_temp.hoje())), pg_temp.n('b0_net_worth'),
          'B5 patrimônio do Início IGUAL antes e depois da compra');
select is((select net_worth from public.net_worth_with_assets(pg_temp.fx('h'), pg_temp.hoje())), pg_temp.n('b0_nw_net_worth'),
          'B5.1 patrimônio de Análises IGUAL');
select is((select accounts_total || '|' || investments || '|' || available from public.home_indicators(pg_temp.fx('h'), pg_temp.hoje())),
          (pg_temp.n('b0_accounts_total') - 2010) || '|' || (pg_temp.n('b0_investments') + 2010) || '|' || (pg_temp.n('b0_available') - 2010),
          'B6 contas −2.010, carteira +2.010, disponível −2.010 (a corrente entra no disponível)');
select is((select ps::text from public.period_summary(pg_temp.fx('h'), date_trunc('month', pg_temp.hoje())::date, pg_temp.hoje()) ps),
          (select v from txt where k = 'ps0'), 'B7 period_summary do mês não muda (transferência não é receita nem despesa)');
select is((select closing_balance from public.cash_flow_series(pg_temp.fx('h'), pg_temp.hoje() - 30, pg_temp.hoje(), 'total')),
          (select total from public.balance_totals_projected(pg_temp.fx('h'), pg_temp.hoje(), false)),
          'B8 Entradas x Saídas: o Saldo do fim = saldo das contas (o aporte entra no acumulado)');
select is((select income || '|' || expense from public.cash_flow_series(pg_temp.fx('h'), pg_temp.hoje() - 30, pg_temp.hoje(), 'total')),
          '0|0', 'B8.1 e não vira entrada nem saída');
select is((select distinct total_closing from public.account_flow_report(pg_temp.fx('h'), pg_temp.hoje() - 30, pg_temp.hoje())),
          (select sum(b.balance) from public.account_balances(pg_temp.fx('h'), pg_temp.hoje()) b
            join public.accounts a on a.id = b.account_id where a.active and a.currency_code = 'BRL'),
          'B9 relatório por conta fecha com o saldo das contas ativas em reais');
select is((select distinct total_transfers from public.account_flow_report(pg_temp.fx('h'), pg_temp.hoje() - 30, pg_temp.hoje())),
          -2010.00, 'B9.1 e as transferências do período mostram o aporte que saiu das contas');
select is((select closed_months from public.home_indicators(pg_temp.fx('h'), pg_temp.hoje())),
          (select count(*)::integer from generate_series(date_trunc('month', pg_temp.hoje()) - interval '6 months',
                                                         date_trunc('month', pg_temp.hoje()) - interval '1 month', interval '1 month') g(d)
            where (g.d + interval '1 month - 1 day')::date >= pg_temp.hoje() - 60),
          'B12 meses da reserva contam desde a conta comum mais antiga, não desde a abertura de 2000 da Carteira');
-- segunda compra: a mesma Carteira (única)
insert into fixture select 'op_c2', public.investment_operation_record(pg_temp.fx('acao'), pg_temp.hoje() - 5, 'buy', 10, 25.50, 0, 'nota', pg_temp.fx('cc'));
select is((select count(*) from public.accounts where household_id = pg_temp.fx('h') and system_role = 'investment_portfolio'), 1::bigint,
          'B10 uma Carteira só por família');
select is(pg_temp.saldo(pg_temp.fx('h'), pg_temp.fx('cc')), 7735.00, 'B10.1 a segunda compra tira 255,00');
-- idempotência da Carteira sob demanda (chamada duas vezes devolve a mesma)
reset role;
select is(private.investment_portfolio_account(pg_temp.fx('h')), pg_temp.fx('cart'), 'B11 pedir a Carteira de novo devolve a mesma');
select is(private.investment_portfolio_account(pg_temp.fx('h')), pg_temp.fx('cart'), 'B11.1 e de novo');
select pg_temp.login('00000000-0000-0000-0000-0000000094a1');

-- ---- C: venda com conta ----
select pg_temp.foto(pg_temp.fx('h'), 'c0_');
insert into fixture select 'op_v1', public.investment_operation_record(pg_temp.fx('tes'), pg_temp.hoje() - 2, 'sell', 1, 1100.00, 5.00, null, pg_temp.fx('cc'));
select is((select concat_ws('|', account_id = pg_temp.fx('cart'), destination_account_id = pg_temp.fx('cc'), amount, description, status)
             from public.transactions t join public.investment_operations o on o.transaction_id = t.id where o.id = pg_temp.fx('op_v1')),
          't|t|1095.00|Resgate: Tesouro de teste|paid', 'C1 venda: Carteira → conta pelo líquido (1.100 − 5)');
select is(pg_temp.saldo(pg_temp.fx('h'), pg_temp.fx('cc')), 8830.00, 'C2 a conta recebe 1.095,00');
-- custo médio da unidade vendida: 1.005 (2.010 / 2); o patrimônio muda só pelo ganho realizado (1.095 − 1.005 = 90)
select is((select net_worth from public.home_indicators(pg_temp.fx('h'), pg_temp.hoje())), pg_temp.n('c0_net_worth') + 90.00,
          'C3 patrimônio muda só pelo resultado da venda (+90), não pelo dinheiro que voltou');
select is(pg_temp.sqlstate_of($$select public.investment_operation_record(pg_temp.fx('tes'), pg_temp.hoje(), 'sell', 1, 1.00, 5.00, null, pg_temp.fx('cc'))$$),
          '22023', 'C4 venda com líquido ≤ 0 na conta: 22023');
select is((select count(*) from public.investment_operations where asset_id = pg_temp.fx('tes')), 2::bigint, 'C4.1 a recusa não gravou operação');

-- ---- D: anular devolve o saldo ----
select pg_temp.foto(pg_temp.fx('h'), 'd0_');
select lives_ok($$select public.investment_operation_void(pg_temp.fx('op_c2'), 'compra lançada errada')$$, 'D1 anula a compra com conta');
select isnt((select deleted_at from public.transactions t join public.investment_operations o on o.transaction_id = t.id
              where o.id = pg_temp.fx('op_c2')), null, 'D2 a transferência foi para a lixeira');
select is(pg_temp.saldo(pg_temp.fx('h'), pg_temp.fx('cc')), 8830.00 + 255.00, 'D3 a conta recebe de volta os 255,00');
select is((select net_worth from public.home_indicators(pg_temp.fx('h'), pg_temp.hoje())), pg_temp.n('d0_net_worth'),
          'D4 patrimônio igual (sai do ativo, volta para a conta)');
select is(pg_temp.sqlstate_of($$select public.investment_operation_void(pg_temp.fx('op_c2'), 'de novo')$$), '55000', 'D5 anular duas vezes: 55000');
select is(pg_temp.saldo(pg_temp.fx('h'), pg_temp.fx('cc')), 9085.00, 'D5.1 e o saldo não muda de novo');
select lives_ok($$select public.investment_operation_void(pg_temp.fx('op_sem'), 'compra sem conta anulada')$$, 'D6 anular compra sem conta: como hoje');
select is(pg_temp.saldo(pg_temp.fx('h'), pg_temp.fx('cc')), 9085.00, 'D6.1 sem conta, nenhum saldo muda');

-- ---- E: validações ----
select is(pg_temp.sqlstate_of($$select public.investment_operation_record(pg_temp.fx('etf'), pg_temp.hoje(), 'buy', 1, 10.00, 0, null, pg_temp.fx('cc'))$$),
          '22023', 'E1 ativo em dólar com conta: 22023');
select is(pg_temp.sqlstate_of($$select public.investment_operation_record(pg_temp.fx('tes'), pg_temp.hoje(), 'buy', 1, 10.00, 0, null, pg_temp.fx('usd'))$$),
          '22023', 'E2 conta em dólar: 22023');
select is(pg_temp.sqlstate_of($$select public.investment_operation_record(pg_temp.fx('tes'), pg_temp.hoje(), 'buy', 1, 10.00, 0, null, pg_temp.fx('velha'))$$),
          '22023', 'E3 conta arquivada: 22023');
select is(pg_temp.sqlstate_of($$select public.investment_operation_record(pg_temp.fx('tes'), pg_temp.hoje(), 'buy', 1, 10.00, 0, null, pg_temp.fx('cart'))$$),
          '22023', 'E4 a própria Carteira como conta: 22023');
select is(pg_temp.sqlstate_of($$select public.investment_operation_record(pg_temp.fx('tes'), pg_temp.hoje(), 'buy', 1, 10.00, 0, null, pg_temp.fx('cc2'))$$),
          '42501', 'E5 conta de outra família: 42501');
select is(pg_temp.sqlstate_of($$select public.investment_operation_record(pg_temp.fx('tes'), pg_temp.hoje(), 'buy', 1, 10.00, 0, null, '00000000-0000-0000-0000-000000000000')$$),
          '42501', 'E6 conta inexistente: 42501');
select is((select count(*) from public.investment_operations where household_id = pg_temp.fx('h')), 4::bigint, 'E7 nenhuma recusa gravou operação');
select is((select count(*) from public.transactions where household_id = pg_temp.fx('h')), 3::bigint, 'E7.1 nem lançamento');

-- ---- F: trava (o cliente não mexe na Carteira) ----
select is(pg_temp.sqlstate_of($$update public.transactions set amount = 1 where id = pg_temp.fx('tx_c1')$$), '42501', 'F1 não edita o valor do aporte');
select is(pg_temp.err_of($$update public.transactions set description = 'outra' where id = pg_temp.fx('tx_c1')$$),
          '42501: Movimento da carteira de investimentos: altere pela operação em Investimentos.', 'F2 nem a descrição, com a mensagem clara');
select is(pg_temp.sqlstate_of($$update public.transactions set deleted_at = now() where id = pg_temp.fx('tx_c1')$$), '42501', 'F3 não manda para a lixeira');
select is(pg_temp.sqlstate_of($$update public.transactions set deleted_at = null
                                  where id = (select transaction_id from public.investment_operations where id = pg_temp.fx('op_c2'))$$),
          '42501', 'F4 não restaura da lixeira o aporte anulado');
select is(pg_temp.sqlstate_of($$select public.transactions_bulk_trash(array[pg_temp.fx('tx_c1')])$$), '42501', 'F5 nem pela lixeira em lote');
select is(pg_temp.sqlstate_of($$select public.transactions_bulk_restore(array[(select transaction_id from public.investment_operations where id = pg_temp.fx('op_c2'))])$$),
          '42501', 'F5.1 nem pela restauração em lote');
select is(pg_temp.sqlstate_of(format($$insert into public.transactions (household_id, account_id, destination_account_id, type, amount, date)
                                        values (%L, %L, %L, 'transfer', 10, %L)$$, pg_temp.fx('h'), pg_temp.fx('cc'), pg_temp.fx('cart'), pg_temp.hoje())),
          '42501', 'F6 não cria transferência para a Carteira');
select is(pg_temp.sqlstate_of(format($$insert into public.transactions (household_id, account_id, category_id, type, amount, date)
                                        select %L, %L, c.id, 'expense', 10, %L from public.categories c
                                         where c.household_id = %L and c.type = 'expense' limit 1$$,
                                       pg_temp.fx('h'), pg_temp.fx('cart'), pg_temp.hoje(), pg_temp.fx('h'))),
          '42501', 'F7 nem despesa na Carteira');
with t as (
  insert into public.transactions (household_id, account_id, destination_account_id, type, description, amount, date)
  values (pg_temp.fx('h'), pg_temp.fx('cc'), pg_temp.fx('homonima'), 'transfer', 'Transferência comum de teste', 1.00, pg_temp.hoje() - 1)
  returning id)
insert into fixture select 'tx_comum', id from t;
select is(pg_temp.sqlstate_of($$update public.transactions set destination_account_id = pg_temp.fx('cart') where id = pg_temp.fx('tx_comum')$$),
          '42501', 'F8 nem leva uma transferência comum para a Carteira');
select is((select destination_account_id from public.transactions where id = pg_temp.fx('tx_comum')), pg_temp.fx('homonima'),
          'F8.1 a transferência comum segue igual');
select is(pg_temp.sqlstate_of($$update public.accounts set name = 'Renomeada' where id = pg_temp.fx('cart')$$), '42501', 'F9 não renomeia a Carteira');
select is(pg_temp.sqlstate_of($$update public.accounts set active = false where id = pg_temp.fx('cart')$$), '42501', 'F10 não arquiva a Carteira');
select isnt(pg_temp.sqlstate_of($$select public.account_delete(pg_temp.fx('cart'))$$), null, 'F11 não exclui a Carteira (com histórico, a recusa de sempre)');
select is(pg_temp.sqlstate_of($$delete from public.accounts where id = pg_temp.fx('cart')$$), '42501', 'F11.1 nem direto');
select is(pg_temp.sqlstate_of($$update public.accounts set system_role = 'investment_portfolio' where id = pg_temp.fx('res')$$), '42501',
          'F12 conta comum não vira Carteira');
select is(pg_temp.sqlstate_of($$select public.recurrence_create('transfer', 'Aporte mensal', 100, 5, pg_temp.hoje(), pg_temp.fx('cc'), pg_temp.fx('cart'))$$),
          '42501', 'F13 recorrente não usa a Carteira');
select is(pg_temp.sqlstate_of($$update public.investment_operations set transaction_id = null where id = pg_temp.fx('op_c1')$$), '42501',
          'F14 o cliente não escreve direto em investment_operations');
select is((select concat_ws('|', amount, description, deleted_at is null) from public.transactions where id = pg_temp.fx('tx_c1')),
          '2010.00|Aporte: Tesouro de teste|t', 'F15 nada mudou no aporte');
select is((select name || '|' || active from public.accounts where id = pg_temp.fx('cart')), 'Carteira de investimentos|true', 'F15.1 nem na Carteira');
-- a conferência da conta comum marca a transferência da Carteira (só reconciliation_id muda): passa
select lives_ok(format($$select public.reconcile_account(%L, %L, %s)$$, pg_temp.fx('cc'), pg_temp.hoje(), pg_temp.saldo(pg_temp.fx('h'), pg_temp.fx('cc'))),
                'F16 a conferência da conta que pagou o aporte continua funcionando');
select isnt((select reconciliation_id from public.transactions where id = pg_temp.fx('tx_c1')), null, 'F16.1 e marca a transferência');
select is(pg_temp.sqlstate_of($$select public.investment_operation_void(pg_temp.fx('op_v1'), 'venda dentro da conferência')$$), '55000',
          'F17 anular operação dentro do período conferido: 55000 (a trava da conferência vale)');
select lives_ok(format($$select public.reconciliation_undo(%L)$$, pg_temp.fx('cc')), 'F18 desfazer a conferência também passa');

-- ---- G: mover conta para a carteira ----
select pg_temp.foto(pg_temp.fx('h'), 'g0_');
insert into fixture select 'a_cdb', public.account_move_to_portfolio(pg_temp.fx('cdb'), 'CDB movido de teste', 'fixed_income', 'restricted', 'CDB');
select is(pg_temp.saldo(pg_temp.fx('h'), pg_temp.fx('cdb')), 0.00, 'G1 o saldo da conta movida vai a zero');
select is((select active from public.accounts where id = pg_temp.fx('cdb')), false, 'G2 e ela é arquivada');
select is((select concat_ws('|', name, asset_class, currency_code, liquidity, subclass, active) from public.investment_assets where id = pg_temp.fx('a_cdb')),
          'CDB movido de teste|fixed_income|BRL|restricted|CDB|t', 'G3 ativo novo em reais, com liquidez e subclasse');
select is((select concat_ws('|', kind, quantity, unit_price, fees, operation_date = pg_temp.hoje(), transaction_id is not null)
             from public.investment_operations where asset_id = pg_temp.fx('a_cdb')),
          'buy|1|5000.00|0|t|t', 'G4 compra de 1 unidade ao preço = saldo, sem tarifa, com transferência');
select is((select concat_ws('|', account_id = pg_temp.fx('cdb'), destination_account_id = pg_temp.fx('cart'), amount, type)
             from public.transactions t join public.investment_operations o on o.transaction_id = t.id where o.asset_id = pg_temp.fx('a_cdb')),
          't|t|5000.00|transfer', 'G5 transferência conta → Carteira pelo saldo');
select is((select net_worth from public.home_indicators(pg_temp.fx('h'), pg_temp.hoje())), pg_temp.n('g0_net_worth'), 'G6 patrimônio do Início IGUAL');
select is((select net_worth from public.net_worth_with_assets(pg_temp.fx('h'), pg_temp.hoje())), pg_temp.n('g0_nw_net_worth'), 'G6.1 patrimônio de Análises IGUAL');
select is((select available from public.home_indicators(pg_temp.fx('h'), pg_temp.hoje())), pg_temp.n('g0_available'),
          'G7 disponível não muda: renda fixa não entrava no disponível');
select is((select investments_restricted from public.home_indicators(pg_temp.fx('h'), pg_temp.hoje())), pg_temp.n('g0_investments_restricted') + 5000,
          'G7.1 os 5.000 entram como investimento restrito');
select is((select closed_months from public.home_indicators(pg_temp.fx('h'), pg_temp.hoje())), pg_temp.n('g0_closed_months')::integer,
          'G7.2 os meses da reserva não contam a abertura de 2000 da Carteira');
select pg_temp.foto(pg_temp.fx('h'), 'g1_');
insert into fixture select 'a_res', public.account_move_to_portfolio(pg_temp.fx('res'), 'Reserva movida de teste', 'fixed_income', 'liquid');
select is((select available from public.home_indicators(pg_temp.fx('h'), pg_temp.hoje())), pg_temp.n('g1_available') - 800,
          'G8 conta corrente movida: o disponível cai pelo saldo (800)');
select is((select investments_liquid from public.home_indicators(pg_temp.fx('h'), pg_temp.hoje())), pg_temp.n('g1_investments_liquid') + 800,
          'G8.1 e o investimento líquido sobe 800');
select is((select net_worth from public.home_indicators(pg_temp.fx('h'), pg_temp.hoje())), pg_temp.n('g1_net_worth'), 'G8.2 patrimônio igual');
select is((select subclass from public.investment_assets where id = pg_temp.fx('a_res')), null, 'G8.3 sem subclasse quando não informada');
select is(pg_temp.sqlstate_of($$select public.account_move_to_portfolio(pg_temp.fx('res'), 'Reserva movida 2', 'fixed_income', 'liquid')$$),
          '22023', 'G9 mover de novo (já arquivada): 22023');
select matches(pg_temp.err_of($$select public.account_move_to_portfolio(pg_temp.fx('vazia'), 'Vazia de teste', 'fixed_income', 'liquid')$$),
          '^22023: .*saldo de R\$ 0,00', 'G10 saldo zero: 22023 com o saldo na mensagem');
select is(pg_temp.sqlstate_of($$select public.account_move_to_portfolio(pg_temp.fx('cart'), 'X de teste', 'fixed_income', 'liquid')$$),
          '22023', 'G11 a Carteira não é movida');
select is(pg_temp.sqlstate_of($$select public.account_move_to_portfolio(pg_temp.fx('usd'), 'Y de teste', 'fixed_income', 'liquid')$$),
          '22023', 'G12 conta em dólar: 22023');
select is(pg_temp.sqlstate_of($$select public.account_move_to_portfolio(pg_temp.fx('homonima'), 'Z de teste', 'fixed_income', 'bloqueado')$$),
          '22023', 'G13 liquidez inválida: 22023');
select is((select count(*) from public.investment_assets where name = 'Z de teste'), 0::bigint, 'G13.1 atômica: nenhum ativo ficou');
select is((select active from public.accounts where id = pg_temp.fx('homonima')), true, 'G13.2 e a conta segue ativa');
select is(pg_temp.saldo(pg_temp.fx('h'), pg_temp.fx('homonima')), 21.00, 'G13.3 com o mesmo saldo (20 + a transferência comum de 1)');
select is(pg_temp.sqlstate_of($$select public.account_move_to_portfolio(pg_temp.fx('homonima'), 'W de teste', 'nada', 'liquid')$$),
          '22023', 'G14 classe inválida: 22023');
select is(pg_temp.sqlstate_of($$select public.account_move_to_portfolio(pg_temp.fx('homonima'), 'W de teste', 'fixed_income', 'liquid', null, pg_temp.hoje() + 1)$$),
          '22023', 'G15 data futura: 22023');
select is(pg_temp.sqlstate_of($$select public.account_move_to_portfolio(pg_temp.fx('cc'), 'V de teste', 'fixed_income', 'liquid', null, pg_temp.hoje() - 30)$$),
          '22023', 'G16 conta com movimento depois da data: 22023 (sobraria saldo na conta arquivada)');
select is(pg_temp.sqlstate_of($$select public.account_move_to_portfolio(pg_temp.fx('cc2'), 'U de teste', 'fixed_income', 'liquid')$$),
          '42501', 'G17 conta de outra família: 42501');

-- excluir o ativo com o histórico (investment_asset_purge) devolve o dinheiro do aporte não anulado
insert into num select 'p0_cc', pg_temp.saldo(pg_temp.fx('h'), pg_temp.fx('cc'));
insert into fixture select 'purga', public.investment_asset_create(pg_temp.fx('h'), 'Purga de teste', null, 'fund', 'BRL');
insert into fixture select 'op_purga', public.investment_operation_record(pg_temp.fx('purga'), pg_temp.hoje(), 'buy', 3, 10.00, 0, null, pg_temp.fx('cc'));
insert into fixture select 'tx_purga', transaction_id from public.investment_operations where id = pg_temp.fx('op_purga');
select is(pg_temp.saldo(pg_temp.fx('h'), pg_temp.fx('cc')), pg_temp.n('p0_cc') - 30, 'G18 aporte de 30 no ativo que será excluído');
select lives_ok($$select public.investment_asset_purge(pg_temp.fx('purga'), 'Purga de teste')$$, 'G19 exclui o ativo com o histórico');
select is(pg_temp.saldo(pg_temp.fx('h'), pg_temp.fx('cc')), pg_temp.n('p0_cc'), 'G19.1 o dinheiro volta para a conta');
select isnt((select deleted_at from public.transactions where id = pg_temp.fx('tx_purga')), null, 'G19.2 a transferência foi para a lixeira');

-- ---- H: a outra família ----
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000094a2');
select is((select count(*) from public.accounts where id = pg_temp.fx('cart')), 0::bigint, 'H1 a outra família não enxerga a Carteira');
select is(pg_temp.sqlstate_of($$select public.investment_operation_record(pg_temp.fx('tes'), pg_temp.hoje(), 'buy', 1, 10.00, 0, null, pg_temp.fx('cc2'))$$),
          '42501', 'H2 não opera ativo de outra família');
select is(pg_temp.sqlstate_of($$select public.account_move_to_portfolio(pg_temp.fx('cc'), 'T de teste', 'fixed_income', 'liquid')$$),
          '42501', 'H3 não move conta de outra família');
select is(pg_temp.sqlstate_of($$update public.transactions set amount = 1 where id = pg_temp.fx('tx_c1')$$), null,
          'H4 update na transferência de outra família não acha linha (RLS)');
select is(pg_temp.saldo(pg_temp.fx('h2'), pg_temp.fx('cc2')), 254.90, 'H5 a família 2 segue com os números dela');
insert into fixture select 'tes2', public.investment_asset_create(pg_temp.fx('h2'), 'Tesouro da casa dois', null, 'fixed_income', 'BRL');
select public.investment_operation_record(pg_temp.fx('tes2'), pg_temp.hoje() - 1, 'buy', 1, 100.00, 0, null, pg_temp.fx('cc2'));
insert into fixture select 'cart2', pg_temp.carteira(pg_temp.fx('h2'));
select isnt(pg_temp.fx('cart2'), pg_temp.fx('cart'), 'H6 cada família tem a sua Carteira');
select is(pg_temp.saldo(pg_temp.fx('h2'), pg_temp.fx('cc2')), 154.90, 'H6.1 e o aporte dela sai só da conta dela');
select is((select net_worth from public.home_indicators(pg_temp.fx('h2'), pg_temp.hoje())), 254.90, 'H6.2 patrimônio dela igual');
-- "excluir transações" apaga também a transferência da Carteira; a operação fica sem vínculo
select lives_ok($$select public.clear_household_transactions(pg_temp.fx('h2'), 'excluir transações')$$, 'H7 excluir transações passa com aporte');
select is((select count(*) from public.transactions where household_id = pg_temp.fx('h2')), 0::bigint, 'H7.1 nenhum lançamento sobra');
select is((select count(*) from public.investment_operations where household_id = pg_temp.fx('h2') and transaction_id is null), 1::bigint,
          'H7.2 a operação fica, sem transferência');
select is(pg_temp.err_of($$select public.account_delete(pg_temp.fx('cart2'))$$),
          '42501: A carteira de investimentos é uma conta interna: não pode ser editada, arquivada nem excluída.',
          'H8 sem histórico, a Carteira continua sem poder ser excluída (a trava, não a regra do histórico)');
select is((select count(*) from public.accounts where id = pg_temp.fx('cart2')), 1::bigint, 'H8.1 e continua lá');

-- ---- I: anon e "zerar tudo" ----
reset role;
select set_config('request.jwt.claims', '{}', true), set_config('role', 'anon', true);
select is(pg_temp.sqlstate_of($$select public.account_move_to_portfolio(pg_temp.fx('homonima'), 'S de teste', 'fixed_income', 'liquid')$$),
          '42501', 'I1 anon não move conta');
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000094a1');
select lives_ok($$select public.reset_household(pg_temp.fx('h'), 'zerar tudo')$$, 'I2 zerar tudo apaga também a Carteira e as transferências');
select is((select count(*) from public.accounts where household_id = pg_temp.fx('h')), 0::bigint, 'I2.1 nenhuma conta sobra');

select * from finish();
rollback;
