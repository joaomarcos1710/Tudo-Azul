-- 104_card_payment_move: migration 110 (20261111130000_card_payment_move.sql). Pedido do dono de 11/11/2026: mudar a
-- fatura de um pagamento de cartão ("caiu na fatura, mas deveria ser na seguinte") sem anular e lançar de novo.
-- O que este arquivo prova:
--   • o pagamento continua o MESMO registro (não é anulado nem recriado): data, valor e conta iguais, saldo da conta igual;
--     só a fatura que ele quita muda, e o "pago" das duas faturas acompanha;
--   • fatura paga continua travada (decisão do dono: não reabrir): origem ou destino fechado e pago → 55000;
--   • fatura de destino inválida, inexistente ou igual à atual, evento que não é pagamento e pagamento anulado → 22023;
--   • fatura aberta sem linha em debt_invoices ganha a linha, com o vencimento de card_months;
--   • adiantamento (pagamento sem fatura) também pode ir para uma fatura;
--   • conta conciliada não impede (o dinheiro na conta não muda);
--   • outra família não move, anon não executa, e o evento continua imutável fora da RPC.
-- Cartão fecha dia 17 e vence dia 25; datas de março a maio de 2026 já fechadas (hoje real >= 11/11/2026). Dados inventados.
-- Sem a migration este arquivo falha (a função não existe; o guarda antigo recusa a troca de fatura).
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
create function pg_temp.hoje() returns date language sql as $f$ select (now() at time zone 'America/Sao_Paulo')::date $f$;
-- id da fatura (rótulo AAAA-MM) e situação "total|pago" vinda de card_months
create function pg_temp.fat(p_card uuid, p_label text) returns uuid language sql as $f$
  select id from public.debt_invoices where debt_id = p_card and label = p_label $f$;
create function pg_temp.sit(p_card uuid, p_label text) returns text language sql as $f$
  select total::numeric(14,2) || '|' || paid::numeric(14,2) from public.card_months(p_card) where label = p_label $f$;
create function pg_temp.banco() returns numeric language sql as $f$
  select balance from public.account_balances(pg_temp.fx('h'), '2099-12-31') where name = 'Banco' $f$;
-- o pagamento como ele está no banco: "data|valor|conta é o Banco|anulado|rótulo da fatura"
create function pg_temp.pag(p_k text) returns text language sql as $f$
  select concat_ws('|', e.date, e.amount, (e.account_id = pg_temp.fx('bank'))::text, (e.voided_at is not null)::text,
                   coalesce((select i.label from public.debt_invoices i where i.id = e.invoice_id), 'sem fatura'))
    from public.debt_events e where e.id = pg_temp.fx(p_k) $f$;
create function pg_temp.move(p_k text, p_label text) returns text language plpgsql as $f$
begin perform public.card_payment_move(pg_temp.fx(p_k), p_label); return null;
exception when others then return sqlstate; end $f$;
grant execute on all functions in schema pg_temp to public;

-- ---- F: forma e permissões ----
select has_function('public', 'card_payment_move', array['uuid', 'text'], 'F1 existe public.card_payment_move(uuid, text)');
select is(pg_get_function_result('public.card_payment_move(uuid, text)'::regprocedure), 'uuid', 'F2 devolve a fatura de destino (uuid)');
select ok((select prosecdef from pg_proc where oid = 'public.card_payment_move(uuid, text)'::regprocedure), 'F3 é SECURITY DEFINER (grava só pelo dono do banco)');
select is((select proconfig::text from pg_proc where oid = 'public.card_payment_move(uuid, text)'::regprocedure), '{"search_path=\"\""}', 'F4 search_path vazio');
select ok(has_function_privilege('authenticated', 'public.card_payment_move(uuid, text)', 'execute')
          and not has_function_privilege('anon', 'public.card_payment_move(uuid, text)', 'execute'),
          'F5 authenticated executa, anon não');

-- ---- dados ----
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000104a1', 'mover1@teste.com'),
  ('00000000-0000-0000-0000-0000000104a2', 'mover2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000104a1');
insert into fixture select 'h', public.create_household('Casa do Pagamento');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 5000.00, '2026-01-01') returning id)
  insert into fixture select 'bank', id from i;
insert into fixture select 'cat', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';
-- cartão: março 100 (paga, travada), abril 80 (paga 30), maio 60 (sem pagamento) e a fatura aberta de hoje, 40
insert into fixture select 'a', public.create_debt('Cartão de teste', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('a'), 17, 25);
select public.card_purchase(pg_temp.fx('a'), '2026-03-01', 100.00, 1, pg_temp.fx('cat'), 'Mercado');
select public.card_purchase(pg_temp.fx('a'), '2026-03-20', 80.00, 1, pg_temp.fx('cat'), 'Livro');
select public.card_purchase(pg_temp.fx('a'), '2026-04-20', 60.00, 1, pg_temp.fx('cat'), 'Fone');
select public.card_purchase(pg_temp.fx('a'), pg_temp.hoje(), 40.00, 1, pg_temp.fx('cat'), 'Compra de hoje');
select public.card_bill_due('2026-05-31');
insert into fixture select 'p1', public.debt_pay(pg_temp.fx('a'), '2026-03-25', pg_temp.fx('bank'), 100.00, pg_temp.fat(pg_temp.fx('a'), '2026-03'));
insert into fixture select 'p2', public.debt_pay(pg_temp.fx('a'), '2026-04-25', pg_temp.fx('bank'), 30.00, pg_temp.fat(pg_temp.fx('a'), '2026-04'));
-- a fatura aberta (a da compra de hoje): o rótulo depende do dia em que o teste roda
create temp table aberta as
  select m.label from public.card_months(pg_temp.fx('a')) m where m.closing_date > pg_temp.hoje() order by m.label limit 1;
grant all on aberta to public;
create function pg_temp.aberta() returns text language sql as $f$ select label from aberta $f$;
grant execute on function pg_temp.aberta() to public;

select is(pg_temp.sit(pg_temp.fx('a'), '2026-03'), '100.00|100.00', 'T0 março fechada e paga (travada)');
select is(pg_temp.sit(pg_temp.fx('a'), '2026-04'), '80.00|30.00', 'T0 abril fechada, paga em parte (30 de 80)');
select is(pg_temp.sit(pg_temp.fx('a'), '2026-05'), '60.00|0.00', 'T0 maio fechada, sem pagamento');
select is(pg_temp.banco(), 4870.00, 'T0 conta: 5000 − 100 − 30');
select ok(pg_temp.aberta() is not null and pg_temp.fat(pg_temp.fx('a'), pg_temp.aberta()) is null,
          'T0 a fatura aberta existe em card_months e ainda não tem linha em debt_invoices');

-- ---- M: mover ----
select is(pg_temp.move('p2', '2026-05'), null, 'M1 pagamento de abril vai para maio');
select is(pg_temp.sit(pg_temp.fx('a'), '2026-04'), '80.00|0.00', 'M1.1 abril perde o pagamento');
select is(pg_temp.sit(pg_temp.fx('a'), '2026-05'), '60.00|30.00', 'M1.2 maio ganha o pagamento');
select is(pg_temp.pag('p2'), '2026-04-25|30.00|true|false|2026-05', 'M1.3 o MESMO pagamento: data, valor e conta iguais, não anulado; só a fatura mudou');
select is(pg_temp.banco(), 4870.00, 'M1.4 o saldo da conta não muda');
select is((select count(*) from public.debt_events where debt_id = pg_temp.fx('a') and kind = 'payment'), 2::bigint,
          'M1.5 nenhum pagamento foi criado nem anulado (continuam 2)');
select is(current_setting('app.card_payment_move', true), 'off', 'M1.6 a marca de sessão fica desligada depois da mudança');

select is(pg_temp.move('p2', '2026-04'), null, 'M2 e volta para abril');
select is(pg_temp.sit(pg_temp.fx('a'), '2026-04') || ' / ' || pg_temp.sit(pg_temp.fx('a'), '2026-05'), '80.00|30.00 / 60.00|0.00',
          'M2.1 as duas faturas voltam ao que eram');

-- fatura paga continua travada (decisão do dono: não reabrir)
select is(pg_temp.move('p1', '2026-04'), '55000', 'M3 tirar o pagamento de março (fechada e paga) é recusado');
select is(pg_temp.sit(pg_temp.fx('a'), '2026-03'), '100.00|100.00', 'M3.1 março continua paga');
select is(pg_temp.pag('p1'), '2026-03-25|100.00|true|false|2026-03', 'M3.2 o pagamento continua em março');
select is(pg_temp.move('p2', '2026-03'), '55000', 'M4 levar um pagamento para março (fechada e paga) também é recusado');
select is(pg_temp.sit(pg_temp.fx('a'), '2026-04'), '80.00|30.00', 'M4.1 abril continua igual');
-- o caso que a trava por números deixava passar: um pagamento a mais em março (quitada) não muda o "pago" de março (a
-- sobra viraria crédito de abril), mas fatura paga não recebe nem perde pagamento
select is(pg_temp.pag('p2'), '2026-04-25|30.00|true|false|2026-04', 'M4.2 o pagamento continua em abril (não foi para a fatura paga)');

-- destino inválido
select is(pg_temp.move('p2', '2026-04'), '22023', 'M5 a mesma fatura: recusado');
select is(pg_temp.move('p2', 'abril'), '22023', 'M6 rótulo fora do formato: recusado');
select is(pg_temp.move('p2', '2026-13'), '22023', 'M6.1 mês 13: recusado');
select is(pg_temp.move('p2', '2031-01'), '22023', 'M6.2 mês sem fatura neste cartão: recusado');
select is(pg_temp.move('p2', null), '22023', 'M6.3 sem destino: recusado');

-- só pagamento ativo
insert into fixture select 'cobranca', id from public.debt_events
 where debt_id = pg_temp.fx('a') and kind = 'charge' and voided_at is null order by date limit 1;
select is(pg_temp.move('cobranca', '2026-05'), '22023', 'M7 cobrança de parcela não é pagamento: recusado');
insert into fixture select 'p3', public.debt_pay(pg_temp.fx('a'), '2026-05-25', pg_temp.fx('bank'), 15.00, pg_temp.fat(pg_temp.fx('a'), '2026-05'));
select public.debt_void(pg_temp.fx('p3'), 'lançado errado (teste)');
select is(pg_temp.move('p3', '2026-04'), '22023', 'M8 pagamento anulado: recusado');

-- fatura aberta sem linha: ganha a linha, com o vencimento de card_months
select is(pg_temp.move('p2', pg_temp.aberta()), null, 'M9 pagamento vai para a fatura aberta');
select ok(pg_temp.fat(pg_temp.fx('a'), pg_temp.aberta()) is not null, 'M9.1 a linha da fatura aberta foi criada');
select is((select i.due_date from public.debt_invoices i where i.id = pg_temp.fat(pg_temp.fx('a'), pg_temp.aberta())),
          (select m.due_date from public.card_months(pg_temp.fx('a')) m where m.label = pg_temp.aberta()),
          'M9.2 com o mesmo vencimento que card_months mostra');
select is(pg_temp.sit(pg_temp.fx('a'), pg_temp.aberta()), '40.00|30.00', 'M9.3 a fatura aberta fica com 30 pagos de 40');
select is(pg_temp.move('p2', '2026-04'), null, 'M9.4 e volta para abril');

-- adiantamento (pagamento sem fatura) também pode ir para uma fatura; o pago de abril não muda (antes o adiantamento
-- já era usado em abril, a primeira com saldo)
insert into fixture select 'p4', public.debt_pay(pg_temp.fx('a'), '2026-06-01', pg_temp.fx('bank'), 10.00, null);
select is(pg_temp.sit(pg_temp.fx('a'), '2026-04'), '80.00|40.00', 'M10 o adiantamento de 10 é usado em abril');
select is(pg_temp.move('p4', '2026-04'), null, 'M10.1 o adiantamento passa a ser pagamento de abril');
select is(pg_temp.pag('p4'), '2026-06-01|10.00|true|false|2026-04', 'M10.2 mesmo registro, agora ligado a abril');
select is(pg_temp.sit(pg_temp.fx('a'), '2026-04'), '80.00|40.00', 'M10.3 abril continua com 40 pagos');

-- conta conciliada não impede (a data e a conta do pagamento não mudam)
select public.reconcile_account(pg_temp.fx('bank'), '2026-06-30',
  (select balance from public.account_balances(pg_temp.fx('h'), '2026-06-30') where name = 'Banco'));
select is(pg_temp.move('p2', '2026-05'), null, 'M11 com a conta conciliada até 30/06, o pagamento de 25/04 ainda muda de fatura');
select is(pg_temp.banco(), 4860.00, 'M11.1 e a conta continua igual (5000 − 100 − 30 − 10)');

-- ---- I: isolamento e o evento continua imutável fora da RPC ----
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000104a2');
insert into fixture select 'h2', public.create_household('Casa Vizinha');
select is(pg_temp.move('p2', '2026-04'), '42501', 'I1 outra família não move o pagamento alheio');
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000104a1');
select is(pg_temp.pag('p2'), '2026-04-25|30.00|true|false|2026-05', 'I1.1 e o pagamento continua em maio');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.sqlstate_of(format($$select public.card_payment_move(%L, '2026-04')$$, pg_temp.fx('p2'))), '42501',
          'I2 sem login: recusado');
-- direto na tabela (como dono do banco, sem a marca de sessão): a fatura não muda
select is(pg_temp.sqlstate_of(format($$update public.debt_events set invoice_id = %L where id = %L$$,
            pg_temp.fat(pg_temp.fx('a'), '2026-04'), pg_temp.fx('p2'))), '42501',
          'I3 sem a marca de sessão, trocar a fatura direto na tabela é recusado (evento imutável)');
select set_config('app.card_payment_move', 'on', true);
select is(pg_temp.sqlstate_of(format($$update public.debt_events set invoice_id = %L where id = %L$$,
            pg_temp.fat(pg_temp.fx('a'), '2026-05'), pg_temp.fx('cobranca'))), '42501',
          'I4 com a marca, cobrança de parcela continua sem trocar de fatura (só pagamento)');
select is(pg_temp.sqlstate_of(format($$update public.debt_events set amount = 31.00 where id = %L$$, pg_temp.fx('p2'))), '42501',
          'I5 com a marca, o valor do pagamento continua imutável');
select set_config('app.card_payment_move', 'off', true);
select ok(not has_table_privilege('authenticated', 'public.debt_events', 'UPDATE'),
          'I6 o app continua sem UPDATE em debt_events (a troca só passa pela RPC)');

-- ---- O: operação e adiantamento que quitou fatura paga ----
select pg_temp.login('00000000-0000-0000-0000-0000000104a1');
-- antecipação: grava a cobrança da parcela e o pagamento com o mesmo op_id; o pagamento não sai sozinho
insert into fixture select 'p_hoje', id from public.debt_installments where debt_id = pg_temp.fx('a') and description = 'Compra de hoje';
select public.debt_anticipate(pg_temp.fx('a'), pg_temp.hoje(), pg_temp.fx('bank'), array[pg_temp.fx('p_hoje')], array[40.00], array[0.00]);
insert into fixture select 'p_ant', id from public.debt_events
 where debt_id = pg_temp.fx('a') and kind = 'payment' and note = 'antecipação' and voided_at is null;
select is(pg_temp.move('p_ant', '2026-05'), '22023', 'O1 pagamento de uma antecipação não muda de fatura sozinho');

-- adiantamento (sem fatura) que quitou uma fatura já fechada: levar para outra fatura deixaria a fechada sem pagamento.
-- Aqui a origem não tem rótulo (sem fatura), então quem recusa é a trava por números (card_paid_lock_check)
insert into fixture select 'b', public.create_debt('Cartão B', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('b'), 17, 25);
select public.card_purchase(pg_temp.fx('b'), '2026-08-01', 100.00, 1, pg_temp.fx('cat'), 'Agosto');
select public.card_purchase(pg_temp.fx('b'), '2026-08-20', 50.00, 1, pg_temp.fx('cat'), 'Setembro');
select public.card_bill_due('2026-10-31');
insert into fixture select 'adb', public.debt_pay(pg_temp.fx('b'), '2026-08-20', pg_temp.fx('bank'), 100.00, null);
select is(pg_temp.sit(pg_temp.fx('b'), '2026-08') || ' / ' || pg_temp.sit(pg_temp.fx('b'), '2026-09'), '100.00|100.00 / 50.00|0.00',
          'O2 o adiantamento de 100 quitou agosto (fechada e paga); setembro ainda a pagar');
select is(pg_temp.move('adb', '2026-09'), '55000', 'O3 levar esse adiantamento para setembro é recusado (agosto deixaria de estar paga)');
select is(pg_temp.sit(pg_temp.fx('b'), '2026-08'), '100.00|100.00', 'O3.1 agosto continua paga');
select is(pg_temp.pag('adb'), '2026-08-20|100.00|true|false|sem fatura', 'O3.2 o adiantamento continua sem fatura');

-- ---- R: a fatura de destino deixa de existir (achado da revisão; correção na causa, opção B do dono) ----
-- pagamento movido para uma fatura futura; depois a fatura perde a compra. O mês some de card_months, e o pagamento
-- tem de passar a contar como adiantamento (antes não contava em lugar nenhum: as faturas mostravam o valor dele a mais)
create function pg_temp.futura(p_card uuid, p_n integer) returns text language sql as $f$
  select m.label from public.card_months(p_card) m where m.closing_date > pg_temp.hoje() order by m.label offset p_n limit 1 $f$;
create function pg_temp.sit_as_of(p_card uuid, p_label text) returns text language sql as $f$
  select total::numeric(14,2) || '|' || paid::numeric(14,2) from private.card_months_as_of(p_card, pg_temp.hoje()) where label = p_label $f$;
grant execute on function pg_temp.futura(uuid, integer), pg_temp.sit_as_of(uuid, text) to public;

-- R1: compra excluída
insert into fixture select 'c', public.create_debt('Cartão C', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('c'), 17, 25);
select public.card_purchase(pg_temp.fx('c'), '2026-09-20', 100.00, 1, pg_temp.fx('cat'), 'Outubro C');
select public.card_purchase(pg_temp.fx('c'), pg_temp.hoje(), 200.00, 2, pg_temp.fx('cat'), 'Futura C');
select public.card_bill_due('2026-10-31');
insert into fixture select 'pc', public.debt_pay(pg_temp.fx('c'), '2026-10-25', pg_temp.fx('bank'), 60.00, pg_temp.fat(pg_temp.fx('c'), '2026-10'));
create temp table fut_c as select pg_temp.futura(pg_temp.fx('c'), 1) as label;
grant all on fut_c to public;
select is(pg_temp.move('pc', (select label from fut_c)), null, 'R1 pagamento de outubro vai para a segunda fatura futura');
select is(pg_temp.sit(pg_temp.fx('c'), '2026-10'), '100.00|0.00', 'R1.1 outubro fica a pagar inteira');
select lives_ok(format($$select public.card_purchase_delete(%L, %L, 'compra excluída (teste)')$$, pg_temp.fx('c'),
          (select plan from public.debt_installments where debt_id = pg_temp.fx('c') and description = 'Futura C' limit 1)),
          'R1.2 a compra das faturas futuras é excluída');
select is((select count(*) from public.card_months(pg_temp.fx('c')) m where m.label = (select label from fut_c)), 0::bigint,
          'R1.3 a fatura futura sumiu de card_months');
select is(pg_temp.sit(pg_temp.fx('c'), '2026-10'), '100.00|60.00',
          'R1.4 o pagamento órfão conta como adiantamento e é usado em outubro (antes: 100|0, os 60 sumiam)');
select is(pg_temp.sit_as_of(pg_temp.fx('c'), '2026-10'), '100.00|60.00', 'R1.5 card_months_as_of dá o mesmo número');
-- o gatilho solta o pagamento no fim da transação (opção 1 do dono, 12/11/2026); aqui o fim é antecipado por SET CONSTRAINTS
select is(pg_temp.pag('pc'), '2026-10-25|60.00|true|false|' || (select label from fut_c), 'R1.6 antes do fim da transação o pagamento ainda aponta para a fatura que sumiu');
select lives_ok($$set constraints debt_events_payment_release immediate$$, 'R1.6.1 fim da transação: o gatilho roda');
select lives_ok($$set constraints debt_events_payment_release deferred$$, 'R1.6.2 volta ao normal');
select is(pg_temp.pag('pc'), '2026-10-25|60.00|true|false|sem fatura', 'R1.7 o pagamento ficou sem fatura: é adiantamento de vez');
select is(pg_temp.sit(pg_temp.fx('c'), '2026-10'), '100.00|60.00', 'R1.8 soltar não muda número nenhum');
select is(pg_temp.sit_as_of(pg_temp.fx('c'), '2026-10'), '100.00|60.00', 'R1.8.1 nem em card_months_as_of');
select is(pg_temp.move('pc', '2026-10'), null, 'R1.9 e ainda pode ir para outubro pela RPC (de adiantamento para fatura)');
select is(pg_temp.sit(pg_temp.fx('c'), '2026-10'), '100.00|60.00', 'R1.10 outubro continua com 60 pagos, agora ligados a ela');

-- R2: parcela futura estornada inteira (vira cancelamento e o mês some)
insert into fixture select 'd', public.create_debt('Cartão D', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('d'), 17, 25);
select public.card_purchase(pg_temp.fx('d'), '2026-09-20', 80.00, 1, pg_temp.fx('cat'), 'Outubro D');
select public.card_purchase(pg_temp.fx('d'), pg_temp.hoje(), 50.00, 1, pg_temp.fx('cat'), 'Futura D');
select public.card_bill_due('2026-10-31');
insert into fixture select 'pd', public.debt_pay(pg_temp.fx('d'), '2026-10-25', pg_temp.fx('bank'), 30.00, pg_temp.fat(pg_temp.fx('d'), '2026-10'));
create temp table fut_d as select pg_temp.futura(pg_temp.fx('d'), 0) as label;
grant all on fut_d to public;
select is(pg_temp.move('pd', (select label from fut_d)), null, 'R2 pagamento de outubro vai para a fatura aberta');
select lives_ok(format($$select public.debt_refund(%L, %L::date, 50.00)$$,
          (select id from public.debt_installments where debt_id = pg_temp.fx('d') and description = 'Futura D'), pg_temp.hoje()),
          'R2.1 a parcela da fatura aberta é estornada inteira');
select is((select count(*) from public.card_months(pg_temp.fx('d')) m where m.label = (select label from fut_d)), 0::bigint,
          'R2.2 a fatura aberta sumiu de card_months');
select is(pg_temp.sit(pg_temp.fx('d'), '2026-10'), '80.00|30.00', 'R2.3 os 30 contam como adiantamento em outubro (antes: 80|0)');
select is(pg_temp.sit_as_of(pg_temp.fx('d'), '2026-10'), '80.00|30.00', 'R2.4 card_months_as_of dá o mesmo número');
select lives_ok($$set constraints debt_events_payment_release immediate$$, 'R2.5 fim da transação: o gatilho roda');
select lives_ok($$set constraints debt_events_payment_release deferred$$, 'R2.5.1 volta ao normal');
select is(pg_temp.pag('pd'), '2026-10-25|30.00|true|false|sem fatura', 'R2.6 o pagamento ficou sem fatura');
select is(pg_temp.sit(pg_temp.fx('d'), '2026-10'), '80.00|30.00', 'R2.7 soltar não muda número nenhum');

-- R3: o mês some e VOLTA (segunda revisão da #306): a fatura paga não pode voltar a "a pagar"
insert into fixture select 'e', public.create_debt('Cartão E', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('e'), 17, 25);
select public.card_purchase(pg_temp.fx('e'), '2026-09-20', 80.00, 1, pg_temp.fx('cat'), 'Outubro E');
select public.card_purchase(pg_temp.fx('e'), pg_temp.hoje(), 50.00, 1, pg_temp.fx('cat'), 'Futura E');
select public.card_bill_due('2026-10-31');
insert into fixture select 'pe1', public.debt_pay(pg_temp.fx('e'), '2026-10-25', pg_temp.fx('bank'), 60.00, pg_temp.fat(pg_temp.fx('e'), '2026-10'));
create temp table fut_e as select pg_temp.futura(pg_temp.fx('e'), 0) as label;
grant all on fut_e to public;
select is(pg_temp.move('pe1', (select label from fut_e)), null, 'R3 pagamento de outubro vai para a fatura aberta');
insert into fixture select 'pe2', public.debt_pay(pg_temp.fx('e'), '2026-10-26', pg_temp.fx('bank'), 20.00, pg_temp.fat(pg_temp.fx('e'), '2026-10'));
select is(pg_temp.sit(pg_temp.fx('e'), '2026-10'), '80.00|20.00', 'R3.1 outubro: 80 com 20 pagos, ainda não paga');
select lives_ok(format($$select public.debt_refund(%L, %L::date, 50.00)$$,
          (select id from public.debt_installments where debt_id = pg_temp.fx('e') and description = 'Futura E'), pg_temp.hoje()),
          'R3.2 a fatura aberta perde a compra (estorno inteiro) e some');
select lives_ok($$set constraints debt_events_payment_release immediate$$, 'R3.3 fim da transação: o gatilho roda');
select lives_ok($$set constraints debt_events_payment_release deferred$$, 'R3.3.1 volta ao normal');
select is(pg_temp.sit(pg_temp.fx('e'), '2026-10'), '80.00|80.00', 'R3.4 os 60 soltos fecham outubro: paga (e travada)');
select lives_ok(format($$select public.card_purchase(%L, %L::date, 30.00, 1, %L, 'Nova E')$$, pg_temp.fx('e'), pg_temp.hoje(), pg_temp.fx('cat')),
          'R3.5 uma compra nova faz a fatura do mês voltar');
select is((select count(*) from public.card_months(pg_temp.fx('e')) m where m.label = (select label from fut_e)), 1::bigint, 'R3.6 o mês voltou a existir');
select is(pg_temp.sit(pg_temp.fx('e'), '2026-10'), '80.00|80.00',
          'R3.7 outubro continua paga: o pagamento não volta para a fatura que reapareceu (antes: 80|20, vencida)');
select is(pg_temp.sit_as_of(pg_temp.fx('e'), '2026-10'), '80.00|80.00', 'R3.8 card_months_as_of dá o mesmo número');
select is(pg_temp.sit(pg_temp.fx('e'), (select label from fut_e)), '30.00|0.00', 'R3.9 a fatura que voltou tem só a compra nova, sem pago');
select is(pg_temp.pag('pe1'), '2026-10-25|60.00|true|false|sem fatura', 'R3.10 o pagamento continua sem fatura');

-- R4: o critério de "mês que existe" do gatilho é o mesmo de card_months (as três cópias não podem divergir)
reset role;
select is((select array_agg(l order by l) from private.card_month_labels(pg_temp.fx('c')) as l),
          (select array_agg(m.label order by m.label) from public.card_months(pg_temp.fx('c')) m), 'R4.1 cartão C: mesmos meses');
select is((select array_agg(l order by l) from private.card_month_labels(pg_temp.fx('d')) as l),
          (select array_agg(m.label order by m.label) from public.card_months(pg_temp.fx('d')) m), 'R4.2 cartão D: mesmos meses');
select is((select array_agg(l order by l) from private.card_month_labels(pg_temp.fx('e')) as l),
          (select array_agg(m.label order by m.label) from public.card_months(pg_temp.fx('e')) m), 'R4.3 cartão E: mesmos meses');
select is((select array_agg(l order by l) from private.card_month_labels(pg_temp.fx('a')) as l),
          (select array_agg(m.label order by m.label) from public.card_months(pg_temp.fx('a')) m), 'R4.4 cartão A (com devolução e crédito): mesmos meses');
reset role;

select * from finish();
rollback;
