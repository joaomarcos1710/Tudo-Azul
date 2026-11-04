-- 56_foreign_currency_income_expense: migration 056. Multimoeda F2: receita e despesa em conta estrangeira, transferência
-- só entre contas da mesma moeda, relatórios em reais só com contas BRL e o resultado por moeda à parte.
-- Datas relativas a hoje em São Paulo; nada depende de data fixa nem do fuso do servidor. Sem dado real.
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
create function pg_temp.hoje() returns date language sql as $f$ select (now() at time zone 'America/Sao_Paulo')::date $f$;
create function pg_temp.ini() returns date language sql as $f$ select date_trunc('month', pg_temp.hoje())::date $f$;
create function pg_temp.fim() returns date language sql as $f$
  select (date_trunc('month', pg_temp.hoje()) + interval '1 month - 1 day')::date $f$;
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
create function pg_temp.erro_de(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlerrm; end $f$;
create function pg_temp.conta(p_k text, p_nome text, p_saldo numeric, p_moeda text) returns uuid language plpgsql as $f$
declare v uuid;
begin
  insert into public.accounts (household_id, name, type, initial_balance, opening_date, currency_code)
  values (pg_temp.fx('h'), p_nome, 'checking', p_saldo, pg_temp.hoje() - 30, p_moeda) returning id into v;
  insert into fixture values (p_k, v);
  return v;
end $f$;
-- a função nova vai por SQL dinâmico: sem a migration ela não existe e o teste falha nas asserções, sem abortar o arquivo
create function pg_temp.por_moeda(p_h uuid) returns text language plpgsql as $f$
declare r text;
begin
  execute 'select coalesce(string_agg(currency_code || ''|'' || income || ''|'' || expense || ''|'' || result, '';'' order by currency_code), '''')
             from public.period_summary_by_currency($1, $2, $3)'
    into r using p_h, pg_temp.ini(), pg_temp.fim();
  return r;
exception when others then return 'erro: ' || sqlerrm;
end $f$;
create function pg_temp.saldo(p_k text) returns numeric language sql as $f$
  select balance from public.account_balances(pg_temp.fx('h'), pg_temp.hoje()) where account_id = pg_temp.fx(p_k) $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.hoje(), pg_temp.ini(), pg_temp.fim(),
  pg_temp.sqlstate_of(text), pg_temp.erro_de(text), pg_temp.conta(text, text, numeric, text), pg_temp.por_moeda(uuid),
  pg_temp.saldo(text) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000056a1', 'f2a@teste.com'),
  ('00000000-0000-0000-0000-0000000056a2', 'f2b@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000056a1');
insert into fixture select 'h', public.create_household('Casa F2');
insert into fixture select 'cexp', id from public.categories
 where household_id = pg_temp.fx('h') and system_key = 'uncategorized' and type = 'expense';
insert into fixture select 'cinc', id from public.categories
 where household_id = pg_temp.fx('h') and system_key = 'uncategorized' and type = 'income';
select pg_temp.conta('brl', 'Corrente', 1000, 'BRL');
select pg_temp.conta('usd', 'Conta em dólar', 500, 'USD');
select pg_temp.conta('usd2', 'Outra em dólar', 0, 'USD');
select pg_temp.conta('eur', 'Conta em euro', 0, 'EUR');
insert into public.budgets (household_id, category_id, month, amount_limit)
values (pg_temp.fx('h'), pg_temp.fx('cexp'), pg_temp.ini(), 500);

-- base em reais: uma despesa de 100
insert into public.transactions (household_id, type, status, date, amount, description, account_id, category_id)
values (pg_temp.fx('h'), 'expense', 'paid', pg_temp.hoje(), 100, 'Mercado', pg_temp.fx('brl'), pg_temp.fx('cexp'));

-- 1. receita e despesa em conta estrangeira ---------------------------------------
select lives_ok($$insert into public.transactions (household_id, type, status, date, amount, description, account_id, category_id)
  values (pg_temp.fx('h'), 'expense', 'paid', pg_temp.hoje(), 40.25, 'Café em Nova York', pg_temp.fx('usd'), pg_temp.fx('cexp'))$$,
  'E1 despesa paga em conta USD é aceita');
select lives_ok($$insert into public.transactions (household_id, type, status, date, amount, description, account_id, category_id)
  values (pg_temp.fx('h'), 'income', 'paid', pg_temp.hoje(), 1000, 'Pagamento de cliente', pg_temp.fx('usd'), pg_temp.fx('cinc'))$$,
  'E2 receita paga em conta USD é aceita');
select lives_ok($$insert into public.transactions (household_id, type, status, date, amount, description, account_id, category_id)
  values (pg_temp.fx('h'), 'expense', 'planned', pg_temp.hoje(), 70, 'Aluguel em dólar', pg_temp.fx('usd'), pg_temp.fx('cexp'))$$,
  'E3 despesa planejada em conta USD é aceita');
select is(pg_temp.saldo('usd'), 1459.75::numeric, 'E4 o saldo da conta USD muda, na moeda dela (500 + 1000 − 40,25)');
select is((select total from public.balance_totals(pg_temp.fx('h'), pg_temp.hoje())), 900.00::numeric,
  'E5 o total em reais não muda (1000 − 100)');

-- 2. relatórios em reais ignoram as contas estrangeiras ---------------------------
select is((select income_paid::text || '|' || expense_paid::text || '|' || expense_planned::text
             from public.period_summary(pg_temp.fx('h'), pg_temp.ini(), pg_temp.fim())), '0|100.00|0',
  'R1 period_summary: só BRL (receita, despesa paga e planejada em USD ficam de fora)');
select is((select sum(amount) from public.expenses_by_category(pg_temp.fx('h'), pg_temp.ini(), pg_temp.fim())), 100.00::numeric,
  'R2 expenses_by_category: só BRL');
select is((select sum(amount) from public.daily_expenses(pg_temp.fx('h'), pg_temp.ini(), pg_temp.fim())), 100.00::numeric,
  'R3 daily_expenses: só BRL');
select is((select spent from public.budget_usage(pg_temp.fx('h'), pg_temp.ini()) where category_id = pg_temp.fx('cexp')), 100.00::numeric,
  'R4 budget_usage: orçamento só em reais');
select is((select spent::text || '|' || planned::text from public.budget_projection(pg_temp.fx('h'), pg_temp.ini(), pg_temp.hoje())
            where category_id = pg_temp.fx('cexp')), '100.00|0',
  'R5 budget_projection: gasto e planejado só BRL');
select is((select max(total_income)::text || '|' || max(total_expense)::text
             from public.cash_flow_report(pg_temp.fx('h'), pg_temp.ini(), pg_temp.fim(), 'month', null, null, true)), '0|100.00',
  'R6 cash_flow_report (com planejados): só BRL');
select is((select sum(amount) from public.budget_rule_report(pg_temp.fx('h'), pg_temp.ini(), pg_temp.fim())), 100.00::numeric,
  'R7 budget_rule_report (gastos): só BRL');
select is((select share_income from public.budget_rule_report(pg_temp.fx('h'), pg_temp.ini(), pg_temp.fim()) where grp = 'none'), null::numeric,
  'R8 budget_rule_report (renda): a receita em USD não vira renda em reais');
select is((select (income_regular + income_eventual)::text || '|' || expense_paid::text
             from public.income_regularity(pg_temp.fx('h'), pg_temp.ini(), pg_temp.fim())), '0|100.00',
  'R9 income_regularity: só BRL');
select is((select spent::text || '|' || planned::text
             from public.month_projection(pg_temp.fx('h'), pg_temp.ini(), pg_temp.hoje())), '100.00|0',
  'R10 month_projection: gasto e planejado só BRL');
select is((select today_count::text || '|' || today_expense::text from public.daily_digest(pg_temp.fx('h'), pg_temp.hoje())), '0|0',
  'R11 daily_digest: o planejado em USD não entra no aviso em reais');

-- 3. resultado por moeda, sem conversão --------------------------------------------
select is(pg_temp.por_moeda(pg_temp.fx('h')), 'USD|1000.00|40.25|959.75',
  'P1 period_summary_by_currency: só o USD (o BRL é o period_summary), só pago, sem converter');

-- 4. transferências ------------------------------------------------------------------
select lives_ok($$insert into public.transactions (household_id, type, status, date, amount, description, account_id, destination_account_id)
  values (pg_temp.fx('h'), 'transfer', 'paid', pg_temp.hoje(), 50, 'Entre contas em dólar', pg_temp.fx('usd'), pg_temp.fx('usd2'))$$,
  'T1 transferência USD → USD é aceita');
select is(pg_temp.saldo('usd2'), 50.00::numeric, 'T1.1 e chega na outra conta em dólar');
select is(pg_temp.por_moeda(pg_temp.fx('h')), 'USD|1000.00|40.25|959.75', 'T1.2 transferência não entra no resultado por moeda');
select is(pg_temp.sqlstate_of($$insert into public.transactions (household_id, type, status, date, amount, description, account_id, destination_account_id)
  values (pg_temp.fx('h'), 'transfer', 'paid', pg_temp.hoje(), 10, 'Câmbio', pg_temp.fx('brl'), pg_temp.fx('usd'))$$), '23514',
  'T2 transferência BRL → USD é recusada (F3)');
select matches(pg_temp.erro_de($$insert into public.transactions (household_id, type, status, date, amount, description, account_id, destination_account_id)
  values (pg_temp.fx('h'), 'transfer', 'paid', pg_temp.hoje(), 10, 'Câmbio', pg_temp.fx('brl'), pg_temp.fx('usd'))$$),
  'moedas diferentes \(BRL → USD\)', 'T2.1 com mensagem clara');
select is(pg_temp.sqlstate_of($$insert into public.transactions (household_id, type, status, date, amount, description, account_id, destination_account_id)
  values (pg_temp.fx('h'), 'transfer', 'paid', pg_temp.hoje(), 10, 'Câmbio', pg_temp.fx('usd'), pg_temp.fx('eur'))$$), '23514',
  'T3 transferência USD → EUR é recusada');
select is(pg_temp.sqlstate_of($$update public.transactions set destination_account_id = pg_temp.fx('brl')
  where account_id = pg_temp.fx('usd') and type = 'transfer'$$), '23514',
  'T4 editar a transferência USD → USD para BRL é recusado');

-- 5. recorrentes ---------------------------------------------------------------------
select lives_ok($$select public.recurrence_create('expense', 'Assinatura em dólar', 15, 5, pg_temp.hoje() + 40, pg_temp.fx('usd'), null, null, pg_temp.fx('cexp'))$$,
  'C1 recorrente de despesa em conta USD é aceito');
select lives_ok($$select public.recurrence_create('income', 'Receita em dólar', 15, 5, pg_temp.hoje() + 40, pg_temp.fx('usd'), null, null, pg_temp.fx('cinc'))$$,
  'C2 recorrente de receita em conta USD é aceito');
select lives_ok($$select public.recurrence_create('transfer', 'Reserva em dólar', 15, 5, pg_temp.hoje() + 40, pg_temp.fx('usd'), pg_temp.fx('usd2'), null, null)$$,
  'C3 recorrente de transferência USD → USD é aceito');
select is(pg_temp.sqlstate_of($$select public.recurrence_create('transfer', 'Câmbio mensal', 15, 5, pg_temp.hoje() + 40, pg_temp.fx('brl'), pg_temp.fx('usd'), null, null)$$),
  '23514', 'C4 recorrente de transferência BRL → USD é recusado');

-- 6. cartão, dívida e provento continuam só em reais -----------------------------------
insert into fixture select 'loan', public.create_debt('Empréstimo F2', 'loan', pg_temp.hoje() - 10, 0);
select is(pg_temp.sqlstate_of($$select public.debt_loan_event(pg_temp.fx('loan'), pg_temp.hoje(), 'disbursement', pg_temp.fx('usd'), 100)$$),
  '23514', 'D1 evento de dívida em conta USD é recusado');
select matches(pg_temp.erro_de($$select public.debt_loan_event(pg_temp.fx('loan'), pg_temp.hoje(), 'disbursement', pg_temp.fx('usd'), 100)$$),
  'só usam conta em reais', 'D1.1 com mensagem clara (o que segue só em reais)');
insert into fixture select 'card', public.create_card('Cartão F2', pg_temp.hoje() - 10, 0, 5, 12, null, null, null);
select is(pg_temp.sqlstate_of($$select public.set_card_pay_account(pg_temp.fx('card'), pg_temp.fx('usd'))$$),
  '23514', 'D2 conta USD não paga cartão');
insert into fixture select 'fii', public.investment_asset_create(pg_temp.fx('h'), 'Fundo F2', 'FFII11', 'fund', 'BRL');
select is(pg_temp.sqlstate_of($$select public.investment_distribution_record(pg_temp.fx('fii'), 'dividend', pg_temp.hoje(), 12.34, pg_temp.fx('usd'))$$),
  '23514', 'D3 provento em conta USD é recusado');
insert into fixture select 'prov', public.investment_distribution_record(pg_temp.fx('fii'), 'dividend', pg_temp.hoje(), 12.34, pg_temp.fx('brl'));
select is(pg_temp.sqlstate_of($$update public.transactions set account_id = pg_temp.fx('usd') where id = pg_temp.fx('prov')$$),
  '23514', 'D4 o lançamento do provento não vai para conta USD na edição');
select lives_ok($$update public.transactions set description = 'Dividendos do fundo' where id = pg_temp.fx('prov')$$,
  'D5 editar o provento em conta BRL segue normal');

-- 7. família vizinha -----------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000056a2');
select is(pg_temp.por_moeda(pg_temp.fx('h')), '', 'V1 quem não é da família não vê o resultado por moeda');
insert into fixture select 'h2', public.create_household('Casa Vizinha F2');
select is(pg_temp.por_moeda(pg_temp.fx('h2')), '', 'V2 a família vizinha não enxerga o USD da outra');
select is((select count(*) from public.transactions where household_id = pg_temp.fx('h')), 0::bigint, 'V3 nem os lançamentos');

select * from finish();
rollback;
