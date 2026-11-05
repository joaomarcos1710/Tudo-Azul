-- 66_cash_flow_series: migration 066. Entradas x Saídas SÓ do período escolhido, fatiado por dia/semana/mês ou numa linha
-- (acumulado), com o saldo no fim de cada linha, numa chamada só. Datas fixas (setembro/2026): nada depende do relógio.
-- 01/09/2026 é terça; 30/09/2026 é quarta: a 1ª semana começa em 31/08 e a última termina em 04/10.
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
-- "início..fim:entrada/saída/resultado/saldo" de cada linha, separadas por espaço (saldo nulo = "-")
create function pg_temp.serie(p_step text, p_de date, p_ate date, p_contas uuid[] default null, p_membro uuid default null, p_plan boolean default false) returns text language sql as $f$
  select string_agg(period_start || '..' || period_end || ':' || income::numeric(14,2) || '/' || expense::numeric(14,2) || '/'
                    || result::numeric(14,2) || '/' || coalesce(closing_balance::numeric(14,2)::text, '-'), ' ' order by period_start)
    from public.cash_flow_series(pg_temp.fx('h'), p_de, p_ate, p_step, p_contas, p_membro, p_plan) $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.sqlstate_of(text),
  pg_temp.serie(text, date, date, uuid[], uuid, boolean) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000066a1', 's1@teste.com'),
  ('00000000-0000-0000-0000-0000000066a2', 's2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000066a1');
insert into fixture select 'h', public.create_household('Casa Série');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 1000.00, '2026-08-01') returning id)
  insert into fixture select 'bank', id from i;
insert into fixture select 'sal', id from public.categories where household_id = pg_temp.fx('h') and name = 'Salário';
insert into fixture select 'comp', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';

insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status) values
  (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('sal'),  'income',  'Antes do período', 70.00, '2026-08-31', 'paid'),
  (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('sal'),  'income',  'Salário',         500.00, '2026-09-01', 'paid'),
  (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('comp'), 'expense', 'Mercado',         200.00, '2026-09-08', 'paid'),
  (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('comp'), 'expense', 'Previsto',         50.00, '2026-09-10', 'planned'),
  (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('comp'), 'expense', 'Depois do período', 40.00, '2026-10-02', 'paid');
-- cartão que FECHA num mês e VENCE no outro (fecha 25, vence 5): compra de 300 em 05/09 fecha 25/09, vence 05/10 e é
-- paga em 05/10 pelo Banco; compra de 120 em 28/09 fecha 25/10, vence 05/11 e fica sem pagar
insert into fixture select 'card', public.create_debt('Nubank', 'card', '2026-08-01', 0);
select public.set_card_cycle(pg_temp.fx('card'), 25, 5);
select public.card_purchase(pg_temp.fx('card'), '2026-09-05', 300.00, 1, pg_temp.fx('comp'), 'Tênis');
select public.card_purchase(pg_temp.fx('card'), '2026-09-28', 120.00, 1, pg_temp.fx('comp'), 'Livro');
select public.card_bill_due('2026-10-31');
select public.debt_pay(pg_temp.fx('card'), '2026-10-05', pg_temp.fx('bank'), 300.00);
-- a de outubro (120, vence 05/11) é paga EM PARTE: 50 em 03/11
select public.debt_pay(pg_temp.fx('card'), '2026-11-03', pg_temp.fx('bank'), 50.00,
                       (select invoice_id from public.card_months(pg_temp.fx('card')) where due_date = '2026-11-05'));
select is((select string_agg(due_date || '=' || total::numeric(14,2) || '/' || paid::numeric(14,2), ' ' order by due_date)
             from public.card_months(pg_temp.fx('card'))),
          '2026-10-05=300.00/300.00 2026-11-05=120.00/50.00', 'S0 fixture: fatura de set vence 05/10 (paga); a de out vence 05/11 (paga em parte)');

-- S1 semanal: só as semanas que tocam setembro (31/08 a 04/10), com os valores SÓ de setembro; o fechamento (25/09) não é saída
select is(pg_temp.serie('week', '2026-09-01', '2026-09-30'),
          '2026-08-31..2026-09-06:500.00/0.00/500.00/1570.00 '
          || '2026-09-07..2026-09-13:0.00/200.00/-200.00/1370.00 '
          || '2026-09-14..2026-09-20:0.00/0.00/0.00/1370.00 '
          || '2026-09-21..2026-09-27:0.00/0.00/0.00/1370.00 '
          || '2026-09-28..2026-10-04:0.00/0.00/0.00/1370.00',
          'S1 5 semanas de segunda a domingo; 31/08 (70) e 02/10 (40) fora dos valores; a compra do cartão NÃO sai no fechamento');
select is((select closing_balance from public.cash_flow_series(pg_temp.fx('h'), '2026-09-01', '2026-09-30', 'week') where period_start = '2026-09-28'),
          (select total from public.balance_totals_projected(pg_temp.fx('h'), '2026-09-30', false)),
          'S1.1 saldo da última semana = o do fim do período (30/09), não o de 04/10');

-- S2 diário: 30 linhas; o dia é ele mesmo; o pagamento da fatura sai no dia do pagamento (05/10)
select is((select count(*) from public.cash_flow_series(pg_temp.fx('h'), '2026-09-01', '2026-09-30', 'day')), 30::bigint, 'S2 setembro diário = 30 linhas');
select is((select period_start || '..' || period_end from public.cash_flow_series(pg_temp.fx('h'), '2026-09-01', '2026-09-30', 'day') order by 1 limit 1),
          '2026-09-01..2026-09-01', 'S2.1 a 1ª linha é 01/09, começo e fim');
select is((select string_agg(closing_balance::numeric(14,2)::text, ',' order by period_start)
             from public.cash_flow_series(pg_temp.fx('h'), '2026-09-01', '2026-10-31', 'day')),
          (select string_agg((select b.total::numeric(14,2)::text from public.balance_totals_projected(pg_temp.fx('h'), d::date, false) b), ',' order by d)
             from generate_series('2026-09-01'::date, '2026-10-31'::date, interval '1 day') d),
          'S2.2 saldo de cada dia = balance_totals_projected naquele dia (uma chamada só da tela)');
select is((select string_agg(period_start || ':' || expense::numeric(14,2), ' ' order by period_start)
             from public.cash_flow_series(pg_temp.fx('h'), '2026-09-21', '2026-10-06', 'day') where expense <> 0),
          '2026-10-02:40.00 2026-10-05:300.00', 'S2.3 regime de caixa: fecha 25/09 = zero; paga 05/10 = −300 (o "28/11 zerado" do dono)');
select is((select string_agg(period_start || ':' || (lag_ok)::text, ' ' order by period_start) from (
             select period_start, closing_balance - lag(closing_balance) over (order by period_start) = result as lag_ok
               from public.cash_flow_series(pg_temp.fx('h'), '2026-09-02', '2026-10-31', 'day')) x where not lag_ok),
          null, 'S2.4 saldo anda junto com o resultado: saldo de hoje − saldo de ontem = resultado de hoje, todo dia');
select is((select sum(income)::numeric(14,2) || '/' || sum(expense)::numeric(14,2) from public.cash_flow_series(pg_temp.fx('h'), '2026-09-01', '2026-10-31', 'day')),
          (select max(total_income)::numeric(14,2) || '/' || max(total_expense)::numeric(14,2) from public.cash_flow_series(pg_temp.fx('h'), '2026-09-01', '2026-10-31', 'day')),
          'S2.5 os totais do banco batem com as linhas');

-- S3 acumulado ('total'): o período inteiro numa linha só; a compra conta uma vez só (no pagamento)
select is(pg_temp.serie('total', '2026-09-01', '2026-09-30'), '2026-09-01..2026-09-30:500.00/200.00/300.00/1370.00',
          'S3 setembro acumulado = 1 linha, de 01/09 a 30/09, saldo no fim; a compra de 300 não sai em setembro');
select is(pg_temp.serie('total', '2026-09-01', '2026-10-31'), '2026-09-01..2026-10-31:500.00/540.00/-40.00/1030.00',
          'S3.1 set+out: 200 + 40 + 300 (pagamento), nunca compra E pagamento');
select is((select count(*) from public.cash_flow_series(pg_temp.fx('h'), '2026-01-01', '2026-12-31', 'total')), 1::bigint, 'S3.2 o ano acumulado = 1 linha');
select is((select period_start || '..' || period_end from public.cash_flow_series(pg_temp.fx('h'), '2026-01-01', '2026-12-31', 'total')),
          '2026-01-01..2026-12-31', 'S3.3 a linha do ano vai de 01/01 a 31/12');
select is((select total_income::numeric(14,2) || '/' || total_expense::numeric(14,2) || '/' || total_result::numeric(14,2)
             from public.cash_flow_series(pg_temp.fx('h'), '2026-09-01', '2026-09-30', 'total')), '500.00/200.00/300.00', 'S3.4 totais no acumulado');
select is((select max(total_expense) from public.cash_flow_report(pg_temp.fx('h'), '2026-09-01', '2026-09-30', 'month')), 500.00::numeric,
          'S3.5 cash_flow_report (resumo, Início) continua na data da fatura: 200 + 300 em setembro');

-- S4 mensal: o ano tem 12 linhas; um período quebrado mostra os meses que ele toca, com os valores só dele
select is((select count(*) from public.cash_flow_series(pg_temp.fx('h'), '2026-01-01', '2026-12-31', 'month')), 12::bigint, 'S4 2026 mensal = 12 linhas');
select is(pg_temp.serie('month', '2026-08-31', '2026-10-01'),
          '2026-08-01..2026-08-31:70.00/0.00/70.00/1070.00 2026-09-01..2026-09-30:500.00/200.00/300.00/1370.00 2026-10-01..2026-10-31:0.00/0.00/0.00/1370.00',
          'S4.1 31/08 a 01/10: três meses; o saldo de outubro é o de 01/10 (fim do período)');

-- S5 considerar não pagos: o planejado entra; a fatura aberta sai no VENCIMENTO (05/11); a paga não sai de novo
select is(pg_temp.serie('month', '2026-09-01', '2026-11-30', null, null, true),
          '2026-09-01..2026-09-30:500.00/250.00/250.00/1320.00 2026-10-01..2026-10-31:0.00/340.00/-340.00/980.00 2026-11-01..2026-11-30:0.00/120.00/-120.00/860.00',
          'S5 com não pagos: 50 planejado em set; out só 40 + 300 pagos; a fatura de 120 em nov (pago + falta), não no fechamento (out)');
select is((select string_agg(period_start || ':' || expense::numeric(14,2), ' ' order by period_start)
             from public.cash_flow_series(pg_temp.fx('h'), '2026-10-20', '2026-11-10', 'day', null, null, true) where expense <> 0),
          '2026-11-03:50.00 2026-11-05:70.00', 'S5.2 paga em parte: 50 na data do pagamento (03/11), os 70 que faltam no vencimento (05/11)');
select is((select string_agg(period_start || ':' || expense::numeric(14,2), ' ' order by period_start)
             from public.cash_flow_series(pg_temp.fx('h'), '2026-10-20', '2026-11-10', 'day') where expense <> 0),
          '2026-11-03:50.00', 'S5.3 só pagos: só os 50 pagos, em 03/11; nada no fechamento (25/10)');
select is((select string_agg(closing_balance::numeric(14,2)::text, ',' order by period_start) from public.cash_flow_series(pg_temp.fx('h'), '2026-09-01', '2026-11-30', 'month', null, null, true)),
          (select string_agg((select b.total::numeric(14,2)::text from public.balance_totals_projected(pg_temp.fx('h'), d, true) b), ',' order by d)
             from unnest(array['2026-09-30', '2026-10-31', '2026-11-30']::date[]) d),
          'S5.1 saldo previsto = balance_totals_projected com planejados (a fatura sai do saldo no vencimento)');

-- S6 filtros: valores filtrados; o saldo fica nulo (balance_totals_projected não filtra por conta nem por autor)
select is(pg_temp.serie('total', '2026-10-01', '2026-10-31', array[pg_temp.fx('bank')]), '2026-10-01..2026-10-31:0.00/340.00/-340.00/-',
          'S6 só a conta Banco: o pagamento da fatura saiu dela e entra; saldo nulo');
select is(pg_temp.serie('total', '2026-09-01', '2026-10-31', null, '00000000-0000-0000-0000-0000000066a2'), '2026-09-01..2026-10-31:0.00/0.00/0.00/-',
          'S6.1 outro autor: zero e saldo nulo');

-- S7 entradas inválidas (as recusas de cash_flow_report, com 22023)
select is(pg_temp.sqlstate_of($$select * from public.cash_flow_series(pg_temp.fx('h'), '2026-09-01', '2026-09-30', 'ano')$$), '22023', 'S7 divisão inválida');
select is(pg_temp.sqlstate_of($$select * from public.cash_flow_series(pg_temp.fx('h'), '2026-09-01', '2026-09-30', null)$$), '22023', 'S7.1 divisão nula');
select is(pg_temp.sqlstate_of($$select * from public.cash_flow_series(pg_temp.fx('h'), '2026-09-30', '2026-09-01', 'total')$$), '22023', 'S7.2 período invertido');
select is(pg_temp.sqlstate_of($$select * from public.cash_flow_series(pg_temp.fx('h'), '2025-01-01', '2026-12-31', 'day')$$), '22023', 'S7.3 diário com mais de 366 dias');
select lives_ok($$select * from public.cash_flow_series(pg_temp.fx('h'), '2025-01-01', '2026-12-31', 'total')$$, 'S7.4 acumulado de 2 anos pode');

-- S8 outra família e anon
select pg_temp.login('00000000-0000-0000-0000-0000000066a2');
insert into fixture select 'h2', public.create_household('Casa Outra');
select is((select count(*) from public.cash_flow_series(pg_temp.fx('h'), '2026-09-01', '2026-09-30', 'week')), 0::bigint, 'S8 quem não é da família: zero linhas');
select is((select count(*) from public.cash_flow_series(pg_temp.fx('h'), '2026-09-01', '2026-09-30', 'total')), 0::bigint, 'S8.1 nem a linha do acumulado');
select set_config('request.jwt.claims', '{}', true), set_config('role', 'anon', true);
select is(pg_temp.sqlstate_of($$select * from public.cash_flow_series(pg_temp.fx('h'), '2026-09-01', '2026-09-30', 'total')$$), '42501', 'S8.2 anon não executa');

select * from finish();
rollback;
