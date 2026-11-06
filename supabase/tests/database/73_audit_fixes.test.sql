-- 73_audit_fixes: migration 073 (auditoria de dinheiro de 06/11/2026, #191). Falha sem a migration.
--   C1  Entradas x Saídas: o Saldo de cada linha = balance_totals_projected no fim da linha, mesmo com crédito de
--       empréstimo na conta e conta nova aberta no período (antes só somava o resultado). Entradas/saídas não mudam.
--   I1  Recorrente em conta arquivada (ou transferência para conta arquivada) não entra no resumo dos recorrentes nem
--       na renda regular esperada do Início; assinatura de cartão continua.
--   I2  Início › Resultado do mês "Até hoje" não conta receita/despesa paga com data depois de p_as_of.
-- Datas fixas (setembro/2026) onde a função recebe a data; dados inventados.
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
-- "início..fim:entrada/saída/resultado/saldo" de cada linha
create function pg_temp.serie(p_h uuid, p_step text, p_de date, p_ate date, p_plan boolean default false) returns text language sql as $f$
  select string_agg(period_start || '..' || period_end || ':' || income::numeric(14,2) || '/' || expense::numeric(14,2) || '/'
                    || result::numeric(14,2) || '/' || coalesce(closing_balance::numeric(14,2)::text, '-'), ' ' order by period_start)
    from public.cash_flow_series(p_h, p_de, p_ate, p_step, null, null, p_plan) $f$;
-- linhas cujo Saldo difere de balance_totals_projected no fim da linha (limitado a p_ate); '' = nenhuma
create function pg_temp.divergentes(p_h uuid, p_step text, p_de date, p_ate date, p_plan boolean) returns text language sql as $f$
  select coalesce(string_agg(s.period_start || '=' || s.closing_balance::numeric(14,2) || '≠' || b.total::numeric(14,2), ' ' order by s.period_start), '')
    from public.cash_flow_series(p_h, p_de, p_ate, p_step, null, null, p_plan) s
   cross join lateral public.balance_totals_projected(p_h, least(s.period_end, p_ate), p_plan) b
   where s.closing_balance is distinct from b.total $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.serie(uuid, text, date, date, boolean),
  pg_temp.divergentes(uuid, text, date, date, boolean) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000074a1', 'auditoria-a@teste.com'),
  ('00000000-0000-0000-0000-0000000074a2', 'auditoria-b@teste.com');

-- =====================================================================================================================
-- C1. Saldo de Entradas x Saídas com crédito de empréstimo e conta aberta no período
-- =====================================================================================================================
select pg_temp.login('00000000-0000-0000-0000-0000000074a1');
insert into fixture select 'h', public.create_household('Casa Auditoria');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 1000.00, '2026-08-01') returning id)
  insert into fixture select 'bank', id from i;
insert into fixture select 'loan', public.create_debt('Empréstimo', 'loan', '2026-08-01', 0);
-- crédito do empréstimo de 5.000 no Banco em 10/09 (não é receita)
select public.debt_loan_event(pg_temp.fx('loan'), '2026-09-10', 'disbursement', pg_temp.fx('bank'), 5000.00);
-- conta nova aberta em 15/09 com 2.000
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Reserva', 'savings', 2000.00, '2026-09-15') returning id)
  insert into fixture select 'res', id from i;
-- pagamento de 1.000 do empréstimo em 25/09 (principal = despesa, migration 046)
select public.debt_pay(pg_temp.fx('loan'), '2026-09-25', pg_temp.fx('bank'), 1000.00);

select is((select total from public.balance_totals_projected(pg_temp.fx('h'), '2026-09-30', false)), 7000.00::numeric,
          'C1.0 fixture: saldo em 30/09 = 1.000 + 5.000 + 2.000 − 1.000 = 7.000');
select is(pg_temp.serie(pg_temp.fx('h'), 'week', '2026-09-01', '2026-09-30'),
          '2026-08-31..2026-09-06:0.00/0.00/0.00/1000.00 '
          || '2026-09-07..2026-09-13:0.00/0.00/0.00/6000.00 '
          || '2026-09-14..2026-09-20:0.00/0.00/0.00/8000.00 '
          || '2026-09-21..2026-09-27:0.00/1000.00/-1000.00/7000.00 '
          || '2026-09-28..2026-10-04:0.00/0.00/0.00/7000.00',
          'C1.1 semanal: o crédito do empréstimo e a conta nova mexem só no Saldo; entradas/saídas/resultado iguais (antes terminava em 0,00)');
select is(pg_temp.divergentes(pg_temp.fx('h'), 'week', '2026-09-01', '2026-09-30', false), '',
          'C1.2 semanal, só efetuados: Saldo de cada linha = balance_totals_projected no fim da linha');
select is(pg_temp.divergentes(pg_temp.fx('h'), 'week', '2026-09-01', '2026-09-30', true), '',
          'C1.3 semanal, com não pagos: idem');
select is(pg_temp.divergentes(pg_temp.fx('h'), 'day', '2026-09-01', '2026-09-30', false), '',
          'C1.4 diário: o Saldo de cada um dos 30 dias bate');
select is(pg_temp.divergentes(pg_temp.fx('h'), 'month', '2026-08-01', '2026-10-31', true), '',
          'C1.5 mensal (ago–out): bate em cada mês');
select is(pg_temp.divergentes(pg_temp.fx('h'), 'total', '2026-09-01', '2026-09-30', false), '',
          'C1.6 acumulado: bate no fim do período');
-- conta aberta EXATAMENTE em p_from: o saldo de abertura (p_from − 1) não a conhece; entra no 1º dia
select is(pg_temp.divergentes(pg_temp.fx('h'), 'day', '2026-09-15', '2026-09-20', false), '',
          'C1.7 período começando no dia da abertura da conta nova: bate');
-- o crédito do empréstimo continua fora de Entradas x Saídas (decisão do dono) e o pagamento é saída
select is((select total_income::numeric(14,2) || '/' || total_expense::numeric(14,2)
             from public.cash_flow_series(pg_temp.fx('h'), '2026-09-01', '2026-09-30', 'total')),
          '0.00/1000.00', 'C1.8 totais iguais aos de antes: crédito do empréstimo não é entrada; o pagamento é saída');
-- filtro de conta: sem Saldo, como antes
select is((select count(*) from public.cash_flow_series(pg_temp.fx('h'), '2026-09-01', '2026-09-30', 'week', array[pg_temp.fx('bank')])
            where closing_balance is not null), 0::bigint, 'C1.9 com filtro de conta o Saldo continua vazio');
-- anulado não conta
select public.debt_void((select id from public.debt_events where debt_id = pg_temp.fx('loan') and kind = 'payment'), 'teste');
select is(pg_temp.divergentes(pg_temp.fx('h'), 'week', '2026-09-01', '2026-09-30', false), '',
          'C1.10 depois de anular o pagamento: continua batendo');

-- =====================================================================================================================
-- I1/I2. Recorrente em conta arquivada e "Até hoje" do Início
-- =====================================================================================================================
select pg_temp.login('00000000-0000-0000-0000-0000000074a2');
insert into fixture select 'h2', public.create_household('Casa Arquivada');
insert into public.accounts (household_id, name, type, initial_balance, opening_date) values
  (pg_temp.fx('h2'), 'Corrente', 'checking', 0, '2026-01-01'),
  (pg_temp.fx('h2'), 'Antiga', 'checking', 0, '2026-01-01');
insert into fixture select 'cc', id from public.accounts where household_id = pg_temp.fx('h2') and name = 'Corrente';
insert into fixture select 'old', id from public.accounts where household_id = pg_temp.fx('h2') and name = 'Antiga';
insert into fixture select 'cexp', id from public.categories where household_id = pg_temp.fx('h2') and type = 'expense' and system_key = 'uncategorized';
insert into fixture select 'sal', id from public.categories where household_id = pg_temp.fx('h2') and name = 'Salário' and type = 'income';
insert into fixture select 'card', public.create_debt('Cartão', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('card'), 10, 20);

-- resumo: inícios em 2030 (nada é gerado)
select public.recurrence_create('expense', 'Aluguel', 1000.00, 5, '2030-01-05', pg_temp.fx('cc'), null, null, pg_temp.fx('cexp'));
select public.recurrence_create('expense', 'Na antiga', 300.00, 5, '2030-01-05', pg_temp.fx('old'), null, null, pg_temp.fx('cexp'));
select public.recurrence_create('transfer', 'Para a antiga', 200.00, 6, '2030-01-06', pg_temp.fx('cc'), pg_temp.fx('old'));
select public.recurrence_create('card', 'Streaming', 50.00, 15, '2030-01-15', null, null, pg_temp.fx('card'), pg_temp.fx('cexp'));
-- renda esperada do mês fechado (agosto, para p_as_of = 10/09/2026): salário de 4.000 na Antiga e 1.000 na Corrente
select public.recurrence_create('income', 'Salário antigo', 4000.00, 5, '2026-07-05', pg_temp.fx('old'), null, null, pg_temp.fx('sal'));
select public.recurrence_create('income', 'Salário', 1000.00, 5, '2026-07-05', pg_temp.fx('cc'), null, null, pg_temp.fx('sal'));
-- os lançamentos que as recorrentes já geraram vão para a lixeira (conta com planejado em aberto não arquiva)
update public.transactions set deleted_at = now() where household_id = pg_temp.fx('h2') and recurrence_id is not null;

select is((select regular_income_expected from public.home_indicators(pg_temp.fx('h2'), '2026-09-10')), 5000.00::numeric,
          'I1.0 com as duas contas ativas a renda esperada de agosto é 5.000');
update public.accounts set active = false where id = pg_temp.fx('old');
select is((select active from public.accounts where id = pg_temp.fx('old')), false, 'I1.1 fixture: a Antiga está arquivada');

select is((select x.item_count || '|' || x.total_monthly::numeric(14,2) from public.recurrence_summary(pg_temp.fx('h2')) x
            where x.grouping_level = 'medium' and x.medium = 'account' and x.kind = 'expense'),
          '1|1000.00', 'I1.2 despesa recorrente na conta arquivada sai do total da conta');
select is((select count(*) from public.recurrence_summary(pg_temp.fx('h2')) x where x.target_id = pg_temp.fx('old')), 0::bigint,
          'I1.3 a conta arquivada não aparece no resumo');
select is((select count(*) from public.recurrence_summary(pg_temp.fx('h2')) x where x.kind = 'transfer'), 0::bigint,
          'I1.4 transferência para conta arquivada também sai (a geração pula)');
select is((select x.item_count || '|' || x.total_monthly::numeric(14,2) from public.recurrence_summary(pg_temp.fx('h2')) x
            where x.grouping_level = 'medium' and x.medium = 'card' and x.kind = 'expense'),
          '1|50.00', 'I1.5 assinatura de cartão continua');
select is((select x.item_count || '|' || x.total_monthly::numeric(14,2) from public.recurrence_summary(pg_temp.fx('h2')) x
            where x.grouping_level = 'medium' and x.medium = 'account' and x.kind = 'income'),
          '1|1000.00', 'I1.6 receita recorrente da conta arquivada sai do resumo');
select is((select regular_income_expected from public.home_indicators(pg_temp.fx('h2'), '2026-09-10')), 1000.00::numeric,
          'I1.7 Início: a renda regular esperada não conta recorrente da conta arquivada');

-- I2: receita paga com data futura dentro do mês (20/09) não entra no "Até hoje" de 10/09
insert into public.transactions (household_id, account_id, category_id, type, status, amount, date, description) values
  (pg_temp.fx('h2'), pg_temp.fx('cc'), pg_temp.fx('sal'), 'income', 'paid', 700.00, '2026-09-08', 'Já caiu'),
  (pg_temp.fx('h2'), pg_temp.fx('cc'), pg_temp.fx('sal'), 'income', 'paid', 300.00, '2026-09-20', 'Pago com data futura'),
  (pg_temp.fx('h2'), pg_temp.fx('cc'), pg_temp.fx('cexp'), 'expense', 'paid', 100.00, '2026-09-25', 'Despesa com data futura');
select is((select income::numeric(14,2) || '/' || expense::numeric(14,2) || '/' || result::numeric(14,2)
             from public.home_indicators(pg_temp.fx('h2'), '2026-09-10')),
          '700.00/0.00/700.00', 'I2.1 Resultado do mês "Até hoje": só o pago até p_as_of');
select is((select income::numeric(14,2) || '/' || expense::numeric(14,2) || '/' || result::numeric(14,2)
             from public.home_indicators(pg_temp.fx('h2'), '2026-09-30')),
          '1000.00/100.00/900.00', 'I2.2 no último dia do mês, o mês inteiro');
select is((select result from public.home_indicators(pg_temp.fx('h2'), '2026-09-10')),
          (select result from public.period_summary(pg_temp.fx('h2'), '2026-09-01', '2026-09-10')),
          'I2.3 = period_summary do 1º dia do mês até p_as_of');

select * from finish();
rollback;
