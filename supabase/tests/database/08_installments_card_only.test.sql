-- 08_installments_card_only: migration 003. Parcelas só em cartão; empréstimo e financiamento
-- recusados em todos os caminhos, sem resíduo e sem dupla contagem do principal.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ---- auxiliares de teste (temporários; somem no rollback) ----
create temp table fixture (k text primary key, v uuid);
grant all on fixture to public;
create function pg_temp.fx(p_k text) returns uuid language sql as $f$ select v from fixture where k = p_k $f$;
create function pg_temp.login(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $f$;
create function pg_temp.login_anon() returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
end $f$;
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
create function pg_temp.msg_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate || ' ' || sqlerrm; end $f$;
create function pg_temp.n_inst(p_debt uuid) returns bigint language sql as $f$
  select count(*) from public.debt_installments where debt_id = p_debt $f$;
create function pg_temp.nw(p_d date) returns numeric[] language sql as $f$
  select array[available, debt, credit_receivable, net_worth, planned_commitments]
    from public.net_worth(pg_temp.fx('h'), p_d) $f$;
grant execute on function pg_temp.fx(text), pg_temp.sqlstate_of(text), pg_temp.msg_of(text),
  pg_temp.n_inst(uuid), pg_temp.nw(date) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000008a1', 'p1@teste.com'),
  ('00000000-0000-0000-0000-0000000008a2', 'p2@teste.com');

-- ---- cenário: família 1 com banco, cartão, empréstimo e financiamento ----
select pg_temp.login('00000000-0000-0000-0000-0000000008a1');
insert into fixture select 'h', public.create_household('Casa Parcelas');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 0, '2026-11-01') returning id)
  insert into fixture select 'bank', id from i;
insert into fixture select 'cmerc', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';
insert into fixture select 'cfee',  id from public.categories where household_id = pg_temp.fx('h') and name = 'Impostos e taxas';
insert into fixture select 'card', public.create_debt('Cartão', 'card', '2026-11-01', 0);
insert into fixture select 'loan', public.create_debt('Empréstimo', 'loan', '2026-11-01', 0);
insert into fixture select 'fin',  public.create_debt('Financiamento', 'financing', '2026-11-01', 3000.00);
select public.debt_loan_event(pg_temp.fx('loan'), '2026-11-05', 'disbursement', pg_temp.fx('bank'), 10000.00);

-- P1: cartão continua aceitando parcelas, e o ciclo de cobrança segue igual
select is(public.create_debt_installments(pg_temp.fx('card'), 'compra', '2026-11-10', 3, 100.00, pg_temp.fx('cmerc')),
          3, 'P1 cartão: 3 parcelas criadas');
select is(pg_temp.n_inst(pg_temp.fx('card')), 3::bigint, 'P1 cartão: 3 parcelas gravadas');
select ok(public.debt_bill((select id from public.debt_installments where debt_id = pg_temp.fx('card') and seq = 1), '2026-11-10') is not null,
          'P1 cartão: cobrança da 1ª parcela continua funcionando');
select is((select array[debt, planned_remaining] from public.debt_balances(pg_temp.fx('h'), '2026-11-30') where name = 'Cartão'),
          array[100.00, 200.00]::numeric[], 'P1 cartão: cobrada sai do compromisso e entra na dívida (100 + 200, sem dupla contagem)');

-- P2: empréstimo recusado, com mensagem clara
select is(pg_temp.sqlstate_of($$select public.create_debt_installments(pg_temp.fx('loan'), 'x', '2026-12-05', 10, 1000.00, pg_temp.fx('cfee'))$$),
          '23514', 'P2 parcelas em empréstimo: recusado (23514)');
select matches(pg_temp.msg_of($$select public.create_debt_installments(pg_temp.fx('loan'), 'x', '2026-12-05', 10, 1000.00, pg_temp.fx('cfee'))$$),
          'parcelas só existem em cartão', 'P2 mensagem explica a regra');

-- P3: financiamento recusado
select is(pg_temp.sqlstate_of($$select public.create_debt_installments(pg_temp.fx('fin'), 'x', '2026-12-05', 1, 500.00, pg_temp.fx('cfee'))$$),
          '23514', 'P3 parcelas em financiamento: recusado (23514)');

-- P4: nenhuma gravação residual das tentativas recusadas (inclusive a de 10 parcelas)
select is(pg_temp.n_inst(pg_temp.fx('loan')), 0::bigint, 'P4 empréstimo: nenhuma parcela gravada');
select is(pg_temp.n_inst(pg_temp.fx('fin')),  0::bigint, 'P4 financiamento: nenhuma parcela gravada');
select is((select count(*) from public.debt_events where debt_id in (pg_temp.fx('loan'), pg_temp.fx('fin'))),
          1::bigint, 'P4 nenhum evento novo além do desembolso');

-- P5: caminhos alternativos também fechados
select is(pg_temp.sqlstate_of($$insert into public.debt_installments (household_id, debt_id, plan, seq, due_date, face, category_id)
          values (pg_temp.fx('h'), pg_temp.fx('loan'), 'x', 1, '2026-12-05', 1000.00, pg_temp.fx('cfee'))$$),
          '42501', 'P5 INSERT direto pelo cliente: sem privilégio');
select is(pg_temp.sqlstate_of($$update public.debts set kind = 'card' where id = pg_temp.fx('loan')$$),
          '42501', 'P5 cliente não troca o tipo da dívida');
reset role;
-- mesmo com privilégio total (superusuário / service_role), o trigger recusa
select is(pg_temp.sqlstate_of($$insert into public.debt_installments (household_id, debt_id, plan, seq, due_date, face, category_id)
          values (pg_temp.fx('h'), pg_temp.fx('loan'), 'x', 1, '2026-12-05', 1000.00, pg_temp.fx('cfee'))$$),
          '23514', 'P5 INSERT direto privilegiado em empréstimo: recusado pelo trigger');
select is(pg_temp.sqlstate_of($$insert into public.debt_installments (household_id, debt_id, plan, seq, due_date, face, category_id)
          values (pg_temp.fx('h'), pg_temp.fx('fin'), 'x', 1, '2026-12-05', 500.00, pg_temp.fx('cfee'))$$),
          '23514', 'P5 INSERT direto privilegiado em financiamento: recusado pelo trigger');
select is(pg_temp.sqlstate_of($$update public.debts set kind = 'card' where id = pg_temp.fx('loan')$$),
          '42501', 'P5 tipo da dívida imutável mesmo para privilegiado (debts_immutable)');
select lives_ok($$insert into public.debt_installments (household_id, debt_id, plan, seq, due_date, face, category_id)
          values (pg_temp.fx('h'), pg_temp.fx('card'), 'direto', 1, '2026-12-10', 50.00, pg_temp.fx('cmerc'))$$,
          'P5 trigger não bloqueia cartão');
select is(pg_temp.n_inst(pg_temp.fx('loan')), 0::bigint, 'P5 empréstimo continua sem parcelas');
select ok(not has_function_privilege('authenticated', 'private.debt_installments_card_only()', 'EXECUTE'),
          'P5 função do trigger não é executável pelo cliente');

-- P6: outra família e anon continuam recusados (42501), antes da regra de tipo
select pg_temp.login('00000000-0000-0000-0000-0000000008a2');
insert into fixture select 'h2', public.create_household('Casa Vizinha');
select is(pg_temp.sqlstate_of($$select public.create_debt_installments(pg_temp.fx('card'), 'y', '2026-12-10', 1, 10.00, pg_temp.fx('cmerc'))$$),
          '42501', 'P6 parcelas no cartão de outra família: recusado');
select is(pg_temp.sqlstate_of($$select public.create_debt_installments(pg_temp.fx('loan'), 'y', '2026-12-10', 1, 10.00, pg_temp.fx('cfee'))$$),
          '42501', 'P6 parcelas no empréstimo de outra família: 42501 (não revela o tipo)');
reset role;
select pg_temp.login_anon();
select is(pg_temp.sqlstate_of($$select public.create_debt_installments(pg_temp.fx('card'), 'y', '2026-12-10', 1, 10.00, pg_temp.fx('cmerc'))$$),
          '42501', 'P6 anon: recusado');
reset role;

-- P7: pagamento de empréstimo via debt_pay segue funcionando
select pg_temp.login('00000000-0000-0000-0000-0000000008a1');
select ok(public.debt_pay(pg_temp.fx('loan'), '2026-12-05', pg_temp.fx('bank'), 2000.00) is not null, 'P7 debt_pay no empréstimo funciona');
select is((select array[debt, planned_remaining] from public.debt_balances(pg_temp.fx('h'), '2026-12-31') where name = 'Empréstimo'),
          array[8000.00, 0]::numeric[], 'P7 empréstimo: dívida 8.000 e nenhum compromisso');

-- P8: patrimônio sem dupla contagem do principal
-- disponível 10.000 − 2.000 = 8.000; dívida = cartão 100 + empréstimo 8.000 + financiamento 3.000 = 11.100;
-- compromissos = só as parcelas de cartão não cobradas (200 + 50 da inserção direta) = 250.
select is(pg_temp.nw('2026-12-31'), array[8000.00, 11100.00, 0, -3100.00, 250.00]::numeric[],
          'P8 net_worth: principal do empréstimo contado uma vez; compromissos só do cartão');

select * from finish();
rollback;
