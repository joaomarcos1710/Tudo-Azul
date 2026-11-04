-- 52_card_credit_income: migration 052. Crédito avulso no cartão (estorno de IOF, cashback, reembolso) entra numa fatura
-- (abate o valor a pagar) e conta como RECEITA no mês do fechamento dessa fatura, na categoria de receita escolhida, em
-- todos os relatórios; nunca como despesa negativa. Anulável. Datas fixas e card_bill_due com limite explícito, para o
-- teste não depender do dia em que roda (hoje real >= 04/11/2026).
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
-- fatura do cartão: rótulo|cobrado|a cobrar|total|pago|créditos
create function pg_temp.fatura(p_card uuid, p_label text) returns text language sql as $f$
  select charged::numeric(14,2) || '|' || pending::numeric(14,2) || '|' || total::numeric(14,2) || '|' || paid::numeric(14,2)
         || '|' || credits::numeric(14,2)
    from public.card_months(p_card) where label = p_label $f$;
create function pg_temp.resumo(p_from date, p_to date) returns text language sql as $f$
  select income_paid::numeric(14,2) || '|' || expense_paid::numeric(14,2) || '|' || income_planned::numeric(14,2)
         || '|' || expense_planned::numeric(14,2)
    from public.period_summary(pg_temp.fx('h'), p_from, p_to) $f$;
create function pg_temp.saldo(p_card uuid, p_as_of date) returns text language sql as $f$
  select debt::numeric(14,2) || '|' || credit_receivable::numeric(14,2)
    from public.debt_balances(pg_temp.fx('h'), p_as_of) where debt_id = p_card $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.sqlstate_of(text), pg_temp.fatura(uuid, text),
  pg_temp.resumo(date, date), pg_temp.saldo(uuid, date) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000052a1', 'c1@teste.com'),
  ('00000000-0000-0000-0000-0000000052a2', 'c2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000052a1');
insert into fixture select 'h', public.create_household('Casa do Crédito');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 5000.00, '2026-07-01') returning id)
  insert into fixture select 'bank', id from i;
insert into fixture select 'cat', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';
insert into fixture select 'inc', id from public.categories where household_id = pg_temp.fx('h') and name = 'Outras receitas';
with c as (insert into public.categories (household_id, name, type) values (pg_temp.fx('h'), 'Reembolsos', 'income') returning id)
  insert into fixture select 'inc_ev', id from c;
update public.categories set eventual = true where id = pg_temp.fx('inc_ev');

-- Cartão A: fecha dia 17, vence dia 25. Compra de 300,00 em 05/08 => fatura que fecha em 17/08.
insert into fixture select 'a', public.create_debt('Cartão A', 'card', '2026-07-01', 0);
select public.set_card_cycle(pg_temp.fx('a'), 17, 25);
select public.card_purchase(pg_temp.fx('a'), '2026-08-05', 300.00, 1, pg_temp.fx('cat'), 'Compra de agosto');
select public.card_bill_due('2026-10-31');

-- ---------------------------------------------------------------------------
-- Cria e abate a fatura
-- ---------------------------------------------------------------------------
insert into fixture select 'c1', public.card_credit_income(pg_temp.fx('a'), '2026-08-10', 50.00, pg_temp.fx('inc'), 'Estorno de IOF');
select is((select date || '|' || credit_date || '|' || kind || '|' || amount || '|' || category_type || '|' || note
             from public.debt_events where id = pg_temp.fx('c1')),
          '2026-08-17|2026-08-10|income_credit|50.00|income|Estorno de IOF',
          'CI1 crédito de 10/08 entra na fatura aberta (fecha 17/08); a data do crédito fica guardada');
select is(pg_temp.fatura(pg_temp.fx('a'), '2026-08'), '250.00|0.00|250.00|0.00|50.00',
          'CI2 a fatura de agosto cai de 300,00 para 250,00 (créditos = 50,00)');
select is(pg_temp.saldo(pg_temp.fx('a'), '2026-08-31'), '250.00|0.00', 'CI3 dívida do cartão em 31/08: 250,00');
select is(pg_temp.saldo(pg_temp.fx('a'), '2026-08-16'), '0.00|0.00', 'CI4 antes do fechamento nada entrou (nem a compra nem o crédito)');

-- ---------------------------------------------------------------------------
-- Receita no mês do fechamento, nunca despesa negativa
-- ---------------------------------------------------------------------------
select is(pg_temp.resumo('2026-08-01', '2026-08-31'), '50.00|300.00|0.00|0.00',
          'CI5 period_summary de agosto: receita 50,00 e despesa 300,00 (o crédito NÃO abate a despesa)');
select is(pg_temp.resumo('2026-07-01', '2026-07-31'), '0.00|0.00|0.00|0.00', 'CI6 julho não tem nada');
select is((select array_agg(name || '=' || amount::numeric(14,2) order by name)
             from public.expenses_by_category(pg_temp.fx('h'), '2026-08-01', '2026-08-31')),
          array['Compras pessoais=300.00'], 'CI7 despesas por categoria: só a compra; a categoria de receita não aparece');
select is((select sum(amount) from public.daily_expenses(pg_temp.fx('h'), '2026-08-01', '2026-08-31')), 300.00::numeric,
          'CI8 despesa por dia soma 300,00 (sem crédito negativo)');
select is((select income::numeric(14,2) || '|' || expense::numeric(14,2)
             from public.cash_flow_report(pg_temp.fx('h'), '2026-08-01', '2026-08-31', 'month')),
          '50.00|300.00', 'CI9 fluxo de caixa de agosto: entrada 50,00, saída 300,00');
select is((select income::numeric(14,2) from public.cash_flow_report(pg_temp.fx('h'), '2026-08-01', '2026-08-31', 'day') where period_start = '2026-08-17'),
          50.00::numeric, 'CI10 no fluxo por dia, a entrada é no dia do fechamento (17/08)');
select is((select total_income::numeric(14,2) from public.cash_flow_report(pg_temp.fx('h'), '2026-08-01', '2026-08-31', 'month', array[pg_temp.fx('bank')]) limit 1),
          0.00::numeric, 'CI11 com filtro de conta o crédito fica de fora (não passou por conta nenhuma)');
select is((select total_income::numeric(14,2) from public.cash_flow_report(pg_temp.fx('h'), '2026-08-01', '2026-08-31', 'month', null, '00000000-0000-0000-0000-0000000052a1') limit 1),
          50.00::numeric, 'CI12 filtro de membro: quem lançou o crédito');
select is((select income_regular::numeric(14,2) || '|' || income_eventual::numeric(14,2) || '|' || coverage_pct
             from public.income_regularity(pg_temp.fx('h'), '2026-08-01', '2026-08-31')),
          '50.00|0.00|16.7', 'CI13 renda regular × eventual: os 50,00 são regulares ("Outras receitas"); cobre 16,7% da despesa');
select is((select share_income from public.budget_rule_report(pg_temp.fx('h'), '2026-08-01', '2026-08-31') where grp = 'none'),
          600.0::numeric, 'CI14 regra 50-30-20: a renda do mês (base) inclui o crédito (300 / 50 = 600%)');

-- paga a fatura de agosto (250,00)
select public.debt_pay(pg_temp.fx('a'), '2026-08-25', pg_temp.fx('bank'), 250.00,
                       (select id from public.debt_invoices where debt_id = pg_temp.fx('a') and label = '2026-08'));
select is(pg_temp.fatura(pg_temp.fx('a'), '2026-08'), '250.00|0.00|250.00|250.00|50.00', 'CI15 fatura de agosto paga com 250,00');

-- crédito NO DIA do fechamento vai para a fatura seguinte (mesma regra da compra)
insert into fixture select 'c2', public.card_credit_income(pg_temp.fx('a'), '2026-09-17', 20.00, pg_temp.fx('inc'), 'Ajuste de crédito');
select is((select date from public.debt_events where id = pg_temp.fx('c2')), '2026-10-17'::date,
          'CI16 crédito em 17/09 (dia do fechamento) entra na fatura de 17/10');

-- crédito maior que a fatura (setembro não tem compra): o total não fica negativo, sobra vira adiantamento
insert into fixture select 'c3', public.card_credit_income(pg_temp.fx('a'), '2026-09-05', 80.00, pg_temp.fx('inc_ev'), 'Reembolso do plano de saúde');
select is(pg_temp.fatura(pg_temp.fx('a'), '2026-09'), '-80.00|0.00|0.00|0.00|80.00',
          'CI17 mês só com crédito aparece como fatura de total 0,00 (nunca negativo)');
select is((select advance_out from public.card_months(pg_temp.fx('a')) where label = '2026-09'), 80.00::numeric,
          'CI18 o que sobra (80,00) vira adiantamento para as próximas faturas');
select is(pg_temp.saldo(pg_temp.fx('a'), '2026-09-30'), '0.00|80.00', 'CI19 no saldo do cartão: crédito a receber de 80,00');
select is(pg_temp.sqlstate_of($$set constraints all immediate$$), null, 'CI20 crédito acima da dívida não quebra as checagens do cartão (debt_chk)');

-- outubro: compra de 150,00 + crédito de 20,00 + adiantamento de 80,00
select public.card_purchase(pg_temp.fx('a'), '2026-09-20', 150.00, 1, pg_temp.fx('cat'), 'Compra de setembro');
select public.card_bill_due('2026-10-31');
select is(pg_temp.fatura(pg_temp.fx('a'), '2026-10'), '130.00|0.00|130.00|80.00|20.00',
          'CI21 outubro: 150 − 20 de crédito = 130,00; o adiantamento de 80,00 já paga parte');
select is(pg_temp.saldo(pg_temp.fx('a'), '2026-10-31'), '50.00|0.00', 'CI22 dívida em 31/10 bate com a fatura: 130 − 80 = 50,00');
select is((select total::numeric(14,2) || '|' || remaining::numeric(14,2)
             from public.card_invoices_month(pg_temp.fx('h'), '2026-10-01')),
          '130.00|50.00', 'CI23 faturas que vencem em outubro: total 130,00, falta 50,00');
select is((select invoices::numeric(14,2) from public.balance_totals_projected(pg_temp.fx('h'), '2026-10-31')), 50.00::numeric,
          'CI24 saldo projetado desconta só o que falta da fatura abatida (50,00)');

select is(pg_temp.resumo('2026-09-01', '2026-09-30'), '80.00|0.00|0.00|0.00', 'CI25 setembro: receita 80,00 (o crédito de 17/09 não é de setembro)');
select is(pg_temp.resumo('2026-10-01', '2026-10-31'), '20.00|150.00|0.00|0.00', 'CI26 outubro: receita 20,00, despesa 150,00');
select is((select income_regular::numeric(14,2) || '|' || income_eventual::numeric(14,2)
             from public.income_regularity(pg_temp.fx('h'), '2026-09-01', '2026-09-30')),
          '0.00|80.00', 'CI27 a categoria eventual ("Reembolsos") manda o crédito para a renda eventual');
select is((select array_agg(income::numeric(14,2) order by period_start)
             from public.cash_flow_report(pg_temp.fx('h'), '2026-08-01', '2026-10-31', 'month')),
          array[50.00, 80.00, 20.00]::numeric[], 'CI28 fluxo mês a mês: 50 / 80 / 20');

-- fatura escolhida
insert into fixture select 'c4', public.card_credit_income(pg_temp.fx('a'), '2026-10-01', 10.00, pg_temp.fx('inc'), 'Cashback', '2026-11-17');
select is((select date from public.debt_events where id = pg_temp.fx('c4')), '2026-11-17'::date, 'CI29 fatura escolhida (17/11) em vez da aberta (17/10)');
select is(pg_temp.resumo('2026-11-01', '2026-11-30'), '10.00|0.00|0.00|0.00', 'CI30 receita no mês da fatura escolhida (novembro)');
select is(pg_temp.sqlstate_of(format($$select public.card_credit_income(%L, '2026-10-01', 10.00, %L, 'x', '2026-10-10')$$, pg_temp.fx('a'), pg_temp.fx('inc'))),
          '22023', 'CI31 data que não é fechamento do cartão: recusada');
select is(pg_temp.sqlstate_of(format($$select public.card_credit_income(%L, '2026-10-01', 10.00, %L, 'x', '2026-09-17')$$, pg_temp.fx('a'), pg_temp.fx('inc'))),
          '22023', 'CI32 fatura que fechou antes do crédito: recusada');
select is(pg_temp.sqlstate_of(format($$select public.card_credit_income(%L, '2026-10-17', 10.00, %L, 'x', '2026-10-17')$$, pg_temp.fx('a'), pg_temp.fx('inc'))),
          '22023', 'CI33 fatura que fecha no dia do crédito: recusada (já é a seguinte)');

-- idempotência
insert into fixture values ('k', '00000000-0000-0000-0000-0000000052ff');
select is(public.card_credit_income(pg_temp.fx('a'), '2026-10-02', 5.00, pg_temp.fx('inc'), 'Clique duplo', null, pg_temp.fx('k')),
          public.card_credit_income(pg_temp.fx('a'), '2026-10-02', 5.00, pg_temp.fx('inc'), 'Clique duplo', null, pg_temp.fx('k')),
          'CI34 mesma chave devolve o mesmo crédito');
select is((select count(*)::int from public.debt_events where op_id = pg_temp.fx('k')), 1, 'CI35 e grava uma vez só');

-- ---------------------------------------------------------------------------
-- Valores e parâmetros inválidos
-- ---------------------------------------------------------------------------
select is(pg_temp.sqlstate_of(format($$select public.card_credit_income(%L, '2026-10-01', 0, %L, 'x')$$, pg_temp.fx('a'), pg_temp.fx('inc'))),
          '22023', 'CI36 valor zero: recusado');
select is(pg_temp.sqlstate_of(format($$select public.card_credit_income(%L, '2026-10-01', -5.00, %L, 'x')$$, pg_temp.fx('a'), pg_temp.fx('inc'))),
          '22023', 'CI37 valor negativo: recusado');
select is(pg_temp.sqlstate_of(format($$select public.card_credit_income(%L, '2026-10-01', null, %L, 'x')$$, pg_temp.fx('a'), pg_temp.fx('inc'))),
          '22023', 'CI38 valor nulo: recusado');
select is(pg_temp.sqlstate_of(format($$select public.card_credit_income(%L, '2026-10-01', 10.001, %L, 'x')$$, pg_temp.fx('a'), pg_temp.fx('inc'))),
          '22003', 'CI39 mais de 2 casas: recusado');
select is(pg_temp.sqlstate_of(format($$select public.card_credit_income(%L, null, 10.00, %L, 'x')$$, pg_temp.fx('a'), pg_temp.fx('inc'))),
          '22023', 'CI40 sem data: recusado');
select is(pg_temp.sqlstate_of(format($$select public.card_credit_income(%L, '2026-10-01', 10.00, %L, '   ')$$, pg_temp.fx('a'), pg_temp.fx('inc'))),
          '22023', 'CI41 sem descrição: recusado');
select is(pg_temp.sqlstate_of(format($$select public.card_credit_income(%L, '2026-10-01', 10.00, %L, 'x')$$, pg_temp.fx('a'), pg_temp.fx('cat'))),
          '23514', 'CI42 categoria de DESPESA: recusada (o crédito é receita)');
select is(pg_temp.sqlstate_of(format($$select public.card_credit_income(%L, '2026-07-01', 10.00, %L, 'x')$$, pg_temp.fx('a'), pg_temp.fx('inc'))),
          '23514', 'CI43 crédito na data de referência do cartão (ou antes): recusado');
insert into fixture select 'loan', public.create_debt('Empréstimo', 'loan', '2026-07-01', 1000.00);
select is(pg_temp.sqlstate_of(format($$select public.card_credit_income(%L, '2026-10-01', 10.00, %L, 'x')$$, pg_temp.fx('loan'), pg_temp.fx('inc'))),
          '23514', 'CI44 empréstimo não tem crédito avulso');
insert into fixture select 'semciclo', public.create_debt('Cartão sem ciclo', 'card', '2026-07-01', 0);
select is(pg_temp.sqlstate_of(format($$select public.card_credit_income(%L, '2026-10-01', 10.00, %L, 'x')$$, pg_temp.fx('semciclo'), pg_temp.fx('inc'))),
          '55000', 'CI45 cartão sem fechamento definido: recusado');
select is(pg_temp.sqlstate_of(format($$insert into public.debt_events (household_id, debt_id, date, kind, amount, category_id, category_type, credit_date)
                                       values (%L, %L, '2026-10-17', 'income_credit', 1.00, %L, 'income', '2026-10-01')$$,
                                     pg_temp.fx('h'), pg_temp.fx('a'), pg_temp.fx('inc'))),
          '42501', 'CI46 o cliente não grava evento direto (só pela função)');
reset role;
select is(pg_temp.sqlstate_of(format($$insert into public.debt_events (household_id, debt_id, date, kind, amount, category_id, category_type)
                                       values (%L, %L, '2026-10-17', 'income_credit', 1.00, %L, 'income')$$,
                                     pg_temp.fx('h'), pg_temp.fx('a'), pg_temp.fx('inc'))),
          '23514', 'CI47 mesmo por fora da função, crédito avulso sem data do crédito é recusado (constraint)');
select is(pg_temp.sqlstate_of(format($$insert into public.debt_events (household_id, debt_id, date, kind, amount, category_id, category_type, credit_date)
                                       values (%L, %L, '2026-10-17', 'income_credit', 1.00, %L, 'expense', '2026-10-01')$$,
                                     pg_temp.fx('h'), pg_temp.fx('a'), pg_temp.fx('cat'))),
          '23514', 'CI48 e com categoria de despesa também (constraint)');
select is(pg_temp.sqlstate_of(format($$update public.debt_events set credit_date = '2026-10-02' where id = %L$$, pg_temp.fx('c2'))),
          '42501', 'CI49 evento imutável: a data do crédito não muda (só a anulação)');

-- ---------------------------------------------------------------------------
-- Outra família não acessa
-- ---------------------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000052a2');
insert into fixture select 'h2', public.create_household('Casa Vizinha');
insert into fixture select 'inc2', id from public.categories where household_id = pg_temp.fx('h2') and name = 'Outras receitas';
select is(pg_temp.sqlstate_of(format($$select public.card_credit_income(%L, '2026-10-01', 10.00, %L, 'x')$$, pg_temp.fx('a'), pg_temp.fx('inc2'))),
          '42501', 'CI50 outra família não lança crédito no meu cartão');
select is((select count(*)::int from public.debt_events where kind = 'income_credit'), 0, 'CI51 e não vê os meus créditos');
select is(pg_temp.sqlstate_of(format($$select public.debt_void(%L, 'invasão')$$, pg_temp.fx('c2'))), '42501', 'CI52 nem anula');
select is((select count(*)::int from public.period_summary(pg_temp.fx('h'), '2026-08-01', '2026-08-31')), 0, 'CI53 nem lê o meu resumo');
select is((select count(*)::int from public.card_months(pg_temp.fx('a'))), 0, 'CI54 nem as minhas faturas');
reset role;

select pg_temp.login('00000000-0000-0000-0000-0000000052a1');
select is(pg_temp.sqlstate_of(format($$select public.card_credit_income(%L, '2026-10-01', 10.00, %L, 'x')$$, pg_temp.fx('a'), pg_temp.fx('inc2'))),
          '23514', 'CI55 categoria de receita de outra família: recusada');

-- ---------------------------------------------------------------------------
-- Anular desfaz tudo
-- ---------------------------------------------------------------------------
select is(public.debt_void(pg_temp.fx('c1'), 'lançado por engano'), 1, 'CI56 anular o crédito de agosto');
select is(pg_temp.fatura(pg_temp.fx('a'), '2026-08'), '300.00|0.00|300.00|250.00|0.00', 'CI57 a fatura de agosto volta a 300,00 (faltam 50,00)');
select is(pg_temp.resumo('2026-08-01', '2026-08-31'), '0.00|300.00|0.00|0.00', 'CI58 a receita de agosto some');
select is(pg_temp.saldo(pg_temp.fx('a'), '2026-08-31'), '50.00|0.00', 'CI59 a dívida de agosto volta: 300 − 250 = 50,00');
select is((select total_income::numeric(14,2) from public.cash_flow_report(pg_temp.fx('h'), '2026-08-01', '2026-08-31', 'month') limit 1),
          0.00::numeric, 'CI60 e sai do fluxo de caixa');
select is((select income_regular::numeric(14,2) from public.income_regularity(pg_temp.fx('h'), '2026-08-01', '2026-08-31')),
          0.00::numeric, 'CI61 e da renda regular');
select is(pg_temp.sqlstate_of(format($$select public.debt_void(%L, 'de novo')$$, pg_temp.fx('c1'))), '55000', 'CI62 anular duas vezes: recusado');

-- crédito já devolvido em dinheiro não pode ser anulado (o crédito a receber ficaria negativo)
insert into fixture select 'b', public.create_debt('Cartão B', 'card', '2026-07-01', 0);
select public.set_card_cycle(pg_temp.fx('b'), 17, 25);
insert into fixture select 'c5', public.card_credit_income(pg_temp.fx('b'), '2026-08-01', 40.00, pg_temp.fx('inc'), 'Cashback');
select is(pg_temp.saldo(pg_temp.fx('b'), '2026-08-31'), '0.00|40.00', 'CI63 cartão sem compra: o crédito vira crédito a receber');
select public.debt_return(pg_temp.fx('b'), '2026-08-20', pg_temp.fx('bank'), 40.00);
select is(pg_temp.sqlstate_of(format($$select public.debt_void(%L, 'engano')$$, pg_temp.fx('c5'))), '23514',
          'CI64 depois da devolução em dinheiro, anular o crédito é recusado (devolução acima do crédito)');

select is(pg_temp.sqlstate_of($$set constraints all immediate$$), null, 'CI65 as checagens adiadas passam no fim');

select * from finish();
rollback;
