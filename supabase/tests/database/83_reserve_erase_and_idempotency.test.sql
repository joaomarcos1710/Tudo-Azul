-- 83_reserve_erase_and_idempotency: zerar tudo e exclusão da família com reservas,
-- ledger append-only nas operações normais, rollback, isolamento entre famílias e
-- idempotência completa do record_reserve_expense (payload inteiro).
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
 ('00000000-0000-0000-0000-000000083001','erase-a@teste.com'),
 ('00000000-0000-0000-0000-000000083002','erase-b@teste.com'),
 ('00000000-0000-0000-0000-000000083003','erase-c@teste.com');

-- Família A (dona: usuário 1)
select pg_temp.login('00000000-0000-0000-0000-000000083001');
insert into fixture select 'h1', public.create_household('Família E1');
insert into public.accounts (household_id,name,type,initial_balance,opening_date,currency_code)
values (pg_temp.fx('h1'),'Conta BRL','checking',500,pg_temp.hoje()-30,'BRL');
insert into fixture select 'acc1', id from public.accounts where household_id=pg_temp.fx('h1') and name='Conta BRL';
insert into fixture select 'cat1', id from public.categories
 where household_id=pg_temp.fx('h1') and type='expense' and system_key='uncategorized';
insert into public.reserves (household_id,name,currency_code)
values (pg_temp.fx('h1'),'Viagem','BRL');
insert into fixture select 'res1', id from public.reserves where household_id=pg_temp.fx('h1') and name='Viagem';
insert into fixture select 'k_aporte', gen_random_uuid();
insert into fixture select 'k_despesa', gen_random_uuid();
insert into fixture select 'aporte_h1', public.record_reserve_allocation(pg_temp.fx('res1'), 200, pg_temp.hoje(), 'Aporte inicial', pg_temp.fx('k_aporte'));
insert into fixture select 'tx_h1', transaction_id from public.record_reserve_expense(
  pg_temp.fx('res1'), pg_temp.fx('acc1'), pg_temp.fx('cat1'), 100, pg_temp.hoje(), 'Passagens Riga', pg_temp.fx('k_despesa'), 'Compra das passagens');
insert into fixture select 'alloc_h1', allocation_id from public.record_reserve_expense(
  pg_temp.fx('res1'), pg_temp.fx('acc1'), pg_temp.fx('cat1'), 100, pg_temp.hoje(), 'Passagens Riga', pg_temp.fx('k_despesa'), 'Compra das passagens');

-- Família B (dona: usuário 2), com reserva e despesa próprias
select pg_temp.login('00000000-0000-0000-0000-000000083002');
insert into fixture select 'h2', public.create_household('Família E2');
insert into public.accounts (household_id,name,type,initial_balance,opening_date,currency_code)
values (pg_temp.fx('h2'),'Conta BRL','checking',500,pg_temp.hoje()-30,'BRL');
insert into fixture select 'acc2', id from public.accounts where household_id=pg_temp.fx('h2') and name='Conta BRL';
insert into fixture select 'cat2', id from public.categories
 where household_id=pg_temp.fx('h2') and type='expense' and system_key='uncategorized';
insert into public.reserves (household_id,name,currency_code)
values (pg_temp.fx('h2'),'Casa','BRL');
insert into fixture select 'res2', id from public.reserves where household_id=pg_temp.fx('h2') and name='Casa';
select public.record_reserve_allocation(pg_temp.fx('res2'), 300, pg_temp.hoje(), 'Aporte da casa', gen_random_uuid());
insert into fixture select 'tx_h2', transaction_id from public.record_reserve_expense(
  pg_temp.fx('res2'), pg_temp.fx('acc2'), pg_temp.fx('cat2'), 50, pg_temp.hoje(), 'Conta de luz', gen_random_uuid(), null);

-- 1) Idempotência: payload idêntico devolve os IDs originais
select pg_temp.login('00000000-0000-0000-0000-000000083001');
select is((select transaction_id from public.record_reserve_expense(
  pg_temp.fx('res1'), pg_temp.fx('acc1'), pg_temp.fx('cat1'), 100, pg_temp.hoje(), 'Passagens Riga', pg_temp.fx('k_despesa'), 'Compra das passagens')),
  pg_temp.fx('tx_h1'), 'reenvio idêntico devolve a despesa original');
select is((select allocation_id from public.record_reserve_expense(
  pg_temp.fx('res1'), pg_temp.fx('acc1'), pg_temp.fx('cat1'), 100, pg_temp.hoje(), 'Passagens Riga', pg_temp.fx('k_despesa'), 'Compra das passagens')),
  pg_temp.fx('alloc_h1'), 'reenvio idêntico devolve o resgate original');
select is(pg_temp.sqlstate_of(format('select * from public.record_reserve_expense(%L,%L,%L,100,%L,%L,%L,%L)',
  pg_temp.fx('res1'), pg_temp.fx('acc1'), pg_temp.fx('cat1'), pg_temp.hoje(), 'Descrição trocada', pg_temp.fx('k_despesa'), 'Compra das passagens')),
  '40900', 'mesma chave com descrição da despesa diferente é conflito');
select is(pg_temp.sqlstate_of(format('select * from public.record_reserve_expense(%L,%L,%L,100,%L,%L,%L,%L)',
  pg_temp.fx('res1'), pg_temp.fx('acc1'), pg_temp.fx('cat1'), pg_temp.hoje()-1, 'Passagens Riga', pg_temp.fx('k_despesa'), 'Compra das passagens')),
  '40900', 'mesma chave com data diferente é conflito');
select is(pg_temp.sqlstate_of(format('select * from public.record_reserve_expense(%L,%L,%L,100,%L,%L,%L,%L)',
  pg_temp.fx('res1'), pg_temp.fx('acc1'), pg_temp.fx('cat1'), pg_temp.hoje(), 'Passagens Riga', pg_temp.fx('k_despesa'), 'Outra descrição')),
  '40900', 'mesma chave com descrição do resgate diferente é conflito');
select is(pg_temp.sqlstate_of(format('select * from public.record_reserve_expense(%L,%L,%L,100,%L,%L,%L,%L)',
  pg_temp.fx('res1'), pg_temp.fx('acc1'), pg_temp.fx('cat1'), pg_temp.hoje(), 'Passagens Riga', pg_temp.fx('k_despesa'), null)),
  '40900', 'mesma chave com descrição do resgate nula (diferente da original) é conflito');
select is(pg_temp.sqlstate_of(format('select * from public.record_reserve_expense(%L,%L,%L,120,%L,%L,%L,%L)',
  pg_temp.fx('res1'), pg_temp.fx('acc1'), pg_temp.fx('cat1'), pg_temp.hoje(), 'Passagens Riga', pg_temp.fx('k_despesa'), 'Compra das passagens')),
  '40900', 'mesma chave com valor diferente é conflito');
select is(pg_temp.sqlstate_of(format('select * from public.record_reserve_expense(%L,%L,%L,100,%L,%L,%L,%L)',
  pg_temp.fx('res1'), pg_temp.fx('acc1'), pg_temp.fx('cat1'), pg_temp.hoje(), 'Passagens Riga', pg_temp.fx('k_aporte'), 'Compra das passagens')),
  '40900', 'chave de aporte manual reutilizada numa despesa é conflito (compatibilidade)');

-- 2) Ledger append-only nas operações normais
select is((select count(*)::int from public.reserve_allocations where id = pg_temp.fx('aporte_h1') and amount = 200), 1, 'aporte existe antes das tentativas de alteração');
select is(pg_temp.sqlstate_of(format('update public.reserve_allocations set amount = 999 where id = %L', pg_temp.fx('aporte_h1'))),
  '42501', 'UPDATE em aporte é negado (sem privilégio: ledger append-only)');
select is((select amount from public.reserve_allocations where id = pg_temp.fx('aporte_h1')), 200::numeric, 'aporte continua com o valor original');
select is(pg_temp.sqlstate_of(format('delete from public.reserve_allocations where id = %L', pg_temp.fx('aporte_h1'))),
  '42501', 'DELETE em aporte é negado (sem privilégio: ledger append-only)');
select is((select count(*)::int from public.reserve_allocations where id = pg_temp.fx('aporte_h1')), 1, 'aporte continua existindo');
select is(pg_temp.sqlstate_of(format('delete from public.transactions where id = %L', pg_temp.fx('tx_h1'))),
  '42501', 'despesa vinculada não pode ser excluída pelo usuário (sem privilégio de DELETE direto)');
select is(pg_temp.sqlstate_of(format('update public.transactions set deleted_at = now() where id = %L', pg_temp.fx('tx_h1'))),
  '23514', 'despesa vinculada não vai para a lixeira');
select is(pg_temp.sqlstate_of(format('update public.transactions set amount = 1 where id = %L', pg_temp.fx('tx_h1'))),
  '23514', 'valor da despesa vinculada não muda');

-- 3) Isolamento: B não vê nem zera a família A
select pg_temp.login('00000000-0000-0000-0000-000000083002');
select is(public.reset_preview(pg_temp.fx('h1')), null::jsonb, 'prévia de outra família não vaza');
select is(pg_temp.sqlstate_of(format('select public.reset_household(%L,%L)', pg_temp.fx('h1'), 'zerar tudo')),
  '42501', 'não-dono não zera a família alheia');

-- 4) Zerar tudo: frase errada, prévia, rollback e execução
select pg_temp.login('00000000-0000-0000-0000-000000083001');
select is(pg_temp.sqlstate_of(format('select public.reset_household(%L,%L)', pg_temp.fx('h1'), 'zerar')),
  '22023', 'frase incorreta é recusada');
select is((public.reset_preview(pg_temp.fx('h1'))->>'reserves')::int, 1, 'prévia conta a reserva');
select is((public.reset_preview(pg_temp.fx('h1'))->>'reserve_allocations')::int, 2, 'prévia conta os aportes e resgates');

savepoint antes_do_zerar;
select public.reset_household(pg_temp.fx('h1'), 'zerar tudo');
select is((select count(*)::int from public.reserves where household_id = pg_temp.fx('h1')), 0, 'dentro da transação: reservas zeradas');
rollback to savepoint antes_do_zerar;
select is((select count(*)::int from public.reserves where household_id = pg_temp.fx('h1')), 1, 'rollback do savepoint desfaz o zerar tudo (reservas voltam)');
select is((select count(*)::int from public.transactions where household_id = pg_temp.fx('h1')), 1, 'rollback do savepoint desfaz o zerar tudo (despesas voltam)');

select is((public.reset_household(pg_temp.fx('h1'), 'zerar tudo')->>'reserves')::int, 1, 'zerar tudo devolve a contagem de reservas');
select is((public.reset_household(pg_temp.fx('h1'), 'zerar tudo')->>'reserve_allocations')::int, 0, 'segundo zerar (família vazia) não conta nada');
select is((select count(*)::int from public.reserves where household_id = pg_temp.fx('h1')), 0, 'zerar tudo apaga as reservas');
select is((select count(*)::int from public.reserve_allocations where household_id = pg_temp.fx('h1')), 0, 'zerar tudo apaga os aportes e resgates');
select is((select count(*)::int from public.transactions where household_id = pg_temp.fx('h1')), 0, 'zerar tudo apaga a despesa vinculada');
select is(current_setting('app.reserve_erase', true), '', 'liberação de exclusão volta a vazia após o zerar');

-- família B intacta
select pg_temp.login('00000000-0000-0000-0000-000000083002');
select is((select count(*)::int from public.reserves where household_id = pg_temp.fx('h2')), 1, 'zerar tudo de A não toca a reserva de B');
select is((select count(*)::int from public.reserve_allocations where household_id = pg_temp.fx('h2')), 2, 'zerar tudo de A não toca os aportes e resgates de B');
select is((select count(*)::int from public.transactions where household_id = pg_temp.fx('h2')), 1, 'zerar tudo de A não toca a despesa de B');

-- 5) Excluir a família: usuário C, família só dele, com reserva e despesa vinculada
select pg_temp.login('00000000-0000-0000-0000-000000083003');
insert into fixture select 'h3', public.create_household('Família E3');
insert into public.accounts (household_id,name,type,initial_balance,opening_date,currency_code)
values (pg_temp.fx('h3'),'Conta BRL','checking',500,pg_temp.hoje()-30,'BRL');
insert into fixture select 'acc3', id from public.accounts where household_id=pg_temp.fx('h3') and name='Conta BRL';
insert into fixture select 'cat3', id from public.categories
 where household_id=pg_temp.fx('h3') and type='expense' and system_key='uncategorized';
insert into public.reserves (household_id,name,currency_code)
values (pg_temp.fx('h3'),'Reforma','BRL');
insert into fixture select 'res3', id from public.reserves where household_id=pg_temp.fx('h3') and name='Reforma';
select public.record_reserve_allocation(pg_temp.fx('res3'), 100, pg_temp.hoje(), 'Aporte da reforma', gen_random_uuid());
insert into fixture select 'tx_h3', transaction_id from public.record_reserve_expense(
  pg_temp.fx('res3'), pg_temp.fx('acc3'), pg_temp.fx('cat3'), 70, pg_temp.hoje(), 'Tinta', gen_random_uuid(), 'Tinta da sala');
select is(pg_temp.sqlstate_of('select public.delete_household()'), null, 'dono exclui a própria família com reservas e despesa vinculada');
select is((select count(*)::int from public.households where id = pg_temp.fx('h3')), 0, 'família excluída some');
select is((select count(*)::int from public.reserves where household_id = pg_temp.fx('h3')), 0, 'exclusão da família apaga as reservas');
select is((select count(*)::int from public.reserve_allocations where household_id = pg_temp.fx('h3')), 0, 'exclusão da família apaga o ledger');
select is((select count(*)::int from public.transactions where household_id = pg_temp.fx('h3')), 0, 'exclusão da família apaga a despesa vinculada');
select is(current_setting('app.reserve_erase', true), '', 'liberação de exclusão volta a vazia após excluir a família');
select pg_temp.login('00000000-0000-0000-0000-000000083002');
select is((select count(*)::int from public.reserves where household_id = pg_temp.fx('h2')), 1, 'excluir a família de C não toca a de B');

select * from finish();
rollback;
