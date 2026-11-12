-- 110_investment_contribution_history: migration 114 (20261112160000_investment_contribution_history.sql). Aporte líquido mês a
-- mês para a linha "Aportado" do gráfico de evolução: contributed, redeemed e net_contributed até o fim de cada mês, com a MESMA
-- regra de investment_contributions (compras − vendas, anuladas fora, só ativos com posição aberta naquele fim de mês).
-- O que este arquivo prova:
--   • os valores mês a mês de um caso com compra, compra com tarifa, venda parcial e ativo zerado (que some com o que realizou);
--   • o último mês = a linha 'total' de investment_contributions de hoje (o número do topo da tela), no centavo;
--   • mês antes de qualquer operação devolve zeros; operação anulada não conta; duas moedas ficam separadas;
--   • outra família não lê nada, anon não executa, e a função não altera dado nenhum.
-- Cada operação de um mesmo ativo fica numa data diferente e todas distam 40 dias ou mais: dois dias a 32 dias ou mais de
-- distância nunca caem no mesmo mês, então "o mês da operação" é inequívoco. Datas relativas a hoje em São Paulo.
-- Sem a migration este arquivo falha nas asserções (a função é chamada por SQL dinâmico), sem abortar.
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
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);
end $f$;
create function pg_temp.hoje() returns date language sql as $f$ select (now() at time zone 'America/Sao_Paulo')::date $f$;
create function pg_temp.dia(p_n integer) returns date language sql as $f$ select pg_temp.hoje() - p_n $f$;
create function pg_temp.mes_de(p_n integer) returns date language sql as $f$ select date_trunc('month', pg_temp.hoje() - p_n)::date $f$;
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
-- "aportado|resgatado|líquido" de uma moeda no mês que contém o dia de n dias atrás (a leitura vai de 300 dias atrás até hoje)
create function pg_temp.h(p_n integer, p_moeda text default 'BRL', p_h text default 'h') returns text language plpgsql as $f$
declare r text;
begin
  execute $q$select concat_ws('|', contributed::numeric(20,2), redeemed::numeric(20,2), net_contributed::numeric(20,2))
               from public.investment_contribution_history($1, pg_temp.dia(300), pg_temp.hoje())
              where month = pg_temp.mes_de($2) and currency_code = $3$q$ into r using pg_temp.fx(p_h), p_n, p_moeda;
  return coalesce(r, 'sem linha');
exception when others then return 'erro: ' || sqlerrm;
end $f$;
create function pg_temp.dados() returns text language sql as $f$
  select md5(concat_ws('#',
    (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]')::text from public.investment_assets x),
    (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]')::text from public.investment_operations x),
    (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]')::text from public.transactions x))) $f$;
grant execute on all functions in schema pg_temp to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000110001', 'hist1@teste.com'),
  ('00000000-0000-0000-0000-000000110002', 'hist2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-000000110001');
insert into fixture select 'h', public.create_household('Casa do histórico de aportes');
insert into fixture select 'alfa', public.investment_asset_create(pg_temp.fx('h'), 'Alfa', null, 'fixed_income', 'BRL');
insert into fixture select 'beta', public.investment_asset_create(pg_temp.fx('h'), 'Beta', null, 'fixed_income', 'BRL');
insert into fixture select 'cris', public.investment_asset_create(pg_temp.fx('h'), 'Cris', null, 'fixed_income', 'USD');
-- Alfa: 10 × 100 (1.000,00) há 130 dias; 5 × 100 + tarifa 5 (505,00) há 90; vende 4 × 120 − tarifa 2 (478,00) há 50
select public.investment_operation_record(pg_temp.fx('alfa'), pg_temp.dia(130), 'buy', 10, 100, 0);
select public.investment_operation_record(pg_temp.fx('alfa'), pg_temp.dia(90), 'buy', 5, 100, 5);
select public.investment_operation_record(pg_temp.fx('alfa'), pg_temp.dia(50), 'sell', 4, 120, 2);
-- Beta: compra 1 × 300 há 90 dias e vende tudo (1 × 310) há 10: fica sem posição, some com o que realizou
select public.investment_operation_record(pg_temp.fx('beta'), pg_temp.dia(90), 'buy', 1, 300, 0);
select public.investment_operation_record(pg_temp.fx('beta'), pg_temp.dia(10), 'sell', 1, 310, 0);
-- Cris (dólar): 2 × 50 há 50 dias
select public.investment_operation_record(pg_temp.fx('cris'), pg_temp.dia(50), 'buy', 2, 50, 0);

-- ---- forma e permissões ----
select has_function('public', 'investment_contribution_history', array['uuid', 'date', 'date'], 'H1 existe investment_contribution_history(uuid, date, date)');
select is((select pg_get_function_result(p.oid) from pg_proc p where p.oid = to_regprocedure('public.investment_contribution_history(uuid, date, date)')),
          'TABLE(month date, currency_code text, contributed numeric, redeemed numeric, net_contributed numeric)', 'H2 colunas e tipos do retorno');
select is((select p.prosecdef from pg_proc p where p.oid = to_regprocedure('public.investment_contribution_history(uuid, date, date)')), false, 'H3 é SECURITY INVOKER');
select is((select p.provolatile::text from pg_proc p where p.oid = to_regprocedure('public.investment_contribution_history(uuid, date, date)')), 's', 'H4 é STABLE');
select is(has_function_privilege('anon', to_regprocedure('public.investment_contribution_history(uuid, date, date)'), 'EXECUTE'), false, 'H5 anon não executa');
select is(has_function_privilege('authenticated', to_regprocedure('public.investment_contribution_history(uuid, date, date)'), 'EXECUTE'), true, 'H6 authenticated executa');

-- ---- valores mês a mês (BRL) ----
select is(pg_temp.h(170), '0.00|0.00|0.00', 'H7 mês antes de qualquer operação: zeros (a linha não some)');
select is(pg_temp.h(130), '1000.00|0.00|1000.00', 'H8 após a 1ª compra da Alfa: 1.000 aportados');
select is(pg_temp.h(90), '1805.00|0.00|1805.00', 'H9 compra com tarifa (505) + Beta (300): 1.805 aportados, sem resgate');
select is(pg_temp.h(50), '1805.00|478.00|1327.00', 'H10 venda parcial da Alfa (478): 1.805 aportados, 478 resgatados, líquido 1.327');
select is(pg_temp.h(10), '1505.00|478.00|1027.00', 'H11 Beta zerada some com o que realizou (300 e 310): só a Alfa conta');
-- ---- moedas separadas ----
select is(pg_temp.h(50, 'USD'), '100.00|0.00|100.00', 'H12 o ativo em dólar tem a própria linha, fora do real');
select is(pg_temp.h(170, 'USD'), '0.00|0.00|0.00', 'H13 dólar antes da compra: zeros');

-- ---- o último mês é o número do topo da tela ----
select is((select concat_ws('|', h.contributed::numeric(20,2), h.redeemed::numeric(20,2), h.net_contributed::numeric(20,2))
             from public.investment_contribution_history(pg_temp.fx('h'), pg_temp.dia(300), pg_temp.hoje()) h
            where h.month = date_trunc('month', pg_temp.hoje())::date and h.currency_code = 'BRL'),
          (select concat_ws('|', c.contributed::numeric(20,2), c.redeemed::numeric(20,2), c.net_contributed::numeric(20,2))
             from public.investment_contributions(pg_temp.fx('h'), pg_temp.hoje()) c where c.level = 'total' and c.currency_code = 'BRL'),
          'H14 o último mês = a linha total de investment_contributions de hoje (o Aportado do resumo)');
select is((select concat_ws('|', h.contributed::numeric(20,2), h.redeemed::numeric(20,2), h.net_contributed::numeric(20,2))
             from public.investment_contribution_history(pg_temp.fx('h'), pg_temp.dia(300), pg_temp.hoje()) h
            where h.month = date_trunc('month', pg_temp.hoje())::date and h.currency_code = 'USD'),
          (select concat_ws('|', c.contributed::numeric(20,2), c.redeemed::numeric(20,2), c.net_contributed::numeric(20,2))
             from public.investment_contributions(pg_temp.fx('h'), pg_temp.hoje()) c where c.level = 'total' and c.currency_code = 'USD'),
          'H15 o mesmo vale para o dólar');
-- toda linha: líquido = aportado − resgatado
select is((select count(*) from public.investment_contribution_history(pg_temp.fx('h'), pg_temp.dia(300), pg_temp.hoje()) h
            where h.net_contributed <> h.contributed - h.redeemed), 0::bigint, 'H16 em toda linha, líquido = aportado − resgatado');

-- ---- operação anulada não conta (comparação antes/depois no mês da operação, sem depender de onde caem os outros dias) ----
create temp table foto (k text primary key, v numeric);
grant all on foto to public;
create function pg_temp.liq(p_n integer) returns numeric language plpgsql as $f$
declare r numeric;
begin
  execute $q$select net_contributed from public.investment_contribution_history(pg_temp.fx('h'), pg_temp.dia(300), pg_temp.hoje())
              where month = pg_temp.mes_de($1) and currency_code = 'BRL'$q$ into r using p_n;
  return r;
end $f$;
grant execute on function pg_temp.liq(integer) to public;
insert into foto values ('antes', pg_temp.liq(91));
select public.investment_operation_record(pg_temp.fx('alfa'), pg_temp.dia(91), 'buy', 1, 999, 0);
select is(pg_temp.liq(91) - (select v from foto where k = 'antes'), 999.00, 'H17 uma compra de 999 entra no líquido do mês dela');
select public.investment_operation_void((select id from public.investment_operations where asset_id = pg_temp.fx('alfa') and unit_price = 999), 'compra errada (teste)');
select is(pg_temp.liq(91) - (select v from foto where k = 'antes'), 0.00, 'H18 anulada: volta ao que era (não conta)');

-- ---- só leitura: nenhuma tabela muda ao chamar a função ----
create temp table retrato (k text primary key, v text);
grant all on retrato to public;
insert into retrato values ('antes', pg_temp.dados());
select count(*) from public.investment_contribution_history(pg_temp.fx('h'), pg_temp.dia(300), pg_temp.hoje());
select is(pg_temp.dados(), (select v from retrato where k = 'antes'), 'H19 chamar a função não altera nenhum dado');

-- ---- outra família e anônimo ----
select pg_temp.login('00000000-0000-0000-0000-000000110002');
select is((select count(*) from public.investment_contribution_history(pg_temp.fx('h'), pg_temp.dia(300), pg_temp.hoje())), 0::bigint, 'H21 outro usuário não lê a nossa família');
select pg_temp.anon();
select is(pg_temp.sqlstate_of($q$select * from public.investment_contribution_history(pg_temp.fx('h'), pg_temp.dia(300), pg_temp.hoje())$q$), '42501', 'H22 anônimo sem execute');
select pg_temp.login('00000000-0000-0000-0000-000000110001');
select is((select count(*) from public.investment_contribution_history(null, pg_temp.dia(300), pg_temp.hoje())), 0::bigint, 'H23 família nula: vazio');
select is((select count(*) from public.investment_contribution_history(pg_temp.fx('h'), pg_temp.hoje(), pg_temp.dia(300))), 0::bigint, 'H24 intervalo invertido: vazio');

select * from finish();
rollback;
