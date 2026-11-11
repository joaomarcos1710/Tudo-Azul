-- 103_market_quotes: migration 109 (20261111120000_market_quotes.sql). Pedido do dono de 11/11/2026: o valor das ações e
-- dos fundos imobiliários acompanhar a cotação da bolsa (brapi), sem digitar.
-- O que este arquivo prova:
--   • a cotação só vale para o ativo em que alguém LIGOU "seguir a bolsa"; ativo sem a escolha, de qualquer família,
--     continua valendo o que valia, mesmo com cotação gravada para o mesmo código;
--   • a regra do dono: entre a avaliação digitada e a cotação, vale a mais recente; no mesmo dia, a digitada;
--   • posição, totais, aportes e histórico mostram o mesmo valor (todos passam por investment_portfolio / price_at);
--   • só liga em ação, FII, ETF ou fundo, em reais, com código da B3, e sem operação em fração de cota;
--   • ativo que segue a bolsa recusa lançamento "só pelo valor";
--   • a gravação da resposta da brapi: fuso de São Paulo, o pregão mais novo do dia vence, código trocado e moeda
--     estrangeira são ignorados, resposta fora do formato estoura;
--   • a busca: sem ativo não precisa de chave; com ativo e sem chave ESTOURA antes de qualquer chamada de rede;
--   • ninguém do app grava cotação nem chama a busca; outra família não liga o ativo alheio.
-- A chamada de rede (private.market_quotes_fetch com chave) não roda aqui: o teste usa respostas no formato real da
-- brapi (o JSON que ela devolveu em 11/11/2026) com códigos e preços inventados. Datas relativas a hoje em São Paulo.
-- Sem a migration este arquivo falha (tabela, coluna e funções não existem).
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
create function pg_temp.dia(p_n integer) returns date language sql as $f$ select pg_temp.hoje() - p_n $f$;
create function pg_temp.erro_de(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
create function pg_temp.msg_de(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlerrm; end $f$;
-- a resposta da brapi para um código: horário do pregão em UTC (ISO), como ela devolve
create function pg_temp.item(p_pedido text, p_veio text, p_trocado boolean, p_moeda text, p_preco jsonb, p_dia date, p_hora text)
returns jsonb language sql as $f$
  select jsonb_build_object('requestedSymbol', p_pedido, 'symbol', p_veio, 'changed', p_trocado,
    'data', jsonb_build_object('shortName', p_veio, 'longName', 'Empresa de teste', 'currency', p_moeda,
      'regularMarketPrice', p_preco,
      'regularMarketTime', to_char(((p_dia + p_hora::time) at time zone 'America/Sao_Paulo') at time zone 'UTC',
                                   'YYYY-MM-DD"T"HH24:MI:SS".000Z"'),
      'regularMarketVolume', 1000)) $f$;
create function pg_temp.resp(p_codigo text, p_preco numeric, p_dia date, p_hora text default '15:00') returns jsonb language sql as $f$
  select jsonb_build_object('results', jsonb_build_array(pg_temp.item(p_codigo, p_codigo, false, 'BRL', to_jsonb(p_preco), p_dia, p_hora)),
                            'requestedAt', '2026-11-11T14:57:05.333Z', 'took', 0) $f$;
create function pg_temp.so(p_item jsonb) returns jsonb language sql as $f$
  select jsonb_build_object('results', jsonb_build_array(p_item), 'requestedAt', '2026-11-11T14:57:05.333Z', 'took', 0) $f$;
-- a cotação gravada de um código num dia: "preço|moeda|fonte"
create function pg_temp.cot(p_codigo text, p_dia date) returns text language sql as $f$
  select concat_ws('|', q.price, q.currency_code, q.source) from public.market_quotes q where q.symbol = p_codigo and q.quote_date = p_dia $f$;
-- a posição de um ativo: "quantidade|custo|valor|resultado|data do preço|fonte"
create function pg_temp.pos(p_h text, p_k text, p_dia date) returns text language sql as $f$
  select concat_ws('|', p.quantity, p.cost_basis, p.market_value, p.unrealized_result,
                        coalesce(p.valuation_date::text, 'sem data'), coalesce(p.valuation_source, 'sem fonte'))
    from public.investment_portfolio(pg_temp.fx(p_h), p_dia) p where p.asset_id = pg_temp.fx(p_k) $f$;
create function pg_temp.valor(p_h text, p_k text, p_dia date) returns numeric language sql as $f$
  select p.market_value from public.investment_portfolio(pg_temp.fx(p_h), p_dia) p where p.asset_id = pg_temp.fx(p_k) $f$;
create function pg_temp.liga(p_k text, p_on boolean) returns void language sql as $f$
  select public.investment_asset_set_market_quote(pg_temp.fx(p_k), p_on) $f$;
grant execute on all functions in schema pg_temp to public;

-- ---- F: forma e permissões ----
select has_table('public', 'market_quotes', 'F1 existe public.market_quotes');
select ok((select relrowsecurity from pg_class where oid = 'public.market_quotes'::regclass), 'F2 market_quotes com RLS ligada');
select ok(has_table_privilege('authenticated', 'public.market_quotes', 'SELECT')
          and not has_table_privilege('authenticated', 'public.market_quotes', 'INSERT')
          and not has_table_privilege('authenticated', 'public.market_quotes', 'UPDATE')
          and not has_table_privilege('authenticated', 'public.market_quotes', 'DELETE')
          and not has_table_privilege('anon', 'public.market_quotes', 'SELECT'),
          'F3 quem está logado só lê a cotação; anon nem lê');
select is((select concat_ws('|', data_type, is_nullable, column_default) from information_schema.columns
            where table_schema = 'public' and table_name = 'investment_assets' and column_name = 'market_quote'),
          'boolean|NO|false', 'F4 investment_assets.market_quote: booleano, obrigatório, falso por padrão');
select has_function('public', 'investment_asset_set_market_quote', array['uuid', 'boolean'], 'F5 existe investment_asset_set_market_quote(uuid, boolean)');
select has_function('private', 'investment_quote_symbol', array['boolean', 'text', 'text', 'text'], 'F6 existe private.investment_quote_symbol');
select has_function('private', 'investment_price_at', array['uuid', 'uuid', 'date'], 'F7 existe private.investment_price_at');
select has_function('private', 'market_quote_record', array['text', 'jsonb'], 'F8 existe private.market_quote_record');
select has_function('private', 'market_quotes_fetch', array['integer'], 'F9 existe private.market_quotes_fetch');
select ok(has_function_privilege('authenticated', 'public.investment_asset_set_market_quote(uuid, boolean)', 'execute')
          and not has_function_privilege('anon', 'public.investment_asset_set_market_quote(uuid, boolean)', 'execute'),
          'F10 ligar a cotação: authenticated executa, anon não');
select ok(not has_function_privilege('authenticated', 'private.market_quote_record(text, jsonb)', 'execute')
          and not has_function_privilege('anon', 'private.market_quote_record(text, jsonb)', 'execute')
          and not has_function_privilege('authenticated', 'private.market_quotes_fetch(integer)', 'execute')
          and not has_function_privilege('anon', 'private.market_quotes_fetch(integer)', 'execute'),
          'F11 gravar e buscar cotação: ninguém do app executa (só o agendamento, como dono do banco)');
select ok(has_function_privilege('authenticated', 'private.investment_price_at(uuid, uuid, date)', 'execute')
          and not has_function_privilege('anon', 'private.investment_price_at(uuid, uuid, date)', 'execute')
          and not has_function_privilege('anon', 'private.investment_quote_symbol(boolean, text, text, text)', 'execute'),
          'F12 o preço na data: authenticated executa (a posição é SECURITY INVOKER), anon não');
select ok(not (select prosecdef from pg_proc where oid = 'private.investment_price_at(uuid, uuid, date)'::regprocedure)
          and not (select prosecdef from pg_proc where oid = 'private.market_quotes_fetch(integer)'::regprocedure)
          and not (select prosecdef from pg_proc where oid = 'private.market_quote_record(text, jsonb)'::regprocedure)
          and not (select prosecdef from pg_proc where oid = 'public.investment_portfolio(uuid, date)'::regprocedure)
          and not (select prosecdef from pg_proc where oid = 'public.investment_history(uuid, date, date)'::regprocedure),
          'F13 preço, busca, gravação, posição e histórico são SECURITY INVOKER (vale a RLS de quem chama)');
select is(pg_get_function_result('public.investment_portfolio(uuid, date)'::regprocedure),
          'TABLE(asset_id uuid, name text, ticker text, asset_class text, currency_code text, quantity numeric, average_cost numeric, cost_basis numeric, unit_price numeric, market_value numeric, unrealized_result numeric, valuation_date date, valuation_source text)',
          'F14 investment_portfolio com as mesmas colunas de antes');
select is(pg_get_function_result('public.investment_history(uuid, date, date)'::regprocedure),
          'TABLE(month date, currency_code text, market_value numeric, cost_basis numeric)', 'F15 investment_history com as mesmas colunas de antes');
select ok(has_function_privilege('authenticated', 'public.investment_portfolio(uuid, date)', 'execute')
          and has_function_privilege('authenticated', 'public.investment_history(uuid, date, date)', 'execute')
          and has_function_privilege('authenticated', 'public.investment_operation_record_by_value(uuid, date, text, numeric, text, uuid)', 'execute')
          and not has_function_privilege('anon', 'public.investment_portfolio(uuid, date)', 'execute')
          and not has_function_privilege('anon', 'public.investment_history(uuid, date, date)', 'execute')
          and not has_function_privilege('anon', 'public.investment_operation_record_by_value(uuid, date, text, numeric, text, uuid)', 'execute'),
          'F16 as três funções recriadas mantêm os grants (authenticated sim, anon não)');
create function pg_temp.agendado() returns boolean language plpgsql as $f$
declare v boolean;
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then return true; end if;
  if not exists (select 1 from pg_namespace where nspname = 'cron') then return false; end if;
  execute $q$select exists (select 1 from cron.job where jobname = 'cotacoes-bolsa' and schedule = '30 17,22 * * 1-5'
                              and command = 'select private.market_quotes_fetch()')$q$ into v;
  return v;
end $f$;
select ok(pg_temp.agendado(), 'F17 onde há pg_cron, o job cotacoes-bolsa roda em dia útil às 17:30 e 22:30 UTC'
          || case when exists (select 1 from pg_available_extensions where name = 'pg_cron') then '' else ' [sem pg_cron neste banco: não conferido]' end);

-- ---- S: qual código consultar ----
select is(private.investment_quote_symbol(true, 'TAZL3', 'equity', 'BRL'), 'TAZL3', 'S1 ação em reais com código da B3');
select is(private.investment_quote_symbol(true, '  tazl11 ', 'reit', 'BRL'), 'TAZL11', 'S2 minúsculas e espaços viram o código limpo');
select is(private.investment_quote_symbol(true, 'TAZL11', 'etf', 'BRL'), 'TAZL11', 'S3 ETF');
select is(private.investment_quote_symbol(true, 'TAZL11', 'fund', 'BRL'), 'TAZL11', 'S4 fundo listado');
select is(private.investment_quote_symbol(false, 'TAZL3', 'equity', 'BRL'), null, 'S5 sem a escolha ligada: nulo');
select is(private.investment_quote_symbol(null, 'TAZL3', 'equity', 'BRL'), null, 'S6 escolha nula: nulo');
select is(private.investment_quote_symbol(true, 'TAZL3', 'equity', 'USD'), null, 'S7 em dólar: nulo');
select is(private.investment_quote_symbol(true, 'TAZL3', 'fixed_income', 'BRL'), null, 'S8 renda fixa: nulo');
select is(private.investment_quote_symbol(true, 'TAZL3', 'crypto', 'BRL'), null, 'S9 cripto: nulo');
select is(private.investment_quote_symbol(true, 'TAZL3', 'other', 'BRL'), null, 'S10 outros: nulo');
select is(private.investment_quote_symbol(true, null, 'equity', 'BRL'), null, 'S11 sem código: nulo');
select is(private.investment_quote_symbol(true, 'BTC', 'equity', 'BRL'), null, 'S12 código que não é da B3 (3 letras): nulo');
select is(private.investment_quote_symbol(true, 'TAZL3F', 'equity', 'BRL'), null, 'S13 código do fracionário (letra no fim): nulo');
select is(private.investment_quote_symbol(true, 'TAZL123', 'equity', 'BRL'), null, 'S14 três números: nulo');
select is(private.investment_quote_symbol(true, 'TAZL3&x=1', 'equity', 'BRL'), null, 'S15 nada além de letras e números chega à URL');

-- ---- B1: a busca sem nenhum ativo ligado não precisa de chave ----
select is(private.market_quotes_fetch(), 'nenhum ativo segue a cotação da bolsa', 'B1 sem ativo ligado, a busca não chama a rede nem pede a chave');

-- ---- R: gravar a resposta da brapi ----
select is(private.market_quote_record('TAZL3', pg_temp.resp('TAZL3', 25.00, pg_temp.dia(5))), true, 'R1 resposta válida: gravada');
select is(pg_temp.cot('TAZL3', pg_temp.dia(5)), '25.0000000000|BRL|brapi', 'R1.1 preço, moeda e fonte');
select is(private.market_quote_record('TAZL3', pg_temp.resp('TAZL3', 25.50, pg_temp.dia(5), '17:05')), true, 'R2 mesmo dia, pregão mais novo');
select is(pg_temp.cot('TAZL3', pg_temp.dia(5)), '25.5000000000|BRL|brapi', 'R2.1 a busca mais nova do dia troca o preço');
select is(private.market_quote_record('TAZL3', pg_temp.resp('TAZL3', 24.10, pg_temp.dia(5), '11:00')), true, 'R3 mesmo dia, pregão mais antigo: aceita sem gravar');
select is(pg_temp.cot('TAZL3', pg_temp.dia(5)), '25.5000000000|BRL|brapi', 'R3.1 a resposta mais antiga não volta o preço');
select is((select count(*) from public.market_quotes where symbol = 'TAZL3'), 1::bigint, 'R3.2 uma linha por código e por dia');
-- 23:30 em São Paulo é o dia seguinte em UTC: a data é a de São Paulo
select is(private.market_quote_record('TAZL11', pg_temp.resp('TAZL11', 9.87, pg_temp.dia(4), '23:30')), true, 'R4 pregão às 23:30 de São Paulo');
select is(pg_temp.cot('TAZL11', pg_temp.dia(4)), '9.8700000000|BRL|brapi', 'R4.1 a data da cotação é a de São Paulo, não a de UTC');
select is(pg_temp.cot('TAZL11', pg_temp.dia(3)), null, 'R4.2 e não aparece no dia seguinte');
select is(private.market_quote_record('TAZL3', pg_temp.resp('TAZL3', 12.3456789, pg_temp.dia(9))), true, 'R5 preço com mais de 2 casas');
select is(pg_temp.cot('TAZL3', pg_temp.dia(9)), '12.3456789000|BRL|brapi', 'R5.1 o preço da cota não é arredondado a centavos');
-- o que não serve de preço é ignorado, sem erro e sem linha
select is(private.market_quote_record('TROC3', pg_temp.so(pg_temp.item('TROC3', 'NOVO3', true, 'BRL', '30.00', pg_temp.dia(5), '15:00'))), false,
          'R6 código trocado pela brapi (changed): ignorado');
select is(private.market_quote_record('TROC3', pg_temp.so(pg_temp.item('TROC3', 'NOVO3', false, 'BRL', '30.00', pg_temp.dia(5), '15:00'))), false,
          'R7 veio outro código no lugar do pedido: ignorado');
select is(private.market_quote_record('TROC3', pg_temp.so(pg_temp.item('TROC3', 'TROC3', false, 'USD', '30.00', pg_temp.dia(5), '15:00'))), false,
          'R8 cotação que não é em reais: ignorada');
select is(private.market_quote_record('TROC3', pg_temp.resp('TAZL3', 30.00, pg_temp.dia(5))), false, 'R9 o código pedido não veio na resposta: ignorado');
select is(private.market_quote_record('TROC3', '{"results": []}'::jsonb), false, 'R10 resposta sem nenhum resultado: ignorada');
select is((select count(*) from public.market_quotes where symbol in ('TROC3', 'NOVO3')), 0::bigint, 'R11 nada do que foi ignorado virou linha');
-- resposta fora do formato estoura (o cron mostra "failed")
select is(pg_temp.erro_de($$select private.market_quote_record('TAZL3', '{"error": true}'::jsonb)$$), '22023', 'R12 sem a lista results: 22023');
select is(pg_temp.erro_de($$select private.market_quote_record('TAZL3', null)$$), '22023', 'R13 resposta nula: 22023');
select is(pg_temp.erro_de(format($$select private.market_quote_record('TAZL3', %L::jsonb)$$,
            pg_temp.so(pg_temp.item('TAZL3', 'TAZL3', false, 'BRL', '"abc"', pg_temp.dia(5), '15:00')))), '22023', 'R14 preço que não é número: 22023');
select is(pg_temp.erro_de(format($$select private.market_quote_record('TAZL3', %L::jsonb)$$,
            pg_temp.so(pg_temp.item('TAZL3', 'TAZL3', false, 'BRL', '0', pg_temp.dia(5), '15:00')))), '22023', 'R15 preço zero: 22023');
select is(pg_temp.erro_de(format($$select private.market_quote_record('TAZL3', %L::jsonb)$$,
            pg_temp.so(pg_temp.item('TAZL3', 'TAZL3', false, 'BRL', '-3.2', pg_temp.dia(5), '15:00')))), '22023', 'R16 preço negativo: 22023');
select is(pg_temp.erro_de(format($$select private.market_quote_record('TAZL3', %L::jsonb)$$,
            pg_temp.so(pg_temp.item('TAZL3', 'TAZL3', false, 'BRL', 'null', pg_temp.dia(5), '15:00')))), '22023', 'R17 preço nulo: 22023');
select is(pg_temp.erro_de(format($$select private.market_quote_record('TAZL3', %L::jsonb)$$,
            pg_temp.resp('TAZL3', 30.00, pg_temp.dia(-2)))), '22023', 'R18 pregão com data no futuro: 22023');
select is(pg_temp.erro_de(format($$select private.market_quote_record('TAZL3', %L::jsonb)$$,
            jsonb_set(pg_temp.resp('TAZL3', 30.00, pg_temp.dia(5)), '{results,0,data,regularMarketTime}', '"ontem"'))), '22023', 'R19 horário ilegível: 22023');
select is(pg_temp.erro_de(format($$select private.market_quote_record('TAZL3', %L::jsonb)$$,
            jsonb_set(pg_temp.resp('TAZL3', 30.00, pg_temp.dia(5)), '{results,0,data}', '"x"'))), '22023', 'R20 data que não é objeto: 22023');
select is(pg_temp.erro_de($$select private.market_quote_record('tazl3', '{"results": []}'::jsonb)$$), '22023', 'R21 código fora do formato: 22023');
select is(pg_temp.cot('TAZL3', pg_temp.dia(5)), '25.5000000000|BRL|brapi', 'R22 nenhum erro mexeu na cotação que já estava gravada');

-- ---- famílias, ativos e operações (dados inventados) ----
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000103a1', 'q1@teste.com'),
  ('00000000-0000-0000-0000-0000000103a2', 'q2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000103a1');
insert into fixture select 'h', public.create_household('Casa da Bolsa');
insert into fixture select 'acao', public.investment_asset_create(pg_temp.fx('h'), 'Acao de teste', 'TAZL3', 'equity', 'BRL');
insert into fixture select 'fii', public.investment_asset_create(pg_temp.fx('h'), 'Fundo imobiliario de teste', 'tazl11', 'reit', 'BRL');
insert into fixture select 'cofre', public.investment_asset_create(pg_temp.fx('h'), 'Cofrinho de teste', null, 'fixed_income', 'BRL');
insert into fixture select 'gringa', public.investment_asset_create(pg_temp.fx('h'), 'Gringa de teste', 'TAZL3', 'equity', 'USD');
insert into fixture select 'curto', public.investment_asset_create(pg_temp.fx('h'), 'Codigo curto de teste', 'BTC', 'equity', 'BRL');
insert into fixture select 'porvalor', public.investment_asset_create(pg_temp.fx('h'), 'Lancado pelo valor de teste', 'TAZL4', 'equity', 'BRL');
insert into fixture select 'semop', public.investment_asset_create(pg_temp.fx('h'), 'Sem operacao de teste', 'TAZL5', 'etf', 'BRL');
select public.investment_operation_record(pg_temp.fx('acao'), pg_temp.dia(30), 'buy', 10, 20.00);
select public.investment_operation_record(pg_temp.fx('fii'), pg_temp.dia(30), 'buy', 100, 9.50);
select public.investment_operation_record_by_value(pg_temp.fx('cofre'), pg_temp.dia(30), 'buy', 1000.00);
select public.investment_operation_record(pg_temp.fx('gringa'), pg_temp.dia(30), 'buy', 2, 50.00);
select public.investment_operation_record_by_value(pg_temp.fx('porvalor'), pg_temp.dia(30), 'buy', 500.00);
select public.investment_operation_record_by_value(pg_temp.fx('porvalor'), pg_temp.dia(20), 'buy', 250.00);

-- ---- P: o preço na posição ----
select is(pg_temp.pos('h', 'acao', pg_temp.hoje()), '10|200.00|200.00|0.00|sem data|sem fonte',
          'P1 com cotação gravada mas SEM a escolha ligada, a ação continua valendo o custo');
select lives_ok($$select pg_temp.liga('acao', true)$$, 'P2 o dono liga a cotação da bolsa na ação');
select is((select market_quote from public.investment_assets where id = pg_temp.fx('acao')), true, 'P2.1 a escolha ficou gravada');
select is(pg_temp.pos('h', 'acao', pg_temp.hoje()), '10|200.00|255.00|55.00|' || pg_temp.dia(5) || '|brapi',
          'P3 ligada: 10 cotas × 25,50 = 255,00, com a data e a fonte da cotação');
select is(pg_temp.pos('h', 'acao', pg_temp.dia(10)), '10|200.00|200.00|0.00|sem data|sem fonte',
          'P4 numa data antes de toda cotação a posição vale o custo');
select is(pg_temp.valor('h', 'acao', pg_temp.dia(9)), 123.46, 'P5 na data da cotação antiga: 10 × 12,3456789 = 123,46 (arredonda o total, não o preço)');
select is(pg_temp.valor('h', 'acao', pg_temp.dia(6)), 123.46, 'P5.1 e ela vale até a próxima cotação');

-- a regra do dono: vale a mais recente; no mesmo dia, a digitada
select public.investment_valuation_record(pg_temp.fx('acao'), pg_temp.dia(3), 22.00, 'Digitado de teste');
select is(pg_temp.pos('h', 'acao', pg_temp.hoje()), '10|200.00|220.00|20.00|' || pg_temp.dia(3) || '|Digitado de teste',
          'P6 avaliação digitada DEPOIS da última cotação: vale a digitada (10 × 22,00)');
select is(pg_temp.valor('h', 'acao', pg_temp.dia(4)), 255.00, 'P6.1 e antes dela continua valendo a cotação');
reset role;
select private.market_quote_record('TAZL3', pg_temp.resp('TAZL3', 26.00, pg_temp.dia(2)));
select pg_temp.login('00000000-0000-0000-0000-0000000103a1');
select is(pg_temp.pos('h', 'acao', pg_temp.hoje()), '10|200.00|260.00|60.00|' || pg_temp.dia(2) || '|brapi',
          'P7 cotação DEPOIS da avaliação digitada: vale a cotação (10 × 26,00)');
select public.investment_valuation_record(pg_temp.fx('acao'), pg_temp.dia(2), 24.00, 'Corrigido de teste');
select is(pg_temp.pos('h', 'acao', pg_temp.hoje()), '10|200.00|240.00|40.00|' || pg_temp.dia(2) || '|Corrigido de teste',
          'P8 avaliação digitada no MESMO dia da cotação: vale a digitada (10 × 24,00)');
reset role;
select private.market_quote_record('TAZL3', pg_temp.resp('TAZL3', 27.00, pg_temp.dia(1)));
select private.market_quote_record('TAZL11', pg_temp.resp('TAZL11', 10.10, pg_temp.dia(1)));
select pg_temp.login('00000000-0000-0000-0000-0000000103a1');
select is(pg_temp.pos('h', 'acao', pg_temp.hoje()), '10|200.00|270.00|70.00|' || pg_temp.dia(1) || '|brapi',
          'P9 no dia seguinte a cotação nova volta a valer (10 × 27,00)');
select is(pg_temp.valor('h', 'acao', pg_temp.dia(2)), 240.00, 'P9.1 e o passado não muda: no dia da correção continua 240,00');

-- quem não ligou não muda, mesmo com cotação para o código
select is(pg_temp.pos('h', 'fii', pg_temp.hoje()), '100|950.00|950.00|0.00|sem data|sem fonte',
          'P10 o FII tem cotação gravada (TAZL11) mas ninguém ligou: continua no custo');
select is(pg_temp.pos('h', 'cofre', pg_temp.hoje()), '1|1000.00|1000.00|0.00|sem data|sem fonte',
          'P11 ativo sem código, lançado pelo valor: igual a antes');
select lives_ok($$select pg_temp.liga('fii', true)$$, 'P12 liga o FII (código digitado em minúsculas)');
select is(pg_temp.pos('h', 'fii', pg_temp.hoje()), '100|950.00|1010.00|60.00|' || pg_temp.dia(1) || '|brapi', 'P12.1 100 cotas × 10,10 = 1.010,00');

-- todas as leituras mostram o mesmo valor
select is((select t.market_value from public.investment_totals(pg_temp.fx('h'), pg_temp.hoje()) t where t.currency_code = 'BRL'),
          (select sum(p.market_value) from public.investment_portfolio(pg_temp.fx('h'), pg_temp.hoje()) p where p.currency_code = 'BRL'),
          'P13 investment_totals = soma das posições');
select is((select t.market_value from public.investment_totals(pg_temp.fx('h'), pg_temp.hoje()) t where t.currency_code = 'BRL'),
          270.00 + 1010.00 + 1000.00 + 750.00, 'P13.1 e o total em reais é o esperado (ação e FII pela bolsa, os outros pelo custo)');
select is((select c.market_value from public.investment_contributions(pg_temp.fx('h'), pg_temp.hoje()) c
            where c.level = 'asset' and c.asset_id = pg_temp.fx('acao')), 270.00, 'P14 investment_contributions mostra o mesmo valor da ação');
select is((select c.total_result from public.investment_contributions(pg_temp.fx('h'), pg_temp.hoje()) c
            where c.level = 'asset' and c.asset_id = pg_temp.fx('acao')), 70.00, 'P14.1 e o rendimento é a alta da cotação');
select is((select h.market_value from public.investment_history(pg_temp.fx('h'), pg_temp.hoje(), pg_temp.hoje()) h where h.currency_code = 'BRL'),
          (select t.market_value from public.investment_totals(pg_temp.fx('h'), pg_temp.hoje()) t where t.currency_code = 'BRL'),
          'P15 investment_history do mês de hoje = total de hoje');
select is((select h.market_value from public.investment_history(pg_temp.fx('h'), pg_temp.dia(10), pg_temp.dia(10)) h where h.currency_code = 'BRL'),
          (select sum(p.market_value) from public.investment_portfolio(pg_temp.fx('h'), pg_temp.dia(10)) p where p.currency_code = 'BRL'),
          'P15.1 e numa data sem cotação o histórico também bate com a posição');

-- o código deixa de ser da B3: a cotação para de valer, sem apagar nada
select public.investment_asset_update(pg_temp.fx('fii'), 'Fundo imobiliario de teste', 'XX', 'reit');
select is(pg_temp.pos('h', 'fii', pg_temp.hoje()), '100|950.00|950.00|0.00|sem data|sem fonte', 'P16 código trocado por um que não é da B3: volta ao custo');
select public.investment_asset_update(pg_temp.fx('fii'), 'Fundo imobiliario de teste', 'TAZL11', 'reit');
select is(pg_temp.valor('h', 'fii', pg_temp.hoje()), 1010.00, 'P16.1 código de volta: a cotação volta a valer');
-- B2: ligado, o código sai da bolsa e volta: "só o valor" continua recusado (a fração seria multiplicada pela cotação)
select lives_ok($$select public.investment_asset_update(pg_temp.fx('fii'), 'Fundo imobiliario de teste', 'XX', 'reit')$$, 'B2a código trocado para um que não é da bolsa, com a escolha ligada');
select is(pg_temp.erro_de($$select public.investment_operation_record_by_value(pg_temp.fx('fii'), pg_temp.hoje(), 'buy', 1000.00)$$), '22023',
          'B2b com a escolha ligada, "só o valor" é recusado mesmo com o código fora da bolsa');
select public.investment_asset_update(pg_temp.fx('fii'), 'Fundo imobiliario de teste', 'TAZL11', 'reit');
select is(pg_temp.erro_de($$select public.investment_operation_record_by_value(pg_temp.fx('fii'), pg_temp.hoje(), 'buy', 1000.00)$$), '22023',
          'B2c depois que o código volta, continua recusado');
select is((select count(*) from public.investment_operations where asset_id = pg_temp.fx('fii') and voided_at is null and quantity <> trunc(quantity)),
          0::bigint, 'B2d nenhuma fração foi gravada no FII (o valor não pode mudar de número)');
select lives_ok($$select pg_temp.liga('fii', false)$$, 'P17 desliga o FII');
select is(pg_temp.pos('h', 'fii', pg_temp.hoje()), '100|950.00|950.00|0.00|sem data|sem fonte', 'P17.1 desligado: volta ao custo');
-- cotação em outra moeda para o mesmo código não entra (a tabela aceita; a gravação da brapi é que só grava reais)
reset role;
insert into public.market_quotes (symbol, quote_date, price, currency_code, market_time, source)
values ('TAZL5', pg_temp.dia(1), 99.00, 'USD', now() - interval '1 day', 'teste');
select pg_temp.login('00000000-0000-0000-0000-0000000103a1');
select public.investment_operation_record(pg_temp.fx('semop'), pg_temp.dia(8), 'buy', 3, 10.00);
select pg_temp.liga('semop', true);
select is(pg_temp.pos('h', 'semop', pg_temp.hoje()), '3|30.00|30.00|0.00|sem data|sem fonte', 'P18 cotação em dólar não vira preço de ativo em reais');

-- ---- L: ligar e desligar ----
select is(pg_temp.erro_de($$select pg_temp.liga('cofre', true)$$), '22023', 'L1 ativo sem código não liga');
select is(pg_temp.erro_de($$select pg_temp.liga('gringa', true)$$), '22023', 'L2 ativo em dólar não liga');
select is(pg_temp.erro_de($$select pg_temp.liga('curto', true)$$), '22023', 'L3 código que não é da B3 não liga');
select is(pg_temp.erro_de($$select pg_temp.liga('porvalor', true)$$), '22023', 'L4 ativo com fração de cota (lançado só pelo valor) não liga');
select ok(pg_temp.msg_de($$select pg_temp.liga('porvalor', true)$$) like '%só pelo valor%', 'L4.1 e a mensagem diz o motivo');
select is((select market_quote from public.investment_assets where id = pg_temp.fx('porvalor')), false, 'L4.2 a recusa não deixou a escolha ligada');
select is(pg_temp.erro_de($$select public.investment_asset_set_market_quote(pg_temp.fx('acao'), null)$$), '22023', 'L5 escolha nula: 22023');
select is(pg_temp.erro_de($$select public.investment_asset_set_market_quote('00000000-0000-0000-0000-00000000dead', true)$$), '42501', 'L6 ativo inexistente: 42501');
select lives_ok($$select pg_temp.liga('cofre', false)$$, 'L7 desligar o que já está desligado não é erro');
select lives_ok($$select pg_temp.liga('acao', true)$$, 'L8 ligar de novo o que já está ligado não é erro');

-- ---- O: lançamento só pelo valor em ativo que segue a bolsa ----
select is(pg_temp.erro_de($$select public.investment_operation_record_by_value(pg_temp.fx('acao'), pg_temp.hoje(), 'buy', 100.00)$$), '22023',
          'O1 aporte só pelo valor em ativo que segue a bolsa: recusado');
select ok(pg_temp.msg_de($$select public.investment_operation_record_by_value(pg_temp.fx('acao'), pg_temp.hoje(), 'buy', 100.00)$$) like '%quantidade de cotas%',
          'O1.1 a mensagem manda lançar a quantidade e o preço');
select is(pg_temp.erro_de($$select public.investment_operation_record_by_value(pg_temp.fx('acao'), pg_temp.hoje(), 'sell', 50.00)$$), '22023',
          'O2 resgate só pelo valor também');
select is((select count(*) from public.investment_operations where asset_id = pg_temp.fx('acao')), 1::bigint, 'O2.1 nenhuma operação foi gravada');
select lives_ok($$select public.investment_operation_record(pg_temp.fx('acao'), pg_temp.hoje(), 'buy', 5, 27.00)$$, 'O3 com quantidade e preço o lançamento entra');
select is(pg_temp.pos('h', 'acao', pg_temp.hoje()), '15|335.00|405.00|70.00|' || pg_temp.dia(1) || '|brapi', 'O3.1 15 cotas × 27,00 = 405,00');
select lives_ok($$select public.investment_valuation_record_total(pg_temp.fx('acao'), pg_temp.hoje(), 420.00, 'Total digitado de teste')$$,
          'O4 "hoje vale" pelo total continua aceito em ativo que segue a bolsa');
select is(pg_temp.pos('h', 'acao', pg_temp.hoje()), '15|335.00|420.00|85.00|' || pg_temp.hoje() || '|Total digitado de teste', 'O4.1 e vale o digitado (mais recente)');
select lives_ok($$select public.investment_operation_record_by_value(pg_temp.fx('cofre'), pg_temp.hoje(), 'buy', 200.00)$$,
          'O5 ativo que não segue a bolsa continua aceitando só pelo valor');
select is(pg_temp.valor('h', 'cofre', pg_temp.hoje()), 1200.00, 'O5.1 e o valor sobe exatamente o que foi posto');
select lives_ok($$select public.investment_operation_record_by_value(pg_temp.fx('fii'), pg_temp.hoje(), 'buy', 95.00)$$,
          'O6 o FII desligado volta a aceitar só pelo valor (comportamento de antes)');

-- ---- B2: a busca com ativo ligado e sem chave estoura antes da rede ----
reset role;
select is(pg_temp.erro_de($$select private.market_quotes_fetch()$$), '58000',
          'B2 com ativo ligado e sem a chave no cofre (ou sem cofre), a busca ESTOURA com 58000: o cron mostra "failed"');
select ok(pg_temp.msg_de($$select private.market_quotes_fetch()$$) ~ '(cofre|chave)', 'B2.1 e a mensagem fala do cofre ou da chave, sem nenhum segredo');
select is((select count(*) from public.market_quotes where fetched_at > now() + interval '1 second'), 0::bigint, 'B2.2 nada foi gravado pela busca que falhou');

-- ---- I: isolamento e permissões ----
select pg_temp.login('00000000-0000-0000-0000-0000000103a2');
insert into fixture select 'h2', public.create_household('Casa Vizinha da Bolsa');
insert into fixture select 'acao2', public.investment_asset_create(pg_temp.fx('h2'), 'Acao da outra casa', 'TAZL3', 'equity', 'BRL');
select public.investment_operation_record(pg_temp.fx('acao2'), pg_temp.dia(30), 'buy', 4, 20.00);
select is(pg_temp.pos('h2', 'acao2', pg_temp.hoje()), '4|80.00|80.00|0.00|sem data|sem fonte',
          'I1 outra família, mesmo código, sem ligar: a escolha de uma casa não muda o valor da outra');
select is(pg_temp.erro_de($$select pg_temp.liga('acao', true)$$), '42501', 'I2 outra família não liga nem desliga o ativo alheio');
select is(pg_temp.erro_de($$select pg_temp.liga('acao', false)$$), '42501', 'I2.1 nem desliga');
select is((select count(*) from public.investment_portfolio(pg_temp.fx('h'), pg_temp.hoje())), 0::bigint, 'I3 e não lê a posição da outra casa');
select lives_ok($$select pg_temp.liga('acao2', true)$$, 'I4 liga o próprio ativo');
select is(pg_temp.pos('h2', 'acao2', pg_temp.hoje()), '4|80.00|108.00|28.00|' || pg_temp.dia(1) || '|brapi',
          'I4.1 a cotação é a mesma para todas as famílias (4 × 27,00), sem a avaliação digitada da outra casa');
select is((select count(*) from public.market_quotes where symbol = 'TAZL3'), 4::bigint, 'I5 quem está logado lê a cotação (dado de mercado)');
select is(pg_temp.erro_de($$insert into public.market_quotes (symbol, quote_date, price, currency_code, market_time, source)
                            values ('TAZL3', current_date, 1, 'BRL', now(), 'x')$$), '42501', 'I6 mas não grava');
select is(pg_temp.erro_de($$update public.market_quotes set price = 1$$), '42501', 'I6.1 nem altera');
select is(pg_temp.erro_de($$delete from public.market_quotes$$), '42501', 'I6.2 nem apaga');
select is(pg_temp.erro_de($$update public.investment_assets set market_quote = true$$), '42501', 'I7 a escolha só muda pela função (sem UPDATE direto)');
select is(pg_temp.erro_de($$select private.market_quotes_fetch()$$), '42501', 'I8 quem está logado não chama a busca');
select is(pg_temp.erro_de($$select private.market_quote_record('TAZL3', '{"results": []}'::jsonb)$$), '42501', 'I9 nem a gravação');
reset role;
select set_config('role', 'anon', true);
select is(pg_temp.erro_de($$select count(*) from public.market_quotes$$), '42501', 'I10 anon não lê cotação');
select is(pg_temp.erro_de($$select public.investment_asset_set_market_quote('00000000-0000-0000-0000-00000000dead', true)$$), '42501', 'I11 anon não liga nada');
reset role;

-- arquivar o ativo não deixa cotação pendurada na posição (ativo arquivado não aparece)
select pg_temp.login('00000000-0000-0000-0000-0000000103a2');
select public.investment_operation_record(pg_temp.fx('acao2'), pg_temp.hoje(), 'sell', 4, 27.00);
select public.investment_asset_archive(pg_temp.fx('acao2'));
select is((select count(*) from public.investment_portfolio(pg_temp.fx('h2'), pg_temp.hoje())), 0::bigint, 'I12 ativo zerado e arquivado sai da posição');
reset role;


-- ---- S: a busca na brapi, com rede e cofre simulados ----
-- Só onde não há o Vault nem a extensão http de verdade (o Postgres local). No CI, com o Supabase completo, a simulação não
-- é montada: os testes destes blocos passam sem conferir nada e ficam marcados "[não simulado]".
do $do$ begin
  if to_regclass('vault.decrypted_secrets') is null then
    execute 'create schema vault';
    execute 'create table vault.decrypted_secrets (id uuid default gen_random_uuid(), name text, decrypted_secret text)';
    execute $q$insert into vault.decrypted_secrets (name, decrypted_secret) values ('brapi_token', 'TOKEN-TESTE-SECRETO')$q$;
  end if;
end $do$;
do $do$ begin
  if to_regtype('fx_http.http_request') is null then
    execute 'create schema fx_http';
    execute 'create type fx_http.http_header as (field text, value text)';
    execute 'create type fx_http.http_request as (method text, uri text, headers fx_http.http_header[], content_type text, content text)';
    execute 'create type fx_http.http_response as (status integer, content_type text, headers fx_http.http_header[], content text)';
    execute 'create table fx_http.fake_marcador (x integer)';
    execute 'create table fx_http.fake_respostas (uri text primary key, status integer, content text)';
    execute 'create table fx_http.fake_chamadas (uri text, cabecalho text)';
    execute $q$create function fx_http.http_header(name text, value text) returns fx_http.http_header language sql as $f$ select row(name, value)::fx_http.http_header $f$$q$;
    execute $q$create function fx_http.http_set_curlopt(name text, value text) returns boolean language sql as $f$ select true $f$$q$;
    execute $q$create function fx_http.http(request fx_http.http_request) returns fx_http.http_response language plpgsql as $f$
      declare r fx_http.http_response; v record;
      begin
        insert into fx_http.fake_chamadas values (request.uri, (select h.value from unnest(request.headers) h where h.field = 'Authorization'));
        select f.status, f.content into v from fx_http.fake_respostas f where f.uri = request.uri;
        if not found then raise exception 'sem resposta simulada para %', request.uri; end if;
        if v.status = -1 then raise exception 'tempo esgotado (simulado)'; end if;
        r.status := v.status; r.content := v.content; return r;
      end $f$$q$;
  end if;
end $do$;
create function pg_temp.sim() returns boolean language plpgsql as $f$
begin return to_regclass('fx_http.fake_marcador') is not null; end $f$;
create function pg_temp.responde(p_codigo text, p_status integer, p_conteudo text) returns void language plpgsql as $f$
begin
  if not pg_temp.sim() then return; end if;
  execute format('insert into fx_http.fake_respostas values (%L, %s, %L) on conflict (uri) do update set status = excluded.status, content = excluded.content',
    'https://brapi.dev/api/v2/stocks/quote?symbols=' || p_codigo, p_status, p_conteudo);
end $f$;
create function pg_temp.busca(p_limit integer default 200) returns text language plpgsql as $f$
begin
  if not pg_temp.sim() then return 'não simulado'; end if;
  begin return private.market_quotes_fetch(p_limit);
  exception when others then return 'ERRO ' || sqlstate || ' ' || sqlerrm; end;
end $f$;
-- o erro da busca como "sqlstate|mensagem" (ou null se não deu erro)
create function pg_temp.busca_erro() returns text language plpgsql as $f$
begin
  if not pg_temp.sim() then return '58000|não simulado'; end if;
  begin perform private.market_quotes_fetch(); return null;
  exception when others then return sqlstate || '|' || sqlerrm; end;
end $f$;
create function pg_temp.chave_foi_no_cabecalho() returns boolean language plpgsql as $f$
begin
  if not pg_temp.sim() then return true; end if;
  return exists (select 1 from fx_http.fake_chamadas where cabecalho = 'Bearer TOKEN-TESTE-SECRETO');
end $f$;
create function pg_temp.chave_vazou() returns boolean language plpgsql as $f$
declare v text;
begin
  if not pg_temp.sim() then return false; end if;
  v := pg_temp.busca_erro();
  return v like '%TOKEN-TESTE%';
end $f$;
grant execute on all functions in schema pg_temp to public;

-- só os dois códigos que interessam seguem a bolsa agora: TAZL3 (ação) e TAZL5 (ETF)
update public.investment_assets set market_quote = (ticker in ('TAZL3', 'TAZL5')) where ticker is not null;
select pg_temp.responde('TAZL3', 200, pg_temp.resp('TAZL3', 40.00, pg_temp.hoje(), '15:00')::text);
select pg_temp.responde('TAZL5', 500, '{}');

select ok(not pg_temp.sim() or pg_temp.busca() = '1 com cotação; 0 sem cotação; 1 com erro; 0 ficaram de fora desta rodada (teto de 200)',
          'S1 uma resposta boa e um erro 500: o bom é gravado, o erro conta como erro (I2)' || case when pg_temp.sim() then '' else ' [não simulado]' end);
select ok(not pg_temp.sim() or pg_temp.cot('TAZL3', pg_temp.hoje()) = '40.0000000000|BRL|brapi', 'S1.1 a cotação boa ficou gravada');
select ok(pg_temp.chave_foi_no_cabecalho(), 'S1.2 a chave vai no cabeçalho Authorization da chamada (I3)' || case when pg_temp.sim() then '' else ' [não simulado]' end);

-- S2: resposta de formato errado de UM código não derruba os outros (I2)
select pg_temp.responde('TAZL5', 200, '{"results": "x"}');
select pg_temp.responde('TAZL3', 200, pg_temp.resp('TAZL3', 41.00, pg_temp.hoje(), '16:00')::text);
select ok(not pg_temp.sim() or pg_temp.busca() = '1 com cotação; 0 sem cotação; 1 com erro; 0 ficaram de fora desta rodada (teto de 200)',
          'S2 formato errado de um código: o outro é gravado e o erro conta' || case when pg_temp.sim() then '' else ' [não simulado]' end);
select ok(not pg_temp.sim() or pg_temp.cot('TAZL3', pg_temp.hoje()) = '41.0000000000|BRL|brapi', 'S2.1 o código bom foi gravado mesmo com o outro com formato errado');

-- S3: tempo esgotado ou rede caindo num código também não derruba os outros (I2)
select pg_temp.responde('TAZL5', -1, '');
select pg_temp.responde('TAZL3', 200, pg_temp.resp('TAZL3', 42.00, pg_temp.hoje(), '17:00')::text);
select ok(not pg_temp.sim() or pg_temp.busca() = '1 com cotação; 0 sem cotação; 1 com erro; 0 ficaram de fora desta rodada (teto de 200)',
          'S3 rede caiu num código: o outro segue e o erro conta' || case when pg_temp.sim() then '' else ' [não simulado]' end);
select ok(not pg_temp.sim() or pg_temp.cot('TAZL3', pg_temp.hoje()) = '42.0000000000|BRL|brapi', 'S3.1 o código que respondeu foi gravado');

-- S4: 401 (chave recusada) para a rodada inteira, e nada da rodada fica gravado (I2)
select pg_temp.responde('TAZL5', 401, '{"error": true, "message": "chave recusada"}');
select pg_temp.responde('TAZL3', 200, pg_temp.resp('TAZL3', 43.00, pg_temp.hoje(), '18:00')::text);
select ok(not pg_temp.sim() or pg_temp.busca_erro() like '58000|%brapi respondeu 401%', 'S4 401 para a rodada e o erro diz o status e só ele' || case when pg_temp.sim() then '' else ' [não simulado]' end);
select ok(not pg_temp.chave_vazou(), 'S4.1 a mensagem de erro não mostra a chave');
select ok(not pg_temp.sim() or pg_temp.cot('TAZL3', pg_temp.hoje()) = '42.0000000000|BRL|brapi', 'S4.2 a rodada que parou não gravou o código que tinha respondido');

-- S5: 429 (cota esgotada) tem o mesmo tratamento
select pg_temp.responde('TAZL5', 429, '{}');
select ok(not pg_temp.sim() or pg_temp.busca_erro() like '58000|%brapi respondeu 429%', 'S5 429 para a rodada' || case when pg_temp.sim() then '' else ' [não simulado]' end);

-- S6: nenhum código deu certo: é falha de verdade (o cron mostra "failed")
select pg_temp.responde('TAZL3', 500, '{}');
select pg_temp.responde('TAZL5', 500, '{}');
select ok(not pg_temp.sim() or pg_temp.busca_erro() like '58000|%nenhum dos 2 códigos%', 'S6 nada deu certo: a rodada levanta erro' || case when pg_temp.sim() then '' else ' [não simulado]' end);

-- S7: teto de códigos por rodada: o que sobra aparece no retorno, não some (I1)
select pg_temp.responde('TAZL3', 200, pg_temp.resp('TAZL3', 44.00, pg_temp.hoje(), '19:00')::text);
select pg_temp.responde('TAZL5', 200, pg_temp.resp('TAZL5', 12.00, pg_temp.hoje(), '19:00')::text);
select ok(not pg_temp.sim() or pg_temp.busca(1) = '1 com cotação; 0 sem cotação; 0 com erro; 1 ficaram de fora desta rodada (teto de 1)',
          'S7 com teto de 1, o outro código aparece como "ficaram de fora"' || case when pg_temp.sim() then '' else ' [não simulado]' end);
select ok(not pg_temp.sim() or pg_temp.busca() = '2 com cotação; 0 sem cotação; 0 com erro; 0 ficaram de fora desta rodada (teto de 200)',
          'S7.1 sem o teto, os dois são buscados (nada fica de fora)' || case when pg_temp.sim() then '' else ' [não simulado]' end);

-- S8: a leitura de cotação é só dos códigos que a própria família segue (I4)
select pg_temp.login('00000000-0000-0000-0000-0000000103a2');
select is((select count(*) from public.market_quotes where symbol = 'TAZL5'), 0::bigint, 'S8 outra família não lê a cotação de um código que não segue');
select ok((select count(*) from public.market_quotes where symbol = 'TAZL3') >= 1, 'S8.1 mas lê a do código que a própria família segue');
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000103a1');
select ok((select count(*) from public.market_quotes where symbol = 'TAZL5') >= 1, 'S8.2 a família dona do código lê a cotação dele');
reset role;

-- S9: o job da manhã (I6): o fechamento do dia anterior corrige a linha do dia que a rodada da noite não atualizou
create function pg_temp.agendado_manha() returns boolean language plpgsql as $f$
declare v boolean;
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then return true; end if;
  if not exists (select 1 from pg_namespace where nspname = 'cron') then return false; end if;
  execute $q$select exists (select 1 from cron.job where jobname = 'cotacoes-bolsa-manha' and schedule = '0 12 * * 2-6')$q$ into v;
  return v;
end $f$;
select ok(pg_temp.agendado_manha(), 'S9 onde há pg_cron, a rodada da manhã roda terça a sábado às 09:00 de Brasília (0 12 UTC)'
          || case when exists (select 1 from pg_available_extensions where name = 'pg_cron') then '' else ' [sem pg_cron neste banco: não conferido]' end);

select * from finish();
rollback;
