-- 12_card_correcoes: migration de correções do cartão (decisões de 24/10/2026).
--   * cobrança de parcela não se anula "no solto" (a anulação era desfeita pela cobrança automática);
--   * excluir compra inteira (desfaz pagamentos das faturas envolvidas; o dinheiro volta à conta);
--   * reabrir fatura paga (exclui os pagamentos ligados a ela);
--   * editar o valor de cada parcela (fatura paga: só depois de reabrir), com trilha de auditoria;
--   * pagamento diferente da fatura: saldo anterior e adiantamento (derivados em card_months);
--   * abertura da conta x pagamentos de cartão; compra retroativa x devolução; ciclo por parcela;
--   * idempotência (clique duplo) em card_purchase e debt_pay.
-- Datas no passado (2026-01 a 2026-06): card_bill_due nunca cobra além de hoje.
-- Cada cenário usa uma família própria, para a cobrança automática de um não mexer nos outros.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ---- auxiliares de teste (temporários; somem no rollback) ----
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
create function pg_temp.parcelas(p_plan uuid) returns text language sql as $f$
  select string_agg(seq || ':' || due_date || ':' || face, ' ' order by seq)
    from public.debt_installments where plan = p_plan::text $f$;
create function pg_temp.uid(p_n integer) returns uuid language sql as $f$
  select ('00000000-0000-0000-0000-000000' || lpad(p_n::text, 6, '0'))::uuid $f$;
-- Cria família, conta "Banco" (5000), categoria de despesa e cartão "Cartão" (fecha 17, vence 25).
create function pg_temp.mk(p_tag text, p_n integer) returns void language plpgsql as $f$
declare v_h uuid; v_acc uuid;
begin
  perform pg_temp.login(pg_temp.uid(p_n));
  v_h := public.create_household('Casa ' || p_tag);
  insert into public.accounts (household_id, name, type, initial_balance, opening_date)
  values (v_h, 'Banco', 'checking', 5000, '2026-01-01') returning id into v_acc;
  insert into fixture values (p_tag || 'h', v_h), (p_tag || 'bank', v_acc);
  insert into fixture select p_tag || 'cat', id from public.categories
   where household_id = v_h and name = 'Compras pessoais';
  insert into fixture select p_tag || 'card', public.create_debt('Cartão', 'card', '2026-01-01', 0);
  perform public.set_card_cycle((select v from fixture where k = p_tag || 'card'), 17, 25);
end $f$;
-- Saldo da conta "Banco" e id da fatura (por rótulo) do cartão do cenário.
create function pg_temp.banco(p_tag text) returns numeric language sql as $f$
  select balance from public.account_balances(pg_temp.fx(p_tag || 'h'), '2099-12-31') where name = 'Banco' $f$;
create function pg_temp.fat(p_tag text, p_label text) returns uuid language sql as $f$
  select id from public.debt_invoices where debt_id = pg_temp.fx(p_tag || 'card') and label = p_label $f$;
grant execute on function pg_temp.fx(text), pg_temp.sqlstate_of(text), pg_temp.parcelas(uuid), pg_temp.uid(integer),
  pg_temp.mk(text, integer), pg_temp.banco(text), pg_temp.fat(text, text), pg_temp.login(uuid) to public;

insert into auth.users (id, email)
select pg_temp.uid(n), 'k' || n || '@teste.com' from generate_series(120001, 120012) n;

-- =====================================================================================
-- A. Excluir compra inteira (a: compra paga + compra sem cobrança; f: fatura compartilhada; g: estorno)
-- =====================================================================================
select pg_temp.mk('a', 120001);
insert into fixture select 'ap1', public.card_purchase(pg_temp.fx('acard'), '2026-03-15', 300.00, 3, pg_temp.fx('acat'), 'Geladeira');
select is(public.card_bill_due('2026-03-31'), 1, 'A0 março: 1ª parcela da geladeira cobrada');
select lives_ok($$select public.debt_pay(pg_temp.fx('acard'), '2026-03-25', pg_temp.fx('abank'), 100.00, pg_temp.fat('a', '2026-03'))$$,
                'A0 fatura de março paga');
select is(pg_temp.banco('a'), 4900.00, 'A0 conta: 5000 − 100');

-- A1: a cobrança automática não se anula "no solto": a anulação seria desfeita na próxima abertura do app
select is(pg_temp.sqlstate_of($$select public.debt_void((select id from public.debt_events
            where debt_id = pg_temp.fx('acard') and kind = 'charge' and voided_at is null limit 1), 'engano de teste')$$),
          '55000', 'A1 anular cobrança de parcela de cartão: recusado (use excluir compra ou editar parcela)');

-- A2: a prévia lista o que será desfeito (para a tela de confirmação)
select is((select array_agg(item || '|' || event_date || '|' || amount || '|' || coalesce(invoice_label, '') order by item, event_date)
             from public.card_purchase_delete_preview(pg_temp.fx('acard'), pg_temp.fx('ap1')::text)),
          array['cancel|2026-03-17|100.00|', 'cancel|2026-04-17|100.00|', 'cancel|2026-05-17|100.00|',
                'charge|2026-03-17|100.00|2026-03', 'payment|2026-03-25|100.00|2026-03'],
          'A2 prévia: cobrança de março, pagamento de 25/03 (fatura 2026-03) e 3 parcelas a cancelar');

-- A3: motivo curto demais e dívida que não é cartão
select is(pg_temp.sqlstate_of($$select public.card_purchase_delete(pg_temp.fx('acard'), pg_temp.fx('ap1')::text, 'x')$$),
          '22023', 'A3 motivo com menos de 3 caracteres: recusado');
insert into fixture select 'aloan', public.create_debt('Empréstimo', 'loan', '2026-01-01', 0);
select is(pg_temp.sqlstate_of($$select public.card_purchase_delete(pg_temp.fx('aloan'), 'qualquer', 'lançada errada')$$),
          '23514', 'A3 exclusão de compra em dívida que não é cartão: recusada');

-- A4: excluir a compra inteira, inclusive a parcela já paga; o dinheiro volta para a conta
select lives_ok($$select public.card_purchase_delete(pg_temp.fx('acard'), pg_temp.fx('ap1')::text, 'lançada errada')$$,
                'A4 compra excluída');
select is(pg_temp.banco('a'), 5000.00, 'A4 o pagamento foi desfeito: o dinheiro voltou para a conta (5000)');
select is((select debt from public.debt_balances(pg_temp.fx('ah'), '2099-12-31') where name = 'Cartão'),
          0::numeric, 'A4 dívida do cartão zerada');
select is((select planned_remaining from public.debt_balances(pg_temp.fx('ah'), '2099-12-31') where name = 'Cartão'),
          0::numeric, 'A4 nenhum compromisso futuro sobra');
select is((select count(*) from public.debt_events where debt_id = pg_temp.fx('acard') and voided_at is not null),
          2::bigint, 'A4 trilha: cobrança e pagamento anulados (nada apagado)');
select is((select count(*) from public.card_months(pg_temp.fx('acard'))), 0::bigint, 'A4 nenhuma fatura aparece');
select is((select count(*) from public.card_items(pg_temp.fx('acard'), '2026-03')), 0::bigint, 'A4 nenhum item aparece');
select is(public.card_bill_due('2026-06-30'), 0, 'A4 a cobrança automática NÃO recria o que foi excluído');
select is(pg_temp.sqlstate_of($$select public.card_purchase_delete(pg_temp.fx('acard'), pg_temp.fx('ap1')::text, 'de novo')$$),
          '55000', 'A4 excluir de novo: recusado (compra já excluída)');

-- A5: compra ainda sem nenhuma cobrança: só cancela as parcelas
insert into fixture select 'ap2', public.card_purchase(pg_temp.fx('acard'), '2026-05-01', 200.00, 2, pg_temp.fx('acat'), 'Sofá');
select is((select expense_planned from public.period_summary(pg_temp.fx('ah'), '2026-05-01', '2026-05-31')),
          100.00, 'A5 antes de excluir: 100,00 planejado em maio');
select lives_ok($$select public.card_purchase_delete(pg_temp.fx('acard'), pg_temp.fx('ap2')::text, 'desisti da compra')$$,
                'A5 compra sem cobrança excluída');
select is((select expense_planned from public.period_summary(pg_temp.fx('ah'), '2026-05-01', '2026-05-31')),
          0::numeric, 'A5 o planejado de maio sumiu');
select is(public.card_bill_due('2026-06-30'), 0, 'A5 nada é cobrado depois');

-- A6: fatura compartilhada — excluir a TV reabre a fatura inteira; o Mercado continua cobrado, sem pagamento
reset role;
select pg_temp.mk('f', 120002);
insert into fixture select 'fp1', public.card_purchase(pg_temp.fx('fcard'), '2026-03-01', 100.00, 1, pg_temp.fx('fcat'), 'TV');
insert into fixture select 'fp2', public.card_purchase(pg_temp.fx('fcard'), '2026-03-02', 50.00, 1, pg_temp.fx('fcat'), 'Mercado');
select is(public.card_bill_due('2026-03-31'), 2, 'A6 as duas compras cobradas em março');
select public.debt_pay(pg_temp.fx('fcard'), '2026-03-25', pg_temp.fx('fbank'), 150.00, pg_temp.fat('f', '2026-03'));
select is(pg_temp.banco('f'), 4850.00, 'A6 conta: 5000 − 150');
select public.card_purchase_delete(pg_temp.fx('fcard'), pg_temp.fx('fp1')::text, 'TV lançada errada');
select is(pg_temp.banco('f'), 5000.00, 'A6 o pagamento da fatura inteira foi desfeito: os 150 voltaram');
select is((select array[charged, pending, total, paid] from public.card_months(pg_temp.fx('fcard')) where label = '2026-03'),
          array[50, 0, 50, 0]::numeric[], 'A6 fatura de março: só o Mercado (50), sem pagamento');
select is((select debt from public.debt_balances(pg_temp.fx('fh'), '2099-12-31') where name = 'Cartão'),
          50.00, 'A6 dívida do cartão = 50 (Mercado)');
select is((select expense_paid from public.period_summary(pg_temp.fx('fh'), '2026-03-01', '2026-03-31')),
          50.00, 'A6 despesa de março = 50');

-- A7: compra com estorno — o estorno sai junto
reset role;
select pg_temp.mk('g', 120003);
insert into fixture select 'gp1', public.card_purchase(pg_temp.fx('gcard'), '2026-03-01', 100.00, 1, pg_temp.fx('gcat'), 'Tênis');
select public.card_bill_due('2026-03-31');
select public.debt_refund((select id from public.debt_installments where plan = pg_temp.fx('gp1')::text), '2026-03-20', 30.00);
select is((select expense_paid from public.period_summary(pg_temp.fx('gh'), '2026-03-01', '2026-03-31')),
          70.00, 'A7 despesa de março já abatida pelo estorno: 70');
select lives_ok($$select public.card_purchase_delete(pg_temp.fx('gcard'), pg_temp.fx('gp1')::text, 'compra inexistente')$$,
                'A7 compra com estorno excluída');
select is((select expense_paid from public.period_summary(pg_temp.fx('gh'), '2026-03-01', '2026-03-31')),
          0::numeric, 'A7 despesa de março zerada');
select is((select debt from public.debt_balances(pg_temp.fx('gh'), '2099-12-31') where name = 'Cartão'),
          0::numeric, 'A7 dívida zerada (cobrança e estorno anulados)');

-- A8: outra família não exclui nem vê a prévia
reset role;
select pg_temp.login(pg_temp.uid(120001));
select is(pg_temp.sqlstate_of($$select public.card_purchase_delete(pg_temp.fx('gcard'), pg_temp.fx('gp1')::text, 'tentativa')$$),
          '42501', 'A8 excluir compra de outra família: recusado');
select is((select count(*) from public.card_purchase_delete_preview(pg_temp.fx('gcard'), pg_temp.fx('gp1')::text)),
          0::bigint, 'A8 prévia de outra família: vazia');

-- =====================================================================================
-- B. Editar o valor de cada parcela (b)
-- =====================================================================================
reset role;
select pg_temp.mk('b', 120004);
insert into fixture select 'bp', public.card_purchase(pg_temp.fx('bcard'), '2026-03-01', 100.00, 3, pg_temp.fx('bcat'), 'Curso');
select is(pg_temp.parcelas(pg_temp.fx('bp')), '1:2026-03-17:33.34 2:2026-04-17:33.33 3:2026-05-17:33.33',
          'B0 100,00 em 3x: 33,34 + 33,33 + 33,33');

-- B1: parcela ainda não cobrada: edita direto
select lives_ok($$select public.card_installment_edit(
         (select id from public.debt_installments where plan = pg_temp.fx('bp')::text and seq = 2), 33.34, 'a fatura veio 33,34')$$,
       'B1 edita a 2ª parcela (ainda não cobrada)');
select is(pg_temp.parcelas(pg_temp.fx('bp')), '1:2026-03-17:33.34 2:2026-04-17:33.34 3:2026-05-17:33.33',
          'B1 cada parcela com o seu valor: 33,34 / 33,34 / 33,33');
select is((select old_face || '>' || new_face || '|' || reason from public.debt_installment_edits
            where installment_id = (select id from public.debt_installments where plan = pg_temp.fx('bp')::text and seq = 2)),
          '33.33>33.34|a fatura veio 33,34', 'B1 trilha de auditoria da edição');

-- B2: parcela cobrada e ainda não paga: edita direto; a fatura se ajusta, sem cobrar duas vezes
select is(public.card_bill_due('2026-03-31'), 1, 'B2 março: 1ª parcela cobrada');
select lives_ok($$select public.card_installment_edit(
         (select id from public.debt_installments where plan = pg_temp.fx('bp')::text and seq = 1), 33.35)$$,
       'B2 edita a 1ª parcela já cobrada e não paga');
select is((select debt from public.debt_balances(pg_temp.fx('bh'), '2026-03-31') where name = 'Cartão'),
          33.35, 'B2 dívida ajustada para 33,35');
select is((select expense_paid from public.period_summary(pg_temp.fx('bh'), '2026-03-01', '2026-03-31')),
          33.35, 'B2 despesa de março ajustada para 33,35');
select is(public.card_bill_due('2026-03-31'), 0, 'B2 a cobrança automática não cobra de novo');
select is((select array[charged, pending, total] from public.card_months(pg_temp.fx('bcard')) where label = '2026-03'),
          array[33.35, 0, 33.35]::numeric[], 'B2 fatura de março com 33,35');

-- B3: fatura paga: só depois de reabrir
select public.debt_pay(pg_temp.fx('bcard'), '2026-03-25', pg_temp.fx('bbank'), 33.35, pg_temp.fat('b', '2026-03'));
select is(pg_temp.banco('b'), 4966.65, 'B3 conta: 5000 − 33,35');
select is(pg_temp.sqlstate_of($$select public.card_installment_edit(
         (select id from public.debt_installments where plan = pg_temp.fx('bp')::text and seq = 1), 33.36)$$),
          '55000', 'B3 parcela em fatura paga: recusado até reabrir a fatura');
select is(public.card_invoice_reopen(pg_temp.fx('bcard'), '2026-03', 'corrigir valor'), 1,
          'B3 reabrir a fatura de março desfaz 1 pagamento');
select is(pg_temp.banco('b'), 5000.00, 'B3 o dinheiro voltou para a conta');
select lives_ok($$select public.card_installment_edit(
         (select id from public.debt_installments where plan = pg_temp.fx('bp')::text and seq = 1), 33.36)$$,
       'B3 depois de reabrir, a edição passa');
select is((select debt from public.debt_balances(pg_temp.fx('bh'), '2026-03-31') where name = 'Cartão'),
          33.36, 'B3 dívida 33,36');
select is(pg_temp.sqlstate_of($$select public.card_invoice_reopen(pg_temp.fx('bcard'), '2099-01', 'x motivo')$$),
          '55000', 'B3 reabrir fatura que não existe: recusado');

-- B4: valores inválidos
select is(pg_temp.sqlstate_of($$select public.card_installment_edit(
         (select id from public.debt_installments where plan = pg_temp.fx('bp')::text and seq = 3), 0)$$),
          '22023', 'B4 valor 0: recusado');
select is(pg_temp.sqlstate_of($$select public.card_installment_edit(
         (select id from public.debt_installments where plan = pg_temp.fx('bp')::text and seq = 3), 33.333)$$),
          '22003', 'B4 mais de 2 casas decimais: recusado');

-- B5: parcela com cancelamento/estorno parcial não se edita
select public.debt_refund((select id from public.debt_installments where plan = pg_temp.fx('bp')::text and seq = 3), '2026-04-01', 10.00);
select is(pg_temp.sqlstate_of($$select public.card_installment_edit(
         (select id from public.debt_installments where plan = pg_temp.fx('bp')::text and seq = 3), 20.00)$$),
          '55000', 'B5 parcela com cancelamento parcial: recusado');

-- B6: outra família não edita; edição direta na tabela continua barrada pelo banco
reset role;
select pg_temp.login(pg_temp.uid(120001));
select is(pg_temp.sqlstate_of($$select public.card_installment_edit(
         (select id from public.debt_installments where plan = pg_temp.fx('bp')::text and seq = 2), 40.00)$$),
          '42501', 'B6 editar parcela de outra família: recusado');
select is((select count(*) from public.debt_installment_edits), 0::bigint, 'B6 outra família não vê a trilha de edições');
reset role;
select is(pg_temp.sqlstate_of($$update public.debt_installments set face = 1 where plan = pg_temp.fx('bp')::text$$),
          '42501', 'B6 UPDATE direto de parcela continua barrado (parcela é imutável fora da RPC)');

-- =====================================================================================
-- C. Pagamento diferente da fatura: saldo anterior e adiantamento (c)
-- =====================================================================================
reset role;
select pg_temp.mk('c', 120005);
select public.card_purchase(pg_temp.fx('ccard'), '2026-03-01', 100.00, 1, pg_temp.fx('ccat'), 'Mercado');
select public.card_purchase(pg_temp.fx('ccard'), '2026-04-01', 80.00, 1, pg_temp.fx('ccat'), 'Roupa');
select is(public.card_bill_due('2026-04-30'), 2, 'C0 março e abril cobrados');

-- C1: pagamento parcial de março (60 de 100): o que faltou vira "saldo anterior" em abril
select public.debt_pay(pg_temp.fx('ccard'), '2026-03-25', pg_temp.fx('cbank'), 60.00, pg_temp.fat('c', '2026-03'));
select is((select array[total, paid, previous_open, advance_in, advance_out] from public.card_months(pg_temp.fx('ccard')) where label = '2026-03'),
          array[100, 60, 0, 0, 0]::numeric[], 'C1 março: total 100, pago 60');
select is((select array[total, paid, previous_open, advance_in, advance_out] from public.card_months(pg_temp.fx('ccard')) where label = '2026-04'),
          array[80, 0, 40, 0, 0]::numeric[], 'C1 abril: total 80, saldo anterior 40');

-- C2: pagamento maior que a fatura de abril (100 sobre 80): o excedente vira adiantamento
select public.debt_pay(pg_temp.fx('ccard'), '2026-04-25', pg_temp.fx('cbank'), 100.00, pg_temp.fat('c', '2026-04'));
select is((select array[total, paid, previous_open, advance_in, advance_out] from public.card_months(pg_temp.fx('ccard')) where label = '2026-04'),
          array[80, 80, 40, 0, 20]::numeric[], 'C2 abril: paga 80, saldo anterior 40, adiantamento de 20 sobra');
-- Regra mudou em 24/10/2026 (migration 010): pagamento COMUM de cartão acima da dívida agora vira crédito no cartão
-- (ver 17_card_prepayment). A amortização extra continua sem poder passar do saldo devedor, e é o que se confere aqui.
select is(pg_temp.sqlstate_of($$select public.debt_pay(pg_temp.fx('ccard'), '2026-04-26', pg_temp.fx('cbank'), 30.00, null, true)$$),
          '23514', 'C2 amortização extra acima da dívida total (restam 20): recusada');

-- C3: pagamento sem fatura (p_invoice nulo) abate as faturas mais antigas em aberto
select public.debt_pay(pg_temp.fx('ccard'), '2026-04-26', pg_temp.fx('cbank'), 20.00);
select is((select array[total, paid, previous_open, advance_in, advance_out] from public.card_months(pg_temp.fx('ccard')) where label = '2026-03'),
          array[100, 80, 0, 20, 0]::numeric[], 'C3 março: o pagamento avulso de 20 abate a fatura mais antiga (pago 80)');
select is((select array[total, paid, previous_open, advance_in, advance_out] from public.card_months(pg_temp.fx('ccard')) where label = '2026-04'),
          array[80, 80, 20, 0, 20]::numeric[], 'C3 abril: saldo anterior 20 (março), adiantamento 20');
select is((select debt from public.debt_balances(pg_temp.fx('ch'), '2099-12-31') where name = 'Cartão'),
          0::numeric, 'C3 dívida total do cartão = saldos anteriores 20 − adiantamento 20 = 0');

-- C4: amortização extra ligada à fatura também conta como paga
reset role;
select pg_temp.mk('d', 120006);
select public.card_purchase(pg_temp.fx('dcard'), '2026-03-01', 100.00, 1, pg_temp.fx('dcat'), 'Mercado');
select public.card_bill_due('2026-03-31');
select public.debt_pay(pg_temp.fx('dcard'), '2026-03-25', pg_temp.fx('dbank'), 100.00, pg_temp.fat('d', '2026-03'), true);
select is((select paid from public.card_months(pg_temp.fx('dcard')) where label = '2026-03'), 100.00::numeric,
          'C4 pagamento marcado como extra e ligado à fatura conta como pago');

-- C5: estorno depois de pago — o excedente pago vira adiantamento da fatura seguinte
reset role;
select pg_temp.mk('i', 120007);
select public.card_purchase(pg_temp.fx('icard'), '2026-03-01', 100.00, 1, pg_temp.fx('icat'), 'Mercado');
select public.card_purchase(pg_temp.fx('icard'), '2026-04-01', 80.00, 1, pg_temp.fx('icat'), 'Roupa');
select public.card_bill_due('2026-04-30');
select public.debt_pay(pg_temp.fx('icard'), '2026-03-25', pg_temp.fx('ibank'), 100.00, pg_temp.fat('i', '2026-03'));
select public.debt_refund((select installment_id from public.card_items(pg_temp.fx('icard'), '2026-03') limit 1), '2026-04-10', 100.00);
select is((select array[total, paid, previous_open, advance_in, advance_out] from public.card_months(pg_temp.fx('icard')) where label = '2026-03'),
          array[0, 0, 0, 0, 100]::numeric[], 'C5 março: total 0 após o estorno; os 100 pagos sobram como adiantamento');
select is((select array[total, paid, previous_open, advance_in, advance_out] from public.card_months(pg_temp.fx('icard')) where label = '2026-04'),
          array[80, 80, 0, 100, 20]::numeric[], 'C5 abril: o adiantamento paga os 80; sobram 20');
select is((select array[debt, credit_receivable] from public.net_worth(pg_temp.fx('ih'), '2099-12-31')),
          array[0, 20]::numeric[], 'C5 saldo real: crédito a receber de 20 (bate com o adiantamento)');

-- =====================================================================================
-- D. Abertura da conta x pagamentos de cartão (j)
-- =====================================================================================
reset role;
select pg_temp.mk('j', 120008);
select public.card_purchase(pg_temp.fx('jcard'), '2026-03-01', 100.00, 1, pg_temp.fx('jcat'), 'Mercado');
select public.card_bill_due('2026-03-31');
select public.debt_pay(pg_temp.fx('jcard'), '2026-03-25', pg_temp.fx('jbank'), 100.00, pg_temp.fat('j', '2026-03'));
select is(pg_temp.sqlstate_of($$update public.accounts set opening_date = '2026-04-01' where id = pg_temp.fx('jbank')$$),
          '23514', 'D1 mover a abertura da conta para depois de um pagamento de cartão: recusado');
select lives_ok($$update public.accounts set opening_date = '2026-03-25' where id = pg_temp.fx('jbank')$$,
                'D1 mover a abertura até a data do pagamento: permitido');
select is(pg_temp.banco('j'), 4900.00, 'D1 o pagamento continua descontado da conta');

-- =====================================================================================
-- E. Compra retroativa x devolução; uma falha não trava os outros cartões (e)
-- =====================================================================================
reset role;
select pg_temp.mk('e', 120009);
insert into fixture select 'ecard2', public.create_debt('Cartão 2', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('ecard2'), 17, 25);
insert into fixture select 'ep1', public.card_purchase(pg_temp.fx('ecard'), '2026-02-01', 100.00, 1, pg_temp.fx('ecat'), 'Compra A');
select public.card_bill_due('2026-02-28');
select public.debt_pay(pg_temp.fx('ecard'), '2026-02-25', pg_temp.fx('ebank'), 100.00, pg_temp.fat('e', '2026-02'));
select public.debt_refund((select id from public.debt_installments where plan = pg_temp.fx('ep1')::text), '2026-03-05', 100.00);
select public.debt_return(pg_temp.fx('ecard'), '2026-03-10', pg_temp.fx('ebank'), 100.00);
select is(pg_temp.sqlstate_of($$select public.card_purchase(pg_temp.fx('ecard'), '2026-02-01', 50.00, 1, pg_temp.fx('ecat'), 'Compra B')$$),
          '23514', 'E1 compra que fecharia antes de uma devolução já lançada: recusada na hora');
select lives_ok($$select public.card_purchase(pg_temp.fx('ecard'), '2026-03-20', 50.00, 1, pg_temp.fx('ecat'), 'Compra C')$$,
                'E1 compra que fecha depois da devolução: permitida');

-- parcela retroativa "plantada" por fora (legado) quebraria a cobrança de TODOS os cartões
select public.card_purchase(pg_temp.fx('ecard2'), '2026-03-01', 100.00, 1, pg_temp.fx('ecat'), 'Compra D');
reset role;
insert into public.debt_installments (household_id, debt_id, plan, seq, due_date, face, category_id)
values (pg_temp.fx('eh'), pg_temp.fx('ecard'), 'legado', 1, '2026-02-17', 50.00, pg_temp.fx('ecat'));
select pg_temp.login(pg_temp.uid(120009));
select lives_ok($$select public.card_bill_due('2026-03-31')$$,
                'E2 a cobrança automática não estoura quando um cartão tem parcela retroativa inconsistente');
select is((select count(*) from public.debt_events where debt_id = pg_temp.fx('ecard2') and kind = 'charge' and voided_at is null),
          1::bigint, 'E2 o outro cartão foi cobrado normalmente');
select is((select count(*) from public.debt_events e join public.debt_installments i on i.id = e.installment_id
            where i.plan = 'legado' and e.voided_at is null),
          0::bigint, 'E2 a parcela inconsistente ficou sem cobrança (nada pela metade)');

-- =====================================================================================
-- F. O ciclo vale por parcela: mudar o dia de fechamento não mexe no que já foi comprado (h)
-- =====================================================================================
reset role;
select pg_temp.mk('h', 120010);
select public.card_purchase(pg_temp.fx('hcard'), '2026-02-10', 100.00, 2, pg_temp.fx('hcat'), 'Fone');
select public.set_card_cycle(pg_temp.fx('hcard'), 5, 12);
-- a troca vale a partir do ciclo seguinte ao da fatura aberta hoje (migration 061): compra bem no futuro, já no ciclo novo
-- (uma compra retroativa, de antes da troca, fica com os dias antigos: teste 59)
select public.card_purchase(pg_temp.fx('hcard'), '2030-04-20', 40.00, 1, pg_temp.fx('hcat'), 'Livro');
select is((select array_agg(description || '|' || closing_day || '|' || due_day order by description)
             from (select distinct description, closing_day, due_day from public.debt_installments
                    where debt_id = pg_temp.fx('hcard')) x),
          array['Fone|17|25', 'Livro|5|12'], 'F1 cada parcela guarda o ciclo da época da compra');
select is(public.card_bill_due('2026-03-31'), 2, 'F2 as 2 parcelas do Fone cobradas (fechamentos 17/02 e 17/03)');
select is((select array_agg(label || '|' || due_date order by label) from public.debt_invoices where debt_id = pg_temp.fx('hcard')),
          array['2026-02|2026-02-25', '2026-03|2026-03-25'],
          'F2 vencimentos pelo ciclo antigo (17/25), não pelo novo (5/12): nunca antes do fechamento');
select is((select array_agg(label || '|' || due_date order by label) from public.card_months(pg_temp.fx('hcard')) where label <= '2026-03'),
          array['2026-02|2026-02-25', '2026-03|2026-03-25'], 'F2 o relatório mostra os mesmos vencimentos');

-- =====================================================================================
-- G. Idempotência: clique duplo / repetição por falha de rede (k)
-- =====================================================================================
reset role;
select pg_temp.mk('k', 120011);
insert into fixture values ('kid1', '00000000-0000-0000-0000-00000000aa01'), ('kid2', '00000000-0000-0000-0000-00000000aa02'),
                           ('kid3', '00000000-0000-0000-0000-00000000aa03');
insert into fixture select 'kp1', public.card_purchase(pg_temp.fx('kcard'), '2026-03-15', 300.00, 3, pg_temp.fx('kcat'), 'TV', pg_temp.fx('kid1'));
insert into fixture select 'kp2', public.card_purchase(pg_temp.fx('kcard'), '2026-03-15', 300.00, 3, pg_temp.fx('kcat'), 'TV', pg_temp.fx('kid1'));
select is(pg_temp.fx('kp2'), pg_temp.fx('kp1'), 'G1 repetir a mesma compra (mesma chave) devolve a mesma compra');
select is((select count(*) from public.debt_installments where debt_id = pg_temp.fx('kcard')), 3::bigint,
          'G1 continuam 3 parcelas (não duplicou)');
select lives_ok($$select public.card_purchase(pg_temp.fx('kcard'), '2026-03-15', 300.00, 3, pg_temp.fx('kcat'), 'TV', pg_temp.fx('kid2'))$$,
                'G1 outra chave = outra compra');
select is((select count(*) from public.debt_installments where debt_id = pg_temp.fx('kcard')), 6::bigint, 'G1 agora 6 parcelas');
select public.card_bill_due('2026-03-31');
insert into fixture select 'kpay1', public.debt_pay(pg_temp.fx('kcard'), '2026-03-25', pg_temp.fx('kbank'), 100.00,
       pg_temp.fat('k', '2026-03'), false, pg_temp.fx('kid3'));
insert into fixture select 'kpay2', public.debt_pay(pg_temp.fx('kcard'), '2026-03-25', pg_temp.fx('kbank'), 100.00,
       pg_temp.fat('k', '2026-03'), false, pg_temp.fx('kid3'));
select is(pg_temp.fx('kpay2'), pg_temp.fx('kpay1'), 'G2 repetir o mesmo pagamento (mesma chave) devolve o mesmo evento');
select is(pg_temp.banco('k'), 4900.00, 'G2 a conta foi debitada uma única vez');

-- =====================================================================================
-- H. Trilha de edições: só leitura para o cliente (l)
-- =====================================================================================
reset role;
select is((select has_table_privilege('authenticated', 'public.debt_installment_edits', 'SELECT')), true,
          'H1 authenticated lê a trilha de edições (pela RLS)');
select is_empty($$select p from unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) p
                   where has_table_privilege('authenticated', 'public.debt_installment_edits', p)
                      or (p in ('INSERT','UPDATE')
                          and has_any_column_privilege('authenticated', 'public.debt_installment_edits', p))$$,
              'H1 authenticated não escreve na trilha de edições (só via RPC)');

select * from finish();
rollback;
