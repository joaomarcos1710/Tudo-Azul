-- 139_card_start_and_paid_invoice: recuar o início do cartão (card_set_start) NÃO altera fatura fechada e paga.
-- Saneamento das pendências (#458, 21/11/2026) levantou como risco: card_set_start e set_card_cycle não passam pela trava
-- de fatura paga (card_paid_snapshot). Este teste fixa o que acontece de fato: o total e o pago da fatura travada e o saldo
-- da conta não mudam; o saldo inicial novo aparece só como "saldo anterior" e na dívida histórica (é o propósito da função).
-- Sem mudança de código: é teste de caracterização. Se um dia a função passar a mexer na fatura paga, ele falha.
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

insert into auth.users (id, email) select pg_temp.uid(n), 'cs' || n || '@teste.com' from generate_series(139001, 139001) n;
create function pg_temp.mar(p_tag text) returns text language sql as $f$
  select charged || '|' || pending || '|' || total || '|' || paid || '|' || previous_open
    from public.card_months(pg_temp.fx(p_tag || 'card')) where label = '2026-03' $f$;
grant execute on function pg_temp.mar(text) to public;

select pg_temp.mk('a', 139001);
insert into fixture select 'ap', public.card_purchase(pg_temp.fx('acard'), '2026-03-01', 100.00, 1, pg_temp.fx('acat'), 'TV');
select is(public.card_bill_due('2026-03-31'), 1, 'A0 março cobrado');
select lives_ok($$select public.debt_pay(pg_temp.fx('acard'), '2026-03-25', pg_temp.fx('abank'), 100.00, pg_temp.fat('a', '2026-03'))$$,
                'A0 março pago inteiro (fatura fechada e paga: travada)');
select is(pg_temp.mar('a'), '100.00|0.00|100.00|100.00|0', 'A0 março: cobrado 100, total 100, pago 100, sem saldo anterior');
select is(pg_temp.banco('a'), 4900.00, 'A0 conta: 5000 − 100');
select is(pg_temp.sqlstate_of($$select public.card_installment_edit(
            (select id from public.debt_installments where plan = pg_temp.fx('ap')::text and seq = 1), 90.00)$$),
          '55000', 'A0 a fatura de março está travada (editar a parcela é recusado)');

select lives_ok($$select public.card_set_start(pg_temp.fx('acard'), '2025-12-01', 500.00)$$,
                'A1 recuar o início com saldo inicial de 500 é aceito mesmo com fatura paga');
select is(pg_temp.mar('a'), '100.00|0.00|100.00|100.00|500.00',
          'A1 a fatura paga não muda (cobrado, total e pago iguais); os 500 entram só como saldo anterior');
select is(pg_temp.banco('a'), 4900.00, 'A1 o saldo da conta não muda');
select is((select debt from public.debt_balances(pg_temp.fx('ah'), '2026-03-31') where name = 'Cartão'), 500.00,
          'A1 a dívida histórica passa a mostrar o saldo inicial (efeito esperado da função)');
select is(pg_temp.sqlstate_of($$select public.card_installment_edit(
            (select id from public.debt_installments where plan = pg_temp.fx('ap')::text and seq = 1), 90.00)$$),
          '55000', 'A2 a fatura de março continua travada depois da mudança (editar a parcela é recusado)');
select is(pg_temp.mar('a'), '100.00|0.00|100.00|100.00|500.00', 'A2 a recusa não deixou rastro na fatura');

select * from finish();
rollback;
