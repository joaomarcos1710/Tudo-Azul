-- 47_loan_principal_expense: migration 046. Parcela de empréstimo/financiamento é despesa do mês em que é paga.
-- Datas relativas a hoje em São Paulo; nada depende de data fixa nem do fuso do servidor.
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
create function pg_temp.fim() returns date language sql as $f$ select (date_trunc('month', pg_temp.hoje()) + interval '1 month - 1 day')::date $f$;
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
create function pg_temp.despesa_paga() returns numeric language sql as $f$
  select expense_paid from public.period_summary(pg_temp.fx('h'), pg_temp.ini(), pg_temp.fim()) $f$;
create function pg_temp.despesa_planejada() returns numeric language sql as $f$
  select expense_planned from public.period_summary(pg_temp.fx('h'), pg_temp.ini(), pg_temp.fim()) $f$;
create function pg_temp.na_categoria(p_k text) returns numeric language sql as $f$
  select coalesce((select amount from public.expenses_by_category(pg_temp.fx('h'), pg_temp.ini(), pg_temp.fim())
                    where category_id = pg_temp.fx(p_k)), 0) $f$;
create function pg_temp.saida_fluxo(p_contas uuid[] default null) returns numeric language sql as $f$
  select max(total_expense) from public.cash_flow_report(pg_temp.fx('h'), pg_temp.ini(), pg_temp.fim(), 'month', p_contas) $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.hoje(), pg_temp.ini(), pg_temp.fim(), pg_temp.sqlstate_of(text),
  pg_temp.despesa_paga(), pg_temp.despesa_planejada(), pg_temp.na_categoria(text), pg_temp.saida_fluxo(uuid[]) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000047a1', 'a1@teste.com'),
  ('00000000-0000-0000-0000-0000000047a2', 'a2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000047a1');
insert into fixture select 'h', public.create_household('Casa Parcelas');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Corrente', 'checking', 10000, pg_temp.ini() - 60) returning id)
  insert into fixture select 'conta', id from i;
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Outra', 'checking', 0, pg_temp.ini() - 60) returning id)
  insert into fixture select 'outra', id from i;
insert into fixture select 'fin', id from public.categories where household_id = pg_temp.fx('h') and name = 'Financiamento' and type = 'expense';
insert into fixture select 'juros', id from public.categories where household_id = pg_temp.fx('h') and name = 'Impostos e taxas' and type = 'expense';
insert into fixture select 'semcat', id from public.categories where household_id = pg_temp.fx('h') and system_key = 'uncategorized' and type = 'expense';
insert into fixture select 'receita', id from public.categories where household_id = pg_temp.fx('h') and name = 'Salário' and type = 'income';

select is(pg_temp.despesa_paga(), 0::numeric, 'P0 sem nada: despesa do mês zero');

-- financiamento com contrato: 3 parcelas de 1.000 no começo do mês atual, por boleto
insert into fixture select 'imovel', public.create_debt('Imóvel', 'financing', pg_temp.ini() - 30, 3000);
select public.debt_contract_set(pg_temp.fx('imovel'), 'Banco', null, 3, 3, 1000.00, 1, 'boleto', null, pg_temp.ini());
insert into fixture select 'p1', id from public.debt_payment_schedule where debt_id = pg_temp.fx('imovel') and installment_number = 1;

select is(pg_temp.despesa_planejada(), 1000::numeric, 'P1 parcela do mês ainda não baixada: entra em despesas planejadas');

-- baixa: 800 de principal + 200 de juros, da conta Corrente
select public.debt_schedule_record_payment(pg_temp.fx('p1'), pg_temp.ini(), pg_temp.fx('conta'), 800, 200, 0, pg_temp.fx('juros'), false);
select is(pg_temp.despesa_paga(), 1000::numeric, 'P2 paga: a parcela inteira (800 principal + 200 juros) é despesa do mês');
select is(pg_temp.despesa_planejada(), 0::numeric, 'P2.1 e sai das planejadas');
select is(pg_temp.na_categoria('semcat'), 800::numeric, 'P3 sem categoria escolhida: o principal vai para "Sem categoria"');
select is(pg_temp.na_categoria('juros'), 200::numeric, 'P3.1 juros continuam na categoria deles');
select is(pg_temp.saida_fluxo(), 1000::numeric, 'P4 Entradas x Saídas: saída de 1.000 no mês');
select is(pg_temp.saida_fluxo(array[pg_temp.fx('outra')]), 0::numeric, 'P4.1 filtrando outra conta, a parcela não aparece');

-- escolher a categoria do principal
select lives_ok($$select public.debt_set_principal_category(pg_temp.fx('imovel'), pg_temp.fx('fin'))$$, 'C1 escolhe Financiamento para o principal');
select is(pg_temp.na_categoria('fin'), 800::numeric, 'C2 o principal passa para Financiamento (também o já pago)');
select is(pg_temp.na_categoria('semcat'), 0::numeric, 'C2.1 e sai de "Sem categoria"');
select is(pg_temp.despesa_paga(), 1000::numeric, 'C2.2 o total do mês não muda');
insert into public.budgets (household_id, category_id, month, amount_limit) values (pg_temp.fx('h'), pg_temp.fx('fin'), pg_temp.ini(), 1500);
select is((select spent from public.budget_usage(pg_temp.fx('h'), pg_temp.ini()) where category_id = pg_temp.fx('fin')), 800::numeric,
  'C3 orçamento de Financiamento conta o principal pago');
select is(pg_temp.sqlstate_of($$select public.debt_set_principal_category(pg_temp.fx('imovel'), pg_temp.fx('receita'))$$), '23514', 'C4 categoria de receita: recusa');
select lives_ok($$select public.debt_set_principal_category(pg_temp.fx('imovel'), null)$$, 'C5 limpar volta para "Sem categoria"');
select is(pg_temp.na_categoria('semcat'), 800::numeric, 'C5.1 principal de volta em "Sem categoria"');

-- anular a baixa tira do mês
select public.debt_void((select id from public.debt_events where debt_id = pg_temp.fx('imovel') and kind = 'payment' and voided_at is null), 'teste');
select is(pg_temp.despesa_paga(), 0::numeric, 'V1 anular a baixa anula a operação inteira (principal e juros): sai da despesa');
select is(pg_temp.despesa_planejada(), 1000::numeric, 'V1.1 e a parcela volta para as planejadas');

-- cartão não muda: pagar fatura não é despesa (a compra já contou)
insert into fixture select 'cartao', public.create_card('Cartão', pg_temp.ini() - 30, 500, 5, 12);
select public.debt_pay(pg_temp.fx('cartao'), pg_temp.ini() + 1, pg_temp.fx('conta'), 300);
select is(pg_temp.despesa_paga(), 0::numeric, 'K1 pagamento de cartão continua fora da despesa');

-- consignado: desconto em folha não conta (o salário já entra líquido)
insert into fixture select 'cons', public.create_debt('Consignado', 'loan', pg_temp.ini() - 30, 1000);
select public.debt_contract_set(pg_temp.fx('cons'), 'Banco', null, 2, 2, 500.00, 1, 'payroll', null, pg_temp.ini());
select is(pg_temp.despesa_planejada(), 1000::numeric, 'Y1 consignado planejado não entra nas planejadas (só a parcela do imóvel, 1.000)');
select public.debt_schedule_record_payment((select id from public.debt_payment_schedule where debt_id = pg_temp.fx('cons') and installment_number = 1),
  pg_temp.ini(), null, 500, 0, 0, null, false);
select is(pg_temp.despesa_paga(), 0::numeric, 'Y2 consignado baixado não vira despesa');

-- dinheiro recebido do empréstimo não é receita
select is((select income_paid from public.period_summary(pg_temp.fx('h'), pg_temp.ini(), pg_temp.fim())), 0::numeric, 'R1 empréstimo não infla receita');

-- outra família não altera nem enxerga
select pg_temp.login('00000000-0000-0000-0000-0000000047a2');
select is(pg_temp.sqlstate_of($$select public.debt_set_principal_category(pg_temp.fx('imovel'), null)$$), '42501', 'S1 outra família não escolhe categoria');
select is((select count(*) from private.loan_principal_items(pg_temp.fx('h'), pg_temp.ini(), pg_temp.fim())), 0::bigint, 'S2 nem lê os itens');

select * from finish();
rollback;
