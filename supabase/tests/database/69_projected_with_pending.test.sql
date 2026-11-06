-- 69_projected_with_pending: migration 069. O saldo previsto de todo o app (balance_totals_projected e
-- account_balances_projected: Calendário, "Saldo hoje e previsto" do Início, aviso diário) conta as assinaturas de cartão
-- previstas (no vencimento da fatura) e os lançamentos fixos de conta ainda não gerados, como os Relatórios desde a 068.
-- Invariantes: (1) os Relatórios não mudam de número; (2) o previsto no fim do período = saldo final de Entradas x
-- Saídas (total) e do Relatório › Contas (por conta); (3) sem planejados nada muda; (4) a assinatura que vira compra e o
-- fixo gerado contam uma vez só; (5) isolamento entre famílias, anon sem acesso, e o aviso diário (service_role) segue.
-- Datas fixas em 2030 (nada gerado pelo relógio); recurrence_materialize não é chamada: a geração é simulada como ela faz.
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
create function pg_temp.servidor() returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
end $f$;
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
-- saldo previsto total na data
create function pg_temp.btp(p_d date, p_plan boolean default true) returns numeric language sql as $f$
  select total from public.balance_totals_projected(pg_temp.fx('h'), p_d, p_plan) $f$;
-- saldo final de Entradas x Saídas no período (última linha)
create function pg_temp.cfs_fim(p_de date, p_ate date, p_step text, p_plan boolean default true) returns numeric language sql as $f$
  select closing_balance from public.cash_flow_series(pg_temp.fx('h'), p_de, p_ate, p_step, null, null, p_plan)
   order by period_start desc limit 1 $f$;
-- "conta:saldo previsto" (account_balances_projected) e "conta:saldo final" (account_flow_report), só contas em reais
create function pg_temp.abp(p_d date, p_plan boolean default true) returns text language sql as $f$
  select string_agg(name || ':' || balance::numeric(14,2), ' ' order by name)
    from public.account_balances_projected(pg_temp.fx('h'), p_d, p_plan) where currency_code = 'BRL' $f$;
create function pg_temp.afr_fim(p_de date, p_ate date, p_plan boolean default true) returns text language sql as $f$
  select string_agg(name || ':' || closing_balance::numeric(14,2), ' ' order by name)
    from public.account_flow_report(pg_temp.fx('h'), p_de, p_ate, p_plan) $f$;
-- impressão completa dos Relatórios (para comparar com os valores da 068)
create function pg_temp.cfs(p_de date, p_ate date, p_step text, p_plan boolean default true) returns text language sql as $f$
  select string_agg(period_start || '=' || income::numeric(14,2) || '/' || expense::numeric(14,2) || '/' || closing_balance::numeric(14,2),
                    ' ' order by period_start)
    from public.cash_flow_series(pg_temp.fx('h'), p_de, p_ate, p_step, null, null, p_plan) $f$;
create function pg_temp.afr(p_de date, p_ate date, p_plan boolean default true) returns text language sql as $f$
  select string_agg(name || ':' || opening_balance::numeric(14,2) || '/' || income::numeric(14,2) || '/' || expense::numeric(14,2)
                    || '/' || closing_balance::numeric(14,2), ' ' order by name)
    from public.account_flow_report(pg_temp.fx('h'), p_de, p_ate, p_plan) $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.servidor(), pg_temp.sqlstate_of(text),
  pg_temp.btp(date, boolean), pg_temp.cfs_fim(date, date, text, boolean), pg_temp.abp(date, boolean),
  pg_temp.afr_fim(date, date, boolean), pg_temp.cfs(date, date, text, boolean), pg_temp.afr(date, date, boolean) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000069a1', 'p1@teste.com'),
  ('00000000-0000-0000-0000-0000000069a2', 'p2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000069a1');
insert into fixture select 'h', public.create_household('Casa Previstos');
insert into fixture select 'sal', id from public.categories where household_id = pg_temp.fx('h') and name = 'Salário';
insert into fixture select 'comp', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 1000.00, '2029-12-01') returning id)
  insert into fixture select 'bank', id from i;
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Poupança', 'savings', 0.00, '2029-12-01') returning id)
  insert into fixture select 'poup', id from i;
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date, currency_code)
           values (pg_temp.fx('h'), 'Nomad', 'checking', 100.00, '2029-12-01', 'USD') returning id)
  insert into fixture select 'usd', id from i;
-- um planejado comum de 50 no Banco
insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status)
values (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('comp'), 'expense', 'Farmácia', 50.00, '2030-01-08', 'planned');
-- Inter (fecha 25, vence 5), pago pelo Banco: compra de 100 em 05/01 e assinatura de 30 todo dia 10 (nenhuma gerada)
insert into fixture select 'inter', public.create_debt('Inter', 'card', '2029-12-01', 0);
select public.set_card_cycle(pg_temp.fx('inter'), 25, 5);
select public.set_card_pay_account(pg_temp.fx('inter'), pg_temp.fx('bank'));
select public.card_purchase(pg_temp.fx('inter'), '2030-01-05', 100.00, 1, pg_temp.fx('comp'), 'Fone');
insert into fixture select 'r_card', public.recurrence_create('card', 'Streaming', 30.00, 10, '2030-01-10', null, null, pg_temp.fx('inter'), pg_temp.fx('comp'));
-- Loja (fecha 25, vence 5) SEM conta de pagamento: assinatura de 20 todo dia 12 (só no total, nunca numa conta)
insert into fixture select 'loja', public.create_debt('Loja', 'card', '2029-12-01', 0);
select public.set_card_cycle(pg_temp.fx('loja'), 25, 5);
insert into fixture select 'r_loja', public.recurrence_create('card', 'Clube', 20.00, 12, '2030-01-12', null, null, pg_temp.fx('loja'), pg_temp.fx('comp'));
-- lançamentos fixos de conta, nenhum gerado: aluguel 1.000 dia 15 (desde jan), salário 4.000 dia 5 (desde fev) e
-- transferência de 100 do Banco para a Poupança dia 20 (desde jan)
insert into fixture select 'r_alug', public.recurrence_create('expense', 'Aluguel', 1000.00, 15, '2030-01-15', pg_temp.fx('bank'), null, null, pg_temp.fx('comp'));
insert into fixture select 'r_sal', public.recurrence_create('income', 'Salário', 4000.00, 5, '2030-02-05', pg_temp.fx('bank'), null, null, pg_temp.fx('sal'));
insert into fixture select 'r_transf', public.recurrence_create('transfer', 'Reserva', 100.00, 20, '2030-01-20', pg_temp.fx('bank'), pg_temp.fx('poup'));
-- fixo numa conta em outra moeda: fica fora (como na 068)
insert into fixture select 'r_usd', public.recurrence_create('income', 'Freela', 10.00, 1, '2030-01-01', pg_temp.fx('usd'), null, null, pg_temp.fx('sal'));

-- ===========================================================================================================
-- 1. Os Relatórios não mudam de número (valores da 068, mesmos dados)
-- ===========================================================================================================
select is(pg_temp.cfs('2030-01-01', '2030-03-31', 'month'),
          '2030-01-01=0.00/1050.00/-50.00 2030-02-01=4000.00/1150.00/2800.00 2030-03-01=4000.00/1050.00/5750.00',
          'R1 Entradas x Saídas, jan–mar/2030 com não pagos: os mesmos números da 068');
select is(pg_temp.cfs('2030-02-01', '2030-03-31', 'month'),
          '2030-02-01=4000.00/1150.00/2800.00 2030-03-01=4000.00/1050.00/5750.00',
          'R1.1 começando em fevereiro (abertura com aluguel de jan previsto): igual, sem descontar duas vezes');
select is(pg_temp.cfs('2030-01-01', '2030-03-31', 'month', false),
          '2030-01-01=0.00/0.00/1000.00 2030-02-01=0.00/0.00/1000.00 2030-03-01=0.00/0.00/1000.00', 'R1.2 só pagos: igual');
select is(pg_temp.afr('2030-01-01', '2030-02-28'),
          'Banco:1000.00/4000.00/2380.00/2620.00 Poupança:0.00/200.00/0.00/200.00',
          'R2 Relatório › Contas jan–fev/2030 com não pagos: os mesmos números da 068');
select is(pg_temp.afr('2030-02-01', '2030-03-31'),
          'Banco:-150.00/8000.00/2360.00/5490.00 Poupança:100.00/200.00/0.00/300.00',
          'R2.1 começando em fevereiro: o saldo inicial (com o aluguel e a transferência de jan previstos) é o mesmo da 068');
select is(pg_temp.afr('2030-01-01', '2030-02-28', false),
          'Banco:1000.00/0.00/0.00/1000.00 Poupança:0.00/0.00/0.00/0.00', 'R2.2 só pagos: igual');

-- ===========================================================================================================
-- 2. O previsto do Calendário e do Início = o saldo final dos Relatórios
-- ===========================================================================================================
-- 28/02: 1000 − 50 − 2×1000 (aluguel) + 4000 (salário) − 100 (compra) − 30 (Streaming) − 20 (Clube, sem conta) = 2800
select is(pg_temp.btp('2030-02-28'), 2800.00::numeric,
          'P1 saldo previsto em 28/02 (Calendário/Início) desconta as assinaturas que vencem até ali e conta os fixos não gerados');
select is((select row(realized, planned, invoices, unassigned_invoices)::text from public.balance_totals_projected(pg_temp.fx('h'), '2030-02-28', true)),
          '(1000.00,1950.00,150.00,20.00)',
          'P1.1 detalhe: planejado 1950 (−50 −2000 +4000; a transferência fixa se anula), faturas 150 (100 + 30 + 20), sem conta 20');
select is(pg_temp.btp(d::date) - pg_temp.cfs_fim('2030-01-01', d::date, 'day'), 0.00::numeric,
          'P2 total: previsto em ' || d || ' = saldo final de Entradas x Saídas com não pagos (jan até ' || d || ')')
  from unnest(array['2030-01-09', '2030-01-31', '2030-02-05', '2030-02-28', '2030-03-31', '2030-06-30']) d;
select is(pg_temp.btp(d::date) - pg_temp.cfs_fim(de::date, d::date, 'month'), 0.00::numeric,
          'P2.1 total: previsto em ' || d || ' = saldo final de Entradas x Saídas (mês) desde ' || de)
  from (values ('2030-02-01', '2030-03-31'), ('2030-03-01', '2030-12-31'), ('2030-01-01', '2031-06-30')) p(de, d);
select is(pg_temp.abp(d::date), pg_temp.afr_fim(de::date, d::date),
          'P3 por conta: previsto em ' || d || ' = saldo final do Relatório › Contas desde ' || de)
  from (values ('2030-01-01', '2030-02-28'), ('2030-02-01', '2030-03-31'), ('2030-03-01', '2030-12-31'), ('2029-12-01', '2031-06-30')) p(de, d);
select is(pg_temp.abp('2030-02-28'), 'Banco:2620.00 Poupança:200.00',
          'P3.1 Banco: 1000 − 50 − 2000 + 4000 − 200 (transferências) − 130 (fatura + Streaming); Poupança: +200');
select is((select row(planned, invoices)::text from public.account_balances_projected(pg_temp.fx('h'), '2030-02-28', true) where account_id = pg_temp.fx('bank')),
          '(1750.00,130.00)', 'P3.2 Banco: os fixos entram em "planejado" e a assinatura em "faturas"');
select is((select row(planned, invoices, balance)::text from public.account_balances_projected(pg_temp.fx('h'), '2030-02-28', true) where account_id = pg_temp.fx('usd')),
          '(0,0,100.00)', 'P3.3 conta em outra moeda: o fixo previsto dela fica fora (como nos Relatórios)');

-- ===========================================================================================================
-- 3. Sem planejados, nada muda
-- ===========================================================================================================
select is((select row(realized, planned, invoices, unassigned_invoices, total)::text from public.balance_totals_projected(pg_temp.fx('h'), d::date, false)),
          (select '(' || total || ',0,0,0,' || total || ')' from public.balance_totals(pg_temp.fx('h'), d::date)),
          'S1 só efetuados em ' || d || ': o saldo de balance_totals, sem previstos')
  from unnest(array['2030-01-31', '2030-02-28', '2030-12-31']) d;
select is((select count(*) from public.account_balances_projected(pg_temp.fx('h'), '2030-12-31', false)
            where planned <> 0 or invoices <> 0 or balance <> realized), 0::bigint, 'S1.1 por conta, só efetuados: nenhum previsto');

-- ===========================================================================================================
-- 4. A assinatura que vira compra e o fixo gerado contam uma vez só
-- ===========================================================================================================
create temp table antes as
  select pg_temp.btp('2030-02-28') as total, pg_temp.abp('2030-02-28') as contas, pg_temp.btp('2030-06-30') as jun;
grant all on antes to public;
-- (simula recurrence_materialize: a geração grava recurrence_id e occurrence_date, que o cliente não informa)
reset role;
insert into public.debt_installments (household_id, debt_id, plan, seq, due_date, face, category_id, description,
                                      purchase_date, closing_day, due_day, recurrence_id, occurrence_date)
values (pg_temp.fx('h'), pg_temp.fx('inter'), gen_random_uuid()::text, 1, '2030-01-25', 30.00, pg_temp.fx('comp'), 'Streaming',
        '2030-01-10', 25, 5, pg_temp.fx('r_card'), '2030-01-10');
select pg_temp.login('00000000-0000-0000-0000-0000000069a1');
select is((select total::numeric(14,2) from public.card_months(pg_temp.fx('inter')) where due_date = '2030-02-05'), 130.00::numeric,
          'U0 fixture: a assinatura de janeiro virou parcela (fatura de 130)');
select is(pg_temp.btp('2030-02-28'), (select total from antes), 'U1 assinatura gerada: o previsto continua o mesmo (não desconta 2×)');
select is(pg_temp.abp('2030-02-28'), (select contas from antes), 'U1.1 ... e por conta também');
reset role;
insert into public.transactions (household_id, account_id, destination_account_id, category_id, type, description, amount, date, status,
                                 recurrence_id, occurrence_date, created_by)
values (pg_temp.fx('h'), pg_temp.fx('bank'), null, pg_temp.fx('comp'), 'expense', 'Aluguel', 1000.00, '2030-02-15', 'planned',
        pg_temp.fx('r_alug'), '2030-02-15', '00000000-0000-0000-0000-0000000069a1'),
       (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('poup'), null, 'transfer', 'Reserva', 100.00, '2030-01-20', 'planned',
        pg_temp.fx('r_transf'), '2030-01-20', '00000000-0000-0000-0000-0000000069a1');
select pg_temp.login('00000000-0000-0000-0000-0000000069a1');
select is(pg_temp.btp('2030-02-28'), (select total from antes), 'U2 fixos gerados (aluguel de fev e transferência de jan): o previsto não muda');
select is(pg_temp.abp('2030-02-28'), (select contas from antes), 'U2.1 ... e por conta também');
-- o aluguel de fevereiro é pago; o de março vai para a lixeira: não volta como previsto
reset role;
update public.transactions set status = 'paid' where recurrence_id = pg_temp.fx('r_alug') and occurrence_date = '2030-02-15';
insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status, recurrence_id, occurrence_date, created_by, deleted_at)
values (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('comp'), 'expense', 'Aluguel', 1000.00, '2030-03-15', 'planned',
        pg_temp.fx('r_alug'), '2030-03-15', '00000000-0000-0000-0000-0000000069a1', now());
select pg_temp.login('00000000-0000-0000-0000-0000000069a1');
select is(pg_temp.btp('2030-02-28'), (select total from antes), 'U3 fixo gerado e pago: conta uma vez');
select is(pg_temp.btp('2030-06-30'), (select jun from antes) + 1000.00, 'U3.1 fixo de março excluído: sai do previsto (+1000 em junho)');
select is(pg_temp.btp('2030-06-30') - pg_temp.cfs_fim('2030-01-01', '2030-06-30', 'month'), 0.00::numeric,
          'U3.2 e o previsto continua = o saldo final de Entradas x Saídas');
select is(pg_temp.abp('2030-06-30'), pg_temp.afr_fim('2030-01-01', '2030-06-30'), 'U3.3 ... e = o do Relatório › Contas por conta');

-- ===========================================================================================================
-- 5. Aviso diário, isolamento e anon
-- ===========================================================================================================
select is((select projected_balance from public.daily_digest(pg_temp.fx('h'), '2030-02-10')), 2800.00::numeric,
          'A1 aviso diário: o previsto do fim do mês é o mesmo do Início (com as assinaturas e os fixos)');
create temp table dono as select pg_temp.btp('2030-02-28') as v;
grant all on dono to public;
select pg_temp.servidor();
select is((select projected_balance from public.daily_digest_service(pg_temp.fx('h'), '2030-02-10')), (select v from dono),
          'A2 a Edge Function (service_role) lê o mesmo previsto (executa os auxiliares dos previstos)');
select pg_temp.login('00000000-0000-0000-0000-0000000069a2');
insert into fixture select 'h2', public.create_household('Casa Outra');
select is((select count(*) from public.balance_totals_projected(pg_temp.fx('h'), '2030-12-31', true)), 0::bigint,
          'A3 quem não é da família: nenhum saldo previsto');
select is((select count(*) from public.account_balances_projected(pg_temp.fx('h'), '2030-12-31', true)), 0::bigint,
          'A3.1 ... nem por conta');
select is((select total from public.balance_totals_projected(pg_temp.fx('h2'), '2030-12-31', true)), 0::numeric,
          'A3.2 a família dele não vê os previstos da outra (zero)');
select set_config('request.jwt.claims', '{}', true), set_config('role', 'anon', true);
select is(pg_temp.sqlstate_of($$select * from public.balance_totals_projected(pg_temp.fx('h'), '2030-12-31', true)$$), '42501', 'A4 anon não executa o total');
select is(pg_temp.sqlstate_of($$select * from public.account_balances_projected(pg_temp.fx('h'), '2030-12-31', true)$$), '42501', 'A4.1 nem por conta');
select is(pg_temp.sqlstate_of($$select * from private.account_recurrence_pending(pg_temp.fx('h'), null, '2030-12-31')$$), '42501', 'A4.2 nem o auxiliar dos fixos');

select * from finish();
rollback;
