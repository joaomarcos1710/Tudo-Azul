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
insert into fixture select 'expense_cat_alt', id from public.categories
 where household_id=pg_temp.fx('h1') and type='expense' and name='Mercado';
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
insert into public.reserves (household_id,name,currency_code)
values (pg_temp.fx('h1'),'Reserva alternativa','EUR') returning id;
insert into fixture select 'r2', id from public.reserves
 where household_id=pg_temp.fx('h1') and name='Reserva alternativa';

-- Aporte e resgate manual usam a mesma chave de idempotência em todas as tentativas.
insert into fixture select 'manual_allocation', public.record_reserve_allocation(
  pg_temp.fx('r2'),50,pg_temp.hoje(),'Aporte manual',
  '00000000-0000-0000-0000-000000022729');
select is(public.record_reserve_allocation(
  pg_temp.fx('r2'),50,pg_temp.hoje(),'Aporte manual',
  '00000000-0000-0000-0000-000000022729'),pg_temp.fx('manual_allocation'),
  'reenvio idêntico de aporte manual retorna o mesmo ID');
select is(pg_temp.sqlstate_of(format(
  'select public.record_reserve_allocation(%L,51,%L,%L,%L)',
  pg_temp.fx('r2'),pg_temp.hoje(),'Aporte manual','00000000-0000-0000-0000-000000022729')),
  '40900','mesma chave de aporte com valor diferente gera conflito');
insert into fixture select 'manual_withdrawal', public.record_reserve_allocation(
  pg_temp.fx('r2'),-10,pg_temp.hoje(),'Resgate manual',
  '00000000-0000-0000-0000-000000022730');
select is(public.record_reserve_allocation(
  pg_temp.fx('r2'),-10,pg_temp.hoje(),'Resgate manual',
  '00000000-0000-0000-0000-000000022730'),pg_temp.fx('manual_withdrawal'),
  'reenvio idêntico de resgate manual retorna o mesmo ID');
select is((select sum(amount) from public.reserve_allocations where reserve_id=pg_temp.fx('r2')),
  40::numeric,'aporte e resgate manuais alteram o ledger uma única vez');

select is((select status from public.reserves where id=pg_temp.fx('r1')), 'active',
  'reserva nasce ativa');
insert into public.reserve_allocations (household_id,reserve_id,amount,description,idempotency_key)
values (pg_temp.fx('h1'),pg_temp.fx('r1'),500,'Primeiro aporte','00000000-0000-0000-0000-000000022721');
select is((select sum(amount) from public.reserve_allocations where reserve_id=pg_temp.fx('r1')),500::numeric,
  'aporte cria saldo virtual sem criar transação');
select is((select count(*) from public.transactions where household_id=pg_temp.fx('h1')),0::bigint,
  'aporte não polui o extrato');
select is(pg_temp.sqlstate_of(format(
  'insert into public.reserve_allocations(household_id,reserve_id,amount,idempotency_key) values (%L,%L,1.005,%L)',
  pg_temp.fx('h1'),pg_temp.fx('r1'),'00000000-0000-0000-0000-000000022722')),'22003','valor com mais de duas casas é recusado');
select is(pg_temp.sqlstate_of(format(
  'insert into public.reserve_allocations(household_id,reserve_id,amount,idempotency_key) values (%L,%L,-501,%L)',
  pg_temp.fx('h1'),pg_temp.fx('r1'),'00000000-0000-0000-0000-000000022723')),'23514','resgate acima do saldo é recusado');

update public.reserves set status='completed' where id=pg_temp.fx('r1');
select is(pg_temp.sqlstate_of(format(
  'insert into public.reserve_allocations(household_id,reserve_id,amount,idempotency_key) values (%L,%L,1,%L)',
  pg_temp.fx('h1'),pg_temp.fx('r1'),'00000000-0000-0000-0000-000000022724')),'23514','reserva concluída não recebe aporte');
select is((select sum(amount) from public.reserve_allocations where reserve_id=pg_temp.fx('r1')),500::numeric,
  'concluir não libera nem altera saldo reservado');
select is(pg_temp.sqlstate_of(format(
  'update public.reserves set status=''archived'' where id=%L',pg_temp.fx('r1'))),'23514',
  'reserva com saldo não pode ser arquivada');

-- Pagamento real e resgate são atômicos, vinculados e na moeda da reserva.
select lives_ok(format(
  'select * from public.record_reserve_expense(%L,%L,%L,100,%L,''Passagens Riga'',%L,''Compra das passagens'')',
  pg_temp.fx('r1'),pg_temp.fx('account_eur'),pg_temp.fx('expense_cat'),pg_temp.hoje(),
  '00000000-0000-0000-0000-000000022711'),
  'RPC cria despesa e resgate vinculados na mesma operação');
insert into fixture select 'rpc_tx', transaction_id from public.record_reserve_expense(
  pg_temp.fx('r1'),pg_temp.fx('account_eur'),pg_temp.fx('expense_cat'),100,pg_temp.hoje(),
  'Passagens Riga','00000000-0000-0000-0000-000000022711','Compra das passagens');
insert into fixture select 'rpc_alloc', allocation_id from public.record_reserve_expense(
  pg_temp.fx('r1'),pg_temp.fx('account_eur'),pg_temp.fx('expense_cat'),100,pg_temp.hoje(),
  'Passagens Riga','00000000-0000-0000-0000-000000022711','Compra das passagens');

-- A despesa vinculada não pode ter seus dados financeiros alterados nem ser removida.
select is(pg_temp.sqlstate_of(format(
  'update public.transactions set amount=101 where id=%L',pg_temp.fx('rpc_tx'))),
  '23514','valor de despesa vinculada é imutável');
select is(pg_temp.sqlstate_of(format(
  'update public.transactions set account_id=%L where id=%L',
  pg_temp.fx('account_brl'),pg_temp.fx('rpc_tx'))),
  '23514','conta de despesa vinculada é imutável');
select is(pg_temp.sqlstate_of(format(
  'update public.transactions set deleted_at=now() where id=%L',pg_temp.fx('rpc_tx'))),
  '23514','despesa vinculada não pode ir para a lixeira');
select is(pg_temp.sqlstate_of(format(
  'delete from public.transactions where id=%L',pg_temp.fx('rpc_tx'))),
  '23514','despesa vinculada não pode ser excluída');
select lives_ok(format(
  'update public.transactions set description=''Passagens atualizadas'' where id=%L',pg_temp.fx('rpc_tx')),
  'descrição pode ser corrigida sem alterar a integridade financeira');
select is((select transaction_id from public.record_reserve_expense(
  pg_temp.fx('r1'),pg_temp.fx('account_eur'),pg_temp.fx('expense_cat'),100,pg_temp.hoje(),
  'Passagens Riga','00000000-0000-0000-0000-000000022711','Compra das passagens')),
  pg_temp.fx('rpc_tx'),'reenvio idêntico retorna o ID da despesa original');
select is((select allocation_id from public.record_reserve_expense(
  pg_temp.fx('r1'),pg_temp.fx('account_eur'),pg_temp.fx('expense_cat'),100,pg_temp.hoje(),
  'Passagens Riga','00000000-0000-0000-0000-000000022711','Compra das passagens')),
  pg_temp.fx('rpc_alloc'),'reenvio idêntico retorna o ID do resgate original');
select is(pg_temp.sqlstate_of(format(
  'select * from public.record_reserve_expense(%L,%L,%L,101,%L,''Passagens Riga'',%L)',
  pg_temp.fx('r1'),pg_temp.fx('account_eur'),pg_temp.fx('expense_cat'),pg_temp.hoje(),
  '00000000-0000-0000-0000-000000022711')),'40900',
  'mesma chave com valor diferente gera conflito de idempotência');
select is(pg_temp.sqlstate_of(format(
  'select * from public.record_reserve_expense(%L,%L,%L,100,%L,''Outra reserva'',%L)',
  pg_temp.fx('r2'),pg_temp.fx('account_eur'),pg_temp.fx('expense_cat'),pg_temp.hoje(),
  '00000000-0000-0000-0000-000000022711')),'40900',
  'mesma chave em outra reserva gera conflito de idempotência');
select is(pg_temp.sqlstate_of(format(
  'select * from public.record_reserve_expense(%L,%L,%L,100,%L,''Outra conta'',%L)',
  pg_temp.fx('r1'),pg_temp.fx('account_brl'),pg_temp.fx('expense_cat'),pg_temp.hoje(),
  '00000000-0000-0000-0000-000000022711')),'40900',
  'mesma chave com conta diferente gera conflito de idempotência');
select is(pg_temp.sqlstate_of(format(
  'select * from public.record_reserve_expense(%L,%L,%L,100,%L,''Outra categoria'',%L)',
  pg_temp.fx('r1'),pg_temp.fx('account_eur'),pg_temp.fx('expense_cat_alt'),pg_temp.hoje(),
  '00000000-0000-0000-0000-000000022711')),'40900',
  'mesma chave com categoria diferente gera conflito de idempotência');
select is((select count(*) from public.transactions where household_id=pg_temp.fx('h1')),1::bigint,
  'reenvios e conflito não duplicam a despesa');
select is((select sum(amount) from public.reserve_allocations where reserve_id=pg_temp.fx('r1')),400::numeric,
  'resgate reduz saldo do envelope');
select is((select count(*) from public.transactions where household_id=pg_temp.fx('h1') and description='Passagens Riga'),1::bigint,
  'RPC registra uma despesa real');
select is((select count(*) from public.reserve_allocations a join public.transactions t
  on t.id=a.linked_transaction_id where a.reserve_id=pg_temp.fx('r1') and a.amount=-100 and t.amount=100),1::bigint,
  'resgate referencia exatamente a despesa real');

select is(pg_temp.sqlstate_of(format(
  'select * from public.record_reserve_expense(%L,%L,%L,1,%L,''Moeda errada'',%L)',
  pg_temp.fx('r1'),pg_temp.fx('account_brl'),pg_temp.fx('expense_cat'),pg_temp.hoje(),
  '00000000-0000-0000-0000-000000022712')),
  '23514','conta em moeda diferente é recusada');
select is((select count(*) from public.transactions where household_id=pg_temp.fx('h1')),1::bigint,
  'falha na moeda não deixa despesa parcial');

-- Falha ao criar a despesa: nenhuma alocação pode sobreviver.
select is(pg_temp.sqlstate_of(format(
  'select * from public.record_reserve_expense(%L,%L,%L,5,%L,''Conta inválida'',%L)',
  pg_temp.fx('r1'),'00000000-0000-0000-0000-000000000000',pg_temp.fx('expense_cat'),pg_temp.hoje(),
  '00000000-0000-0000-0000-000000022713')),'23503','conta inexistente impede a criação da despesa');
select is((select count(*) from public.reserve_allocations where reserve_id=pg_temp.fx('r1')),2::bigint,
  'falha na despesa não deixa resgate parcial');

-- Falha ao efetivar o resgate: a despesa inserida antes é revertida junto.
select is(pg_temp.sqlstate_of(format(
  'select * from public.record_reserve_expense(%L,%L,%L,401,%L,''Resgate acima do saldo'',%L)',
  pg_temp.fx('r1'),pg_temp.fx('account_eur'),pg_temp.fx('expense_cat'),pg_temp.hoje(),
  '00000000-0000-0000-0000-000000022714')),'23514','resgate acima do saldo aborta a RPC');
select is((select count(*) from public.transactions where household_id=pg_temp.fx('h1')),1::bigint,
  'falha no resgate reverte a despesa inserida antes');
select is((select count(*) from public.reserve_allocations where reserve_id=pg_temp.fx('r1')),2::bigint,
  'falha no resgate não deixa alocação parcial');

-- Isolamento do vínculo: despesa de outra família não pode ser usada no resgate.
select pg_temp.login('00000000-0000-0000-0000-000000022702');
insert into fixture select 'h2', public.create_household('Família B');
insert into public.accounts (household_id,name,type,initial_balance,opening_date,currency_code)
values (pg_temp.fx('h2'),'Conta B','checking',100,pg_temp.hoje()-30,'EUR') returning id;
insert into fixture select 'account_b', id from public.accounts
 where household_id=pg_temp.fx('h2') and name='Conta B';
insert into fixture select 'category_b', id from public.categories
 where household_id=pg_temp.fx('h2') and type='expense' and system_key='uncategorized';
insert into public.transactions (household_id,account_id,category_id,type,description,amount,date,status)
values (pg_temp.fx('h2'),pg_temp.fx('account_b'),pg_temp.fx('category_b'),'expense','Despesa B',1,pg_temp.hoje(),'paid')
returning id;
insert into fixture select 'tx_b', id from public.transactions
 where household_id=pg_temp.fx('h2') and description='Despesa B';
select pg_temp.login('00000000-0000-0000-0000-000000022701');
select is(pg_temp.sqlstate_of(format(
  'insert into public.reserve_allocations(household_id,reserve_id,amount,linked_transaction_id,idempotency_key) values (%L,%L,-1,%L,%L)',
  pg_temp.fx('h1'),pg_temp.fx('r1'),pg_temp.fx('tx_b'),'00000000-0000-0000-0000-000000022725')),'23514',
  'despesa de outro household não pode ser vinculada ao resgate');

-- Ledger append-only.
select is(pg_temp.sqlstate_of(format('update public.reserve_allocations set description=''editado'' where reserve_id=%L',pg_temp.fx('r1'))),
  '42501','UPDATE no ledger é recusado');
select is(pg_temp.sqlstate_of(format('delete from public.reserve_allocations where reserve_id=%L',pg_temp.fx('r1'))),
  '42501','DELETE no ledger é recusado');

-- Resgate explícito final zera o envelope; somente então pode arquivar.
insert into public.reserve_allocations(household_id,reserve_id,amount,description,idempotency_key)
values (pg_temp.fx('h1'),pg_temp.fx('r1'),-400,'Resgate final','00000000-0000-0000-0000-000000022726');
update public.reserves set status='archived' where id=pg_temp.fx('r1');
select is((select status from public.reserves where id=pg_temp.fx('r1')),'archived',
  'reserva zerada pode ser arquivada');
select is(pg_temp.sqlstate_of(format(
  'insert into public.reserve_allocations(household_id,reserve_id,amount,idempotency_key) values (%L,%L,-1,%L)',
  pg_temp.fx('h1'),pg_temp.fx('r1'),'00000000-0000-0000-0000-000000022727')),'23514','reserva arquivada não recebe alocação');
select is(pg_temp.sqlstate_of(format('update public.reserves set status=''active'' where id=%L',pg_temp.fx('r1'))),
  '55000','reserva arquivada não pode ser reaberta');

-- Isolamento entre famílias.
select pg_temp.login('00000000-0000-0000-0000-000000022702');
select is((select count(*) from public.reserves where household_id=pg_temp.fx('h1')),0::bigint,
  'outra família não enxerga reservas');
select is(pg_temp.sqlstate_of(format(
  'insert into public.reserve_allocations(household_id,reserve_id,amount,idempotency_key) values (%L,%L,10,%L)',
  pg_temp.fx('h1'),pg_temp.fx('r1'),'00000000-0000-0000-0000-000000022728')),'42501','outra família não aloca em reserva alheia');
select is(pg_temp.sqlstate_of(format(
  'select * from public.record_reserve_expense(%L,%L,%L,10,%L,''Tentativa'',%L)',
  pg_temp.fx('r1'),pg_temp.fx('account_eur'),pg_temp.fx('expense_cat'),pg_temp.hoje(),
  '00000000-0000-0000-0000-000000022715')),
  '42501','RPC não permite gastar reserva de outra família');

select * from finish();
rollback;
