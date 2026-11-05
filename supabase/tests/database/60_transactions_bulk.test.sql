-- 60_transactions_bulk: migration 060. Edição em lote de lançamentos: mudar categoria, marcar pago (e desfazer),
-- lixeira (e restaurar). Tudo ou nada, mesma família, as mesmas guardas do UPDATE de um só, limite de 500 ids.
-- Datas relativas a hoje em São Paulo; sem dado real.
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
create function pg_temp.hoje() returns date language sql as $f$ select (now() at time zone 'America/Sao_Paulo')::date $f$;
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
create function pg_temp.erro_de(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlerrm; end $f$;
-- as funções novas vão por SQL dinâmico: sem a migration o teste falha nas asserções, sem abortar o arquivo
create function pg_temp.n(p_sql text) returns integer language plpgsql as $f$
declare r integer;
begin execute 'select ' || p_sql into r; return r; exception when others then return -1; end $f$;
create function pg_temp.tx(p_k text, p_tipo text, p_status text, p_data date, p_valor numeric, p_conta text, p_cat text)
returns uuid language plpgsql as $f$
declare v uuid;
begin
  insert into public.transactions (household_id, type, status, date, amount, description, account_id, category_id,
                                   destination_account_id)
  values (pg_temp.fx('h'), p_tipo, p_status, p_data, p_valor, p_k, pg_temp.fx(p_conta),
          case when p_tipo = 'transfer' then null else pg_temp.fx(p_cat) end,
          case when p_tipo = 'transfer' then pg_temp.fx(p_cat) end)
  returning id into v;
  insert into fixture values (p_k, v);
  return v;
end $f$;
create function pg_temp.ids(variadic p_k text[]) returns text language sql as $f$
  select 'array[' || string_agg(quote_literal(pg_temp.fx(k)), ',') || ']::uuid[]' from unnest(p_k) as k $f$;
create function pg_temp.cat_de(p_k text) returns uuid language sql as $f$
  select category_id from public.transactions where id = pg_temp.fx(p_k) $f$;
create function pg_temp.status_de(p_k text) returns text language sql as $f$
  select status || '|' || date::text || '|' || (deleted_at is not null)::text from public.transactions where id = pg_temp.fx(p_k) $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.hoje(), pg_temp.sqlstate_of(text),
  pg_temp.erro_de(text), pg_temp.n(text), pg_temp.tx(text, text, text, date, numeric, text, text),
  pg_temp.ids(text[]), pg_temp.cat_de(text), pg_temp.status_de(text) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000060a1', 'lote-a@teste.com'),
  ('00000000-0000-0000-0000-0000000060b1', 'lote-b@teste.com');

-- família B (outra) com um lançamento
select pg_temp.login('00000000-0000-0000-0000-0000000060b1');
insert into fixture select 'hb', public.create_household('Casa B');
insert into fixture select 'cb', id from public.categories
 where household_id = pg_temp.fx('hb') and system_key = 'uncategorized' and type = 'expense';
insert into public.accounts (household_id, name, type, initial_balance, opening_date)
values (pg_temp.fx('hb'), 'Conta B', 'checking', 0, pg_temp.hoje() - 30);
insert into fixture select 'contab', id from public.accounts where household_id = pg_temp.fx('hb');
insert into public.transactions (household_id, type, status, date, amount, description, account_id, category_id)
values (pg_temp.fx('hb'), 'expense', 'planned', pg_temp.hoje(), 10, 'De B', pg_temp.fx('contab'), pg_temp.fx('cb'));
insert into fixture select 'txb', id from public.transactions where household_id = pg_temp.fx('hb');

-- família A
select pg_temp.login('00000000-0000-0000-0000-0000000060a1');
insert into fixture select 'h', public.create_household('Casa A');
insert into fixture select 'cexp', id from public.categories
 where household_id = pg_temp.fx('h') and system_key = 'uncategorized' and type = 'expense';
insert into fixture select 'cinc', id from public.categories
 where household_id = pg_temp.fx('h') and system_key = 'uncategorized' and type = 'income';
insert into public.categories (household_id, name, type) values (pg_temp.fx('h'), 'Mercado lote', 'expense');
insert into fixture select 'cmerc', id from public.categories where household_id = pg_temp.fx('h') and name = 'Mercado lote';
insert into public.accounts (household_id, name, type, initial_balance, opening_date)
values (pg_temp.fx('h'), 'Corrente', 'checking', 1000, pg_temp.hoje() - 30),
       (pg_temp.fx('h'), 'Poupança', 'savings', 0, pg_temp.hoje() - 30),
       (pg_temp.fx('h'), 'Conciliada', 'checking', 500, pg_temp.hoje() - 30);
insert into fixture select 'c1', id from public.accounts where household_id = pg_temp.fx('h') and name = 'Corrente';
insert into fixture select 'c2', id from public.accounts where household_id = pg_temp.fx('h') and name = 'Poupança';
insert into fixture select 'c3', id from public.accounts where household_id = pg_temp.fx('h') and name = 'Conciliada';

select pg_temp.tx('d1', 'expense', 'planned', pg_temp.hoje() + 3, 100, 'c1', 'cexp');
select pg_temp.tx('d2', 'expense', 'planned', pg_temp.hoje() + 5, 50.25, 'c1', 'cexp');
select pg_temp.tx('d3', 'expense', 'paid', pg_temp.hoje() - 2, 30, 'c1', 'cmerc');
select pg_temp.tx('r1', 'income', 'planned', pg_temp.hoje() + 1, 2000, 'c1', 'cinc');
select pg_temp.tx('t1', 'transfer', 'planned', pg_temp.hoje() + 2, 200, 'c1', 'c2');
-- planejado antigo na conta que será conciliada até hoje − 10
select pg_temp.tx('dc', 'expense', 'planned', pg_temp.hoje() - 20, 40, 'c3', 'cexp');
select lives_ok($$select public.reconcile_account(pg_temp.fx('c3'), pg_temp.hoje() - 10, 500)$$, 'preparo: conta conciliada até hoje − 10');

-- 0. as funções existem e são SECURITY INVOKER ------------------------------------------------
select is(
  array(select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname like 'transactions_bulk_%' and not p.prosecdef order by 1),
  array['transactions_bulk_mark_paid','transactions_bulk_mark_planned','transactions_bulk_restore','transactions_bulk_set_category','transactions_bulk_trash']::text[],
  'L0 as cinco funções de lote existem e são SECURITY INVOKER (a RLS vale)');

-- 1. mudar categoria -------------------------------------------------------------------------
select is(pg_temp.n(format('public.transactions_bulk_set_category(%s, %L)', pg_temp.ids('d1', 'd2', 'd3', 'd1'), pg_temp.fx('cmerc'))),
  2, 'L1 mudar categoria devolve quantos mudaram (d3 já era da categoria; id repetido conta uma vez)');
select is(pg_temp.cat_de('d1'), pg_temp.fx('cmerc'), 'L1b d1 na categoria nova');
select is(pg_temp.cat_de('d2'), pg_temp.fx('cmerc'), 'L1c d2 na categoria nova');
-- desfazer = a mesma função por grupo de categoria antiga
select is(pg_temp.n(format('public.transactions_bulk_set_category(%s, %L)', pg_temp.ids('d1', 'd2'), pg_temp.fx('cexp'))),
  2, 'L1d desfazer: volta as categorias anteriores');
select is(pg_temp.cat_de('d1'), pg_temp.fx('cexp'), 'L1e d1 de volta à categoria antiga');

select is(pg_temp.sqlstate_of(format('select public.transactions_bulk_set_category(%s, %L)', pg_temp.ids('d1', 'r1'), pg_temp.fx('cmerc'))),
  '23514', 'L2 categoria de despesa numa seleção com receita: recusada');
select is(pg_temp.cat_de('d1'), pg_temp.fx('cexp'), 'L2b tudo ou nada: a despesa da mesma seleção não mudou');
select matches(pg_temp.erro_de(format('select public.transactions_bulk_set_category(%s, %L)', pg_temp.ids('r1'), pg_temp.fx('cmerc'))),
  'categoria de despesa só em despesa', 'L2c receita com categoria de despesa: mensagem clara');
select is(pg_temp.n(format('public.transactions_bulk_set_category(%s, %L)', pg_temp.ids('r1'), pg_temp.fx('cinc'))),
  0, 'L2d receita com categoria de receita: aceita (já era, 0 alterados)');
select is(pg_temp.sqlstate_of(format('select public.transactions_bulk_set_category(%s, %L)', pg_temp.ids('d1', 't1'), pg_temp.fx('cexp'))),
  '22023', 'L3 transferência na seleção de mudar categoria: recusada');
select is(pg_temp.sqlstate_of(format('select public.transactions_bulk_set_category(%s, %L)', pg_temp.ids('d1'), pg_temp.fx('cb'))),
  '42501', 'L4 categoria de outra família: recusada');
select is(pg_temp.sqlstate_of(format('select public.transactions_bulk_set_category(array[%L, %L]::uuid[], %L)',
  pg_temp.fx('d1'), pg_temp.fx('txb'), pg_temp.fx('cmerc'))),
  '42501', 'L5 lançamento de outra família na seleção: recusado');
select is(pg_temp.cat_de('d1'), pg_temp.fx('cexp'), 'L5b tudo ou nada: o da família não mudou');
select is(pg_temp.sqlstate_of(format('select public.transactions_bulk_set_category(%s, null)', pg_temp.ids('d1'))),
  '22023', 'L6 categoria vazia: recusada');
select is(pg_temp.sqlstate_of('select public.transactions_bulk_set_category(array[]::uuid[], ' || quote_literal(pg_temp.fx('cexp')) || ')'),
  '22023', 'L7 lista vazia: recusada');
select is(pg_temp.sqlstate_of('select public.transactions_bulk_set_category(array[null]::uuid[], ' || quote_literal(pg_temp.fx('cexp')) || ')'),
  '22023', 'L7b id nulo: recusado');
select is(pg_temp.sqlstate_of('select public.transactions_bulk_trash(array(select gen_random_uuid() from generate_series(1, 501)))'),
  '22023', 'L8 mais de 500 ids: recusado');
select matches(pg_temp.erro_de('select public.transactions_bulk_trash(array(select gen_random_uuid() from generate_series(1, 501)))'),
  'no máximo 500', 'L8b mensagem do limite');
select is(pg_temp.sqlstate_of('select public.transactions_bulk_trash(array(select gen_random_uuid() from generate_series(1, 500)))'),
  '42501', 'L8c 500 ids passam do limite (e são recusados só por não existirem)');

-- 2. marcar como pago --------------------------------------------------------------------------
select is(pg_temp.n(format('public.transactions_bulk_mark_paid(%s, %L)', pg_temp.ids('d1', 'd2', 'd3'), pg_temp.hoje())),
  2, 'P1 marcar pago: só os planejados contam (d3 já estava pago)');
select is(pg_temp.status_de('d1'), 'paid|' || pg_temp.hoje() || '|false', 'P1b d1 pago na data escolhida');
select is((select amount from public.transactions where id = pg_temp.fx('d2')), 50.25::numeric, 'P1c o valor não muda');
select is(pg_temp.n(format('public.transactions_bulk_mark_planned(%s, array[%L, %L]::date[])', pg_temp.ids('d1', 'd2'),
  pg_temp.hoje() + 3, pg_temp.hoje() + 5)), 2, 'P2 desfazer: volta a planejado');
select is(pg_temp.status_de('d2'), 'planned|' || (pg_temp.hoje() + 5) || '|false', 'P2b d2 planejado na data que tinha');
select is(pg_temp.sqlstate_of(format('select public.transactions_bulk_mark_planned(%s, array[%L]::date[])', pg_temp.ids('d1', 'd2'), pg_temp.hoje())),
  '22023', 'P2c desfazer sem a data de cada um: recusado');
select is(pg_temp.n(format('public.transactions_bulk_mark_paid(%s, null)', pg_temp.ids('r1'))), 1, 'P3 data nula: mantém a de cada um');
select is(pg_temp.status_de('r1'), 'paid|' || (pg_temp.hoje() + 1) || '|false', 'P3b r1 pago na data planejada');
-- período conciliado: a guarda de sempre recusa, e nada da seleção muda
select is(pg_temp.sqlstate_of(format('select public.transactions_bulk_mark_paid(%s, null)', pg_temp.ids('d1', 'dc'))),
  '55000', 'P4 planejado no período conciliado: recusado pela guarda de período');
select is(pg_temp.status_de('d1'), 'planned|' || (pg_temp.hoje() + 3) || '|false', 'P4b tudo ou nada: d1 continua planejado');
select is(pg_temp.sqlstate_of(format('select public.transactions_bulk_mark_paid(array[%L]::uuid[], %L)', pg_temp.fx('txb'), pg_temp.hoje())),
  '42501', 'P5 outra família: recusado');

-- 3. lixeira e restaurar -------------------------------------------------------------------------
select is(pg_temp.n(format('public.transactions_bulk_trash(%s)', pg_temp.ids('d1', 'd2', 't1'))), 3, 'X1 três para a lixeira');
select is(pg_temp.status_de('t1'), 'planned|' || (pg_temp.hoje() + 2) || '|true', 'X1b transferência também vai para a lixeira');
select is(pg_temp.sqlstate_of(format('select public.transactions_bulk_set_category(%s, %L)', pg_temp.ids('d1'), pg_temp.fx('cmerc'))),
  '55000', 'X2 lançamento na lixeira: não muda categoria');
select is(pg_temp.sqlstate_of(format('select public.transactions_bulk_mark_paid(%s, null)', pg_temp.ids('d1'))),
  '55000', 'X2b lançamento na lixeira: não marca pago');
select is(pg_temp.n(format('public.transactions_bulk_restore(%s)', pg_temp.ids('d1', 'd2', 't1'))), 3, 'X3 desfazer: restaura os três');
select is(pg_temp.status_de('d1'), 'planned|' || (pg_temp.hoje() + 3) || '|false', 'X3b d1 de volta, como estava');
select is(pg_temp.sqlstate_of(format('select public.transactions_bulk_trash(array[%L, %L]::uuid[])', pg_temp.fx('d1'), pg_temp.fx('txb'))),
  '42501', 'X4 lixeira com lançamento de outra família: recusada');
select is(pg_temp.status_de('d1'), 'planned|' || (pg_temp.hoje() + 3) || '|false', 'X4b tudo ou nada: d1 fora da lixeira');
-- restaurar em conta desativada: a guarda de sempre recusa
insert into public.accounts (household_id, name, type, initial_balance, opening_date)
values (pg_temp.fx('h'), 'Antiga', 'checking', 0, pg_temp.hoje() - 30);
insert into fixture select 'c4', id from public.accounts where household_id = pg_temp.fx('h') and name = 'Antiga';
select pg_temp.tx('d4', 'expense', 'paid', pg_temp.hoje() - 1, 15, 'c4', 'cexp');
select lives_ok($$select public.transactions_bulk_trash(array[pg_temp.fx('d4')])$$, 'preparo: d4 na lixeira');
update public.accounts set active = false where id = pg_temp.fx('c4');
select is(pg_temp.sqlstate_of(format('select public.transactions_bulk_restore(%s)', pg_temp.ids('d1', 'd4'))),
  '23514', 'X5 restaurar em conta desativada: recusado pela guarda de conta');

-- 4. a outra família não enxerga nem mexe --------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000060b1');
select is(pg_temp.sqlstate_of(format('select public.transactions_bulk_trash(%s)', pg_temp.ids('d1'))),
  '42501', 'F1 usuário de outra família não manda para a lixeira');
select pg_temp.login('00000000-0000-0000-0000-0000000060a1');
select is(pg_temp.status_de('d1'), 'planned|' || (pg_temp.hoje() + 3) || '|false', 'F1b d1 intacto');

-- 5. sem login --------------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select is(pg_temp.sqlstate_of(format('select public.transactions_bulk_trash(%s)', pg_temp.ids('d1'))),
  '42501', 'A1 anon não executa');
reset role;

select * from finish();
rollback;
