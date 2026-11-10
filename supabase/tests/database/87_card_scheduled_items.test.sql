-- 87: card_scheduled_items (migration 20261110020000), etapa 1 da recorrência no cartão estilo Organizze.
-- Só a tabela: leitura pela família, nenhuma escrita pelo app, regras de valor, status e unicidade, e limpeza junto
-- com a regra. Falha sem a migration (a tabela não existe).
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
  ('00000000-0000-0000-0000-0000000087a1', 'a1@teste.com'),
  ('00000000-0000-0000-0000-0000000087a2', 'a2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000087a1');
insert into fixture select 'h', public.create_household('Casa dos Agendados');
insert into fixture select 'cat', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';
insert into fixture select 'a', public.create_debt('Cartão A', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('a'), 10, 20);
insert into fixture select 'r', public.recurrence_create('card', 'Streaming', 50.00, 15, '2030-01-15', null, null, pg_temp.fx('a'), pg_temp.fx('cat'));

-- o app não grava: a etapa 2 preenche por função; aqui o teste grava como dono do banco
reset role;
with x as (
  insert into public.card_scheduled_items (household_id, debt_id, recurrence_id, occurrence_date, charge_date, closing_date,
                                           amount, description, category_id)
  values (pg_temp.fx('h'), pg_temp.fx('a'), pg_temp.fx('r'), '2030-01-15', '2030-01-15', '2030-02-10',
          50.00, 'Streaming', pg_temp.fx('cat'))
  returning id)
insert into fixture select 'i1', id from x;

select is((select status from public.card_scheduled_items where id = pg_temp.fx('i1')), 'scheduled', 'AG1 nasce agendado');
select is((select edited from public.card_scheduled_items where id = pg_temp.fx('i1')), false, 'AG2 nasce sem edição manual');

select is(pg_temp.sqlstate_of($q$insert into public.card_scheduled_items (household_id, debt_id, recurrence_id, occurrence_date, charge_date, closing_date, amount, description, category_id)
  values (pg_temp.fx('h'), pg_temp.fx('a'), pg_temp.fx('r'), '2030-01-15', '2030-01-15', '2030-02-10', 50.00, 'Dup', pg_temp.fx('cat'))$q$),
  '23505', 'AG3 a mesma ocorrência da regra não entra duas vezes');
select is(pg_temp.sqlstate_of($q$insert into public.card_scheduled_items (household_id, debt_id, recurrence_id, occurrence_date, charge_date, closing_date, amount, description, category_id)
  values (pg_temp.fx('h'), pg_temp.fx('a'), pg_temp.fx('r'), '2030-02-15', '2030-02-15', '2030-03-10', 50.001, 'X', pg_temp.fx('cat'))$q$),
  '23514', 'AG4 valor com mais de 2 casas é recusado');
select is(pg_temp.sqlstate_of($q$insert into public.card_scheduled_items (household_id, debt_id, recurrence_id, occurrence_date, charge_date, closing_date, amount, description, category_id)
  values (pg_temp.fx('h'), pg_temp.fx('a'), pg_temp.fx('r'), '2030-02-15', '2030-02-15', '2030-03-10', 0, 'X', pg_temp.fx('cat'))$q$),
  '23514', 'AG5 valor zero é recusado');
select is(pg_temp.sqlstate_of($q$update public.card_scheduled_items set status = 'pago' where id = pg_temp.fx('i1')$q$),
  '23514', 'AG6 situação fora de scheduled/cancelled/converted é recusada');

-- leitura: a família vê, outra família não; o app não grava
select pg_temp.login('00000000-0000-0000-0000-0000000087a1');
select is((select count(*) from public.card_scheduled_items), 1::bigint, 'AG7 a família lê o item agendado');
select is(pg_temp.sqlstate_of($q$insert into public.card_scheduled_items (household_id, debt_id, recurrence_id, occurrence_date, charge_date, closing_date, amount, description, category_id)
  values (pg_temp.fx('h'), pg_temp.fx('a'), pg_temp.fx('r'), '2030-03-15', '2030-03-15', '2030-04-10', 50.00, 'X', pg_temp.fx('cat'))$q$),
  '42501', 'AG8 o app não insere direto');
select is(pg_temp.sqlstate_of($q$update public.card_scheduled_items set amount = 1 where id = pg_temp.fx('i1')$q$),
  '42501', 'AG9 o app não altera direto');
select is(pg_temp.sqlstate_of($q$delete from public.card_scheduled_items where id = pg_temp.fx('i1')$q$),
  '42501', 'AG10 o app não apaga direto');
select pg_temp.login('00000000-0000-0000-0000-0000000087a2');
select is((select count(*) from public.card_scheduled_items), 0::bigint, 'AG11 outra família não vê nada');

-- apagar a regra limpa os itens dela
reset role;
delete from public.recurrences where id = pg_temp.fx('r');
select is((select count(*) from public.card_scheduled_items where id = pg_temp.fx('i1')), 0::bigint, 'AG12 apagar a regra apaga os itens agendados dela');

select has_table('public', 'card_scheduled_items', 'AG13 a tabela existe');
select ok((select relrowsecurity from pg_class where oid = 'public.card_scheduled_items'::regclass), 'AG14 RLS ligada');

select * from finish();
rollback;
