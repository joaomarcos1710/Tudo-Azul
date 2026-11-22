-- 142_debt_linked_card: migration 148. Empréstimo cobrado no cartão (vínculo só de exibição).
--   * debt_link_card: só empréstimo/financiamento; só cartão ativo da mesma família; p_card nulo desvincula.
--   * card_linked_invoices: cada parcela do empréstimo vinculado na fatura que VENCE no mesmo mês dela (inclusive cartão que
--     fecha num mês e vence no outro), com o total da fatura + parcelas.
--   * card_linked_summary: dívida do cartão + saldo dos empréstimos vinculados; limite disponível descontando esse saldo.
--   * Nada do que já existia muda: card_months, debt_balances e net_worth são os mesmos com e sem o vínculo.
-- As funções novas vão por SQL dinâmico: sem a migration as asserções falham sem abortar o arquivo.
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
-- 'ok' ou 'ERRO <sqlstate>'
create function pg_temp.vincular(p_debt uuid, p_card uuid) returns text language plpgsql as $f$
begin
  execute 'select public.debt_link_card($1, $2)' using p_debt, p_card;
  return 'ok';
exception when others then return 'ERRO ' || sqlstate;
end $f$;
-- "label|vencimento|fatura|n/N|parcela|situação|soma das parcelas|total com parcelas" na ordem do banco
create function pg_temp.faturas(p_card uuid) returns text[] language plpgsql as $f$
declare r text[];
begin
  execute 'select coalesce(array_agg(label || ''|'' || due_date || ''|'' || invoice_total::numeric(14,2) || ''|''
                 || installment_number || ''/'' || installment_count || ''|'' || amount::numeric(14,2) || ''|'' || status
                 || ''|'' || linked_total::numeric(14,2) || ''|'' || total_with_linked::numeric(14,2) order by ord), ''{}'')
             from (select f.*, row_number() over () as ord from public.card_linked_invoices($1) f) q'
    into r using p_card;
  return r;
exception when others then return array['ERRO ' || sqlstate];
end $f$;
-- "vinculado|dívida com vinculado|disponível com vinculado" do cartão; null se não houver linha
create function pg_temp.resumo(p_h uuid, p_card uuid, p_data date) returns text language plpgsql as $f$
declare r text;
begin
  execute 'select linked_debt::numeric(14,2) || ''|'' || debt_with_linked::numeric(14,2) || ''|''
                 || coalesce(available_with_linked::numeric(14,2)::text, ''sem limite'')
             from public.card_linked_summary($1, $2) where debt_id = $3'
    into r using p_h, p_data, p_card;
  return r;
exception when others then return 'ERRO ' || sqlstate;
end $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.vincular(uuid, uuid), pg_temp.faturas(uuid),
  pg_temp.resumo(uuid, uuid, date) to public;

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000142a1', 'v1@teste.com', now()),
  ('00000000-0000-0000-0000-0000000142a2', 'v2@teste.com', now());

-- Família 2 (só para o cartão de outra família)
select pg_temp.login('00000000-0000-0000-0000-0000000142a2');
insert into fixture select 'h2', public.create_household('Casa Dois');
insert into fixture select 'card2', public.create_debt('Cartão Alheio', 'card', '2026-01-01', 0);

select pg_temp.login('00000000-0000-0000-0000-0000000142a1');
insert into fixture select 'h', public.create_household('Casa do Vínculo');
insert into fixture select 'cat', id from public.categories where household_id = pg_temp.fx('h') and name = 'Mercado';
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 5000.00, '2026-01-01') returning id)
  insert into fixture select 'brl', id from i;

-- Cartão A: fecha 18, vence 28 (mesmo mês). Outubro 300,00 (fecha 18/10), novembro 500,00 (fecha 18/11). Limite 5.000,00.
insert into fixture select 'card', public.create_debt('Cartão A', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('card'), 18, 28);
select public.card_purchase(pg_temp.fx('card'), '2026-10-05', 300.00, 1, pg_temp.fx('cat'), 'Outubro');
select public.card_purchase(pg_temp.fx('card'), '2026-11-05', 500.00, 1, pg_temp.fx('cat'), 'Novembro');
select public.set_card_limit(pg_temp.fx('card'), 5000.00);
-- Cartão B: fecha 25, vence 5 do mês SEGUINTE. Compra de 10/11 fecha 25/11 e vence 05/12: label "2026-11".
insert into fixture select 'cardb', public.create_debt('Cartão B', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('cardb'), 25, 5);
select public.card_purchase(pg_temp.fx('cardb'), '2026-11-10', 200.00, 1, pg_temp.fx('cat'), 'Compra B');
select public.card_bill_due('2026-11-20');

-- Parcelamento (empréstimo): 1.000,00; contrato 11x, restam 10 de 120,00, todo dia 28 a partir de 28/11/2026.
insert into fixture select 'parc', public.create_debt('Parcelamento', 'loan', '2026-10-01', 1000);
select public.debt_contract_set(pg_temp.fx('parc'), 'Banco', null, 11, 10, 120, 28, 'account_debit', pg_temp.fx('brl'), '2026-11-28');
-- Outro empréstimo, não vinculado: 500,00
insert into fixture select 'outro', public.create_debt('Outro', 'loan', '2026-10-01', 500);
-- Empréstimo que vence dia 5 (para o cartão B): 2 parcelas de 50,00 a partir de 05/12/2026
insert into fixture select 'emp5', public.create_debt('Empréstimo dia 5', 'loan', '2026-10-01', 100);
select public.debt_contract_set(pg_temp.fx('emp5'), 'Banco', null, 2, 2, 50, 5, 'account_debit', pg_temp.fx('brl'), '2026-12-05');

-- Antes do vínculo: o que já existe, para comparar depois
create temp table antes as
  select (select debt from public.net_worth(pg_temp.fx('h'), '2026-11-20')) as divida_total,
         (select total from public.card_months(pg_temp.fx('card')) where label = '2026-11') as fatura_nov;
grant select on antes to public;

-- ---------------------------------------------------------------------------
-- 1. debt_link_card: validações
-- ---------------------------------------------------------------------------
select is(pg_temp.vincular(pg_temp.fx('card'), pg_temp.fx('cardb')), 'ERRO 22023', 'cartão não se vincula a cartão');
select is(pg_temp.vincular(pg_temp.fx('parc'), pg_temp.fx('outro')), 'ERRO 23514', 'empréstimo só se vincula a cartão');
select is(pg_temp.vincular(pg_temp.fx('parc'), pg_temp.fx('card2')), 'ERRO 23514', 'cartão de outra família é recusado');
select is(pg_temp.vincular(pg_temp.fx('parc'), pg_temp.fx('card')), 'ok', 'empréstimo vincula ao cartão da família');
select is(pg_temp.vincular(pg_temp.fx('emp5'), pg_temp.fx('cardb')), 'ok', 'empréstimo do dia 5 vincula ao cartão B');
select is((select linked_card_id from public.debts where id = pg_temp.fx('parc')), pg_temp.fx('card'), 'vínculo gravado');
select throws_ok($$ update public.debts set linked_card_id = null where id = pg_temp.fx('parc') $$, '42501', null,
  'linked_card_id só muda pela função (sem UPDATE direto)');

-- ---------------------------------------------------------------------------
-- 2. card_linked_invoices: parcela na fatura que vence no mesmo mês
-- ---------------------------------------------------------------------------
select is((pg_temp.faturas(pg_temp.fx('card')))[1:3], array[
  '2026-11|2026-11-28|500.00|2/11|120.00|planned|120.00|620.00',
  '2026-12|2026-12-28|0.00|3/11|120.00|planned|120.00|120.00',
  '2027-01|2027-01-28|0.00|4/11|120.00|planned|120.00|120.00'],
  'novembro: fatura 500 + parcela 120 = 620 (o que o banco cobra); meses sem compra: só a parcela');
select is(array_length(pg_temp.faturas(pg_temp.fx('card')), 1), 10, 'as 10 parcelas restantes aparecem');
select is(pg_temp.faturas(pg_temp.fx('cardb')), array[
  '2026-11|2026-12-05|200.00|1/2|50.00|planned|50.00|250.00',
  '2026-12|2027-01-05|0.00|2/2|50.00|planned|50.00|50.00'],
  'cartão que vence no mês seguinte: a parcela de 05/12 entra na fatura "2026-11" (que vence 05/12)');
select is(pg_temp.faturas(pg_temp.fx('cardb')) && pg_temp.faturas(pg_temp.fx('card')), false,
  'cada cartão só mostra o empréstimo vinculado a ele');

-- parcela paga continua na fatura, com a situação
select public.debt_schedule_record_payment(
  (select id from public.debt_payment_schedule where debt_id = pg_temp.fx('parc') and installment_number = 2),
  '2026-11-20', pg_temp.fx('brl'), 100, 20, 0, pg_temp.fx('cat'), false);
select is((pg_temp.faturas(pg_temp.fx('card')))[1], '2026-11|2026-11-28|500.00|2/11|120.00|paid|120.00|620.00',
  'parcela paga aparece como paga');

-- ---------------------------------------------------------------------------
-- 3. card_linked_summary: dívida e limite com o empréstimo vinculado
-- ---------------------------------------------------------------------------
-- Em 20/11: cartão deve 800,00 (out 300 + nov 500, fechadas); parcelamento deve 900,00 (1.000 − 100 de principal pago).
-- Limite: comprometido 800 → disponível 4.200; com o parcelamento, 4.200 − 900 = 3.300.
select is(pg_temp.resumo(pg_temp.fx('h'), pg_temp.fx('card'), '2026-11-20'), '900.00|1700.00|3300.00',
  'dívida do cartão + parcelamento; limite descontando o parcelamento');
-- cartão B em 20/11: a fatura de novembro só fecha em 25/11 (ainda aberta: dívida 0); só o empréstimo vinculado (100)
select is(pg_temp.resumo(pg_temp.fx('h'), pg_temp.fx('cardb'), '2026-11-20'), '100.00|100.00|sem limite',
  'cartão sem limite informado: disponível fica nulo; fatura aberta não é dívida');
select is((select count(*)::int from public.card_linked_summary(pg_temp.fx('h'), '2026-11-20')), 2,
  'só cartões com empréstimo vinculado (o "Outro" não entra em lugar nenhum)');

-- ---------------------------------------------------------------------------
-- 4. Nada do que já existia muda com o vínculo
-- ---------------------------------------------------------------------------
select is((select debt from public.net_worth(pg_temp.fx('h'), '2026-11-20')), (select divida_total from antes) - 100,
  'dívida total igual (só menos os 100 de principal pagos): o vínculo não soma o empréstimo duas vezes');
select is((select total from public.card_months(pg_temp.fx('card')) where label = '2026-11'), (select fatura_nov from antes),
  'card_months (total da fatura do app) não inclui a parcela vinculada');

-- ---------------------------------------------------------------------------
-- 5. Outra família não vê; desvincular limpa
-- ---------------------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000142a2');
select is(pg_temp.faturas(pg_temp.fx('card')), '{}'::text[], 'outra família não vê as parcelas vinculadas');
select is(pg_temp.resumo(pg_temp.fx('h'), pg_temp.fx('card'), '2026-11-20'), null, 'outra família não vê o resumo');
select is(pg_temp.vincular(pg_temp.fx('parc'), null), 'ERRO 42501', 'outra família não desvincula');

select pg_temp.login('00000000-0000-0000-0000-0000000142a1');
select is(pg_temp.vincular(pg_temp.fx('parc'), null), 'ok', 'desvincular (cartão nulo)');
select is(pg_temp.faturas(pg_temp.fx('card')), '{}'::text[], 'sem vínculo, a fatura não mostra parcela');
select is(pg_temp.resumo(pg_temp.fx('h'), pg_temp.fx('card'), '2026-11-20'), null, 'sem vínculo, o cartão sai do resumo');

select * from finish();
rollback;
