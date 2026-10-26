-- 21_audit_fixes: migration 014. Correções da auditoria (B1 saldo de referência do cartão, categoria mãe de si mesma,
-- debt_void/debt_pay entre dívidas, conta desativada em evento de dívida, tamanho de nome, delete de conta).
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
create function pg_temp.mes(p_debt uuid, p_label text) returns text language sql as $f$
  select paid::numeric(14,2) || '|' || previous_open::numeric(14,2) || '|' || advance_in::numeric(14,2) || '|' || advance_out::numeric(14,2)
    from public.card_months(p_debt) where label = p_label $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.sqlstate_of(text), pg_temp.mes(uuid, text) to public;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000021a1', 'a1@teste.com');
select pg_temp.login('00000000-0000-0000-0000-0000000021a1');
insert into fixture select 'h', public.create_household('Casa da Auditoria');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 5000.00, '2026-01-01') returning id)
  insert into fixture select 'bank', id from i;
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Outro banco', 'checking', 1000.00, '2026-01-01') returning id)
  insert into fixture select 'bank2', id from i;
insert into fixture select 'cat', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';

-- B1: cartão criado com saldo de referência 500; fatura de março (100) paga com 600 ligados a ela
insert into fixture select 'a', public.create_debt('Cartão A', 'card', '2026-02-28', 500);
select public.set_card_cycle(pg_temp.fx('a'), 15, 25);
select public.card_purchase(pg_temp.fx('a'), '2026-03-01', 100.00, 1, pg_temp.fx('cat'), 'Compra março');
select public.card_bill_due('2026-03-31');
insert into fixture select 'inv_a', invoice_id from public.card_months(pg_temp.fx('a')) where label = '2026-03';
select public.debt_pay(pg_temp.fx('a'), '2026-03-20', pg_temp.fx('bank'), 600.00, pg_temp.fx('inv_a'));
select public.card_purchase(pg_temp.fx('a'), '2026-04-01', 80.00, 1, pg_temp.fx('cat'), 'Compra abril');
select public.card_bill_due('2026-04-30');
select is(pg_temp.mes(pg_temp.fx('a'), '2026-03'), '100.00|500.00|0.00|0.00',
          'B1.1 março: paga 100; os 500 do saldo de referência aparecem como anterior em aberto e a sobra os quita (sem adiantamento fantasma)');
select is(pg_temp.mes(pg_temp.fx('a'), '2026-04'), '0.00|0.00|0.00|0.00',
          'B1.2 abril (80) NÃO aparece como paga: nada sobrou para adiantamento');
select is((select debt from public.debt_balances(pg_temp.fx('h'), '2026-04-30') where debt_id = pg_temp.fx('a')), 80.00::numeric,
          'B1.3 a dívida em debt_balances continua 80 (concorda com a fatura de abril em aberto)');

-- E1: pagamento de 500 sem fatura antes da compra; o saldo de referência de 500 é quitado, a fatura de 100 não
insert into fixture select 'b', public.create_debt('Cartão B', 'card', '2026-02-28', 500);
select public.set_card_cycle(pg_temp.fx('b'), 15, 25);
select public.debt_pay(pg_temp.fx('b'), '2026-03-05', pg_temp.fx('bank'), 500.00);
select public.card_purchase(pg_temp.fx('b'), '2026-03-20', 100.00, 1, pg_temp.fx('cat'), 'Compra B');
select public.card_bill_due('2026-04-30');
select is(pg_temp.mes(pg_temp.fx('b'), '2026-04'), '0.00|0.00|0.00|0.00',
          'E1 pagar 500 sem fatura quita o saldo de referência; a fatura nova de 100 segue em aberto');

-- A2: mesma chave de idempotência em duas dívidas é recusada; anular um pagamento não anula o outro
insert into fixture select 'loan', public.create_debt('Empréstimo', 'loan', '2026-02-28', 1000);
select public.debt_pay(pg_temp.fx('loan'), '2026-03-10', pg_temp.fx('bank'), 100.00, null, false, '00000000-0000-0000-0000-00000000aaaa');
select is(pg_temp.sqlstate_of(format($q$select public.debt_pay(%L, '2026-03-10', %L, 10.00, null, false, '00000000-0000-0000-0000-00000000aaaa')$q$,
            pg_temp.fx('a'), pg_temp.fx('bank'))), '22023', 'A2.1 chave de outra dívida é recusada (22023)');
select is(public.debt_void((select id from public.debt_events where debt_id = pg_temp.fx('loan') and kind = 'payment'), 'teste de anulação'), 1,
          'A2.2 debt_void anula só o evento da própria dívida');
select is(pg_temp.sqlstate_of(format($q$select public.debt_void(%L, 'segunda vez')$q$,
            (select id from public.debt_events where debt_id = pg_temp.fx('loan') and kind = 'payment'))), '55000',
          'A5 anular de novo dá 55000 (evento já anulado)');

-- A3: conta desativada não recebe evento de dívida novo
select public.debt_pay(pg_temp.fx('loan'), '2026-03-11', pg_temp.fx('bank2'), 10.00);
update public.accounts set active = false where id = pg_temp.fx('bank2');
select is(pg_temp.sqlstate_of(format($q$select public.debt_pay(%L, '2026-03-12', %L, 10.00)$q$, pg_temp.fx('loan'), pg_temp.fx('bank2'))),
          '23514', 'A3 pagamento a partir de conta desativada é recusado (23514)');

-- A1: categoria não é mãe de si mesma
with i as (insert into public.categories (household_id, name, type) values (pg_temp.fx('h'), 'Solta', 'expense') returning id)
  insert into fixture select 'solta', id from i;
select is(pg_temp.sqlstate_of(format($q$update public.categories set parent_id = id where id = %L$q$, pg_temp.fx('solta'))),
          '23514', 'A1 parent_id = id é recusado (23514)');

-- A4: nome com limite bruto de tamanho
select is(pg_temp.sqlstate_of(format($q$insert into public.categories (household_id, name, type) values (%L, repeat(' ', 200) || 'x', 'expense')$q$, pg_temp.fx('h'))),
          '23514', 'A4.1 categoria com nome de 201 caracteres é recusada');
select is(pg_temp.sqlstate_of(format($q$insert into public.accounts (household_id, name, type, initial_balance, opening_date) values (%L, repeat(' ', 200) || 'x', 'checking', 0, '2026-01-01')$q$, pg_temp.fx('h'))),
          '23514', 'A4.2 conta com nome de 201 caracteres é recusada');

-- A6: a API não apaga conta
select is(pg_temp.sqlstate_of(format($q$delete from public.accounts where id = %L$q$, pg_temp.fx('bank2'))),
          '42501', 'A6 delete direto em accounts é negado (42501)');

select * from finish();
rollback;
