-- 04_budget: uso do orçamento (B6, B7) e arredondamento do percentual.
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


insert into fixture select 'lazer', id, null from public.categories where household_id = pg_temp.fx('h') and name = 'Lazer' and type = 'expense';
insert into public.categories (household_id, name, type, parent_id) values (pg_temp.fx('h'), 'Cinema', 'expense', pg_temp.fx('lazer'));
insert into fixture select 'cinema', id, null from public.categories where household_id = pg_temp.fx('h') and name = 'Cinema';
insert into public.budgets (household_id, category_id, month, amount_limit) values (pg_temp.fx('h'), pg_temp.fx('lazer'), '2026-03-01', 500.00);

-- B6: mãe 80 + filha 120 (pagos) = 200
select pg_temp.ins('expense', 'a', 120, '2026-03-10', null, 'paid', 'cinema');
select pg_temp.ins('expense', 'a',  80, '2026-03-12', null, 'paid', 'lazer');
select is((select spent from public.budget_usage(pg_temp.fx('h'), '2026-03-15')), 200.00::numeric, 'B6 realizado = 200,00 (mãe + subcategoria)');
select is((select remaining from public.budget_usage(pg_temp.fx('h'), '2026-03-15')), 300.00::numeric, 'B6 restante = 300,00');
select is((select percent from public.budget_usage(pg_temp.fx('h'), '2026-03-15')), 40.0::numeric, 'B6 percentual = 40,0%');
select is((select amount_limit from public.budget_usage(pg_temp.fx('h'), '2026-03-15')), 500.00::numeric, 'limite exibido = 500,00');
select is((select count(*) from public.budget_usage(pg_temp.fx('h'), '2026-03-15')), 1::bigint, 'só categorias raiz com orçamento aparecem (a subcategoria não)');
-- B7: planejada, transferência, outro mês, outra categoria, lixeira e receita não entram
select pg_temp.ins('expense', 'a', 50, '2026-03-20', null, 'planned', 'lazer');
select pg_temp.ins('transfer', 'a', 70, '2026-03-21', 'b');
select pg_temp.ins('expense', 'a', 30, '2026-04-02', null, 'paid', 'lazer');
select pg_temp.ins('expense', 'a', 25, '2026-02-28', null, 'paid', 'lazer');
select pg_temp.ins('expense', 'a', 10, '2026-03-05', null, 'paid', 'cexp');
select pg_temp.ins('income', 'a', 999, '2026-03-05');
insert into fixture select 'lix', pg_temp.ins('expense', 'a', 40, '2026-03-15', null, 'paid', 'lazer'), null;
update public.transactions set deleted_at = now() where id = pg_temp.fx('lix');
select is((select spent from public.budget_usage(pg_temp.fx('h'), '2026-03-15')), 200.00::numeric, 'B7 planejada, transferência, outros meses/categorias, receita e lixeira não entram: continua 200,00');
-- limites do mês: 01 e 31
select pg_temp.ins('expense', 'a', 1, '2026-03-01', null, 'paid', 'lazer');
select pg_temp.ins('expense', 'a', 2, '2026-03-31', null, 'paid', 'cinema');
select is((select spent from public.budget_usage(pg_temp.fx('h'), '2026-03-31')), 203.00::numeric, 'dias 01 e 31 entram no mês (203,00); consulta por qualquer dia do mês');
-- mês sem orçamento
select is((select count(*) from public.budget_usage(pg_temp.fx('h'), '2026-04-10')), 0::bigint, 'mês sem orçamento: nenhuma linha');
-- estouro do limite
insert into public.budgets (household_id, category_id, month, amount_limit) values (pg_temp.fx('h'), pg_temp.fx('cexp'), '2026-03-01', 5.00);
select is((select remaining from public.budget_usage(pg_temp.fx('h'), '2026-03-01') where category_id = pg_temp.fx('cexp')), -5.00::numeric, 'gasto 10 contra limite 5: restante negativo (−5,00)');
select is((select percent from public.budget_usage(pg_temp.fx('h'), '2026-03-01') where category_id = pg_temp.fx('cexp')), 200.0::numeric, 'percentual passa de 100% (200,0)');
-- arredondamento do percentual: 1/3 => 33.3
insert into public.budgets (household_id, category_id, month, amount_limit) values (pg_temp.fx('h'), pg_temp.fx('cexp'), '2026-05-01', 30.00);
select pg_temp.ins('expense', 'a', 10, '2026-05-10', null, 'paid', 'cexp');
select is((select percent from public.budget_usage(pg_temp.fx('h'), '2026-05-01') where category_id = pg_temp.fx('cexp')), 33.3::numeric, 'percentual arredondado a 1 casa (10/30 = 33,3)');
-- editar o limite
update public.budgets set amount_limit = 400.00 where category_id = pg_temp.fx('lazer') and month = '2026-03-01';
select is((select percent from public.budget_usage(pg_temp.fx('h'), '2026-03-15') where category_id = pg_temp.fx('lazer')), 50.8::numeric, 'limite editado para 400: 203/400 = 50,8%');

select * from finish();
rollback;
