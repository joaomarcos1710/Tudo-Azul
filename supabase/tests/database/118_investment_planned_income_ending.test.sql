-- 118_investment_planned_income_ending: aviso "a previsão de proventos está acabando" (migration 20261114180000).
-- Leitura pura. Por ativo: a previsão acaba (último provento planejado em até N dias) E há padrão de repetição (2 ou mais proventos
-- do ativo nos últimos 12 meses até essa data). Datas relativas a hoje em São Paulo. Dados inventados.
-- Sem a migration este arquivo falha (a função não existe).
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
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
-- os ativos que acabam como "nome|dias até o último previsto|previstos|histórico|valor", em ordem
create function pg_temp.fim(p_dias int, p_h text default 'h') returns text language sql as $f$
  select coalesce(string_agg(asset_name || '|' || (last_date - pg_temp.hoje()) || '|' || planned_count || '|' || history_count || '|' || last_amount::numeric(14,2), ' ; ' order by last_date, asset_name), '-')
    from public.investment_planned_income_ending(pg_temp.fx(p_h), p_dias) $f$;
-- registra um provento (pago no passado ou previsto no futuro) a "n" dias de hoje
create function pg_temp.prov(p_asset text, p_n int, p_valor numeric, p_status text) returns void language plpgsql as $f$
begin
  perform public.investment_distribution_record(pg_temp.fx(p_asset), 'dividend', pg_temp.hoje() + p_n, p_valor, pg_temp.fx('conta'), p_status, null);
end $f$;
grant execute on all functions in schema pg_temp to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000118001', 'pe1@teste.com'),
  ('00000000-0000-0000-0000-000000118002', 'pe2@teste.com');
select pg_temp.login('00000000-0000-0000-0000-000000118001');
insert into fixture select 'h', public.create_household('Casa da previsão acabando');
with a as (insert into public.accounts (household_id, name, type, initial_balance, opening_date, currency_code)
           values (pg_temp.fx('h'), 'Banco', 'checking', 1000, '2020-01-01', 'BRL') returning id)
  insert into fixture select 'conta', id from a;
insert into fixture select 'fii',   public.investment_asset_create(pg_temp.fx('h'), 'FII acabando', 'AAAA11', 'fund', 'BRL');
insert into fixture select 'acao',  public.investment_asset_create(pg_temp.fx('h'), 'Ação longe', 'BBBB3', 'equity', 'BRL');
insert into fixture select 'unico', public.investment_asset_create(pg_temp.fx('h'), 'Avulso sem histórico', 'CCCC3', 'equity', 'BRL');
insert into fixture select 'arq',   public.investment_asset_create(pg_temp.fx('h'), 'Arquivado', 'DDDD3', 'equity', 'BRL');
insert into fixture select 'b60',   public.investment_asset_create(pg_temp.fx('h'), 'Borda 60', 'EEEE3', 'equity', 'BRL');
insert into fixture select 'b61',   public.investment_asset_create(pg_temp.fx('h'), 'Borda 61', 'FFFF3', 'equity', 'BRL');
insert into fixture select 'lix',   public.investment_asset_create(pg_temp.fx('h'), 'Com lixeira', 'GGGG3', 'equity', 'BRL');
insert into fixture select 'velho', public.investment_asset_create(pg_temp.fx('h'), 'Previsão já acabou', 'HHHH3', 'equity', 'BRL');

select has_function('public', 'investment_planned_income_ending', array['uuid', 'integer', 'date'], 'A1 existe investment_planned_income_ending(uuid, integer, date)');
select is(pg_temp.fim(60), '-', 'A2 sem proventos: nenhuma linha');

-- FII acabando: pagos há 60 e 30 dias; previstos daqui a 5 e 35 dias (o último é em 35 dias)
select pg_temp.prov('fii', -60, 10, 'paid'); select pg_temp.prov('fii', -30, 10, 'paid');
select pg_temp.prov('fii', 5, 11, 'planned'); select pg_temp.prov('fii', 35, 12.50, 'planned');
-- Ação longe: paga há 30 dias; prevista daqui a 20 e 100 dias (o último passa de 60 dias)
select pg_temp.prov('acao', -30, 5, 'paid'); select pg_temp.prov('acao', 20, 6, 'planned'); select pg_temp.prov('acao', 100, 7, 'planned');
-- Avulso: um único previsto daqui a 20 dias, sem nenhum outro provento (não é série)
select pg_temp.prov('unico', 20, 9, 'planned');
-- Arquivado: padrão completo, mas o ativo foi arquivado
select pg_temp.prov('arq', -20, 4, 'paid'); select pg_temp.prov('arq', 30, 4, 'planned');
-- Bordas: o último previsto em exatamente 60 e em 61 dias (cada um com um pago antes)
select pg_temp.prov('b60', -20, 3, 'paid'); select pg_temp.prov('b60', 60, 3, 'planned');
select pg_temp.prov('b61', -20, 3, 'paid'); select pg_temp.prov('b61', 61, 3, 'planned');
-- Com lixeira: pago há 20 dias, previsto daqui a 10 e 50 dias; o de 50 dias vai para a lixeira (o último passa a ser o de 10)
select pg_temp.prov('lix', -20, 2, 'paid'); select pg_temp.prov('lix', 10, 2.25, 'planned'); select pg_temp.prov('lix', 50, 8, 'planned');
select public.transactions_bulk_trash(array[(select t.id from public.investment_distributions d join public.transactions t on t.id = d.transaction_id
                                             where d.asset_id = pg_temp.fx('lix') and t.date = pg_temp.hoje() + 50)]);
-- Previsão já acabou: nada previsto de hoje em diante (tudo no passado)
select pg_temp.prov('velho', -90, 3, 'paid'); select pg_temp.prov('velho', -60, 3, 'paid'); select pg_temp.prov('velho', -30, 3, 'paid');
-- arquiva o ativo "Arquivado" (direto na tabela: a função de arquivar recusa ativo com previsto)
reset role;
update public.investment_assets set active = false where id = pg_temp.fx('arq');
select pg_temp.login('00000000-0000-0000-0000-000000118001');

-- em 60 dias: só os que acabam dentro do horizonte, com o último previsto, a contagem e o valor da última data
select is(pg_temp.fim(60),
  'Com lixeira|10|1|2|2.25 ; FII acabando|35|2|4|12.50 ; Borda 60|60|1|2|3.00',
  'A3 em 60 dias: FII (último em 35), o com lixeira (o de 50 dias foi para a lixeira) e a borda de 60 dias; fora: longe, avulso, arquivado, borda 61, já acabou');
select is(pg_temp.fim(61), 'Com lixeira|10|1|2|2.25 ; FII acabando|35|2|4|12.50 ; Borda 60|60|1|2|3.00 ; Borda 61|61|1|2|3.00',
  'A4 em 61 dias a borda de 61 entra (o último dia conta)');
select is(pg_temp.fim(30), 'Com lixeira|10|1|2|2.25', 'A5 em 30 dias só o que acaba em 10 dias (o FII acaba em 35)');
select is(pg_temp.fim(120), 'Com lixeira|10|1|2|2.25 ; FII acabando|35|2|4|12.50 ; Borda 60|60|1|2|3.00 ; Borda 61|61|1|2|3.00 ; Ação longe|100|2|3|7.00',
  'A6 em 120 dias a ação de 100 dias entra; o avulso (sem histórico) e o que já acabou nunca entram');
select is((select count(*)::integer from public.investment_planned_income_ending(pg_temp.fx('h'), 366) where asset_name in ('Avulso sem histórico', 'Arquivado', 'Previsão já acabou')), 0,
  'A7 avulso sem histórico, ativo arquivado e previsão que já acabou nunca aparecem, nem em 366 dias');

-- a data de corte é parâmetro (o resultado não depende só do dia em que o teste roda)
select is((select count(*)::integer from public.investment_planned_income_ending(pg_temp.fx('h'), 30, pg_temp.hoje() + 40) where asset_name = 'FII acabando'), 0,
  'A8 com corte daqui a 40 dias o FII (último em 35) já acabou: não avisa mais');

-- parâmetros e acesso
select is(pg_temp.sqlstate_of(format($q$select * from public.investment_planned_income_ending(%L, 0)$q$, pg_temp.fx('h'))), '22023', 'A9 zero dias é recusado');
select is(pg_temp.sqlstate_of(format($q$select * from public.investment_planned_income_ending(%L, 367)$q$, pg_temp.fx('h'))), '22023', 'A10 mais de 366 dias é recusado');
select is(pg_temp.sqlstate_of($q$select * from public.investment_planned_income_ending(null)$q$), '22023', 'A11 sem família é recusado');
select pg_temp.login('00000000-0000-0000-0000-000000118002');
select is(pg_temp.fim(366), '-', 'A12 outro usuário não vê os ativos da nossa família');
select pg_temp.anon();
select is(pg_temp.sqlstate_of(format($q$select * from public.investment_planned_income_ending(%L)$q$, pg_temp.fx('h'))), '42501', 'A13 anônimo sem execute');
select pg_temp.login('00000000-0000-0000-0000-000000118001');
select is(has_function_privilege('authenticated', 'public.investment_planned_income_ending(uuid,integer,date)', 'execute'), true, 'A14 authenticated executa');
select is(has_function_privilege('anon', 'public.investment_planned_income_ending(uuid,integer,date)', 'execute'), false, 'A15 anon não executa');

select * from finish();
rollback;
