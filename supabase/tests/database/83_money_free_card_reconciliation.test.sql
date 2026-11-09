-- 83_money_free_card_reconciliation: deduplicação pelo valor efetivamente refletido na tesouraria.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create temp table fixture (k text primary key, v uuid);
grant all on fixture to public;
create function pg_temp.fx(p_k text) returns uuid language sql as $f$
  select v from fixture where k = p_k
$f$;
create function pg_temp.hoje() returns date language sql as $f$
  select (now() at time zone 'America/Sao_Paulo')::date
$f$;
create function pg_temp.mes_anterior(p_dia integer) returns date language sql as $f$
  select (date_trunc('month', pg_temp.hoje()::timestamp) - interval '1 month'
          + make_interval(days => p_dia - 1))::date
$f$;
create function pg_temp.fechamento_futuro() returns date language sql stable as $f$
  select (date_trunc('month', pg_temp.hoje()::timestamp) + interval '1 month')::date
$f$;
create function pg_temp.mes_fatura_futura() returns date language sql stable as $f$
  select date_trunc('month', pg_temp.fechamento_futuro()::timestamp)::date
$f$;
create function pg_temp.login(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end
$f$;
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate;
end
$f$;
grant execute on function pg_temp.fx(text), pg_temp.hoje(), pg_temp.mes_anterior(integer), pg_temp.fechamento_futuro(), pg_temp.mes_fatura_futura(),
  pg_temp.login(uuid), pg_temp.sqlstate_of(text) to public;

insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-0000000083a1', 'money-free-card@teste.com'),
 ('00000000-0000-0000-0000-0000000083a2', 'money-free-card-outro@teste.com');
select pg_temp.login('00000000-0000-0000-0000-0000000083a1');
insert into fixture select 'household', public.create_household('Casa Deduplicação');
-- Família nova não recebe conta padrão; criar a conta-base da fixture explicitamente.
insert into public.accounts (household_id, name, type, initial_balance, opening_date, currency_code)
values (pg_temp.fx('household'), 'Conta corrente', 'checking', 1000, pg_temp.hoje() - 365, 'BRL');
insert into fixture select 'bank', id from public.accounts
 where household_id = pg_temp.fx('household') and name = 'Conta corrente' limit 1;
insert into fixture select 'expense_category', id from public.categories
 where household_id = pg_temp.fx('household') and type = 'expense' and system_key = 'uncategorized' limit 1;
insert into fixture select 'income_category', id from public.categories
 where household_id = pg_temp.fx('household') and type = 'income' and system_key = 'uncategorized' limit 1;

insert into fixture select 'card', public.create_debt('Cartão Deduplicação', 'card', pg_temp.hoje() - 365, 0);
-- Primeira compra fecha no dia 1 do mês atual. O crédito também é alocado a essa fatura.
select public.set_card_cycle(pg_temp.fx('card'), 1, 31);
select public.card_purchase(pg_temp.fx('card'), pg_temp.mes_anterior(15), 100, 1,
  pg_temp.fx('expense_category'), 'Compra já cobrada');
insert into fixture select 'credit_event', public.card_credit_income(
  pg_temp.fx('card'), pg_temp.mes_anterior(20), 10, pg_temp.fx('income_category'), 'Crédito de fatura');
-- Compra, crédito e adiantamento pertencem ao próximo fechamento, ainda futuro na data de corte.
select public.card_purchase(pg_temp.fx('card'), pg_temp.hoje(), 50, 1,
  pg_temp.fx('expense_category'), 'Compra do próximo ciclo');
insert into fixture select 'future_credit_event', public.card_credit_income(
  pg_temp.fx('card'), pg_temp.hoje(), 5, pg_temp.fx('income_category'), 'Crédito futuro', pg_temp.fechamento_futuro());
select is(public.card_bill_due(pg_temp.hoje()), 1,
  'C1 somente a parcela com fechamento até hoje é cobrada');

insert into fixture select 'invoice', invoice_id from private.card_months_as_of(pg_temp.fx('card'), pg_temp.hoje())
 where label = to_char(pg_temp.hoje(), 'YYYY-MM');
select is((select charged from private.card_months_as_of(pg_temp.fx('card'), pg_temp.hoje())
  where label = to_char(pg_temp.hoje(), 'YYYY-MM')), 90::numeric,
  'C2 charged considera a compra de 100 menos o crédito de 10');
select is((select pending from private.card_months_as_of(pg_temp.fx('card'), pg_temp.hoje())
  where label = to_char(pg_temp.hoje(), 'YYYY-MM')), 0::numeric,
  'C3 a fatura já fechada não recebe a compra do próximo ciclo');
select is((select total from private.card_months_as_of(pg_temp.fx('card'), pg_temp.hoje())
  where label = to_char(pg_temp.hoje(), 'YYYY-MM')), 90::numeric,
  'C4 total líquido da fatura fechada combina cobrança e crédito');

insert into fixture select 'payment_event', public.debt_pay(
  pg_temp.fx('card'), pg_temp.hoje(), pg_temp.fx('bank'), 40, pg_temp.fx('invoice'), false, null);
select is((select paid from private.card_months_as_of(pg_temp.fx('card'), pg_temp.hoje())
  where label = to_char(pg_temp.hoje(), 'YYYY-MM')), 40::numeric,
  'C5 pagamento parcial é conciliado na fatura');
select is((select pending from private.card_months_as_of(pg_temp.fx('card'), pg_temp.hoje())
  where label = to_char(pg_temp.fechamento_futuro(), 'YYYY-MM')), 50::numeric,
  'C6 compra do próximo ciclo permanece integralmente pendente na data de corte');
select is((select paid from private.card_months_as_of(pg_temp.fx('card'), pg_temp.hoje())
  where label = to_char(pg_temp.fechamento_futuro(), 'YYYY-MM')), 0::numeric,
  'C7 crédito com fechamento futuro não é tratado como já liquidado');
select is((select sum(amount) from public.dashboard_commitment_matrix(
  pg_temp.fx('household'), pg_temp.mes_fatura_futura(), 3)
  where period_month = pg_temp.mes_fatura_futura() and row_type = 'item'
    and (commitment_id like 'card-purchase:%' or commitment_id like 'card-invoice-adjustment:%')),
  50::numeric, 'C8 matriz futura preserva o valor integral enquanto o crédito ainda não venceu');


select is(
  (public.get_home_decision_month(pg_temp.fx('household'),
    date_trunc('month', pg_temp.hoje()::timestamp)::date)->>'availableMoney')::numeric,
  910::numeric,
  'C9 tesouraria já desconta o pagamento parcial e a dívida cobrada líquida'
);
select is(
  (public.get_home_decision_month(pg_temp.fx('household'),
    date_trunc('month', pg_temp.hoje()::timestamp)::date)->>'plannedOutflows')::numeric,
  0::numeric,
  'C10 fatura já descontada da tesouraria não volta a ser deduzida'
);
select is(
  (public.get_home_decision_month(pg_temp.fx('household'),
    date_trunc('month', pg_temp.hoje()::timestamp)::date)->>'moneyFree')::numeric,
  910::numeric,
  'C11 Dinheiro Livre não duplica cobrança, crédito nem pagamento parcial'
);
-- Estorno do crédito: aumenta a dívida cobrada, mas não cria novo compromisso pendente.
select public.debt_void(pg_temp.fx('credit_event'), 'Teste de estorno do crédito');
select is(
  (public.get_home_decision_month(pg_temp.fx('household'),
    date_trunc('month', pg_temp.hoje()::timestamp)::date)->>'availableMoney')::numeric,
  900::numeric,
  'C13 estornar o crédito aumenta a dívida refletida na tesouraria em 10'
);
select is(
  (public.get_home_decision_month(pg_temp.fx('household'),
    date_trunc('month', pg_temp.hoje()::timestamp)::date)->>'plannedOutflows')::numeric,
  0::numeric,
  'C14 estornar crédito não duplica a parcela já descontada'
);
select is(
  (public.get_home_decision_month(pg_temp.fx('household'),
    date_trunc('month', pg_temp.hoje()::timestamp)::date)->>'moneyFree')::numeric,
  900::numeric,
  'C15 Dinheiro Livre acompanha o estorno do crédito uma única vez'
);

-- Estorno do pagamento: o dinheiro retorna à conta e a dívida volta a ser cobrada.
select public.debt_void(pg_temp.fx('payment_event'), 'Teste de estorno do pagamento');
select is(
  (public.get_home_decision_month(pg_temp.fx('household'),
    date_trunc('month', pg_temp.hoje()::timestamp)::date)->>'availableMoney')::numeric,
  900::numeric,
  'C16 estornar pagamento restaura o caixa e a dívida pelo mesmo valor'
);
select is(
  (public.get_home_decision_month(pg_temp.fx('household'),
    date_trunc('month', pg_temp.hoje()::timestamp)::date)->>'plannedOutflows')::numeric,
  0::numeric,
  'C17 estorno do pagamento não recria compromisso já refletido na tesouraria'
);
select is(
  (public.get_home_decision_month(pg_temp.fx('household'),
    date_trunc('month', pg_temp.hoje()::timestamp)::date)->>'moneyFree')::numeric,
  900::numeric,
  'C18 estornar pagamento não provoca dupla contagem'
);

-- O overview devolve saldo agregado pelo banco e movimentos recentes, sempre isolados por família.
insert into fixture select 'reserve', id from public.reserves
 where household_id = pg_temp.fx('household') and name = 'Reserva padrão' limit 1;
-- Se a família não tiver uma reserva padrão, cria uma explicitamente.
insert into public.reserves (household_id, name, currency_code)
select pg_temp.fx('household'), 'Reserva de teste', 'BRL'
where not exists (select 1 from public.reserves where household_id = pg_temp.fx('household') and name = 'Reserva de teste');
insert into fixture select 'reserve_test', id from public.reserves
 where household_id = pg_temp.fx('household') and name = 'Reserva de teste';
select public.record_reserve_allocation(pg_temp.fx('reserve_test'), 100, pg_temp.hoje(),
  'Aporte', '00000000-0000-0000-0000-000000083001');
select public.record_reserve_allocation(pg_temp.fx('reserve_test'), -25, pg_temp.hoje(),
  'Resgate', '00000000-0000-0000-0000-000000083002');
select is((select min(balance) from public.reserve_overview(pg_temp.fx('household'))
  where reserve_id = pg_temp.fx('reserve_test')), 75::numeric,
  'R1 saldo da reserva é agregado pelo banco');
select is((select count(*)::integer from public.reserve_overview(pg_temp.fx('household'))
  where reserve_id = pg_temp.fx('reserve_test') and allocation_id is not null), 2,
  'R2 histórico retorna os dois movimentos recentes');
select is((public.get_home_decision_month(pg_temp.fx('household'),
  date_trunc('month', pg_temp.hoje()::timestamp)::date)->>'moneyFree')::numeric, 775::numeric,
  'R20 reserva virtual reduz o Dinheiro Livre uma única vez');
select ok(not (select prosecdef from pg_proc where oid='private.card_months_as_of(uuid,date)'::regprocedure),
  'C19 card_months_as_of permanece SECURITY INVOKER');
select ok(not (select prosecdef from pg_proc where oid='public.reserve_overview(uuid)'::regprocedure),
  'R4 reserve_overview permanece SECURITY INVOKER');

select pg_temp.login('00000000-0000-0000-0000-0000000083a2');
insert into fixture select 'other_household', public.create_household('Outra Casa');
select is((select count(*)::integer from public.reserve_overview(pg_temp.fx('household'))), 0,
  'R5 outra família não consulta envelopes alheios');

select * from finish();
rollback;
