-- 37_debt_contract_schedule: contrato, cronograma, baixa única e consignado sem saída de caixa.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create temp table fixture (k text primary key, v uuid);
grant all on fixture to public;
create function pg_temp.fx(p_k text) returns uuid language sql as $f$ select v from fixture where k=p_k $f$;
create function pg_temp.mkuser(p_id uuid, p_email text) returns void language sql as $f$
  insert into auth.users (id,email,raw_user_meta_data) values (p_id,p_email,'{}'::jsonb)
$f$;
create function pg_temp.login(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',json_build_object('sub',p_uid,'role','authenticated')::text,true);
  perform set_config('role','authenticated',true);
end $f$;
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
grant execute on function pg_temp.fx(text),pg_temp.mkuser(uuid,text),pg_temp.login(uuid),pg_temp.sqlstate_of(text) to public;

select pg_temp.mkuser('00000000-0000-0000-0000-0000000000e1','agenda@test.com');
select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
insert into fixture select 'household',public.create_household('Casa Agenda');
insert into public.accounts(household_id,name,type,initial_balance,opening_date)
values(pg_temp.fx('household'),'Conta agenda','checking',5000,current_date - 30)
returning id;
insert into fixture select 'account',id from public.accounts
where household_id=pg_temp.fx('household') and name='Conta agenda';
insert into fixture select 'category',id from public.categories
where household_id=pg_temp.fx('household') and name='Impostos e taxas' and type='expense';

insert into fixture select 'debit_debt',public.create_debt('Financiamento débito','financing',current_date - 10,1000);
select public.debt_contract_set(
  pg_temp.fx('debit_debt'),'Banco teste','CTR-001',12,12,100,31,'account_debit',
  pg_temp.fx('account'),date '2027-01-31'
);

select is((select count(*) from public.debt_payment_schedule where debt_id=pg_temp.fx('debit_debt')),12::bigint,
  'cria uma linha de agenda para cada parcela restante');
select is((select due_date from public.debt_payment_schedule where debt_id=pg_temp.fx('debit_debt') and installment_number=2),
  date '2027-02-28',
  'ajusta o vencimento do dia 31 para o último dia de fevereiro ou mês curto');
select is((select payment_account_id from public.debts where id=pg_temp.fx('debit_debt')),
  pg_temp.fx('account'),'guarda a conta escolhida para débito automático');

select public.debt_schedule_record_payment(
  (select id from public.debt_payment_schedule where debt_id=pg_temp.fx('debit_debt') and installment_number=1),
  current_date,pg_temp.fx('account'),80,20,0,pg_temp.fx('category'),false
);
select is((select debt from public.debt_balances(pg_temp.fx('household'),current_date) where debt_id=pg_temp.fx('debit_debt')),
  920.00::numeric,'somente o principal reduz o saldo devedor');
select is((select balance from public.account_balances(pg_temp.fx('household'),current_date) where account_id=pg_temp.fx('account')),
  4900.00::numeric,'principal e juros saem da conta uma única vez');
select is((select status from public.debt_payment_schedule where debt_id=pg_temp.fx('debit_debt') and installment_number=1),
  'paid','parcela passa para paga');
select is((select remaining_installments from public.debts where id=pg_temp.fx('debit_debt')),
  11,'prazo restante diminui após a baixa');
select is((select first_due_date from public.debts where id=pg_temp.fx('debit_debt')),
  date '2027-02-28','próximo vencimento avança para a próxima parcela ajustada ao mês curto');
select is((select planned from public.account_balances_projected(pg_temp.fx('household'),date '2027-12-31',true)
  where account_id=pg_temp.fx('account')),-1100.00::numeric,
  'parcelas futuras com débito automático entram na projeção da conta');
select is((select balance from public.account_balances_projected(pg_temp.fx('household'),date '2027-12-31',true)
  where account_id=pg_temp.fx('account')),3800.00::numeric,
  'saldo projetado considera apenas parcelas ainda planejadas');
select is((select count(*) from public.debt_events where schedule_id=(select id from public.debt_payment_schedule where debt_id=pg_temp.fx('debit_debt') and installment_number=1) and voided_at is null),
  2::bigint,'eventos financeiros ficam vinculados à parcela');

select public.debt_void((select id from public.debt_events where debt_id=pg_temp.fx('debit_debt')
  and schedule_id=(select id from public.debt_payment_schedule where debt_id=pg_temp.fx('debit_debt') and installment_number=1)
  and voided_at is null limit 1),'anulação de baixa agendada');
select is((select status from public.debt_payment_schedule where debt_id=pg_temp.fx('debit_debt') and installment_number=1),
  'planned','anulação restaura a parcela planejada');
select is((select remaining_installments from public.debts where id=pg_temp.fx('debit_debt')),
  12,'anulação restaura o prazo restante');
select is((select balance from public.account_balances(pg_temp.fx('household'),current_date) where account_id=pg_temp.fx('account')),
  5000.00::numeric,'anulação da parcela restaura o caixa');

insert into fixture select 'payroll_debt',public.create_debt('Consignado','loan',current_date - 10,1000);
select public.debt_contract_set(
  pg_temp.fx('payroll_debt'),'Banco folha',null,10,10,150,15,'payroll',null,
  (date_trunc('month',current_date) + interval '1 month' + interval '14 days')::date
);
select public.debt_schedule_record_payment(
  (select id from public.debt_payment_schedule where debt_id=pg_temp.fx('payroll_debt') order by installment_number limit 1),
  current_date,null,150,0,0,null,false
);
select is((select debt from public.debt_balances(pg_temp.fx('household'),current_date) where debt_id=pg_temp.fx('payroll_debt')),
  850.00::numeric,'baixa consignada reduz o passivo');
select is((select balance from public.account_balances(pg_temp.fx('household'),current_date) where account_id=pg_temp.fx('account')),
  5000.00::numeric,'consignado não cria saída duplicada na conta');
select is((select count(*) from public.debt_events where debt_id=pg_temp.fx('payroll_debt') and kind='payroll_payment' and account_id is null),
  1::bigint,'consignado usa evento sem conta bancária');
select is(pg_temp.sqlstate_of(format(
  'select public.debt_schedule_record_payment(%L::uuid,current_date,null,100,1,0,null,false)',
  (select id from public.debt_payment_schedule where debt_id=pg_temp.fx('payroll_debt') order by installment_number desc limit 1))),
  '22023','consignado não aceita juros/tarifas que duplicariam a despesa do salário líquido');

select is(pg_temp.sqlstate_of(format(
  'select public.debt_schedule_record_payment(%L::uuid,current_date,null,10,0,0,null,false)',
  (select id from public.debt_payment_schedule where debt_id=pg_temp.fx('debit_debt') and installment_number=1))),
  '55000','parcela paga não pode ser baixada novamente');

select * from finish();
rollback;
