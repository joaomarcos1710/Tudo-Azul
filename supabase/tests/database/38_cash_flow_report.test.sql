-- 38_cash_flow_report: migration 033. Entradas x Saídas por dia/semana/mês, com filtros e "considerar não pagos".
-- Datas fixas (março/2026): nada depende do relógio.
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
-- "inicio:entrada/saida/acumulado" de cada balde, separado por espaço
create function pg_temp.rel(p_step text, p_de date, p_ate date, p_contas uuid[] default null, p_membro uuid default null, p_plan boolean default false) returns text language sql as $f$
  select string_agg(period_start || ':' || income::numeric(14,2) || '/' || expense::numeric(14,2) || '/' || cumulative::numeric(14,2), ' ' order by period_start)
    from public.cash_flow_report(pg_temp.fx('h'), p_de, p_ate, p_step, p_contas, p_membro, p_plan) $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.sqlstate_of(text),
  pg_temp.rel(text, date, date, uuid[], uuid, boolean) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000038a1', 'f1@teste.com'),
  ('00000000-0000-0000-0000-0000000038a2', 'f2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000038a1');
insert into fixture select 'h', public.create_household('Casa Fluxo');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 0, '2026-03-01') returning id)
  insert into fixture select 'bank', id from i;
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Carteira', 'cash', 0, '2026-03-01') returning id)
  insert into fixture select 'cart', id from i;
insert into fixture select 'sal', id from public.categories where household_id = pg_temp.fx('h') and name = 'Salário';
insert into fixture select 'comp', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';

-- 02/03 e 09/03 são segundas-feiras (semanas distintas); 31/03 e 01/04 viram o mês
insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status) values
  (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('sal'),  'income',  'Salário',   1000.00, '2026-03-02', 'paid'),
  (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('comp'), 'expense', 'Mercado',    200.00, '2026-03-02', 'paid'),
  (pg_temp.fx('h'), pg_temp.fx('cart'), pg_temp.fx('comp'), 'expense', 'Padaria',     50.00, '2026-03-11', 'paid'),
  (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('comp'), 'expense', 'Previsto',   300.00, '2026-03-10', 'planned'),
  (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('sal'),  'income',  'Extra',      100.00, '2026-03-31', 'paid'),
  (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('comp'), 'expense', 'Abril',       70.00, '2026-04-01', 'paid');
-- transferência não é entrada nem saída
insert into public.transactions (household_id, account_id, destination_account_id, type, description, amount, date, status)
  values (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('cart'), 'transfer', 'Saque', 500.00, '2026-03-03', 'paid');
-- cartão: compra de 300 cobrada no fechamento (17/03) e estorno de 30 (sem conta)
insert into fixture select 'card', public.create_debt('Nubank', 'card', '2026-03-01', 0);
select public.set_card_cycle(pg_temp.fx('card'), 17, 25);
select public.card_purchase(pg_temp.fx('card'), '2026-03-12', 300.00, 1, pg_temp.fx('comp'), 'Tênis');
select public.card_bill_due('2026-03-31');
select public.debt_refund((select id from public.debt_installments where debt_id = pg_temp.fx('card')), '2026-03-20', 30.00);

-- C1 dia: um balde por dia do período, com os dias vazios em zero
select is((select count(*) from public.cash_flow_report(pg_temp.fx('h'), '2026-03-01', '2026-03-31', 'day')), 31::bigint, 'C1 31 dias, 31 baldes');
select is((select expense from public.cash_flow_report(pg_temp.fx('h'), '2026-03-01', '2026-03-31', 'day') where period_start = '2026-03-02'),
          200.00::numeric, 'C1.1 saída do dia 02');
select is((select income + expense from public.cash_flow_report(pg_temp.fx('h'), '2026-03-01', '2026-03-31', 'day') where period_start = '2026-03-05'),
          0::numeric, 'C1.2 dia sem movimento: zero');

-- C2 mês: a transferência fica de fora; cartão (300 - 30 estorno) soma na saída
select is(pg_temp.rel('month', '2026-03-01', '2026-03-31'), '2026-03-01:1100.00/520.00/580.00',
          'C2 março: entradas 1100; saídas 200+50+300-30 = 520 (transferência fora)');
-- C3 invariante: sem filtro e sem planejados = period_summary
select is((select sum(income) from public.cash_flow_report(pg_temp.fx('h'), '2026-03-01', '2026-03-31', 'day')),
          (select income_paid from public.period_summary(pg_temp.fx('h'), '2026-03-01', '2026-03-31')), 'C3 entradas = period_summary.income_paid');
select is((select sum(expense) from public.cash_flow_report(pg_temp.fx('h'), '2026-03-01', '2026-03-31', 'day')),
          (select expense_paid from public.period_summary(pg_temp.fx('h'), '2026-03-01', '2026-03-31')), 'C3.1 saídas = period_summary.expense_paid');

-- C3.2 totais do período vêm do banco, iguais em toda linha
select is((select string_agg(distinct total_income::numeric(14,2) || '/' || total_expense::numeric(14,2), ' ')
             from public.cash_flow_report(pg_temp.fx('h'), '2026-03-01', '2026-03-31', 'day')), '1100.00/520.00', 'C3.2 totais = soma dos baldes, repetidos em toda linha');

-- C4 semana (segunda a domingo) e acumulado
select is(pg_temp.rel('week', '2026-03-01', '2026-03-15'),
          '2026-02-23:0.00/0.00/0.00 2026-03-02:1000.00/200.00/800.00 2026-03-09:0.00/50.00/750.00',
          'C4 semanas: o balde da 1ª semana começa na segunda anterior; acumulado corrido');
-- C5 virada de mês: 31/03 e 01/04 em baldes diferentes
select is(pg_temp.rel('month', '2026-03-31', '2026-04-01'), '2026-03-01:100.00/0.00/100.00 2026-04-01:0.00/70.00/30.00', 'C5 virada de mês');

-- C6 filtros
select is(pg_temp.rel('month', '2026-03-01', '2026-03-31', array[pg_temp.fx('bank')]), '2026-03-01:1100.00/200.00/900.00',
          'C6 só a conta Banco: sem a Padaria (Carteira) e sem cobrança de cartão (cartão não tem conta)');
select is(pg_temp.rel('month', '2026-03-01', '2026-03-31', array[pg_temp.fx('cart')]), '2026-03-01:0.00/50.00/-50.00', 'C6.1 só a Carteira');
select is(pg_temp.rel('month', '2026-03-01', '2026-03-31', null, '00000000-0000-0000-0000-0000000038a1'), '2026-03-01:1100.00/520.00/580.00',
          'C6.2 filtro pelo autor: tudo foi lançado por ele');
select is(pg_temp.rel('month', '2026-03-01', '2026-03-31', null, '00000000-0000-0000-0000-0000000038a2'), '2026-03-01:0.00/0.00/0.00',
          'C6.3 outro autor: zero');

-- C7 considerar não pagos: entra o planejado (300 em 10/03); sem filtro entra também o que falta cobrar das parcelas
select is(pg_temp.rel('month', '2026-03-01', '2026-03-31', null, null, true),
          '2026-03-01:1100.00/'
            || ((select expense_paid + expense_planned from public.period_summary(pg_temp.fx('h'), '2026-03-01', '2026-03-31')))::numeric(14,2)
            || '/' || (1100 - (select expense_paid + expense_planned from public.period_summary(pg_temp.fx('h'), '2026-03-01', '2026-03-31')))::numeric(14,2),
          'C7 com não pagos = period_summary (pago + planejado)');
select is((select sum(expense) from public.cash_flow_report(pg_temp.fx('h'), '2026-03-01', '2026-03-31', 'month', array[pg_temp.fx('bank')], null, true)),
          500.00::numeric, 'C7.1 com filtro de conta, o planejado do Banco entra (200 + 300)');

-- C8 entradas inválidas
select is(pg_temp.sqlstate_of($$select * from public.cash_flow_report(pg_temp.fx('h'), '2026-03-01', '2026-03-31', 'ano')$$), '22023', 'C8 passo inválido');
select is(pg_temp.sqlstate_of($$select * from public.cash_flow_report(pg_temp.fx('h'), '2026-03-31', '2026-03-01', 'day')$$), '22023', 'C8.1 período invertido');
select is(pg_temp.sqlstate_of($$select * from public.cash_flow_report(pg_temp.fx('h'), '2025-01-01', '2026-12-31', 'day')$$), '22023', 'C8.2 dia: mais de 366 dias');
select lives_ok($$select * from public.cash_flow_report(pg_temp.fx('h'), '2025-01-01', '2026-12-31', 'month')$$, 'C8.3 mês: 2 anos pode');

-- C9 outra família e anon
select pg_temp.login('00000000-0000-0000-0000-0000000038a2');
insert into fixture select 'h2', public.create_household('Casa Outra');
select is((select count(*) from public.cash_flow_report(pg_temp.fx('h'), '2026-03-01', '2026-03-31', 'month')), 0::bigint, 'C9 quem não é da família recebe zero linhas');
select set_config('request.jwt.claims', '{}', true), set_config('role', 'anon', true);
select is(pg_temp.sqlstate_of($$select * from public.cash_flow_report(pg_temp.fx('h'), '2026-03-01', '2026-03-31', 'month')$$), '42501', 'C9.1 anon não executa');

select * from finish();
rollback;
