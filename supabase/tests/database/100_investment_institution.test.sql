-- 100_investment_institution: migration 106 (20261110150000_investment_institution.sql). Pedido do dono de 10/11/2026:
-- ver a carteira por instituição e o total de proventos do mês sem o front somar dinheiro.
--   investment_assets.institution; investment_asset_set_institution; investment_institution_totals; investment_income_totals.
-- O que este arquivo prova: os totais batem no centavo com investment_totals e investment_income_by_asset, definir a
-- instituição não muda nenhum outro número, e ninguém vê nem altera dado de outra família.
-- Dados inventados; datas relativas a hoje em São Paulo (as RPCs de operação, avaliação e provento pago recusam data
-- futura): pg_temp.dia(n) = n dias atrás. Nada depende de data fixa.
-- Sem a migration este arquivo falha (não existem a coluna nem as três funções).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create temp table fixture (k text primary key, v uuid);
grant all on fixture to public;
create temp table foto (k text primary key, v text);
grant all on foto to public;
create function pg_temp.fx(p_k text) returns uuid language sql as $f$ select v from fixture where k = p_k $f$;
create function pg_temp.login(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $f$;
create function pg_temp.hoje() returns date language sql as $f$ select (now() at time zone 'America/Sao_Paulo')::date $f$;
-- n dias atrás (negativo = no futuro)
create function pg_temp.dia(p_n integer) returns date language sql as $f$ select pg_temp.hoje() - p_n $f$;
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
-- "SQLSTATE|mensagem", para separar a recusa de dentro da função da falta de permissão de executar
create function pg_temp.erro_de(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate || '|' || sqlerrm; end $f$;
-- a instituição gravada de um ativo, lida como o cliente lê (entre colchetes para aparecer espaço sobrando)
create function pg_temp.gravada(p_k text) returns text language plpgsql as $f$
declare v text;
begin
  execute 'select coalesce(''['' || institution || '']'', ''(nulo)'') from public.investment_assets where id = $1' into v using pg_temp.fx(p_k);
  return v;
end $f$;
-- o retorno inteiro de uma função (família, data) como texto, para comparar antes e depois
create function pg_temp.retrato(p_fn text, p_dia date) returns text language plpgsql as $f$
declare v text;
begin
  execute format('select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), ''[]''::jsonb)::text from public.%I($1, $2) x', p_fn)
    into v using pg_temp.fx('h'), p_dia;
  return v;
end $f$;
-- todas as colunas dos ativos da família, menos a instituição
create function pg_temp.ativos_sem_inst() returns text language sql as $f$
  select jsonb_agg(to_jsonb(a) - 'institution' order by a.id)::text from public.investment_assets a where a.household_id = pg_temp.fx('h') $f$;
-- "moeda|valor" de investment_totals, separado por ;
create function pg_temp.tot(p_h uuid, p_dia date) returns text language sql as $f$
  select string_agg(currency_code || '|' || market_value, ';' order by currency_code) from public.investment_totals(p_h, p_dia) $f$;
grant execute on all functions in schema pg_temp to public;

-- ---- F: forma e permissões (as três primeiras linhas dão "not ok" sem a migration; o resto vira erro) ----
select has_column('public', 'investment_assets', 'institution', 'F1 a coluna institution existe');
select has_function('public', 'investment_asset_set_institution', array['uuid', 'text'], 'F2 existe investment_asset_set_institution(uuid, text)');
select has_function('public', 'investment_institution_totals', array['uuid', 'date'], 'F3 existe investment_institution_totals(uuid, date)');
select has_function('public', 'investment_income_totals', array['uuid', 'date', 'date'], 'F4 existe investment_income_totals(uuid, date, date)');
select col_type_is('public', 'investment_assets', 'institution', 'text', 'F5 institution é texto');
select col_is_null('public', 'investment_assets', 'institution', 'F6 aceita nulo (sem instituição)');
select col_hasnt_default('public', 'investment_assets', 'institution', 'F7 e nasce nula (sem valor padrão)');
select is(pg_get_function_result('public.investment_asset_set_institution(uuid, text)'::regprocedure), 'void', 'F8 set_institution não devolve nada');
select is(pg_get_function_result('public.investment_institution_totals(uuid, date)'::regprocedure),
          'TABLE(currency_code text, institution text, market_value numeric)', 'F9 colunas de institution_totals');
select is(pg_get_function_result('public.investment_income_totals(uuid, date, date)'::regprocedure),
          'TABLE(currency_code text, received numeric, planned numeric)', 'F10 colunas de income_totals');
select ok(not has_function_privilege('anon', 'public.investment_asset_set_institution(uuid, text)', 'EXECUTE'), 'P1 anon não define instituição');
select ok(not has_function_privilege('anon', 'public.investment_institution_totals(uuid, date)', 'EXECUTE'), 'P2 anon não lê os totais por instituição');
select ok(not has_function_privilege('anon', 'public.investment_income_totals(uuid, date, date)', 'EXECUTE'), 'P3 anon não lê os proventos');
select ok(has_function_privilege('authenticated', 'public.investment_asset_set_institution(uuid, text)', 'EXECUTE'), 'P4 authenticated define');
select ok(has_function_privilege('authenticated', 'public.investment_institution_totals(uuid, date)', 'EXECUTE'), 'P5 authenticated lê os totais por instituição');
select ok(has_function_privilege('authenticated', 'public.investment_income_totals(uuid, date, date)', 'EXECUTE'), 'P6 authenticated lê os proventos');
select is((select count(*) from pg_proc p
            where p.oid in ('public.investment_asset_set_institution(uuid, text)'::regprocedure,
                            'public.investment_institution_totals(uuid, date)'::regprocedure,
                            'public.investment_income_totals(uuid, date, date)'::regprocedure)
              and exists (select 1 from aclexplode(p.proacl) x where x.grantee = 0 and x.privilege_type = 'EXECUTE')),
          0::bigint, 'P7 nenhuma das três é executável por PUBLIC');
select ok((select prosecdef from pg_proc where oid = 'public.investment_asset_set_institution(uuid, text)'::regprocedure), 'P8 set_institution é SECURITY DEFINER');
select ok(not (select prosecdef from pg_proc where oid = 'public.investment_institution_totals(uuid, date)'::regprocedure), 'P9 institution_totals é SECURITY INVOKER');
select ok(not (select prosecdef from pg_proc where oid = 'public.investment_income_totals(uuid, date, date)'::regprocedure), 'P10 income_totals é SECURITY INVOKER');
select is((select count(*) from pg_proc
            where oid in ('public.investment_asset_set_institution(uuid, text)'::regprocedure,
                          'public.investment_institution_totals(uuid, date)'::regprocedure,
                          'public.investment_income_totals(uuid, date, date)'::regprocedure)
              and proconfig = array['search_path=""']), 3::bigint, 'P11 as três com search_path vazio');
select ok(has_column_privilege('authenticated', 'public.investment_assets', 'institution', 'SELECT'), 'P12 authenticated lê a coluna');
select ok(not has_column_privilege('authenticated', 'public.investment_assets', 'institution', 'UPDATE'), 'P13 mas não tem UPDATE nela');
select ok(not has_column_privilege('authenticated', 'public.investment_assets', 'institution', 'INSERT'), 'P13.1 nem INSERT');
select ok(not has_column_privilege('anon', 'public.investment_assets', 'institution', 'SELECT'), 'P14 anon não lê a coluna');

-- helpers que dependem das funções novas
-- "moeda|instituição|valor" de cada linha, NA ORDEM em que a função devolve
create function pg_temp.inst(p_h uuid, p_dia date) returns text language sql as $f$
  select string_agg(t.currency_code || '|' || coalesce(t.institution, '(nulo)') || '|' || t.market_value, ';' order by t.ord)
    from public.investment_institution_totals(p_h, p_dia) with ordinality as t(currency_code, institution, market_value, ord) $f$;
-- "moeda|soma das instituições", para comparar com pg_temp.tot
create function pg_temp.inst_soma(p_h uuid, p_dia date) returns text language sql as $f$
  select string_agg(s.c || '|' || s.v, ';' order by s.c)
    from (select currency_code as c, sum(market_value) as v from public.investment_institution_totals(p_h, p_dia) group by 1) s $f$;
-- "moeda|recebido|previsto" de cada linha de income_totals, na ordem da função
create function pg_temp.prov(p_h uuid, p_de date, p_ate date) returns text language sql as $f$
  select string_agg(t.currency_code || '|' || t.received::numeric(14,2) || '|' || t.planned::numeric(14,2), ';' order by t.ord)
    from public.investment_income_totals(p_h, p_de, p_ate) with ordinality as t(currency_code, received, planned, ord) $f$;
-- o mesmo, somando investment_income_by_asset por moeda
create function pg_temp.prov_ativos(p_h uuid, p_de date, p_ate date) returns text language sql as $f$
  select string_agg(s.c || '|' || s.r::numeric(14,2) || '|' || s.p::numeric(14,2), ';' order by s.c)
    from (select currency_code as c, sum(received) as r, sum(planned) as p
            from public.investment_income_by_asset(p_h, p_de, p_ate) group by 1) s $f$;
grant execute on all functions in schema pg_temp to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000100a1', 'i1@teste.com'),
  ('00000000-0000-0000-0000-0000000100a2', 'i2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000100a1');
insert into fixture select 'h', public.create_household('Casa Instituição');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date, currency_code)
           values (pg_temp.fx('h'), 'Conta de teste', 'checking', 1000, pg_temp.dia(400), 'BRL') returning id)
  insert into fixture select 'conta', id from i;
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date, currency_code)
           values (pg_temp.fx('h'), 'Conta em dólar de teste', 'checking', 0, pg_temp.dia(400), 'USD') returning id)
  insert into fixture select 'conta_usd', id from i;
insert into fixture select 'rend', id from public.categories where household_id = pg_temp.fx('h') and name = 'Rendimentos' and type = 'income';

insert into fixture select 'acao',  public.investment_asset_create(pg_temp.fx('h'), 'Ação de teste', 'TEST3', 'equity', 'BRL');
insert into fixture select 'fundo', public.investment_asset_create(pg_temp.fx('h'), 'Fundo de teste', null, 'fund', 'BRL');
insert into fixture select 'cofre', public.investment_asset_create(pg_temp.fx('h'), 'Cofrinho de teste', null, 'fixed_income', 'BRL');
insert into fixture select 'tes',   public.investment_asset_create(pg_temp.fx('h'), 'Tesouro de teste', null, 'fixed_income', 'BRL');
insert into fixture select 'etf',   public.investment_asset_create(pg_temp.fx('h'), 'ETF de teste', 'TSTE', 'etf', 'USD');
insert into fixture select 'plano', public.investment_asset_create(pg_temp.fx('h'), 'Plano no exterior de teste', null, 'fund', 'USD');
insert into fixture select 'arq',   public.investment_asset_create(pg_temp.fx('h'), 'Arquivado de teste', null, 'fund', 'BRL');
insert into fixture select 'zer',   public.investment_asset_create(pg_temp.fx('h'), 'Zerado de teste', null, 'equity', 'BRL');
insert into fixture select 'anul',  public.investment_asset_create(pg_temp.fx('h'), 'Anulado de teste', null, 'equity', 'BRL');
insert into fixture select 'semop', public.investment_asset_create(pg_temp.fx('h'), 'Sem operação de teste', null, 'other', 'BRL');

-- Há 240 dias (sem avaliação o valor é o custo, arredondado por ativo):
--   ação 3 × 33,33 + 1,37 de taxa = 101,36 | fundo 0,333333 × 150,07 = 50,0232819… → 50,02 | cofrinho 250,55 | tesouro 600,10
--   ETF 2 × 100,25 = 200,50 (USD) | plano 50,05 (USD) | arquivado 70,00 | zerado 2 × 40 = 80,00 | anulado 90,00 (anulada logo abaixo)
select public.investment_operation_record(pg_temp.fx('acao'),  pg_temp.dia(240), 'buy', 3, 33.33, 1.37);
select public.investment_operation_record(pg_temp.fx('fundo'), pg_temp.dia(240), 'buy', 0.333333, 150.07);
select public.investment_operation_record(pg_temp.fx('cofre'), pg_temp.dia(240), 'buy', 1, 250.55);
select public.investment_operation_record(pg_temp.fx('tes'),   pg_temp.dia(240), 'buy', 1, 600.10);
select public.investment_operation_record(pg_temp.fx('etf'),   pg_temp.dia(240), 'buy', 2, 100.25);
select public.investment_operation_record(pg_temp.fx('plano'), pg_temp.dia(240), 'buy', 1, 50.05);
select public.investment_operation_record(pg_temp.fx('arq'),   pg_temp.dia(240), 'buy', 1, 70.00);
select public.investment_operation_record(pg_temp.fx('zer'),   pg_temp.dia(240), 'buy', 2, 40.00);
insert into fixture select 'anul_op', public.investment_operation_record(pg_temp.fx('anul'), pg_temp.dia(240), 'buy', 1, 90.00);
select public.investment_operation_void(pg_temp.fx('anul_op'), 'lançada por engano (teste)');
-- Há 150 dias: mais 300,00 no cofrinho (550,55); o zerado e o arquivado vendem tudo; a ação ganha uma compra que é anulada
select public.investment_operation_record(pg_temp.fx('cofre'), pg_temp.dia(150), 'buy', 1, 300.00);
select public.investment_operation_record(pg_temp.fx('zer'),   pg_temp.dia(150), 'sell', 2, 45.00);
select public.investment_operation_record(pg_temp.fx('arq'),   pg_temp.dia(150), 'sell', 1, 70.00);
insert into fixture select 'acao_op2', public.investment_operation_record(pg_temp.fx('acao'), pg_temp.dia(150), 'buy', 1, 999.99);
select public.investment_operation_void(pg_temp.fx('acao_op2'), 'compra em dobro (teste)');
-- provento do ativo que vai ser arquivado (a RPC recusa provento em ativo já arquivado)
insert into fixture select 'p_arq', public.investment_distribution_record(pg_temp.fx('arq'), 'dividend', pg_temp.dia(66), 1.99, pg_temp.fx('conta'));
select public.investment_asset_archive(pg_temp.fx('arq'));
-- outras marcas do ativo, para o "antes e depois" ter o que comparar
select public.investment_asset_set_liquidity(pg_temp.fx('cofre'), 'restricted');
select public.investment_asset_set_subclass(pg_temp.fx('acao'), 'Ações de teste');

-- ---- A: antes de qualquer instituição ----
select is((select count(*) from public.investment_assets where household_id = pg_temp.fx('h') and institution is not null), 0::bigint,
          'A1 todo ativo nasce sem instituição (ninguém é classificado por suposição)');
select is(pg_temp.inst(pg_temp.fx('h'), pg_temp.hoje()), 'BRL|(nulo)|1302.03;USD|(nulo)|250.55',
          'A2 sem instituição: uma linha por moeda, com a carteira inteira');
select is((select count(*) from public.investment_institution_totals(pg_temp.fx('h'), pg_temp.hoje()) where institution is null), 2::bigint,
          'A2.1 e nas duas a instituição vem NULA (não vem texto vazio)');
select is(pg_temp.inst_soma(pg_temp.fx('h'), pg_temp.hoje()), pg_temp.tot(pg_temp.fx('h'), pg_temp.hoje()), 'A3 = investment_totals por moeda');

insert into foto select 'ativos', pg_temp.ativos_sem_inst();
insert into foto select 'portfolio', pg_temp.retrato('investment_portfolio', pg_temp.hoje());
insert into foto select 'portfolio_190', pg_temp.retrato('investment_portfolio', pg_temp.dia(190));
insert into foto select 'totals', pg_temp.retrato('investment_totals', pg_temp.hoje());
insert into foto select 'totals_190', pg_temp.retrato('investment_totals', pg_temp.dia(190));
insert into foto select 'liquidity', pg_temp.retrato('investment_liquidity_totals', pg_temp.hoje());
insert into foto select 'allocation', pg_temp.retrato('investment_allocation', pg_temp.hoje());
insert into foto select 'net_worth', pg_temp.retrato('net_worth_with_assets', pg_temp.hoje());
insert into foto select 'home', pg_temp.retrato('home_indicators', pg_temp.hoje());
select is((select count(*) from foto where v is null or v = '[]'), 0::bigint, 'A4 o retrato de antes tem dado em todas as funções');

-- ---- B: definir, trocar e limpar ----
select lives_ok($$select public.investment_asset_set_institution(pg_temp.fx('acao'), 'Corretora Teste')$$, 'B1 define a instituição');
select is(pg_temp.gravada('acao'), '[Corretora Teste]', 'B1.1 gravou');
select lives_ok($$select public.investment_asset_set_institution(pg_temp.fx('acao'), 'Corretora Teste')$$, 'B2 definir de novo o mesmo valor não dá erro');
select is(pg_temp.gravada('acao'), '[Corretora Teste]', 'B2.1 e continua igual');
select is((select count(*) from public.investment_assets where household_id = pg_temp.fx('h') and institution is not null), 1::bigint,
          'B2.2 só o ativo pedido mudou');
select lives_ok($$select public.investment_asset_set_institution(pg_temp.fx('acao'), 'Banco Digital Teste')$$, 'B3 troca');
select is(pg_temp.gravada('acao'), '[Banco Digital Teste]', 'B3.1 gravou a nova');
select lives_ok($$select public.investment_asset_set_institution(pg_temp.fx('acao'), '')$$, 'B4 texto vazio limpa');
select is(pg_temp.gravada('acao'), '(nulo)', 'B4.1 ficou nula');
select public.investment_asset_set_institution(pg_temp.fx('acao'), 'Corretora Teste');
select lives_ok($$select public.investment_asset_set_institution(pg_temp.fx('acao'), null)$$, 'B5 nulo limpa');
select is(pg_temp.gravada('acao'), '(nulo)', 'B5.1 ficou nula');
select lives_ok($$select public.investment_asset_set_institution(pg_temp.fx('acao'), null)$$, 'B5.2 limpar o que já está limpo não dá erro');
select lives_ok($$select public.investment_asset_set_institution(pg_temp.fx('acao'), '   Corretora Teste  ')$$, 'B6 aceita com espaço nas pontas');
select is(pg_temp.gravada('acao'), '[Corretora Teste]', 'B6.1 e grava aparado');
select lives_ok($$select public.investment_asset_set_institution(pg_temp.fx('acao'), '     ')$$, 'B7 só espaços não dá erro');
select is(pg_temp.gravada('acao'), '(nulo)', 'B7.1 e vira nulo');
select lives_ok($$select public.investment_asset_set_institution(pg_temp.fx('acao'), repeat('a', 40))$$, 'B8 40 caracteres: aceita');
select is(pg_temp.gravada('acao'), '[' || repeat('a', 40) || ']', 'B8.1 gravou os 40');
select lives_ok($$select public.investment_asset_set_institution(pg_temp.fx('acao'), repeat('ã', 40))$$, 'B8.2 40 letras acentuadas: aceita (conta caracteres, não bytes)');
select lives_ok($$select public.investment_asset_set_institution(pg_temp.fx('acao'), '  ' || repeat('b', 40) || '  ')$$,
                'B8.3 40 caracteres com espaço nas pontas: aceita (mede depois de aparar)');
select is(pg_temp.gravada('acao'), '[' || repeat('b', 40) || ']', 'B8.4 e grava os 40 aparados');
select is(pg_temp.sqlstate_of($$select public.investment_asset_set_institution(pg_temp.fx('acao'), repeat('c', 41))$$), '22023', 'B9 41 caracteres: 22023');
select is(pg_temp.sqlstate_of($$select public.investment_asset_set_institution(pg_temp.fx('acao'), repeat('ã', 41))$$), '22023', 'B9.1 41 acentuados: 22023');
select is(pg_temp.gravada('acao'), '[' || repeat('b', 40) || ']', 'B9.2 a recusa não altera o ativo');
select is(pg_temp.sqlstate_of($$select public.investment_asset_set_institution('00000000-0000-0000-0000-000000000000', 'Corretora Teste')$$), '42501',
          'B10 ativo inexistente: 42501');
select is(pg_temp.sqlstate_of($$select public.investment_asset_set_institution(null, 'Corretora Teste')$$), '42501', 'B10.1 ativo nulo: 42501');
select is(pg_temp.sqlstate_of($$update public.investment_assets set institution = 'Direto' where id = pg_temp.fx('acao')$$), '42501',
          'B11 o cliente não escreve direto na coluna');
select is(pg_temp.sqlstate_of(format($$insert into public.investment_assets (household_id, name, asset_class, currency_code, institution)
                                        values (%L, 'Direto', 'fund', 'BRL', 'Direto')$$, pg_temp.fx('h'))), '42501',
          'B11.1 nem insere ativo com instituição direto');
-- Ativo arquivado: a função NÃO olha `active` (igual a set_subclass e set_liquidity), então aceita e grava.
select is((select active from public.investment_assets where id = pg_temp.fx('arq')), false, 'B12 o ativo de teste está arquivado');
select lives_ok($$select public.investment_asset_set_institution(pg_temp.fx('arq'), 'Corretora Teste')$$, 'B12.1 ativo arquivado: aceita');
select is(pg_temp.gravada('arq'), '[Corretora Teste]', 'B12.2 e grava (dá para corrigir a instituição sem reativar)');
select is((select active from public.investment_assets where id = pg_temp.fx('arq')), false, 'B12.3 sem reativar o ativo');
-- Espaço em branco que não é o espaço comum (texto colado de outro lugar): vira um espaço só, e as pontas somem.
select public.investment_asset_set_institution(pg_temp.fx('semop'), E'\tCorretora\n Teste\r\n');
select is(pg_temp.gravada('semop'), '[Corretora Teste]', 'B13 tabulação e quebra de linha viram um espaço; nas pontas somem');
select public.investment_asset_set_institution(pg_temp.fx('semop'), 'Corretora    Teste');
select is(pg_temp.gravada('semop'), '[Corretora Teste]', 'B13.1 vários espaços seguidos viram um');
select public.investment_asset_set_institution(pg_temp.fx('semop'), U&'\00A0Corretora\00A0Teste\00A0');
select is(pg_temp.gravada('semop'), '[Corretora Teste]', 'B13.2 o espaço que não quebra (U+00A0) também');
select public.investment_asset_set_institution(pg_temp.fx('semop'), E' \t\n' || U&'\00A0');
select is(pg_temp.gravada('semop'), '(nulo)', 'B13.3 só espaço em branco de qualquer tipo vira nulo, não uma instituição invisível');
select public.investment_asset_set_institution(pg_temp.fx('semop'), U&'Corretora\202FTeste\2007\3000');
select is(pg_temp.gravada('semop'), '[Corretora Teste]', 'B13.6 espaço fino (U+202F), de algarismo (U+2007) e ideográfico (U+3000) também, em qualquer idioma do banco');
select public.investment_asset_set_institution(pg_temp.fx('semop'), U&'Corre\200Btora\FEFF Teste\200D');
select is(pg_temp.gravada('semop'), '[Corretora Teste]', 'B13.7 caractere de largura zero no meio do nome some (não vira outra instituição igual na tela)');
select lives_ok($$select public.investment_asset_set_institution(pg_temp.fx('semop'), repeat('ab  ', 13) || 'c')$$,
                'B13.4 o limite de 40 vale depois de juntar os espaços (53 digitados, 40 gravados)');
select is(char_length((select institution from public.investment_assets where id = pg_temp.fx('semop'))), 40, 'B13.5 gravou 40');

-- a carteira de teste: corretora (ação, fundo, ETF em dólar, o arquivado), banco digital (cofrinho), sem instituição (tesouro, plano)
select public.investment_asset_set_institution(pg_temp.fx('acao'),  'Corretora Teste');
select public.investment_asset_set_institution(pg_temp.fx('fundo'), 'Corretora Teste');
select public.investment_asset_set_institution(pg_temp.fx('etf'),   'Corretora Teste');
select public.investment_asset_set_institution(pg_temp.fx('cofre'), 'Banco Digital Teste');
select public.investment_asset_set_institution(pg_temp.fx('zer'),   'Só Zerado Teste');
select public.investment_asset_set_institution(pg_temp.fx('anul'),  'Só Anulado Teste');
select public.investment_asset_set_institution(pg_temp.fx('semop'), 'Só Sem Operação Teste');

-- ---- C: definir a instituição não muda mais nada ----
select is(pg_temp.ativos_sem_inst(), (select v from foto where k = 'ativos'), 'C1 nos ativos só a coluna institution mudou');
select is(pg_temp.retrato('investment_portfolio', pg_temp.hoje()), (select v from foto where k = 'portfolio'), 'C2 investment_portfolio igual a antes');
select is(pg_temp.retrato('investment_portfolio', pg_temp.dia(190)), (select v from foto where k = 'portfolio_190'), 'C2.1 e em data passada (190 dias atrás)');
select is(pg_temp.retrato('investment_totals', pg_temp.hoje()), (select v from foto where k = 'totals'), 'C3 investment_totals igual a antes');
select is(pg_temp.retrato('investment_totals', pg_temp.dia(190)), (select v from foto where k = 'totals_190'), 'C3.1 e em data passada (190 dias atrás)');
select is(pg_temp.retrato('investment_liquidity_totals', pg_temp.hoje()), (select v from foto where k = 'liquidity'), 'C4 investment_liquidity_totals igual a antes');
select is(pg_temp.retrato('investment_allocation', pg_temp.hoje()), (select v from foto where k = 'allocation'), 'C5 investment_allocation igual a antes');
select is(pg_temp.retrato('net_worth_with_assets', pg_temp.hoje()), (select v from foto where k = 'net_worth'), 'C6 net_worth_with_assets igual a antes');
select is(pg_temp.retrato('home_indicators', pg_temp.hoje()), (select v from foto where k = 'home'), 'C7 home_indicators igual a antes');
select is(pg_temp.tot(pg_temp.fx('h'), pg_temp.hoje()), 'BRL|1302.03;USD|250.55', 'C8 e a carteira vale o mesmo: 1.302,03 em reais e 250,55 em dólar');

-- ---- D: totais por instituição ----
-- reais: tesouro 600,10 (sem instituição) | banco digital 550,55 | corretora 101,36 + 50,02 = 151,38. Dólar: corretora 200,50 | sem 50,05
select is(pg_temp.inst(pg_temp.fx('h'), pg_temp.hoje()),
          'BRL|(nulo)|600.10;BRL|Banco Digital Teste|550.55;BRL|Corretora Teste|151.38;USD|Corretora Teste|200.50;USD|(nulo)|50.05',
          'D1 por moeda e instituição, do maior para o menor; real e dólar nunca se somam');
select is((select string_agg(currency_code || '|' || market_value, ';' order by currency_code)
             from public.investment_institution_totals(pg_temp.fx('h'), pg_temp.hoje()) where institution is null),
          'BRL|600.10;USD|50.05', 'D2 a linha sem instituição vem com institution NULO, uma por moeda');
select is(pg_temp.inst_soma(pg_temp.fx('h'), pg_temp.hoje()), pg_temp.tot(pg_temp.fx('h'), pg_temp.hoje()),
          'D3 soma das instituições de cada moeda = investment_totals.market_value, no centavo');
select is(pg_temp.inst_soma(pg_temp.fx('h'), pg_temp.hoje()), 'BRL|1302.03;USD|250.55', 'D3.1 e vale 1.302,03 e 250,55');
select results_eq(
  $$select currency_code, sum(market_value) from public.investment_institution_totals(pg_temp.fx('h'), pg_temp.hoje()) group by 1 order by 1$$,
  $$select currency_code, market_value from public.investment_totals(pg_temp.fx('h'), pg_temp.hoje()) order by 1$$,
  'D3.2 a mesma igualdade, linha a linha (numeric contra numeric)');
select results_eq(
  $$select currency_code, institution, market_value from public.investment_institution_totals(pg_temp.fx('h'), pg_temp.hoje())$$,
  $$select p.currency_code, a.institution, sum(p.market_value)
      from public.investment_portfolio(pg_temp.fx('h'), pg_temp.hoje()) p join public.investment_assets a on a.id = p.asset_id
     group by 1, 2 order by 1, 3 desc, 2 nulls last$$,
  'D3.3 cada linha = soma das posições de investment_portfolio daquela instituição');
select is((select count(*) from public.investment_institution_totals(pg_temp.fx('h'), pg_temp.hoje())
            where institution in ('Só Zerado Teste', 'Só Anulado Teste', 'Só Sem Operação Teste')), 0::bigint,
          'D4 ativo zerado, só com operação anulada ou sem operação: a instituição dele nem aparece (sem linha zerada)');
select is((select market_value from public.investment_institution_totals(pg_temp.fx('h'), pg_temp.hoje())
            where currency_code = 'BRL' and institution = 'Corretora Teste'), 151.38,
          'D5 corretora em reais = 151,38: fora a compra anulada da ação (999,99) e o ativo arquivado');

-- data de corte
select is(pg_temp.inst(pg_temp.fx('h'), pg_temp.dia(190)),
          'BRL|(nulo)|600.10;BRL|Banco Digital Teste|250.55;BRL|Corretora Teste|151.38;BRL|Só Zerado Teste|80.00;USD|Corretora Teste|200.50;USD|(nulo)|50.05',
          'D6 há 190 dias: o cofrinho ainda com 250,55 e o zerado ainda com 80,00; o arquivado (70,00 na época) não entra');
select is(pg_temp.inst_soma(pg_temp.fx('h'), pg_temp.dia(190)), pg_temp.tot(pg_temp.fx('h'), pg_temp.dia(190)), 'D6.1 há 190 dias a soma também = investment_totals');
select is(pg_temp.inst_soma(pg_temp.fx('h'), pg_temp.dia(190)), 'BRL|1082.03;USD|250.55', 'D6.2 e vale 1.082,03 e 250,55');
select is(pg_temp.inst(pg_temp.fx('h'), pg_temp.dia(240)),
          'BRL|(nulo)|600.10;BRL|Banco Digital Teste|250.55;BRL|Corretora Teste|151.38;BRL|Só Zerado Teste|80.00;USD|Corretora Teste|200.50;USD|(nulo)|50.05',
          'D7 no dia da primeira compra já conta (data de corte inclusive)');
select is((select count(*) from public.investment_institution_totals(pg_temp.fx('h'), pg_temp.dia(241))), 0::bigint, 'D7.1 na véspera não há linha');
select is((select count(*) from public.investment_institution_totals(pg_temp.fx('h'), null)), 0::bigint, 'D7.2 data nula: zero linhas, sem erro');
select is((select count(*) from public.investment_institution_totals(null, pg_temp.hoje())), 0::bigint, 'D7.3 família nula: zero linhas, sem erro');

-- avaliação: fundo a 151,115 → 0,333333 × 151,115 = 50,3716… → 50,37 (corretora 151,73); ETF a 110,10 → 220,20
select public.investment_valuation_record(pg_temp.fx('fundo'), pg_temp.dia(130), 151.115, 'avaliação de teste');
select public.investment_valuation_record(pg_temp.fx('etf'),   pg_temp.dia(130), 110.10, 'avaliação de teste');
select is(pg_temp.inst(pg_temp.fx('h'), pg_temp.hoje()),
          'BRL|(nulo)|600.10;BRL|Banco Digital Teste|550.55;BRL|Corretora Teste|151.73;USD|Corretora Teste|220.20;USD|(nulo)|50.05',
          'D8 a avaliação nova muda o total da instituição do ativo, e só ele');
select is(pg_temp.inst_soma(pg_temp.fx('h'), pg_temp.hoje()), pg_temp.tot(pg_temp.fx('h'), pg_temp.hoje()), 'D8.1 com avaliação a soma = investment_totals');
select is(pg_temp.inst_soma(pg_temp.fx('h'), pg_temp.hoje()), 'BRL|1302.38;USD|270.25', 'D8.2 e vale 1.302,38 e 270,25');
select is(pg_temp.inst(pg_temp.fx('h'), pg_temp.dia(131)),
          'BRL|(nulo)|600.10;BRL|Banco Digital Teste|550.55;BRL|Corretora Teste|151.38;USD|Corretora Teste|200.50;USD|(nulo)|50.05',
          'D8.3 na véspera da avaliação vale o custo (a avaliação respeita a data de corte)');
-- o tesouro cai para 550,55, o mesmo valor do banco digital: no empate, a instituição com nome vem antes da linha sem instituição
select public.investment_valuation_record(pg_temp.fx('tes'), pg_temp.dia(129), 550.55, 'avaliação de teste');
select is(pg_temp.inst(pg_temp.fx('h'), pg_temp.hoje()),
          'BRL|Banco Digital Teste|550.55;BRL|(nulo)|550.55;BRL|Corretora Teste|151.73;USD|Corretora Teste|220.20;USD|(nulo)|50.05',
          'D9 empate de valor: a linha sem instituição fica por último entre as empatadas');
select is(pg_temp.inst_soma(pg_temp.fx('h'), pg_temp.hoje()), pg_temp.tot(pg_temp.fx('h'), pg_temp.hoje()), 'D9.1 e a soma segue = investment_totals');

-- trocar um ativo de instituição move o valor inteiro dele; o total da moeda não muda
select public.investment_asset_set_institution(pg_temp.fx('fundo'), 'Banco Digital Teste');
select is(pg_temp.inst(pg_temp.fx('h'), pg_temp.hoje()),
          'BRL|Banco Digital Teste|600.92;BRL|(nulo)|550.55;BRL|Corretora Teste|101.36;USD|Corretora Teste|220.20;USD|(nulo)|50.05',
          'D10 o fundo (50,37) saiu da corretora e entrou no banco digital');
select is(pg_temp.inst_soma(pg_temp.fx('h'), pg_temp.hoje()), 'BRL|1252.83;USD|270.25', 'D10.1 o total por moeda não mudou (1.252,83 depois da avaliação do tesouro)');
select public.investment_asset_set_institution(pg_temp.fx('fundo'), 'Corretora Teste');

-- ---- E: o mesmo nome escrito de outro jeito ----
-- A função junta e apara espaços, mas não mexe em maiúsculas. 'XP' e ' XP' viram a mesma instituição; 'xp ' vira 'xp', que é OUTRA linha (maiúscula ≠ minúscula).
select public.investment_asset_set_institution(pg_temp.fx('acao'),  'XP');
select public.investment_asset_set_institution(pg_temp.fx('fundo'), 'xp ');
select public.investment_asset_set_institution(pg_temp.fx('cofre'), ' XP');
select is(pg_temp.gravada('acao') || pg_temp.gravada('fundo') || pg_temp.gravada('cofre'), '[XP][xp][XP]', 'E1 grava aparado, sem mexer em maiúsculas');
select is((select string_agg(institution || '|' || market_value, ';' order by institution collate "C")
             from public.investment_institution_totals(pg_temp.fx('h'), pg_temp.hoje()) where currency_code = 'BRL' and institution is not null),
          'XP|651.91;xp|50.37', 'E2 espaço nas pontas junta (ação 101,36 + cofrinho 550,55); caixa diferente SEPARA (fundo 50,37)');
select is((select count(*) || '|' || count(distinct lower(institution))
             from public.investment_institution_totals(pg_temp.fx('h'), pg_temp.hoje()) where currency_code = 'BRL' and institution is not null),
          '2|1', 'E2.1 são 2 linhas para o que a pessoa lê como 1 instituição (a tela precisa oferecer as já usadas)');
select is(pg_temp.inst_soma(pg_temp.fx('h'), pg_temp.hoje()), pg_temp.tot(pg_temp.fx('h'), pg_temp.hoje()), 'E3 mesmo assim a soma = investment_totals');
select public.investment_asset_set_institution(pg_temp.fx('acao'),  'Corretora Teste');
select public.investment_asset_set_institution(pg_temp.fx('fundo'), 'Corretora Teste');
select public.investment_asset_set_institution(pg_temp.fx('cofre'), 'Banco Digital Teste');
insert into foto select 'inst_h1', pg_temp.inst(pg_temp.fx('h'), pg_temp.hoje());

-- ---- G: proventos por moeda ----
-- O "mês" do teste vai de 70 a 41 dias atrás (30 dias). Nele, em reais: 120,50 (primeiro dia) + 85,25 (último dia) + 3,33 +
-- 55,55 + 1,99 (do arquivado, lançado lá em cima) = 266,62 recebidos e 30,00 previstos. Fora dele: 10,01 recebidos na
-- véspera (71) e 7,07 previstos no dia seguinte (40).
insert into fixture select 'p1', public.investment_distribution_record(pg_temp.fx('acao'),  'dividend', pg_temp.dia(70), 120.50, pg_temp.fx('conta'));
insert into fixture select 'p2', public.investment_distribution_record(pg_temp.fx('acao'),  'jcp',      pg_temp.dia(41), 85.25,  pg_temp.fx('conta'));
insert into fixture select 'p3', public.investment_distribution_record(pg_temp.fx('cofre'), 'income',   pg_temp.dia(56), 3.33,   pg_temp.fx('conta'));
insert into fixture select 'p4', public.investment_distribution_record(pg_temp.fx('cofre'), 'income',   pg_temp.dia(51), 30.00,  pg_temp.fx('conta'), 'planned');
insert into fixture select 'p5', public.investment_distribution_record(pg_temp.fx('acao'),  'dividend', pg_temp.dia(71), 10.01,  pg_temp.fx('conta'));
insert into fixture select 'p6', public.investment_distribution_record(pg_temp.fx('acao'),  'dividend', pg_temp.dia(40), 7.07,   pg_temp.fx('conta'), 'planned');
insert into fixture select 'p7', public.investment_distribution_record(pg_temp.fx('tes'),   'income',   pg_temp.dia(60), 55.55,  pg_temp.fx('conta'));
-- uma receita comum, que não é provento
insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status)
values (pg_temp.fx('h'), pg_temp.fx('conta'), pg_temp.fx('rend'), 'income', 'Receita comum de teste', 1000.00, pg_temp.dia(58), 'paid');

select is(pg_temp.prov(pg_temp.fx('h'), pg_temp.dia(70), pg_temp.dia(41)), 'BRL|266.62|30.00', 'G1 no mês: recebido 266,62 e previsto 30,00 (bordas inclusive; receita comum fora)');
select is(pg_temp.prov(pg_temp.fx('h'), pg_temp.dia(70), pg_temp.dia(41)), pg_temp.prov_ativos(pg_temp.fx('h'), pg_temp.dia(70), pg_temp.dia(41)),
          'G1.1 = soma de investment_income_by_asset da moeda no mesmo período');
select results_eq(
  $$select currency_code, received, planned from public.investment_income_totals(pg_temp.fx('h'), pg_temp.dia(70), pg_temp.dia(41))$$,
  $$select currency_code, sum(received), sum(planned) from public.investment_income_by_asset(pg_temp.fx('h'), pg_temp.dia(70), pg_temp.dia(41)) group by 1 order by 1$$,
  'G1.2 a mesma igualdade, numeric contra numeric');
select is(pg_temp.prov(pg_temp.fx('h'), pg_temp.dia(69), pg_temp.dia(42)), 'BRL|60.87|30.00', 'G2 um dia a menos em cada ponta: saem os dois das bordas (120,50 e 85,25)');
select is(pg_temp.prov(pg_temp.fx('h'), pg_temp.dia(70), pg_temp.dia(70)), 'BRL|120.50|0.00', 'G2.1 um dia só: o provento do dia; previsto 0 (não nulo)');
select is(pg_temp.prov(pg_temp.fx('h'), pg_temp.dia(71), pg_temp.dia(40)), 'BRL|276.63|37.07', 'G2.2 um dia a mais em cada ponta: entram os dois vizinhos (10,01 e 7,07)');
select is(pg_temp.prov(pg_temp.fx('h'), pg_temp.dia(40), pg_temp.dia(10)), 'BRL|0.00|7.07', 'G2.3 período só com previsto: recebido 0 (não nulo)');
select is((select received is not null and planned is not null from public.investment_income_totals(pg_temp.fx('h'), pg_temp.dia(40), pg_temp.dia(10))), true,
          'G2.4 as duas colunas nunca vêm nulas');
select is(pg_temp.prov(pg_temp.fx('h'), pg_temp.dia(71), pg_temp.dia(40)), pg_temp.prov_ativos(pg_temp.fx('h'), pg_temp.dia(71), pg_temp.dia(40)), 'G2.5 = by_asset no período largo');
select is(pg_temp.prov(pg_temp.fx('h'), pg_temp.dia(40), pg_temp.dia(10)), pg_temp.prov_ativos(pg_temp.fx('h'), pg_temp.dia(40), pg_temp.dia(10)), 'G2.6 = by_asset no período só com previsto');
select is((select count(*) from public.investment_income_totals(pg_temp.fx('h'), pg_temp.dia(400), pg_temp.dia(370))), 0::bigint, 'G3 período sem proventos: zero linhas');
select is((select count(*) from public.investment_income_totals(pg_temp.fx('h'), pg_temp.dia(41), pg_temp.dia(70))), 0::bigint, 'G3.1 período invertido: zero linhas, sem erro');
select is((select count(*) from public.investment_income_totals(pg_temp.fx('h'), null, pg_temp.dia(41))), 0::bigint, 'G3.2 data nula: zero linhas, sem erro');
select is((select count(*) from public.investment_income_totals(null, pg_temp.dia(70), pg_temp.dia(41))), 0::bigint, 'G3.3 família nula: zero linhas, sem erro');

-- lixeira
update public.transactions set deleted_at = now() where id = pg_temp.fx('p7');
select is(pg_temp.prov(pg_temp.fx('h'), pg_temp.dia(70), pg_temp.dia(41)), 'BRL|211.07|30.00', 'G4 provento na lixeira (55,55) sai do recebido');
select is(pg_temp.prov(pg_temp.fx('h'), pg_temp.dia(70), pg_temp.dia(41)), pg_temp.prov_ativos(pg_temp.fx('h'), pg_temp.dia(70), pg_temp.dia(41)), 'G4.1 e continua = by_asset');
update public.transactions set deleted_at = now() where id = pg_temp.fx('p4');
select is(pg_temp.prov(pg_temp.fx('h'), pg_temp.dia(70), pg_temp.dia(41)), 'BRL|211.07|0.00', 'G4.2 previsto na lixeira (30,00) sai do previsto');
update public.transactions set deleted_at = null where id = pg_temp.fx('p4');
select is(pg_temp.prov(pg_temp.fx('h'), pg_temp.dia(70), pg_temp.dia(41)), 'BRL|211.07|30.00', 'G4.3 restaurado da lixeira, volta');

-- previsto que é pago passa de uma coluna para a outra
select public.transactions_bulk_mark_paid(array[pg_temp.fx('p4')]);
select is(pg_temp.prov(pg_temp.fx('h'), pg_temp.dia(70), pg_temp.dia(41)), 'BRL|241.07|0.00', 'G5 previsto marcado como pago: sai do previsto e entra no recebido');
select is(pg_temp.prov(pg_temp.fx('h'), pg_temp.dia(70), pg_temp.dia(41)), pg_temp.prov_ativos(pg_temp.fx('h'), pg_temp.dia(70), pg_temp.dia(41)), 'G5.1 = by_asset');
select is((select received from public.investment_income_totals(pg_temp.fx('h'), pg_temp.dia(66), pg_temp.dia(66))), 1.99,
          'G6 provento de ativo hoje arquivado continua contando (o dinheiro entrou), como em by_asset');

-- Duas moedas. Hoje a RPC recusa provento de ativo em dólar (22023), então o vínculo é criado aqui como superusuário, só para
-- provar que a função separa por moeda do ativo e nunca soma real com dólar.
select is(pg_temp.sqlstate_of($$select public.investment_distribution_record(pg_temp.fx('etf'), 'dividend', pg_temp.dia(58), 12.34, pg_temp.fx('conta_usd'))$$),
          '22023', 'G7 hoje a RPC recusa provento de ativo em dólar');
with i as (insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status)
           values (pg_temp.fx('h'), pg_temp.fx('conta_usd'), pg_temp.fx('rend'), 'income', 'Dividendos · ETF de teste', 12.34, pg_temp.dia(58), 'paid'),
                  (pg_temp.fx('h'), pg_temp.fx('conta_usd'), pg_temp.fx('rend'), 'income', 'Dividendos · ETF de teste', 5.05, pg_temp.dia(46), 'planned')
           returning id, status)
  insert into fixture select 'pu_' || status, id from i;
reset role;
insert into public.investment_distributions (household_id, asset_id, transaction_id, kind, created_by)
values (pg_temp.fx('h'), pg_temp.fx('etf'), pg_temp.fx('pu_paid'), 'dividend', '00000000-0000-0000-0000-0000000100a1'),
       (pg_temp.fx('h'), pg_temp.fx('etf'), pg_temp.fx('pu_planned'), 'dividend', '00000000-0000-0000-0000-0000000100a1');
select pg_temp.login('00000000-0000-0000-0000-0000000100a1');
select is(pg_temp.prov(pg_temp.fx('h'), pg_temp.dia(70), pg_temp.dia(41)), 'BRL|241.07|0.00;USD|12.34|5.05', 'G7.1 uma linha por moeda, em ordem de moeda, sem somar');
select is(pg_temp.prov(pg_temp.fx('h'), pg_temp.dia(70), pg_temp.dia(41)), pg_temp.prov_ativos(pg_temp.fx('h'), pg_temp.dia(70), pg_temp.dia(41)), 'G7.2 = by_asset nas duas moedas');
select results_eq(
  $$select currency_code, received, planned from public.investment_income_totals(pg_temp.fx('h'), pg_temp.dia(71), pg_temp.dia(40))$$,
  $$select currency_code, sum(received), sum(planned) from public.investment_income_by_asset(pg_temp.fx('h'), pg_temp.dia(71), pg_temp.dia(40)) group by 1 order by 1$$,
  'G7.3 e no período largo, numeric contra numeric');
insert into foto select 'prov_h1', pg_temp.prov(pg_temp.fx('h'), pg_temp.dia(400), pg_temp.dia(-30));
select is((select v from foto where k = 'prov_h1'), 'BRL|251.08|7.07;USD|12.34|5.05', 'G8 tudo da família 1, de 400 dias atrás a 30 à frente (referência para o isolamento)');

-- ---- H: outra família, não autenticado e anon ----
select pg_temp.login('00000000-0000-0000-0000-0000000100a2');
insert into fixture select 'h2', public.create_household('Casa Outra');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date, currency_code)
           values (pg_temp.fx('h2'), 'Conta da outra casa', 'checking', 0, pg_temp.dia(400), 'BRL') returning id)
  insert into fixture select 'conta2', id from i;
-- a outra família usa o MESMO nome de instituição
insert into fixture select 'x2', public.investment_asset_create(pg_temp.fx('h2'), 'Fundo da outra casa', null, 'fund', 'BRL');
select public.investment_operation_record(pg_temp.fx('x2'), pg_temp.dia(240), 'buy', 1, 80.00);
select public.investment_asset_set_institution(pg_temp.fx('x2'), 'Corretora Teste');
select is((select count(*) from public.investment_income_totals(pg_temp.fx('h2'), pg_temp.dia(400), pg_temp.dia(-30))), 0::bigint,
          'H1 família sem proventos: zero linhas');
select public.investment_distribution_record(pg_temp.fx('x2'), 'income', pg_temp.dia(60), 9.99, pg_temp.fx('conta2'));

select is(pg_temp.sqlstate_of($$select public.investment_asset_set_institution(pg_temp.fx('acao'), 'Invasor')$$), '42501', 'H2 ativo de outra família: 42501');
select is(pg_temp.sqlstate_of($$select public.investment_asset_set_institution(pg_temp.fx('acao'), null)$$), '42501', 'H2.1 nem para limpar');
select is(pg_temp.erro_de($$select public.investment_asset_set_institution(pg_temp.fx('acao'), 'Invasor')$$),
          pg_temp.erro_de($$select public.investment_asset_set_institution('00000000-0000-0000-0000-000000000000', 'Invasor')$$),
          'H2.2 o erro é o mesmo de ativo inexistente (não revela que o ativo existe)');
select is((select count(*) from public.investment_institution_totals(pg_temp.fx('h'), pg_temp.hoje())), 0::bigint,
          'H3 quem não é da família recebe zero linhas em institution_totals');
select is((select count(*) from public.investment_income_totals(pg_temp.fx('h'), pg_temp.dia(400), pg_temp.dia(-30))), 0::bigint,
          'H3.1 e zero linhas em income_totals');
select is((select count(*) from public.investment_assets where household_id = pg_temp.fx('h')), 0::bigint,
          'H3.2 nem lê a instituição dos ativos da outra família na tabela (RLS)');
select is(pg_temp.inst(pg_temp.fx('h2'), pg_temp.hoje()), 'BRL|Corretora Teste|80.00', 'H4 a outra família só vê o que é dela (o mesmo nome não mistura)');
select is(pg_temp.prov(pg_temp.fx('h2'), pg_temp.dia(400), pg_temp.dia(-30)), 'BRL|9.99|0.00', 'H4.1 e só os proventos dela');

reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000100a1');
select is(pg_temp.gravada('acao'), '[Corretora Teste]', 'H5 a tentativa da outra família não mudou nada');
select is(pg_temp.inst(pg_temp.fx('h'), pg_temp.hoje()), (select v from foto where k = 'inst_h1'),
          'H5.1 os totais da família 1 seguem os mesmos (a "Corretora Teste" da outra casa não entra)');
select is(pg_temp.prov(pg_temp.fx('h'), pg_temp.dia(400), pg_temp.dia(-30)), (select v from foto where k = 'prov_h1'), 'H5.2 e os proventos também');
select is((select count(*) from public.investment_institution_totals(pg_temp.fx('h2'), pg_temp.hoje())), 0::bigint, 'H6 e a família 1 não lê os totais da outra');
select is((select count(*) from public.investment_income_totals(pg_temp.fx('h2'), pg_temp.dia(400), pg_temp.dia(-30))), 0::bigint, 'H6.1 nem os proventos');
select is(pg_temp.sqlstate_of($$select public.investment_asset_set_institution(pg_temp.fx('x2'), 'Invasor')$$), '42501', 'H6.2 nem altera o ativo da outra');

-- sessão sem usuário (papel authenticated, token sem `sub`): a própria função recusa
reset role;
select set_config('request.jwt.claims', '{}', true), set_config('role', 'authenticated', true);
select matches(pg_temp.erro_de($$select public.investment_asset_set_institution(pg_temp.fx('acao'), 'Sem usuário')$$), '^42501\|não autenticado',
               'H7 não autenticado: 42501, recusado pela função (antes de olhar o ativo)');
select is((select count(*) from public.investment_institution_totals(pg_temp.fx('h'), pg_temp.hoje())), 0::bigint, 'H7.1 sem usuário: zero linhas em institution_totals');
select is((select count(*) from public.investment_income_totals(pg_temp.fx('h'), pg_temp.dia(400), pg_temp.dia(-30))), 0::bigint, 'H7.2 e em income_totals');

reset role;
select set_config('request.jwt.claims', '{}', true), set_config('role', 'anon', true);
select is(pg_temp.sqlstate_of($$select public.investment_asset_set_institution(pg_temp.fx('acao'), 'Anon')$$), '42501', 'H8 anon não define instituição');
select is(pg_temp.sqlstate_of($$select * from public.investment_institution_totals(pg_temp.fx('h'), pg_temp.hoje())$$), '42501', 'H8.1 anon não lê os totais por instituição');
select is(pg_temp.sqlstate_of($$select * from public.investment_income_totals(pg_temp.fx('h'), pg_temp.dia(400), pg_temp.dia(-30))$$), '42501', 'H8.2 anon não lê os proventos');

-- ---- S: o check da coluna, em escrita direta como superusuário ----
reset role;
select is((select institution from public.investment_assets where id = pg_temp.fx('acao')), 'Corretora Teste', 'S1 depois de tudo, a ação segue na corretora');
select is(pg_temp.sqlstate_of($$update public.investment_assets set institution = '' where id = pg_temp.fx('semop')$$), '23514', 'S2 o check recusa texto vazio');
select is(pg_temp.sqlstate_of($$update public.investment_assets set institution = '    ' where id = pg_temp.fx('semop')$$), '23514', 'S2.1 e só espaços');
select is(pg_temp.sqlstate_of($$update public.investment_assets set institution = repeat('x', 41) where id = pg_temp.fx('semop')$$), '23514', 'S3 o check recusa 41 caracteres');
select is(pg_temp.sqlstate_of($$update public.investment_assets set institution = repeat('x', 40) where id = pg_temp.fx('semop')$$), null, 'S4 e aceita 40');
select is(pg_temp.sqlstate_of($$update public.investment_assets set institution = '  Com Pontas ' where id = pg_temp.fx('semop')$$), '23514',
          'S3.1 o check recusa espaço nas pontas (a coluna só guarda texto aparado)');
select is(pg_temp.sqlstate_of($$update public.investment_assets set institution = repeat('x', 40) || '   ' where id = pg_temp.fx('semop')$$), '23514',
          'S3.2 e 40 letras com espaços sobrando');
select is(pg_temp.sqlstate_of($$update public.investment_assets set institution = null where id = pg_temp.fx('semop')$$), null, 'S4.1 e nulo');
select is((select institution from public.investment_assets where id = pg_temp.fx('semop')), null, 'S4.2 gravou nulo');

select * from finish();
rollback;
