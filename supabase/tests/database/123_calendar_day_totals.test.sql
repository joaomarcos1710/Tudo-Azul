-- 123_calendar_day_totals: migration 130. Os totais de cada dia do Calendário vêm do banco, a partir dos mesmos quatro
-- blocos da lista do dia (lançamentos, movimentos de cartão/dívida em conta, parcelas planejadas e faturas que vencem).
-- Transferência, lançamento apagado, compra no cartão (fica na fatura) e o que está fora do período não entram.
-- A função vai por SQL dinâmico: sem a migration as asserções falham sem abortar o arquivo.
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
-- "dia|moeda|entradas|saídas|faturas e parcelas" na ordem do banco; 'ERRO <sqlstate>' se a função falhar ou não existir
create function pg_temp.dias(p_h uuid, p_from date, p_to date) returns text[] language plpgsql as $f$
declare r text[];
begin
  execute 'select coalesce(array_agg(day || ''|'' || currency || ''|'' || income::numeric(14,2) || ''|'' || expense::numeric(14,2)
                                     || ''|'' || bills::numeric(14,2) order by ord), ''{}'')
             from (select d.*, row_number() over () as ord from public.calendar_day_totals($1, $2, $3) d) q'
    into r using p_h, p_from, p_to;
  return r;
exception when others then return array['ERRO ' || sqlstate];
end $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.sqlstate_of(text), pg_temp.dias(uuid, date, date) to public;

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000123a1', 'c1@teste.com', now()),
  ('00000000-0000-0000-0000-0000000123a2', 'c2@teste.com', now());

select pg_temp.login('00000000-0000-0000-0000-0000000123a1');
insert into fixture select 'h', public.create_household('Casa do Calendário');
insert into fixture select 'cat', id from public.categories where household_id = pg_temp.fx('h') and name = 'Mercado';
insert into fixture select 'rec', id from public.categories where household_id = pg_temp.fx('h') and type = 'income' order by name limit 1;
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 5000.00, '2026-01-01') returning id)
  insert into fixture select 'brl', id from i;
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Poupança', 'savings', 0, '2026-01-01') returning id)
  insert into fixture select 'poup', id from i;
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date, currency_code)
           values (pg_temp.fx('h'), 'Conta em dólar', 'checking', 0, '2026-01-01', 'USD') returning id)
  insert into fixture select 'usd', id from i;

-- Lançamentos de outubro/2026: salário pago e mercado planejado no dia 5; 50,00 em dólar no dia 5 (linha à parte, na
-- moeda da conta); transferência no dia 6 (não entra nem sai); lançamento apagado no dia 7; e um de novembro (fora).
insert into public.transactions (household_id, type, status, date, amount, description, account_id, category_id)
values (pg_temp.fx('h'), 'income', 'paid', '2026-10-05', 1000.00, 'Salário', pg_temp.fx('brl'), pg_temp.fx('rec')),
       (pg_temp.fx('h'), 'expense', 'planned', '2026-10-05', 80.00, 'Mercado', pg_temp.fx('brl'), pg_temp.fx('cat')),
       (pg_temp.fx('h'), 'expense', 'paid', '2026-10-05', 50.00, 'Mercado em Miami', pg_temp.fx('usd'), pg_temp.fx('cat')),
       (pg_temp.fx('h'), 'expense', 'paid', '2026-10-07', 77.00, 'Apagada', pg_temp.fx('brl'), pg_temp.fx('cat')),
       (pg_temp.fx('h'), 'expense', 'paid', '2026-11-01', 33.00, 'Novembro', pg_temp.fx('brl'), pg_temp.fx('cat'));
insert into public.transactions (household_id, type, status, date, amount, description, account_id, destination_account_id)
values (pg_temp.fx('h'), 'transfer', 'paid', '2026-10-06', 200.00, 'Guardar', pg_temp.fx('brl'), pg_temp.fx('poup'));
update public.transactions set deleted_at = now() where household_id = pg_temp.fx('h') and description = 'Apagada';

-- Cartão: fecha dia 18, vence 25. Compra de 300,00 no dia 5 (não aparece no dia 5: vai para a fatura que vence em 25/10).
-- Pagamento de 100,00 da fatura no dia 20 (sai da conta no dia 20; a fatura de 25/10 fica pelo que falta).
insert into fixture select 'card', public.create_debt('Cartão', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('card'), 18, 25);
select public.card_purchase(pg_temp.fx('card'), '2026-10-05', 300.00, 1, pg_temp.fx('cat'), 'Compra');
select public.debt_pay(pg_temp.fx('card'), '2026-10-20', pg_temp.fx('brl'), 100.00);

-- Empréstimo em boleto: 12 parcelas de 100,00 a partir de 10/10/2026.
insert into fixture select 'loan', public.create_debt('Empréstimo', 'loan', '2026-09-01', 1200);
select public.debt_contract_set(pg_temp.fx('loan'), 'Banco', null, 12, 12, 100, 10, 'boleto', null, '2026-10-10');

-- ---------------------------------------------------------------------------
-- 1. Cada dia com o que entra, o que sai e a parte que é fatura ou parcela
-- ---------------------------------------------------------------------------
select is((select remaining::numeric(14,2) from public.card_invoices_due(pg_temp.fx('h'), '2026-10-25', '2026-10-25')),
          200.00::numeric, 'F0 cenário: a fatura de 25/10 tem 300,00 e falta pagar 200,00');
select is(pg_temp.dias(pg_temp.fx('h'), '2026-10-01', '2026-10-31'), array[
          '2026-10-05|BRL|1000.00|80.00|0.00',
          '2026-10-05|USD|0.00|50.00|0.00',
          '2026-10-10|BRL|0.00|100.00|100.00',
          '2026-10-20|BRL|0.00|100.00|100.00',
          '2026-10-25|BRL|0.00|200.00|200.00'],
          'T1 outubro: salário e mercado planejado no dia 5 (dólar à parte); parcela no dia 10; pagamento da fatura no dia 20; '
          'o que falta da fatura no dia 25. Transferência, apagado, compra no cartão e novembro ficam fora');

-- ---------------------------------------------------------------------------
-- 2. Parcela paga: sai do planejado e aparece no dia do pagamento, com os juros
-- ---------------------------------------------------------------------------
select public.debt_schedule_record_payment(
  (select id from public.debt_payment_schedule where debt_id = pg_temp.fx('loan') and installment_number = 1),
  '2026-10-09', pg_temp.fx('brl'), 90, 10, 0, pg_temp.fx('cat'), false);
select is(pg_temp.dias(pg_temp.fx('h'), '2026-10-08', '2026-10-11'), array['2026-10-09|BRL|0.00|100.00|100.00'],
          'P1 parcela paga no dia 9 (90,00 + 10,00 de juros): o dia 10 some e o dia 9 mostra 100,00 em faturas e parcelas');

-- ---------------------------------------------------------------------------
-- 3. O que sai mas não é parcela; o que entra pela dívida; o que é anulado, cancelado ou de dívida inativa
-- ---------------------------------------------------------------------------
-- amortização avulsa de 500,00 com 20,00 de tarifa no dia 3: sai 520,00, nada em faturas e parcelas
select public.debt_extra_amortize(pg_temp.fx('loan'), '2026-10-03', pg_temp.fx('brl'), 500, 'term', 6, null, 0, 20, pg_temp.fx('cat'));
-- juros sozinhos no dia 4: saem, mas não são parcela
select public.debt_loan_event(pg_temp.fx('loan'), '2026-10-04', 'interest', pg_temp.fx('brl'), 15, pg_temp.fx('cat'));
-- crédito de um novo empréstimo no dia 2: entra
insert into fixture select 'loan2', public.create_debt('Empréstimo 2', 'loan', '2026-09-01', 0);
select public.debt_loan_event(pg_temp.fx('loan2'), '2026-10-02', 'disbursement', pg_temp.fx('brl'), 700);
-- juros anulados no dia 11: não aparecem
select public.debt_void(public.debt_loan_event(pg_temp.fx('loan2'), '2026-10-11', 'interest', pg_temp.fx('brl'), 9, pg_temp.fx('cat')), 'teste');
select is(pg_temp.dias(pg_temp.fx('h'), '2026-10-01', '2026-10-04'), array[
          '2026-10-02|BRL|700.00|0.00|0.00',
          '2026-10-03|BRL|0.00|520.00|0.00',
          '2026-10-04|BRL|0.00|15.00|0.00'],
          'X1 crédito do empréstimo entra (dia 2); amortização avulsa com tarifa (dia 3) e juros sozinhos (dia 4) saem sem ser parcela');
select is(pg_temp.dias(pg_temp.fx('h'), '2026-10-11', '2026-10-11'), '{}'::text[], 'X2 evento anulado não aparece');
-- dívida em boleto com parcela em 15/10 que é arquivada (inativa): a parcela some
insert into fixture select 'loan3', public.create_debt('Empréstimo 3', 'loan', '2026-09-01', 300);
select public.debt_contract_set(pg_temp.fx('loan3'), 'Banco', null, 3, 3, 100, 15, 'boleto', null, '2026-10-15');
select is(pg_temp.dias(pg_temp.fx('h'), '2026-10-15', '2026-10-15'), array['2026-10-15|BRL|0.00|100.00|100.00'],
          'X3 parcela planejada de dívida ativa aparece');
reset role;
update public.debts set active = false where id = pg_temp.fx('loan3');
select pg_temp.login('00000000-0000-0000-0000-0000000123a1');
select is(pg_temp.dias(pg_temp.fx('h'), '2026-10-15', '2026-10-15'), '{}'::text[], 'X4 dívida inativa: a parcela some');
-- parcela cancelada some
reset role;
update public.debts set active = true where id = pg_temp.fx('loan3');
update public.debt_payment_schedule set status = 'cancelled' where debt_id = pg_temp.fx('loan3') and installment_number = 1;
select pg_temp.login('00000000-0000-0000-0000-0000000123a1');
select is(pg_temp.dias(pg_temp.fx('h'), '2026-10-15', '2026-10-15'), '{}'::text[], 'X5 parcela cancelada some');
-- fatura paga por inteiro: o dia do vencimento some (sobra só o dia do pagamento)
select public.debt_pay(pg_temp.fx('card'), '2026-10-24', pg_temp.fx('brl'), 200.00);
select is(pg_temp.dias(pg_temp.fx('h'), '2026-10-24', '2026-10-25'), array['2026-10-24|BRL|0.00|200.00|200.00'],
          'X6 fatura quitada: 25/10 some; o pagamento aparece no dia 24');

-- ---------------------------------------------------------------------------
-- 4. Período inválido, privilégios e isolamento
-- ---------------------------------------------------------------------------
select is(pg_temp.sqlstate_of(format($$select * from public.calendar_day_totals(%L, '2026-10-31', '2026-10-01')$$, pg_temp.fx('h'))),
          '22023', 'V1 fim antes do início: recusado (22023)');
select is(pg_temp.sqlstate_of(format($$select * from public.calendar_day_totals(%L, null, '2026-10-01')$$, pg_temp.fx('h'))),
          '22023', 'V2 início nulo: recusado (22023)');
select is(pg_temp.sqlstate_of(format($$select * from public.calendar_day_totals(%L, '2026-01-01', '2026-12-31')$$, pg_temp.fx('h'))),
          '22023', 'V3 período de um ano: recusado (22023, a tela pede um mês)');
select is(pg_temp.sqlstate_of(format($$select * from public.calendar_day_totals(%L, '2026-10-01', '2026-12-01')$$, pg_temp.fx('h'))),
          null, 'V3b 62 dias contando as duas pontas: aceito');
select is(pg_temp.sqlstate_of(format($$select * from public.calendar_day_totals(%L, '2026-10-01', '2026-12-02')$$, pg_temp.fx('h'))),
          '22023', 'V3c 63 dias: recusado');
select ok(not has_function_privilege('anon', 'public.calendar_day_totals(uuid, date, date)', 'EXECUTE'), 'V4 anon sem EXECUTE');
select ok(has_function_privilege('authenticated', 'public.calendar_day_totals(uuid, date, date)', 'EXECUTE'), 'V5 authenticated com EXECUTE');
select ok(not (select prosecdef from pg_proc where oid = 'public.calendar_day_totals(uuid, date, date)'::regprocedure), 'V6 SECURITY INVOKER');

select pg_temp.login('00000000-0000-0000-0000-0000000123a2');
insert into fixture select 'h2', public.create_household('Outra casa');
insert into fixture select 'rec2', id from public.categories where household_id = pg_temp.fx('h2') and type = 'income' order by name limit 1;
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h2'), 'Banco 2', 'checking', 0, '2026-01-01') returning id)
  insert into public.transactions (household_id, type, status, date, amount, description, account_id, category_id)
  select pg_temp.fx('h2'), 'income', 'paid', '2026-10-05', 5.00, 'Da outra casa', id, pg_temp.fx('rec2') from i;
select is(pg_temp.dias(pg_temp.fx('h'), '2026-10-01', '2026-10-31'), '{}'::text[], 'S1 outra família recebe zero linhas');
select is(pg_temp.dias(pg_temp.fx('h2'), '2026-10-01', '2026-10-31'), array['2026-10-05|BRL|5.00|0.00|0.00'],
          'S2 cada um vê só a própria casa, sem mistura (os 1.000,00 da outra família não entram no dia 5)');

select * from finish();
rollback;
