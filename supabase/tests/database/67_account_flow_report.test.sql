-- 67_account_flow_report: migration 067. (1) Entradas x Saídas com "não pagos": as assinaturas de cartão previstas saem
-- no VENCIMENTO da fatura (uma vez só) e os lançamentos fixos (recorrentes de conta) ainda não gerados entram como
-- planejados; o saldo anda junto. (2) Relatório › Contas (account_flow_report): saldo no início, entradas, saídas e saldo
-- no fim por conta ativa em reais, e o total sem inflar com as transferências.
-- Datas fixas: setembro/outubro de 2026 (passado: pagamento de cartão não pode ser futuro) e 2030 (previstos: nada
-- gerado pelo relógio). recurrence_materialize não é chamada (depende de hoje): a geração é simulada como ela faz.
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
-- "dia:saída" dos dias com saída
create function pg_temp.saidas(p_de date, p_ate date, p_plan boolean default true) returns text language sql as $f$
  select string_agg(period_start || ':' || expense::numeric(14,2), ' ' order by period_start)
    from public.cash_flow_series(pg_temp.fx('h'), p_de, p_ate, 'day', null, null, p_plan) where expense <> 0 $f$;
-- "conta:inicial/entradas/saídas/transf.entra/transf.sai/final" de cada linha
create function pg_temp.contas(p_de date, p_ate date, p_plan boolean default false) returns text language sql as $f$
  select string_agg(name || ':' || opening_balance::numeric(14,2) || '/' || income::numeric(14,2) || '/' || expense::numeric(14,2)
                    || '/' || transfer_in::numeric(14,2) || '/' || transfer_out::numeric(14,2) || '/' || closing_balance::numeric(14,2),
                    ' ' order by name)
    from public.account_flow_report(pg_temp.fx('h'), p_de, p_ate, p_plan) $f$;
create function pg_temp.totais(p_de date, p_ate date, p_plan boolean default false) returns text language sql as $f$
  select total_opening::numeric(14,2) || '/' || total_income::numeric(14,2) || '/' || total_expense::numeric(14,2) || '/'
         || total_transfers::numeric(14,2) || '/' || total_closing::numeric(14,2)
    from public.account_flow_report(pg_temp.fx('h'), p_de, p_ate, p_plan) limit 1 $f$;
-- contas cuja linha NÃO fecha (inicial + entradas − saídas ≠ final); null = todas fecham
create function pg_temp.nao_fecham(p_de date, p_ate date, p_plan boolean) returns text language sql as $f$
  select string_agg(name, ',') from public.account_flow_report(pg_temp.fx('h'), p_de, p_ate, p_plan)
   where opening_balance + income - expense <> closing_balance $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.sqlstate_of(text), pg_temp.saidas(date, date, boolean),
  pg_temp.contas(date, date, boolean), pg_temp.totais(date, date, boolean), pg_temp.nao_fecham(date, date, boolean) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000067a1', 'c1@teste.com'),
  ('00000000-0000-0000-0000-0000000067a2', 'c2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000067a1');
insert into fixture select 'h', public.create_household('Casa Contas');
insert into fixture select 'sal', id from public.categories where household_id = pg_temp.fx('h') and name = 'Salário';
insert into fixture select 'comp', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 1000.00, '2026-08-01') returning id)
  insert into fixture select 'bank', id from i;
-- aberta NO MEIO de setembro: o saldo no início do período é o saldo inicial dela
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Poupança', 'savings', 50.00, '2026-09-15') returning id)
  insert into fixture select 'poup', id from i;
-- conta em outra moeda (fica fora) e conta desativada (fica fora)
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date, currency_code)
           values (pg_temp.fx('h'), 'Nomad', 'checking', 100.00, '2026-08-01', 'USD') returning id)
  insert into fixture select 'usd', id from i;
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Antiga', 'checking', 5.00, '2026-08-01') returning id)
  insert into fixture select 'old', id from i;
update public.accounts set active = false where id = pg_temp.fx('old');

insert into public.transactions (household_id, account_id, destination_account_id, category_id, type, description, amount, date, status) values
  (pg_temp.fx('h'), pg_temp.fx('bank'), null, pg_temp.fx('sal'),  'income',  'Salário',      500.00, '2026-09-01', 'paid'),
  (pg_temp.fx('h'), pg_temp.fx('bank'), null, pg_temp.fx('comp'), 'expense', 'Mercado',      200.00, '2026-09-08', 'paid'),
  (pg_temp.fx('h'), pg_temp.fx('bank'), null, pg_temp.fx('comp'), 'expense', 'Previsto',      50.00, '2026-09-10', 'planned'),
  (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('poup'), null, 'transfer', 'Guardar',     200.00, '2026-09-20', 'paid'),
  (pg_temp.fx('h'), pg_temp.fx('usd'),  null, pg_temp.fx('sal'),  'income',  'Em dólar',      10.00, '2026-09-02', 'paid');
-- cartão que fecha 25 e vence 5, pago pelo Banco: 300 (05/09) vence 05/10 e é pago em 05/10; 120 (28/09) vence 05/11, a pagar
insert into fixture select 'card', public.create_debt('Nubank', 'card', '2026-08-01', 0);
select public.set_card_cycle(pg_temp.fx('card'), 25, 5);
select public.set_card_pay_account(pg_temp.fx('card'), pg_temp.fx('bank'));
select public.card_purchase(pg_temp.fx('card'), '2026-09-05', 300.00, 1, pg_temp.fx('comp'), 'Tênis');
select public.card_purchase(pg_temp.fx('card'), '2026-09-28', 120.00, 1, pg_temp.fx('comp'), 'Livro');
select public.card_bill_due('2026-10-31');
select public.debt_pay(pg_temp.fx('card'), '2026-10-05', pg_temp.fx('bank'), 300.00);

-- ===========================================================================================================
-- Parte 1: Entradas x Saídas com assinaturas e lançamentos fixos previstos
-- ===========================================================================================================
-- Cartão Inter (fecha 25, vence 5 do mês SEGUINTE), pago pelo Banco: compra de 100 em 05/01/2030 e assinatura de 30
-- todo dia 10 desde 10/01/2030. A fatura de janeiro fecha 25/01 e vence 05/02: 100 da compra + 30 da assinatura.
insert into fixture select 'inter', public.create_debt('Inter', 'card', '2026-08-01', 0);
select public.set_card_cycle(pg_temp.fx('inter'), 25, 5);
select public.set_card_pay_account(pg_temp.fx('inter'), pg_temp.fx('bank'));
select public.card_purchase(pg_temp.fx('inter'), '2030-01-05', 100.00, 1, pg_temp.fx('comp'), 'Fone');
insert into fixture select 'r_card', public.recurrence_create('card', 'Streaming', 30.00, 10, '2030-01-10', null, null, pg_temp.fx('inter'), pg_temp.fx('comp'));
-- lançamento fixo de conta: aluguel de 1.000 todo dia 15 desde 15/01/2030 (só a de janeiro já foi gerada)
insert into fixture select 'r_alug', public.recurrence_create('expense', 'Aluguel', 1000.00, 15, '2030-01-15', pg_temp.fx('bank'), null, null, pg_temp.fx('comp'));
-- (a geração grava recurrence_id e occurrence_date, que o cliente não informa: simulada como superusuário)
reset role;
insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status, recurrence_id, occurrence_date, created_by)
values (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('comp'), 'expense', 'Aluguel', 1000.00, '2030-01-15', 'planned',
        pg_temp.fx('r_alug'), '2030-01-15', '00000000-0000-0000-0000-0000000067a1');
select pg_temp.login('00000000-0000-0000-0000-0000000067a1');
-- transferência fixa de 100 do Banco para a Poupança todo dia 20 desde 20/01/2030, nada gerado (não é entrada nem saída da família)
insert into fixture select 'r_transf', public.recurrence_create('transfer', 'Reserva', 100.00, 20, '2030-01-20', pg_temp.fx('bank'), pg_temp.fx('poup'));
-- e um salário fixo de 4.000 todo dia 5 desde 05/03/2030, nada gerado
insert into fixture select 'r_sal', public.recurrence_create('income', 'Salário fixo', 4000.00, 5, '2030-03-05', pg_temp.fx('bank'), null, null, pg_temp.fx('sal'));

select is((select string_agg(due_date || '=' || total::numeric(14,2), ' ' order by due_date) from public.card_months(pg_temp.fx('inter'))),
          '2030-02-05=100.00', 'P0 fixture: a fatura de janeiro/2030 do Inter (vence 05/02) tem só a compra de 100');
select is((select total from public.card_pending_subscriptions(pg_temp.fx('h'), '2030-01-20') where debt_id = pg_temp.fx('inter')), 30.00::numeric,
          'P0.1 fixture: 30 de assinatura prevista na fatura aberta (card_pending_subscriptions)');

-- P1 fatura que fecha num mês e vence no outro, com assinatura prevista: sai no VENCIMENTO (05/02), compra + assinatura, uma vez
select is(pg_temp.saidas('2030-01-01', '2030-02-28'), '2030-01-15:1000.00 2030-02-05:130.00 2030-02-15:1000.00',
          'P1 com não pagos: 05/02 = 100 + 30 (assinatura prevista); nada no fechamento (25/01) nem no dia da assinatura (10/01); aluguel de fev previsto');
select is(pg_temp.saidas('2030-01-01', '2030-02-28', false), null, 'P1.1 só pagos: nada (tudo é previsto)');
select is((select sum(expense)::numeric(14,2) from public.cash_flow_series(pg_temp.fx('h'), '2030-01-01', '2030-02-28', 'total', null, null, true)),
          2130.00::numeric, 'P1.2 acumulado: 1000 + 130 + 1000');
select is(pg_temp.saidas('2030-01-01', '2030-02-28')::text,
          (select string_agg(period_start || ':' || expense::numeric(14,2), ' ' order by period_start)
             from public.cash_flow_series(pg_temp.fx('h'), '2030-01-01', '2030-02-28', 'day', array[pg_temp.fx('bank')], null, true) where expense <> 0),
          'P1.3 filtro da conta de pagamento (Banco): o mesmo (a assinatura prevista entra pela conta de pagamento do cartão)');
select is((select sum(expense)::numeric(14,2) from public.cash_flow_series(pg_temp.fx('h'), '2030-01-01', '2030-02-28', 'total', array[pg_temp.fx('poup')], null, true)),
          0.00::numeric, 'P1.4 filtro de outra conta: nada');

-- P2 o saldo anda junto com o resultado, todo dia (o saldo previsto desconta a assinatura no vencimento)
select is((select string_agg(period_start::text, ',') from (
             select period_start, closing_balance - lag(closing_balance) over (order by period_start) = result as ok
               from public.cash_flow_series(pg_temp.fx('h'), '2030-01-01', '2030-04-30', 'day', null, null, true)) x where not ok),
          null, 'P2 saldo de hoje − saldo de ontem = resultado de hoje, de jan a abr/2030 (assinaturas e fixos previstos inclusos)');
select is((select closing_balance from public.cash_flow_series(pg_temp.fx('h'), '2030-02-05', '2030-02-05', 'day', null, null, true))
          - (select total from public.balance_totals_projected(pg_temp.fx('h'), '2030-02-05', true)),
          -30.00::numeric, 'P2.1 em 05/02 o saldo = balance_totals_projected − a assinatura prevista que venceu ali (30); a de 10/02 vence só em 05/03');

-- P3 a assinatura vira compra (simula recurrence_materialize no dia 10/01): já está no total da fatura e sai da previsão
reset role;
insert into public.debt_installments (household_id, debt_id, plan, seq, due_date, face, category_id, description,
                                      purchase_date, closing_day, due_day, recurrence_id, occurrence_date)
values (pg_temp.fx('h'), pg_temp.fx('inter'), gen_random_uuid()::text, 1, '2030-01-25', 30.00, pg_temp.fx('comp'), 'Streaming',
        '2030-01-10', 25, 5, pg_temp.fx('r_card'), '2030-01-10');
select pg_temp.login('00000000-0000-0000-0000-0000000067a1');
select is((select string_agg(due_date || '=' || total::numeric(14,2), ' ' order by due_date) from public.card_months(pg_temp.fx('inter'))),
          '2030-02-05=130.00', 'P3 fixture: a fatura de janeiro agora tem a compra + a assinatura gerada (130)');
select is(pg_temp.saidas('2030-01-01', '2030-02-28'), '2030-01-15:1000.00 2030-02-05:130.00 2030-02-15:1000.00',
          'P3.1 depois de gerada, continua 130 em 05/02: a assinatura conta uma vez só (não 160)');
select is((select string_agg(period_start::text, ',') from (
             select period_start, closing_balance - lag(closing_balance) over (order by period_start) = result as ok
               from public.cash_flow_series(pg_temp.fx('h'), '2030-01-01', '2030-04-30', 'day', null, null, true)) x where not ok),
          null, 'P3.2 o saldo continua andando junto com o resultado');

-- P4 lançamento fixo de conta futuro (nunca gerado): entra como planejado, só com não pagos, sem duplicar o gerado
select is((select string_agg(to_char(period_start, 'YYYY-MM') || ':' || income::numeric(14,2) || '/' || expense::numeric(14,2), ' ' order by period_start)
             from public.cash_flow_series(pg_temp.fx('h'), '2030-01-01', '2030-04-30', 'month', null, null, true)),
          '2030-01:0.00/1000.00 2030-02:0.00/1130.00 2030-03:4000.00/1030.00 2030-04:4000.00/1030.00',
          'P4 jan: o aluguel gerado (1x); fev em diante: aluguel previsto; mar e abr: salário fixo previsto; assinatura de 30 no vencimento de cada fatura');
select is((select string_agg(to_char(period_start, 'YYYY-MM') || ':' || income::numeric(14,2) || '/' || expense::numeric(14,2), ' ' order by period_start)
             from public.cash_flow_series(pg_temp.fx('h'), '2030-01-01', '2030-04-30', 'month')),
          '2030-01:0.00/0.00 2030-02:0.00/0.00 2030-03:0.00/0.00 2030-04:0.00/0.00', 'P4.1 só pagos: os fixos previstos não entram');
-- a ocorrência de fevereiro é gerada e PAGA; a de março é gerada e vai para a lixeira: nenhuma é prevista de novo
reset role;
insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status, recurrence_id, occurrence_date, created_by, deleted_at)
values (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('comp'), 'expense', 'Aluguel', 1000.00, '2030-02-15', 'paid',
        pg_temp.fx('r_alug'), '2030-02-15', '00000000-0000-0000-0000-0000000067a1', null),
       (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('comp'), 'expense', 'Aluguel', 1000.00, '2030-03-15', 'planned',
        pg_temp.fx('r_alug'), '2030-03-15', '00000000-0000-0000-0000-0000000067a1', null);
update public.transactions set deleted_at = now() where recurrence_id = pg_temp.fx('r_alug') and occurrence_date = '2030-03-15';
select pg_temp.login('00000000-0000-0000-0000-0000000067a1');
select is((select string_agg(to_char(period_start, 'YYYY-MM') || ':' || expense::numeric(14,2), ' ' order by period_start)
             from public.cash_flow_series(pg_temp.fx('h'), '2030-02-01', '2030-04-30', 'month', null, null, true)),
          '2030-02:1130.00 2030-03:30.00 2030-04:1030.00',
          'P4.2 fev gerado e pago: 1x; mar gerado e excluído: não volta como previsto; abr ainda previsto');
select is((select sum(expense)::numeric(14,2) from public.cash_flow_series(pg_temp.fx('h'), '2030-02-01', '2030-02-28', 'total', null, '00000000-0000-0000-0000-0000000067a2', true)),
          0.00::numeric, 'P4.3 filtro de quem lançou: o fixo previsto é de quem criou a regra (outro autor: nada)');
select is((select sum(income)::numeric(14,2) from public.cash_flow_series(pg_temp.fx('h'), '2030-03-01', '2030-03-31', 'total', null, '00000000-0000-0000-0000-0000000067a1', true)),
          4000.00::numeric, 'P4.4 ... e de quem criou: entra');
-- regra desativada: deixa de prever
reset role;
update public.recurrences set active = false where id = pg_temp.fx('r_sal');
select pg_temp.login('00000000-0000-0000-0000-0000000067a1');
select is((select sum(income)::numeric(14,2) from public.cash_flow_series(pg_temp.fx('h'), '2030-03-01', '2030-04-30', 'total', null, null, true)),
          0.00::numeric, 'P4.5 recorrente desativado: nada previsto');
reset role;
update public.recurrences set active = true where id = pg_temp.fx('r_sal');
select pg_temp.login('00000000-0000-0000-0000-0000000067a1');

-- ===========================================================================================================
-- Parte 2: Relatório › Contas
-- ===========================================================================================================
-- C1 setembro, só pagos: Banco 1000 + 500 − 200 − 200 (transferência) = 1100; Poupança abre em 15/09 com 50 + 200 = 250.
-- Nomad (USD) e Antiga (desativada) ficam fora. A compra no cartão não sai no fechamento.
select is(pg_temp.contas('2026-09-01', '2026-09-30'),
          'Banco:1000.00/500.00/400.00/0.00/200.00/1100.00 Poupança:50.00/200.00/0.00/200.00/0.00/250.00',
          'C1 uma linha por conta ativa em reais; transferência como saída do Banco e entrada da Poupança');
select is(pg_temp.totais('2026-09-01', '2026-09-30'), '1050.00/500.00/200.00/0.00/1350.00',
          'C1.1 total: as transferências não inflam (entradas 500, saídas 200) e fecham em zero');
select is((select string_agg(closing_balance::numeric(14,2)::text, ',' order by name) from public.account_flow_report(pg_temp.fx('h'), '2026-09-01', '2026-09-30')),
          (select string_agg(balance::numeric(14,2)::text, ',' order by name) from public.account_balances(pg_temp.fx('h'), '2026-09-30') where name in ('Banco', 'Poupança')),
          'C1.2 saldo final = account_balances no fim do período');
-- C2 outubro: o pagamento da fatura (300) sai do Banco em 05/10, na data do pagamento
select is(pg_temp.contas('2026-10-01', '2026-10-31'),
          'Banco:1100.00/0.00/300.00/0.00/0.00/800.00 Poupança:250.00/0.00/0.00/0.00/0.00/250.00', 'C2 outubro: pagamento da fatura no Banco');
-- C3 com não pagos: o planejado de 50 (10/09) e a fatura a pagar de 120 (vence 05/11) pela conta de pagamento
select is(pg_temp.contas('2026-09-01', '2026-11-30', true),
          'Banco:1000.00/500.00/870.00/0.00/200.00/630.00 Poupança:50.00/200.00/0.00/200.00/0.00/250.00',
          'C3 set–nov com não pagos: 200 + 50 + 200 (transf.) + 300 (pago) + 120 (a pagar, no vencimento)');
select is((select closing_balance from public.account_flow_report(pg_temp.fx('h'), '2026-09-01', '2026-11-30', true) where account_id = pg_temp.fx('bank')),
          (select balance from public.account_balances_projected(pg_temp.fx('h'), '2026-11-30', true) where account_id = pg_temp.fx('bank')),
          'C3.1 saldo final com não pagos = account_balances_projected (nada previsto em 2026)');
-- C4 inicial + entradas − saídas = final, por conta, em vários períodos, com e sem não pagos (inclui os previstos de 2030)
select is(pg_temp.nao_fecham(de::date, ate::date, plan), null, 'C4 fecha por conta: ' || de || '..' || ate || ' não pagos=' || plan)
  from (values ('2026-09-01', '2026-09-30'), ('2026-09-16', '2026-10-15'), ('2026-08-01', '2026-12-31'),
               ('2030-01-01', '2030-01-31'), ('2030-02-01', '2030-04-30'), ('2026-10-01', '2030-06-30')) p(de, ate)
 cross join (values (false), (true)) q(plan);
select is((select count(*) from public.account_flow_report(pg_temp.fx('h'), '2026-08-01', '2030-06-30', true)
            where total_closing <> total_opening + total_income - total_expense + total_transfers), 0::bigint,
          'C4.1 o total também fecha: inicial + entradas − saídas + transferências (0) = final');
-- C5 com não pagos, a aba Contas segue a mesma regra: assinatura prevista no vencimento e fixos previstos
select is(pg_temp.contas('2030-04-01', '2030-04-30', true) ~ '^Banco:[-0-9.]+/4000\.00/1130\.00/0\.00/100\.00/', true,
          'C5 abril/2030 no Banco: salário fixo previsto (4000), aluguel previsto (1000), assinatura prevista (30) no vencimento e a transferência fixa (100)');
select is((select a.closing_balance - a.opening_balance + a.transfer_out - a.transfer_in from public.account_flow_report(pg_temp.fx('h'), '2030-04-01', '2030-04-30', true) a where a.account_id = pg_temp.fx('bank')),
          (select sum(result) from public.cash_flow_series(pg_temp.fx('h'), '2030-04-01', '2030-04-30', 'total', array[pg_temp.fx('bank')], null, true)),
          'C5.1 a variação do Banco em abril/2030, sem as transferências, = o resultado de Entradas x Saídas filtrado pelo Banco');
select is((select sum(a.income - a.transfer_in)::numeric(14,2) from public.account_flow_report(pg_temp.fx('h'), '2026-09-01', '2026-09-30') a),
          (select max(total_income)::numeric(14,2) from public.account_flow_report(pg_temp.fx('h'), '2026-09-01', '2026-09-30')),
          'C5.2 total de entradas = soma das linhas sem as transferências');

-- C5.3 transferência fixa prevista: sai do Banco e entra na Poupança, e no total fecha em zero
select is((select string_agg(name || ':' || transfer_in::numeric(14,2) || '/' || transfer_out::numeric(14,2) || '/' || total_transfers::numeric(14,2), ' ' order by name)
             from public.account_flow_report(pg_temp.fx('h'), '2030-01-01', '2030-04-30', true)),
          'Banco:0.00/400.00/0.00 Poupança:400.00/0.00/0.00', 'C5.3 4 transferências fixas previstas de 100: Banco −400, Poupança +400, total 0');
select is((select total_income::numeric(14,2) || '/' || total_expense::numeric(14,2) from public.account_flow_report(pg_temp.fx('h'), '2030-01-01', '2030-04-30', true) limit 1),
          (select total_income::numeric(14,2) || '/' || total_expense::numeric(14,2) from public.cash_flow_series(pg_temp.fx('h'), '2030-01-01', '2030-04-30', 'total', null, null, true)),
          'C5.4 em 2030 (só lançamentos, cartão e fixos), o total de Contas = Entradas x Saídas: as transferências não inflam');

-- C6 recusas
select is(pg_temp.sqlstate_of($$select * from public.account_flow_report(pg_temp.fx('h'), '2026-09-30', '2026-09-01')$$), '22023', 'C6 período invertido');
select is(pg_temp.sqlstate_of($$select * from public.account_flow_report(pg_temp.fx('h'), '2016-01-01', '2026-12-31')$$), '22023', 'C6.1 mais de 10 anos');
select is(pg_temp.sqlstate_of($$select * from public.account_flow_report(pg_temp.fx('h'), null, '2026-12-31')$$), '22023', 'C6.2 início nulo');

-- C7 outra família e anon
select pg_temp.login('00000000-0000-0000-0000-0000000067a2');
insert into fixture select 'h2', public.create_household('Casa Outra');
select is((select count(*) from public.account_flow_report(pg_temp.fx('h'), '2026-09-01', '2026-09-30', true)), 0::bigint, 'C7 quem não é da família: zero linhas');
select is((select count(*) from public.cash_flow_series(pg_temp.fx('h'), '2030-01-01', '2030-02-28', 'day', null, null, true) where expense <> 0), 0::bigint,
          'C7.1 nem as previstas de Entradas x Saídas');
select is((select count(*) from private.card_pending_by_due(pg_temp.fx('h'), null, '2030-12-31')), 0::bigint, 'C7.2 nem as assinaturas previstas (RLS)');
select is((select count(*) from private.account_recurrence_pending(pg_temp.fx('h'), null, '2030-12-31')), 0::bigint, 'C7.3 nem os fixos previstos (RLS)');
select set_config('request.jwt.claims', '{}', true), set_config('role', 'anon', true);
select is(pg_temp.sqlstate_of($$select * from public.account_flow_report(pg_temp.fx('h'), '2026-09-01', '2026-09-30')$$), '42501', 'C7.4 anon não executa');
select is(pg_temp.sqlstate_of($$select * from private.card_pending_by_due(pg_temp.fx('h'), null, '2030-12-31')$$), '42501', 'C7.5 anon não executa o auxiliar');

select * from finish();
rollback;
