-- 07_liabilities: dívidas, cartões e financiamentos (modelo B): ciclo, estorno, antecipação, isolamento, escrita só por RPC.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ---- auxiliares de teste (temporários; somem no rollback) ----
create temp table fixture (k text primary key, v uuid, t text);
grant all on fixture to public;

create function pg_temp.fx(p_k text) returns uuid language sql as $f$ select v from fixture where k = p_k $f$;
create function pg_temp.fxt(p_k text) returns text language sql as $f$ select t from fixture where k = p_k $f$;
create function pg_temp.mkuser(p_id uuid, p_email text, p_name text default null) returns void language sql as $f$
  insert into auth.users (id, email, raw_user_meta_data)
  values (p_id, p_email, case when p_name is null then '{}'::jsonb else jsonb_build_object('name', p_name) end)
$f$;
-- Troca para um papel REAL (authenticated/anon). Sem isso a RLS não é exercitada.
create function pg_temp.login(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $f$;
create function pg_temp.login_anon() returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
end $f$;
-- Executa um comando e devolve o SQLSTATE do erro (ou NULL se não houve erro)
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
create function pg_temp.msg_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate || ' ' || sqlerrm; end $f$;

create function pg_temp.rows_of(p_sql text) returns bigint language plpgsql as $f$
declare n bigint; begin execute p_sql; get diagnostics n = row_count; return n; end $f$;
grant execute on function pg_temp.rows_of(text), pg_temp.fx(text), pg_temp.fxt(text), pg_temp.sqlstate_of(text), pg_temp.msg_of(text) to public;

-- usuários fixos
select pg_temp.mkuser('00000000-0000-0000-0000-0000000000a1', 'u1@teste.com', 'Ana');
select pg_temp.mkuser('00000000-0000-0000-0000-0000000000a2', 'u2@teste.com', 'Bia');
select pg_temp.mkuser('00000000-0000-0000-0000-0000000000a3', 'u3@teste.com', 'Caio');
select pg_temp.mkuser('00000000-0000-0000-0000-0000000000a4', 'u4@teste.com');


-- ---- cenário: família 1 (U1) com banco e categorias ----
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
insert into fixture select 'h', public.create_household('Casa Teste'), null;
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 1000.00, '2026-11-01') returning id)
  insert into fixture select 'bank', id, null from i;
insert into fixture select 'cmerc', id, null from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';
insert into fixture select 'cfee',  id, null from public.categories where household_id = pg_temp.fx('h') and name = 'Impostos e taxas';
insert into fixture select 'cinc',  id, null from public.categories where household_id = pg_temp.fx('h') and name = 'Salário';
insert into public.transactions (household_id, account_id, category_id, type, amount, date)
  values (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('cinc'), 'income', 3000.00, '2026-11-05');
insert into public.transactions (household_id, account_id, category_id, type, amount, date)
  values (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('cfee'), 'expense', 200.00, '2026-11-07');
insert into public.budgets (household_id, category_id, month, amount_limit)
  values (pg_temp.fx('h'), pg_temp.fx('cmerc'), '2026-11-01', 500.00), (pg_temp.fx('h'), pg_temp.fx('cmerc'), '2026-12-01', 500.00);

-- cartão (fatura de outubro de 100 em aberto), empréstimo e financiamento antigo
insert into fixture select 'card', public.create_debt('Cartão', 'card', '2026-11-01', 100.00), null;
insert into fixture select 'loan', public.create_debt('Empréstimo', 'loan', '2026-11-01', 0), null;
insert into fixture select 'fin',  public.create_debt('Financiamento antigo', 'financing', '2026-11-01', 3000.00), null;
-- faturas e 7 parcelas de 100 (parcelas 6..12), vencimentos a partir de 10/11
insert into fixture select 'inv_nov', public.create_debt_invoice(pg_temp.fx('card'), '2026-11', '2026-11-20'), null;
insert into fixture select 'inv_dez', public.create_debt_invoice(pg_temp.fx('card'), '2026-12', '2026-12-20'), null;
select public.create_debt_installments(pg_temp.fx('card'), 'compra1', '2026-11-10', 7, 100.00, pg_temp.fx('cmerc'), 6);
create function pg_temp.inst(p_seq int) returns uuid language sql as $f$
  select id from public.debt_installments where debt_id = pg_temp.fx('card') and plan = 'compra1' and seq = p_seq $f$;
grant execute on function pg_temp.inst(int) to public;
create function pg_temp.nw(p_d date) returns numeric[] language sql as $f$
  select array[available, debt, credit_receivable, net_worth, planned_commitments]
    from public.net_worth(pg_temp.fx('h'), p_d) $f$;
grant execute on function pg_temp.nw(date) to public;

-- L1: abertura. Disponível 1000+3000? (renda em 05/11 já conta em 31/12; aqui 01/11)
select is(pg_temp.nw('2026-11-01'), array[1000.00, 3100.00, 0, -2100.00, 700.00]::numeric[], 'L1 abertura: disponível 1.000, dívida 3.100, patrimônio −2.100, compromissos 700');
select is((select balance from public.debt_balances(pg_temp.fx('h'), '2026-11-01') where name = 'Cartão'), 100.00::numeric, 'L1 saldo do cartão = fatura de outubro');

-- ciclo do cartão (obrigação = dívida + compromissos futuros)
create function pg_temp.obl() returns numeric language sql as $f$
  select balance + planned_remaining from public.debt_balances(pg_temp.fx('h'), '2027-06-30') where name = 'Cartão' $f$;
create function pg_temp.obl_at(p_d date) returns numeric language sql as $f$
  select balance + planned_remaining from public.debt_balances(pg_temp.fx('h'), p_d) where name = 'Cartão' $f$;
grant execute on function pg_temp.obl(), pg_temp.obl_at(date) to public;
select is(pg_temp.obl_at('2026-11-01'), 800.00::numeric, 'L2 obrigação inicial 800');
select public.debt_bill(pg_temp.inst(6), '2026-11-10', pg_temp.fx('inv_nov'));
select is(pg_temp.obl_at('2026-11-10'), 800.00::numeric, 'L3 faturar não altera a obrigação (sem contagem dupla)');
select public.debt_pay(pg_temp.fx('card'), '2026-11-12', pg_temp.fx('bank'), 100.00);
select public.debt_pay(pg_temp.fx('card'), '2026-11-15', pg_temp.fx('bank'), 60.00, pg_temp.fx('inv_nov'));
select public.debt_pay(pg_temp.fx('card'), '2026-11-20', pg_temp.fx('bank'), 40.00, pg_temp.fx('inv_nov'));
select is(pg_temp.obl_at('2026-11-20'), 600.00::numeric, 'L4 pagamento parcial (60+40) quita a fatura de novembro: obrigação 600');

-- antecipação explícita: p11 (100, desconto 8) e parte de p12 (60, desconto 5); tarifa 3,50; juros 2,00
select public.debt_anticipate(pg_temp.fx('card'), '2026-12-01', pg_temp.fx('bank'),
  array[pg_temp.inst(11), pg_temp.inst(12)], array[100.00, 60.00], array[8.00, 5.00], 3.50, 2.00, pg_temp.fx('cfee'));
select is(pg_temp.obl_at('2026-12-01'), 440.00::numeric, 'L5 antecipação: obrigação cai para 440 (147 pagos + 13 de desconto)');
select is((select planned_remaining from public.debt_balances(pg_temp.fx('h'), '2026-12-01') where name = 'Cartão'), 440.00::numeric, 'L5 compromisso restante 440');
select public.debt_bill(pg_temp.inst(7), '2026-12-10', pg_temp.fx('inv_dez'));
select public.debt_refund(pg_temp.inst(6), '2026-12-11', 30.00, pg_temp.fx('inv_dez'));
select is(pg_temp.obl_at('2026-12-11'), 410.00::numeric, 'L6 estorno parcial de 30 abate a fatura aberta: 410');
select public.debt_pay(pg_temp.fx('card'), '2026-12-12', pg_temp.fx('bank'), 70.00, pg_temp.fx('inv_dez'));
select is(pg_temp.obl_at('2026-12-12'), 340.00::numeric, 'L7 paga a fatura de dezembro líquida: 340');

-- estorno integral do restante da compra
select public.debt_refund(pg_temp.inst(6), '2026-12-20', 70.00,  pg_temp.fx('inv_dez'));
select public.debt_refund(pg_temp.inst(7), '2026-12-20', 100.00, pg_temp.fx('inv_dez'));
select public.debt_refund(pg_temp.inst(8), '2026-12-20', 100.00);
select public.debt_refund(pg_temp.inst(9), '2026-12-20', 100.00);
select public.debt_refund(pg_temp.inst(10), '2026-12-20', 100.00);
select public.debt_refund(pg_temp.inst(11), '2026-12-20', 92.00, pg_temp.fx('inv_dez'));
select public.debt_refund(pg_temp.inst(12), '2026-12-20', 95.00, pg_temp.fx('inv_dez'));
select is(pg_temp.obl_at('2026-12-20'), -317.00::numeric, 'L8 estorno integral: obrigação −317 (crédito a receber 317)');
select is((select credit_receivable from public.debt_balances(pg_temp.fx('h'), '2026-12-20') where name = 'Cartão'), 317.00::numeric, 'L8 crédito a receber 317, separado da dívida');
select is((select debt from public.debt_balances(pg_temp.fx('h'), '2026-12-20') where name = 'Cartão'), 0::numeric, 'L8 dívida do cartão = 0 (não é somada com sinal)');
select is((select planned_remaining from public.debt_balances(pg_temp.fx('h'), '2026-12-20') where name = 'Cartão'), 0::numeric, 'L8 parcelas futuras canceladas: compromisso 0');
-- devolução parcial e em data posterior
select public.debt_return(pg_temp.fx('card'), '2026-12-28', pg_temp.fx('bank'), 100.00);
select is((select credit_receivable from public.debt_balances(pg_temp.fx('h'), '2026-12-28') where name = 'Cartão'), 217.00::numeric, 'L9 devolução parcial de 100: crédito 217');
select public.debt_return(pg_temp.fx('card'), '2027-01-05', pg_temp.fx('bank'), 217.00);
select is((select credit_receivable from public.debt_balances(pg_temp.fx('h'), '2027-01-05') where name = 'Cartão'), 0::numeric, 'L10 devolução posterior zera o crédito');

-- empréstimo e financiamento antigo
select public.debt_loan_event(pg_temp.fx('loan'), '2026-11-05', 'disbursement', pg_temp.fx('bank'), 10000.00);
select public.debt_pay(pg_temp.fx('loan'), '2026-12-05', pg_temp.fx('bank'), 2000.00);
select public.debt_loan_event(pg_temp.fx('loan'), '2026-12-05', 'interest', pg_temp.fx('bank'), 150.00, pg_temp.fx('cfee'));
select public.debt_pay(pg_temp.fx('loan'), '2027-01-05', pg_temp.fx('bank'), 2000.00);
select public.debt_loan_event(pg_temp.fx('loan'), '2027-01-05', 'interest', pg_temp.fx('bank'), 120.00, pg_temp.fx('cfee'));
select public.debt_pay(pg_temp.fx('loan'), '2027-02-05', pg_temp.fx('bank'), 3000.00, null, true);
select public.debt_pay(pg_temp.fx('fin'), '2026-11-20', pg_temp.fx('bank'), 500.00);
select public.debt_loan_event(pg_temp.fx('fin'), '2026-11-20', 'interest', pg_temp.fx('bank'), 40.00, pg_temp.fx('cfee'));

-- valores finais calculados à mão: disponível 5.884,50; dívida 5.500; patrimônio 384,50
select is(pg_temp.nw('2027-03-05'), array[5884.50, 5500.00, 0, 384.50, 0]::numeric[], 'L11 final: disponível 5.884,50; dívida 5.500; patrimônio 384,50');
-- conservação: patrimônio(t) = patrimônio(abertura) + receitas − despesas (fluxo líquido, estorno abate despesa)
select is(
  (select net_worth from public.net_worth(pg_temp.fx('h'), '2027-03-05')),
  (select net_worth from public.net_worth(pg_temp.fx('h'), '2026-11-01'))
    + (select income_paid - expense_paid from public.period_summary(pg_temp.fx('h'), '2026-11-02', '2027-03-05')),
  'L12 conservação do patrimônio: Δ patrimônio = receitas − despesas (fluxo líquido)');
select is((select income_paid from public.period_summary(pg_temp.fx('h'), '2026-11-01', '2027-03-05')), 3000.00::numeric,
  'L13 estorno NÃO vira receita: receita do período = só o salário');
select is((select expense_paid from public.period_summary(pg_temp.fx('h'), '2026-11-01', '2027-03-05')), 515.50::numeric,
  'L13 despesa líquida 515,50 = 200 mercado + 347 cobranças + 5,50 tarifa/juros + 310 juros de dívida − 347 estornos');
select is((select spent from public.budget_usage(pg_temp.fx('h'), '2026-11-01')), 100.00::numeric, 'L14 orçamento de novembro: cobrança de 100 em Compras pessoais');
select is((select spent from public.budget_usage(pg_temp.fx('h'), '2026-12-01')), -100.00::numeric, 'L14 orçamento de dezembro: 247 de cobranças − 347 de estornos = −100 (estorno abate a categoria)');
select is((select total from public.balance_totals(pg_temp.fx('h'), '2027-03-05')), 5884.50::numeric, 'L15 balance_totals = só dinheiro disponível (dívida fora)');

-- ---- regras: o que deve ser recusado ----
select is(pg_temp.sqlstate_of($$select public.debt_pay(pg_temp.fx('card'), '2027-03-01', pg_temp.fx('bank'), 50.00)$$), '23514', 'R1 pagamento acima do saldo devedor (prepagamento genérico) recusado');
select is(pg_temp.sqlstate_of($$select public.debt_pay(pg_temp.fx('loan'), '2027-03-05', pg_temp.fx('bank'), 5000.00)$$), '23514', 'R2 pagamento de 5.000 sobre saldo 3.000 recusado');
select is(pg_temp.sqlstate_of($$select public.debt_return(pg_temp.fx('card'), '2027-03-01', pg_temp.fx('bank'), 1.00)$$), '23514', 'R3 devolução acima do crédito recusada');
select is(pg_temp.sqlstate_of($$select public.debt_refund(pg_temp.inst(6), '2027-03-01', 1.00)$$), '23514', 'R4 estorno acima do cobrado (estorno fantasma) recusado');
select is(pg_temp.sqlstate_of($$select public.debt_bill(pg_temp.inst(6), '2027-03-01')$$), '55000', 'R5 parcela totalmente cobrada/cancelada: nada a cobrar');
select is(pg_temp.sqlstate_of($$select public.debt_pay(pg_temp.fx('loan'), '2026-10-31', pg_temp.fx('bank'), 1.00)$$), '23514', 'R6 evento anterior à data de referência recusado');
select is(pg_temp.sqlstate_of($$select public.debt_pay(pg_temp.fx('card'), '2026-11-11', pg_temp.fx('bank'), 5.00)$$), '23514', 'R7 pagamento retroativo que invalida um posterior recusado');
select is(pg_temp.sqlstate_of($$select public.debt_pay(pg_temp.fx('loan'), '2027-03-05', pg_temp.fx('bank'), 1.005)$$), '22003', 'R8 valor com 3 casas recusado (N2)');
select is(pg_temp.sqlstate_of($$select public.debt_loan_event(pg_temp.fx('loan'), '2027-03-05', 'interest', pg_temp.fx('bank'), 5.00)$$), '22023', 'R9 juros sem categoria recusados');
select is(pg_temp.sqlstate_of($$select public.debt_anticipate(pg_temp.fx('card'), '2027-03-01', pg_temp.fx('bank'), array[pg_temp.inst(8)], array[100.00], array[0.00])$$), '23514', 'R10 antecipar parcela já cancelada recusado');
-- caminhos diretos: authenticated só lê
select is(pg_temp.sqlstate_of($$insert into public.debt_events (household_id, debt_id, date, kind, amount, account_id) values (pg_temp.fx('h'), pg_temp.fx('loan'), '2027-03-05', 'payment', 1, pg_temp.fx('bank'))$$), '42501', 'D1 INSERT direto em debt_events negado');
select is(pg_temp.sqlstate_of($$update public.debt_events set amount = amount + 1 where debt_id = pg_temp.fx('loan')$$), '42501', 'D2 UPDATE direto em debt_events negado');
select is(pg_temp.sqlstate_of($$delete from public.debt_events where debt_id = pg_temp.fx('loan')$$), '42501', 'D3 DELETE direto em debt_events negado');
select is(pg_temp.sqlstate_of($$update public.debts set reference_balance = 0 where id = pg_temp.fx('fin')$$), '42501', 'D4 UPDATE da âncora da dívida negado');
select is(pg_temp.sqlstate_of($$insert into public.debts (household_id, name, kind, reference_date) values (pg_temp.fx('h'), 'x', 'loan', '2026-11-01')$$), '42501', 'D5 INSERT direto em debts negado');
select is(pg_temp.sqlstate_of($$update public.debt_installments set face = 1$$), '42501', 'D6 UPDATE de parcela negado');
select is(pg_temp.sqlstate_of($$insert into public.transactions (household_id, account_id, category_id, type, amount, date) values (pg_temp.fx('h'), pg_temp.fx('loan'), pg_temp.fx('cfee'), 'expense', 5, '2026-12-01')$$), '23503', 'D7 lançamento genérico apontando a uma dívida: recusado pela FK composta');

-- ---- anulação auditada ----
select is(pg_temp.sqlstate_of($$select public.debt_void((select id from public.debt_events where debt_id = pg_temp.fx('loan') and kind = 'disbursement'), 'engano de teste')$$), '23514', 'V1 anular o desembolso deixaria pagamentos sem saldo: recusado');
select is(public.debt_void((select id from public.debt_events where debt_id = pg_temp.fx('loan') and kind = 'interest' and date = '2026-12-05'), 'lançado em duplicidade'), 1, 'V2 anula 1 evento avulso (juros)');
select is(pg_temp.sqlstate_of($$select public.debt_void((select id from public.debt_events where debt_id = pg_temp.fx('loan') and kind = 'interest' and date = '2026-12-05'), 'de novo')$$), '55000', 'V3 anular duas vezes recusado');
select is(pg_temp.sqlstate_of($$select public.debt_void((select id from public.debt_events where debt_id = pg_temp.fx('card') and op_id is not null and kind = 'payment' order by date limit 1), 'tentativa')$$),
          '23514', 'V4 anular a antecipação do cartão é recusado: os estornos posteriores dependem das cobranças');
-- anulação de uma operação inteira, numa dívida sem dependências
insert into fixture select 'card2', public.create_debt('Cartão 2', 'card', '2026-11-01', 0), null;
select public.create_debt_installments(pg_temp.fx('card2'), 'y', '2027-04-10', 2, 50.00, pg_temp.fx('cmerc'));
select public.debt_anticipate(pg_temp.fx('card2'), '2027-03-10', pg_temp.fx('bank'),
  array[(select id from public.debt_installments where debt_id = pg_temp.fx('card2') and seq = 1)], array[50.00], array[5.00], 1.00, 0.50, pg_temp.fx('cfee'));
select is((select planned_remaining from public.debt_balances(pg_temp.fx('h'), '2027-03-10') where name = 'Cartão 2'), 50.00::numeric, 'V5 antecipação: sobra a segunda parcela (50)');
select is(public.debt_void((select id from public.debt_events where debt_id = pg_temp.fx('card2') and kind = 'payment'), 'antecipação lançada por engano'),
          5, 'V5 anular a operação inteira: desconto, cobrança, pagamento, tarifa e juros (5 eventos)');
select is((select planned_remaining from public.debt_balances(pg_temp.fx('h'), '2027-03-10') where name = 'Cartão 2'), 100.00::numeric, 'V5 anulação restaura o compromisso (100)');
select is((select count(*) from public.debt_events where debt_id = pg_temp.fx('card2') and voided_at is not null and void_reason is not null and voided_by is not null), 5::bigint, 'V5 trilha de auditoria: quem, quando e por quê nos 5 eventos');

-- ---- isolamento entre famílias ----
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
insert into fixture select 'h2', public.create_household('Casa Dois'), null;
select is((select count(*) from public.debts), 0::bigint, 'I1 outra família não enxerga dívidas');
select is((select count(*) from public.debt_events), 0::bigint, 'I1 outra família não enxerga eventos');
select is(pg_temp.sqlstate_of($$select public.debt_pay(pg_temp.fx('loan'), '2027-03-05', pg_temp.fx('bank'), 1.00)$$), '42501', 'I2 pagar dívida de outra família: recusado');
select is(pg_temp.sqlstate_of($$select public.debt_void((select id from public.debt_events limit 1), 'x')$$), '42501', 'I3 anular evento de outra família: recusado');
select is(pg_temp.sqlstate_of($$select public.debt_refund(pg_temp.inst(6), '2027-03-05', 1.00)$$), '42501', 'I4 estornar parcela de outra família: recusado');
select is((select count(*) from public.net_worth(pg_temp.fx('h'), '2027-03-05')), 0::bigint, 'I5 net_worth de outra família: zero linhas');
select is((select count(*) from public.debt_balances(pg_temp.fx('h'), '2027-03-05')), 0::bigint, 'I5 debt_balances de outra família: zero linhas');
reset role;
select pg_temp.login_anon();
select is(pg_temp.sqlstate_of($$select * from public.debts$$), '42501', 'I6 anon não lê dívidas');
select is(pg_temp.sqlstate_of($$select public.create_debt('x','loan','2026-11-01',0)$$), '42501', 'I6 anon não cria dívida');

select * from finish();
rollback;
