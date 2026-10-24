-- 13_reconciliation: migration 007. Conciliação com o extrato: só fecha com diferença zero, marca os
-- lançamentos pagos até a data, protege o conferido e isola famílias.
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
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
create function pg_temp.msg_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlerrm; end $f$;
grant execute on function pg_temp.fx(text), pg_temp.sqlstate_of(text), pg_temp.msg_of(text) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000013a1', 'cc1@teste.com'),
  ('00000000-0000-0000-0000-0000000013a2', 'cc2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000013a1');
insert into fixture select 'h', public.create_household('Casa Conferida');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Itaú', 'checking', 1000.00, '2026-10-01') returning id)
  insert into fixture select 'itau', id from i;
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Poupança', 'savings', 0, '2026-10-01') returning id)
  insert into fixture select 'poup', id from i;
insert into fixture select 'cexp', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';
insert into fixture select 'cinc', id from public.categories where household_id = pg_temp.fx('h') and type = 'income' and system_key is null limit 1;

with i as (insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status)
           values (pg_temp.fx('h'), pg_temp.fx('itau'), pg_temp.fx('cexp'), 'expense', 'Mercado', 250.40, '2026-10-05', 'paid') returning id)
  insert into fixture select 'mercado', id from i;
insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status)
values (pg_temp.fx('h'), pg_temp.fx('itau'), pg_temp.fx('cinc'), 'income', 'Salário', 5000.00, '2026-10-06', 'paid');
insert into public.transactions (household_id, account_id, destination_account_id, type, description, amount, date, status)
values (pg_temp.fx('h'), pg_temp.fx('itau'), pg_temp.fx('poup'), 'transfer', 'Guardar', 500.00, '2026-10-07', 'paid');
-- planejado e futuro não entram
insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status)
values (pg_temp.fx('h'), pg_temp.fx('itau'), pg_temp.fx('cexp'), 'expense', 'Luz', 180.00, '2026-10-08', 'planned');
with i as (insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status)
           values (pg_temp.fx('h'), pg_temp.fx('itau'), pg_temp.fx('cexp'), 'expense', 'Farmácia', 30.00, '2026-10-20', 'paid') returning id)
  insert into fixture select 'farmacia', id from i;

-- CC1: movimentos com sinal do ponto de vista da conta
select is((select array_agg(description || '|' || amount order by date) from public.account_movements(pg_temp.fx('itau'), '2026-10-10')),
          array['Mercado|-250.40', 'Salário|5000.00', 'Guardar|-500.00'],
          'CC1 até 10/10: mercado −, salário +, transferência saindo −; planejado e futuro fora');
select is((select amount from public.account_movements(pg_temp.fx('poup'), '2026-10-10') where description = 'Guardar'),
          500.00, 'CC1 a mesma transferência entra positiva na poupança');

-- CC2: diferença diferente de zero é recusada, com a diferença na mensagem
select is(pg_temp.sqlstate_of($$select public.reconcile_account(pg_temp.fx('itau'), '2026-10-10', 5249.00)$$),
          '23514', 'CC2 extrato 5.249,00 x app 5.249,60: recusado');
select matches(pg_temp.msg_of($$select public.reconcile_account(pg_temp.fx('itau'), '2026-10-10', 5249.00)$$),
          'diferença de -0.60', 'CC2 a mensagem mostra a diferença');
select is((select count(*) from public.transactions where reconciled_at is not null), 0::bigint, 'CC2 nada marcado');

-- CC3: saldo batendo fecha a conciliação e marca só os pagos até a data
select ok(public.reconcile_account(pg_temp.fx('itau'), '2026-10-10', 5249.60) is not null, 'CC3 extrato = app: conciliado');
select is((select array_agg(description order by date) from public.transactions where reconciled_at is not null),
          array['Mercado', 'Salário', 'Guardar'], 'CC3 conferidos: os 3 pagos até 10/10');
select is((select transactions from public.account_reconciliations where account_id = pg_temp.fx('itau')), 3,
          'CC3 histórico guarda quantos foram conferidos');

-- CC4: conferido não muda valor nem vai para a lixeira; descrição pode
select is(pg_temp.sqlstate_of($$update public.transactions set amount = 260.00 where id = pg_temp.fx('mercado')$$),
          '55000', 'CC4 mudar valor de conferido: recusado');
select is(pg_temp.sqlstate_of($$update public.transactions set deleted_at = now() where id = pg_temp.fx('mercado')$$),
          '55000', 'CC4 lixeira de conferido: recusado');
select lives_ok($$update public.transactions set description = 'Mercado do mês' where id = pg_temp.fx('mercado')$$,
          'CC4 descrição de conferido pode mudar');

-- CC5: desfazer a conferência libera a edição
select lives_ok($$select public.unreconcile_transaction(pg_temp.fx('mercado'))$$, 'CC5 desfaz a conferência');
select lives_ok($$update public.transactions set amount = 260.00 where id = pg_temp.fx('mercado')$$, 'CC5 agora edita');

-- CC6: cliente não marca conferido direto
select is(pg_temp.sqlstate_of($$update public.transactions set reconciled_at = now() where id = pg_temp.fx('farmacia')$$),
          '42501', 'CC6 UPDATE direto de reconciled_at: sem privilégio');

-- CC7: data antes da abertura é recusada
select is(pg_temp.sqlstate_of($$select public.reconcile_account(pg_temp.fx('itau'), '2026-09-30', 1000.00)$$),
          '22023', 'CC7 antes da abertura: recusado');

-- CC8: isolamento
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000013a2');
select public.create_household('Outra');
select is(pg_temp.sqlstate_of($$select public.reconcile_account(pg_temp.fx('itau'), '2026-10-10', 5249.60)$$),
          '42501', 'CC8 outra família não concilia a conta alheia');
select is(pg_temp.sqlstate_of($$select public.unreconcile_transaction(pg_temp.fx('farmacia'))$$),
          '42501', 'CC8 nem desfaz conferência alheia');
select is((select count(*) from public.account_movements(pg_temp.fx('itau'), '2026-10-31')), 0::bigint,
          'CC8 nem vê os movimentos');
select is((select count(*) from public.account_reconciliations), 0::bigint, 'CC8 nem o histórico');

select * from finish();
rollback;
