-- 71_home_indicators: migration 071. Os 7 indicadores do topo do Início (home_indicators): cada fórmula, as faixas
-- de cor (sobre o valor arredondado), divisão por zero, conta em outra moeda fora, a fatura aberta fora do disponível,
-- o cartão fora do comprometimento, família nova, igualdade com as funções de sempre, isolamento e anon sem acesso.
-- Dados inventados; datas relativas a hoje em São Paulo.
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
create function pg_temp.conta(p_h uuid, p_nome text, p_tipo text, p_saldo numeric, p_abre date, p_moeda text default 'BRL')
returns uuid language plpgsql as $f$
declare v uuid;
begin
  insert into public.accounts (household_id, name, type, initial_balance, opening_date, currency_code)
  values (p_h, p_nome, p_tipo, p_saldo, p_abre, p_moeda) returning id into v;
  return v;
end $f$;
create function pg_temp.lanc(p_h uuid, p_conta uuid, p_tipo text, p_cat uuid, p_valor numeric, p_data date, p_desc text)
returns uuid language plpgsql as $f$
declare v uuid;
begin
  insert into public.transactions (household_id, account_id, category_id, type, status, amount, date, description)
  values (p_h, p_conta, p_cat, p_tipo, 'paid', p_valor, p_data, p_desc) returning id into v;
  return v;
end $f$;
create function pg_temp.cat(p_h uuid, p_nome text, p_tipo text) returns uuid language sql as $f$
  select id from public.categories where household_id = p_h and name = p_nome and type = p_tipo and parent_id is null $f$;
grant execute on all functions in schema pg_temp to public;

-- ---- permissões e forma ----
select ok(not has_function_privilege('anon', 'public.home_indicators(uuid, date)', 'EXECUTE'), 'P1 anon não executa');
select ok(has_function_privilege('authenticated', 'public.home_indicators(uuid, date)', 'EXECUTE'), 'P2 authenticated executa');
select ok(not (select prosecdef from pg_proc where oid = 'public.home_indicators(uuid, date)'::regprocedure), 'P3 SECURITY INVOKER');
select is((select proconfig from pg_proc where oid = 'public.home_indicators(uuid, date)'::regprocedure),
          array['search_path=""', 'jit=off'], 'P4 search_path vazio (e sem JIT, por desempenho)');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000071a1', 'a1@teste.com'),
  ('00000000-0000-0000-0000-0000000071a2', 'a2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000071a1');
insert into fixture select 'h', public.create_household('Casa Indicadores');
insert into fixture select 'sal', pg_temp.cat(pg_temp.fx('h'), 'Salário', 'income');
insert into fixture select 'outra', pg_temp.cat(pg_temp.fx('h'), 'Outras receitas', 'income');
insert into fixture select 'desp', id from public.categories where household_id = pg_temp.fx('h') and type = 'expense' and parent_id is null order by name limit 1;
update public.categories set eventual = true where id = pg_temp.fx('outra');

-- contas abertas 7 meses atrás: os 6 meses fechados contam na média
insert into fixture select 'cc', pg_temp.conta(pg_temp.fx('h'), 'Conta do dia a dia', 'checking', 10000, (pg_temp.ini() - interval '7 months')::date);
insert into fixture select 'res', pg_temp.conta(pg_temp.fx('h'), 'Reserva de teste', 'savings', 3000, (pg_temp.ini() - interval '7 months')::date);
select pg_temp.conta(pg_temp.fx('h'), 'Corretora de teste', 'brokerage', 200, (pg_temp.ini() - interval '7 months')::date);
select pg_temp.conta(pg_temp.fx('h'), 'Carteira de bolso', 'cash', 50, (pg_temp.ini() - interval '7 months')::date);
insert into fixture select 'antiga', pg_temp.conta(pg_temp.fx('h'), 'Conta antiga', 'checking', 400, (pg_temp.ini() - interval '7 months')::date);
update public.accounts set active = false where id = pg_temp.fx('antiga');
insert into fixture select 'usd', pg_temp.conta(pg_temp.fx('h'), 'Conta em dólar', 'savings', 999, (pg_temp.ini() - interval '7 months')::date, 'USD');

-- 6 meses fechados com R$ 500 de despesa cada (média 500)
select pg_temp.lanc(pg_temp.fx('h'), pg_temp.fx('cc'), 'expense', pg_temp.fx('desp'), 500, (pg_temp.ini() - make_interval(months => n))::date + 4, 'Despesa antiga ' || n)
  from generate_series(1, 6) n;
-- o mês: 5000 de salário (regular), 1000 eventual, 4000 de despesa; em dólar, receita e despesa que não entram
insert into fixture select 'salario', pg_temp.lanc(pg_temp.fx('h'), pg_temp.fx('cc'), 'income', pg_temp.fx('sal'), 5000, pg_temp.ini(), 'Salário do mês');
select pg_temp.lanc(pg_temp.fx('h'), pg_temp.fx('cc'), 'income', pg_temp.fx('outra'), 1000, pg_temp.ini(), 'Bônus eventual');
select pg_temp.lanc(pg_temp.fx('h'), pg_temp.fx('cc'), 'expense', pg_temp.fx('desp'), 4000, pg_temp.ini(), 'Despesas do mês');
select pg_temp.lanc(pg_temp.fx('h'), pg_temp.fx('usd'), 'income', pg_temp.fx('sal'), 777, pg_temp.ini(), 'Receita em dólar');
select pg_temp.lanc(pg_temp.fx('h'), pg_temp.fx('usd'), 'expense', pg_temp.fx('desp'), 111, pg_temp.ini(), 'Despesa em dólar');

-- cartão com R$ 300 de fatura fechada a pagar (saldo de referência)
insert into fixture select 'cartao', public.create_debt('Cartão de teste', 'card', pg_temp.hoje() - 10, 300);
-- contratos: empréstimo 500, consignado 200, financiamento 300 por mês (vencem no dia 10 deste mês em diante)
insert into fixture select 'emp', public.create_debt('Empréstimo de teste', 'loan', (pg_temp.ini() - 40), 10000);
insert into fixture select 'cons', public.create_debt('Consignado de teste', 'loan', (pg_temp.ini() - 40), 5000);
insert into fixture select 'fin', public.create_debt('Financiamento de teste', 'financing', (pg_temp.ini() - 40), 20000);
select public.debt_contract_set(pg_temp.fx('emp'), 'Banco teste', null, 24, 20, 500, 10, 'account_debit', pg_temp.fx('cc'), pg_temp.ini() + 9);
select public.debt_contract_set(pg_temp.fx('cons'), 'Banco teste', null, 24, 20, 200, 10, 'payroll', null, pg_temp.ini() + 9);
select public.debt_contract_set(pg_temp.fx('fin'), 'Banco teste', null, 120, 100, 300, 10, 'boleto', null, pg_temp.ini() + 9);
-- bem de 100.000 com 50% da família; investimento em reais de 10 × 100 e um em dólar (fora)
select public.family_asset_create(pg_temp.fx('h'), 'Imóvel de teste', 'real_estate', null, 'BRL', 'Família', 50, pg_temp.hoje() - 10, 100000, pg_temp.hoje() - 9, 'Avaliação de teste');
insert into fixture select 'inv', public.investment_asset_create(pg_temp.fx('h'), 'Fundo de teste', null, 'fund', 'BRL');
insert into fixture select 'invusd', public.investment_asset_create(pg_temp.fx('h'), 'ETF de teste', null, 'etf', 'USD');
select public.investment_operation_record(pg_temp.fx('inv'), pg_temp.hoje() - 5, 'buy', 10, 100, 0, 'compra de teste');
select public.investment_operation_record(pg_temp.fx('invusd'), pg_temp.hoje() - 5, 'buy', 2, 50, 0, 'compra de teste');

create temp view hi with (security_invoker = true) as select * from public.home_indicators(pg_temp.fx('h'), pg_temp.hoje());
grant select on hi to public;

-- ---- o mês ----
select is((select month_start || '|' || month_end from hi),
          pg_temp.ini() || '|' || (pg_temp.ini() + interval '1 month - 1 day')::date, 'M1 o mês é o de hoje, do dia 1 ao último');

-- ---- Disponível ----
-- corrente 10000 − 6×500 + 5000 + 1000 − 4000 = 9000; reserva 3000; corretora 200; carteira 50 (a inativa e a em dólar não)
select is((select accounts_active from hi), 12250.00, 'D1 contas ativas em reais dos 7 tipos (inativa e dólar fora)');
select is((select card_bills_closed from hi), 300.00, 'D2 fatura fechada a pagar');
select is((select available from hi), 11950.00, 'D3 disponível = contas ativas − fatura fechada');
select is((select accounts_active from hi), (select sum(total_active) from public.balance_totals_by_type(pg_temp.fx('h'), pg_temp.hoje())),
          'D4 o mesmo total das contas ativas de balance_totals_by_type');
-- compra parcelada no cartão hoje: vai para a fatura aberta, não muda o disponível nem a dívida
select public.set_card_cycle(pg_temp.fx('cartao'), 25, 5);
select public.card_purchase(pg_temp.fx('cartao'), pg_temp.hoje(), 900, 3, pg_temp.fx('desp'), 'Compra parcelada de teste');
select is((select available from hi), 11950.00, 'D5 a fatura aberta não entra no disponível');
select is((select debt_total from hi), 35300.00, 'D6 nem na dívida total (é compromisso futuro)');
select is((select planned_commitments from hi), 900.00, 'D7 fica nos compromissos futuros');

-- ---- Patrimônio total ----
-- todas as contas em reais 12650 + bens 50000 + investimentos 1000 − dívidas 35300
select is((select accounts_total || '|' || family_assets || '|' || investments || '|' || debt_total from hi),
          '12650.00|50000.00|1000.00|35300.00', 'W1 componentes: contas (com a inativa), bens (50%), investimentos em reais, dívidas');
select is((select net_worth from hi), 28350.00, 'W2 patrimônio = 12650 + 50000 + 1000 − 35300');
select is((select net_worth - investments from hi), (select net_worth from public.net_worth_with_assets(pg_temp.fx('h'), pg_temp.hoje())),
          'W3 sem os investimentos, é o mesmo de net_worth_with_assets');

-- ---- Dívidas totais ----
select is((select debt_total from hi), (select sum(debt) from public.debt_balances(pg_temp.fx('h'), pg_temp.hoje())),
          'V1 dívidas totais = soma de debt_balances (cartão incluído)');

-- ---- Resultado e taxa de poupança ----
select is((select income || '|' || expense || '|' || result from hi), '6000.00|4000.00|2000.00', 'R1 receitas, despesas e resultado do mês (dólar fora)');
select is((select result from hi), (select result from public.period_summary(pg_temp.fx('h'), pg_temp.ini(), (pg_temp.ini() + interval '1 month - 1 day')::date)),
          'R2 o mesmo resultado de period_summary');
select is((select savings_rate || '|' || savings_band from hi), '33.3|saudavel', 'R3 taxa = 2000 ÷ 6000 = 33,3% (saudável)');
select pg_temp.lanc(pg_temp.fx('h'), pg_temp.fx('cc'), 'expense', pg_temp.fx('desp'), 1460, pg_temp.ini(), 'Extra 1');
select is((select savings_rate || '|' || savings_band from hi), '9.0|atencao', 'R4 9,0% = atenção');
select pg_temp.lanc(pg_temp.fx('h'), pg_temp.fx('cc'), 'income', pg_temp.fx('outra'), 60, pg_temp.ini(), 'Extra 2');
-- 6060 − 5460 = 600 → 9,9%
select is((select savings_rate || '|' || savings_band from hi), '9.9|atencao', 'R5 9,9% ainda é atenção');
-- 6060 − 5454 = 606 → exatamente 10,0%
update public.transactions set amount = 1454 where household_id = pg_temp.fx('h') and description = 'Extra 1';
select is((select savings_rate || '|' || savings_band from hi), '10.0|saudavel', 'R6 10,0% já é saudável');
update public.transactions set amount = 2060 where household_id = pg_temp.fx('h') and description = 'Extra 1';
select is((select result || '|' || savings_rate || '|' || savings_band from hi), '0.00|0.0|atencao', 'R7 resultado zero = 0,0% (atenção)');
update public.transactions set amount = 2160 where household_id = pg_temp.fx('h') and description = 'Extra 1';
select is((select savings_rate || '|' || savings_band from hi), '-1.7|critico', 'R8 negativo = crítico');
update public.transactions set deleted_at = now() where household_id = pg_temp.fx('h') and description in ('Extra 1', 'Extra 2');

-- ---- Cobertura da reserva ----
select is((select reserve || '|' || expense_closed_months || '|' || closed_months || '|' || average_expense from hi),
          '3000.00|3000.00|6|500.00', 'C1 reserva 3000; 3000 de despesa em 6 meses fechados; média 500');
select is((select reserve_months || '|' || reserve_band from hi), '6.0|saudavel', 'C2 6,0 meses já é saudável');
insert into public.transactions (household_id, type, status, date, amount, description, account_id, destination_account_id)
values (pg_temp.fx('h'), 'transfer', 'paid', pg_temp.hoje(), 1500, 'Saque da reserva', pg_temp.fx('res'), pg_temp.fx('cc'));
select is((select reserve_months || '|' || reserve_band from hi), '3.0|atencao', 'C3 3,0 meses = atenção');
update public.transactions set amount = 1501 where household_id = pg_temp.fx('h') and description = 'Saque da reserva';
select is((select reserve_months || '|' || reserve_band from hi), '3.0|atencao', 'C4 2,998 aparece 3,0 e a faixa segue o que aparece (atenção)');
update public.transactions set amount = 1530 where household_id = pg_temp.fx('h') and description = 'Saque da reserva';
select is((select reserve_months || '|' || reserve_band from hi), '2.9|critico', 'C5 2,9 meses = crítico');
update public.transactions set amount = 30 where household_id = pg_temp.fx('h') and description = 'Saque da reserva';
select is((select reserve_months || '|' || reserve_band from hi), '5.9|atencao', 'C6 5,9 meses = atenção');
update public.transactions set deleted_at = now() where household_id = pg_temp.fx('h') and description = 'Saque da reserva';
select is((select available from hi), 11950.00, 'C7 a transferência entre contas não muda o disponível');

-- ---- Comprometimento com dívidas ----
select is((select debt_installments || '|' || regular_income from hi), '1000|5000.00',
          'K1 parcelas do mês: empréstimo 500 + consignado 200 + financiamento 300 (a compra parcelada no cartão fica fora); renda regular 5000 (o eventual não)');
select is((select regular_income from hi), (select income_regular from public.income_regularity(pg_temp.fx('h'), pg_temp.ini(), (pg_temp.ini() + interval '1 month - 1 day')::date)),
          'K2 a mesma renda regular de income_regularity');
select is((select commitment_pct || '|' || commitment_band from hi), '20.0|saudavel', 'K3 1000 ÷ 5000 = 20,0% (saudável)');
update public.transactions set amount = 3333.33 where id = pg_temp.fx('salario');
select is((select commitment_pct || '|' || commitment_band from hi), '30.0|saudavel', 'K4 30,0% ainda é saudável');
update public.transactions set amount = 3300 where id = pg_temp.fx('salario');
select is((select commitment_pct || '|' || commitment_band from hi), '30.3|atencao', 'K5 30,3% = atenção');
update public.transactions set amount = 2500 where id = pg_temp.fx('salario');
select is((select commitment_pct || '|' || commitment_band from hi), '40.0|atencao', 'K6 40,0% ainda é atenção');
update public.transactions set amount = 2490 where id = pg_temp.fx('salario');
select is((select commitment_pct || '|' || commitment_band from hi), '40.2|critico', 'K7 40,2% = alto (crítico)');
-- a parcela paga continua sendo a parcela do mês
update public.transactions set amount = 5000 where id = pg_temp.fx('salario');
select public.debt_schedule_record_payment(
  (select id from public.debt_payment_schedule where debt_id = pg_temp.fx('emp') and due_date between pg_temp.ini() and pg_temp.ini() + 30),
  pg_temp.ini() + 9, pg_temp.fx('cc'), 450, 50, 0, pg_temp.fx('desp'));
select is((select debt_installments from hi), 1000.00, 'K8 parcela do mês já paga continua contando');
-- a parcela do mês que vem não entra
select is((select debt_installments from public.home_indicators(pg_temp.fx('h'), (pg_temp.ini() - 1))), 0::numeric,
          'K9 no mês anterior (antes do 1º vencimento) não há parcela');

-- ---- família nova: divisão por zero e meses que não existiam ----
select pg_temp.login('00000000-0000-0000-0000-0000000071a2');
insert into fixture select 'h2', public.create_household('Casa Nova');
select is((select closed_months || '|' || coalesce(reserve_months::text, '—') from public.home_indicators(pg_temp.fx('h2'), pg_temp.hoje())),
          '0|—', 'Z1 sem conta nenhuma: 0 mês fechado e reserva "—"');
-- conta aberta no meio do mês retrasado: 2 meses fechados contam
insert into fixture select 'cc2', pg_temp.conta(pg_temp.fx('h2'), 'Conta nova', 'checking', 100, (pg_temp.ini() - interval '2 months')::date + 14);
select is((select row(income, expense, result, savings_rate, savings_band, reserve_months, reserve_band, commitment_pct, commitment_band, closed_months)::text
             from public.home_indicators(pg_temp.fx('h2'), pg_temp.hoje())),
          '(0,0,0,,,,,,,2)', 'Z2 sem receita, despesa nem renda: taxa, reserva e comprometimento vazios ("—"), sem faixa; 2 meses fechados');
select pg_temp.lanc(pg_temp.fx('h2'), pg_temp.fx('cc2'), 'expense',
  (select id from public.categories where household_id = pg_temp.fx('h2') and type = 'expense' and parent_id is null order by name limit 1),
  200, (pg_temp.ini() - interval '1 month')::date + 2, 'Despesa nova');
select is((select average_expense || '|' || reserve_months || '|' || reserve_band from public.home_indicators(pg_temp.fx('h2'), pg_temp.hoje())),
          '100.00|0.0|critico', 'Z3 média em 2 meses (200 ÷ 2); sem reserva = 0,0 mês (crítico)');

-- ---- isolamento ----
select is((select count(*) from public.home_indicators(pg_temp.fx('h'), pg_temp.hoje())), 0::bigint, 'I1 quem não é da família não vê nada');
select pg_temp.login('00000000-0000-0000-0000-0000000071a1');
select is((select count(*) from public.home_indicators(pg_temp.fx('h2'), pg_temp.hoje())), 0::bigint, 'I2 nem o contrário');
select is((select count(*) from hi), 1::bigint, 'I3 o membro vê uma linha');

select * from finish();
rollback;
