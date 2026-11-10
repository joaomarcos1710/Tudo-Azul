-- 96_debt_extra_without_account: migration 102. Amortização extra de empréstimo/financiamento sem conta (ex.: FGTS):
-- só o saldo da dívida cai; nenhuma conta muda; não é despesa nem saída no fluxo de caixa.
-- Datas fixas no passado (outubro de 2026); debt_record_payment não depende do relógio para empréstimo/financiamento.
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
create function pg_temp.divida(p_k text) returns numeric language sql as $f$
  select debt from public.debt_balances(pg_temp.fx('h'), date '2026-10-31') where debt_id = pg_temp.fx(p_k) $f$;
create function pg_temp.saldo(p_k text) returns numeric language sql as $f$
  select balance from public.account_balances(pg_temp.fx('h'), date '2026-10-31') where account_id = pg_temp.fx(p_k) $f$;
-- todas as contas da família, como texto ordenado: compara "antes" e "depois" de uma vez
create function pg_temp.contas() returns text language sql as $f$
  select string_agg(account_id::text || '=' || balance::text, ';' order by account_id)
    from public.account_balances(pg_temp.fx('h'), date '2026-10-31') $f$;
create function pg_temp.despesa_mes() returns numeric language sql as $f$
  select expense_paid from public.period_summary(pg_temp.fx('h'), date '2026-10-01', date '2026-10-31') $f$;
create function pg_temp.resultado_mes() returns numeric language sql as $f$
  select result from public.period_summary(pg_temp.fx('h'), date '2026-10-01', date '2026-10-31') $f$;
create function pg_temp.fluxo_saida() returns numeric language sql as $f$
  select max(total_expense) from public.cash_flow_series(pg_temp.fx('h'), date '2026-10-01', date '2026-10-31', 'month') $f$;
create function pg_temp.fluxo_saldo() returns numeric language sql as $f$
  select max(closing_balance) from public.cash_flow_series(pg_temp.fx('h'), date '2026-10-01', date '2026-10-31', 'month') $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.sqlstate_of(text), pg_temp.divida(text),
  pg_temp.saldo(text), pg_temp.contas(), pg_temp.despesa_mes(), pg_temp.resultado_mes(), pg_temp.fluxo_saida(),
  pg_temp.fluxo_saldo() to public;
create temp table antes (k text primary key, t text, n numeric);
grant all on antes to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000096a1', 'fgts1@teste.com'),
  ('00000000-0000-0000-0000-0000000096a2', 'fgts2@teste.com');

-- Família 1: conta corrente, conta arquivada, financiamento e cartão
select pg_temp.login('00000000-0000-0000-0000-0000000096a1');
insert into fixture select 'h', public.create_household('Casa FGTS');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Corrente', 'checking', 10000, date '2026-01-01') returning id)
  insert into fixture select 'conta', id from i;
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Antiga', 'checking', 500, date '2026-01-01') returning id)
  insert into fixture select 'arquivada', id from i;
update public.accounts set active = false where id = pg_temp.fx('arquivada');
insert into fixture select 'juros', id from public.categories
 where household_id = pg_temp.fx('h') and name = 'Impostos e taxas' and type = 'expense';
insert into fixture select 'imovel', public.create_debt('Imóvel', 'financing', date '2026-09-01', 100000);
insert into fixture select 'cartao', public.create_debt('Cartão', 'card', date '2026-09-01', 0);
-- uma despesa comum no mês, para os relatórios não estarem zerados
insert into public.transactions (household_id, account_id, category_id, type, amount, date, status, description)
values (pg_temp.fx('h'), pg_temp.fx('conta'), pg_temp.fx('juros'), 'expense', 150, date '2026-10-05', 'paid', 'Mercado');

select is((select active from public.accounts where id = pg_temp.fx('arquivada')), false, 'F0 conta Antiga arquivada');
select is(pg_temp.divida('imovel'), 100000::numeric, 'F1 financiamento começa em 100.000');
select is(pg_temp.despesa_mes(), 150::numeric, 'F2 despesa de outubro antes: 150');

insert into antes values
  ('contas', pg_temp.contas(), null),
  ('despesa', null, pg_temp.despesa_mes()),
  ('resultado', null, pg_temp.resultado_mes()),
  ('fluxo_saida', null, pg_temp.fluxo_saida()),
  ('fluxo_saldo', null, pg_temp.fluxo_saldo());

-- ---------------------------------------------------------------------------
-- 1. Caso feliz: amortização extra de 30.000,55 com FGTS, sem conta
-- ---------------------------------------------------------------------------
select lives_ok($$select public.debt_record_payment(pg_temp.fx('imovel'), date '2026-10-10', null, 30000.55, 0, 0, null, true)$$,
  'S1 amortização extra sem conta é aceita');
select is(pg_temp.divida('imovel'), 69999.45::numeric, 'S2 saldo do financiamento cai exatamente 30.000,55');
select is((select count(*) from public.debt_events
            where debt_id = pg_temp.fx('imovel') and kind = 'extra_principal' and account_id is null
              and amount = 30000.55 and date = '2026-10-10' and voided_at is null
              and note = 'amortização extra sem conta (ex.: FGTS)'), 1::bigint,
  'S3 um único evento extra_principal, sem conta, com a nota do FGTS');
select is((select count(*) from public.debt_events where debt_id = pg_temp.fx('imovel')), 1::bigint,
  'S3.1 nenhum evento de juros ou tarifa junto');
select is(pg_temp.contas(), (select t from antes where k = 'contas'), 'S4 nenhuma conta muda de saldo');
select is(pg_temp.saldo('conta'), 9850::numeric, 'S4.1 Corrente: 10.000 − 150 de mercado, e só');
select is((select count(*) from public.account_movements(pg_temp.fx('conta'), date '2026-10-31')
            where description like '%Imóvel%'), 0::bigint,
  'S4.2 extrato da conta não mostra a amortização');
select is(pg_temp.despesa_mes(), (select n from antes where k = 'despesa'), 'S5 period_summary: despesa do mês não muda');
select is(pg_temp.resultado_mes(), (select n from antes where k = 'resultado'), 'S5.1 period_summary: resultado do mês não muda');
select is((select coalesce(sum(amount), 0) from public.expenses_by_category(pg_temp.fx('h'), date '2026-10-01', date '2026-10-31')),
  150::numeric, 'S5.2 despesas por categoria: só o mercado');
select is(pg_temp.fluxo_saida(), (select n from antes where k = 'fluxo_saida'), 'S6 cash_flow_series: saída do mês não muda');
select is(pg_temp.fluxo_saldo(), (select n from antes where k = 'fluxo_saldo'), 'S6.1 cash_flow_series: saldo final não muda');

-- ---------------------------------------------------------------------------
-- 2. Chamar de novo: é outro pagamento (soma), e acima do saldo é recusado sem efeito
-- ---------------------------------------------------------------------------
select lives_ok($$select public.debt_record_payment(pg_temp.fx('imovel'), date '2026-10-11', null, 9999.45, 0, 0, null, true)$$,
  'I1 segunda amortização sem conta é aceita');
select is(pg_temp.divida('imovel'), 60000::numeric, 'I2 saldo cai de novo pelo valor exato (60.000)');
select is(pg_temp.sqlstate_of($$select public.debt_record_payment(pg_temp.fx('imovel'), date '2026-10-12', null, 60000.01, 0, 0, null, true)$$),
  '23514', 'I3 amortização sem conta acima do saldo devedor: recusada');
select is(pg_temp.divida('imovel'), 60000::numeric, 'I4 recusa não muda o saldo');
select is(pg_temp.contas(), (select t from antes where k = 'contas'), 'I5 contas continuam iguais');

-- ---------------------------------------------------------------------------
-- 3. Validações: conta nula só para amortização extra pura de empréstimo/financiamento
-- ---------------------------------------------------------------------------
select is(pg_temp.sqlstate_of(format($$select public.debt_record_payment(%L::uuid, date '2026-10-12', null, 100, 10, 0, %L::uuid, true)$$,
  pg_temp.fx('imovel'), pg_temp.fx('juros'))), '22023', 'V1 sem conta + juros: recusado');
select is(pg_temp.sqlstate_of(format($$select public.debt_record_payment(%L::uuid, date '2026-10-12', null, 100, 0, 5, %L::uuid, true)$$,
  pg_temp.fx('imovel'), pg_temp.fx('juros'))), '22023', 'V2 sem conta + tarifa: recusado');
select is(pg_temp.sqlstate_of($$select public.debt_record_payment(pg_temp.fx('imovel'), date '2026-10-12', null, 100, 0, 0, null, false)$$),
  '22023', 'V3 sem conta e p_extra = false: recusado');
select is(pg_temp.sqlstate_of($$select public.debt_record_payment(pg_temp.fx('imovel'), date '2026-10-12', null, 100, 0, 0, null, null)$$),
  '22023', 'V3.1 sem conta e p_extra nulo: recusado');
select is(pg_temp.sqlstate_of($$select public.debt_record_payment(pg_temp.fx('imovel'), date '2026-10-12', null, 0, 0, 0, null, true)$$),
  '22023', 'V4 sem conta e valor zero: recusado');
select is(pg_temp.sqlstate_of($$select public.debt_record_payment(pg_temp.fx('imovel'), date '2026-10-12', null, 10.001, 0, 0, null, true)$$),
  '22003', 'V5 sem conta e 3 casas decimais: recusado');
select is(pg_temp.sqlstate_of($$select public.debt_record_payment(pg_temp.fx('imovel'), date '2026-09-01', null, 10, 0, 0, null, true)$$),
  '23514', 'V6 sem conta na data de referência da dívida: recusado (regra de sempre)');
select is(pg_temp.sqlstate_of($$select public.debt_record_payment(pg_temp.fx('cartao'), date '2026-10-12', null, 10, 0, 0, null, true)$$),
  '22023', 'V7 cartão sem conta: recusado (no cartão o pagamento é caixa)');
select is(pg_temp.divida('imovel'), 60000::numeric, 'V8 nenhuma recusa mexeu no saldo');
select is((select count(*) from public.debt_events where debt_id in (pg_temp.fx('imovel'), pg_temp.fx('cartao'))), 2::bigint,
  'V9 nenhuma recusa gravou evento');

-- ---------------------------------------------------------------------------
-- 4. Com conta: igual a antes (conta cai, dívida cai, principal é despesa e saída)
-- ---------------------------------------------------------------------------
select lives_ok(format($$select public.debt_record_payment(%L::uuid, date '2026-10-15', %L::uuid, 2000, 0, 0, null, true)$$,
  pg_temp.fx('imovel'), pg_temp.fx('conta')), 'C1 amortização extra com conta continua aceita');
select is(pg_temp.divida('imovel'), 58000::numeric, 'C2 dívida cai 2.000');
select is(pg_temp.saldo('conta'), 7850::numeric, 'C3 Corrente cai 2.000');
select is((select account_id from public.debt_events where debt_id = pg_temp.fx('imovel') and date = '2026-10-15'),
  pg_temp.fx('conta'), 'C3.1 evento com a conta');
select is((select note from public.debt_events where debt_id = pg_temp.fx('imovel') and date = '2026-10-15'),
  'pagamento registrado no módulo de dívidas', 'C3.2 nota de sempre');
select is(pg_temp.despesa_mes(), 2150::numeric, 'C4 com conta o principal é despesa do mês (migration 046), como antes');
select is(pg_temp.fluxo_saida(), (select n from antes where k = 'fluxo_saida') + 2000, 'C5 e saída no fluxo de caixa, como antes');
select lives_ok(format($$select public.debt_record_payment(%L::uuid, date '2026-10-16', %L::uuid, 1000, 50, 0, %L::uuid, false)$$,
  pg_temp.fx('imovel'), pg_temp.fx('conta'), pg_temp.fx('juros')), 'C6 pagamento normal com juros e conta continua aceito');
select is(pg_temp.divida('imovel'), 57000::numeric, 'C6.1 dívida cai só o principal');
select is(pg_temp.saldo('conta'), 6800::numeric, 'C6.2 conta cai principal + juros');
select is(pg_temp.sqlstate_of(format($$select public.debt_record_payment(%L::uuid, date '2026-10-17', %L::uuid, 100, 0, 0, null, true)$$,
  pg_temp.fx('imovel'), pg_temp.fx('arquivada'))), '23514', 'C7 conta arquivada: recusada como hoje');
select is(pg_temp.saldo('arquivada'), 500::numeric, 'C7.1 conta arquivada intacta');

-- ---------------------------------------------------------------------------
-- 5. Anulação do evento sem conta restaura só a dívida
-- ---------------------------------------------------------------------------
select lives_ok($$select public.debt_void((select id from public.debt_events
                    where debt_id = pg_temp.fx('imovel') and date = '2026-10-11'), 'teste FGTS')$$,
  'A1 anula a segunda amortização sem conta');
select is((select count(*) from public.debt_events
            where debt_id = pg_temp.fx('imovel') and voided_at is not null and account_id is null), 1::bigint,
  'A1.1 só esse evento ficou anulado');
select is(pg_temp.divida('imovel'), 66999.45::numeric, 'A2 dívida volta 9.999,45');
select is(pg_temp.saldo('conta'), 6800::numeric, 'A3 conta não muda com a anulação');

-- ---------------------------------------------------------------------------
-- 6. Privilégio: cliente não grava direto em debt_events (nem sem conta)
-- ---------------------------------------------------------------------------
select is(pg_temp.sqlstate_of(format($$insert into public.debt_events (household_id, debt_id, date, kind, amount)
  values (%L::uuid, %L::uuid, date '2026-10-20', 'extra_principal', 1)$$, pg_temp.fx('h'), pg_temp.fx('imovel'))),
  '42501', 'P1 insert direto em debt_events: sem permissão');

-- ---------------------------------------------------------------------------
-- 7. Forma da tabela: extra sem conta não pode ter fatura nem parcela do contrato; outros tipos seguem exigindo conta
-- ---------------------------------------------------------------------------
reset role;
select is(pg_temp.sqlstate_of(format($$insert into public.debt_events (household_id, debt_id, date, kind, amount)
  values (%L::uuid, %L::uuid, date '2026-10-20', 'payment', 1)$$, pg_temp.fx('h'), pg_temp.fx('imovel'))),
  '23514', 'K1 payment sem conta continua barrado pela tabela');
select is(pg_temp.sqlstate_of(format($$insert into public.debt_events (household_id, debt_id, date, kind, amount, category_id)
  values (%L::uuid, %L::uuid, date '2026-10-20', 'interest', 1, %L::uuid)$$, pg_temp.fx('h'), pg_temp.fx('imovel'), pg_temp.fx('juros'))),
  '23514', 'K2 juros sem conta continuam barrados pela tabela');
select is(pg_temp.sqlstate_of(format($$insert into public.debt_events (household_id, debt_id, date, kind, amount, schedule_id)
  values (%L::uuid, %L::uuid, date '2026-10-20', 'extra_principal', 1, gen_random_uuid())$$, pg_temp.fx('h'), pg_temp.fx('imovel'))),
  '23514', 'K3 extra sem conta ligado a parcela do contrato: barrado pela tabela');
select is(pg_temp.sqlstate_of(format($$insert into public.debt_events (household_id, debt_id, date, kind, amount, invoice_id)
  values (%L::uuid, %L::uuid, date '2026-10-20', 'extra_principal', 1, gen_random_uuid())$$, pg_temp.fx('h'), pg_temp.fx('cartao'))),
  '23514', 'K4 extra sem conta ligado a fatura: barrado pela tabela');

-- ---------------------------------------------------------------------------
-- 8. Isolamento: outra família não amortiza dívida alheia nem usa conta alheia
-- ---------------------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000096a2');
insert into fixture select 'h2', public.create_household('Casa Vizinha');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h2'), 'Corrente 2', 'checking', 1000, date '2026-01-01') returning id)
  insert into fixture select 'conta2', id from i;
insert into fixture select 'imovel2', public.create_debt('Imóvel 2', 'financing', date '2026-09-01', 5000);
select is(pg_temp.sqlstate_of($$select public.debt_record_payment(pg_temp.fx('imovel'), date '2026-10-20', null, 100, 0, 0, null, true)$$),
  '42501', 'O1 outra família: amortizar sem conta a dívida da família 1 é recusado');
select is(pg_temp.sqlstate_of(format($$select public.debt_record_payment(%L::uuid, date '2026-10-20', %L::uuid, 100, 0, 0, null, true)$$,
  pg_temp.fx('imovel2'), pg_temp.fx('conta'))), '23514', 'O2 conta da família 1 na dívida da família 2: recusada como hoje');
select lives_ok($$select public.debt_record_payment(pg_temp.fx('imovel2'), date '2026-10-20', null, 1000, 0, 0, null, true)$$,
  'O3 família 2 amortiza a própria dívida sem conta');
select is((select debt from public.debt_balances(pg_temp.fx('h2'), date '2026-10-31') where debt_id = pg_temp.fx('imovel2')),
  4000::numeric, 'O4 dívida da família 2 cai 1.000');
select is((select balance from public.account_balances(pg_temp.fx('h2'), date '2026-10-31') where account_id = pg_temp.fx('conta2')),
  1000::numeric, 'O5 conta da família 2 intacta');
select is((select count(*) from public.debt_events where household_id = pg_temp.fx('h')), 0::bigint,
  'O6 família 2 não vê os eventos da família 1');
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000096a1');
select is(pg_temp.divida('imovel'), 66999.45::numeric, 'O7 dívida da família 1 intacta');
select is((select count(*) from public.debt_balances(pg_temp.fx('h2'), date '2026-10-31')), 0::bigint,
  'O8 família 1 não lê saldos da família 2');

select * from finish();
rollback;
