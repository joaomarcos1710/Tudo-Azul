-- 26_projection_deleted_recurrence: migration 019. Excluir um recorrente (recurrence_delete) NÃO pode fazer o que ele já gerou
-- e foi pago virar "gasto variável" na projeção do mês e do orçamento (o ritmo só conta gasto fora de recorrência).
-- Datas fixas em 2027 (p_today explícito) para não depender do relógio.
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
create function pg_temp.pace(p_month date, p_today date) returns text language sql as $f$
  select pace_extra::text || '|' || spent::text || '|' || projected::text
    from public.month_projection(pg_temp.fx('h'), p_month, p_today) $f$;
create function pg_temp.pace_cat(p_month date, p_today date) returns text language sql as $f$
  select pace_extra::text || '|' || spent::text || '|' || projected::text
    from public.budget_projection(pg_temp.fx('h'), p_month, p_today) where category_id = pg_temp.fx('cat') $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.pace(date, date), pg_temp.pace_cat(date, date) to public;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000026a1', 'pj@teste.com');
select pg_temp.login('00000000-0000-0000-0000-0000000026a1');
insert into fixture select 'h', public.create_household('Casa Projeção');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 10000, '2026-01-01') returning id)
  insert into fixture select 'bank', id from i;
insert into fixture select 'cat', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';
insert into public.budgets (household_id, category_id, month, amount_limit)
  values (pg_temp.fx('h'), pg_temp.fx('cat'), '2027-03-01', 5000);

-- regra de aluguel de 2.000,00 (dia 3) e a ocorrência de março de 2027 já paga (gerada pela regra: tem recurrence_id e occurrence_date)
insert into fixture select 'rec', public.recurrence_create('expense', 'Aluguel', 2000, 3, '2027-03-01', pg_temp.fx('bank'), null, null, pg_temp.fx('cat'));
reset role;
insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status, recurrence_id, occurrence_date)
  values (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('cat'), 'expense', 'Aluguel', 2000.00, '2027-03-03', 'paid', pg_temp.fx('rec'), '2027-03-03');
select pg_temp.login('00000000-0000-0000-0000-0000000026a1');
-- um gasto variável de verdade: 100,00 no dia 5, sem recorrência
insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status)
  values (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('cat'), 'expense', 'Mercado', 100.00, '2027-03-05', 'paid');

-- dia 20 do mês (20 dias decorridos de 31): ritmo = 100,00 / 20 * 11 = 55,00 (só o gasto variável; o aluguel é recorrente)
select is(pg_temp.pace('2027-03-01', '2027-03-20'), '55.00|2100.00|2155.00', 'PD1 antes: o ritmo conta só o variável (55,00); aluguel pago não entra no ritmo');
select is(pg_temp.pace_cat('2027-03-01', '2027-03-20'), '55.00|2100.00|2155.00', 'PD2 antes: o orçamento da categoria também (55,00)');

select public.recurrence_delete(pg_temp.fx('rec'));

select is((select count(*) from public.transactions where description = 'Aluguel' and status = 'paid' and deleted_at is null), 1::bigint,
          'PD3 o aluguel pago continua no histórico');
select is((select recurrence_id from public.transactions where description = 'Aluguel'), null, 'PD4 sem o vínculo com a regra (ela foi excluída)');
select is(pg_temp.pace('2027-03-01', '2027-03-20'), '55.00|2100.00|2155.00',
          'PD5 depois de excluir a regra, a projeção do mês NÃO muda (o aluguel pago não vira gasto variável)');
select is(pg_temp.pace_cat('2027-03-01', '2027-03-20'), '55.00|2100.00|2155.00',
          'PD6 depois de excluir a regra, a projeção do orçamento NÃO muda');

-- dia 8: o erro seria bem maior (o aluguel de 2.000,00 contado como variável: 2.100,00 / 8 * 23 = 6.037,50); o ritmo só começa depois de 7 dias
select is(pg_temp.pace('2027-03-01', '2027-03-08'), '287.50|2100.00|2387.50',
          'PD7 no dia 8 o ritmo continua só com os 100,00 variáveis (100,00 / 8 * 23 = 287,50)');
select * from finish();
rollback;
