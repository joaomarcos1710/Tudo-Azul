-- 71_home_indicators: migration 071. Os 7 indicadores do topo do Início (home_indicators) e a marca "não conta como
-- consumo" das categorias: cada fórmula, o último mês fechado (poupança e comprometimento), a mediana da despesa
-- (reserva), a renda regular esperada × recebida, as faixas de cor (sobre o valor arredondado), divisão por zero, conta
-- em outra moeda fora, fatura aberta fora do disponível, cartão fora do comprometimento, a marca só na categoria
-- marcada (subcategoria não herda), família nova, igualdade com as funções de sempre, permissões, isolamento e anon.
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
-- 1º dia do último mês fechado e o último dia dele
create function pg_temp.fini() returns date language sql as $f$ select (pg_temp.ini() - interval '1 month')::date $f$;
create function pg_temp.ffim() returns date language sql as $f$ select pg_temp.ini() - 1 $f$;
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
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
create function pg_temp.nova_cat(p_h uuid, p_nome text, p_tipo text, p_pai uuid default null) returns uuid language plpgsql as $f$
declare v uuid;
begin
  insert into public.categories (household_id, name, type, parent_id) values (p_h, p_nome, p_tipo, p_pai) returning id into v;
  return v;
end $f$;
create function pg_temp.marca(p_cat uuid, p_valor boolean) returns void language sql as $f$
  update public.categories set non_consumption = p_valor where id = p_cat $f$;
grant execute on all functions in schema pg_temp to public;

-- ---- permissões e forma ----
select ok(not has_function_privilege('anon', 'public.home_indicators(uuid, date)', 'EXECUTE'), 'P1 anon não executa');
select ok(has_function_privilege('authenticated', 'public.home_indicators(uuid, date)', 'EXECUTE'), 'P2 authenticated executa');
select ok(not (select prosecdef from pg_proc where oid = 'public.home_indicators(uuid, date)'::regprocedure), 'P3 SECURITY INVOKER');
select is((select proconfig from pg_proc where oid = 'public.home_indicators(uuid, date)'::regprocedure),
          array['search_path=""', 'jit=off'], 'P4 search_path vazio (e sem JIT, por desempenho)');
select ok(has_column_privilege('authenticated', 'public.categories', 'non_consumption', 'UPDATE'), 'P5 a família altera "não é consumo"');
select ok(not has_column_privilege('authenticated', 'public.categories', 'non_consumption', 'INSERT'), 'P6 categoria nasce sem a marca');
select ok(not has_column_privilege('anon', 'public.categories', 'non_consumption', 'UPDATE'), 'P7 anon não altera');
select is((select count(*) from public.categories where non_consumption), 0::bigint, 'P8 nenhuma categoria vem marcada');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000071a1', 'a1@teste.com'),
  ('00000000-0000-0000-0000-0000000071a2', 'a2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000071a1');
insert into fixture select 'h', public.create_household('Casa Indicadores');
insert into fixture select 'sal', pg_temp.cat(pg_temp.fx('h'), 'Salário', 'income');
insert into fixture select 'outra', pg_temp.cat(pg_temp.fx('h'), 'Outras receitas', 'income');
insert into fixture select 'semcat', id from public.categories where household_id = pg_temp.fx('h') and type = 'expense' and system_key is not null;
insert into fixture select 'desp', id from public.categories where household_id = pg_temp.fx('h') and type = 'expense' and parent_id is null and system_key is null order by name limit 1;
update public.categories set eventual = true where id = pg_temp.fx('outra');
-- as categorias que a família vai marcar (nomes inventados): uma mãe de despesa com uma subcategoria e uma de receita
insert into fixture select 'quit', pg_temp.nova_cat(pg_temp.fx('h'), 'Quitação de teste', 'expense');
insert into fixture select 'parc', pg_temp.nova_cat(pg_temp.fx('h'), 'Parcela de teste', 'expense', pg_temp.fx('quit'));
insert into fixture select 'emprec', pg_temp.nova_cat(pg_temp.fx('h'), 'Empréstimo recebido de teste', 'income');

-- contas abertas 7 meses atrás: os 6 meses fechados contam
insert into fixture select 'cc', pg_temp.conta(pg_temp.fx('h'), 'Conta do dia a dia', 'checking', 10000, (pg_temp.ini() - interval '7 months')::date);
insert into fixture select 'res', pg_temp.conta(pg_temp.fx('h'), 'Reserva de teste', 'savings', 3000, (pg_temp.ini() - interval '7 months')::date);
select pg_temp.conta(pg_temp.fx('h'), 'Corretora de teste', 'brokerage', 200, (pg_temp.ini() - interval '7 months')::date);
select pg_temp.conta(pg_temp.fx('h'), 'Carteira de bolso', 'cash', 50, (pg_temp.ini() - interval '7 months')::date);
insert into fixture select 'antiga', pg_temp.conta(pg_temp.fx('h'), 'Conta antiga', 'checking', 400, (pg_temp.ini() - interval '7 months')::date);
update public.accounts set active = false where id = pg_temp.fx('antiga');
insert into fixture select 'usd', pg_temp.conta(pg_temp.fx('h'), 'Conta em dólar', 'savings', 999, (pg_temp.ini() - interval '7 months')::date, 'USD');

-- meses fechados −6 a −2: R$ 500 de despesa cada; nos meses −5 a −2, mais R$ 10.000 de "quitação" (não é consumo)
select pg_temp.lanc(pg_temp.fx('h'), pg_temp.fx('cc'), 'expense', pg_temp.fx('desp'), 500, (pg_temp.ini() - make_interval(months => n))::date + 4, 'Despesa antiga ' || n)
  from generate_series(2, 6) n;
select pg_temp.lanc(pg_temp.fx('h'), pg_temp.fx('cc'), 'expense', pg_temp.fx('quit'), 10000, (pg_temp.ini() - make_interval(months => n))::date + 6, 'Quitação ' || n)
  from generate_series(2, 5) n;
-- último mês fechado: salário 5000 (regular), 1000 eventual, 20000 de empréstimo recebido (não é consumo);
-- despesa 4000 + 100 na subcategoria (consumo) + 3000 de quitação na mãe (não é consumo)
insert into fixture select 'salario', pg_temp.lanc(pg_temp.fx('h'), pg_temp.fx('cc'), 'income', pg_temp.fx('sal'), 5000, pg_temp.fini() + 4, 'Salário de teste');
select pg_temp.lanc(pg_temp.fx('h'), pg_temp.fx('cc'), 'income', pg_temp.fx('outra'), 1000, pg_temp.fini() + 4, 'Bônus eventual');
select pg_temp.lanc(pg_temp.fx('h'), pg_temp.fx('cc'), 'income', pg_temp.fx('emprec'), 20000, pg_temp.fini() + 2, 'Empréstimo recebido');
insert into fixture select 'despfech', pg_temp.lanc(pg_temp.fx('h'), pg_temp.fx('cc'), 'expense', pg_temp.fx('desp'), 4000, pg_temp.fini() + 5, 'Despesas do mês fechado');
select pg_temp.lanc(pg_temp.fx('h'), pg_temp.fx('cc'), 'expense', pg_temp.fx('parc'), 100, pg_temp.fini() + 5, 'Parcela na subcategoria');
select pg_temp.lanc(pg_temp.fx('h'), pg_temp.fx('cc'), 'expense', pg_temp.fx('quit'), 3000, pg_temp.fini() + 6, 'Quitação do mês fechado');
-- em dólar, no mês fechado: não entra
select pg_temp.lanc(pg_temp.fx('h'), pg_temp.fx('usd'), 'income', pg_temp.fx('sal'), 777, pg_temp.fini() + 4, 'Receita em dólar');
select pg_temp.lanc(pg_temp.fx('h'), pg_temp.fx('usd'), 'expense', pg_temp.fx('desp'), 111, pg_temp.fini() + 4, 'Despesa em dólar');
-- mês corrente, até hoje: 700 de receita e 200 de despesa (só o "Resultado do mês" olha para ele)
select pg_temp.lanc(pg_temp.fx('h'), pg_temp.fx('cc'), 'income', pg_temp.fx('sal'), 700, pg_temp.ini(), 'Receita do mês corrente');
select pg_temp.lanc(pg_temp.fx('h'), pg_temp.fx('cc'), 'expense', pg_temp.fx('desp'), 200, pg_temp.ini(), 'Despesa do mês corrente');

-- cartão com R$ 300 de fatura fechada a pagar (saldo de referência)
insert into fixture select 'cartao', public.create_debt('Cartão de teste', 'card', pg_temp.hoje() - 10, 300);
-- contratos: empréstimo 500, consignado 200, financiamento 300 por mês, do dia 10 do mês fechado em diante
insert into fixture select 'emp', public.create_debt('Empréstimo de teste', 'loan', pg_temp.fini() - 40, 10000);
insert into fixture select 'cons', public.create_debt('Consignado de teste', 'loan', pg_temp.fini() - 40, 5000);
insert into fixture select 'fin', public.create_debt('Financiamento de teste', 'financing', pg_temp.fini() - 40, 20000);
select public.debt_contract_set(pg_temp.fx('emp'), 'Banco teste', null, 24, 20, 500, 10, 'account_debit', pg_temp.fx('cc'), pg_temp.fini() + 9);
select public.debt_contract_set(pg_temp.fx('cons'), 'Banco teste', null, 24, 20, 200, 10, 'payroll', null, pg_temp.fini() + 9);
select public.debt_contract_set(pg_temp.fx('fin'), 'Banco teste', null, 120, 100, 300, 10, 'boleto', null, pg_temp.fini() + 9);
-- bem de 100.000 com 50% da família; investimento em reais de 10 × 100 e um em dólar (fora)
select public.family_asset_create(pg_temp.fx('h'), 'Imóvel de teste', 'real_estate', null, 'BRL', 'Família', 50, pg_temp.hoje() - 10, 100000, pg_temp.hoje() - 9, 'Avaliação de teste');
insert into fixture select 'inv', public.investment_asset_create(pg_temp.fx('h'), 'Fundo de teste', null, 'fund', 'BRL');
insert into fixture select 'invusd', public.investment_asset_create(pg_temp.fx('h'), 'ETF de teste', null, 'etf', 'USD');
select public.investment_operation_record(pg_temp.fx('inv'), pg_temp.hoje() - 5, 'buy', 10, 100, 0, 'compra de teste');
select public.investment_operation_record(pg_temp.fx('invusd'), pg_temp.hoje() - 5, 'buy', 2, 50, 0, 'compra de teste');

create temp view hi with (security_invoker = true) as select * from public.home_indicators(pg_temp.fx('h'), pg_temp.hoje());
grant select on hi to public;

-- ---- os meses ----
select is((select month_start || '|' || month_end from hi),
          pg_temp.ini() || '|' || (pg_temp.ini() + interval '1 month - 1 day')::date, 'M1 o mês corrente vai do dia 1 ao último');
select is((select closed_month_start || '|' || closed_month_end from hi), pg_temp.fini() || '|' || pg_temp.ffim(),
          'M2 o último mês fechado é o mês anterior inteiro');

-- ---- sem nenhuma marca: os mesmos números das funções de sempre ----
select is((select savings_income || '|' || savings_expense from hi),
          (select income_paid || '|' || expense_paid from public.period_summary(pg_temp.fx('h'), pg_temp.fini(), pg_temp.ffim())),
          'E1 sem marca, receita e despesa do mês fechado = period_summary');
select is((select regular_income_received from hi),
          (select income_regular from public.income_regularity(pg_temp.fx('h'), pg_temp.fini(), pg_temp.ffim())),
          'E2 sem marca, renda regular recebida = income_regularity');
select is((select savings_rate || '|' || savings_band from hi), '72.7|saudavel', 'E3 sem marca, o empréstimo recebido infla a taxa: (26000 − 7100) ÷ 26000');
-- série sem marca: 500, 10500, 10500, 10500, 10500, 7100 → mediana 10500 → 3000 ÷ 10500 = 0,3
select is((select typical_expense || '|' || reserve_months || '|' || reserve_band from hi), '10500.00|0.3|critico',
          'E4 sem marca, a quitação puxa a despesa típica');

-- ---- a família marca o que não é consumo (só a categoria marcada) ----
select pg_temp.marca(pg_temp.fx('quit'), true);
select pg_temp.marca(pg_temp.fx('emprec'), true);
select is((select non_consumption from public.categories where id = pg_temp.fx('parc')), false, 'N1 a subcategoria não muda ao marcar a mãe');
select is(pg_temp.sqlstate_of(format('update public.categories set non_consumption = true where id = %L', pg_temp.fx('semcat'))),
          '23514', 'N2 "Sem categoria" não pode ser marcada');

-- ---- Disponível ----
-- corrente 10000 − 5×500 − 4×10000 + 5000 + 1000 + 20000 − 4000 − 100 − 3000 + 700 − 200 = −13100; reserva 3000;
-- corretora 200; carteira 50 (a inativa e a em dólar não)
-- (076) o Disponível conta só os 4 tipos líquidos; esta família só tem contas desses tipos, então o valor não muda
select is((select accounts_active from hi), -9850.00, 'D1 contas líquidas ativas em reais (inativa e dólar fora)');
select is((select card_bills_closed from hi), 300.00, 'D2 fatura fechada a pagar');
select is((select available from hi), -10150.00, 'D3 disponível = contas ativas − fatura fechada');
select is((select accounts_active from hi), (select sum(total_active) from public.balance_totals_by_type(pg_temp.fx('h'), pg_temp.hoje())
                                               where account_type in ('checking', 'savings', 'cash', 'brokerage')),
          'D4 o mesmo total ativo dos 4 tipos líquidos de balance_totals_by_type');
select public.set_card_cycle(pg_temp.fx('cartao'), 25, 5);
select public.card_purchase(pg_temp.fx('cartao'), pg_temp.hoje(), 900, 3, pg_temp.fx('desp'), 'Compra parcelada de teste');
select is((select available from hi), -10150.00, 'D5 a fatura aberta não entra no disponível');
select is((select debt_total from hi), 35300.00, 'D6 nem na dívida total (é compromisso futuro)');
select is((select planned_commitments from hi), 900.00, 'D7 fica nos compromissos futuros');

-- ---- Patrimônio total ----
select is((select accounts_total || '|' || family_assets || '|' || investments || '|' || debt_total from hi),
          '-9450.00|50000.00|1000.00|35300.00', 'W1 componentes: contas (com a inativa), bens (50%), investimentos em reais, dívidas');
-- 075 (#196) deixava a carteira de investimentos à parte (para não contar em dobro com as contas de renda
-- fixa/variável/cripto da 070). A 099 (20261110080000_investment_liquidity.sql, decisão do dono de 10/11/2026) REVOGA
-- isso: o patrimônio soma a carteira em reais (os 100 em dólar continuam fora). Antes: 5.250; agora: 6.250.
select is((select net_worth from hi), 6250.00, 'W2 patrimônio = −9450 + 50000 + 1000 da carteira em reais − 35300 (099)');
select is((select net_worth from hi), (select net_worth from public.net_worth_with_assets(pg_temp.fx('h'), pg_temp.hoje())),
          'W3 é o mesmo de net_worth_with_assets (Análises)');
select is((select debt_total from hi), (select sum(debt) from public.debt_balances(pg_temp.fx('h'), pg_temp.hoje())),
          'V1 dívidas totais = soma de debt_balances (cartão incluído)');

-- ---- Resultado do mês (corrente, até hoje) ----
select is((select income || '|' || expense || '|' || result from hi), '700.00|200.00|500.00', 'R1 o resultado é o do mês corrente');
select is((select result from hi), (select result from public.period_summary(pg_temp.fx('h'), pg_temp.ini(), (pg_temp.ini() + interval '1 month - 1 day')::date)),
          'R2 o mesmo resultado de period_summary (as marcas não mudam o resultado)');

-- ---- Taxa de poupança (último mês fechado, sem o que não é consumo) ----
select is((select savings_income || '|' || savings_expense || '|' || savings_result from hi), '6000.00|4100.00|1900.00',
          'S1 receitas 6000 (sem os 20000 de empréstimo, sem o dólar) e despesas 4100 (a subcategoria conta; a quitação da mãe não)');
select is((select savings_rate || '|' || savings_band from hi), '31.7|saudavel', 'S2 1900 ÷ 6000 = 31,7% (saudável)');
select pg_temp.marca(pg_temp.fx('parc'), true);
select is((select savings_expense || '|' || savings_rate from hi), '4000.00|33.3', 'S3 a subcategoria marcada sozinha também sai');
select pg_temp.marca(pg_temp.fx('parc'), false);
select pg_temp.marca(pg_temp.fx('quit'), false);
select is((select savings_rate || '|' || savings_band from hi), '-18.3|critico', 'S4 desmarcada, a quitação volta: (6000 − 7100) ÷ 6000');
select pg_temp.marca(pg_temp.fx('quit'), true);
update public.transactions set amount = 5360 where id = pg_temp.fx('despfech');
select is((select savings_rate || '|' || savings_band from hi), '9.0|atencao', 'S5 9,0% = atenção');
update public.transactions set amount = 5300 where id = pg_temp.fx('despfech');
select is((select savings_rate || '|' || savings_band from hi), '10.0|saudavel', 'S6 10,0% já é saudável');
update public.transactions set amount = 5900 where id = pg_temp.fx('despfech');
select is((select savings_result || '|' || savings_rate || '|' || savings_band from hi), '0.00|0.0|atencao', 'S7 zero = 0,0% (atenção)');
update public.transactions set amount = 6000 where id = pg_temp.fx('despfech');
select is((select savings_rate || '|' || savings_band from hi), '-1.7|critico', 'S8 negativo = crítico');
update public.transactions set amount = 4000 where id = pg_temp.fx('despfech');

-- ---- Cobertura da reserva (mediana, sem o que não é consumo) ----
-- série dos 6 meses fechados: 500, 500, 500, 500, 500, 4100 → mediana 500 (a média daria 1100)
select is((select reserve || '|' || closed_months || '|' || typical_expense from hi), '3000.00|6|500.00',
          'C1 reserva 3000; 6 meses fechados; despesa típica = mediana 500 (sem a quitação)');
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
-- mês com número par de meses: média dos dois do meio (500 e 4100 com 2 meses no exemplo abaixo, família nova)

-- ---- Comprometimento (último mês fechado) ----
select is((select debt_installments || '|' || regular_income_received || '|' || regular_income_expected || '|' || regular_income || '|' || regular_income_source from hi),
          '1000|5000.00|0|5000.00|received',
          'K1 parcelas do mês fechado: 500 + 200 + 300 (o cartão fica fora); sem recorrente, vale a renda regular recebida (sem o eventual e sem o empréstimo)');
select is((select commitment_pct || '|' || commitment_band from hi), '20.0|saudavel', 'K2 1000 ÷ 5000 = 20,0% (saudável)');
update public.transactions set amount = 3333.33 where id = pg_temp.fx('salario');
select is((select commitment_pct || '|' || commitment_band from hi), '30.0|saudavel', 'K3 30,0% ainda é saudável');
update public.transactions set amount = 3300 where id = pg_temp.fx('salario');
select is((select commitment_pct || '|' || commitment_band from hi), '30.3|atencao', 'K4 30,3% = atenção');
update public.transactions set amount = 2500 where id = pg_temp.fx('salario');
select is((select commitment_pct || '|' || commitment_band from hi), '40.0|atencao', 'K5 40,0% ainda é atenção');
update public.transactions set amount = 2490 where id = pg_temp.fx('salario');
select is((select commitment_pct || '|' || commitment_band from hi), '40.2|critico', 'K6 40,2% = alto (crítico)');
update public.transactions set amount = 5000 where id = pg_temp.fx('salario');
-- recorrente de salário de 6.000 desde 2 meses antes do fechado: a renda esperada (6000) passa a recebida (5000)
select public.recurrence_create('income', 'Salário recorrente de teste', 6000, 5, (pg_temp.fini() - interval '2 months')::date, pg_temp.fx('cc'), null, null, pg_temp.fx('sal'));
-- recorrente eventual e recorrente "não é consumo" não contam como renda esperada
select public.recurrence_create('income', 'Eventual recorrente', 9000, 6, (pg_temp.fini() - interval '2 months')::date, pg_temp.fx('cc'), null, null, pg_temp.fx('outra'));
select public.recurrence_create('income', 'Repasse recorrente', 7000, 7, (pg_temp.fini() - interval '2 months')::date, pg_temp.fx('cc'), null, null, pg_temp.fx('emprec'));
select is((select regular_income_expected || '|' || regular_income || '|' || regular_income_source || '|' || commitment_pct from hi),
          '6000.00|6000.00|recurring|16.7', 'K7 com a recorrente de salário, vale a esperada (a maior): 1000 ÷ 6000 = 16,7%');
-- os lançamentos que a recorrente gerou são planejados: a taxa de poupança (só pagos) não muda
select is((select savings_income from hi), 6000.00, 'K8 a recorrente não mexe na receita paga do mês fechado');
-- a parcela paga continua sendo a parcela do mês
select public.debt_schedule_record_payment(
  (select id from public.debt_payment_schedule where debt_id = pg_temp.fx('emp') and due_date between pg_temp.fini() and pg_temp.ffim()),
  pg_temp.fini() + 9, pg_temp.fx('cc'), 450, 50, 0, pg_temp.fx('desp'));
select is((select debt_installments from hi), 1000.00, 'K9 parcela do mês fechado já paga continua contando');
select is((select debt_installments from public.home_indicators(pg_temp.fx('h'), pg_temp.fini())), 0::numeric,
          'K10 olhando do mês fechado, o mês anterior a ele (antes do 1º vencimento) não tem parcela');

-- ---- família nova: divisão por zero e meses que não existiam ----
select pg_temp.login('00000000-0000-0000-0000-0000000071a2');
insert into fixture select 'h2', public.create_household('Casa Nova');
select is((select closed_months || '|' || coalesce(reserve_months::text, '—') from public.home_indicators(pg_temp.fx('h2'), pg_temp.hoje())),
          '0|—', 'Z1 sem conta nenhuma: 0 mês fechado e reserva "—"');
insert into fixture select 'cc2', pg_temp.conta(pg_temp.fx('h2'), 'Conta nova', 'checking', 100, (pg_temp.ini() - interval '2 months')::date + 14);
select is((select row(income, expense, result, savings_rate, savings_band, typical_expense, reserve_months, reserve_band, commitment_pct, commitment_band, closed_months)::text
             from public.home_indicators(pg_temp.fx('h2'), pg_temp.hoje())),
          '(0,0,0,,,0.00,,,,,2)', 'Z2 sem receita, despesa nem renda: taxa, reserva e comprometimento vazios ("—"), sem faixa; 2 meses fechados');
select pg_temp.lanc(pg_temp.fx('h2'), pg_temp.fx('cc2'), 'expense',
  (select id from public.categories where household_id = pg_temp.fx('h2') and type = 'expense' and parent_id is null order by name limit 1),
  200, pg_temp.fini() + 2, 'Despesa nova');
select is((select typical_expense || '|' || reserve_months || '|' || reserve_band from public.home_indicators(pg_temp.fx('h2'), pg_temp.hoje())),
          '100.00|0.0|critico', 'Z3 mediana de 2 meses (0 e 200) = 100; sem reserva = 0,0 mês (crítico)');

-- ---- isolamento ----
select is((select count(*) from public.home_indicators(pg_temp.fx('h'), pg_temp.hoje())), 0::bigint, 'I1 quem não é da família não vê nada');
update public.categories set non_consumption = false where id = pg_temp.fx('quit');
select pg_temp.login('00000000-0000-0000-0000-0000000071a1');
select is((select non_consumption from public.categories where id = pg_temp.fx('quit')), true, 'I2 quem não é da família não altera a marca');
select is((select count(*) from public.home_indicators(pg_temp.fx('h2'), pg_temp.hoje())), 0::bigint, 'I3 nem vê a outra família');
select is((select count(*) from hi), 1::bigint, 'I4 o membro vê uma linha');

select * from finish();
rollback;
