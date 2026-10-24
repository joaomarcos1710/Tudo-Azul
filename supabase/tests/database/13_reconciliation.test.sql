-- 13_reconciliation: migration 007. Conciliação com o extrato: só fecha com diferença zero, marca os
-- lançamentos pagos até a data, TRAVA o período conciliado (lançamentos, eventos de dívida, saldo
-- inicial e abertura), desfaz pela última conciliação e isola famílias.
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
create function pg_temp.saldo(p_acc uuid, p_d date) returns numeric language sql as $f$
  select balance from public.account_balances(pg_temp.fx('h'), p_d) where account_id = p_acc $f$;
create function pg_temp.soma_mov(p_acc uuid, p_d date) returns numeric language sql as $f$
  select sum(amount) from public.account_movements(p_acc, p_d) $f$;
grant execute on function pg_temp.fx(text), pg_temp.sqlstate_of(text), pg_temp.msg_of(text),
  pg_temp.saldo(uuid, date), pg_temp.soma_mov(uuid, date) to public;

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
-- cartão com dívida inicial paga pela conta (pagamento de fatura mexe no saldo sem ser lançamento)
insert into fixture select 'card', public.create_debt('Nubank', 'card', '2026-09-30', 300.00);

with i as (insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status)
           values (pg_temp.fx('h'), pg_temp.fx('itau'), pg_temp.fx('cexp'), 'expense', 'Mercado', 250.40, '2026-10-05', 'paid') returning id)
  insert into fixture select 'mercado', id from i;
insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status)
values (pg_temp.fx('h'), pg_temp.fx('itau'), pg_temp.fx('cinc'), 'income', 'Salário', 5000.00, '2026-10-06', 'paid');
insert into public.transactions (household_id, account_id, destination_account_id, type, description, amount, date, status)
values (pg_temp.fx('h'), pg_temp.fx('itau'), pg_temp.fx('poup'), 'transfer', 'Guardar', 500.00, '2026-10-07', 'paid');
insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status)
values (pg_temp.fx('h'), pg_temp.fx('itau'), pg_temp.fx('cexp'), 'expense', 'Luz', 180.00, '2026-10-08', 'planned');
insert into fixture select 'pgto', public.debt_pay(pg_temp.fx('card'), '2026-10-09', pg_temp.fx('itau'), 300.00);
with i as (insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status)
           values (pg_temp.fx('h'), pg_temp.fx('itau'), pg_temp.fx('cexp'), 'expense', 'Farmácia', 30.00, '2026-10-12', 'paid') returning id)
  insert into fixture select 'farmacia', id from i;

-- CC1: movimentos com sinal; saldo inicial + movimentos = saldo do app (mesma conta da tela)
select is((select array_agg(description || '|' || amount order by date, source) from public.account_movements(pg_temp.fx('itau'), '2026-10-10')),
          array['Saldo inicial|1000.00', 'Mercado|-250.40', 'Salário|5000.00', 'Guardar|-500.00', 'Pagamento de Nubank|-300.00'],
          'CC1 até 10/10: saldo inicial, mercado −, salário +, transferência −, pagamento de fatura −; planejado e futuro fora');
select is(pg_temp.soma_mov(pg_temp.fx('itau'), '2026-10-10'), pg_temp.saldo(pg_temp.fx('itau'), '2026-10-10'),
          'CC1 soma dos movimentos = account_balances (Itaú)');
select is(pg_temp.soma_mov(pg_temp.fx('poup'), '2026-10-10'), pg_temp.saldo(pg_temp.fx('poup'), '2026-10-10'),
          'CC1 soma dos movimentos = account_balances (poupança, transferência entrando)');

-- CC2: diferença diferente de zero é recusada, com a diferença na mensagem; data futura também
select is(pg_temp.sqlstate_of($$select public.reconcile_account(pg_temp.fx('itau'), '2026-10-10', 4949.00)$$),
          '23514', 'CC2 extrato 4.949,00 x app 4.949,60: recusado');
select matches(pg_temp.msg_of($$select public.reconcile_account(pg_temp.fx('itau'), '2026-10-10', 4949.00)$$),
          'diferença de -0.60', 'CC2 a mensagem mostra a diferença');
select is(pg_temp.sqlstate_of($$select public.reconcile_account(pg_temp.fx('itau'), '2099-01-01', 4949.60)$$),
          '22023', 'CC2 data futura: recusada');
select is(pg_temp.sqlstate_of($$select public.reconcile_account(pg_temp.fx('itau'), '2026-09-30', 1000.00)$$),
          '22023', 'CC2 antes da abertura: recusada');

-- CC3: saldo batendo fecha a conciliação e marca só os pagos até a data
select ok(public.reconcile_account(pg_temp.fx('itau'), '2026-10-10', 4949.60) is not null, 'CC3 extrato = app: conciliado');
select is((select array_agg(description order by date) from public.transactions where reconciliation_id is not null),
          array['Mercado', 'Salário', 'Guardar'], 'CC3 conferidos: os 3 lançamentos pagos até 10/10');
select is((select transactions from public.account_reconciliations where account_id = pg_temp.fx('itau')), 3,
          'CC3 histórico guarda quantos foram conferidos');
select is((select array_agg(source || '|' || reconciled order by date, source) from public.account_movements(pg_temp.fx('itau'), '2026-10-31')),
          array['opening|true', 'transaction|true', 'transaction|true', 'transaction|true', 'debt|true', 'transaction|false'],
          'CC3 no período tudo conferido (inclusive o pagamento de fatura); a farmácia de 12/10 não');
select is(pg_temp.sqlstate_of($$select public.reconcile_account(pg_temp.fx('itau'), '2026-10-10', 4949.60)$$),
          '22023', 'CC3 conciliar de novo a mesma data (ou anterior): recusado');

-- CC4: período travado — nada que mude o saldo até 10/10
select is(pg_temp.sqlstate_of($$update public.transactions set amount = 260.00 where id = pg_temp.fx('mercado')$$),
          '55000', 'CC4 mudar valor no período: recusado');
select is(pg_temp.sqlstate_of($$update public.transactions set date = '2026-10-11' where id = pg_temp.fx('mercado')$$),
          '55000', 'CC4 mover para fora do período: recusado');
select is(pg_temp.sqlstate_of($$update public.transactions set status = 'planned' where id = pg_temp.fx('mercado')$$),
          '55000', 'CC4 voltar para planejado: recusado');
select is(pg_temp.sqlstate_of($$update public.transactions set deleted_at = now() where id = pg_temp.fx('mercado')$$),
          '55000', 'CC4 lixeira: recusado');
select is(pg_temp.sqlstate_of($$update public.transactions set date = '2026-10-09' where id = pg_temp.fx('farmacia')$$),
          '55000', 'CC4 trazer lançamento de fora para dentro do período: recusado');
select is(pg_temp.sqlstate_of($$insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status)
          values (pg_temp.fx('h'), pg_temp.fx('itau'), pg_temp.fx('cexp'), 'expense', 'Esquecido', 10.00, '2026-10-03', 'paid')$$),
          '55000', 'CC4 lançamento pago retroativo: recusado');
select is(pg_temp.sqlstate_of($$update public.transactions set status = 'paid' where description = 'Luz'$$),
          '55000', 'CC4 marcar como pago um planejado do período: recusado');
select is(pg_temp.sqlstate_of($$select public.debt_void(pg_temp.fx('pgto'), 'teste de trava')$$),
          '55000', 'CC4 anular pagamento de fatura no período: recusado');
select is(pg_temp.sqlstate_of($$select public.debt_pay(pg_temp.fx('card'), '2026-10-08', pg_temp.fx('itau'), 1.00)$$),
          '55000', 'CC4 pagamento de fatura retroativo: recusado');
select is(pg_temp.sqlstate_of($$update public.accounts set initial_balance = 1100.00 where id = pg_temp.fx('itau')$$),
          '55000', 'CC4 saldo inicial da conta conciliada: recusado');
select is(pg_temp.sqlstate_of($$update public.accounts set opening_date = '2026-10-06' where id = pg_temp.fx('itau')$$),
          '55000', 'CC4 abertura da conta conciliada: recusada');
select is(pg_temp.sqlstate_of($$update public.transactions set amount = 600.00 where description = 'Guardar'$$),
          '55000', 'CC4 transferência conferida (lado do destino também protegido)');
select lives_ok($$update public.transactions set description = 'Mercado do mês' where id = pg_temp.fx('mercado')$$,
          'CC4 descrição pode mudar');
select lives_ok($$update public.transactions set amount = 35.00 where id = pg_temp.fx('farmacia')$$,
          'CC4 fora do período: edita normal');
select is(pg_temp.saldo(pg_temp.fx('itau'), '2026-10-10'), 4949.60, 'CC4 saldo conciliado intacto');

-- CC5: desfazer a última conciliação destrava e tira as marcas
select is(public.reconciliation_undo(pg_temp.fx('itau')), null::date, 'CC5 desfeita: nenhuma conciliação restante');
select is((select count(*) from public.transactions where reconciliation_id is not null), 0::bigint, 'CC5 marcas removidas');
select lives_ok($$update public.transactions set amount = 260.00 where id = pg_temp.fx('mercado')$$, 'CC5 agora edita');
select is(pg_temp.sqlstate_of($$select public.reconciliation_undo(pg_temp.fx('itau'))$$), '55000', 'CC5 nada mais para desfazer');

-- CC6: cliente não forja a marca nem o histórico
select is(pg_temp.sqlstate_of($$update public.transactions set reconciliation_id = null where id = pg_temp.fx('farmacia')$$),
          '42501', 'CC6 UPDATE direto da marca: sem privilégio');
select is(pg_temp.sqlstate_of($$insert into public.account_reconciliations (household_id, account_id, as_of, statement_balance)
          values (pg_temp.fx('h'), pg_temp.fx('itau'), '2026-10-31', 0)$$),
          '42501', 'CC6 INSERT direto no histórico: sem privilégio');

-- CC7: conta desativada também pode ser conciliada
update public.accounts set active = false where id = pg_temp.fx('poup');
select ok(public.reconcile_account(pg_temp.fx('poup'), '2026-10-10', 500.00) is not null, 'CC7 poupança desativada conciliada');

-- CC8: isolamento
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000013a2');
select public.create_household('Outra');
select is(pg_temp.sqlstate_of($$select public.reconcile_account(pg_temp.fx('itau'), '2026-10-10', 4949.60)$$),
          '42501', 'CC8 outra família não concilia a conta alheia');
select is(pg_temp.sqlstate_of($$select public.reconciliation_undo(pg_temp.fx('poup'))$$),
          '42501', 'CC8 nem desfaz conciliação alheia');
select is((select count(*) from public.account_movements(pg_temp.fx('itau'), '2026-10-31')), 0::bigint,
          'CC8 nem vê os movimentos');
select is((select count(*) from public.account_reconciliations), 0::bigint, 'CC8 nem o histórico');

select * from finish();
rollback;
