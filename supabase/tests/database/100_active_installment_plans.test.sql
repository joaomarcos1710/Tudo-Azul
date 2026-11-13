-- 100_active_installment_plans: parcelas ativas de Recorrentes (migration 20261112130000, active_installment_plans).
-- Leitura pura: cada parcelamento em andamento (compra parcelada no cartão ou despesa parcelada em conta) numa linha,
-- com n de N, % pago, saldo restante, o que ainda não fechou e a situação da parcela do mês; mais um total por moeda.
-- Todas as datas são fixas e a data de corte é passada de forma explícita ('2026-11-12'), então o resultado não depende
-- do dia em que o teste roda (só a data dos pagamentos tem de ser anterior ao dia real).
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
create function pg_temp.fat(p_card uuid, p_label text) returns uuid language sql as $f$
  select id from public.debt_invoices where debt_id = p_card and label = p_label $f$;
create function pg_temp.parcela(p_card uuid, p_desc text, p_seq int) returns uuid language sql as $f$
  select id from public.debt_installments where debt_id = p_card and description = p_desc and seq = p_seq $f$;
create function pg_temp.tx(p_desc text, p_n int) returns uuid language sql as $f$
  select id from public.transactions where description like p_desc || ' %' and installment_number = p_n $f$;
-- uma linha de parcelamento como texto: total|pagas|atual|valor da parcela|%|total|pago|restante|futuro|mês|próximo|atraso
create function pg_temp.r(p_desc text, p_moeda text default 'BRL') returns text language sql as $f$
  select concat_ws('|', total_count, paid_count, current_number, installment_amount::numeric(14,2), percent_paid,
                   total_amount::numeric(14,2), paid_amount::numeric(14,2), remaining_amount::numeric(14,2),
                   future_amount::numeric(14,2), month_status, next_due, overdue_count)
    from public.active_installment_plans(pg_temp.fx('h'), date '2026-11-12')
   where row_kind = 'plan' and description = p_desc and currency_code = p_moeda $f$;
create function pg_temp.fonte(p_desc text) returns text language sql as $f$
  select concat_ws('|', source_type, source_name, plan_key is not null, currency_code)
    from public.active_installment_plans(pg_temp.fx('h'), date '2026-11-12')
   where row_kind = 'plan' and description = p_desc $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.fat(uuid, text), pg_temp.parcela(uuid, text, int),
  pg_temp.tx(text, int), pg_temp.r(text, text), pg_temp.fonte(text) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000100a01', 'parc1@teste.com'),
  ('00000000-0000-0000-0000-000000100a02', 'parc2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-000000100a01');
insert into fixture select 'h', public.create_household('Casa das Parcelas');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 9000.00, '2026-01-01') returning id)
  insert into fixture select 'bank', id from i;
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco 2', 'checking', 0, '2026-01-01') returning id)
  insert into fixture select 'bank2', id from i;
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date, currency_code)
           values (pg_temp.fx('h'), 'Banco USD', 'checking', 500.00, '2026-01-01', 'USD') returning id)
  insert into fixture select 'usd', id from i;
insert into fixture select 'cat', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';
insert into fixture select 'inc', id from public.categories where household_id = pg_temp.fx('h') and name = 'Outras receitas';

-- ---------------------------------------------------------------------------
-- Cartões (hoje de referência: 12/11/2026)
-- A (fecha 5, vence 15): Geladeira 10x R$ 100 comprada em 10/06 -> faturas 07/2026 a 04/2027; 07..10 pagas, 11 fechada e
--   a pagar (vence 15/11), 12..04 ainda abertas
-- ---------------------------------------------------------------------------
insert into fixture select 'a', public.create_debt('Cartão A', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('a'), 5, 15);
select public.card_purchase(pg_temp.fx('a'), '2026-06-10', 1000.00, 10, pg_temp.fx('cat'), 'Geladeira');

-- B (fecha 5, vence 15): plano concluído, compra à vista, compra encurtada, compra excluída e parcela estornada
insert into fixture select 'b', public.create_debt('Cartão B', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('b'), 5, 15);
select public.card_purchase(pg_temp.fx('b'), '2026-06-10', 200.00, 2, pg_temp.fx('cat'), 'Concluído');
select public.card_purchase(pg_temp.fx('b'), '2026-10-10', 150.00, 1, pg_temp.fx('cat'), 'À vista');
select public.card_purchase(pg_temp.fx('b'), '2026-10-10', 200.00, 2, pg_temp.fx('cat'), 'Encurtada');
insert into fixture select 'excluida', public.card_purchase(pg_temp.fx('b'), '2026-10-10', 300.00, 3, pg_temp.fx('cat'), 'Excluída');
select public.card_purchase(pg_temp.fx('b'), '2026-10-10', 300.00, 3, pg_temp.fx('cat'), 'Estornada');

-- C (fecha 5, vence 15): Notebook 4x R$ 100 desde 10/09 -> faturas 10, 11, 12 e 01; 10 e 11 pagas
insert into fixture select 'c', public.create_debt('Cartão C', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('c'), 5, 15);
select public.card_purchase(pg_temp.fx('c'), '2026-09-10', 400.00, 4, pg_temp.fx('cat'), 'Notebook');

-- D (fecha 25, vence dia 5 do mês seguinte): a fatura que fechou em 25/10 vence em 05/11 (paga); a de 25/11 vence em 05/12
insert into fixture select 'd', public.create_debt('Cartão D', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('d'), 25, 5);
select public.card_purchase(pg_temp.fx('d'), '2026-09-30', 300.00, 3, pg_temp.fx('cat'), 'Vence no mês seguinte');

-- E: só assinatura (cada cobrança é uma parcela própria): nunca é parcelamento
insert into fixture select 'e', public.create_debt('Cartão E', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('e'), 5, 15);
select public.recurrence_create('card', 'Streaming', 39.90, 10, '2026-08-10', null, null, pg_temp.fx('e'), pg_temp.fx('cat'), null, 'month', 1);
select public.recurrence_materialize();

select public.card_bill_due('2026-11-12');

-- pagamentos (datas anteriores ao dia real)
select public.debt_pay(pg_temp.fx('a'), '2026-07-20', pg_temp.fx('bank'), 100.00, pg_temp.fat(pg_temp.fx('a'), '2026-07'));
select public.debt_pay(pg_temp.fx('a'), '2026-08-20', pg_temp.fx('bank'), 100.00, pg_temp.fat(pg_temp.fx('a'), '2026-08'));
select public.debt_pay(pg_temp.fx('a'), '2026-09-20', pg_temp.fx('bank'), 100.00, pg_temp.fat(pg_temp.fx('a'), '2026-09'));
select public.debt_pay(pg_temp.fx('a'), '2026-10-20', pg_temp.fx('bank'), 100.00, pg_temp.fat(pg_temp.fx('a'), '2026-10'));
select public.debt_pay(pg_temp.fx('b'), '2026-07-20', pg_temp.fx('bank'), 100.00, pg_temp.fat(pg_temp.fx('b'), '2026-07'));
select public.debt_pay(pg_temp.fx('b'), '2026-08-20', pg_temp.fx('bank'), 100.00, pg_temp.fat(pg_temp.fx('b'), '2026-08'));
select public.debt_pay(pg_temp.fx('c'), '2026-10-20', pg_temp.fx('bank'), 100.00, pg_temp.fat(pg_temp.fx('c'), '2026-10'));
select public.debt_pay(pg_temp.fx('c'), '2026-11-10', pg_temp.fx('bank'), 100.00, pg_temp.fat(pg_temp.fx('c'), '2026-11'));
select public.debt_pay(pg_temp.fx('d'), '2026-11-06', pg_temp.fx('bank'), 100.00, pg_temp.fat(pg_temp.fx('d'), '2026-10'));

-- Notebook: estorno parcial de uma parcela futura (40 de 100: sobra 60) e crédito avulso que zera a fatura de dezembro,
-- ainda ABERTA: a fatura de total zero só conta como paga depois de fechar
select public.debt_refund(pg_temp.parcela(pg_temp.fx('c'), 'Notebook', 4), '2026-11-10', 40.00);
select public.card_credit_income(pg_temp.fx('c'), '2026-11-10', 100.00, pg_temp.fx('inc'), 'Crédito na fatura aberta');
-- Encurtada: a parcela 2 (futura) é estornada inteira e a compra fica com 1 parcela viva
select public.debt_refund(pg_temp.parcela(pg_temp.fx('b'), 'Encurtada', 2), '2026-11-10', 100.00);
-- Excluída: todas as parcelas canceladas
-- card_purchase_delete data o cancelamento em greatest(private.today_sp(), referência + 1), isto é, no dia REAL. O teste fixa o
-- "hoje" em 12/11/2026, então a partir de 13/11 esses eventos (imutáveis) ficavam DEPOIS do corte e a compra excluída voltava a
-- aparecer: as asserções 9 e 22 falhavam em qualquer dia depois de 12/11, inclusive no main. Para o resultado não depender do dia
-- em que o teste roda, o "hoje" do banco é fixado em 12/11 só durante a exclusão (como o 07_liabilities faz) e o original volta
-- logo depois. Tudo dentro da transação do teste, que termina em rollback.
reset role;
create temp table hoje_original (def text);
insert into hoje_original select pg_get_functiondef('private.today_sp()'::regprocedure);
create or replace function private.today_sp() returns date language sql stable set search_path = '' as $f$ select date '2026-11-12' $f$;
select pg_temp.login('00000000-0000-0000-0000-000000100a01');
select public.card_purchase_delete(pg_temp.fx('b'), pg_temp.fx('excluida')::text, 'exclusão de teste');
reset role;
do $f$ begin execute (select def from hoje_original); end $f$;
select pg_temp.login('00000000-0000-0000-0000-000000100a01');
-- Estornada: a parcela 1 já cobrada é estornada inteira (crédito) e sai da conta de "n de N"
select public.debt_refund(pg_temp.parcela(pg_temp.fx('b'), 'Estornada', 1), '2026-11-10', 100.00, pg_temp.fat(pg_temp.fx('b'), '2026-11'));

-- ---------------------------------------------------------------------------
-- Conta
-- ---------------------------------------------------------------------------
-- Sofá 5x R$ 100 a partir de 12/09: 1 e 2 pagas, a 3 vence hoje, 4 e 5 futuras
select public.transaction_installments_create('expense', 'Sofá', 500, 5, 'month', 1, '2026-09-12', pg_temp.fx('bank'), null, pg_temp.fx('cat'), true);
select public.transactions_bulk_mark_paid(array[pg_temp.tx('Sofá', 2)], '2026-10-12');
-- Curso 3x R$ 100 a partir de 20/09, nada pago: 2 em atraso e a de 20/11 ainda a vencer
select public.transaction_installments_create('expense', 'Curso', 300, 3, 'month', 1, '2026-09-20', pg_temp.fx('bank'), null, pg_temp.fx('cat'), false);
-- Terço 3x R$ 100 a partir de 25/09: 2 pagas de 3 (66,67%: o inteiro é truncado, nunca 100% antes da hora)
select public.transaction_installments_create('expense', 'Terço', 300, 3, 'month', 1, '2026-09-25', pg_temp.fx('bank'), null, pg_temp.fx('cat'), true);
select public.transactions_bulk_mark_paid(array[pg_temp.tx('Terço', 2)], '2026-10-25');
-- Pago no mês: a parcela que vence em novembro já está paga
select public.transaction_installments_create('expense', 'Pago no mês', 300, 3, 'month', 1, '2026-11-05', pg_temp.fx('bank'), null, pg_temp.fx('cat'), true);
-- Lixeira: uma parcela na lixeira reduz o N; com duas, sobra uma só e deixa de ser parcelamento
select public.transaction_installments_create('expense', 'Lixeira', 300, 3, 'month', 1, '2026-11-20', pg_temp.fx('bank'), null, pg_temp.fx('cat'), false);
select public.transactions_bulk_trash(array[pg_temp.tx('Lixeira', 3)]);
select public.transaction_installments_create('expense', 'Só uma', 300, 3, 'month', 1, '2026-11-20', pg_temp.fx('bank'), null, pg_temp.fx('cat'), false);
select public.transactions_bulk_trash(array[pg_temp.tx('Só uma', 2), pg_temp.tx('Só uma', 3)]);
-- Concluído em conta: tudo pago
select public.transaction_installments_create('expense', 'Concluído em conta', 400, 2, 'month', 1, '2026-09-12', pg_temp.fx('bank'), null, pg_temp.fx('cat'), true);
select public.transactions_bulk_mark_paid(array[pg_temp.tx('Concluído em conta', 2)], '2026-10-12');
-- Receita e transferência parceladas não são dívida
select public.transaction_installments_create('income', 'Venda parcelada', 300, 3, 'month', 1, '2026-11-20', pg_temp.fx('bank'), null, pg_temp.fx('inc'), false);
select public.transaction_installments_create('transfer', 'Repasse parcelado', 300, 3, 'month', 1, '2026-11-20', pg_temp.fx('bank'), pg_temp.fx('bank2'), null, false);
-- Outra moeda: o total não se mistura com o de reais
select public.transaction_installments_create('expense', 'Curso em dólar', 200, 2, 'month', 1, '2026-11-20', pg_temp.fx('usd'), null, pg_temp.fx('cat'), false);

-- ---------------------------------------------------------------------------
-- Valores: total|pagas|atual|parcela|%|total|pago|restante|futuro|mês|próximo vencimento|atraso
-- ---------------------------------------------------------------------------
select is(pg_temp.r('Geladeira'), '10|4|5|100.00|40|1000.00|400.00|600.00|500.00|pending|2026-11-15|0',
  'cartão: 5 de 10, faturas de jul a out pagas, a de nov fechada e a pagar (pendente), 5 faturas futuras');
select is(pg_temp.fonte('Geladeira'), 'card|Cartão A|t|BRL', 'cartão: origem é o cartão, em reais');
select is(pg_temp.r('Notebook'), '4|2|2|100.00|55|360.00|200.00|160.00|160.00|paid|2026-12-15|0',
  'cartão: a parcela do mês (fatura de nov, vence 15/11) está paga; estorno parcial reduz o valor; fatura aberta zerada por crédito não conta como paga');
select is(pg_temp.r('Vence no mês seguinte'), '3|1|1|100.00|33|300.00|100.00|200.00|200.00|paid|2026-12-05|0',
  'cartão: o mês é o do VENCIMENTO da fatura (fechou 25/10, venceu 05/11 e está paga); a de 25/11 só vence em dezembro');
select is(pg_temp.r('Estornada'), '2|0|1|100.00|0|200.00|0.00|200.00|200.00|none|2026-12-15|0',
  'cartão: a parcela estornada inteira sai do "n de N" (1 de 2) e do valor; nenhuma parcela vence em novembro');
select is(pg_temp.r('Concluído'), null, 'cartão: plano com todas as faturas pagas não aparece (concluído)');
select is(pg_temp.r('À vista'), null, 'cartão: compra à vista (uma parcela) não é parcelamento');
select is(pg_temp.r('Encurtada'), null, 'cartão: compra encurtada até sobrar uma parcela viva não é parcelamento');
select is(pg_temp.r('Excluída'), null, 'cartão: compra excluída (todas as parcelas canceladas) não aparece');
select is((select count(*) from public.active_installment_plans(pg_temp.fx('h'), date '2026-11-12') where description = 'Streaming'), 0::bigint,
  'cartão: assinatura (parcelas avulsas de 1 só) não é parcelamento');

select is(pg_temp.r('Sofá'), '5|2|3|100.00|40|500.00|200.00|300.00|200.00|pending|2026-11-12|0',
  'conta: 3 de 5; a parcela de hoje está pendente; 2 futuras');
select is(pg_temp.fonte('Sofá'), 'account|Banco|t|BRL', 'conta: origem é a conta');
select is(pg_temp.r('Curso'), '3|0|3|100.00|0|300.00|0.00|300.00|100.00|pending|2026-09-20|2',
  'conta: duas parcelas em atraso; a de 20/11 ainda a vencer');
select is(pg_temp.r('Terço'), '3|2|3|100.00|66|300.00|200.00|100.00|100.00|pending|2026-11-25|0',
  'conta: 2 pagas de 3 = 66% (inteiro truncado, não 67%)');
select is(pg_temp.r('Pago no mês'), '3|1|1|100.00|33|300.00|100.00|200.00|200.00|paid|2026-12-05|0',
  'conta: a parcela que vence em novembro está paga');
select is(pg_temp.r('Lixeira'), '2|0|1|100.00|0|200.00|0.00|200.00|200.00|pending|2026-11-20|0',
  'conta: parcela na lixeira não conta (1 de 2)');
select is(pg_temp.r('Só uma'), null, 'conta: com uma só parcela viva deixa de ser parcelamento');
select is(pg_temp.r('Concluído em conta'), null, 'conta: tudo pago, não aparece');
select is(pg_temp.r('Venda parcelada'), null, 'conta: receita parcelada não é dívida');
select is(pg_temp.r('Repasse parcelado'), null, 'conta: transferência parcelada não é dívida');
select is(pg_temp.r('Curso em dólar', 'USD'), '2|0|1|100.00|0|200.00|0.00|200.00|200.00|pending|2026-11-20|0',
  'conta em dólar: a linha traz a moeda dela, sem conversão');

-- ---------------------------------------------------------------------------
-- Totais (vêm do banco, um por moeda) e coerência com as linhas
-- ---------------------------------------------------------------------------
select is((select concat_ws('|', plan_count, remaining_amount::numeric(14,2), future_amount::numeric(14,2),
                             total_amount::numeric(14,2), paid_amount::numeric(14,2))
             from public.active_installment_plans(pg_temp.fx('h'), date '2026-11-12') where row_kind = 'total' and currency_code = 'BRL'),
  '9|2260.00|1860.00|3460.00|1200.00', 'total em reais: 9 parcelamentos, restante 2.260,00, futuro 1.860,00');
select is((select concat_ws('|', plan_count, remaining_amount::numeric(14,2), future_amount::numeric(14,2))
             from public.active_installment_plans(pg_temp.fx('h'), date '2026-11-12') where row_kind = 'total' and currency_code = 'USD'),
  '1|200.00|200.00', 'total em dólar à parte');
select is((select count(*) from public.active_installment_plans(pg_temp.fx('h'), date '2026-11-12') where row_kind = 'total'), 2::bigint,
  'um total por moeda, nada de total misturado');
select is((select sum(remaining_amount) from public.active_installment_plans(pg_temp.fx('h'), date '2026-11-12')
            where row_kind = 'plan' and currency_code = 'BRL'),
  (select remaining_amount from public.active_installment_plans(pg_temp.fx('h'), date '2026-11-12') where row_kind = 'total' and currency_code = 'BRL'),
  'o total é a soma do restante das linhas');
select ok(not exists (select 1 from public.active_installment_plans(pg_temp.fx('h'), date '2026-11-12')
                       where row_kind = 'plan' and (future_amount > remaining_amount or percent_paid >= 100 or percent_paid < 0
                                                    or paid_amount + remaining_amount <> total_amount or current_number > total_count)),
  'invariantes: futuro <= restante, 0 <= % < 100, pago + restante = total, atual <= N');
select is((select array_agg(row_kind order by row_kind) from (
            select distinct row_kind from public.active_installment_plans(pg_temp.fx('h'), date '2026-11-12')) x), array['plan', 'total'],
  'só existem linhas "plan" e "total"');
select lives_ok($$select * from public.active_installment_plans(pg_temp.fx('h'))$$, 'sem data de corte usa hoje (São Paulo)');
select throws_ok($$select * from public.active_installment_plans(null)$$, '22023', null, 'família obrigatória');

-- ---------------------------------------------------------------------------
-- Outra família: não vê, não é vista
-- ---------------------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-000000100a02');
insert into fixture select 'h2', public.create_household('Casa Alheia');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h2'), 'Banco alheio', 'checking', 100.00, '2026-01-01') returning id)
  insert into fixture select 'bank_h2', id from i;
insert into fixture select 'cat_h2', id from public.categories where household_id = pg_temp.fx('h2') and name = 'Compras pessoais';
select public.transaction_installments_create('expense', 'Plano alheio', 300, 3, 'month', 1, '2026-11-20', pg_temp.fx('bank_h2'), null, pg_temp.fx('cat_h2'), false);
select is((select count(*) from public.active_installment_plans(pg_temp.fx('h2'), date '2026-11-12') where row_kind = 'plan'), 1::bigint,
  'a outra família vê só o parcelamento dela');
select is((select count(*) from public.active_installment_plans(pg_temp.fx('h'), date '2026-11-12')), 0::bigint,
  'quem não é da família recebe vazio (nem total)');
select pg_temp.login('00000000-0000-0000-0000-000000100a01');
select is((select count(*) from public.active_installment_plans(pg_temp.fx('h2'), date '2026-11-12')), 0::bigint,
  'a primeira família também não enxerga a outra');
select is((select count(*) from public.active_installment_plans(pg_temp.fx('h'), date '2026-11-12') where description = 'Plano alheio'), 0::bigint,
  'o plano da outra família nunca aparece nas linhas');

-- ---------------------------------------------------------------------------
-- Natureza da função: leitura, invoker, sem acesso anônimo
-- ---------------------------------------------------------------------------
reset role;
select ok(not (select prosecdef from pg_proc where oid = 'public.active_installment_plans(uuid,date)'::regprocedure), 'SECURITY INVOKER');
select is((select provolatile from pg_proc where oid = 'public.active_installment_plans(uuid,date)'::regprocedure), 's', 'STABLE (leitura, não escreve)');
select ok(not has_function_privilege('anon', 'public.active_installment_plans(uuid,date)', 'EXECUTE'), 'anon não executa');
select ok(has_function_privilege('authenticated', 'public.active_installment_plans(uuid,date)', 'EXECUTE'), 'authenticated executa');
select ok(not exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                       where p.oid = 'public.active_installment_plans(uuid,date)'::regprocedure and a.grantee = 0), 'PUBLIC não executa');

select * from finish();
rollback;
