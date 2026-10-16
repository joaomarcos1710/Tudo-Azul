-- 06_money: regra N2 (numeric sem arredondamento implícito) em amount, initial_balance e amount_limit.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ---- auxiliares de teste (temporários; somem no rollback) ----
create temp table fixture (k text primary key, v uuid, t text);
grant all on fixture to public;

create function pg_temp.fx(p_k text) returns uuid language sql as $f$ select v from fixture where k = p_k $f$;
create function pg_temp.fxt(p_k text) returns text language sql as $f$ select t from fixture where k = p_k $f$;
create function pg_temp.mkuser(p_id uuid, p_email text, p_name text default null) returns void language sql as $f$
  insert into auth.users (id, email, raw_user_meta_data)
  values (p_id, p_email, case when p_name is null then '{}'::jsonb else jsonb_build_object('name', p_name) end)
$f$;
-- Troca para um papel REAL (authenticated/anon). Sem isso a RLS não é exercitada.
create function pg_temp.login(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $f$;
create function pg_temp.login_anon() returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
end $f$;
-- Executa um comando e devolve o SQLSTATE do erro (ou NULL se não houve erro)
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
create function pg_temp.msg_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate || ' ' || sqlerrm; end $f$;

create function pg_temp.rows_of(p_sql text) returns bigint language plpgsql as $f$
declare n bigint; begin execute p_sql; get diagnostics n = row_count; return n; end $f$;
grant execute on function pg_temp.rows_of(text), pg_temp.fx(text), pg_temp.fxt(text), pg_temp.sqlstate_of(text), pg_temp.msg_of(text) to public;

-- usuários fixos
select pg_temp.mkuser('00000000-0000-0000-0000-0000000000a1', 'u1@teste.com', 'Ana');
select pg_temp.mkuser('00000000-0000-0000-0000-0000000000a2', 'u2@teste.com', 'Bia');
select pg_temp.mkuser('00000000-0000-0000-0000-0000000000a3', 'u3@teste.com', 'Caio');
select pg_temp.mkuser('00000000-0000-0000-0000-0000000000a4', 'u4@teste.com');

-- Casos: M8, M9, M12, M13. 1.2300 => aceito como 1.23; 1.005 => rejeitado; limite 999999999999.99.

-- ---- cenário-base: família "Casa Teste" (U1 owner), contas A e B, categorias ----
create function pg_temp.ins(p_type text, p_acc text, p_amt numeric, p_date date,
                            p_dst text default null, p_status text default 'paid', p_cat text default null)
returns uuid language plpgsql as $f$
declare v uuid;
begin
  insert into public.transactions (household_id, account_id, destination_account_id, category_id, type, amount, date, status)
  values (pg_temp.fx('h'), pg_temp.fx(p_acc), pg_temp.fx(p_dst),
          case when p_cat is not null then pg_temp.fx(p_cat)
               when p_type = 'income' then pg_temp.fx('cinc')
               when p_type = 'expense' then pg_temp.fx('cexp') end,
          p_type, p_amt, p_date, p_status)
  returning id into v;
  return v;
end $f$;
create function pg_temp.bal(p_acc text, p_d date) returns numeric language sql as $f$
  select balance from public.account_balances(pg_temp.fx('h'), p_d) where account_id = pg_temp.fx(p_acc) $f$;
grant execute on function pg_temp.ins(text, text, numeric, date, text, text, text), pg_temp.bal(text, date) to public;

select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
insert into fixture select 'h', public.create_household('Casa Teste'), null;
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Conta A', 'checking', 1000.00, '2026-01-01') returning id)
  insert into fixture select 'a', id, null from i;
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Conta B', 'savings', 500.00, '2026-03-01') returning id)
  insert into fixture select 'b', id, null from i;
insert into fixture select 'cexp', id, null from public.categories where household_id = pg_temp.fx('h') and name = 'Mercado';
insert into fixture select 'cinc', id, null from public.categories where household_id = pg_temp.fx('h') and name = 'Salário';
insert into fixture select 'sx_exp', id, null from public.categories where household_id = pg_temp.fx('h') and system_key = 'uncategorized' and type = 'expense';
insert into fixture select 'sx_inc', id, null from public.categories where household_id = pg_temp.fx('h') and system_key = 'uncategorized' and type = 'income';
-- o login de U1 segue ativo para o corpo do teste


create function pg_temp.amt(p_val text) returns text language plpgsql as $f$
declare v uuid;
begin
  v := pg_temp.ins('expense', 'a', p_val::numeric, '2026-02-01');
  return (select amount::text from public.transactions where id = v);
end $f$;
grant execute on function pg_temp.amt(text) to public;

-- ---- transactions.amount ----
-- M12: aceitos e normalizados para escala 2
select is(pg_temp.amt('1.2300'), '1.23', 'M12 amount 1.2300 aceito e lido como 1.23');
select is(pg_temp.amt('1.20'),   '1.20', 'M12 amount 1.20 -> 1.20');
select is(pg_temp.amt('1.2'),    '1.20', 'M12 amount 1.2 -> 1.20');
select is(pg_temp.amt('1'),      '1.00', 'M12 amount 1 -> 1.00');
select is(pg_temp.amt('0.01'),   '0.01', 'menor valor positivo: 0.01');
select is(pg_temp.amt('999999999999.99'), '999999999999.99', 'M10/M13 maior valor aceito: 999999999999.99, sem notação científica');
-- M8: mais de 2 casas significativas: recusado (nada de arredondar em silêncio)
select is(pg_temp.sqlstate_of($$select pg_temp.amt('1.005')$$),  '22003', 'M8 amount 1.005 rejeitado');
select is(pg_temp.sqlstate_of($$select pg_temp.amt('0.001')$$),  '22003', 'M8 amount 0.001 rejeitado');
select is(pg_temp.sqlstate_of($$select pg_temp.amt('1.2301')$$), '22003', 'M8 amount 1.2301 rejeitado');
select is(pg_temp.sqlstate_of($$select pg_temp.amt('0.999')$$),  '22003', 'amount 0.999 rejeitado (não vira 1.00)');
-- M9
select is(pg_temp.sqlstate_of($$select pg_temp.amt('1000000000000.00')$$), '23514', 'M9 amount 10^12 rejeitado');
select is(pg_temp.sqlstate_of($$select pg_temp.amt('-5')$$),        '23514', 'M9 amount -5 rejeitado');
select is(pg_temp.sqlstate_of($$select pg_temp.amt('0')$$),         '23514', 'M9 amount 0 rejeitado');
select is(pg_temp.sqlstate_of($$select pg_temp.amt('NaN')$$),       '23514', 'M9 amount NaN rejeitado');
select is(pg_temp.sqlstate_of($$select pg_temp.amt('Infinity')$$),  '23514', 'M9 amount Infinity rejeitado');
select is(pg_temp.sqlstate_of($$select pg_temp.amt('-Infinity')$$), '23514', 'M9 amount -Infinity rejeitado');
-- UPDATE passa pela mesma guarda
insert into fixture select 'tx', pg_temp.ins('expense', 'a', 10, '2026-02-02'), null;
select is(pg_temp.sqlstate_of(format($$update public.transactions set amount = 1.005 where id = %L$$, pg_temp.fx('tx'))), '22003', 'UPDATE de amount para 1.005 rejeitado');
select is(pg_temp.sqlstate_of(format($$update public.transactions set amount = 1.2300 where id = %L$$, pg_temp.fx('tx'))), null, 'UPDATE de amount para 1.2300 aceito');
select is((select amount::text from public.transactions where id = pg_temp.fx('tx')), '1.23', 'UPDATE normalizou para 1.23');
-- M11: ciclo gravar -> editar -> ler -> lixeira -> restaurar -> ler
update public.transactions set amount = 1250.50 where id = pg_temp.fx('tx');
select is((select amount::text from public.transactions where id = pg_temp.fx('tx')), '1250.50', 'M11 editado: 1250.50');
update public.transactions set deleted_at = now() where id = pg_temp.fx('tx');
select is((select amount::text from public.transactions where id = pg_temp.fx('tx')), '1250.50', 'M11 na lixeira: 1250.50');
update public.transactions set deleted_at = null where id = pg_temp.fx('tx');
select is((select amount::text from public.transactions where id = pg_temp.fx('tx')), '1250.50', 'M11 restaurado: 1250.50');
-- M7: soma exata no SQL
select is((select sum(x)::text from (select 0.10::numeric as x from generate_series(1, 100000)) s), '10000.00', 'M7 soma de 100.000 x 0,10 = 10000.00 exato');

-- ---- accounts.initial_balance (M13) ----
create function pg_temp.ib(p_val text, p_name text) returns text language plpgsql as $f$
declare v uuid;
begin
  insert into public.accounts (household_id, name, type, initial_balance, opening_date)
  values (pg_temp.fx('h'), p_name, 'cash', p_val::numeric, '2026-01-01') returning id into v;
  return (select initial_balance::text from public.accounts where id = v);
end $f$;
grant execute on function pg_temp.ib(text, text) to public;
select is(pg_temp.ib('1.2300', 'ib1'), '1.23', 'M13 initial_balance 1.2300 -> 1.23');
select is(pg_temp.ib('1', 'ib2'), '1.00', 'M13 initial_balance 1 -> 1.00');
select is(pg_temp.ib('0', 'ib3'), '0.00', 'M13 initial_balance 0 aceito');
select is(pg_temp.ib('-5', 'ib4'), '-5.00', 'M13 initial_balance negativo aceito');
select is(pg_temp.ib('-999999999999.99', 'ib5'), '-999999999999.99', 'M13 initial_balance -999999999999.99 aceito');
select is(pg_temp.ib('999999999999.99', 'ib6'), '999999999999.99', 'M13 initial_balance 999999999999.99 aceito');
select is(pg_temp.sqlstate_of($$select pg_temp.ib('1.005', 'ib7')$$), '22003', 'M13 initial_balance 1.005 rejeitado');
select is(pg_temp.sqlstate_of($$select pg_temp.ib('0.001', 'ib8')$$), '22003', 'M13 initial_balance 0.001 rejeitado');
select is(pg_temp.sqlstate_of($$select pg_temp.ib('1.2301', 'ib9')$$), '22003', 'M13 initial_balance 1.2301 rejeitado');
select is(pg_temp.sqlstate_of($$select pg_temp.ib('1000000000000.00', 'ib10')$$), '23514', 'M13 initial_balance 10^12 rejeitado');
select is(pg_temp.sqlstate_of($$select pg_temp.ib('-1000000000000.00', 'ib11')$$), '23514', 'M13 initial_balance -10^12 rejeitado');
select is(pg_temp.sqlstate_of($$select pg_temp.ib('NaN', 'ib12')$$), '23514', 'M13 initial_balance NaN rejeitado');
select is(pg_temp.sqlstate_of($$select pg_temp.ib('Infinity', 'ib13')$$), '23514', 'M13 initial_balance Infinity rejeitado');
select is(pg_temp.sqlstate_of(format($$update public.accounts set initial_balance = 1.005 where id = %L$$, pg_temp.fx('a'))), '22003', 'UPDATE de initial_balance para 1.005 rejeitado');

-- ---- budgets.amount_limit (M13) ----
create function pg_temp.bl(p_val text, p_month date) returns text language plpgsql as $f$
declare v uuid;
begin
  insert into public.budgets (household_id, category_id, month, amount_limit)
  values (pg_temp.fx('h'), pg_temp.fx('cexp'), p_month, p_val::numeric) returning id into v;
  return (select amount_limit::text from public.budgets where id = v);
end $f$;
grant execute on function pg_temp.bl(text, date) to public;
select is(pg_temp.bl('1.2300', '2026-01-01'), '1.23', 'M13 amount_limit 1.2300 -> 1.23');
select is(pg_temp.bl('999999999999.99', '2026-02-01'), '999999999999.99', 'M13 amount_limit 999999999999.99 aceito');
select is(pg_temp.sqlstate_of($$select pg_temp.bl('1.005', '2026-03-01')$$), '22003', 'M13 amount_limit 1.005 rejeitado');
select is(pg_temp.sqlstate_of($$select pg_temp.bl('0.001', '2026-03-01')$$), '22003', 'M13 amount_limit 0.001 rejeitado');
select is(pg_temp.sqlstate_of($$select pg_temp.bl('1.2301', '2026-03-01')$$), '22003', 'M13 amount_limit 1.2301 rejeitado');
select is(pg_temp.sqlstate_of($$select pg_temp.bl('0', '2026-03-01')$$), '23514', 'M13 amount_limit 0 rejeitado (orçamento exige > 0)');
select is(pg_temp.sqlstate_of($$select pg_temp.bl('-5', '2026-03-01')$$), '23514', 'M13 amount_limit negativo rejeitado');
select is(pg_temp.sqlstate_of($$select pg_temp.bl('1000000000000.00', '2026-03-01')$$), '23514', 'M13 amount_limit 10^12 rejeitado');
select is(pg_temp.sqlstate_of($$select pg_temp.bl('NaN', '2026-03-01')$$), '23514', 'M13 amount_limit NaN rejeitado');
select is(pg_temp.sqlstate_of($$select pg_temp.bl('Infinity', '2026-03-01')$$), '23514', 'M13 amount_limit Infinity rejeitado');
select is(pg_temp.sqlstate_of(format($$update public.budgets set amount_limit = 1.005 where category_id = %L and month = '2026-01-01'$$, pg_temp.fx('cexp'))), '22003', 'UPDATE de amount_limit para 1.005 rejeitado');

select * from finish();
rollback;
