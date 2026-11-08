-- 81_home_decision_month: RPC agregada da Home, invoker e sem efeitos colaterais.
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
create function pg_temp.login(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end
$f$;
grant execute on function pg_temp.fx(text), pg_temp.hoje(), pg_temp.login(uuid) to public;

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-0000000081a1', 'home-decision@teste.com');
select pg_temp.login('00000000-0000-0000-0000-0000000081a1');
insert into fixture select 'household', public.create_household('Casa Home Decision');
insert into fixture select 'account', id from public.accounts
 where household_id = pg_temp.fx('household') and currency_code = 'BRL' limit 1;
insert into fixture select 'expense', id from public.categories
 where household_id = pg_temp.fx('household') and type = 'expense' and system_key = 'uncategorized' limit 1;
insert into fixture select 'income', id from public.categories
 where household_id = pg_temp.fx('household') and type = 'income' and system_key = 'uncategorized' limit 1;

insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status)
values
  (pg_temp.fx('household'), pg_temp.fx('account'), pg_temp.fx('income'), 'income', 'Receita paga', 3000, pg_temp.hoje(), 'paid'),
  (pg_temp.fx('household'), pg_temp.fx('account'), pg_temp.fx('expense'), 'expense', 'Despesa paga', 500, pg_temp.hoje(), 'paid'),
  (pg_temp.fx('household'), pg_temp.fx('account'), pg_temp.fx('expense'), 'expense', 'Conta planejada', 200, pg_temp.hoje() + 2, 'planned');

select ok(
  (select not p.prosecdef from pg_proc p
    where p.oid = 'public.get_home_decision_month(uuid,date)'::regprocedure),
  'H1 função é SECURITY INVOKER'
);
select is(
  (public.get_home_decision_month(pg_temp.fx('household'), date_trunc('month', pg_temp.hoje())::date)->>'moneyFree')::numeric,
  2300::numeric,
  'H2 dinheiro livre usa receitas e despesas pagas e planejadas do resumo do mês'
);
select is(
  jsonb_typeof(public.get_home_decision_month(pg_temp.fx('household'), date_trunc('month', pg_temp.hoje())::date)->'risks'),
  'array',
  'H3 riscos retornam como coleção estruturada'
);
select is(
  jsonb_typeof(public.get_home_decision_month(pg_temp.fx('household'), date_trunc('month', pg_temp.hoje())::date)->'monitoredCategories'),
  'array',
  'H4 categorias monitoradas retornam como coleção estruturada'
);

select * from finish();
rollback;
