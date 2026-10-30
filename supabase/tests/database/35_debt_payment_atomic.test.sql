-- 35_debt_payment_atomic: parâmetros contratuais e pagamento principal/juros/tarifa atômico.
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

select pg_temp.mkuser('00000000-0000-0000-0000-0000000000d1', 'dividas@test.com');
select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
insert into fixture select 'household', public.create_household('Casa Dívidas');

insert into public.accounts (household_id, name, type, initial_balance, opening_date)
values (pg_temp.fx('household'), 'Conta pagamento', 'checking', 5000.00, current_date - 30)
returning id;
insert into fixture select 'account', id from public.accounts
 where household_id = pg_temp.fx('household') and name = 'Conta pagamento';

insert into fixture select 'category', id from public.categories
 where household_id = pg_temp.fx('household') and name = 'Impostos e taxas' and type = 'expense';

insert into fixture select 'debt', public.create_debt('Financiamento teste', 'loan', current_date - 10, 1000.00);
select public.debt_set_terms(pg_temp.fx('debt'), 150, 250.00);

select is((select monthly_rate_bps from public.debts where id = pg_temp.fx('debt')), 150,
  'taxa mensal contratual é persistida em pontos-base');
select is((select minimum_payment from public.debts where id = pg_temp.fx('debt')), 250.00::numeric,
  'parcela mínima contratual é persistida');
select is(pg_temp.sqlstate_of(format('select public.debt_set_terms(%L::uuid, 10001, 250)', pg_temp.fx('debt'))),
  '22023', 'taxa acima de 100% ao mês é recusada');
select is(pg_temp.sqlstate_of(format('select public.debt_set_terms(%L::uuid, 150, 1.001)', pg_temp.fx('debt'))),
  '22003', 'parcela mínima com mais de duas casas é recusada');

select public.debt_record_payment(pg_temp.fx('debt'), current_date, pg_temp.fx('account'),
  700.00, 200.00, 100.00, pg_temp.fx('category'), false);

select is((select debt from public.debt_balances(pg_temp.fx('household'), current_date)
            where debt_id = pg_temp.fx('debt')), 300.00::numeric,
  'somente o principal reduz o saldo devedor');
select is((select balance from public.account_balances(pg_temp.fx('household'), current_date)
            where account_id = pg_temp.fx('account')), 4000.00::numeric,
  'principal, juros e tarifa saem da conta em uma única operação');
select is((select count(*) from public.debt_events where debt_id = pg_temp.fx('debt') and voided_at is null), 3::bigint,
  'pagamento grava os três eventos financeiros');
select is((select count(distinct op_id) from public.debt_events where debt_id = pg_temp.fx('debt')), 1::bigint,
  'os eventos compartilham um identificador de operação');

select is(pg_temp.sqlstate_of(format(
  'select public.debt_record_payment(%L::uuid,current_date,%L::uuid,0,10,0,null,false)',
  pg_temp.fx('debt'), pg_temp.fx('account'))), '22023',
  'juros sem categoria de despesa são recusados');

select is(pg_temp.sqlstate_of(format(
  'select public.debt_record_payment(%L::uuid,current_date,%L::uuid,500,20,0,%L::uuid,false)',
  pg_temp.fx('debt'), pg_temp.fx('account'), pg_temp.fx('category'))), '23514',
  'pagamento acima do saldo é recusado');
select is((select debt from public.debt_balances(pg_temp.fx('household'), current_date)
            where debt_id = pg_temp.fx('debt')), 300.00::numeric,
  'falha não altera o saldo devedor');
select is((select balance from public.account_balances(pg_temp.fx('household'), current_date)
            where account_id = pg_temp.fx('account')), 4000.00::numeric,
  'falha não altera o caixa');

select public.debt_record_payment(pg_temp.fx('debt'), current_date, pg_temp.fx('account'),
  100.00, 0, 0, null, true);
select is((select debt from public.debt_balances(pg_temp.fx('household'), current_date)
            where debt_id = pg_temp.fx('debt')), 200.00::numeric,
  'amortização extra reduz o saldo devedor');

select public.debt_void((select id from public.debt_events
  where debt_id = pg_temp.fx('debt') and kind = 'extra_principal' and voided_at is null), 'anulação de teste');
select is((select debt from public.debt_balances(pg_temp.fx('household'), current_date)
            where debt_id = pg_temp.fx('debt')), 300.00::numeric,
  'anulação auditada restaura o saldo devedor');
select is((select balance from public.account_balances(pg_temp.fx('household'), current_date)
            where account_id = pg_temp.fx('account')), 4000.00::numeric,
  'anulação auditada restaura o caixa');

select * from finish();
rollback;
