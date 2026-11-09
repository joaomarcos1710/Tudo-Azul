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

-- A família recém-criada não possui contas padrão: crie a fixture explicitamente.
insert into public.accounts (household_id, name, type, initial_balance, opening_date, currency_code)
values
  (pg_temp.fx('household'), 'Conta corrente', 'checking', 0, pg_temp.hoje(), 'BRL'),
  (pg_temp.fx('household'), 'Conta em dólar', 'checking', 0, pg_temp.hoje(), 'USD');
insert into fixture select 'account', id from public.accounts
 where household_id = pg_temp.fx('household') and name = 'Conta corrente';
insert into fixture select 'account_usd', id from public.accounts
 where household_id = pg_temp.fx('household') and name = 'Conta em dólar';
insert into fixture select 'expense', id from public.categories
 where household_id = pg_temp.fx('household') and type = 'expense' and system_key = 'uncategorized' limit 1;
insert into fixture select 'income', id from public.categories
 where household_id = pg_temp.fx('household') and type = 'income' and system_key = 'uncategorized' limit 1;

insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status)
values
  (pg_temp.fx('household'), pg_temp.fx('account'), pg_temp.fx('income'), 'income', 'Receita paga', 3000, pg_temp.hoje(), 'paid'),
  (pg_temp.fx('household'), pg_temp.fx('account'), pg_temp.fx('expense'), 'expense', 'Despesa paga', 500, pg_temp.hoje(), 'paid'),
  (pg_temp.fx('household'), pg_temp.fx('account'), pg_temp.fx('expense'), 'expense', 'Conta planejada', 200, pg_temp.hoje() + 2, 'planned'),
  (pg_temp.fx('household'), pg_temp.fx('account_usd'), pg_temp.fx('expense'), 'expense', 'Despesa em dólar', 4000, pg_temp.hoje() + 2, 'planned');

select ok(
  (select not p.prosecdef from pg_proc p
    where p.oid = 'public.get_home_decision_month(uuid,date)'::regprocedure),
  'H1 função é SECURITY INVOKER'
);
select is(
  (public.get_home_decision_month(pg_temp.fx('household'), date_trunc('month', pg_temp.hoje())::date)->>'moneyFree')::numeric,
  2300::numeric,
  'H2 dinheiro livre parte da tesouraria e abate os compromissos pendentes BRL'
);
select is(
  (public.get_home_decision_month(pg_temp.fx('household'), date_trunc('month', pg_temp.hoje())::date)->>'moneyFree')::numeric,
  2300::numeric,
  'H2.1 despesas em moeda estrangeira não são somadas como se fossem BRL'
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


-- Viagem no tempo: o realizado nunca pode incluir pagamentos com data posterior ao corte.
insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status)
values
  (pg_temp.fx('household'), pg_temp.fx('account'), pg_temp.fx('expense'), 'expense', 'Outubro dia 01', 100, '2026-10-01', 'paid'),
  (pg_temp.fx('household'), pg_temp.fx('account'), pg_temp.fx('expense'), 'expense', 'Outubro dia 10', 200, '2026-10-10', 'paid'),
  (pg_temp.fx('household'), pg_temp.fx('account'), pg_temp.fx('expense'), 'expense', 'Outubro dia 15', 150, '2026-10-15', 'paid'),
  (pg_temp.fx('household'), pg_temp.fx('account'), pg_temp.fx('expense'), 'expense', 'Pagamento futuro já marcado pago', 999, '2026-10-20', 'paid');

with nova as (
  insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status)
  values (pg_temp.fx('household'), pg_temp.fx('account'), pg_temp.fx('expense'), 'expense', 'Conta planejada de outubro', 500, '2026-10-20', 'planned')
  returning id
)
insert into fixture select 'planned_october', id from nova;

select is(
  (select spent from public.month_projection(pg_temp.fx('household'), '2026-10-01', '2026-10-01')),
  100::numeric,
  'M1 dia 1: realizado considera somente pagamentos até a data de corte'
);
select is(
  (select days_elapsed from public.month_projection(pg_temp.fx('household'), '2026-10-01', '2026-10-01')),
  1,
  'M2 dia 1: denominador protegido e igual a um'
);
select is(
  (select spent from public.month_projection(pg_temp.fx('household'), '2026-10-01', '2026-10-15')),
  450::numeric,
  'M3 dia 15: ignora o pagamento futuro de 999 já marcado como pago'
);
select is(
  (select pace_per_day from public.month_projection(pg_temp.fx('household'), '2026-10-01', '2026-10-15')),
  30::numeric,
  'M4 dia 15: ritmo diário divide 450 por 15 dias corridos'
);
select is(
  (select projected from public.month_projection(pg_temp.fx('household'), '2026-10-01', '2026-10-15')),
  1430::numeric,
  'M5 dia 15: projeção combina realizado, planejado e ritmo variável sem antecipar o pagamento futuro'
);

update public.transactions set status = 'paid' where id = pg_temp.fx('planned_october');
select is(
  (select days_left from public.month_projection(pg_temp.fx('household'), '2026-10-01', '2026-10-31')),
  0,
  'M6 dia 31: não restam dias no mês'
);
select is(
  (select projected from public.month_projection(pg_temp.fx('household'), '2026-10-01', '2026-10-31')),
  (select spent from public.month_projection(pg_temp.fx('household'), '2026-10-01', '2026-10-31')),
  'M7 dia 31: projeção coincide exatamente com o realizado quando não há planejados'
);

select is(
  jsonb_typeof(public.get_home_decision_month(pg_temp.fx('household'), date_trunc('month', pg_temp.hoje())::date)->'upcoming_commitments'),
  'array',
  'H5 compromissos são entregues em uma coleção unificada'
);
select is(
  public.get_home_decision_month(pg_temp.fx('household'), date_trunc('month', pg_temp.hoje())::date)->'opportunities',
  'null'::jsonb,
  'H6 oportunidades ficam nulas enquanto não houver regra objetiva de superávit'
);

select * from finish();
rollback;
