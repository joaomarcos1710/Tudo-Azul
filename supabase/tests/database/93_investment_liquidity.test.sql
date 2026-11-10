-- 93_investment_liquidity: migration 099 (20261110080000_investment_liquidity.sql). Decisão do dono de 10/11/2026
-- ("opção C"): o ativo da carteira tem liquidez ('liquid' ou 'restricted'), a carteira é lida por liquidez e o
-- Patrimônio total (home_indicators e net_worth_with_assets) passa a SOMAR a carteira em reais (revoga a 075, #196).
-- O Disponível não muda. Dados inventados; datas relativas a hoje em São Paulo (a RPC de operação recusa data futura).
-- Sem a migration este arquivo falha (não existem a coluna, as duas funções nem as colunas novas de home_indicators).
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
-- "moeda|liquidez|valor" de cada linha, separado por ;
create function pg_temp.liq(p_h uuid) returns text language sql as $f$
  select string_agg(currency_code || '|' || liquidity || '|' || market_value::numeric(14,2), ';' order by currency_code, liquidity)
    from public.investment_liquidity_totals(p_h, pg_temp.hoje()) $f$;
grant execute on all functions in schema pg_temp to public;

-- ---- forma e permissões ----
select col_not_null('public', 'investment_assets', 'liquidity', 'F1 liquidity é obrigatória');
select col_default_is('public', 'investment_assets', 'liquidity', 'liquid', 'F2 e nasce liquid');
select ok(not has_function_privilege('anon', 'public.investment_asset_set_liquidity(uuid, text)', 'EXECUTE'), 'P1 anon não define liquidez');
select ok(has_function_privilege('authenticated', 'public.investment_asset_set_liquidity(uuid, text)', 'EXECUTE'), 'P2 authenticated define');
select ok((select prosecdef from pg_proc where oid = 'public.investment_asset_set_liquidity(uuid, text)'::regprocedure), 'P3 set_liquidity é SECURITY DEFINER');
select is((select proconfig from pg_proc where oid = 'public.investment_asset_set_liquidity(uuid, text)'::regprocedure),
          array['search_path=""'], 'P4 com search_path vazio');
select ok(not has_function_privilege('anon', 'public.investment_liquidity_totals(uuid, date)', 'EXECUTE'), 'P5 anon não lê os totais');
select ok(has_function_privilege('authenticated', 'public.investment_liquidity_totals(uuid, date)', 'EXECUTE'), 'P6 authenticated lê');
select ok(not (select prosecdef from pg_proc where oid = 'public.investment_liquidity_totals(uuid, date)'::regprocedure), 'P7 totais são SECURITY INVOKER');
select is((select proconfig from pg_proc where oid = 'public.investment_liquidity_totals(uuid, date)'::regprocedure),
          array['search_path=""'], 'P8 com search_path vazio');
-- home_indicators foi recriada (drop + create): os grants e as opções têm de ter voltado
select ok(not has_function_privilege('anon', 'public.home_indicators(uuid, date)', 'EXECUTE'), 'P9 home_indicators: anon não executa');
select ok(has_function_privilege('authenticated', 'public.home_indicators(uuid, date)', 'EXECUTE'), 'P10 home_indicators: authenticated executa');
select ok(not (select prosecdef from pg_proc where oid = 'public.home_indicators(uuid, date)'::regprocedure), 'P11 home_indicators: SECURITY INVOKER');
select is((select proconfig from pg_proc where oid = 'public.home_indicators(uuid, date)'::regprocedure),
          array['search_path=""', 'jit=off'], 'P12 home_indicators: search_path vazio e sem JIT');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'home_indicators'), 1::bigint, 'P13 uma home_indicators só (sem sobrecarga)');
select matches(pg_get_function_result('public.home_indicators(uuid, date)'::regprocedure),
               'commitment_band text, investments_liquid numeric, investments_restricted numeric\)$',
               'P14 as duas colunas novas ficam NO FIM do retorno');
select is(pg_get_function_result('public.net_worth_with_assets(uuid, date)'::regprocedure),
          'TABLE(available numeric, debt numeric, credit_receivable numeric, family_assets_brl numeric, net_worth numeric, planned_commitments numeric, investments_brl numeric)',
          'P15 net_worth_with_assets: as colunas de antes na mesma ordem e investments_brl NO FIM');
-- net_worth_with_assets também foi recriada (drop + create)
select ok(not has_function_privilege('anon', 'public.net_worth_with_assets(uuid, date)', 'EXECUTE'), 'P16 net_worth_with_assets: anon não executa');
select ok(has_function_privilege('authenticated', 'public.net_worth_with_assets(uuid, date)', 'EXECUTE'), 'P17 net_worth_with_assets: authenticated executa');
select ok(not (select prosecdef from pg_proc where oid = 'public.net_worth_with_assets(uuid, date)'::regprocedure), 'P18 net_worth_with_assets: SECURITY INVOKER');
select is((select proconfig from pg_proc where oid = 'public.net_worth_with_assets(uuid, date)'::regprocedure),
          array['search_path=""'], 'P19 net_worth_with_assets: search_path vazio');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'net_worth_with_assets'), 1::bigint, 'P20 uma net_worth_with_assets só (sem sobrecarga)');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000093a1', 'l1@teste.com'),
  ('00000000-0000-0000-0000-0000000093a2', 'l2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000093a1');
insert into fixture select 'h', public.create_household('Casa Liquidez');
insert into public.accounts (household_id, name, type, initial_balance, opening_date, currency_code)
values (pg_temp.fx('h'), 'Conta de teste', 'checking', 500, pg_temp.hoje() - 30, 'BRL');
insert into fixture select 'tes',  public.investment_asset_create(pg_temp.fx('h'), 'Tesouro de teste', null, 'fixed_income', 'BRL');
insert into fixture select 'acao', public.investment_asset_create(pg_temp.fx('h'), 'Ação de teste', 'TEST3', 'equity', 'BRL');
insert into fixture select 'prev', public.investment_asset_create(pg_temp.fx('h'), 'Previdência de teste', null, 'fund', 'BRL');
insert into fixture select 'usa',  public.investment_asset_create(pg_temp.fx('h'), 'ETF de teste', 'TSTE', 'etf', 'USD');
insert into fixture select 'usar', public.investment_asset_create(pg_temp.fx('h'), 'Plano no exterior de teste', null, 'fund', 'USD');
-- valor = quantidade × preço (sem avaliação, o custo é a referência): BRL 600 + 100 + 300 = 1.000; USD 200 + 50 = 250
select public.investment_operation_record(pg_temp.fx('tes'),  pg_temp.hoje() - 10, 'buy', 1, 600.00);
select public.investment_operation_record(pg_temp.fx('acao'), pg_temp.hoje() - 10, 'buy', 10, 10.00);
select public.investment_operation_record(pg_temp.fx('prev'), pg_temp.hoje() - 10, 'buy', 1, 300.00);
select public.investment_operation_record(pg_temp.fx('usa'),  pg_temp.hoje() - 10, 'buy', 2, 100.00);
select public.investment_operation_record(pg_temp.fx('usar'), pg_temp.hoje() - 10, 'buy', 1, 50.00);

create temp view hi with (security_invoker = true) as select * from public.home_indicators(pg_temp.fx('h'), pg_temp.hoje());
grant select on hi to public;
create temp view nw with (security_invoker = true) as select * from public.net_worth_with_assets(pg_temp.fx('h'), pg_temp.hoje());
grant select on nw to public;

-- ---- A: tudo nasce líquido ----
select is((select count(*) from public.investment_assets where household_id = pg_temp.fx('h') and liquidity <> 'liquid'), 0::bigint,
          'A1 todo ativo nasce liquid (ninguém é reclassificado por suposição)');
select is(pg_temp.liq(pg_temp.fx('h')), 'BRL|liquid|1000.00;USD|liquid|250.00', 'A2 sem restrito: uma linha por moeda, sem linha zerada');
select is((select investments || '|' || investments_liquid || '|' || investments_restricted from hi), '1000.00|1000.00|0.00',
          'A3 Início: carteira em reais toda líquida');
select is((select net_worth from hi), 1500.00, 'A4 patrimônio = 500 da conta + 1.000 da carteira em reais (os 250 em dólar fora)');
select is((select available || '|' || accounts_active from hi), '500.00|500.00', 'A5 Disponível = só a conta (a carteira não entra)');

-- ---- B: marcar como restrito ----
select lives_ok($$select public.investment_asset_set_liquidity(pg_temp.fx('prev'), 'restricted')$$, 'B1 marca a previdência como restrita');
select is((select liquidity from public.investment_assets where id = pg_temp.fx('prev')), 'restricted', 'B1.1 gravou');
select lives_ok($$select public.investment_asset_set_liquidity(pg_temp.fx('prev'), 'restricted')$$, 'B2 marcar de novo o mesmo valor não dá erro');
select is((select liquidity from public.investment_assets where id = pg_temp.fx('prev')), 'restricted', 'B2.1 e continua restricted');
select public.investment_asset_set_liquidity(pg_temp.fx('usar'), 'restricted');
select is((select count(*) from public.investment_assets where household_id = pg_temp.fx('h') and liquidity = 'restricted'), 2::bigint,
          'B3 só os dois marcados mudaram');
select is(pg_temp.liq(pg_temp.fx('h')), 'BRL|liquid|700.00;BRL|restricted|300.00;USD|liquid|200.00;USD|restricted|50.00',
          'B4 por moeda e por liquidez; real e dólar nunca se somam');
select is((select sum(market_value) from public.investment_liquidity_totals(pg_temp.fx('h'), pg_temp.hoje()) where currency_code = 'BRL'),
          (select market_value from public.investment_totals(pg_temp.fx('h'), pg_temp.hoje()) where currency_code = 'BRL'),
          'B5 soma das linhas BRL = investment_totals');
select is((select sum(market_value) from public.investment_liquidity_totals(pg_temp.fx('h'), pg_temp.hoje()) where currency_code = 'USD'),
          (select market_value from public.investment_totals(pg_temp.fx('h'), pg_temp.hoje()) where currency_code = 'USD'),
          'B5.1 soma das linhas USD = investment_totals');
select is((select count(*) from public.investment_liquidity_totals(pg_temp.fx('h'), pg_temp.hoje() - 11)), 0::bigint,
          'B6 antes da primeira compra não há linha (segue a data de corte da carteira)');

-- ---- C: Início ----
select is((select investments || '|' || investments_liquid || '|' || investments_restricted from hi), '1000.00|700.00|300.00',
          'C1 carteira em reais: 700 líquidos + 300 restritos (o dólar fora dos dois)');
select is((select investments_liquid + investments_restricted from hi), (select investments from hi), 'C2 líquido + restrito = investments');
select is((select net_worth from hi), 1500.00, 'C3 o patrimônio soma a carteira em reais inteira (restrito incluído) e não soma o dólar');
select is((select net_worth from hi), (select accounts_total + credit_receivable + family_assets + investments - debt_total from hi),
          'C4 patrimônio = contas + crédito a receber + bens + carteira em reais − dívidas');
select is((select available || '|' || accounts_active from hi), '500.00|500.00', 'C5 Disponível não muda com ativo restrito');
select is((select net_worth from nw), (select net_worth from hi), 'C6 net_worth_with_assets (Análises) = patrimônio do Início');
select is((select net_worth from nw), 1500.00, 'C6.1 e vale 1.500');
select is((select available || '|' || family_assets_brl || '|' || debt from nw), '500.00|0|0', 'C7 as outras colunas de Análises não mudam');
select is((select investments_brl from nw), (select investments from hi), 'C7.1 Análises: investments_brl = investments do Início');
select is((select investments_brl from nw), 1000.00, 'C7.2 e vale 1.000 (o dólar fora)');
select is((select available + credit_receivable + family_assets_brl + investments_brl - debt from nw), (select net_worth from nw),
          'C7.3 Análises fecha a conta sozinha: disponível + crédito + bens + carteira − dívida = patrimônio');

-- o valor de mercado novo acompanha a liquidez do ativo
select public.investment_valuation_record(pg_temp.fx('prev'), pg_temp.hoje(), 350.00, 'avaliação de teste');
select is(pg_temp.liq(pg_temp.fx('h')), 'BRL|liquid|700.00;BRL|restricted|350.00;USD|liquid|200.00;USD|restricted|50.00',
          'C8 a avaliação nova entra no balde do ativo');
select is((select investments || '|' || investments_liquid || '|' || investments_restricted || '|' || net_worth from hi),
          '1050.00|700.00|350.00|1550.00', 'C9 e no Início: carteira 1.050, patrimônio 1.550');

-- com bem e dívida, Início e Análises continuam iguais
select public.family_asset_create(pg_temp.fx('h'), 'Carro de teste', 'vehicle', null, 'BRL', 'Família', 100, pg_temp.hoje() - 10, 20000, pg_temp.hoje() - 9, 'Avaliação de teste');
select public.create_debt('Empréstimo de teste', 'loan', pg_temp.hoje() - 10, 5000);
select is((select net_worth from hi), 16550.00, 'C10 500 + 20.000 + 1.050 − 5.000');
select is((select net_worth from nw), (select net_worth from hi), 'C11 com bem e dívida, Análises = Início');
select is((select investments_brl from nw), (select investments from hi), 'C12 com avaliação nova, investments_brl = investments do Início (1.050)');
select is((select available + credit_receivable + family_assets_brl + investments_brl - debt from nw), (select net_worth from nw),
          'C12.1 com bem e dívida, Análises continua fechando a conta sozinha');
select is((select concat_ws('|', available::numeric(14,2), credit_receivable::numeric(14,2), family_assets_brl::numeric(14,2),
                            investments_brl::numeric(14,2), debt::numeric(14,2)) from nw),
          '500.00|0.00|20000.00|1050.00|5000.00', 'C12.2 parcelas: 500 + 0 + 20.000 + 1.050 − 5.000');

-- a Home de Decisão devolve a linha de home_indicators em `treasury`: ganha as chaves novas e o patrimônio novo
select is((select (j->'treasury'->>'investments_liquid') || '|' || (j->'treasury'->>'investments_restricted') || '|' || (j->'treasury'->>'net_worth')
             from (select public.get_home_decision_month(pg_temp.fx('h'), pg_temp.hoje()) as j) x),
          '700.00|350.00|16550.00', 'C13 get_home_decision_month.treasury acompanha');

-- ---- D: voltar para líquido e validações ----
select lives_ok($$select public.investment_asset_set_liquidity(pg_temp.fx('prev'), 'liquid')$$, 'D1 volta para liquid');
select is((select investments || '|' || investments_liquid || '|' || investments_restricted || '|' || net_worth from hi),
          '1050.00|1050.00|0.00|16550.00', 'D1.1 muda o balde, não o total nem o patrimônio');
select public.investment_asset_set_liquidity(pg_temp.fx('prev'), 'restricted');
select is(pg_temp.sqlstate_of($$select public.investment_asset_set_liquidity(pg_temp.fx('prev'), 'bloqueado')$$), '22023', 'D2 valor desconhecido: 22023');
select is(pg_temp.sqlstate_of($$select public.investment_asset_set_liquidity(pg_temp.fx('prev'), null)$$), '22023', 'D2.1 nulo: 22023');
select is(pg_temp.sqlstate_of($$select public.investment_asset_set_liquidity(pg_temp.fx('prev'), '')$$), '22023', 'D2.2 vazio: 22023');
select is(pg_temp.sqlstate_of($$select public.investment_asset_set_liquidity(pg_temp.fx('prev'), 'LIQUID')$$), '22023', 'D2.3 maiúsculas: 22023 (sem adivinhar)');
select is((select liquidity from public.investment_assets where id = pg_temp.fx('prev')), 'restricted', 'D2.4 a recusa não altera o ativo');
select is(pg_temp.sqlstate_of($$select public.investment_asset_set_liquidity('00000000-0000-0000-0000-000000000000', 'liquid')$$), '42501',
          'D3 ativo inexistente: 42501');
select is(pg_temp.sqlstate_of($$update public.investment_assets set liquidity = 'liquid' where id = pg_temp.fx('prev')$$), '42501',
          'D4 o cliente não escreve direto na tabela');
select is(pg_temp.sqlstate_of(format($$insert into public.investment_assets (household_id, name, asset_class, currency_code, liquidity)
                                        values (%L, 'Direto', 'fund', 'BRL', 'restricted')$$, pg_temp.fx('h'))), '42501',
          'D4.1 nem insere direto');

-- ---- E: outra família e anon ----
select pg_temp.login('00000000-0000-0000-0000-0000000093a2');
insert into fixture select 'h2', public.create_household('Casa Outra');
insert into fixture select 'prev2', public.investment_asset_create(pg_temp.fx('h2'), 'Previdência da outra casa', null, 'fund', 'BRL');
select public.investment_operation_record(pg_temp.fx('prev2'), pg_temp.hoje() - 3, 'buy', 1, 80.00);
select public.investment_asset_set_liquidity(pg_temp.fx('prev2'), 'restricted');
select is(pg_temp.sqlstate_of($$select public.investment_asset_set_liquidity(pg_temp.fx('tes'), 'restricted')$$), '42501', 'E1 ativo de outra família: 42501');
select is((select count(*) from public.investment_liquidity_totals(pg_temp.fx('h'), pg_temp.hoje())), 0::bigint, 'E2 quem não é da família recebe zero linhas');
select is((select count(*) from public.home_indicators(pg_temp.fx('h'), pg_temp.hoje())), 0::bigint, 'E2.1 nem os indicadores');
select is((select count(*) from public.net_worth_with_assets(pg_temp.fx('h'), pg_temp.hoje())), 0::bigint, 'E2.2 nem o patrimônio');
select is(pg_temp.liq(pg_temp.fx('h2')), 'BRL|restricted|80.00', 'E3 a outra família só vê o que é dela');
select is((select investments_restricted || '|' || net_worth from public.home_indicators(pg_temp.fx('h2'), pg_temp.hoje())), '80.00|80.00',
          'E3.1 e o patrimônio dela só soma a carteira dela');

reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000093a1');
select is((select liquidity from public.investment_assets where id = pg_temp.fx('tes')), 'liquid', 'E4 a tentativa da outra família não mudou nada');
select is(pg_temp.liq(pg_temp.fx('h')), 'BRL|liquid|700.00;BRL|restricted|350.00;USD|liquid|200.00;USD|restricted|50.00',
          'E4.1 e os totais da primeira família seguem os mesmos');

reset role;
select set_config('request.jwt.claims', '{}', true), set_config('role', 'anon', true);
select is(pg_temp.sqlstate_of($$select public.investment_asset_set_liquidity(pg_temp.fx('tes'), 'restricted')$$), '42501', 'E5 anon não define liquidez');
select is(pg_temp.sqlstate_of($$select * from public.investment_liquidity_totals(pg_temp.fx('h'), pg_temp.hoje())$$), '42501', 'E5.1 anon não lê os totais');

select * from finish();
rollback;
