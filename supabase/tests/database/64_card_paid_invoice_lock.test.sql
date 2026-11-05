-- 64_card_paid_invoice_lock: migration 064. Fatura de cartão FECHADA e PAGA (pago >= total, regra de card_months e da
-- tela) fica travada: não reabre, não anula cobrança/crédito/pagamento dela, não edita/exclui/estorna compra que está
-- nela — nem por efeito indireto (pagamento adiantado que a quitou). Fatura fechada ainda não paga e fatura aberta
-- continuam corrigíveis. Exceção: o último pagamento do cartão, lançado há menos de 24 h, pode ser anulado, e só a
-- fatura dele fica liberada. Datas de 2026 já fechadas (hoje real >= 05/11/2026) e card_bill_due com limite.
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
create function pg_temp.msg_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate || ' ' || sqlerrm; end $f$;
-- id da fatura (rótulo AAAA-MM) e situação: total|pago
create function pg_temp.fat(p_card uuid, p_label text) returns uuid language sql as $f$
  select id from public.debt_invoices where debt_id = p_card and label = p_label $f$;
create function pg_temp.sit(p_card uuid, p_label text) returns text language sql as $f$
  select total::numeric(14,2) || '|' || paid::numeric(14,2) from public.card_months(p_card) where label = p_label $f$;
create function pg_temp.parcela(p_card uuid, p_desc text, p_seq int default 1) returns uuid language sql as $f$
  select id from public.debt_installments where debt_id = p_card and description = p_desc and seq = p_seq $f$;
create function pg_temp.pagamento(p_card uuid, p_valor numeric) returns uuid language sql as $f$
  select id from public.debt_events where debt_id = p_card and kind = 'payment' and amount = p_valor and voided_at is null $f$;
create function pg_temp.banco() returns numeric language sql as $f$
  select balance from public.account_balances(pg_temp.fx('h'), '2099-12-31') where name = 'Banco' $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.sqlstate_of(text), pg_temp.msg_of(text),
  pg_temp.fat(uuid, text), pg_temp.sit(uuid, text), pg_temp.parcela(uuid, text, int), pg_temp.pagamento(uuid, numeric),
  pg_temp.banco() to public;
-- "envelhece" um pagamento (simula que foi lançado há mais tempo): só o superusuário, sem gatilhos
create function pg_temp.envelhecer(p_id uuid, p_idade interval) returns void language plpgsql as $f$
begin
  set local session_replication_role = replica;
  update public.debt_events set created_at = created_at - p_idade where id = p_id;
  set local session_replication_role = origin;
end $f$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000064a1', 'trava1@teste.com'),
  ('00000000-0000-0000-0000-0000000064a2', 'trava2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000064a1');
insert into fixture select 'h', public.create_household('Casa da Trava');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 5000.00, '2026-01-01') returning id)
  insert into fixture select 'bank', id from i;
insert into fixture select 'cat', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';
insert into fixture select 'inc', id from public.categories where household_id = pg_temp.fx('h') and name = 'Outras receitas';

-- ---------------------------------------------------------------------------
-- Cartão A (fecha 17, vence 25): março PAGA, abril fechada e paga em parte, maio fechada sem pagamento
--   março: Mercado 100 + TV 1/3 (100) − cashback 20 = 180, paga 180
--   abril: TV 2/3 (100) + crédito 10 → 90, paga 50;  maio: TV 3/3 (100)
-- ---------------------------------------------------------------------------
insert into fixture select 'a', public.create_debt('Cartão A', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('a'), 17, 25);
insert into fixture select 'mercado', public.card_purchase(pg_temp.fx('a'), '2026-03-01', 100.00, 1, pg_temp.fx('cat'), 'Mercado');
insert into fixture select 'tv', public.card_purchase(pg_temp.fx('a'), '2026-03-02', 300.00, 3, pg_temp.fx('cat'), 'TV');
insert into fixture select 'cash_mar', public.card_credit_income(pg_temp.fx('a'), '2026-03-05', 20.00, pg_temp.fx('inc'), 'Cashback');
insert into fixture select 'cred_abr', public.card_credit_income(pg_temp.fx('a'), '2026-04-05', 10.00, pg_temp.fx('inc'), 'Estorno de IOF');
select public.card_bill_due('2026-05-31');
select public.debt_pay(pg_temp.fx('a'), '2026-03-25', pg_temp.fx('bank'), 180.00, pg_temp.fat(pg_temp.fx('a'), '2026-03'));
select public.debt_pay(pg_temp.fx('a'), '2026-04-25', pg_temp.fx('bank'), 50.00, pg_temp.fat(pg_temp.fx('a'), '2026-04'));
reset role;
-- o pagamento de março foi lançado há 2 dias e não é o último: fora da exceção
select pg_temp.envelhecer(pg_temp.pagamento(pg_temp.fx('a'), 180.00), interval '2 days');
select pg_temp.login('00000000-0000-0000-0000-0000000064a1');

select is(pg_temp.sit(pg_temp.fx('a'), '2026-03'), '180.00|180.00', 'T0 março fechada e paga (180 de 180)');
select is(pg_temp.sit(pg_temp.fx('a'), '2026-04'), '90.00|50.00', 'T0 abril fechada, paga em parte (50 de 90)');
select is(pg_temp.sit(pg_temp.fx('a'), '2026-05'), '100.00|0.00', 'T0 maio fechada, sem pagamento');
select is(pg_temp.banco(), 4770.00, 'T0 conta: 5000 − 180 − 50');

-- ---- fatura PAGA: tudo recusado, com mensagem clara ----
select is(pg_temp.msg_of($$select public.card_invoice_reopen(pg_temp.fx('a'), '2026-03', 'quero mexer')$$),
          '55000 a fatura de 03/2026 já está paga e travada: não pode ser alterada', 'T1 reabrir fatura paga: recusado (mensagem clara)');
select is(pg_temp.msg_of($$select public.card_installment_edit(pg_temp.parcela(pg_temp.fx('a'), 'Mercado'), 99.00)$$),
          '55000 a fatura de 03/2026 já está paga e travada: não pode ser alterada',
          'T2 editar parcela de fatura paga: recusado com a mensagem da trava (não mais "reabra a fatura")');
select is(pg_temp.sqlstate_of($$select public.card_purchase_delete(pg_temp.fx('a'), pg_temp.fx('mercado')::text, 'lançada errada')$$),
          '55000', 'T3 excluir compra cobrada em fatura paga: recusado');
select is(pg_temp.sqlstate_of($$select public.card_purchase_delete(pg_temp.fx('a'), pg_temp.fx('tv')::text, 'lançada errada')$$),
          '55000', 'T4 excluir compra parcelada com uma parcela em fatura paga: recusado (as outras parcelas se estornam)');
select is(pg_temp.sqlstate_of($$select public.debt_refund(pg_temp.parcela(pg_temp.fx('a'), 'Mercado'), '2026-04-01', 10.00, pg_temp.fat(pg_temp.fx('a'), '2026-03'))$$),
          '55000', 'T5 estornar compra de fatura paga: recusado');
select is(pg_temp.sqlstate_of($$select public.debt_refund(pg_temp.parcela(pg_temp.fx('a'), 'Mercado'), '2026-04-01', 10.00, pg_temp.fat(pg_temp.fx('a'), '2026-04'))$$),
          '55000', 'T5 nem apontando o estorno para outra fatura: a compra continua na fatura paga');
select is(pg_temp.sqlstate_of($$select public.debt_void(pg_temp.fx('cash_mar'), 'engano')$$),
          '55000', 'T6 anular crédito avulso de fatura paga: recusado');
select is(pg_temp.sqlstate_of($$select public.debt_void(pg_temp.pagamento(pg_temp.fx('a'), 180.00), 'engano')$$),
          '55000', 'T7 anular pagamento de fatura paga (lançado há 2 dias): recusado');
select is(pg_temp.sit(pg_temp.fx('a'), '2026-03'), '180.00|180.00', 'T8 nada mudou em março');
select is(pg_temp.banco(), 4770.00, 'T8 nem na conta');
select is((select count(*)::int from public.debt_events where debt_id = pg_temp.fx('a') and voided_at is not null), 0,
          'T8 nenhum evento anulado');

-- ---- fatura FECHADA e NÃO PAGA: continua corrigível ----
select lives_ok($$select public.card_credit_income(pg_temp.fx('a'), '2026-05-05', 5.00, pg_temp.fx('inc'), 'Ajuste')$$,
                'P1 crédito avulso em fatura fechada não paga (maio): permitido');
select lives_ok($$select public.debt_void(pg_temp.fx('cred_abr'), 'lançado errado')$$,
                'P2 anular crédito de fatura fechada não paga (abril): permitido');
select lives_ok($$select public.debt_refund(pg_temp.parcela(pg_temp.fx('a'), 'TV', 3), '2026-06-01', 30.00, pg_temp.fat(pg_temp.fx('a'), '2026-05'))$$,
                'P3 estornar parcela de fatura fechada não paga (maio): permitido');
select is(public.card_invoice_reopen(pg_temp.fx('a'), '2026-04', 'corrigir valor'), 1,
          'P4 reabrir fatura fechada paga em parte (abril): permitido, desfaz 1 pagamento');
select lives_ok($$select public.card_installment_edit(pg_temp.parcela(pg_temp.fx('a'), 'TV', 2), 101.00, 'banco arredondou')$$,
                'P5 editar parcela da fatura reaberta: permitido');
select lives_ok($$select public.debt_pay(pg_temp.fx('a'), '2026-04-25', pg_temp.fx('bank'), 101.00, pg_temp.fat(pg_temp.fx('a'), '2026-04'))$$,
                'P6 pagar fatura fechada: permitido (e agora abril também trava)');
select is(pg_temp.sit(pg_temp.fx('a'), '2026-04'), '101.00|101.00', 'P6 abril paga');
select is(pg_temp.sqlstate_of($$select public.card_invoice_reopen(pg_temp.fx('a'), '2026-04', 'de novo')$$), '55000',
          'P7 e depois de paga, abril não reabre mais (o pagamento de 101 é o último e recente: só ele pode ser anulado)');

-- ---------------------------------------------------------------------------
-- Exceção: o último pagamento, lançado há menos de 24 h
-- ---------------------------------------------------------------------------
-- cartão B: março 100, pago em dois (60 e 40), o de 60 lançado 1 h antes
insert into fixture select 'b', public.create_debt('Cartão B', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('b'), 17, 25);
select public.card_purchase(pg_temp.fx('b'), '2026-03-01', 100.00, 1, pg_temp.fx('cat'), 'Mercado');
select public.card_bill_due('2026-03-31');
select public.debt_pay(pg_temp.fx('b'), '2026-03-24', pg_temp.fx('bank'), 60.00, pg_temp.fat(pg_temp.fx('b'), '2026-03'));
select public.debt_pay(pg_temp.fx('b'), '2026-03-25', pg_temp.fx('bank'), 40.00, pg_temp.fat(pg_temp.fx('b'), '2026-03'));
reset role;
select pg_temp.envelhecer(pg_temp.pagamento(pg_temp.fx('b'), 60.00), interval '1 hour');
select pg_temp.login('00000000-0000-0000-0000-0000000064a1');
select is(pg_temp.sit(pg_temp.fx('b'), '2026-03'), '100.00|100.00', 'E0 março do cartão B paga (60 + 40)');
select is(pg_temp.sqlstate_of($$select public.debt_void(pg_temp.pagamento(pg_temp.fx('b'), 60.00), 'engano')$$), '55000',
          'E1 o pagamento que não é o último: recusado, mesmo recente');
select is(public.debt_void(pg_temp.pagamento(pg_temp.fx('b'), 40.00), 'valor errado'), 1,
          'E2 o último pagamento, lançado agora: pode ser anulado');
select is(pg_temp.sit(pg_temp.fx('b'), '2026-03'), '100.00|60.00', 'E2 março volta a faltar 40');
select is(pg_temp.sqlstate_of($$select public.card_invoice_reopen(pg_temp.fx('b'), '2026-03', 'agora pode')$$), null,
          'E3 fatura não mais paga volta a ser corrigível (reabrir)');

-- cartão C: a exceção libera só a fatura do pagamento. Março 100 pago com 150 (sobra 50 de adiantamento), que quita
-- abril (50). Anular os 150 tiraria o pagamento de abril, que também está travada: recusado.
insert into fixture select 'c', public.create_debt('Cartão C', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('c'), 17, 25);
select public.card_purchase(pg_temp.fx('c'), '2026-03-01', 100.00, 1, pg_temp.fx('cat'), 'Mercado');
select public.card_purchase(pg_temp.fx('c'), '2026-04-01', 50.00, 1, pg_temp.fx('cat'), 'Farmácia');
select public.card_bill_due('2026-04-30');
select public.debt_pay(pg_temp.fx('c'), '2026-03-25', pg_temp.fx('bank'), 150.00, pg_temp.fat(pg_temp.fx('c'), '2026-03'));
select is(pg_temp.sit(pg_temp.fx('c'), '2026-04'), '50.00|50.00', 'E4 abril quitada pelo adiantamento de março');
select is(pg_temp.msg_of($$select public.debt_void(pg_temp.pagamento(pg_temp.fx('c'), 150.00), 'engano')$$),
          '55000 a fatura de 04/2026 já está paga e travada: não pode ser alterada',
          'E4 anular o último pagamento (recente) recusado: ele também quitou abril, que segue travada');

-- cartão D: pagamento SEM fatura (adiantamento) que quitou março: anular é efeito indireto, recusado
insert into fixture select 'd', public.create_debt('Cartão D', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('d'), 17, 25);
select public.card_purchase(pg_temp.fx('d'), '2026-03-01', 100.00, 1, pg_temp.fx('cat'), 'Mercado');
select public.card_bill_due('2026-03-31');
select public.debt_pay(pg_temp.fx('d'), '2026-03-25', pg_temp.fx('bank'), 100.00);
select is(pg_temp.sit(pg_temp.fx('d'), '2026-03'), '100.00|100.00', 'I1 março quitada por pagamento sem fatura');
select is(pg_temp.sqlstate_of($$select public.debt_void(pg_temp.pagamento(pg_temp.fx('d'), 100.00), 'engano')$$), '55000',
          'I1 anular o adiantamento que quitou março: recusado (a exceção vale só para pagamento ligado à fatura)');

-- cartão E: fatura de R$ 0,00 fechada (só crédito) é "paga" (mesma regra da tela): o crédito dela não se anula
insert into fixture select 'e', public.create_debt('Cartão E', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('e'), 17, 25);
insert into fixture select 'cash_e', public.card_credit_income(pg_temp.fx('e'), '2026-03-05', 30.00, pg_temp.fx('inc'), 'Cashback');
select is(pg_temp.sit(pg_temp.fx('e'), '2026-03'), '0.00|0.00', 'Z1 março só com crédito: total 0, fechada');
select is(pg_temp.sqlstate_of($$select public.debt_void(pg_temp.fx('cash_e'), 'engano')$$), '55000',
          'Z1 anular o crédito da fatura de R$ 0,00 fechada: recusado (travada)');

-- ---------------------------------------------------------------------------
-- Fatura ABERTA (ainda não fechou): nunca trava, mesmo já paga adiantada
-- ---------------------------------------------------------------------------
insert into fixture select 'f', public.create_debt('Cartão F', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('f'), 28, 5);
insert into fixture select 'hoje_compra', public.card_purchase(pg_temp.fx('f'), (now() at time zone 'America/Sao_Paulo')::date, 100.00, 1,
                                                               pg_temp.fx('cat'), 'Compra de hoje');
select public.debt_pay(pg_temp.fx('f'), (now() at time zone 'America/Sao_Paulo')::date, pg_temp.fx('bank'), 100.00);
select lives_ok($$select public.card_purchase_delete(pg_temp.fx('f'), pg_temp.fx('hoje_compra')::text, 'lançada errada')$$,
                'O1 fatura aberta paga adiantada: excluir a compra continua permitido');

-- ---------------------------------------------------------------------------
-- Isolamento e permissões
-- ---------------------------------------------------------------------------
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000064a2');
insert into fixture select 'h2', public.create_household('Casa Vizinha');
select is(pg_temp.sqlstate_of($$select public.debt_void(pg_temp.fx('cash_mar'), 'invasão')$$), '42501',
          'S1 outra família: "registro não encontrado" (42501), sem revelar se a fatura está travada');
select is(pg_temp.sqlstate_of($$select public.card_invoice_reopen(pg_temp.fx('a'), '2026-03', 'invasão')$$), '42501',
          'S2 outra família não reabre');
reset role;
select ok(not has_function_privilege('authenticated', 'private.card_paid_snapshot(uuid)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'private.card_paid_lock_check(uuid, jsonb, text)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'private.card_paid_lock_raise(text)', 'EXECUTE'),
          'S3 as funções da trava não são chamáveis pelo cliente');

select * from finish();
rollback;
