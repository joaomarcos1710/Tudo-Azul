-- 77_card_credit_set_category: migration 077. Trocar a categoria de créditos/reembolsos de cartão (income_credit) em lote,
-- inclusive em fatura paga e travada (064): muda só category_id; valor, data, fatura e totais ficam iguais. Recusa evento
-- anulado, de outra família, de outro tipo, categoria de despesa, de outra família ou inativa. UPDATE direto continua 42501
-- e o guard continua barrando valor/data mesmo com a marca de sessão ligada. Datas fixas (hoje real >= 06/11/2026).
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
create function pg_temp.fatura(p_card uuid, p_label text) returns text language sql as $f$
  select charged::numeric(14,2) || '|' || pending::numeric(14,2) || '|' || total::numeric(14,2) || '|' || paid::numeric(14,2)
         || '|' || credits::numeric(14,2)
    from public.card_months(p_card) where label = p_label $f$;
create function pg_temp.resumo(p_from date, p_to date) returns text language sql as $f$
  select income_paid::numeric(14,2) || '|' || expense_paid::numeric(14,2)
    from public.period_summary(pg_temp.fx('h'), p_from, p_to) $f$;
-- foto do evento, tudo menos a categoria
create function pg_temp.foto(p_ev uuid) returns text language sql as $f$
  select e.debt_id || '|' || e.date || '|' || e.kind || '|' || e.amount || '|' || e.credit_date || '|' || coalesce(e.invoice_id::text, '-')
         || '|' || e.category_type || '|' || e.note || '|' || coalesce(e.voided_at::text, '-')
    from public.debt_events e where e.id = p_ev $f$;
create function pg_temp.cat(p_ev uuid) returns uuid language sql as $f$
  select category_id from public.debt_events where id = p_ev $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.sqlstate_of(text), pg_temp.fatura(uuid, text),
  pg_temp.resumo(date, date), pg_temp.foto(uuid), pg_temp.cat(uuid) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000077a1', 'c1@teste.com'),
  ('00000000-0000-0000-0000-0000000077a2', 'c2@teste.com');

-- ---------------------------------------------------------------------------
-- Família 1: cartão A fecha 17, vence 25. Compra de 300,00 em 05/08; dois créditos "IOF" na fatura de agosto (fecha 17/08)
-- ---------------------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000077a1');
insert into fixture select 'h', public.create_household('Casa do IOF');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 5000.00, '2026-01-01') returning id)
  insert into fixture select 'bank', id from i;
insert into fixture select 'exp', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';
insert into fixture select 'inc', id from public.categories where household_id = pg_temp.fx('h') and name = 'Outras receitas';
with c as (insert into public.categories (household_id, name, type, parent_id)
           values (pg_temp.fx('h'), 'Estorno de IOF', 'income', pg_temp.fx('inc')) returning id)
  insert into fixture select 'iof', id from c;
update public.categories set non_consumption = true where id = pg_temp.fx('iof');
with c as (insert into public.categories (household_id, name, type, active) values (pg_temp.fx('h'), 'Receita parada', 'income', false) returning id)
  insert into fixture select 'inc_inativa', id from c;

insert into fixture select 'a', public.create_debt('Cartão A', 'card', '2026-07-01', 0);
select public.set_card_cycle(pg_temp.fx('a'), 17, 25);
select public.card_purchase(pg_temp.fx('a'), '2026-08-05', 300.00, 1, pg_temp.fx('exp'), 'Compra de agosto');
insert into fixture select 'c1', public.card_credit_income(pg_temp.fx('a'), '2026-08-10', 50.00, pg_temp.fx('inc'), 'IOF');
insert into fixture select 'c2', public.card_credit_income(pg_temp.fx('a'), '2026-08-12', 20.00, pg_temp.fx('inc'), 'IOF');
-- setembro (compra de 100,00, fatura fechada e NÃO paga): crédito que vai ser anulado; outubro: crédito vivo em fatura não paga
select public.card_purchase(pg_temp.fx('a'), '2026-09-05', 100.00, 1, pg_temp.fx('exp'), 'Compra de setembro');
insert into fixture select 'c3', public.card_credit_income(pg_temp.fx('a'), '2026-09-05', 80.00, pg_temp.fx('inc'), 'IOF anulado');
insert into fixture select 'c4', public.card_credit_income(pg_temp.fx('a'), '2026-10-05', 10.00, pg_temp.fx('inc'), 'IOF de outubro');
select public.card_bill_due('2026-10-31');
-- paga a fatura de agosto (300 − 70 = 230): fechada e paga = travada (064)
select public.debt_pay(pg_temp.fx('a'), '2026-08-25', pg_temp.fx('bank'), 230.00,
                       (select id from public.debt_invoices where debt_id = pg_temp.fx('a') and label = '2026-08'));
select public.debt_void(pg_temp.fx('c3'), 'lançado errado');
insert into fixture select 'pag', id from public.debt_events where debt_id = pg_temp.fx('a') and kind = 'payment';
insert into fixture select 'cob', id from public.debt_events where debt_id = pg_temp.fx('a') and kind = 'charge' limit 1;

select is(pg_temp.fatura(pg_temp.fx('a'), '2026-08'), '230.00|0.00|230.00|230.00|70.00', 'S1 fatura de agosto: 230,00, paga, créditos 70,00');
select is(pg_temp.sqlstate_of(format($$select public.debt_void(%L, 'lançado errado')$$, pg_temp.fx('c1'))), '55000',
          'S2 a fatura de agosto está travada: anular o crédito é recusado (064)');
select is(pg_temp.resumo('2026-08-01', '2026-08-31'), '70.00|300.00', 'S3 agosto: receita 70,00, despesa 300,00');

-- ---------------------------------------------------------------------------
-- Família 2
-- ---------------------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000077a2');
insert into fixture select 'h2', public.create_household('Outra casa');
insert into fixture select 'inc2', id from public.categories where household_id = pg_temp.fx('h2') and name = 'Outras receitas';
insert into fixture select 'b', public.create_debt('Cartão B', 'card', '2026-07-01', 0);
select public.set_card_cycle(pg_temp.fx('b'), 17, 25);
insert into fixture select 'c5', public.card_credit_income(pg_temp.fx('b'), '2026-08-10', 5.00, pg_temp.fx('inc2'), 'IOF da outra casa');

-- ---------------------------------------------------------------------------
-- Troca funciona, inclusive em fatura paga e travada; só a categoria muda
-- ---------------------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000077a1');
select is(pg_temp.foto(pg_temp.fx('c1')), pg_temp.fx('a') || '|2026-08-17|income_credit|50.00|2026-08-10|-|income|IOF|-', 'T0 foto do crédito antes');
select is(public.card_credit_set_category(array[pg_temp.fx('c1')], pg_temp.fx('iof')), 1, 'T1 troca a categoria de 1 crédito em fatura paga: devolve 1');
select is(pg_temp.cat(pg_temp.fx('c1')), pg_temp.fx('iof'), 'T2 o crédito está em "Estorno de IOF"');
select is(pg_temp.foto(pg_temp.fx('c1')), pg_temp.fx('a') || '|2026-08-17|income_credit|50.00|2026-08-10|-|income|IOF|-', 'T3 nada mais mudou (valor, data, fatura, tipo, nota)');
select is(pg_temp.fatura(pg_temp.fx('a'), '2026-08'), '230.00|0.00|230.00|230.00|70.00', 'T4 a fatura de agosto continua igual e paga');
select is(pg_temp.resumo('2026-08-01', '2026-08-31'), '70.00|300.00', 'T5 o resumo de agosto não muda (só a classificação)');
select is(pg_temp.sqlstate_of(format($$select public.debt_void(%L, 'lançado errado')$$, pg_temp.fx('c1'))), '55000', 'T6 a fatura continua travada depois da troca');
select is(coalesce(current_setting('app.card_credit_category', true), ''), 'off', 'T7 a RPC desliga a marca de sessão ao sair');
select is(public.card_credit_set_category(array[pg_temp.fx('c1'), pg_temp.fx('c2'), pg_temp.fx('c4')], pg_temp.fx('iof')), 2,
          'T8 lote com 3 (um já estava na categoria): devolve 2');
select is(public.card_credit_set_category(array[pg_temp.fx('c1'), pg_temp.fx('c2'), pg_temp.fx('c2')], pg_temp.fx('iof')), 0,
          'T9 de novo (id repetido conta uma vez): nada a mudar, devolve 0');
select is(public.card_credit_set_category(array[pg_temp.fx('c4')], pg_temp.fx('inc')), 1, 'T10 volta o de outubro para "Outras receitas"');

-- ---------------------------------------------------------------------------
-- Recusas (tudo ou nada: nenhum muda)
-- ---------------------------------------------------------------------------
select is(pg_temp.sqlstate_of(format($$select public.card_credit_set_category(array[%L, %L]::uuid[], %L)$$, pg_temp.fx('c4'), pg_temp.fx('c3'), pg_temp.fx('iof'))), '55000',
          'R1 crédito anulado na seleção: recusado (55000)');
select is(pg_temp.cat(pg_temp.fx('c4')), pg_temp.fx('inc'), 'R1b e o outro da seleção não mudou');
select is(pg_temp.sqlstate_of(format($$select public.card_credit_set_category(array[%L, %L]::uuid[], %L)$$, pg_temp.fx('c4'), pg_temp.fx('c5'), pg_temp.fx('iof'))), '42501',
          'R2 crédito de outra família: recusado (42501), sem dizer se existe');
select is(pg_temp.sqlstate_of(format($$select public.card_credit_set_category(array[%L]::uuid[], %L)$$, pg_temp.fx('c4'), pg_temp.fx('exp'))), '23514',
          'R3 categoria de despesa: recusada (23514)');
select is(pg_temp.sqlstate_of(format($$select public.card_credit_set_category(array[%L]::uuid[], %L)$$, pg_temp.fx('c4'), pg_temp.fx('inc2'))), '23514',
          'R4 categoria de outra família: recusada (23514)');
select is(pg_temp.sqlstate_of(format($$select public.card_credit_set_category(array[%L]::uuid[], %L)$$, pg_temp.fx('c4'), pg_temp.fx('inc_inativa'))), '23514',
          'R5 categoria de receita inativa: recusada (23514)');
select is(pg_temp.sqlstate_of(format($$select public.card_credit_set_category(array[%L]::uuid[], %L)$$, pg_temp.fx('pag'), pg_temp.fx('iof'))), '23514',
          'R6 evento de pagamento (kind payment): recusado (23514)');
select is(pg_temp.sqlstate_of(format($$select public.card_credit_set_category(array[%L, %L]::uuid[], %L)$$, pg_temp.fx('c4'), pg_temp.fx('cob'), pg_temp.fx('iof'))), '23514',
          'R7 parcela cobrada (kind charge) na seleção: recusada (23514)');
select is(pg_temp.cat(pg_temp.fx('c4')), pg_temp.fx('inc'), 'R7b tudo ou nada: o crédito válido da seleção não mudou');
select is(pg_temp.sqlstate_of(format($$select public.card_credit_set_category(array[]::uuid[], %L)$$, pg_temp.fx('iof'))), '22023', 'R8 lista vazia (22023)');
select is(pg_temp.sqlstate_of(format($$select public.card_credit_set_category(array[%L, null]::uuid[], %L)$$, pg_temp.fx('c4'), pg_temp.fx('iof'))), '22023', 'R9 item nulo na lista (22023)');
select is(pg_temp.sqlstate_of(format($$select public.card_credit_set_category(array[%L]::uuid[], null)$$, pg_temp.fx('c4'))), '22023', 'R10 sem categoria (22023)');
select is(pg_temp.sqlstate_of(format($$select public.card_credit_set_category(array[%L]::uuid[], %L)$$, '00000000-0000-0000-0000-0000000077ff', pg_temp.fx('iof'))), '42501',
          'R11 crédito inexistente (42501)');
select is(pg_temp.sqlstate_of(format($$update public.debt_events set category_id = %L where id = %L$$, pg_temp.fx('iof'), pg_temp.fx('c4'))), '42501',
          'R12 UPDATE direto de category_id como authenticated continua recusado (42501)');

-- a outra família só mexe no que é dela
select pg_temp.login('00000000-0000-0000-0000-0000000077a2');
select is(pg_temp.cat(pg_temp.fx('c5')), pg_temp.fx('inc2'), 'R2b o crédito da outra família não mudou (visto por ela)');
select is(pg_temp.sqlstate_of(format($$select public.card_credit_set_category(array[%L]::uuid[], %L)$$, pg_temp.fx('c4'), pg_temp.fx('inc2'))), '42501',
          'R13 família 2 não troca crédito da família 1 (42501)');
select is(pg_temp.sqlstate_of(format($$select public.card_credit_set_category(array[%L]::uuid[], %L)$$, pg_temp.fx('c5'), pg_temp.fx('iof'))), '23514',
          'R14 família 2 não usa categoria da família 1 (23514)');
with c as (insert into public.categories (household_id, name, type) values (pg_temp.fx('h2'), 'Cashback', 'income') returning id)
  insert into fixture select 'cb2', id from c;
select is(public.card_credit_set_category(array[pg_temp.fx('c5')], pg_temp.fx('cb2')), 1, 'R15 família 2 troca o próprio crédito');
select is(pg_temp.cat(pg_temp.fx('c5')), pg_temp.fx('cb2'), 'R15b e ele mudou');

-- sem login
reset role;
select set_config('request.jwt.claims', '', true);
select set_config('role', 'anon', true);
select is(pg_temp.sqlstate_of(format($$select public.card_credit_set_category(array[%L]::uuid[], %L)$$, pg_temp.fx('c4'), pg_temp.fx('iof'))), '42501',
          'R16 anon não executa a RPC (42501)');

-- ---------------------------------------------------------------------------
-- O guard em si (como dono da tabela, sem o grant no caminho): só category_id de income_credit, e só com a marca
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.sqlstate_of(format($$update public.debt_events set category_id = %L where id = %L$$, pg_temp.fx('iof'), pg_temp.fx('c4'))), '42501',
          'G1 sem a marca de sessão, nem o dono da tabela troca a categoria (42501)');
select set_config('app.card_credit_category', 'on', true);
select is(pg_temp.sqlstate_of(format($$update public.debt_events set amount = 11.00 where id = %L$$, pg_temp.fx('c4'))), '42501',
          'G2 com a marca ligada, mudar o valor continua recusado (42501)');
select is(pg_temp.sqlstate_of(format($$update public.debt_events set date = '2026-11-17', credit_date = '2026-11-05' where id = %L$$, pg_temp.fx('c4'))), '42501',
          'G3 com a marca ligada, mudar a data (fatura) continua recusado (42501)');
select is(pg_temp.sqlstate_of(format($$update public.debt_events set note = 'outra' where id = %L$$, pg_temp.fx('c4'))), '42501',
          'G4 com a marca ligada, mudar a descrição continua recusado (42501)');
select is(pg_temp.sqlstate_of(format($$update public.debt_events set category_id = %L, category_type = 'expense' where id = %L$$, pg_temp.fx('exp'), pg_temp.fx('c4'))), '42501',
          'G5 com a marca ligada, category_type não muda (42501)');
select is(pg_temp.sqlstate_of(format($$update public.debt_events set category_id = %L where id = %L$$, pg_temp.fx('exp'), pg_temp.fx('cob'))), '42501',
          'G6 com a marca ligada, categoria de evento que não é income_credit continua recusada (42501)');
select is(pg_temp.sqlstate_of(format($$update public.debt_events set category_id = %L where id = %L$$, pg_temp.fx('iof'), pg_temp.fx('c3'))), '55000',
          'G7 com a marca ligada, evento anulado continua intocável (55000)');
select is(pg_temp.sqlstate_of(format($$update public.debt_events set category_id = %L where id = %L$$, pg_temp.fx('iof'), pg_temp.fx('c4'))), null,
          'G8 com a marca ligada, category_id de income_credit passa (é o que a RPC faz)');
select is(pg_temp.sqlstate_of(format($$update public.debt_events set category_id = %L where id = %L$$, pg_temp.fx('exp'), pg_temp.fx('c4'))), '23503',
          'G9 mesmo com a marca, categoria de despesa cai na FK composta (23503)');
select set_config('app.card_credit_category', 'off', true);

select * from finish();
rollback;
