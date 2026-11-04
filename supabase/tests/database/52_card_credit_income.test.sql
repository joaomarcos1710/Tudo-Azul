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
           values (pg_temp.fx('h'), 'Banco', 'checking', 5000.00, '2026-01-01') returning id)
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

-- fatura escolhida (cartão D, datas passadas e isoladas: maio/junho de 2026 não têm outro movimento)
insert into fixture select 'd', public.create_debt('Cartão D', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('d'), 17, 25);
insert into fixture select 'c4', public.card_credit_income(pg_temp.fx('d'), '2026-03-01', 10.00, pg_temp.fx('inc'), 'Cashback', '2026-05-17');
select is((select date from public.debt_events where id = pg_temp.fx('c4')), '2026-05-17'::date, 'CI29 fatura escolhida (17/05) em vez da aberta (17/03)');
select is(pg_temp.resumo('2026-05-01', '2026-05-31'), '10.00|0.00|0.00|0.00', 'CI30 receita no mês da fatura escolhida (maio)');
select is(pg_temp.sqlstate_of(format($$select public.card_credit_income(%L, '2026-03-01', 1.00, %L, 'x', '2026-06-17')$$, pg_temp.fx('d'), pg_temp.fx('inc'))),
          null, 'CI30b até 3 faturas depois da aberta (17/03 + 3 = 17/06): aceito');
select is(pg_temp.sqlstate_of(format($$select public.card_credit_income(%L, '2026-03-01', 1.00, %L, 'x', '2026-07-17')$$, pg_temp.fx('d'), pg_temp.fx('inc'))),
          '22023', 'CI30c 4 faturas depois: recusado (limite de 3, como na 051)');
select is(pg_temp.sqlstate_of(format($$select public.card_credit_income(%L, '2026-03-01', 1.00, %L, 'x', '2027-03-17')$$, pg_temp.fx('d'), pg_temp.fx('inc'))),
          '22023', 'CI30d um ano depois: recusado');
select is(pg_temp.sqlstate_of(format($$select public.card_credit_income(%L, '2026-03-01', 10.00, %L, 'x', '2026-04-10')$$, pg_temp.fx('d'), pg_temp.fx('inc'))),
          '22023', 'CI31 data que não é fechamento do cartão: recusada');
select is(pg_temp.sqlstate_of(format($$select public.card_credit_income(%L, '2026-03-01', 10.00, %L, 'x', '2026-02-17')$$, pg_temp.fx('d'), pg_temp.fx('inc'))),
          '22023', 'CI32 fatura antes da aberta (fechou antes do crédito): recusada');
select is(pg_temp.sqlstate_of(format($$select public.card_credit_income(%L, '2026-03-17', 10.00, %L, 'x', '2026-03-17')$$, pg_temp.fx('d'), pg_temp.fx('inc'))),
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
-- trava do início do cartão pela data do FECHAMENTO (como a 051), não pela do crédito. Cartão C começa em 01/04.
insert into fixture select 'cc', public.create_debt('Cartão C', 'card', '2026-04-01', 0);
select public.set_card_cycle(pg_temp.fx('cc'), 17, 25);
select is(pg_temp.sqlstate_of(format($$select public.card_credit_income(%L, '2026-03-10', 10.00, %L, 'x')$$, pg_temp.fx('cc'), pg_temp.fx('inc'))),
          '23514', 'CI43 crédito numa fatura que fecha até o início do cartão (17/03 <= 01/04): recusado');
select is(pg_temp.sqlstate_of(format($$select public.card_credit_income(%L, '2026-03-25', 10.00, %L, 'x')$$, pg_temp.fx('cc'), pg_temp.fx('inc'))),
          null, 'CI43b crédito de antes do início que fecha depois dele (17/04): aceito');
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

-- ---------------------------------------------------------------------------
-- Revisão (achado 1): a devolução em dinheiro que levou o crédito não pode reaparecer como adiantamento
-- ---------------------------------------------------------------------------
-- cartão B: crédito de 40,00 (fatura 17/08 sem compras), devolvido em 20/08; compra de 100,00 em 20/08 (fatura 17/09)
select public.card_purchase(pg_temp.fx('b'), '2026-08-20', 100.00, 1, pg_temp.fx('cat'), 'Compra depois da devolução');
select public.card_bill_due('2026-10-31');
select is(pg_temp.fatura(pg_temp.fx('b'), '2026-09'), '100.00|0.00|100.00|0.00|0.00',
          'CR1 setembro: 100,00 a pagar e NADA pago (os 40,00 de crédito já voltaram em dinheiro)');
select is((select advance_in::numeric(14,2) || '|' || advance_out::numeric(14,2) from public.card_months(pg_temp.fx('b')) where label = '2026-09'),
          '0.00|0.00', 'CR2 sem adiantamento fantasma');
select is((select remaining from public.card_invoices_due(pg_temp.fx('h'), '2026-09-01', '2026-09-30') where debt_id = pg_temp.fx('b')),
          100.00::numeric, 'CR3 faturas que vencem: falta 100,00');
select is(pg_temp.saldo(pg_temp.fx('b'), '2026-09-30'), '100.00|0.00', 'CR4 e bate com a dívida do cartão (100,00)');

-- crédito + pagamento acima da fatura (cartão H, fevereiro/março)
insert into fixture select 'hc', public.create_debt('Cartão H', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('hc'), 17, 25);
select public.card_purchase(pg_temp.fx('hc'), '2026-02-05', 100.00, 1, pg_temp.fx('cat'), 'Compra de fevereiro');
select public.card_credit_income(pg_temp.fx('hc'), '2026-02-06', 30.00, pg_temp.fx('inc'), 'Estorno de IOF');
select public.card_bill_due('2026-10-31');
select public.debt_pay(pg_temp.fx('hc'), '2026-02-20', pg_temp.fx('bank'), 100.00,
                       (select id from public.debt_invoices where debt_id = pg_temp.fx('hc') and label = '2026-02'));
select is(pg_temp.fatura(pg_temp.fx('hc'), '2026-02'), '70.00|0.00|70.00|70.00|30.00', 'CP1 fatura de 70,00 (100 − 30) paga com 100,00');
select is((select advance_out from public.card_months(pg_temp.fx('hc')) where label = '2026-02'), 30.00::numeric, 'CP2 sobra 30,00 de adiantamento');
select is(pg_temp.saldo(pg_temp.fx('hc'), '2026-02-28'), '0.00|30.00', 'CP3 crédito a receber de 30,00');
select public.card_purchase(pg_temp.fx('hc'), '2026-03-01', 50.00, 1, pg_temp.fx('cat'), 'Compra de março');
select public.card_bill_due('2026-10-31');
select is(pg_temp.fatura(pg_temp.fx('hc'), '2026-03'), '50.00|0.00|50.00|30.00|0.00', 'CP4 março: o adiantamento paga 30,00 dos 50,00');
select is(pg_temp.saldo(pg_temp.fx('hc'), '2026-03-31'), '20.00|0.00', 'CP5 dívida de 20,00, igual ao que falta na fatura');

-- idempotência (achados 2 e 7)
insert into fixture values ('k2', '00000000-0000-0000-0000-0000000052f2'), ('k3', '00000000-0000-0000-0000-0000000052f3');
select public.debt_pay(pg_temp.fx('hc'), '2026-03-20', pg_temp.fx('bank'), 5.00, null, false, pg_temp.fx('k2'));
select is(pg_temp.sqlstate_of(format($$select public.card_credit_income(%L, '2026-03-02', 1.00, %L, 'x', null, %L)$$,
                                     pg_temp.fx('hc'), pg_temp.fx('inc'), pg_temp.fx('k2'))),
          '22023', 'CK1 chave já usada num pagamento do mesmo cartão: recusada (anular um anularia o outro)');
select is((select count(*)::int from public.debt_events where op_id = pg_temp.fx('k2')), 1, 'CK2 nada foi gravado com a chave do pagamento');
insert into fixture select 'ck', public.card_credit_income(pg_temp.fx('hc'), '2026-03-02', 2.00, pg_temp.fx('inc'), 'Ajuste', null, pg_temp.fx('k3'));
select public.debt_void(pg_temp.fx('ck'), 'engano');
select is(pg_temp.sqlstate_of(format($$select public.card_credit_income(%L, '2026-03-02', 2.00, %L, 'Ajuste', null, %L)$$,
                                     pg_temp.fx('hc'), pg_temp.fx('inc'), pg_temp.fx('k3'))),
          '22023', 'CK3 chave de crédito já anulado: recusada (não regrava nem finge que gravou)');
select is((select count(*)::int from public.debt_events where op_id = pg_temp.fx('k3')), 1, 'CK4 continua um evento só com a chave');

-- ---------------------------------------------------------------------------
-- Fatura que ainda não fechou (datas a partir de hoje): receita planejada, limite volta na hora, não arquiva
-- ---------------------------------------------------------------------------
reset role;
create temp table dias as
  select (now() at time zone 'America/Sao_Paulo')::date as hoje,
         private.card_first_closing((now() at time zone 'America/Sao_Paulo')::date, 10) as fecha;
grant select on dias to public;
select pg_temp.login('00000000-0000-0000-0000-0000000052a1');
insert into fixture select 'f', public.create_debt('Cartão F', 'card', (select hoje - 60 from dias), 0);
select public.set_card_cycle(pg_temp.fx('f'), 10, 20);
select public.set_card_limit(pg_temp.fx('f'), 1000.00);
select public.card_purchase(pg_temp.fx('f'), (select hoje from dias), 100.00, 1, pg_temp.fx('cat'), 'Compra de hoje');
insert into fixture select 'cf', public.card_credit_income(pg_temp.fx('f'), (select hoje from dias), 30.00, pg_temp.fx('inc'), 'Cashback de hoje');
select is((select date from public.debt_events where id = pg_temp.fx('cf')), (select fecha from dias), 'CF1 entra na fatura que fecha depois de hoje');
select is((select income_paid::numeric(14,2) || '|' || income_planned::numeric(14,2)
             from public.period_summary(pg_temp.fx('h'), (select fecha from dias), (select fecha from dias))),
          '0.00|30.00', 'CF2 antes do fechamento: receita PLANEJADA (30,00), não recebida');
select is((select total_income::numeric(14,2) from public.cash_flow_report(pg_temp.fx('h'), (select fecha from dias), (select fecha from dias), 'day') limit 1),
          0.00::numeric, 'CF3 fluxo só com efetuados: fora');
select is((select total_income::numeric(14,2) from public.cash_flow_report(pg_temp.fx('h'), (select fecha from dias), (select fecha from dias), 'day', null, null, true) limit 1),
          30.00::numeric, 'CF4 fluxo com planejados: entra (como as compras)');
select is((select income_regular::numeric(14,2) || '|' || income_eventual::numeric(14,2)
             from public.income_regularity(pg_temp.fx('h'), (select fecha from dias), (select fecha from dias))),
          '0.00|0.00', 'CF5 renda regular × eventual só conta o realizado: fora até fechar');
select is((select share_income from public.budget_rule_report(pg_temp.fx('h'), (select fecha from dias), (select fecha from dias)) where grp = 'none'),
          null, 'CF6 regra 50-30-20: base de renda só com o realizado (sem renda = nulo)');
select is((select committed::numeric(14,2) || '|' || available::numeric(14,2) from public.card_limits(pg_temp.fx('h'), (select hoje from dias)) where debt_id = pg_temp.fx('f')),
          '70.00|930.00', 'CF7 limite: o crédito devolve 30,00 já na data do crédito (compra 100 − 30)');
select is((select committed::numeric(14,2) from public.card_limits(pg_temp.fx('h'), (select hoje - 1 from dias)) where debt_id = pg_temp.fx('f')),
          100.00::numeric, 'CF8 na véspera do crédito o limite ainda não voltou');
select is((select committed::numeric(14,2) from public.card_limits(pg_temp.fx('h'), (select fecha from dias)) where debt_id = pg_temp.fx('f')),
          70.00::numeric, 'CF9 no fechamento o crédito está no saldo e não conta duas vezes');
select is((select (select net_worth from public.net_worth(pg_temp.fx('h'), (select fecha from dias)))
                - (select net_worth from public.net_worth(pg_temp.fx('h'), (select hoje from dias))))::numeric(14,2),
          30.00::numeric, 'CF10 patrimônio: o crédito entra (como crédito a receber) no fechamento');
select is((select credit_receivable from public.debt_balances(pg_temp.fx('h'), (select fecha from dias)) where debt_id = pg_temp.fx('f')),
          30.00::numeric, 'CF11 no fechamento (compra ainda não cobrada): 30,00 a receber');

-- arquivar (achado 3): cartão G só com crédito futuro
insert into fixture select 'g', public.create_debt('Cartão G', 'card', (select hoje - 60 from dias), 0);
select public.set_card_cycle(pg_temp.fx('g'), 10, 20);
insert into fixture select 'cg', public.card_credit_income(pg_temp.fx('g'), (select hoje from dias), 15.00, pg_temp.fx('inc'), 'Reembolso');
select is(pg_temp.sqlstate_of(format($$select public.debt_archive(%L)$$, pg_temp.fx('g'))), '23514',
          'CA1 cartão com crédito numa fatura que ainda não fechou não arquiva');
select public.debt_void(pg_temp.fx('cg'), 'engano');
select is(pg_temp.sqlstate_of(format($$select public.debt_archive(%L)$$, pg_temp.fx('g'))), null, 'CA2 anulado o crédito, arquiva');

select is(pg_temp.sqlstate_of($$set constraints all immediate$$), null, 'CI65 as checagens adiadas passam no fim');

select * from finish();
rollback;
