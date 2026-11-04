-- 49_installments_and_daily: migration 048. Lançamento parcelado fora do cartão e recorrência a cada N dias.
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
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.sqlstate_of(text) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000049a1', 'a1@teste.com'),
  ('00000000-0000-0000-0000-0000000049a2', 'a2@teste.com');
select pg_temp.login('00000000-0000-0000-0000-0000000049a1');
insert into fixture select 'h', public.create_household('Casa Parcelado');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Corrente', 'checking', 0, '2026-01-01') returning id)
  insert into fixture select 'conta', id from i;
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Reserva', 'checking', 0, '2026-01-01') returning id)
  insert into fixture select 'reserva', id from i;
insert into fixture select 'cat', id from public.categories where household_id = pg_temp.fx('h') and type = 'expense' limit 1;

-- 1. parcelado ---------------------------------------------------------------
insert into fixture select 'g', public.transaction_installments_create('expense', 'Sofá', 10.00, 3, 'month', 1, '2026-01-31',
  pg_temp.fx('conta'), null, pg_temp.fx('cat'), true);
select is((select count(*)::int from public.transactions where installment_group = pg_temp.fx('g')), 3, 'I1 três parcelas, de uma vez');
select is((select array_agg(amount order by installment_number) from public.transactions where installment_group = pg_temp.fx('g')),
  array[3.34, 3.33, 3.33]::numeric[], 'I2 centavos exatos: a sobra fica na primeira');
select is((select sum(amount) from public.transactions where installment_group = pg_temp.fx('g')), 10.00::numeric, 'I2.1 soma = total');
select is((select array_agg(date order by installment_number) from public.transactions where installment_group = pg_temp.fx('g')),
  array['2026-01-31', '2026-02-28', '2026-03-31']::date[], 'I3 mensal no dia 31: fevereiro cai no último dia');
select is((select array_agg(description order by installment_number) from public.transactions where installment_group = pg_temp.fx('g')),
  array['Sofá 1/3', 'Sofá 2/3', 'Sofá 3/3'], 'I4 descrição numerada');
select is((select array_agg(status order by installment_number) from public.transactions where installment_group = pg_temp.fx('g')),
  array['paid', 'planned', 'planned'], 'I5 primeira paga (pedido), as outras planejadas');
select is((select expense_paid from public.period_summary(pg_temp.fx('h'), '2026-01-01', '2026-01-31')), 3.34::numeric,
  'I6 relatório conta a parcela paga do mês, como lançamento comum');

insert into fixture select 'g2', public.transaction_installments_create('transfer', 'Guardar', 100.00, 4, 'day', 15, '2026-05-01',
  pg_temp.fx('conta'), pg_temp.fx('reserva'), pg_temp.fx('cat'));
select is((select array_agg(date order by installment_number) from public.transactions where installment_group = pg_temp.fx('g2')),
  array['2026-05-01', '2026-05-16', '2026-05-31', '2026-06-15']::date[], 'I7 a cada 15 dias');
select ok((select bool_and(category_id is null and destination_account_id = pg_temp.fx('reserva') and status = 'planned')
             from public.transactions where installment_group = pg_temp.fx('g2')), 'I8 transferência sem categoria, com destino, planejada');
insert into fixture select 'g3', public.transaction_installments_create('income', 'Freela', 300.00, 2, 'week', 2, '2026-06-01',
  pg_temp.fx('conta'), null, (select id from public.categories where household_id = pg_temp.fx('h') and type = 'income' limit 1));
select is((select array_agg(date order by installment_number) from public.transactions where installment_group = pg_temp.fx('g3')),
  array['2026-06-01', '2026-06-15']::date[], 'I9 a cada 2 semanas');

select is(pg_temp.sqlstate_of($$select public.transaction_installments_create('expense', 'X', 10, 1, 'month', 1, '2026-01-01', pg_temp.fx('conta'), null, pg_temp.fx('cat'))$$),
  '22023', 'V1 uma parcela só: recusa (use lançamento comum)');
select is(pg_temp.sqlstate_of($$select public.transaction_installments_create('expense', 'X', 10, 361, 'month', 1, '2026-01-01', pg_temp.fx('conta'), null, pg_temp.fx('cat'))$$),
  '22023', 'V2 mais de 360: recusa');
select is(pg_temp.sqlstate_of($$select public.transaction_installments_create('expense', 'X', 0.02, 3, 'month', 1, '2026-01-01', pg_temp.fx('conta'), null, pg_temp.fx('cat'))$$),
  '22023', 'V3 menos de 1 centavo por parcela: recusa');
select is(pg_temp.sqlstate_of($$select public.transaction_installments_create('expense', 'X', 10.001, 3, 'month', 1, '2026-01-01', pg_temp.fx('conta'), null, pg_temp.fx('cat'))$$),
  '22023', 'V4 mais de 2 casas: recusa');
select is(pg_temp.sqlstate_of($$select public.transaction_installments_create('expense', '  ', 10, 3, 'month', 1, '2026-01-01', pg_temp.fx('conta'), null, pg_temp.fx('cat'))$$),
  '22023', 'V5 sem descrição: recusa');
select is(pg_temp.sqlstate_of($$select public.transaction_installments_create('expense', 'X', 10, 3, 'day', 0, '2026-01-01', pg_temp.fx('conta'), null, pg_temp.fx('cat'))$$),
  '22023', 'V6 a cada 0 dias: recusa');
select is((select count(*)::int from public.transactions where description like 'X %'), 0, 'V7 nada gravado nas recusas (tudo ou nada)');
select is(pg_temp.sqlstate_of($$update public.transactions set installment_number = 9 where installment_group = pg_temp.fx('g')$$),
  '42501', 'V8 o cliente não muda o número da parcela');

-- outra família não grava na conta desta
select pg_temp.login('00000000-0000-0000-0000-0000000049a2');
insert into fixture select 'h2', public.create_household('Outra');
select isnt(pg_temp.sqlstate_of($$select public.transaction_installments_create('expense', 'Invasão', 10, 2, 'month', 1, '2026-01-01', pg_temp.fx('conta'), null, pg_temp.fx('cat'))$$),
  null, 'S1 conta e categoria de outra família: recusa');
select pg_temp.login('00000000-0000-0000-0000-0000000049a1');
select is((select count(*)::int from public.transactions where description like 'Invasão%'), 0, 'S1.1 nada gravado');

-- 2. recorrência em dias -----------------------------------------------------
-- como a semanal, a série em dias começa no dia em que a regra foi criada (não gera passado): datas a partir de hoje
create function pg_temp.hoje() returns date language sql as $f$ select (now() at time zone 'America/Sao_Paulo')::date $f$;
grant execute on function pg_temp.hoje() to public;
insert into fixture select 'r', public.recurrence_create('expense', 'Padaria', 12.50, null, pg_temp.hoje(), pg_temp.fx('conta'), null, null,
  pg_temp.fx('cat'), pg_temp.hoje() + 30, 'day', 10);
select is((select array_agg(o order by o) from public.recurrences r cross join lateral private.recurrence_occurrences(r, pg_temp.hoje() - 5, pg_temp.hoje() + 90) o
            where r.id = pg_temp.fx('r')),
  array[pg_temp.hoje(), pg_temp.hoje() + 10, pg_temp.hoje() + 20, pg_temp.hoje() + 30], 'D1 a cada 10 dias, até o fim');
select is((select day from public.recurrences where id = pg_temp.fx('r')), null::smallint, 'D2 em dias não guarda dia do mês');
select is(pg_temp.sqlstate_of($$select public.recurrence_create('expense', 'X', 1, null, '2026-07-01', pg_temp.fx('conta'), null, null, pg_temp.fx('cat'), null, 'day', 366)$$),
  '22023', 'D3 mais de 365 dias: recusa');
select is(pg_temp.sqlstate_of($$select public.recurrence_create('expense', 'X', 1, 5, '2026-07-01', pg_temp.fx('conta'), null, null, pg_temp.fx('cat'), null, 'week', 5)$$),
  '22023', 'D4 semanal continua limitada a 4');
select lives_ok($$select public.recurrence_create('expense', 'Aluguel', 1000, 5, '2026-07-01', pg_temp.fx('conta'), null, null, pg_temp.fx('cat'))$$,
  'D5 mensal continua igual');

select * from finish();
rollback;
