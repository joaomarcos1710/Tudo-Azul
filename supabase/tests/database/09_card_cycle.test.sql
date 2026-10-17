-- 09_card_cycle: migration 004. Ciclo do cartão (fechamento/vencimento), compra parcelada com a data
-- de fechamento de cada parcela, cobrança automática idempotente e isolamento entre famílias.
-- Datas no passado (2026-01 a 2026-06): card_bill_due nunca cobra além de hoje.
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
grant execute on function pg_temp.fx(text), pg_temp.sqlstate_of(text), pg_temp.parcelas(uuid) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000009a1', 'c1@teste.com'),
  ('00000000-0000-0000-0000-0000000009a2', 'c2@teste.com');

-- ---- cenário: família 1 com banco e cartão (fecha dia 17, vence dia 25) ----
select pg_temp.login('00000000-0000-0000-0000-0000000009a1');
insert into fixture select 'h', public.create_household('Casa Cartão');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 5000, '2026-01-01') returning id)
  insert into fixture select 'bank', id from i;
insert into fixture select 'cat', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';
insert into fixture select 'card', public.create_debt('Nubank', 'card', '2026-01-01', 0);
insert into fixture select 'loan', public.create_debt('Empréstimo', 'loan', '2026-01-01', 0);

-- C1: sem ciclo definido, a compra é recusada com orientação
select is(pg_temp.sqlstate_of($$select public.card_purchase(pg_temp.fx('card'), '2026-03-15', 300.00, 3, pg_temp.fx('cat'), 'TV')$$),
          '55000', 'C1 compra antes de definir fechamento/vencimento: recusada (55000)');

-- C2: ciclo só em cartão e com dias válidos
select is(pg_temp.sqlstate_of($$select public.set_card_cycle(pg_temp.fx('loan'), 17, 25)$$),
          '23514', 'C2 ciclo em empréstimo: recusado');
select is(pg_temp.sqlstate_of($$select public.set_card_cycle(pg_temp.fx('card'), 0, 25)$$),
          '22023', 'C2 dia de fechamento 0: recusado');
select is(pg_temp.sqlstate_of($$select public.set_card_cycle(pg_temp.fx('card'), 17, 32)$$),
          '22023', 'C2 dia de vencimento 32: recusado');
select lives_ok($$select public.set_card_cycle(pg_temp.fx('card'), 17, 25)$$, 'C2 ciclo 17/25 definido');
select is((select array[closing_day, due_day]::int[] from public.debts where id = pg_temp.fx('card')),
          array[17, 25], 'C2 ciclo gravado');

-- C3: o exemplo da decisão — compra dia 15, fecha dia 17: 1ª parcela neste mês, as outras nos seguintes
insert into fixture select 'p1', public.card_purchase(pg_temp.fx('card'), '2026-03-15', 300.00, 3, pg_temp.fx('cat'), 'TV');
select is(pg_temp.parcelas(pg_temp.fx('p1')), '1:2026-03-17:100.00 2:2026-04-17:100.00 3:2026-05-17:100.00',
          'C3 compra dia 15 com fechamento dia 17: parcelas em 17/03, 17/04 e 17/05');
select is((select array_agg(distinct description || '|' || purchase_date) from public.debt_installments where plan = pg_temp.fx('p1')::text),
          array['TV|2026-03-15'], 'C3 descrição e data da compra gravadas em todas as parcelas');

-- C4: compra no dia do fechamento (ou depois) vai para a fatura seguinte
insert into fixture select 'p2', public.card_purchase(pg_temp.fx('card'), '2026-03-17', 50.00, 1, pg_temp.fx('cat'), 'Mercado');
select is(pg_temp.parcelas(pg_temp.fx('p2')), '1:2026-04-17:50.00', 'C4 compra no dia 17 (fechamento): fatura de abril');
insert into fixture select 'p3', public.card_purchase(pg_temp.fx('card'), '2026-03-20', 80.00, 1, pg_temp.fx('cat'), 'Farmácia');
select is(pg_temp.parcelas(pg_temp.fx('p3')), '1:2026-04-17:80.00', 'C4 compra dia 20: fatura de abril');

-- C5: centavos que sobram ficam na 1ª parcela; o total bate exatamente
insert into fixture select 'p4', public.card_purchase(pg_temp.fx('card'), '2026-03-01', 100.00, 3, pg_temp.fx('cat'), 'Curso');
select is(pg_temp.parcelas(pg_temp.fx('p4')), '1:2026-03-17:33.34 2:2026-04-17:33.33 3:2026-05-17:33.33',
          'C5 100,00 em 3x = 33,34 + 33,33 + 33,33');

-- C6: validações da compra
select is(pg_temp.sqlstate_of($$select public.card_purchase(pg_temp.fx('card'), '2026-03-15', 0, 1, pg_temp.fx('cat'), 'x')$$),
          '22023', 'C6 valor zero: recusado');
select is(pg_temp.sqlstate_of($$select public.card_purchase(pg_temp.fx('card'), '2026-03-15', 10.001, 1, pg_temp.fx('cat'), 'x')$$),
          '22003', 'C6 mais de 2 casas decimais: recusado');
select is(pg_temp.sqlstate_of($$select public.card_purchase(pg_temp.fx('card'), '2026-03-15', 0.02, 3, pg_temp.fx('cat'), 'x')$$),
          '22023', 'C6 valor menor que 1 centavo por parcela: recusado');
select is(pg_temp.sqlstate_of($$select public.card_purchase(pg_temp.fx('card'), '2026-03-15', 10.00, 73, pg_temp.fx('cat'), 'x')$$),
          '22023', 'C6 mais de 72 parcelas: recusado');
select is(pg_temp.sqlstate_of($$select public.card_purchase(pg_temp.fx('card'), '2026-01-01', 10.00, 1, pg_temp.fx('cat'), 'x')$$),
          '23514', 'C6 compra na data de referência do cartão: recusada');
select is(pg_temp.sqlstate_of($$select public.card_purchase(pg_temp.fx('loan'), '2026-03-15', 10.00, 1, pg_temp.fx('cat'), 'x')$$),
          '23514', 'C6 compra em empréstimo: recusada');

-- C7: antes do fechamento é compromisso (planejado no mês do fechamento), não despesa
select is((select array[expense_paid, expense_planned] from public.period_summary(pg_temp.fx('h'), '2026-03-01', '2026-03-31')),
          array[0, 133.34]::numeric[], 'C7 março antes da cobrança: despesa 0, planejado 100,00 + 33,34');

-- C8: cobrança até 16/03 não cobra nada (fechamento é dia 17)
select is(public.card_bill_due('2026-03-16'), 0, 'C8 até 16/03: nenhuma parcela fechou');

-- C9: cobrança até 17/03 cobra as duas parcelas de março, na data do fechamento, na fatura 2026-03
select is(public.card_bill_due('2026-03-17'), 2, 'C9 até 17/03: 2 cobranças (TV 1/3 e Curso 1/3)');
select is((select array[expense_paid, expense_planned] from public.period_summary(pg_temp.fx('h'), '2026-03-01', '2026-03-31')),
          array[133.34, 0]::numeric[], 'C9 março: vira despesa 133,34 e sai do planejado');
select is((select array_agg(distinct e.date::text || '|' || inv.label || '|' || inv.due_date)
             from public.debt_events e join public.debt_invoices inv on inv.id = e.invoice_id
            where e.debt_id = pg_temp.fx('card') and e.kind = 'charge'),
          array['2026-03-17|2026-03|2026-03-25'], 'C9 cobrança datada no fechamento, fatura 2026-03 vencendo 25/03');
select is((select array[debt, planned_remaining] from public.debt_balances(pg_temp.fx('h'), '2026-03-17') where name = 'Nubank'),
          array[133.34, 396.66]::numeric[], 'C9 dívida 133,34 e compromissos 396,66 (total 530,00, sem dupla contagem)');

-- C10: idempotente — chamar de novo não duplica
select is(public.card_bill_due('2026-03-31'), 0, 'C10 segunda chamada: nenhuma cobrança nova');
select is((select count(*) from public.debt_events where debt_id = pg_temp.fx('card') and kind = 'charge'),
          2::bigint, 'C10 continuam 2 cobranças');

-- C11: pagar a fatura sai da conta e zera a dívida, sem ser despesa
select lives_ok($$select public.debt_pay(pg_temp.fx('card'), '2026-03-25', pg_temp.fx('bank'), 133.34,
                  (select id from public.debt_invoices where debt_id = pg_temp.fx('card') and label = '2026-03'))$$,
                'C11 pagamento da fatura de março');
select is((select array[available, debt] from public.net_worth(pg_temp.fx('h'), '2026-03-31')),
          array[4866.66, 0]::numeric[], 'C11 conta 5000 − 133,34; dívida zerada');
select is((select expense_paid from public.period_summary(pg_temp.fx('h'), '2026-03-01', '2026-03-31')),
          133.34, 'C11 pagamento não soma despesa de novo');

-- C12: o mês seguinte, de uma vez (várias compras na mesma fatura)
select is(public.card_bill_due('2026-04-30'), 4, 'C12 abril: TV 2/3, Curso 2/3, Mercado e Farmácia');
select is((select count(*) from public.debt_invoices where debt_id = pg_temp.fx('card')), 2::bigint,
          'C12 uma fatura por mês (2026-03 e 2026-04)');

-- C13: estorno antes do fechamento cancela a parcela; a cobrança automática não a cobra
select lives_ok($$select public.debt_refund((select id from public.debt_installments where plan = pg_temp.fx('p1')::text and seq = 3), '2026-05-10', 100.00)$$,
                'C13 estorno da 3ª parcela da TV antes do fechamento');
select is(public.card_bill_due('2026-05-31'), 1, 'C13 maio: só o Curso 3/3 é cobrado');

-- C14: nunca cobra além de hoje (data futura é limitada a hoje)
insert into fixture select 'p5', public.card_purchase(pg_temp.fx('card'), '2026-05-20', 60.00, 2, pg_temp.fx('cat'), 'Tênis');
select is(public.card_bill_due('2099-12-31'),
          (select count(*)::int from public.debt_installments
            where plan = pg_temp.fx('p5')::text and due_date <= (now() at time zone 'America/Sao_Paulo')::date),
          'C14 só cobra parcelas cujo fechamento já passou');
select is((select count(*) from public.debt_events
            where debt_id = pg_temp.fx('card') and kind = 'charge'
              and date > (now() at time zone 'America/Sao_Paulo')::date), 0::bigint,
          'C14 nenhuma cobrança com data futura');

-- C15: mês curto — fecha dia 31 cai no último dia do mês
insert into fixture select 'card31', public.create_debt('Cartão 31', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('card31'), 31, 10);
insert into fixture select 'p6', public.card_purchase(pg_temp.fx('card31'), '2026-01-31', 90.00, 3, pg_temp.fx('cat'), 'Fone');
select is(pg_temp.parcelas(pg_temp.fx('p6')), '1:2026-02-28:30.00 2:2026-03-31:30.00 3:2026-04-30:30.00',
          'C15 fechamento 31: 28/02, 31/03, 30/04');
select is(public.card_bill_due('2026-02-28'), 1, 'C15 cobrança em 28/02');
select is((select due_date from public.debt_invoices where debt_id = pg_temp.fx('card31') and label = '2026-02'),
          '2026-03-10'::date, 'C15 vencimento (dia 10) no mês seguinte ao fechamento (dia 31)');

-- C16: isolamento — outra família não vê, não compra nem cobra no cartão alheio
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000009a2');
insert into fixture select 'h2', public.create_household('Outra Casa');
insert into fixture select 'cat2', id from public.categories where household_id = pg_temp.fx('h2') and name = 'Compras pessoais';
select is(pg_temp.sqlstate_of($$select public.set_card_cycle(pg_temp.fx('card'), 5, 15)$$),
          '42501', 'C16 outra família não muda o ciclo');
select is(pg_temp.sqlstate_of($$select public.card_purchase(pg_temp.fx('card'), '2026-03-15', 10.00, 1, pg_temp.fx('cat2'), 'x')$$),
          '42501', 'C16 outra família não compra no cartão');
select is(public.card_bill_due('2026-06-30'), 0, 'C16 cobrança da outra família não toca no cartão alheio');
select is((select count(*) from public.debt_installments where debt_id = pg_temp.fx('card')), 0::bigint,
          'C16 outra família não vê as parcelas');

-- C17: cliente não altera o ciclo direto na tabela
select is(pg_temp.sqlstate_of($$update public.debts set closing_day = 1 where id = pg_temp.fx('card')$$),
          '42501', 'C17 UPDATE direto em debts: sem privilégio');

select * from finish();
rollback;
