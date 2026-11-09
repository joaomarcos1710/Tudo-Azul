-- 82_reserve_envelopes_ledger: Envelopes Virtuais, isolamento, append-only e atomicidade.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create temp table fixture (k text primary key, v uuid);
grant all on fixture to public;
create function pg_temp.fx(p_k text) returns uuid language sql as $f$ select v from fixture where k=p_k $f$;
create function pg_temp.login(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $f$;
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
create function pg_temp.hoje() returns date language sql as $f$
  select (now() at time zone 'America/Sao_Paulo')::date
$f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.sqlstate_of(text), pg_temp.hoje() to public;

insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-000000022701','reserva-a@teste.com'),
 ('00000000-0000-0000-0000-000000022702','reserva-b@teste.com');

select pg_temp.login('00000000-0000-0000-0000-000000022701');
insert into fixture select 'h1', public.create_household('Família A');
insert into public.accounts (household_id,name,type,initial_balance,opening_date,currency_code)
values (pg_temp.fx('h1'),'Conta BRL','checking',500,pg_temp.hoje()-30,'BRL')
returning id;
insert into fixture select 'account_brl', id from public.accounts
 where household_id=pg_temp.fx('h1') and name='Conta BRL';
insert into fixture select 'expense_cat', id from public.categories
 where household_id=pg_temp.fx('h1') and type='expense' and system_key='uncategorized';
insert into public.accounts (household_id,name,type,initial_balance,opening_date,currency_code)
values (pg_temp.fx('h1'),'Conta EUR','checking',500,pg_temp.hoje()-30,'EUR')
returning id;
insert into fixture select 'account_eur', id from public.accounts
 where household_id=pg_temp.fx('h1') and name='Conta EUR';

insert into public.reserves (household_id,name,target_amount,currency_code)
values (pg_temp.fx('h1'),'Viagem Riga',8000,'EUR')
returning id;
insert into fixture select 'r1', id from public.reserves
 where household_id=pg_temp.fx('h1') and name='Viagem Riga';

select is((select status from public.reserves where id=pg_temp.fx('r1')), 'active',
  'reserva nasce ativa');
insert into public.reserve_allocations (household_id,reserve_id,amount,description)
values (pg_temp.fx('h1'),pg_temp.fx('r1'),500,'Primeiro aporte');
select is((select sum(amount) from public.reserve_allocations where reserve_id=pg_temp.fx('r1')),500::numeric,
  'aporte cria saldo virtual sem criar transação');
select is((select count(*) from public.transactions where household_id=pg_temp.fx('h1')),0::bigint,
  'aporte não polui o extrato');
select is(pg_temp.sqlstate_of(format(
  'insert into public.reserve_allocations(household_id,reserve_id,amount) values (%L,%L,1.005)',
  pg_temp.fx('h1'),pg_temp.fx('r1'))),'22003','valor com mais de duas casas é recusado');
select is(pg_temp.sqlstate_of(format(
  'insert into public.reserve_allocations(household_id,reserve_id,amount) values (%L,%L,-501)',
  pg_temp.fx('h1'),pg_temp.fx('r1'))),'23514','resgate acima do saldo é recusado');

update public.reserves set status='completed' where id=pg_temp.fx('r1');
select is(pg_temp.sqlstate_of(format(
  'insert into public.reserve_allocations(household_id,reserve_id,amount) values (%L,%L,1)',
  pg_temp.fx('h1'),pg_temp.fx('r1'))),'23514','reserva concluída não recebe aporte');
select is((select sum(amount) from public.reserve_allocations where reserve_id=pg_temp.fx('r1')),500::numeric,
  'concluir não libera nem altera saldo reservado');
select is(pg_temp.sqlstate_of(format(
  'update public.reserves set status=''archived'' where id=%L',pg_temp.fx('r1'))),'23514',
  'reserva com saldo não pode ser arquivada');

-- Pagamento real e resgate são atômicos, vinculados e na moeda da reserva.
select lives_ok(format(
  'select * from public.record_reserve_expense(%L,%L,%L,100,%L,''Passagens Riga'',''Compra das passagens'')',
  pg_temp.fx('r1'),pg_temp.fx('account_eur'),pg_temp.fx('expense_cat'),pg_temp.hoje()),
  'RPC cria despesa e resgate vinculados na mesma operação');
select is((select sum(amount) from public.reserve_allocations where reserve_id=pg_temp.fx('r1')),400::numeric,
  'resgate reduz saldo do envelope');
select is((select count(*) from public.transactions where household_id=pg_temp.fx('h1') and description='Passagens Riga'),1::bigint,
  'RPC registra uma despesa real');
select is((select count(*) from public.reserve_allocations a join public.transactions t
  on t.id=a.linked_transaction_id where a.reserve_id=pg_temp.fx('r1') and a.amount=-100 and t.amount=100),1::bigint,
  'resgate referencia exatamente a despesa real');

select is(pg_temp.sqlstate_of(format(
  'select * from public.record_reserve_expense(%L,%L,%L,1,%L,''Moeda errada'')',
  pg_temp.fx('r1'),pg_temp.fx('account_brl'),pg_temp.fx('expense_cat'),pg_temp.hoje())),
  '23514','conta em moeda diferente é recusada');
select is((select count(*) from public.transactions where household_id=pg_temp.fx('h1')),1::bigint,
  'falha na moeda não deixa despesa parcial');

-- Ledger append-only.
select is(pg_temp.sqlstate_of(format('update public.reserve_allocations set description=''editado'' where reserve_id=%L',pg_temp.fx('r1'))),
  '42501','UPDATE no ledger é recusado');
select is(pg_temp.sqlstate_of(format('delete from public.reserve_allocations where reserve_id=%L',pg_temp.fx('r1'))),
  '42501','DELETE no ledger é recusado');

-- Resgate explícito final zera o envelope; somente então pode arquivar.
insert into public.reserve_allocations(household_id,reserve_id,amount,description)
values (pg_temp.fx('h1'),pg_temp.fx('r1'),-400,'Resgate final');
update public.reserves set status='archived' where id=pg_temp.fx('r1');
select is((select status from public.reserves where id=pg_temp.fx('r1')),'archived',
  'reserva zerada pode ser arquivada');
select is(pg_temp.sqlstate_of(format(
  'insert into public.reserve_allocations(household_id,reserve_id,amount) values (%L,%L,-1)',
  pg_temp.fx('h1'),pg_temp.fx('r1'))),'23514','reserva arquivada não recebe alocação');
select is(pg_temp.sqlstate_of(format('update public.reserves set status=''active'' where id=%L',pg_temp.fx('r1'))),
  '55000','reserva arquivada não pode ser reaberta');

-- Isolamento entre famílias.
select pg_temp.login('00000000-0000-0000-0000-000000022702');
insert into fixture select 'h2', public.create_household('Família B');
select is((select count(*) from public.reserves where household_id=pg_temp.fx('h1')),0::bigint,
  'outra família não enxerga reservas');
select is(pg_temp.sqlstate_of(format(
  'insert into public.reserve_allocations(household_id,reserve_id,amount) values (%L,%L,10)',
  pg_temp.fx('h1'),pg_temp.fx('r1'))),'42501','outra família não aloca em reserva alheia');
select is(pg_temp.sqlstate_of(format(
  'select * from public.record_reserve_expense(%L,%L,%L,10,%L,''Tentativa'')',
  pg_temp.fx('r1'),pg_temp.fx('account_eur'),pg_temp.fx('expense_cat'),pg_temp.hoje())),
  '42501','RPC não permite gastar reserva de outra família');

select * from finish();
rollback;
