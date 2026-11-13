-- 113_investment_distribution_series: proventos previstos que se repetem (migration 20261113140000).
--   investment_distribution_record_series: cria proventos PLANEJADOS repetidos (1, 3, 6 ou 12 meses), no máximo 12 meses, tudo ou nada.
--   investment_planned_income: por ativo, o que está previsto de hoje a 12 meses (leitura pura).
-- Prova: quantidades e datas por frequência (inclusive o dia 31), limite de 12 meses, o vínculo com o ativo e a receita planejada
-- (não paga), tudo ou nada quando uma data falha, recusas, isolamento entre famílias, anônimo sem execute. Dados inventados;
-- datas relativas a hoje em São Paulo. Sem a migration este arquivo falha (as funções não existem).
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
-- as datas dos proventos planejados do ativo, em ordem, como texto "d1,d2,..." (relativas a hoje: "+N dias")
create function pg_temp.datas(p_asset text) returns text language sql as $f$
  select coalesce(string_agg(to_char(t.date, 'YYYY-MM-DD'), ',' order by t.date), '-')
    from public.investment_distributions d join public.transactions t on t.id = d.transaction_id
   where d.asset_id = pg_temp.fx(p_asset) and t.status = 'planned' $f$;
create function pg_temp.qtd(p_asset text) returns integer language sql as $f$
  select count(*)::integer from public.investment_distributions d join public.transactions t on t.id = d.transaction_id
   where d.asset_id = pg_temp.fx(p_asset) and t.status = 'planned' $f$;
grant execute on all functions in schema pg_temp to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000113001', 'ds1@teste.com'),
  ('00000000-0000-0000-0000-000000113002', 'ds2@teste.com');
select pg_temp.login('00000000-0000-0000-0000-000000113001');
insert into fixture select 'h', public.create_household('Casa dos proventos previstos');
with a as (insert into public.accounts (household_id, name, type, initial_balance, opening_date, currency_code)
           values (pg_temp.fx('h'), 'Banco', 'checking', 1000, '2020-01-01', 'BRL') returning id)
  insert into fixture select 'conta', id from a;
with a as (insert into public.accounts (household_id, name, type, initial_balance, opening_date, currency_code)
           values (pg_temp.fx('h'), 'Banco USD', 'checking', 0, '2020-01-01', 'USD') returning id)
  insert into fixture select 'usd', id from a;
insert into fixture select 'fii',   public.investment_asset_create(pg_temp.fx('h'), 'FII de teste', 'TSTF11', 'fund', 'BRL');
insert into fixture select 'acao',  public.investment_asset_create(pg_temp.fx('h'), 'Ação de teste', 'TEST3', 'equity', 'BRL');
insert into fixture select 'etf',   public.investment_asset_create(pg_temp.fx('h'), 'ETF de teste', 'TSTE', 'etf', 'USD');
insert into fixture select 'arq',   public.investment_asset_create(pg_temp.fx('h'), 'Arquivado de teste', null, 'fund', 'BRL');

-- ---- formas e permissões ----
select has_function('public', 'investment_distribution_record_series', array['uuid','text','date','numeric','uuid','integer','date','text'], 'S1 existe a série');
select has_function('public', 'investment_planned_income', array['uuid'], 'S2 existe a leitura dos previstos');
select is(has_function_privilege('authenticated', 'public.investment_distribution_record_series(uuid,text,date,numeric,uuid,integer,date,text)', 'execute'), true, 'S3 authenticated executa a série');
select is(has_function_privilege('anon', 'public.investment_distribution_record_series(uuid,text,date,numeric,uuid,integer,date,text)', 'execute'), false, 'S4 anon não executa a série');
select is(has_function_privilege('anon', 'public.investment_planned_income(uuid)', 'execute'), false, 'S5 anon não executa a leitura');

-- ---- mensal: 12 proventos, de hoje + 0 a hoje + 11 meses (nunca 13) ----
select is(public.investment_distribution_record_series(pg_temp.fx('fii'), 'income', pg_temp.hoje(), 85.50, pg_temp.fx('conta'), 1), 12,
  'S6 mensal sem data final cria 12 proventos (12 meses, nunca 13)');
select is(pg_temp.qtd('fii'), 12, 'S7 12 planejados gravados');
select is((select count(*)::integer from public.investment_distributions d join public.transactions t on t.id = d.transaction_id
            where d.asset_id = pg_temp.fx('fii') and t.status = 'planned' and t.type = 'income' and t.amount = 85.50
              and t.account_id = pg_temp.fx('conta') and t.deleted_at is null), 12,
  'S8 todos são receita planejada de 85,50 na conta, ligados ao ativo (não pagos)');
select is((select min(t.date) from public.investment_distributions d join public.transactions t on t.id = d.transaction_id where d.asset_id = pg_temp.fx('fii')),
  pg_temp.hoje(), 'S9 o primeiro é a data pedida');
select is((select max(t.date) from public.investment_distributions d join public.transactions t on t.id = d.transaction_id where d.asset_id = pg_temp.fx('fii')),
  (pg_temp.hoje() + interval '11 months')::date, 'S10 o último é 11 meses depois, dentro do limite de 12');

-- ---- as outras frequências ----
select is(public.investment_distribution_record_series(pg_temp.fx('acao'), 'dividend', pg_temp.hoje() + 10, 40.00, pg_temp.fx('conta'), 3), 4,
  'S11 trimestral cria 4 proventos');
select is((select count(distinct t.date)::integer from public.investment_distributions d join public.transactions t on t.id = d.transaction_id
            where d.asset_id = pg_temp.fx('acao') and t.date = (pg_temp.hoje() + 10 + interval '3 months')::date), 1, 'S12 o segundo cai 3 meses depois');
-- data final corta antes dos 12 meses: semestral com "até" em 5 meses cria só 1
select is(public.investment_distribution_record_series(pg_temp.fx('arq'), 'jcp', pg_temp.hoje() + 1, 10.00, pg_temp.fx('conta'), 6, (pg_temp.hoje() + interval '5 months')::date), 1,
  'S13 a data final corta a série (semestral até 5 meses = 1)');
-- "até" além de 12 meses é cortado em 12
select is(public.investment_distribution_record_series(pg_temp.fx('arq'), 'income', pg_temp.hoje() + 2, 10.00, pg_temp.fx('conta'), 12, (pg_temp.hoje() + interval '5 years')::date), 1,
  'S14 anual com "até" em 5 anos cria só 1 (limite de 12 meses por vez)');

-- ---- recusas (nada é criado) ----
select is(pg_temp.sqlstate_of(format($q$select public.investment_distribution_record_series(%L, 'income', pg_temp.hoje(), 10, %L, 2)$q$, pg_temp.fx('fii'), pg_temp.fx('conta'))),
  '22023', 'S15 repetição de 2 meses não existe');
select is(pg_temp.sqlstate_of(format($q$select public.investment_distribution_record_series(%L, 'income', pg_temp.hoje() - 1, 10, %L, 1)$q$, pg_temp.fx('fii'), pg_temp.fx('conta'))),
  '22023', 'S16 primeira data antes de hoje é recusada (previsão é daqui pra frente)');
select is(pg_temp.sqlstate_of(format($q$select public.investment_distribution_record_series(%L, 'income', pg_temp.hoje() + 5, 10, %L, 1, pg_temp.hoje())$q$, pg_temp.fx('fii'), pg_temp.fx('conta'))),
  '22023', 'S17 data final antes da primeira é recusada');
select is(pg_temp.sqlstate_of(format($q$select public.investment_distribution_record_series(%L, 'income', pg_temp.hoje() + 5, 10.005, %L, 1)$q$, pg_temp.fx('fii'), pg_temp.fx('conta'))),
  '22023', 'S18 valor com mais de 2 casas é recusado (a função base valida)');
select is(pg_temp.sqlstate_of(format($q$select public.investment_distribution_record_series(%L, 'income', pg_temp.hoje() + 5, 10, %L, 1)$q$, pg_temp.fx('etf'), pg_temp.fx('conta'))),
  '22023', 'S19 ativo em dólar é recusado (proventos só em reais nesta fase)');
select is(pg_temp.sqlstate_of(format($q$select public.investment_distribution_record_series(%L, 'income', pg_temp.hoje() + 5, 10, %L, 1)$q$, pg_temp.fx('fii'), pg_temp.fx('usd'))),
  '23514', 'S20 conta em dólar é recusada (só proventos em conta BRL)');
-- tudo ou nada: se a TERCEIRA data falha, as duas primeiras também não ficam. A falha é provocada por um gatilho de teste (dentro da
-- transação, desfeito no rollback) que recusa um lançamento na data de hoje + 2 meses.
reset role;
create function public.zz_falha_de_teste() returns trigger language plpgsql as $f$
begin
  if new.date = ((now() at time zone 'America/Sao_Paulo')::date + interval '2 months')::date then
    raise exception 'falha de teste na terceira data' using errcode = 'P0001';
  end if;
  return new;
end $f$;
create trigger zz_falha_de_teste before insert on public.transactions for each row execute function public.zz_falha_de_teste();
select pg_temp.login('00000000-0000-0000-0000-000000113001');
select is(pg_temp.sqlstate_of(format($q$select public.investment_distribution_record_series(%L, 'income', pg_temp.hoje(), 10, %L, 1)$q$, pg_temp.fx('fii'), pg_temp.fx('conta'))),
  'P0001', 'S21 a terceira data falha e a série inteira falha');
select is(pg_temp.qtd('fii'), 12, 'S22 e nenhuma das duas primeiras ficou: continuam os 12 de antes');
reset role;
drop trigger zz_falha_de_teste on public.transactions;
drop function public.zz_falha_de_teste();
select pg_temp.login('00000000-0000-0000-0000-000000113001');

-- ---- leitura dos previstos: por ativo, hoje a 12 meses ----
select is((select string_agg(asset_name || '|' || item_count || '|' || next_date || '|' || next_amount || '|' || total_12m, ' ; ' order by next_date, asset_name)
             from public.investment_planned_income(pg_temp.fx('h'))),
  'FII de teste|12|' || pg_temp.hoje() || '|85.50|1026.00 ; Arquivado de teste|2|' || (pg_temp.hoje() + 1) || '|10.00|20.00 ; Ação de teste|4|' || (pg_temp.hoje() + 10) || '|40.00|160.00',
  'S23 por ativo: quantidade, próxima data e valor, e o total de 12 meses (a soma vem do banco)');
-- provento já pago ou na lixeira não conta
update public.transactions set status = 'paid' where id = (select t.id from public.investment_distributions d join public.transactions t on t.id = d.transaction_id
                                                           where d.asset_id = pg_temp.fx('fii') and t.date = pg_temp.hoje());
update public.transactions set deleted_at = now() where id = (select t.id from public.investment_distributions d join public.transactions t on t.id = d.transaction_id
                                                              where d.asset_id = pg_temp.fx('acao') order by t.date limit 1);
select is((select item_count || '|' || total_12m from public.investment_planned_income(pg_temp.fx('h')) where asset_name = 'FII de teste'), '11|940.50',
  'S24 o provento marcado como pago sai da previsão');
select is((select item_count || '|' || total_12m from public.investment_planned_income(pg_temp.fx('h')) where asset_name = 'Ação de teste'), '3|120.00',
  'S25 o provento na lixeira sai da previsão');

-- ---- isolamento e anônimo ----
select pg_temp.login('00000000-0000-0000-0000-000000113002');
select is((select count(*)::integer from public.investment_planned_income(pg_temp.fx('h'))), 0, 'S26 outra família não vê os previstos');
select is(pg_temp.sqlstate_of(format($q$select public.investment_distribution_record_series(%L, 'income', pg_temp.hoje() + 5, 10, %L, 1)$q$, pg_temp.fx('fii'), pg_temp.fx('conta'))),
  '42501', 'S27 outra família não cria proventos no nosso ativo');
select pg_temp.anon();
select is(pg_temp.sqlstate_of(format($q$select * from public.investment_planned_income(%L)$q$, pg_temp.fx('h'))), '42501', 'S28 anônimo sem execute na leitura');
select is(pg_temp.sqlstate_of(format($q$select public.investment_distribution_record_series(%L, 'income', pg_temp.hoje() + 5, 10, %L, 1)$q$, pg_temp.fx('fii'), pg_temp.fx('conta'))),
  '42501', 'S29 anônimo sem execute na série');

select * from finish();
rollback;
