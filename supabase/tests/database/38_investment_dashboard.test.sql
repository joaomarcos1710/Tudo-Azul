-- 38_investment_dashboard: exclusão segura, histórico mensal, patrimônio BRL e categoria Financiamento.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Data local de São Paulo; pg_temp.hoje() do PostgreSQL usa UTC.
create function pg_temp.hoje() returns date language sql as $fn$ select (now() at time zone 'America/Sao_Paulo')::date $fn$;

create temp table fixture (k text primary key, v uuid);
grant all on fixture to public;
create function pg_temp.fx37(p_k text) returns uuid language sql as $f$ select v from fixture where k=p_k $f$;
create function pg_temp.mkuser37(p_id uuid, p_email text) returns void language sql as $f$
  insert into auth.users (id, email, raw_user_meta_data) values (p_id, p_email, '{}'::jsonb)
$f$;
create function pg_temp.login37(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $f$;
create function pg_temp.sqlstate37(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
grant execute on function pg_temp.fx37(text), pg_temp.mkuser37(uuid,text), pg_temp.login37(uuid), pg_temp.sqlstate37(text) to public;

select pg_temp.mkuser37('00000000-0000-0000-0000-0000000000f1','investimento-dashboard@test.com');
select pg_temp.login37('00000000-0000-0000-0000-0000000000f1');
insert into fixture select 'household', public.create_household('Carteira dashboard');

select ok(exists(
  select 1 from public.categories
   where household_id=pg_temp.fx37('household') and type='expense' and name='Financiamento'
), 'nova família recebe a categoria Financiamento com a grafia correta');

insert into public.accounts(household_id,name,type,initial_balance,opening_date)
values(pg_temp.fx37('household'),'Conta teste','checking',1000.00,pg_temp.hoje() - 10);

insert into fixture select 'empty_asset',
  public.investment_asset_create(pg_temp.fx37('household'),'Ativo cadastrado errado',null,'equity','BRL');
select lives_ok(format('select public.investment_asset_delete(%L::uuid)',pg_temp.fx37('empty_asset')),
  'ativo sem operações ou avaliações pode ser excluído');
select is((select count(*) from public.investment_assets where id=pg_temp.fx37('empty_asset')),0::bigint,
  'ativo excluído deixa de aparecer na lista');

insert into fixture select 'bem_excluir', public.family_asset_create(
  pg_temp.fx37('household'),'Bem de teste para excluir','other',null,'BRL','Família',100,pg_temp.hoje() - 10,1000,pg_temp.hoje() - 9,'Cadastro inicial');
select lives_ok(format('select public.family_asset_delete(%L::uuid)',pg_temp.fx37('bem_excluir')),
  'bem com apenas avaliação inicial pode ser excluído se cadastrado errado');
select is((select count(*) from public.family_assets where id=pg_temp.fx37('bem_excluir')),0::bigint,
  'bem excluído deixa de compor o inventário');

insert into fixture select 'bem_brl', public.family_asset_create(
  pg_temp.fx37('household'),'Imóvel familiar','real_estate',null,'BRL','Família',100,pg_temp.hoje() - 10,5000,pg_temp.hoje() - 9,'Avaliação inicial');
insert into fixture select 'bem_historico', public.family_asset_create(
  pg_temp.fx37('household'),'Veículo com histórico','vehicle',null,'BRL','Família',100,pg_temp.hoje() - 10,20000,pg_temp.hoje() - 9,'Avaliação inicial');
select public.family_asset_valuation_record(pg_temp.fx37('bem_historico'),pg_temp.hoje() - 1,21000,'Nova avaliação',null);
select is(pg_temp.sqlstate37(format('select public.family_asset_delete(%L::uuid)',pg_temp.fx37('bem_historico'))),'55000',
  'bem com histórico adicional não pode ser excluído');
select public.family_asset_end(pg_temp.fx37('bem_historico'),'disposed',pg_temp.hoje() - 1);

insert into fixture select 'brl_asset',
  public.investment_asset_create(pg_temp.fx37('household'),'Fundo BRL',null,'fund','BRL');
insert into fixture select 'usd_asset',
  public.investment_asset_create(pg_temp.fx37('household'),'ETF USD',null,'etf','USD');
insert into fixture select 'valuation_asset',
  public.investment_asset_create(pg_temp.fx37('household'),'Ativo avaliado',null,'equity','BRL');

select public.investment_operation_record(pg_temp.fx37('brl_asset'),pg_temp.hoje() - 5,'buy',10,10,0,'compra BRL');
select public.investment_valuation_record(pg_temp.fx37('brl_asset'),pg_temp.hoje() - 1,12,'Corretora');
select public.investment_operation_record(pg_temp.fx37('usd_asset'),pg_temp.hoje() - 5,'buy',2,50,0,'compra USD');
select public.investment_valuation_record(pg_temp.fx37('valuation_asset'),pg_temp.hoje() - 1,5,'Avaliação manual');

select is(pg_temp.sqlstate37(format('select public.investment_asset_delete(%L::uuid)',pg_temp.fx37('brl_asset'))),'55000',
  'ativo com operações não pode ser excluído');
select is(pg_temp.sqlstate37(format('select public.investment_asset_delete(%L::uuid)',pg_temp.fx37('valuation_asset'))),'55000',
  'ativo com avaliações não pode ser excluído');

insert into fixture select 'distribution_asset',
  public.investment_asset_create(pg_temp.fx37('household'),'Ativo com provento',null,'equity','BRL');
select public.investment_distribution_record(
  pg_temp.fx37('distribution_asset'),'dividend',pg_temp.hoje(),1, 
  (select id from public.accounts where household_id=pg_temp.fx37('household') and name='Conta teste'),
  'paid','provento de teste'
);
select is(pg_temp.sqlstate37(format('select public.investment_asset_delete(%L::uuid)',pg_temp.fx37('distribution_asset'))),'55000',
  'ativo com proventos não pode ser excluído');

select is((select market_value from public.investment_history(
  pg_temp.fx37('household'),date_trunc('month',pg_temp.hoje())::date,pg_temp.hoje()
) where currency_code='BRL' and month=date_trunc('month',pg_temp.hoje())::date),120::numeric,
  'histórico mensal soma posições e avaliações em BRL');
select is((select market_value from public.investment_history(
  pg_temp.fx37('household'),date_trunc('month',pg_temp.hoje())::date,pg_temp.hoje()
) where currency_code='USD' and month=date_trunc('month',pg_temp.hoje())::date),100::numeric,
  'histórico mantém posições em USD separadas');

select is((select family_assets_brl from public.net_worth_with_assets(
  pg_temp.fx37('household'),pg_temp.hoje()
)),5000::numeric,'patrimônio incorpora o valor da participação familiar em bens BRL');
select is((select net_worth from public.net_worth_with_assets(
  pg_temp.fx37('household'),pg_temp.hoje()
)),6000::numeric,'patrimônio = saldo disponível + bens BRL, sem somar investimentos que ainda não movimentam o caixa');

select * from finish();
rollback;
