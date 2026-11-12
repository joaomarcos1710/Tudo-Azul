-- 105_card_purchase_person: trocar "de quem foi a despesa" de uma compra de cartão já lançada
-- (public.card_purchase_set_person). Vale para todas as parcelas da compra, inclusive as já cobradas e as de fatura paga e
-- travada (064); só person_id/is_shared_expense mudam (card_months, saldo, period_summary iguais antes e depois);
-- Relatórios › Gastos por pessoa (monthly_expenses_by_person) reflete a troca. Datas fixas (hoje real >= 12/11/2026).
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
-- tudo o que é dinheiro/fatura: card_months inteiro + saldo da dívida + resumo do período
create function pg_temp.dinheiro(p_card uuid) returns text language sql as $f$
  select coalesce((select string_agg(label || ':' || charged::numeric(14,2) || '/' || pending::numeric(14,2) || '/' || total::numeric(14,2)
                                     || '/' || paid::numeric(14,2) || '/' || items, ',' order by label)
                     from public.card_months(p_card)), '-')
         || '|' || (select debt::numeric(14,2) || '/' || credit_receivable::numeric(14,2) || '/' || planned_remaining::numeric(14,2) from public.debt_balances(pg_temp.fx('h'), '2026-12-31') where debt_id = p_card)
         || '|' || (select expense_paid::numeric(14,2) from public.period_summary(pg_temp.fx('h'), '2026-08-01', '2026-10-31')) $f$;
-- foto das parcelas da compra, tudo menos a classificação
create function pg_temp.foto(p_plan uuid) returns text language sql as $f$
  select coalesce(string_agg(i.seq || '|' || i.due_date || '|' || i.face || '|' || i.category_id || '|' || coalesce(i.description, '-'),
                             ';' order by i.seq), '-')
    from public.debt_installments i where i.plan = p_plan::text $f$;
create function pg_temp.pessoas(p_plan uuid) returns text language sql as $f$
  select coalesce(string_agg(coalesce(i.person_id::text, 'null') || '/' || i.is_shared_expense, ',' order by i.seq), '-')
    from public.debt_installments i where i.plan = p_plan::text $f$;
create function pg_temp.por_pessoa(p_person uuid, p_shared boolean) returns numeric language sql as $f$
  select coalesce(sum(total_spent), 0) from public.monthly_expenses_by_person(pg_temp.fx('h'), '2026-08-01', '2026-10-31')
   where person_id is not distinct from p_person and is_shared_expense = p_shared $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.sqlstate_of(text), pg_temp.msg_of(text), pg_temp.dinheiro(uuid),
  pg_temp.foto(uuid), pg_temp.pessoas(uuid), pg_temp.por_pessoa(uuid, boolean) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000105', 'p1@teste.com'),
  ('00000000-0000-0000-0000-000000000106', 'p2@teste.com');

-- Família 1: cartão A fecha 17, vence 25. Compra X (300,00 em 3x, 05/08: ago/set/out) e Y (100,00, 05/09).
select pg_temp.login('00000000-0000-0000-0000-000000000105');
insert into fixture select 'h', public.create_household('Casa dos gastos');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 5000.00, '2026-01-01') returning id)
  insert into fixture select 'bank', id from i;
insert into fixture select 'exp', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';
with p as (insert into public.household_people (household_id, name, relationship) values (pg_temp.fx('h'), 'Ana', 'Familiar') returning id)
  insert into fixture select 'ana', id from p;
with p as (insert into public.household_people (household_id, name, relationship) values (pg_temp.fx('h'), 'Beto', 'Familiar') returning id)
  insert into fixture select 'beto', id from p;
with p as (insert into public.household_people (household_id, name, relationship) values (pg_temp.fx('h'), 'Carla', 'Familiar') returning id)
  insert into fixture select 'carla', id from p;
insert into fixture select 'a', public.create_debt('Cartão A', 'card', '2026-07-01', 0);
select public.set_card_cycle(pg_temp.fx('a'), 17, 25);
insert into fixture select 'x', public.card_purchase(pg_temp.fx('a'), '2026-08-05', 300.00, 3, pg_temp.fx('exp'), 'Compra X');
insert into fixture select 'y', public.card_purchase(pg_temp.fx('a'), '2026-09-05', 100.00, 1, pg_temp.fx('exp'), 'Compra Y');
select public.card_bill_due('2026-10-31');
-- paga a fatura de agosto (100,00): fechada e paga = travada (064)
select public.debt_pay(pg_temp.fx('a'), '2026-08-25', pg_temp.fx('bank'), 100.00,
                       (select id from public.debt_invoices where debt_id = pg_temp.fx('a') and label = '2026-08'));
insert into fixture select 'loan', public.create_debt('Empréstimo', 'loan', '2026-07-01', 0);

-- Família 2
select pg_temp.login('00000000-0000-0000-0000-000000000106');
insert into fixture select 'h2', public.create_household('Outra casa');
with p as (insert into public.household_people (household_id, name, relationship) values (pg_temp.fx('h2'), 'Duda', 'Familiar') returning id)
  insert into fixture select 'duda', id from p;
insert into fixture select 'exp2', id from public.categories where household_id = pg_temp.fx('h2') and name = 'Compras pessoais';
insert into fixture select 'b', public.create_debt('Cartão B', 'card', '2026-07-01', 0);
select public.set_card_cycle(pg_temp.fx('b'), 17, 25);
insert into fixture select 'z', public.card_purchase(pg_temp.fx('b'), '2026-08-05', 50.00, 1, pg_temp.fx('exp2'), 'Compra Z');

select pg_temp.login('00000000-0000-0000-0000-000000000105');
select is((select count(*) from public.card_months(pg_temp.fx('a')) where label = '2026-08' and total = paid and total > 0), 1::bigint,
          'S1 a fatura de agosto está paga (travada)');
select is(pg_temp.pessoas(pg_temp.fx('x')), 'null/false,null/false,null/false', 'S2 compra X nasce sem classificação');
select is(pg_temp.por_pessoa(null, false), 400.00, 'S3 gastos por pessoa: 400,00 não classificados');

-- ---------------------------------------------------------------------------
-- Troca em compra com parcela em fatura paga e travada: vale para todas as parcelas, dinheiro intacto
-- ---------------------------------------------------------------------------
select set_config('app.t_dinheiro', pg_temp.dinheiro(pg_temp.fx('a')), true);
select set_config('app.t_foto', pg_temp.foto(pg_temp.fx('x')), true);
select is(public.card_purchase_set_person(pg_temp.fx('a'), pg_temp.fx('x')::text, pg_temp.fx('ana'), false), 3,
          'T1 troca a pessoa da compra X (1ª parcela em fatura paga): devolve 3');
select is(pg_temp.pessoas(pg_temp.fx('x')), (select string_agg(pg_temp.fx('ana')::text || '/false', ',') from generate_series(1, 3)),
          'T2 as 3 parcelas (a paga, as cobradas e as a cobrar) estão com a Ana');
select is(pg_temp.dinheiro(pg_temp.fx('a')), current_setting('app.t_dinheiro'), 'T3 faturas, saldo e resumo do período iguais antes e depois');
select is(pg_temp.foto(pg_temp.fx('x')), current_setting('app.t_foto'), 'T4 valores, datas, categoria e descrição das parcelas iguais');
select is(pg_temp.pessoas(pg_temp.fx('y')), 'null/false', 'T5 a outra compra não mudou');
select is(pg_temp.por_pessoa(pg_temp.fx('ana'), false), 300.00, 'T6 Relatórios › Gastos por pessoa: 300,00 para a Ana');
select is(pg_temp.por_pessoa(null, false), 100.00, 'T7 e 100,00 seguem sem classificação');
select is(coalesce(current_setting('app.person_classification', true), ''), '', 'T8 a marca de sessão volta ao valor de antes');
select is(public.card_purchase_set_person(pg_temp.fx('a'), pg_temp.fx('x')::text, pg_temp.fx('ana'), false), 0, 'T9 repetir não muda nada: devolve 0');
select is(public.card_purchase_set_person(pg_temp.fx('a'), pg_temp.fx('x')::text, null, true), 3, 'T10 "Toda a família": 3 parcelas');
select is(pg_temp.pessoas(pg_temp.fx('x')), 'null/true,null/true,null/true', 'T11 todas compartilhadas, sem pessoa');
select is(pg_temp.por_pessoa(null, true), 300.00, 'T12 gastos por pessoa: 300,00 de toda a família');
select is(public.card_purchase_set_person(pg_temp.fx('a'), pg_temp.fx('x')::text), 3, 'T13 sem pessoa nem escopo: volta a "não classificada"');
select is(pg_temp.dinheiro(pg_temp.fx('a')), current_setting('app.t_dinheiro'), 'T14 dinheiro continua igual');
select is(pg_temp.sqlstate_of(format($$update public.debt_installments set person_id = %L where plan = %L$$, pg_temp.fx('ana'), pg_temp.fx('x')::text)),
          '42501', 'T15 UPDATE direto da parcela continua recusado (só a RPC)');

-- ---------------------------------------------------------------------------
-- Recusas (nada muda)
-- ---------------------------------------------------------------------------
select is(pg_temp.sqlstate_of(format($$select public.card_purchase_set_person(%L, %L, %L, false)$$, pg_temp.fx('a'), pg_temp.fx('x')::text, pg_temp.fx('duda'))),
          '23514', 'R1 pessoa de outra família: recusada (23514, pela validação de escopo)');
select is(pg_temp.sqlstate_of(format($$select public.card_purchase_set_person(%L, %L, %L, true)$$, pg_temp.fx('a'), pg_temp.fx('x')::text, pg_temp.fx('ana'))),
          '23514', 'R2 pessoa individual junto com "toda a família": recusado (23514)');
select is(pg_temp.msg_of(format($$select public.card_purchase_set_person(%L, %L, %L, true)$$, pg_temp.fx('a'), pg_temp.fx('x')::text, pg_temp.fx('ana'))),
          'despesa compartilhada não pode ter pessoa individual', 'R2b a recusa vem da validação de escopo da própria RPC (mensagem clara, não a da constraint)');
select is(pg_temp.sqlstate_of(format($$select public.card_purchase_set_person(%L, %L, %L, false)$$, pg_temp.fx('a'), gen_random_uuid()::text, pg_temp.fx('ana'))),
          '55000', 'R3 compra inexistente: 55000');
select is(pg_temp.sqlstate_of(format($$select public.card_purchase_set_person(%L, %L, %L, false)$$, pg_temp.fx('a'), pg_temp.fx('z')::text, pg_temp.fx('ana'))),
          '55000', 'R4 compra de outra dívida: 55000');
select is(pg_temp.sqlstate_of(format($$select public.card_purchase_set_person(%L, %L, %L, false)$$, pg_temp.fx('loan'), pg_temp.fx('x')::text, pg_temp.fx('ana'))),
          '22023', 'R5 dívida que não é cartão: 22023');
select is(pg_temp.sqlstate_of(format($$select public.card_purchase_set_person(%L, %L, %L, false)$$, pg_temp.fx('b'), pg_temp.fx('z')::text, pg_temp.fx('ana'))),
          '42501', 'R6 cartão de outra família: 42501');
select is(pg_temp.pessoas(pg_temp.fx('x')), 'null/false,null/false,null/false', 'R7 nenhuma recusa mexeu na compra X');

-- pessoa inativa: só se já é a atual
select is(public.card_purchase_set_person(pg_temp.fx('a'), pg_temp.fx('y')::text, pg_temp.fx('carla'), false), 1, 'I1 Carla (ativa) recebe a compra Y');
select set_config('app.t_dinheiro', pg_temp.dinheiro(pg_temp.fx('a')), true);
update public.household_people set status = false where id = pg_temp.fx('carla');
select is(public.card_purchase_set_person(pg_temp.fx('a'), pg_temp.fx('y')::text, pg_temp.fx('carla'), false), 0,
          'I2 Carla inativa já é a atual da compra Y: aceita (nada a mudar)');
select is(pg_temp.sqlstate_of(format($$select public.card_purchase_set_person(%L, %L, %L, false)$$, pg_temp.fx('a'), pg_temp.fx('x')::text, pg_temp.fx('carla'))),
          '23514', 'I3 Carla inativa não recebe uma compra nova: 23514');
select is(public.card_purchase_set_person(pg_temp.fx('a'), pg_temp.fx('y')::text, pg_temp.fx('beto'), false), 1, 'I4 tirar da inativa para uma ativa funciona');

-- sem login
select set_config('request.jwt.claims', '', true);
select is(pg_temp.sqlstate_of(format($$select public.card_purchase_set_person(%L, %L, null, false)$$, pg_temp.fx('a'), pg_temp.fx('x')::text)),
          '42501', 'R8 sem login: 42501');
select pg_temp.login('00000000-0000-0000-0000-000000000105');
select is(pg_temp.dinheiro(pg_temp.fx('a')), current_setting('app.t_dinheiro'), 'R9 dinheiro igual ao fim de tudo');

-- ---------------------------------------------------------------------------
-- Lançamento de CONTA passado: a edição normal já troca a pessoa, inclusive pago e em período conciliado
-- (o gatilho de período só recusa o que mexe em saldo). Guarda contra regressão.
-- ---------------------------------------------------------------------------
with t as (insert into public.transactions (household_id, type, account_id, category_id, description, amount, date, status)
           values (pg_temp.fx('h'), 'expense', pg_temp.fx('bank'), pg_temp.fx('exp'), 'Mercado', 50.00, '2026-08-10', 'paid') returning id)
  insert into fixture select 'lanc', id from t;
select public.reconcile_account(pg_temp.fx('bank'), '2026-09-01', 4850.00);
select is((select max(as_of) from public.account_reconciliations where account_id = pg_temp.fx('bank')), '2026-09-01'::date, 'C1 a conta está conciliada até 01/09');
select lives_ok(format($$update public.transactions set person_id = %L, is_shared_expense = false where id = %L$$, pg_temp.fx('ana'), pg_temp.fx('lanc')),
  'C2 lançamento pago em período conciliado troca de pessoa pela edição normal');
select is((select person_id from public.transactions where id = pg_temp.fx('lanc')), pg_temp.fx('ana'), 'C3 a pessoa gravou');
select lives_ok(format($$update public.transactions set person_id = null, is_shared_expense = true where id = %L$$, pg_temp.fx('lanc')),
  'C4 e troca para "toda a família"');
select is(pg_temp.sqlstate_of(format($$update public.transactions set amount = 51.00 where id = %L$$, pg_temp.fx('lanc'))), '55000',
  'C5 já mudar o valor no período conciliado continua recusado (55000)');

-- ---------------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------------
reset role;
select ok(has_function_privilege('authenticated', 'public.card_purchase_set_person(uuid,text,uuid,boolean)', 'EXECUTE'), 'P1 authenticated executa');
select ok(not has_function_privilege('anon', 'public.card_purchase_set_person(uuid,text,uuid,boolean)', 'EXECUTE'), 'P2 anon não executa');
select ok((select prosecdef from pg_proc where oid = 'public.card_purchase_set_person(uuid,text,uuid,boolean)'::regprocedure), 'P3 SECURITY DEFINER');

select * from finish();
rollback;
