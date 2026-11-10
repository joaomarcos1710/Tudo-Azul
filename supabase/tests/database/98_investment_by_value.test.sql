-- 98_investment_by_value: migration 104 (20261110130000_investment_by_value.sql). Aporte, resgate e avaliação de
-- investimento só pelo valor: investment_operation_record_by_value e investment_valuation_record_total, e o valor
-- total na linha de avaliação de investment_asset_statement.
-- O que este arquivo prova: dinheiro não some nem aparece. O valor do ativo (market_value) anda EXATAMENTE o valor
-- pedido, a conta anda exatamente o mesmo valor no sentido contrário, o patrimônio não muda com aporte nem resgate,
-- e nada vira despesa nem receita.
-- Dados inventados; datas fixas no passado (2025), fotos do saldo e do patrimônio em 31/10/2026. Cada operação e cada
-- avaliação de um mesmo ativo fica numa data diferente: dentro de uma transação só, created_at é igual para todas as
-- linhas e o desempate por created_at não existiria (em produção cada chamada é uma transação).
-- Sem a migration este arquivo falha (as duas funções não existem).
-- Seções G e Z: sem data retroativa. As duas funções recusam (22023) data anterior ao último movimento do ativo
-- (operação não anulada ou avaliação); a seção Z guarda os três casos em que, antes dessa trava, o patrimônio mudava
-- sozinho (aporte, resgate e avaliação lançados "no passado").
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
-- data fixa das fotos: depois de todas as operações do teste
create function pg_temp.ref() returns date language sql as $f$ select date '2026-10-31' $f$;
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
create function pg_temp.err_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $f$;
-- saldo de uma conta (a família vem da própria conta)
create function pg_temp.saldo(p_k text) returns numeric language sql as $f$
  select b.balance from public.accounts a
    cross join lateral public.account_balances(a.household_id, pg_temp.ref()) b
   where a.id = pg_temp.fx(p_k) and b.account_id = a.id $f$;
-- posição do ativo em investment_portfolio (nulo quando o ativo não aparece = sem posição)
create function pg_temp.mv(p_k text) returns numeric language sql as $f$
  select p.market_value from public.investment_assets a
    cross join lateral public.investment_portfolio(a.household_id, pg_temp.ref()) p
   where a.id = pg_temp.fx(p_k) and p.asset_id = a.id $f$;
create function pg_temp.cb(p_k text) returns numeric language sql as $f$
  select p.cost_basis from public.investment_assets a
    cross join lateral public.investment_portfolio(a.household_id, pg_temp.ref()) p
   where a.id = pg_temp.fx(p_k) and p.asset_id = a.id $f$;
-- unidades em carteira pelo razão (compras − vendas, sem as anuladas)
create function pg_temp.qtd(p_k text) returns numeric language sql as $f$
  select coalesce(sum(case when kind = 'buy' then quantity else -quantity end), 0)
    from public.investment_operations where asset_id = pg_temp.fx(p_k) and voided_at is null $f$;
-- patrimônio: Análises e Início
create function pg_temp.nw() returns numeric language sql as $f$
  select net_worth from public.net_worth_with_assets(pg_temp.fx('h'), pg_temp.ref()) $f$;
create function pg_temp.nw_inicio() returns numeric language sql as $f$
  select net_worth from public.home_indicators(pg_temp.fx('h'), pg_temp.ref()) $f$;
create function pg_temp.guarda(p_pre text) returns void language sql as $f$
  insert into num values (p_pre || 'cc', pg_temp.saldo('cc')), (p_pre || 'nw', pg_temp.nw()), (p_pre || 'nwi', pg_temp.nw_inicio())
  on conflict (k) do update set v = excluded.v $f$;
-- contagem de tudo o que as funções gravam (para provar que uma recusa não gravou nada)
create function pg_temp.gravado() returns text language sql as $f$
  select concat_ws('|', (select count(*) from public.investment_operations where household_id = pg_temp.fx('h')),
                        (select count(*) from public.investment_valuations where household_id = pg_temp.fx('h')),
                        (select count(*) from public.transactions where household_id = pg_temp.fx('h'))) $f$;
create function pg_temp.novo(p_k text, p_nome text) returns void language sql as $f$
  insert into fixture select p_k, public.investment_asset_create(pg_temp.fx('h'), p_nome, null, 'fixed_income', 'BRL') $f$;
-- a transferência de uma operação: tipo, situação, sentido, valor, data, descrição, sem categoria
create function pg_temp.transf(p_op text) returns text language sql as $f$
  select concat_ws('|', t.type, t.status,
           case when t.account_id = pg_temp.fx('cc') and c.system_role = 'investment_portfolio' then 'conta>carteira'
                when t.destination_account_id = pg_temp.fx('cc') and o2.system_role = 'investment_portfolio' then 'carteira>conta'
                else 'outro' end,
           t.amount, t.date, t.description, t.category_id is null, t.deleted_at is null)
    from public.investment_operations o
    join public.transactions t on t.id = o.transaction_id
    left join public.accounts c on c.id = t.destination_account_id
    left join public.accounts o2 on o2.id = t.account_id
   where o.id = pg_temp.fx(p_op) $f$;
grant execute on all functions in schema pg_temp to public;

-- ---- S: forma e permissões (item 12) ----
select has_function('public', 'investment_operation_record_by_value', array['uuid', 'date', 'text', 'numeric', 'text', 'uuid'],
                    'S1 investment_operation_record_by_value existe');
select has_function('public', 'investment_valuation_record_total', array['uuid', 'date', 'numeric', 'text'],
                    'S2 investment_valuation_record_total existe');
select ok(has_function_privilege('authenticated', 'public.investment_operation_record_by_value(uuid, date, text, numeric, text, uuid)', 'EXECUTE'),
          'S3 authenticated registra operação por valor');
select ok(not has_function_privilege('anon', 'public.investment_operation_record_by_value(uuid, date, text, numeric, text, uuid)', 'EXECUTE'),
          'S3.1 anon não');
select ok(has_function_privilege('authenticated', 'public.investment_valuation_record_total(uuid, date, numeric, text)', 'EXECUTE'),
          'S4 authenticated registra avaliação pelo total');
select ok(not has_function_privilege('anon', 'public.investment_valuation_record_total(uuid, date, numeric, text)', 'EXECUTE'),
          'S4.1 anon não');
select is((select array_agg(prosecdef::text || '|' || proconfig::text order by proname) from pg_proc
            where pronamespace = 'public'::regnamespace
              and proname in ('investment_operation_record_by_value', 'investment_valuation_record_total')),
          array['true|{"search_path=\"\""}', 'true|{"search_path=\"\""}'],
          'S5 as duas são SECURITY DEFINER com search_path vazio');
select ok(not (select prosecdef from pg_proc where oid = 'public.investment_asset_statement(uuid, uuid)'::regprocedure),
          'S6 investment_asset_statement continua SECURITY INVOKER');
select ok(not has_table_privilege('authenticated', 'public.investment_operations', 'INSERT')
          and not has_table_privilege('authenticated', 'public.investment_valuations', 'INSERT'),
          'S7 o cliente continua sem escrever direto em operações e avaliações');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000098a1', 'v1@teste.com'),
  ('00000000-0000-0000-0000-0000000098a2', 'v2@teste.com');

-- ---- família 2 (para o isolamento) ----
select pg_temp.login('00000000-0000-0000-0000-0000000098a2');
insert into fixture select 'h2', public.create_household('Casa Dois do Valor');
insert into public.accounts (household_id, name, type, initial_balance, opening_date, currency_code)
values (pg_temp.fx('h2'), 'Conta da casa dois', 'checking', 300, date '2024-12-01', 'BRL');
insert into fixture select 'cc2', id from public.accounts where household_id = pg_temp.fx('h2') and name = 'Conta da casa dois';
insert into fixture select 'tes2', public.investment_asset_create(pg_temp.fx('h2'), 'Cofrinho da casa dois', null, 'fixed_income', 'BRL');

-- ---- família 1 ----
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000098a1');
insert into fixture select 'h', public.create_household('Casa do Valor');
insert into public.accounts (household_id, name, type, initial_balance, opening_date, currency_code) values
  (pg_temp.fx('h'), 'Corrente de teste', 'checking', 50000, date '2024-12-01', 'BRL'),
  (pg_temp.fx('h'), 'Conta velha de teste', 'checking', 50, date '2024-12-01', 'BRL'),
  (pg_temp.fx('h'), 'Conta em dólar de teste', 'checking', 100, date '2024-12-01', 'USD');
insert into fixture select k, id from public.accounts a
  join (values ('cc', 'Corrente de teste'), ('velha', 'Conta velha de teste'), ('usd', 'Conta em dólar de teste')) x(k, nome)
    on a.name = x.nome where a.household_id = pg_temp.fx('h');
update public.accounts set active = false where id = pg_temp.fx('velha');

-- =====================================================================================================
-- A: sem conta. Primeira posição (item 1) e segundo aporte depois de avaliação (item 2)
-- =====================================================================================================
select pg_temp.novo('cofre', 'Cofrinho de teste');
select pg_temp.guarda('a0_');
insert into fixture select 'a_op1', public.investment_operation_record_by_value(pg_temp.fx('cofre'), date '2025-01-10', 'buy', 1000.00);
select is((select concat_ws('|', kind, quantity, unit_price, fees, operation_date, transaction_id is null, notes is null)
             from public.investment_operations where id = pg_temp.fx('a_op1')),
          'buy|1|1000.00|0|2025-01-10|t|t', 'A1 primeira posição: 1 unidade pelo valor, sem tarifa e sem transferência');
select is(pg_temp.mv('cofre'), 1000.00, 'A1.1 market_value = valor do aporte');
select is(pg_temp.cb('cofre'), 1000.00, 'A1.2 cost_basis = valor do aporte');
select is(pg_temp.nw(), pg_temp.n('a0_nw') + 1000.00, 'A1.3 sem conta, o patrimônio sobe exatamente o aporte (como na operação por unidade)');
select is(pg_temp.saldo('cc'), 50000.00, 'A1.4 e nenhuma conta muda');

insert into fixture select 'a_val1', public.investment_valuation_record_total(pg_temp.fx('cofre'), date '2025-02-10', 1037.53, ' extrato de teste ');
select is((select concat_ws('|', valuation_date, unit_price, source) from public.investment_valuations where id = pg_temp.fx('a_val1')),
          '2025-02-10|1037.5300000000|extrato de teste', 'A2 avaliação total com 1 unidade: preço = total; fonte sem espaços nas pontas');
select is(pg_temp.mv('cofre'), 1037.53, 'A2.1 market_value = total avaliado');
select is(pg_temp.cb('cofre'), 1000.00, 'A2.2 a avaliação não mexe no custo');

insert into fixture select 'a_op2', public.investment_operation_record_by_value(pg_temp.fx('cofre'), date '2025-03-10', 'buy', 500.00, 'segundo aporte');
select is((select concat_ws('|', kind, quantity, unit_price, fees, notes) from public.investment_operations where id = pg_temp.fx('a_op2')),
          'buy|0.481913775987|1037.5300000000|0|segundo aporte',
          'A3 segundo aporte: 500 / 1.037,53 = 0,481913775987 unidade ao preço da avaliação');
select is(pg_temp.mv('cofre'), 1537.53, 'A3.1 market_value = 1.037,53 + 500,00 = 1.537,53 exato');
select is(pg_temp.cb('cofre'), 1500.00, 'A3.2 cost_basis = 1.000 + 500 = 1.500,00');
select is(pg_temp.nw(), pg_temp.n('a0_nw') + 1537.53, 'A3.3 patrimônio = antes + 1.537,53');
select is(pg_temp.nw_inicio(), pg_temp.n('a0_nwi') + 1537.53, 'A3.4 e o do Início também');
select is((select count(*) from public.transactions where household_id = pg_temp.fx('h')), 0::bigint, 'A3.5 sem conta, nenhum lançamento');

-- chamar duas vezes = dois aportes exatos (não há chave de idempotência; a segunda chamada é outro aporte)
select lives_ok($$select public.investment_operation_record_by_value(pg_temp.fx('cofre'), date '2025-03-11', 'buy', 33.33)$$, 'A4 aporte de 33,33');
select lives_ok($$select public.investment_operation_record_by_value(pg_temp.fx('cofre'), date '2025-03-12', 'buy', 33.33)$$, 'A4.1 de novo');
select is(pg_temp.mv('cofre'), 1604.19, 'A4.2 dois aportes de 33,33: 1.537,53 + 66,66 = 1.604,19');
select is(pg_temp.cb('cofre'), 1566.66, 'A4.3 custo 1.566,66');
-- a mesma avaliação total duas vezes não muda o valor
select lives_ok($$select public.investment_valuation_record_total(pg_temp.fx('cofre'), date '2025-03-20', 1604.19, 'extrato de teste')$$, 'A5 avaliação igual ao valor atual');
select lives_ok($$select public.investment_valuation_record_total(pg_temp.fx('cofre'), date '2025-03-21', 1604.19, 'extrato de teste')$$, 'A5.1 de novo');
select is(pg_temp.mv('cofre'), 1604.19, 'A5.2 o valor continua 1.604,19');

-- sem avaliação nenhuma: o preço é o custo médio (a unidade continua valendo o primeiro aporte)
select pg_temp.novo('cofre2', 'Reserva sem avaliação de teste');
select public.investment_operation_record_by_value(pg_temp.fx('cofre2'), date '2025-01-11', 'buy', 1000.00);
insert into fixture select 'a2_op2', public.investment_operation_record_by_value(pg_temp.fx('cofre2'), date '2025-02-11', 'buy', 500.00);
select is((select quantity || '|' || unit_price from public.investment_operations where id = pg_temp.fx('a2_op2')),
          '0.500000000000|1000.0000000000', 'A6 sem avaliação: 0,5 unidade ao custo médio de 1.000');
select is(pg_temp.mv('cofre2') || '|' || pg_temp.cb('cofre2'), '1500.00|1500.00', 'A6.1 valor e custo = 1.500,00');
select public.investment_operation_record_by_value(pg_temp.fx('cofre2'), date '2025-03-11', 'sell', 333.33);
select is(pg_temp.mv('cofre2') || '|' || pg_temp.cb('cofre2'), '1166.67|1166.67', 'A6.2 resgate de 333,33 sem avaliação: sobra 1.166,67 no valor e no custo');
select public.investment_operation_record_by_value(pg_temp.fx('cofre2'), date '2025-04-11', 'sell', 1166.67);
select is(pg_temp.qtd('cofre2'), 0::numeric, 'A6.3 resgate do valor todo sem avaliação: zero unidade exato');
select is(pg_temp.mv('cofre2'), null, 'A6.4 e o ativo sai de investment_portfolio');
-- item 7 sem avaliação antiga: o novo aporte volta a ser 1 unidade pelo valor
insert into fixture select 'a2_op5', public.investment_operation_record_by_value(pg_temp.fx('cofre2'), date '2025-05-11', 'buy', 250.00);
select is((select quantity || '|' || unit_price from public.investment_operations where id = pg_temp.fx('a2_op5')),
          '1|250.00', 'A7 depois de zerar, sem avaliação: 1 unidade por 250,00');
select is(pg_temp.mv('cofre2') || '|' || pg_temp.cb('cofre2'), '250.00|250.00', 'A7.1 valor e custo = 250,00 (o custo antigo de 1.000 por unidade não volta)');

-- =====================================================================================================
-- B: aporte COM conta (item 3)
-- =====================================================================================================
select pg_temp.novo('cdb', 'CDB de teste');
select pg_temp.guarda('b0_');
insert into txt select 'ps0', (select ps::text from public.period_summary(pg_temp.fx('h'), date '2025-01-01', pg_temp.ref()) ps);
insert into fixture select 'b_op1', public.investment_operation_record_by_value(pg_temp.fx('cdb'), date '2025-01-15', 'buy', 1000.00, null, pg_temp.fx('cc'));
select is(pg_temp.transf('b_op1'), 'transfer|paid|conta>carteira|1000.00|2025-01-15|Aporte: CDB de teste|t|t',
          'B1 aporte com conta: transferência paga conta → carteira interna de 1.000,00 exatos, na data, sem categoria');
select is(pg_temp.saldo('cc'), 49000.00, 'B2 a conta cai exatamente 1.000,00');
select is(pg_temp.mv('cdb'), 1000.00, 'B2.1 o ativo vale 1.000,00');
select is(pg_temp.nw(), pg_temp.n('b0_nw'), 'B3 patrimônio (net_worth_with_assets) IGUAL antes e depois do aporte');
select is(pg_temp.nw_inicio(), pg_temp.n('b0_nwi'), 'B3.1 patrimônio do Início IGUAL');
select is((select ps::text from public.period_summary(pg_temp.fx('h'), date '2025-01-01', pg_temp.ref()) ps), (select v from txt where k = 'ps0'),
          'B4 period_summary não muda (o aporte não é despesa nem receita)');
select is((select income_paid + expense_paid + income_planned + expense_planned from public.period_summary(pg_temp.fx('h'), date '2025-01-01', pg_temp.ref())),
          0::numeric, 'B4.1 e está zerado: nenhuma receita nem despesa');
select is((select count(*) from public.transactions where household_id = pg_temp.fx('h') and type <> 'transfer'), 0::bigint,
          'B4.2 nenhum lançamento que não seja transferência');

select public.investment_valuation_record_total(pg_temp.fx('cdb'), date '2025-02-15', 1037.53, 'extrato de teste');
select is(pg_temp.nw(), pg_temp.n('b0_nw') + 37.53, 'B5 a avaliação sobe o patrimônio só pelo rendimento (37,53)');
select is(pg_temp.saldo('cc'), 49000.00, 'B5.1 e não mexe na conta');

select pg_temp.guarda('b1_');
insert into fixture select 'b_op2', public.investment_operation_record_by_value(pg_temp.fx('cdb'), date '2025-03-15', 'buy', 500.00, null, pg_temp.fx('cc'));
select is(pg_temp.transf('b_op2'), 'transfer|paid|conta>carteira|500.00|2025-03-15|Aporte: CDB de teste|t|t',
          'B6 segundo aporte (quantidade fracionária): a transferência é de 500,00 exatos');
select is(pg_temp.saldo('cc'), 48500.00, 'B6.1 a conta cai exatamente 500,00');
select is(pg_temp.mv('cdb'), 1537.53, 'B6.2 market_value = 1.537,53 exato');
select is(pg_temp.cb('cdb'), 1500.00, 'B6.3 cost_basis = 1.500,00');
select is(pg_temp.nw(), pg_temp.n('b1_nw'), 'B6.4 patrimônio IGUAL');
select is(pg_temp.nw_inicio(), pg_temp.n('b1_nwi'), 'B6.5 patrimônio do Início IGUAL');
select is((select count(*) from public.accounts where household_id = pg_temp.fx('h') and system_role = 'investment_portfolio'), 1::bigint,
          'B7 uma carteira interna só');

-- =====================================================================================================
-- C: resgate com conta: parcial (item 4), maior que o valor (item 6), total (item 5), novo aporte (item 7)
-- =====================================================================================================
select pg_temp.guarda('c0_');
insert into fixture select 'c_op1', public.investment_operation_record_by_value(pg_temp.fx('cdb'), date '2025-04-15', 'sell', 200.00, null, pg_temp.fx('cc'));
select is(pg_temp.transf('c_op1'), 'transfer|paid|carteira>conta|200.00|2025-04-15|Resgate: CDB de teste|t|t',
          'C1 resgate parcial: transferência carteira interna → conta de 200,00 exatos');
select is(pg_temp.saldo('cc'), 48700.00, 'C1.1 a conta sobe exatamente 200,00');
select is(pg_temp.mv('cdb'), 1337.53, 'C1.2 market_value cai exatamente 200,00 (1.537,53 → 1.337,53)');
-- custo: 1.500 × (1 − 200 / 1.537,53) = 1.500 − 195,12 = 1.304,88
select is(pg_temp.cb('cdb'), 1304.88, 'C1.3 o custo cai na proporção vendida (1.304,88)');
select is(pg_temp.nw(), pg_temp.n('c0_nw'), 'C1.4 patrimônio IGUAL');
select is(pg_temp.nw_inicio(), pg_temp.n('c0_nwi'), 'C1.5 patrimônio do Início IGUAL');
select is((select ps::text from public.period_summary(pg_temp.fx('h'), date '2025-01-01', pg_temp.ref()) ps), (select v from txt where k = 'ps0'),
          'C1.6 period_summary continua igual (resgate não é receita)');

-- resgate maior que o valor do ativo: 23514 e nada gravado
insert into txt select 'c_grav', pg_temp.gravado();
select is(pg_temp.sqlstate_of($$select public.investment_operation_record_by_value(pg_temp.fx('cdb'), date '2025-04-20', 'sell', 1337.54, null, pg_temp.fx('cc'))$$),
          '23514', 'C2 resgate de 1 centavo a mais que o valor do ativo: 23514');
select is(pg_temp.sqlstate_of($$select public.investment_operation_record_by_value(pg_temp.fx('cdb'), date '2025-04-20', 'sell', 5000.00)$$),
          '23514', 'C2.1 muito maior, sem conta: 23514');
select is(pg_temp.sqlstate_of($$select public.investment_operation_record_by_value(pg_temp.fx('cdb'), date '2025-04-15', 'sell', 1337.54, null, pg_temp.fx('cc'))$$),
          '23514', 'C2.2 na mesma data do último movimento também: 23514');
select is(pg_temp.gravado(), (select v from txt where k = 'c_grav'), 'C2.3 as recusas não gravaram operação, avaliação nem lançamento');
select is(pg_temp.saldo('cc') || '|' || pg_temp.mv('cdb'), '48700.00|1337.53', 'C2.4 conta e ativo iguais');

-- resgate do valor todo
select pg_temp.guarda('c1_');
insert into fixture select 'c_op2', public.investment_operation_record_by_value(pg_temp.fx('cdb'), date '2025-05-15', 'sell', 1337.53, null, pg_temp.fx('cc'));
select is(pg_temp.transf('c_op2'), 'transfer|paid|carteira>conta|1337.53|2025-05-15|Resgate: CDB de teste|t|t', 'C3 resgate total: transferência de 1.337,53');
select is(pg_temp.qtd('cdb'), 0::numeric, 'C3.1 a quantidade vai a zero exato (sem resto de fração)');
select is(pg_temp.mv('cdb'), null, 'C3.2 o ativo some de investment_portfolio');
select is((select count(*) from public.investment_portfolio(pg_temp.fx('h'), pg_temp.ref()) where asset_id = pg_temp.fx('cdb')), 0::bigint, 'C3.3 (nenhuma linha)');
select is(pg_temp.saldo('cc'), 50037.53, 'C3.4 a conta fica com 50.000 + 37,53 de rendimento: entrou 1.500, saiu 1.537,53');
select is(pg_temp.nw(), pg_temp.n('c1_nw'), 'C3.5 patrimônio IGUAL');
select is(pg_temp.nw_inicio(), pg_temp.n('c1_nwi'), 'C3.6 patrimônio do Início IGUAL');
insert into txt select 'c_grav2', pg_temp.gravado();
select is(pg_temp.sqlstate_of($$select public.investment_operation_record_by_value(pg_temp.fx('cdb'), date '2025-05-20', 'sell', 0.01, null, pg_temp.fx('cc'))$$),
          '23514', 'C4 resgatar 1 centavo de ativo zerado: 23514');
select is(pg_temp.sqlstate_of($$select public.investment_valuation_record_total(pg_temp.fx('cdb'), date '2025-05-20', 100.00, 'extrato de teste')$$),
          '23514', 'C4.1 avaliar pelo total um ativo zerado: 23514');
select is(pg_temp.gravado(), (select v from txt where k = 'c_grav2'), 'C4.2 nada gravado');

-- depois de zerar, novo aporte: existe avaliação antiga (1.037,53 por unidade) e ela não pode distorcer o valor
select pg_temp.guarda('c2_');
insert into fixture select 'c_op3', public.investment_operation_record_by_value(pg_temp.fx('cdb'), date '2025-06-15', 'buy', 800.00, null, pg_temp.fx('cc'));
select is(pg_temp.mv('cdb'), 800.00, 'C5 novo aporte depois de zerar: market_value = 800,00 (o preço antigo não distorce)');
select is(pg_temp.cb('cdb'), 800.00, 'C5.1 cost_basis = 800,00');
select is(pg_temp.transf('c_op3'), 'transfer|paid|conta>carteira|800.00|2025-06-15|Aporte: CDB de teste|t|t', 'C5.2 transferência de 800,00');
select is(pg_temp.saldo('cc'), 49237.53, 'C5.3 a conta cai 800,00');
select is(pg_temp.nw(), pg_temp.n('c2_nw'), 'C5.4 patrimônio IGUAL');
select public.investment_valuation_record_total(pg_temp.fx('cdb'), date '2025-07-15', 812.34, 'extrato de teste');
select is(pg_temp.mv('cdb'), 812.34, 'C6 avaliação total com quantidade fracionária depois de zerar: 812,34 exato');
select public.investment_operation_record_by_value(pg_temp.fx('cdb'), date '2025-08-15', 'sell', 812.34, null, pg_temp.fx('cc'));
select is(pg_temp.qtd('cdb'), 0::numeric, 'C6.1 resgate total de novo: zero exato');
select is(pg_temp.saldo('cc'), 50049.87, 'C6.2 conta = 50.000 + 37,53 + 12,34');
select is(pg_temp.nw(), pg_temp.n('c2_nw') + 12.34, 'C6.3 no ciclo, o patrimônio mudou só pelo rendimento avaliado (12,34)');
-- extrato: as linhas de compra e venda por valor mostram o valor exato; as avaliações, o total informado
select is((select string_agg(entry_kind || ' ' || amount, ', ' order by entry_date)
             from public.investment_asset_statement(pg_temp.fx('h'), pg_temp.fx('cdb'))),
          'buy 1000.00, valuation 1037.53, buy 500.00, sell 200.00, sell 1337.53, buy 800.00, valuation 812.34, sell 812.34',
          'C7 extrato do CDB: cada linha com o valor exato que foi informado');

-- =====================================================================================================
-- D: investment_valuation_record_total (item 8) e o valor da avaliação no extrato (a)
-- =====================================================================================================
select pg_temp.novo('frac', 'Previdência de teste');
select pg_temp.novo('vazio', 'Ativo sem operação de teste');
select public.investment_operation_record_by_value(pg_temp.fx('frac'), date '2025-01-20', 'buy', 1000.00);
select public.investment_valuation_record_total(pg_temp.fx('frac'), date '2025-02-20', 1037.53, 'extrato de teste');
select public.investment_operation_record_by_value(pg_temp.fx('frac'), date '2025-03-20', 'buy', 333.33);
select public.investment_operation_record_by_value(pg_temp.fx('frac'), date '2025-03-21', 'buy', 0.01);
select public.investment_operation_record_by_value(pg_temp.fx('frac'), date '2025-03-22', 'buy', 77.77);
select is(pg_temp.mv('frac'), 1448.64, 'D1 três aportes depois da avaliação: 1.037,53 + 333,33 + 0,01 + 77,77 = 1.448,64');
select isnt(pg_temp.qtd('frac'), round(pg_temp.qtd('frac'), 6), 'D1.1 a quantidade é fracionária (mais de 6 casas)');
insert into fixture select 'd_val', public.investment_valuation_record_total(pg_temp.fx('frac'), date '2025-04-20', 1500.01, 'extrato de teste');
select is(pg_temp.mv('frac'), 1500.01, 'D2 avaliação total com quantidade fracionária: market_value = 1.500,01 exato');
select is(pg_temp.cb('frac'), 1411.11, 'D2.1 o custo não muda com a avaliação (1.000 + 333,33 + 0,01 + 77,77)');
select is((select round(unit_price * pg_temp.qtd('frac'), 2) from public.investment_valuations where id = pg_temp.fx('d_val')), 1500.01,
          'D2.2 preço gravado × quantidade = total informado');
select public.investment_valuation_record_total(pg_temp.fx('frac'), date '2025-05-20', 1234.56, 'extrato de teste');
select is(pg_temp.mv('frac'), 1234.56, 'D3 avaliação para baixo: 1.234,56 exato');
select public.investment_valuation_record_total(pg_temp.fx('frac'), date '2025-06-20', 987654.32, 'extrato de teste');
select is(pg_temp.mv('frac'), 987654.32, 'D3.1 avaliação muito para cima: 987.654,32 exato');
select public.investment_valuation_record_total(pg_temp.fx('frac'), date '2025-07-20', 0.01, 'extrato de teste');
select is(pg_temp.mv('frac'), 0.01, 'D3.2 avaliação de 1 centavo: 0,01 exato');
select public.investment_valuation_record_total(pg_temp.fx('frac'), date '2025-08-20', 1500.07, 'extrato de teste');
select public.investment_operation_record_by_value(pg_temp.fx('frac'), date '2025-09-20', 'sell', 500.07);
select is(pg_temp.mv('frac'), 1000.00, 'D3.3 e resgate depois de várias avaliações: 1.500,07 − 500,07 = 1.000,00');
-- (a) no extrato, a linha de cada avaliação pelo total mostra EXATAMENTE o total informado
select is((select string_agg(amount::text, ', ' order by entry_date) from public.investment_asset_statement(pg_temp.fx('h'), pg_temp.fx('frac'))
            where entry_kind = 'valuation'),
          '1037.53, 1500.01, 1234.56, 987654.32, 0.01, 1500.07',
          'D4 (a) extrato: o amount de cada avaliação pelo total é exatamente o total informado');
select is((select string_agg(amount::text, ', ' order by entry_date) from public.investment_asset_statement(pg_temp.fx('h'), pg_temp.fx('frac'))
            where entry_kind in ('buy', 'sell')),
          '1000.00, 333.33, 0.01, 77.77, 500.07', 'D4.1 e o das operações por valor é o valor informado');
select is((select count(*) from public.investment_asset_statement(pg_temp.fx('h'), pg_temp.fx('frac'))
            where entry_kind = 'valuation' and (quantity is not null or fees is not null or balance_quantity is not null or source <> 'extrato de teste')),
          0::bigint, 'D4.2 as outras colunas da linha de avaliação seguem como antes');
-- recusas
insert into txt select 'd_grav', pg_temp.gravado();
select is(pg_temp.sqlstate_of($$select public.investment_valuation_record_total(pg_temp.fx('vazio'), date '2025-03-01', 100.00, 'extrato de teste')$$),
          '23514', 'D5 sem posição (ativo sem operação): 23514');
select is(pg_temp.sqlstate_of($$select public.investment_valuation_record_total(pg_temp.fx('frac'), date '2025-01-19', 100.00, 'extrato de teste')$$),
          '22023', 'D5.1 data anterior ao primeiro aporte: 22023 (sem data retroativa; ver a seção G)');
select is(pg_temp.sqlstate_of($$select public.investment_valuation_record_total(pg_temp.fx('frac'), date '2025-10-01', 100.001, 'extrato de teste')$$),
          '22023', 'D6 total com 3 casas: 22023');
select is(pg_temp.sqlstate_of($$select public.investment_valuation_record_total(pg_temp.fx('frac'), date '2025-10-01', 0, 'extrato de teste')$$),
          '22023', 'D6.1 total zero: 22023');
select is(pg_temp.sqlstate_of($$select public.investment_valuation_record_total(pg_temp.fx('frac'), date '2025-10-01', -10.00, 'extrato de teste')$$),
          '22023', 'D6.2 total negativo: 22023');
select is(pg_temp.sqlstate_of($$select public.investment_valuation_record_total(pg_temp.fx('frac'), date '2025-10-01', null, 'extrato de teste')$$),
          '22023', 'D6.3 total nulo: 22023');
select is(pg_temp.sqlstate_of($$select public.investment_valuation_record_total(pg_temp.fx('frac'), null, 100.00, 'extrato de teste')$$),
          '22023', 'D6.4 data nula: 22023');
select is(pg_temp.sqlstate_of($$select public.investment_valuation_record_total(pg_temp.fx('frac'), pg_temp.hoje() + 1, 100.00, 'extrato de teste')$$),
          '22023', 'D6.5 data futura: 22023');
select is(pg_temp.sqlstate_of($$select public.investment_valuation_record_total(pg_temp.fx('frac'), date '2025-10-01', 100.00, null)$$),
          '22023', 'D6.6 fonte nula: 22023');
select is(pg_temp.sqlstate_of($$select public.investment_valuation_record_total(pg_temp.fx('frac'), date '2025-10-01', 100.00, '   ')$$),
          '22023', 'D6.7 fonte em branco: 22023');
select is(pg_temp.sqlstate_of($$select public.investment_valuation_record_total(pg_temp.fx('frac'), date '2025-10-01', 'NaN'::numeric, 'extrato de teste')$$),
          '22023', 'D6.8 total NaN: 22023');
select is(pg_temp.sqlstate_of($$select public.investment_valuation_record_total(pg_temp.fx('frac'), date '2025-10-01', 1000000000000.00, 'extrato de teste')$$),
          '22023', 'D6.9 total de 1 trilhão: 22023');
select is(pg_temp.sqlstate_of($$select public.investment_valuation_record_total(null, date '2025-10-01', 100.00, 'extrato de teste')$$),
          '42501', 'D6.10 ativo nulo: 42501');
select is(pg_temp.gravado(), (select v from txt where k = 'd_grav'), 'D7 nenhuma recusa gravou avaliação');
select is(pg_temp.mv('frac'), 1000.00, 'D7.1 e o valor do ativo segue 1.000,00');

-- =====================================================================================================
-- E: sequência longa (item 9): 31 aportes e resgates de valores "feios" com 8 avaliações totais no meio.
-- "esperado" é o valor do ativo depois de cada passo, calculado à mão: aporte soma, resgate subtrai, avaliação troca.
-- =====================================================================================================
select pg_temp.novo('longa', 'Reserva da sequência de teste');
create temp table passos (n integer primary key, tipo text, valor numeric, esperado numeric);
grant all on passos to public;
insert into passos values
  ( 1, 'buy',  1000.00, 1000.00), ( 2, 'buy',    33.33, 1033.33), ( 3, 'buy',     0.01, 1033.34), ( 4, 'val',  1040.00, 1040.00),
  ( 5, 'sell',   33.33, 1006.67), ( 6, 'buy',  1234.57, 2241.24), ( 7, 'sell',    0.01, 2241.23), ( 8, 'val',  2250.07, 2250.07),
  ( 9, 'buy',    33.33, 2283.40), (10, 'sell', 1234.57, 1048.83), (11, 'buy',     0.01, 1048.84), (12, 'val',  1048.85, 1048.85),
  (13, 'sell',  333.33,  715.52), (14, 'buy',  1234.57, 1950.09), (15, 'buy',    33.33, 1983.42), (16, 'sell',    0.01, 1983.41),
  (17, 'val',  1900.00, 1900.00), (18, 'sell', 1234.57,  665.43), (19, 'buy',     0.01,  665.44), (20, 'buy',   777.77, 1443.21),
  (21, 'val',  1443.22, 1443.22), (22, 'sell',   33.33, 1409.89), (23, 'sell',    0.01, 1409.88), (24, 'buy',  1234.57, 2644.45),
  (25, 'val',  2700.13, 2700.13), (26, 'sell', 1234.57, 1465.56), (27, 'buy',    33.33, 1498.89), (28, 'sell',  666.67,  832.22),
  (29, 'buy',     0.01,  832.23), (30, 'val',   833.33,  833.33), (31, 'sell',    0.01,  833.32), (32, 'buy',  1234.57, 2067.89),
  (33, 'sell',   33.33, 2034.56), (34, 'val',  2034.57, 2034.57),
  (35, 'sell', 2034.56,    0.01),   -- sobra 1 centavo
  (36, 'buy',     0.01,    0.02),
  (37, 'sell',    0.02,    0.00),   -- resgate total: zera
  (38, 'buy',    55.55,   55.55),   -- aporte depois de zerar, com avaliação antiga
  (39, 'sell',   55.55,    0.00);   -- zera de novo
-- cada passo: o valor do ativo é o esperado; aporte e resgate não mudam o patrimônio; avaliação muda só pela diferença
create function pg_temp.sequencia() returns setof text language plpgsql as $f$
declare
  s record;
  v_nw numeric;
  v_antes numeric := 0;
  v_data date;
  v_erro text;
begin
  for s in select * from passos order by n loop
    v_nw := pg_temp.nw();
    v_data := date '2025-01-01' + s.n * 3;
    v_erro := null;
    begin
      if s.tipo = 'val' then
        perform public.investment_valuation_record_total(pg_temp.fx('longa'), v_data, s.valor, 'extrato de teste');
      else
        perform public.investment_operation_record_by_value(pg_temp.fx('longa'), v_data, s.tipo, s.valor, null, pg_temp.fx('cc'));
      end if;
    exception when others then
      v_erro := sqlstate || ': ' || sqlerrm;
    end;
    return next is(v_erro, null, format('E%s %s de %s: aceito', s.n, s.tipo, s.valor));
    return next is(coalesce(pg_temp.mv('longa'), 0), s.esperado, format('E%s.1 valor do ativo = %s', s.n, s.esperado));
    return next is(pg_temp.nw() - v_nw, case when s.tipo = 'val' then s.esperado - v_antes else 0 end,
                   format('E%s.2 patrimônio: %s', s.n, case when s.tipo = 'val' then 'muda só pela diferença da avaliação' else 'não muda' end));
    v_antes := s.esperado;
  end loop;
end $f$;
grant execute on all functions in schema pg_temp to public;
select pg_temp.guarda('e0_');
select * from pg_temp.sequencia();
select is(pg_temp.qtd('longa'), 0::numeric, 'E40 fim da sequência: zero unidade exato');
select is(pg_temp.mv('longa'), null, 'E40.1 o ativo saiu de investment_portfolio');
-- somas à mão: aportes 6.904,97 (16); resgates 6.893,87 (15); avaliações somaram −11,10 (perda líquida)
select is((select count(*) || '|' || sum(t.amount) from public.investment_operations o join public.transactions t on t.id = o.transaction_id
            where o.asset_id = pg_temp.fx('longa') and o.kind = 'buy' and t.account_id = pg_temp.fx('cc') and t.deleted_at is null),
          '16|6904.97', 'E41 transferências conta → carteira: 16, somando 6.904,97 (a soma dos aportes)');
select is((select count(*) || '|' || sum(t.amount) from public.investment_operations o join public.transactions t on t.id = o.transaction_id
            where o.asset_id = pg_temp.fx('longa') and o.kind = 'sell' and t.destination_account_id = pg_temp.fx('cc') and t.deleted_at is null),
          '15|6893.87', 'E41.1 transferências carteira → conta: 15, somando 6.893,87 (a soma dos resgates)');
select is((select string_agg(distinct t.type, ',') from public.investment_operations o join public.transactions t on t.id = o.transaction_id
            where o.asset_id = pg_temp.fx('longa')), 'transfer', 'E41.2 todas são transferências');
select is(pg_temp.saldo('cc'), pg_temp.n('e0_cc') - 11.10, 'E42 a conta termina 11,10 abaixo: 6.893,87 que voltaram − 6.904,97 que saíram');
select is(pg_temp.saldo('cc'), 50038.77, 'E42.1 em número: 50.049,87 − 11,10 = 50.038,77');
select is(pg_temp.nw(), pg_temp.n('e0_nw') - 11.10, 'E43 o patrimônio mudou só pelo que as avaliações disseram (−11,10)');
select is(pg_temp.nw_inicio(), pg_temp.n('e0_nwi') - 11.10, 'E43.1 e o do Início também');
select is((select sum(case when entry_kind = 'buy' then amount when entry_kind = 'sell' then -amount end)
             from public.investment_asset_statement(pg_temp.fx('h'), pg_temp.fx('longa'))), 11.10,
          'E44 extrato: aportes − resgates = 11,10 (cada linha com o valor exato)');
select is((select string_agg(amount::text, ', ' order by entry_date) from public.investment_asset_statement(pg_temp.fx('h'), pg_temp.fx('longa'))
            where entry_kind = 'valuation'),
          '1040.00, 2250.07, 1048.85, 1900.00, 1443.22, 2700.13, 833.33, 2034.57',
          'E44.1 (a) extrato: cada avaliação mostra o total informado');
select is((select ps::text from public.period_summary(pg_temp.fx('h'), date '2025-01-01', pg_temp.ref()) ps), (select v from txt where k = 'ps0'),
          'E45 period_summary igual ao do começo: nada virou despesa nem receita');
select is((select count(*) from public.transactions where household_id = pg_temp.fx('h') and type <> 'transfer'), 0::bigint,
          'E45.1 nenhum lançamento que não seja transferência');

-- =====================================================================================================
-- F: valores inválidos (item 10)
-- =====================================================================================================
select pg_temp.novo('inval', 'Ativo das validações de teste');
insert into fixture select 'etf', public.investment_asset_create(pg_temp.fx('h'), 'ETF em dólar de teste', 'TSTE', 'etf', 'USD');
select pg_temp.novo('arq', 'Ativo arquivado de teste');
select public.investment_operation_record_by_value(pg_temp.fx('inval'), date '2025-01-25', 'buy', 100.00, null, pg_temp.fx('cc'));
select public.investment_operation_record_by_value(pg_temp.fx('arq'), date '2025-01-25', 'buy', 100.00);
select public.investment_operation_record_by_value(pg_temp.fx('arq'), date '2025-02-25', 'sell', 100.00);
select public.investment_asset_archive(pg_temp.fx('arq'));
insert into txt select 'f_grav', pg_temp.gravado();
select pg_temp.guarda('f0_');
select is(pg_temp.sqlstate_of($$select public.investment_operation_record_by_value(pg_temp.fx('inval'), date '2025-03-25', 'buy', 0, null, pg_temp.fx('cc'))$$),
          '22023', 'F1 valor zero: 22023');
select is(pg_temp.sqlstate_of($$select public.investment_operation_record_by_value(pg_temp.fx('inval'), date '2025-03-25', 'buy', -50.00, null, pg_temp.fx('cc'))$$),
          '22023', 'F1.1 valor negativo: 22023');
select is(pg_temp.sqlstate_of($$select public.investment_operation_record_by_value(pg_temp.fx('inval'), date '2025-03-25', 'sell', -50.00, null, pg_temp.fx('cc'))$$),
          '22023', 'F1.2 resgate negativo: 22023');
select is(pg_temp.sqlstate_of($$select public.investment_operation_record_by_value(pg_temp.fx('inval'), date '2025-03-25', 'buy', 10.001, null, pg_temp.fx('cc'))$$),
          '22023', 'F1.3 valor com 3 casas: 22023');
select is(pg_temp.sqlstate_of($$select public.investment_operation_record_by_value(pg_temp.fx('inval'), date '2025-03-25', 'sell', 10.005, null, pg_temp.fx('cc'))$$),
          '22023', 'F1.4 resgate com 3 casas: 22023');
select is(pg_temp.sqlstate_of($$select public.investment_operation_record_by_value(pg_temp.fx('inval'), date '2025-03-25', 'deposit', 10.00, null, pg_temp.fx('cc'))$$),
          '22023', 'F1.5 tipo inválido: 22023');
select is(pg_temp.sqlstate_of($$select public.investment_operation_record_by_value(pg_temp.fx('inval'), date '2025-03-25', 'BUY', 10.00, null, pg_temp.fx('cc'))$$),
          '22023', 'F1.6 tipo em maiúsculas: 22023');
select is(pg_temp.sqlstate_of($$select public.investment_operation_record_by_value(pg_temp.fx('inval'), date '2025-03-25', null, 10.00, null, pg_temp.fx('cc'))$$),
          '22023', 'F1.7 tipo nulo: 22023');
select is(pg_temp.sqlstate_of($$select public.investment_operation_record_by_value(pg_temp.fx('inval'), date '2025-03-25', 'buy', null, null, pg_temp.fx('cc'))$$),
          '22023', 'F1.8 valor nulo: 22023');
select is(pg_temp.sqlstate_of($$select public.investment_operation_record_by_value(pg_temp.fx('inval'), null, 'buy', 10.00, null, pg_temp.fx('cc'))$$),
          '22023', 'F1.9 data nula: 22023');
select is(pg_temp.sqlstate_of($$select public.investment_operation_record_by_value(null, date '2025-03-25', 'buy', 10.00, null, pg_temp.fx('cc'))$$),
          '42501', 'F1.10 ativo nulo: 42501');
select is(pg_temp.sqlstate_of($$select public.investment_operation_record_by_value(pg_temp.fx('inval'), date '2025-03-25', 'buy', 'NaN'::numeric, null, pg_temp.fx('cc'))$$),
          '22023', 'F1.11 valor NaN: 22023');
select is(pg_temp.sqlstate_of($$select public.investment_operation_record_by_value(pg_temp.fx('inval'), date '2025-03-25', 'buy', 1000000000000.00, null, pg_temp.fx('cc'))$$),
          '22023', 'F1.12 valor de 1 trilhão: 22023');
select is(pg_temp.sqlstate_of($$select public.investment_operation_record_by_value(pg_temp.fx('inval'), date '2025-03-25', 'buy', 10.00, repeat('x', 501), pg_temp.fx('cc'))$$),
          '22023', 'F1.13 observação com mais de 500 letras: 22023');
select is(pg_temp.sqlstate_of($$select public.investment_operation_record_by_value(pg_temp.fx('inval'), pg_temp.hoje() + 1, 'buy', 10.00, null, pg_temp.fx('cc'))$$),
          '22023', 'F2 aporte com data futura: 22023');
select is(pg_temp.sqlstate_of($$select public.investment_operation_record_by_value(pg_temp.fx('inval'), pg_temp.hoje() + 1, 'sell', 10.00, null, pg_temp.fx('cc'))$$),
          '22023', 'F2.1 resgate com data futura: 22023');
select is(pg_temp.sqlstate_of($$select public.investment_operation_record_by_value(pg_temp.fx('vazio'), pg_temp.hoje() + 1, 'buy', 10.00)$$),
          '22023', 'F2.2 primeira posição com data futura: 22023');
select is(pg_temp.sqlstate_of($$select public.investment_operation_record_by_value(pg_temp.fx('vazio'), date '1999-12-31', 'buy', 10.00)$$),
          '22023', 'F2.3 primeira posição antes de 2000: 22023');
-- ativo arquivado (sem posição): o aporte para na trava de sempre de investment_operation_record
select is(pg_temp.sqlstate_of($$select public.investment_operation_record_by_value(pg_temp.fx('arq'), date '2025-03-25', 'buy', 10.00, null, pg_temp.fx('cc'))$$),
          '55000', 'F3 aporte em ativo arquivado: 55000');
select isnt(pg_temp.sqlstate_of($$select public.investment_operation_record_by_value(pg_temp.fx('arq'), date '2025-03-25', 'sell', 10.00, null, pg_temp.fx('cc'))$$),
          null, 'F3.1 resgate em ativo arquivado: recusado');
select isnt(pg_temp.sqlstate_of($$select public.investment_valuation_record_total(pg_temp.fx('arq'), date '2025-03-25', 10.00, 'extrato de teste')$$),
          null, 'F3.2 avaliação total em ativo arquivado (sem posição): recusada');
-- moeda e conta
select is(pg_temp.sqlstate_of($$select public.investment_operation_record_by_value(pg_temp.fx('etf'), date '2025-03-25', 'buy', 10.00, null, pg_temp.fx('cc'))$$),
          '22023', 'F4 ativo em dólar com conta em reais: 22023');
select is(pg_temp.sqlstate_of($$select public.investment_operation_record_by_value(pg_temp.fx('etf'), date '2025-03-25', 'buy', 10.00, null, pg_temp.fx('usd'))$$),
          '22023', 'F4.1 ativo em dólar com conta em dólar: 22023');
select is(pg_temp.sqlstate_of($$select public.investment_operation_record_by_value(pg_temp.fx('inval'), date '2025-03-25', 'buy', 10.00, null, pg_temp.fx('usd'))$$),
          '22023', 'F4.2 ativo em reais com conta em dólar: 22023');
select is(pg_temp.sqlstate_of($$select public.investment_operation_record_by_value(pg_temp.fx('inval'), date '2025-03-25', 'buy', 10.00, null, pg_temp.fx('velha'))$$),
          '22023', 'F4.3 conta arquivada: 22023');
select is(pg_temp.sqlstate_of($$select public.investment_operation_record_by_value(pg_temp.fx('inval'), date '2025-03-25', 'buy', 10.00, null,
                                         (select id from public.accounts where household_id = pg_temp.fx('h') and system_role = 'investment_portfolio'))$$),
          '22023', 'F4.4 a própria carteira interna como conta: 22023');
select is(pg_temp.sqlstate_of($$select public.investment_operation_record_by_value(pg_temp.fx('inval'), date '2025-03-25', 'buy', 10.00, null, pg_temp.fx('cc2'))$$),
          '42501', 'F4.5 conta de outra família: 42501');
select is(pg_temp.sqlstate_of($$select public.investment_operation_record_by_value(pg_temp.fx('inval'), date '2025-03-25', 'buy', 10.00, null, '00000000-0000-0000-0000-000000000000')$$),
          '42501', 'F4.6 conta inexistente: 42501');
select is(pg_temp.sqlstate_of($$select public.investment_operation_record_by_value('00000000-0000-0000-0000-000000000000', date '2025-03-25', 'buy', 10.00)$$),
          '42501', 'F4.7 ativo inexistente: 42501');
select is(pg_temp.gravado(), (select v from txt where k = 'f_grav'), 'F5 nenhuma recusa gravou operação, avaliação nem lançamento');
select is(pg_temp.saldo('cc') || '|' || pg_temp.nw(), pg_temp.n('f0_cc') || '|' || pg_temp.n('f0_nw'), 'F5.1 conta e patrimônio iguais');
select is(pg_temp.mv('inval'), 100.00, 'F5.2 e o ativo segue valendo 100,00');
-- ativo em dólar SEM conta funciona (não movimenta conta)
select lives_ok($$select public.investment_operation_record_by_value(pg_temp.fx('etf'), date '2025-03-25', 'buy', 100.00)$$, 'F6 ativo em dólar sem conta: aceita');
select is(pg_temp.mv('etf'), 100.00, 'F6.1 e vale 100,00 (na moeda dele)');
-- o cliente não escreve direto nas tabelas
select is(pg_temp.sqlstate_of(format($$insert into public.investment_operations (household_id, asset_id, operation_date, kind, quantity, unit_price)
                                        values (%L, %L, date '2025-03-25', 'buy', 1, 10)$$, pg_temp.fx('h'), pg_temp.fx('inval'))),
          '42501', 'F7 o cliente não insere operação direto');
select is(pg_temp.sqlstate_of(format($$insert into public.investment_valuations (household_id, asset_id, valuation_date, unit_price, source)
                                        values (%L, %L, date '2025-03-25', 10, 'x')$$, pg_temp.fx('h'), pg_temp.fx('inval'))),
          '42501', 'F7.1 nem avaliação');
select is(pg_temp.sqlstate_of($$update public.investment_operations set quantity = 2 where asset_id = pg_temp.fx('inval')$$), '42501', 'F7.2 nem altera a quantidade');

-- =====================================================================================================
-- G: sem data retroativa (item 11 e a trava da 104): data anterior ao último movimento do ativo = 22023.
-- Último movimento = a maior data entre operação NÃO anulada e avaliação. A mesma data é aceita.
-- =====================================================================================================
select pg_temp.novo('retro', 'Ativo da data anterior de teste');
insert into fixture select 'g_op1', public.investment_operation_record_by_value(pg_temp.fx('retro'), date '2025-06-10', 'buy', 400.00, null, pg_temp.fx('cc'));
insert into txt select 'g_grav', pg_temp.gravado();
select pg_temp.guarda('g0_');
-- um dia antes do último movimento (aqui, a primeira e única operação): aporte, resgate e avaliação total
select is(pg_temp.err_of($$select public.investment_operation_record_by_value(pg_temp.fx('retro'), date '2025-06-09', 'buy', 100.00, null, pg_temp.fx('cc'))$$),
          '22023: este investimento já tem movimento em 10/06/2025; pelo valor, use essa data ou uma posterior',
          'G1 aporte um dia antes da primeira operação: 22023, com a data do último movimento na mensagem');
select is(pg_temp.sqlstate_of($$select public.investment_operation_record_by_value(pg_temp.fx('retro'), date '2025-06-09', 'buy', 100.00)$$),
          '22023', 'G1.1 sem conta também');
select is(pg_temp.sqlstate_of($$select public.investment_operation_record_by_value(pg_temp.fx('retro'), date '2025-06-09', 'sell', 100.00, null, pg_temp.fx('cc'))$$),
          '22023', 'G1.2 resgate um dia antes: 22023');
select is(pg_temp.err_of($$select public.investment_valuation_record_total(pg_temp.fx('retro'), date '2025-06-09', 100.00, 'extrato de teste')$$),
          '22023: este investimento já tem movimento em 10/06/2025; pelo valor, use essa data ou uma posterior',
          'G1.3 avaliação total um dia antes: 22023, com a mesma mensagem');
select is(pg_temp.sqlstate_of($$select public.investment_operation_record_by_value(pg_temp.fx('retro'), date '2025-01-10', 'buy', 100.00, null, pg_temp.fx('cc'))$$),
          '22023', 'G1.4 aporte meses antes: 22023');
select is(pg_temp.gravado(), (select v from txt where k = 'g_grav'), 'G2 as recusas não gravaram operação, avaliação nem lançamento');
select is(concat_ws('|', pg_temp.saldo('cc'), pg_temp.nw(), pg_temp.nw_inicio(), pg_temp.qtd('retro'), pg_temp.mv('retro')),
          concat_ws('|', pg_temp.n('g0_cc'), pg_temp.n('g0_nw'), pg_temp.n('g0_nwi'), 1, 400.00),
          'G2.1 conta, patrimônio (Análises e Início), unidades e valor do ativo iguais');
-- a MESMA data do último movimento é aceita
select lives_ok($$select public.investment_operation_record_by_value(pg_temp.fx('retro'), date '2025-06-10', 'buy', 100.00, null, pg_temp.fx('cc'))$$,
                'G3 aporte na mesma data da última operação: aceito');
select is(pg_temp.mv('retro') || '|' || pg_temp.saldo('cc'), '500.00|' || (pg_temp.n('g0_cc') - 100.00), 'G3.1 o ativo vale 500,00 e a conta cai 100,00');
select lives_ok($$select public.investment_valuation_record_total(pg_temp.fx('retro'), date '2025-06-10', 510.00, 'extrato de teste')$$,
                'G3.2 avaliação total na mesma data da última operação: aceita');
select is(pg_temp.mv('retro'), 510.00, 'G3.3 e o ativo vale 510,00');
-- uma avaliação POSTERIOR à última operação passa a ser o último movimento
select public.investment_valuation_record_total(pg_temp.fx('retro'), date '2025-06-20', 520.00, 'extrato de teste');
insert into txt select 'g_grav2', pg_temp.gravado();
select pg_temp.guarda('g1_');
select is(pg_temp.err_of($$select public.investment_operation_record_by_value(pg_temp.fx('retro'), date '2025-06-19', 'buy', 100.00, null, pg_temp.fx('cc'))$$),
          '22023: este investimento já tem movimento em 20/06/2025; pelo valor, use essa data ou uma posterior',
          'G4 aporte depois da última operação (10/06) mas antes da última avaliação (20/06): 22023');
select is(pg_temp.sqlstate_of($$select public.investment_operation_record_by_value(pg_temp.fx('retro'), date '2025-06-19', 'sell', 100.00, null, pg_temp.fx('cc'))$$),
          '22023', 'G4.1 resgate um dia antes da última avaliação: 22023');
select is(pg_temp.sqlstate_of($$select public.investment_valuation_record_total(pg_temp.fx('retro'), date '2025-06-19', 515.00, 'extrato de teste')$$),
          '22023', 'G4.2 avaliação total um dia antes da última avaliação: 22023');
select is(pg_temp.gravado(), (select v from txt where k = 'g_grav2'), 'G4.3 nada gravado');
select is(concat_ws('|', pg_temp.saldo('cc'), pg_temp.nw(), pg_temp.nw_inicio(), pg_temp.mv('retro')),
          concat_ws('|', pg_temp.n('g1_cc'), pg_temp.n('g1_nw'), pg_temp.n('g1_nwi'), 520.00), 'G4.4 conta, patrimônio e valor do ativo iguais');
select lives_ok($$select public.investment_operation_record_by_value(pg_temp.fx('retro'), date '2025-06-20', 'sell', 20.00, null, pg_temp.fx('cc'))$$,
                'G5 resgate na mesma data da última avaliação: aceito');
select is(pg_temp.mv('retro') || '|' || pg_temp.saldo('cc'), '500.00|' || (pg_temp.n('g1_cc') + 20.00), 'G5.1 o ativo vale 500,00 e a conta sobe 20,00');
select is(pg_temp.nw(), pg_temp.n('g1_nw'), 'G5.2 patrimônio IGUAL');
-- operação ANULADA não conta como último movimento
insert into fixture select 'g_opx', public.investment_operation_record_by_value(pg_temp.fx('retro'), date '2025-07-10', 'buy', 50.00, null, pg_temp.fx('cc'));
select is(pg_temp.sqlstate_of($$select public.investment_operation_record_by_value(pg_temp.fx('retro'), date '2025-07-05', 'buy', 30.00, null, pg_temp.fx('cc'))$$),
          '22023', 'G6 com um aporte em 10/07, aporte em 05/07: 22023');
select public.investment_operation_void(pg_temp.fx('g_opx'), 'aporte lançado errado');
select is(pg_temp.mv('retro') || '|' || pg_temp.saldo('cc'), '500.00|' || (pg_temp.n('g1_cc') + 20.00), 'G6.1 anulado o aporte de 10/07: ativo 500,00 e a conta de volta');
select lives_ok($$select public.investment_operation_record_by_value(pg_temp.fx('retro'), date '2025-07-05', 'buy', 30.00, null, pg_temp.fx('cc'))$$,
                'G6.2 a anulada não conta como último movimento: o aporte em 05/07 agora é aceito');
select is(pg_temp.mv('retro') || '|' || pg_temp.saldo('cc'), '530.00|' || (pg_temp.n('g1_cc') - 10.00), 'G6.3 o ativo vale 530,00 e a conta cai 30,00');
select is(pg_temp.sqlstate_of($$select public.investment_valuation_record_total(pg_temp.fx('retro'), date '2025-07-04', 530.00, 'extrato de teste')$$),
          '22023', 'G6.4 e o último movimento passa a ser 05/07: avaliação total em 04/07 = 22023');
select lives_ok($$select public.investment_valuation_record_total(pg_temp.fx('retro'), date '2025-07-09', 531.00, 'extrato de teste')$$,
                'G6.5 avaliação total em 09/07 (antes só da operação anulada): aceita');
select is(pg_temp.mv('retro'), 531.00, 'G6.6 e o ativo vale 531,00');
select is(pg_temp.nw(), pg_temp.n('g1_nw') + 1.00, 'G6.7 desde a foto, o patrimônio mudou só pela avaliação (530 → 531)');
-- ativo só com avaliação por preço (sem operação): a avaliação é o último movimento e o preço dela vale no primeiro aporte
select pg_temp.novo('socota', 'Ativo só com cotação de teste');
select public.investment_valuation_record(pg_temp.fx('socota'), date '2025-06-10', 50.00, 'cotação de teste');
select is(pg_temp.sqlstate_of($$select public.investment_operation_record_by_value(pg_temp.fx('socota'), date '2025-06-09', 'buy', 100.00)$$),
          '22023', 'G7 ativo só com avaliação: aporte um dia antes dela = 22023');
select is((select count(*) from public.investment_operations where asset_id = pg_temp.fx('socota')), 0::bigint, 'G7.1 nada gravado');
insert into fixture select 'g_op7', public.investment_operation_record_by_value(pg_temp.fx('socota'), date '2025-06-10', 'buy', 100.00);
select is((select quantity || '|' || unit_price from public.investment_operations where id = pg_temp.fx('g_op7')), '2.000000000000|50.0000000000',
          'G7.2 na data da avaliação: 100 / 50 = 2 unidades ao preço avaliado');
select is(pg_temp.mv('socota') || '|' || pg_temp.cb('socota'), '100.00|100.00', 'G7.3 valor e custo = 100,00');

-- =====================================================================================================
-- H: anular operação criada por valor (item 13)
-- =====================================================================================================
select pg_temp.novo('anula', 'Ativo da anulação de teste');
select pg_temp.guarda('h0_');
insert into fixture select 'h_op1', public.investment_operation_record_by_value(pg_temp.fx('anula'), date '2025-01-12', 'buy', 1000.00, null, pg_temp.fx('cc'));
insert into fixture select 'h_op2', public.investment_operation_record_by_value(pg_temp.fx('anula'), date '2025-02-12', 'buy', 499.99, null, pg_temp.fx('cc'));
select is(pg_temp.saldo('cc'), pg_temp.n('h0_cc') - 1499.99, 'H1 dois aportes: a conta cai 1.499,99');
select lives_ok($$select public.investment_operation_void(pg_temp.fx('h_op2'), 'aporte lançado errado')$$, 'H2 anula o segundo aporte por valor');
select is(pg_temp.saldo('cc'), pg_temp.n('h0_cc') - 1000.00, 'H2.1 a conta recebe de volta exatamente 499,99');
select is(pg_temp.mv('anula') || '|' || pg_temp.cb('anula'), '1000.00|1000.00', 'H2.2 o ativo volta a valer 1.000,00 (valor e custo)');
select is(pg_temp.transf('h_op2'), 'transfer|paid|conta>carteira|499.99|2025-02-12|Aporte: Ativo da anulação de teste|t|f',
          'H2.3 a transferência do aporte foi para a lixeira');
select is(pg_temp.nw(), pg_temp.n('h0_nw'), 'H2.4 patrimônio IGUAL (sai do ativo, volta para a conta)');
select is(pg_temp.sqlstate_of($$select public.investment_operation_void(pg_temp.fx('h_op2'), 'de novo')$$), '55000', 'H3 anular duas vezes: 55000');
select is(pg_temp.saldo('cc'), pg_temp.n('h0_cc') - 1000.00, 'H3.1 e o saldo não muda de novo');
-- resgate por valor anulado: o dinheiro sai da conta e volta para o ativo
insert into fixture select 'h_op3', public.investment_operation_record_by_value(pg_temp.fx('anula'), date '2025-03-12', 'sell', 300.01, null, pg_temp.fx('cc'));
select is(pg_temp.saldo('cc') || '|' || pg_temp.mv('anula'), (pg_temp.n('h0_cc') - 699.99) || '|699.99', 'H4 resgate de 300,01: conta +300,01, ativo 699,99');
select lives_ok($$select public.investment_operation_void(pg_temp.fx('h_op3'), 'resgate lançado errado')$$, 'H5 anula o resgate por valor');
select is(pg_temp.saldo('cc') || '|' || pg_temp.mv('anula'), (pg_temp.n('h0_cc') - 1000.00) || '|1000.00', 'H5.1 conta devolve os 300,01 e o ativo volta a 1.000,00');
select is(pg_temp.qtd('anula'), 1::numeric, 'H5.2 1 unidade exata, sem resto');
select is(pg_temp.nw(), pg_temp.n('h0_nw'), 'H5.3 patrimônio IGUAL');
-- anular o aporte que cobre um resgate posterior: a trava de sempre
insert into fixture select 'h_op4', public.investment_operation_record_by_value(pg_temp.fx('anula'), date '2025-04-12', 'sell', 1000.00, null, pg_temp.fx('cc'));
select is(pg_temp.sqlstate_of($$select public.investment_operation_void(pg_temp.fx('h_op1'), 'aporte que cobre o resgate')$$), '23514',
          'H6 anular o aporte que cobre o resgate total: 23514');
select is(pg_temp.saldo('cc'), pg_temp.n('h0_cc'), 'H6.1 e a conta fica como no começo (1.000 saiu, 1.000 voltou)');
select lives_ok($$select public.investment_operation_void(pg_temp.fx('h_op4'), 'resgate total lançado errado')$$, 'H7 anula o resgate total');
select is(pg_temp.saldo('cc') || '|' || pg_temp.mv('anula'), (pg_temp.n('h0_cc') - 1000.00) || '|1000.00', 'H7.1 o ativo reaparece com 1.000,00 e a conta devolve');

-- =====================================================================================================
-- I: extrato (b, c, d): avaliação comum por preço, linhas de compra e venda, operação anulada
-- =====================================================================================================
insert into fixture select 'acao', public.investment_asset_create(pg_temp.fx('h'), 'Ação de teste', 'TEST3', 'equity', 'BRL');
select public.investment_valuation_record(pg_temp.fx('acao'), date '2025-01-05', 19.00, 'cotação de teste');
insert into fixture select 'i_op1', public.investment_operation_record(pg_temp.fx('acao'), date '2025-01-10', 'buy', 10, 20.00, 1.50);
insert into fixture select 'i_op2', public.investment_operation_record(pg_temp.fx('acao'), date '2025-02-10', 'buy', 5, 22.00);
select public.investment_valuation_record(pg_temp.fx('acao'), date '2025-03-10', 23.45, 'cotação de teste');
insert into fixture select 'i_op3', public.investment_operation_record(pg_temp.fx('acao'), date '2025-04-10', 'sell', 4, 25.00, 2.00);
select public.investment_valuation_record(pg_temp.fx('acao'), date '2025-05-10', 26.10, 'cotação de teste');
select is((select string_agg(entry_date || ' ' || coalesce(amount::text, 'nulo'), ', ' order by entry_date)
             from public.investment_asset_statement(pg_temp.fx('h'), pg_temp.fx('acao')) where entry_kind = 'valuation'),
          '2025-01-05 nulo, 2025-03-10 351.75, 2025-05-10 287.10',
          'I1 (b) avaliação por preço: sem posição = nulo; 15 × 23,45 = 351,75; 11 × 26,10 = 287,10');
select is((select string_agg(concat_ws(' ', entry_kind, quantity, unit_price, fees, amount, balance_quantity, voided), ', ' order by entry_date)
             from public.investment_asset_statement(pg_temp.fx('h'), pg_temp.fx('acao')) where entry_kind in ('buy', 'sell')),
          'buy 10 20.00 1.50 201.50 10 f, buy 5 22.00 0 110.00 15 f, sell 4 25.00 2.00 98.00 11 f',
          'I2 (c) compra e venda como antes: 10 × 20 + 1,50; 5 × 22; 4 × 25 − 2; saldo de unidades 10, 15, 11');
select is((select string_agg(concat_ws(' ', entry_kind, unit_price, source, coalesce(quantity::text, '-'), coalesce(fees::text, '-'),
                                       coalesce(balance_quantity::text, '-'), voided), ', ' order by entry_date)
             from public.investment_asset_statement(pg_temp.fx('h'), pg_temp.fx('acao')) where entry_kind = 'valuation'),
          'valuation 19.00 cotação de teste - - - f, valuation 23.45 cotação de teste - - - f, valuation 26.10 cotação de teste - - - f',
          'I2.1 as outras colunas da linha de avaliação seguem como antes');
select lives_ok($$select public.investment_operation_void(pg_temp.fx('i_op2'), 'compra lançada errada')$$, 'I3 anula a compra de 5 unidades');
select is((select string_agg(entry_date || ' ' || coalesce(amount::text, 'nulo'), ', ' order by entry_date)
             from public.investment_asset_statement(pg_temp.fx('h'), pg_temp.fx('acao')) where entry_kind = 'valuation'),
          '2025-01-05 nulo, 2025-03-10 234.50, 2025-05-10 156.60',
          'I3.1 (d) a anulada não entra nas unidades: 10 × 23,45 = 234,50; 6 × 26,10 = 156,60');
select is((select string_agg(concat_ws(' ', entry_kind, amount, coalesce(balance_quantity::text, '-'), voided), ', ' order by entry_date)
             from public.investment_asset_statement(pg_temp.fx('h'), pg_temp.fx('acao')) where entry_kind in ('buy', 'sell')),
          'buy 201.50 10 f, buy 110.00 - t, sell 98.00 6 f',
          'I3.2 (c) a linha anulada continua no extrato com o mesmo valor, riscada');
-- por valor num ativo com várias unidades: o resgate do valor todo zera as unidades inteiras
select is(pg_temp.mv('acao'), 156.60, 'I4 posição: 6 × 26,10 = 156,60');
select public.investment_operation_record_by_value(pg_temp.fx('acao'), date '2025-06-10', 'sell', 56.60, null, pg_temp.fx('cc'));
select is(pg_temp.mv('acao'), 100.00, 'I4.1 resgate de 56,60 por valor em ativo com unidades: sobra 100,00');
select public.investment_operation_record_by_value(pg_temp.fx('acao'), date '2025-07-10', 'sell', 100.00, null, pg_temp.fx('cc'));
select is(pg_temp.qtd('acao'), 0::numeric, 'I4.2 e o resgate do resto zera exato');

-- =====================================================================================================
-- J: isolamento entre famílias e anon (item 12)
-- =====================================================================================================
insert into txt select 'j_grav', pg_temp.gravado();
insert into num select 'j_cc', pg_temp.saldo('cc');
insert into num select 'j_nw', pg_temp.nw();
insert into num select 'j_cofre', pg_temp.mv('cofre');
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000098a2');
select is(pg_temp.sqlstate_of($$select public.investment_operation_record_by_value(pg_temp.fx('cofre'), date '2025-09-01', 'buy', 10.00)$$),
          '42501', 'J1 outra família não aporta por valor: 42501');
select is(pg_temp.sqlstate_of($$select public.investment_operation_record_by_value(pg_temp.fx('cofre'), date '2025-09-01', 'buy', 10.00, null, pg_temp.fx('cc2'))$$),
          '42501', 'J1.1 nem pagando com a conta dela');
select is(pg_temp.sqlstate_of($$select public.investment_operation_record_by_value(pg_temp.fx('cofre'), date '2025-09-01', 'sell', 10.00, null, pg_temp.fx('cc2'))$$),
          '42501', 'J1.2 nem resgata para a conta dela');
select is(pg_temp.sqlstate_of($$select public.investment_valuation_record_total(pg_temp.fx('cofre'), date '2025-09-01', 1.00, 'extrato de teste')$$),
          '42501', 'J1.3 nem avalia pelo total');
select is(pg_temp.sqlstate_of($$select public.investment_operation_record_by_value(pg_temp.fx('tes2'), date '2025-09-01', 'buy', 10.00, null, pg_temp.fx('cc'))$$),
          '42501', 'J1.4 nem usa a conta da família 1 no ativo dela');
select is((select count(*) from public.investment_asset_statement(pg_temp.fx('h'), pg_temp.fx('cofre'))), 0::bigint,
          'J2 nem lê o extrato de ativo de outra família');
-- o fluxo dela funciona e fica só nela
select lives_ok($$select public.investment_operation_record_by_value(pg_temp.fx('tes2'), date '2025-09-01', 'buy', 120.50, null, pg_temp.fx('cc2'))$$,
                'J3 a família 2 aporta 120,50 no ativo dela');
select is(pg_temp.saldo('cc2'), 179.50, 'J3.1 a conta dela cai para 179,50');
select is(pg_temp.mv('tes2'), 120.50, 'J3.2 o ativo dela vale 120,50');
select is((select net_worth from public.net_worth_with_assets(pg_temp.fx('h2'), pg_temp.ref())), 300.00, 'J3.3 o patrimônio dela segue 300,00');
reset role;
select set_config('request.jwt.claims', '{}', true), set_config('role', 'anon', true);
select is(pg_temp.sqlstate_of($$select public.investment_operation_record_by_value(pg_temp.fx('cofre'), date '2025-09-01', 'buy', 10.00)$$),
          '42501', 'J4 anon não executa investment_operation_record_by_value');
select is(pg_temp.sqlstate_of($$select public.investment_valuation_record_total(pg_temp.fx('cofre'), date '2025-09-01', 1.00, 'extrato de teste')$$),
          '42501', 'J4.1 nem investment_valuation_record_total');
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000098a1');
select is(pg_temp.gravado(), (select v from txt where k = 'j_grav'), 'J5 nada foi gravado na família 1');
select is(pg_temp.saldo('cc') || '|' || pg_temp.nw() || '|' || pg_temp.mv('cofre'),
          pg_temp.n('j_cc') || '|' || pg_temp.n('j_nw') || '|' || pg_temp.n('j_cofre'), 'J5.1 conta, patrimônio e ativo da família 1 iguais');

-- =====================================================================================================
-- Z: os três casos em que, antes da trava de data retroativa, o patrimônio mudava sozinho. Cada um usa um ativo
-- próprio. Agora a função recusa (22023) e o patrimônio fica igual.
-- =====================================================================================================
-- Z1: aporte por valor com data ANTERIOR a uma avaliação já gravada.
--     1.000 em 10/01; "vale 1.100" em 10/03; depois, aporte de 500 com data de 10/02.
--     Sem a trava: 0,5 unidade ao preço antigo de 1.000 × 1.100 = 550 no ativo por 500 da conta (+50 do nada).
select pg_temp.novo('z1', 'Achado um de teste');
select public.investment_operation_record_by_value(pg_temp.fx('z1'), date '2025-01-10', 'buy', 1000.00, null, pg_temp.fx('cc'));
select public.investment_valuation_record_total(pg_temp.fx('z1'), date '2025-03-10', 1100.00, 'extrato de teste');
select pg_temp.guarda('z1_');
select is(pg_temp.sqlstate_of($$select public.investment_operation_record_by_value(pg_temp.fx('z1'), date '2025-02-10', 'buy', 500.00, null, pg_temp.fx('cc'))$$),
          '22023', 'Z1 aporte de 500 com data anterior à avaliação: 22023');
select is(pg_temp.nw(), pg_temp.n('z1_nw'), 'Z1.1 o patrimônio não muda');
select is(pg_temp.saldo('cc') || '|' || pg_temp.mv('z1'), pg_temp.n('z1_cc') || '|1100.00', 'Z1.2 conta igual e ativo em 1.100,00');
-- Z2: o mesmo com resgate. 1.000 em 10/01; "vale 1.100" em 10/03; depois, resgate de 200 com data de 10/02.
--     Sem a trava: saíam 0,2 unidade × 1.100 = 220 do ativo por 200 na conta (−20).
select pg_temp.novo('z1b', 'Achado um b de teste');
select public.investment_operation_record_by_value(pg_temp.fx('z1b'), date '2025-01-10', 'buy', 1000.00, null, pg_temp.fx('cc'));
select public.investment_valuation_record_total(pg_temp.fx('z1b'), date '2025-03-10', 1100.00, 'extrato de teste');
select pg_temp.guarda('z1b_');
select is(pg_temp.sqlstate_of($$select public.investment_operation_record_by_value(pg_temp.fx('z1b'), date '2025-02-10', 'sell', 200.00, null, pg_temp.fx('cc'))$$),
          '22023', 'Z2 resgate de 200 com data anterior à avaliação: 22023');
select is(pg_temp.nw(), pg_temp.n('z1b_nw'), 'Z2.1 o patrimônio não muda');
select is(pg_temp.saldo('cc') || '|' || pg_temp.mv('z1b'), pg_temp.n('z1b_cc') || '|1100.00', 'Z2.2 conta igual e ativo em 1.100,00');
-- Z3: avaliação total com data ANTERIOR a um aporte já gravado.
--     1.000 em 10/01; 500 em 10/03; depois, "valia 1.100" com data de 10/02 (quando só havia os 1.000).
--     Sem a trava: 1,5 unidade × 1.100 = 1.650 (os 500 de depois "rendiam" 50 no ato).
select pg_temp.novo('z2', 'Achado dois de teste');
select public.investment_operation_record_by_value(pg_temp.fx('z2'), date '2025-01-10', 'buy', 1000.00);
select public.investment_operation_record_by_value(pg_temp.fx('z2'), date '2025-03-10', 'buy', 500.00);
select pg_temp.guarda('z2_');
select is(pg_temp.sqlstate_of($$select public.investment_valuation_record_total(pg_temp.fx('z2'), date '2025-02-10', 1100.00, 'extrato de teste')$$),
          '22023', 'Z3 avaliação total com data anterior a um aporte: 22023');
select is(pg_temp.mv('z2'), 1500.00, 'Z3.1 o ativo continua valendo 1.500,00');
select is(pg_temp.nw(), pg_temp.n('z2_nw'), 'Z3.2 o patrimônio não muda');
-- Z4: resgate com data anterior a um resgate total já gravado (o dinheiro saía duas vezes e a quantidade ficava −1).
select pg_temp.novo('z3', 'Achado três de teste');
select public.investment_operation_record_by_value(pg_temp.fx('z3'), date '2025-01-10', 'buy', 1000.00, null, pg_temp.fx('cc'));
select public.investment_operation_record_by_value(pg_temp.fx('z3'), date '2025-03-10', 'sell', 1000.00, null, pg_temp.fx('cc'));
select pg_temp.guarda('z3_');
select is(pg_temp.sqlstate_of($$select public.investment_operation_record_by_value(pg_temp.fx('z3'), date '2025-02-10', 'sell', 1000.00, null, pg_temp.fx('cc'))$$),
          '22023', 'Z4 resgatar de novo, com data anterior, o que já foi todo resgatado: 22023');
select is(pg_temp.saldo('cc'), pg_temp.n('z3_cc'), 'Z4.1 a conta não recebe outra vez');
select is(pg_temp.qtd('z3'), 0::numeric, 'Z4.2 a quantidade do ativo segue zero (não fica negativa)');
select is(pg_temp.nw(), pg_temp.n('z3_nw'), 'Z4.3 patrimônio IGUAL');
select is(pg_temp.sqlstate_of($$select public.investment_operation_record_by_value(pg_temp.fx('z3'), date '2025-03-10', 'sell', 0.01, null, pg_temp.fx('cc'))$$),
          '23514', 'Z4.4 e na mesma data do resgate total não há mais o que resgatar: 23514');
select is(pg_temp.saldo('cc'), pg_temp.n('z3_cc'), 'Z4.5 a conta segue igual');

-- ---- Y: avaliação e aporte no MESMO dia (achado da revisão do extrato) ----
-- A linha de avaliação mostra o total que foi informado. Um aporte gravado depois, no mesmo dia, não entra nela.
-- Dentro de uma transação todos os created_at são iguais; no uso real o aporte é gravado depois da avaliação, então o
-- teste acerta o created_at como superusuário (não há outro jeito de reproduzir a ordem).
select pg_temp.login('00000000-0000-0000-0000-0000000098a1');
select pg_temp.novo('y1', 'Mesmo dia um de teste');
select public.investment_operation_record_by_value(pg_temp.fx('y1'), date '2025-01-10', 'buy', 1000.00);
insert into fixture select 'y1_v', public.investment_valuation_record_total(pg_temp.fx('y1'), date '2025-02-10', 1037.53, 'extrato de teste');
insert into fixture select 'y1_o', public.investment_operation_record_by_value(pg_temp.fx('y1'), date '2025-02-10', 'buy', 500.00);
reset role;
update public.investment_operations set created_at = created_at + interval '1 minute' where id = pg_temp.fx('y1_o');
select pg_temp.login('00000000-0000-0000-0000-0000000098a1');
select is((select amount from public.investment_asset_statement(pg_temp.fx('h'), pg_temp.fx('y1')) where entry_id = pg_temp.fx('y1_v')),
          1037.53::numeric, 'Y1 avaliação de 1.037,53 e aporte de 500 depois, no mesmo dia: a linha da avaliação mostra 1.037,53');
select is(pg_temp.mv('y1'), 1537.53, 'Y1.1 e a posição vale 1.537,53 (avaliação + aporte)');
-- o contrário: o aporte do dia veio ANTES da avaliação, então faz parte do total informado
select pg_temp.novo('y2', 'Mesmo dia dois de teste');
select public.investment_operation_record_by_value(pg_temp.fx('y2'), date '2025-01-10', 'buy', 1000.00);
select public.investment_operation_record_by_value(pg_temp.fx('y2'), date '2025-02-10', 'buy', 500.00);
insert into fixture select 'y2_v', public.investment_valuation_record_total(pg_temp.fx('y2'), date '2025-02-10', 1600.00, 'extrato de teste');
reset role;
update public.investment_valuations set created_at = created_at + interval '1 minute' where id = pg_temp.fx('y2_v');
select pg_temp.login('00000000-0000-0000-0000-0000000098a1');
select is((select amount from public.investment_asset_statement(pg_temp.fx('h'), pg_temp.fx('y2')) where entry_id = pg_temp.fx('y2_v')),
          1600.00::numeric, 'Y2 aporte de 500 e avaliação de 1.600 depois, no mesmo dia: a linha da avaliação mostra 1.600,00');
select is(pg_temp.mv('y2'), 1600.00, 'Y2.1 e a posição vale 1.600,00');

-- ---- X: resgate "quase total" não deixa resto invisível (achado da revisão de dinheiro) ----
-- Fundo sem ticker comprado por cotas: 3 cotas, avaliação a 33,335 por cota (3 × 33,335 = 100,005 → vale 100,01).
-- Resgatar 100,00 deixaria 0,00015 cota valendo R$ 0,00: nem resgate (0,01 > 0,00) nem arquivo (há posição).
select pg_temp.login('00000000-0000-0000-0000-0000000098a1');
select pg_temp.novo('x1', 'Resto invisível de teste');
select public.investment_operation_record(pg_temp.fx('x1'), date '2025-01-10', 'buy', 3, 33.33, 0, null, pg_temp.fx('cc'));
select public.investment_valuation_record(pg_temp.fx('x1'), date '2025-02-10', 33.335, 'cota de teste');
select is(pg_temp.mv('x1'), 100.01, 'X1 3 cotas a 33,335 valem 100,01');
select pg_temp.guarda('x1_');
create temp table x1_antes as select pg_temp.gravado() as g;
grant all on x1_antes to public;
select is(pg_temp.err_of($$select public.investment_operation_record_by_value(pg_temp.fx('x1'), date '2025-02-10', 'sell', 100.00, null, pg_temp.fx('cc'))$$),
          '23514: sobraria menos de 1 centavo neste investimento; para zerar, resgate o total de R$ 100,01',
          'X2 resgatar 100,00 de 100,01 é recusado, com o total a resgatar na mensagem (em reais, formato do Brasil)');
select is(pg_temp.gravado(), (select g from x1_antes), 'X2.1 nada foi gravado');
select is(pg_temp.saldo('cc'), pg_temp.n('x1_cc'), 'X2.2 a conta não mudou');
select is(pg_temp.qtd('x1'), 3::numeric, 'X2.3 as 3 cotas continuam lá');
select is(pg_temp.err_of($$select public.investment_operation_record_by_value(pg_temp.fx('x1'), date '2025-02-10', 'sell', 1100.02, null, pg_temp.fx('cc'))$$),
          '23514: resgate maior que o valor do investimento nesta data (R$ 100,01); se o valor mudou, registre a avaliação antes',
          'X3 resgate maior que o valor: a mensagem traz o valor em reais, formato do Brasil');
-- um resgate parcial que deixa resto com valor continua valendo
select lives_ok($$select public.investment_operation_record_by_value(pg_temp.fx('x1'), date '2025-02-10', 'sell', 50.00, null, pg_temp.fx('cc'))$$,
                'X4 resgate parcial de 50,00 é aceito');
select is(pg_temp.saldo('cc'), pg_temp.n('x1_cc') + 50.00, 'X4.1 a conta recebe exatamente 50,00');
-- e o resgate do total zera de verdade
select lives_ok(format($$select public.investment_operation_record_by_value(pg_temp.fx('x1'), date '2025-02-10', 'sell', %s, null, pg_temp.fx('cc'))$$, pg_temp.mv('x1')),
                'X5 resgatar o valor total que sobrou é aceito');
select is(pg_temp.qtd('x1'), 0::numeric, 'X5.1 e a posição zera exata, sem resto');

select * from finish();
rollback;
