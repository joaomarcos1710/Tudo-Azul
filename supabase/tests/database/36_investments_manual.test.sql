-- 36_investments_manual: livro de operações, custo médio, avaliações e isolamento por família.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create temp table fixture (k text primary key, v uuid);
grant all on fixture to public;
create function pg_temp.fx(p_k text) returns uuid language sql as $f$ select v from fixture where k=p_k $f$;
create function pg_temp.mkuser(p_id uuid, p_email text) returns void language sql as $f$
  insert into auth.users (id, email, raw_user_meta_data) values (p_id, p_email, '{}'::jsonb)
$f$;
create function pg_temp.login(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $f$;
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
grant execute on function pg_temp.fx(text), pg_temp.mkuser(uuid,text), pg_temp.login(uuid), pg_temp.sqlstate_of(text) to public;

select pg_temp.mkuser('00000000-0000-0000-0000-0000000000e1', 'investimentos@test.com');
select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
insert into fixture select 'household', public.create_household('Casa Investimentos');

insert into public.accounts(household_id,name,type,initial_balance,opening_date)
values(pg_temp.fx('household'),'Conta principal','checking',5000.00,current_date - 30)
returning id;
insert into fixture select 'account', id from public.accounts
 where household_id=pg_temp.fx('household') and name='Conta principal';

insert into fixture select 'brl_asset',
  public.investment_asset_create(pg_temp.fx('household'),'Fundo teste','FNDTEST','fund','BRL');
insert into fixture select 'usd_asset',
  public.investment_asset_create(pg_temp.fx('household'),'ETF global','ETFTEST','etf','USD');

select is(pg_temp.sqlstate_of(format(
  'select public.investment_asset_create(%L::uuid,%L,%L,%L,%L)',
  gen_random_uuid(),'Ativo de outra família',null,'equity','BRL')), '42501',
  'não permite criar ativo em família alheia');

select public.investment_operation_record(pg_temp.fx('brl_asset'),current_date - 10,'buy',10,10,1,'primeira compra');
select public.investment_operation_record(pg_temp.fx('brl_asset'),current_date - 5,'buy',5,20,2,'segunda compra');
select public.investment_operation_record(pg_temp.fx('brl_asset'),current_date - 2,'sell',5,15,0.50,'venda parcial');
select public.investment_valuation_record(pg_temp.fx('brl_asset'),current_date - 1,16,'Extrato da corretora');

select is((select quantity from public.investment_portfolio(pg_temp.fx('household'),current_date)
            where asset_id=pg_temp.fx('brl_asset')), 10::numeric,
  'posição reflete compras menos vendas');
select is((select cost_basis from public.investment_portfolio(pg_temp.fx('household'),current_date)
            where asset_id=pg_temp.fx('brl_asset')), 135.33::numeric,
  'custo médio ponderado inclui tarifas de compra e reduz custo na venda');
select is((select market_value from public.investment_portfolio(pg_temp.fx('household'),current_date)
            where asset_id=pg_temp.fx('brl_asset')), 160.00::numeric,
  'avaliação manual por unidade calcula o valor de mercado');
select is((select unrealized_result from public.investment_portfolio(pg_temp.fx('household'),current_date)
            where asset_id=pg_temp.fx('brl_asset')), 24.67::numeric,
  'resultado não realizado é valor de mercado menos custo de aquisição');
select is((select valuation_source from public.investment_portfolio(pg_temp.fx('household'),current_date)
            where asset_id=pg_temp.fx('brl_asset')), 'Extrato da corretora',
  'fonte da avaliação fica preservada');

select is(pg_temp.sqlstate_of(format(
  'select public.investment_operation_record(%L::uuid,current_date,%L,11,15,0,null)',
  pg_temp.fx('brl_asset'),'sell')), '23514',
  'venda acima da quantidade disponível é recusada');
select is(pg_temp.sqlstate_of(format(
  'select public.investment_operation_record(%L::uuid,current_date + 1,%L,1,15,0,null)',
  pg_temp.fx('brl_asset'),'buy')), '22023',
  'operação com data futura é recusada');

select public.investment_operation_record(pg_temp.fx('usd_asset'),current_date,'buy',2,100.50,0,'posição em dólar');
select is((select count(*) from public.investment_totals(pg_temp.fx('household'),current_date)), 2::bigint,
  'totais são segregados por moeda, sem conversão implícita');
select is((select market_value from public.investment_totals(pg_temp.fx('household'),current_date)
            where currency_code='USD'), 201.00::numeric,
  'posição em dólar preserva o valor original');
select is((select market_value from public.investment_totals(pg_temp.fx('household'),current_date)
            where currency_code='BRL'), 160.00::numeric,
  'posição em reais permanece independente da posição em dólar');

select is((select balance from public.account_balances(pg_temp.fx('household'),current_date)
            where account_id=pg_temp.fx('account')), 5000.00::numeric,
  'registro patrimonial não altera caixa nem cria despesa/receita');

select is(pg_temp.sqlstate_of(format(
  'insert into public.investment_operations(household_id,asset_id,operation_date,kind,quantity,unit_price,created_by) values (%L,%L,current_date,%L,1,10,%L)',
  pg_temp.fx('household'),pg_temp.fx('brl_asset'),'buy','00000000-0000-0000-0000-0000000000e1')), '42501',
  'cliente não pode gravar operações diretamente, somente pela RPC');

select * from finish();
rollback;
