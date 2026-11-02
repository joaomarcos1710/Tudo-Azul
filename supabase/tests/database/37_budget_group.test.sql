-- 37_budget_group: migration 032. Grupo da regra 50-30-20 nas categorias de despesa e relatório por grupo.
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
create function pg_temp.rel() returns text language sql as $f$
  select string_agg(grp || '=' || amount::numeric(14,2) || '/' || share_expense || '/' || coalesce(share_income::text, 'null'), ' ' order by array_position(array['essential','lifestyle','investment','none'], grp))
    from public.budget_rule_report(pg_temp.fx('h'), '2026-10-01', '2026-10-31') $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.sqlstate_of(text), pg_temp.rel() to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000037a1', 'g1@teste.com'),
  ('00000000-0000-0000-0000-0000000037a2', 'g2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000037a1');
insert into fixture select 'h', public.create_household('Casa Grupo');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 0, '2026-01-01') returning id)
  insert into fixture select 'bank', id from i;
insert into fixture select 'sal', id from public.categories where household_id = pg_temp.fx('h') and name = 'Salário';
with c as (insert into public.categories (household_id, name, type) values
  (pg_temp.fx('h'), 'Moradia X', 'expense') returning id) insert into fixture select 'mor', id from c;
with c as (insert into public.categories (household_id, name, type, parent_id) values
  (pg_temp.fx('h'), 'Aluguel X', 'expense', pg_temp.fx('mor')) returning id) insert into fixture select 'alu', id from c;
with c as (insert into public.categories (household_id, name, type) values
  (pg_temp.fx('h'), 'Lazer X', 'expense') returning id) insert into fixture select 'laz', id from c;
with c as (insert into public.categories (household_id, name, type) values
  (pg_temp.fx('h'), 'Outros X', 'expense') returning id) insert into fixture select 'out', id from c;

select is((select count(*) from public.categories where household_id = pg_temp.fx('h') and budget_group is not null),
          0::bigint, 'G0 nenhuma categoria nasce classificada (nem as padrão)');

-- classificar: despesa comum aceita; receita e "Sem categoria" não
select lives_ok($$update public.categories set budget_group = 'essential' where id = pg_temp.fx('mor')$$, 'G1 despesa aceita grupo');
select lives_ok($$update public.categories set budget_group = 'lifestyle' where id = pg_temp.fx('laz')$$, 'G1.1 outro grupo');
select is(pg_temp.sqlstate_of($$update public.categories set budget_group = 'essential' where id = pg_temp.fx('sal')$$),
          '23514', 'G2 receita não aceita grupo');
select is(pg_temp.sqlstate_of($$update public.categories set budget_group = 'essential' where household_id = pg_temp.fx('h') and system_key = 'uncategorized' and type = 'expense'$$),
          '23514', 'G3 "Sem categoria" não aceita grupo');
select is(pg_temp.sqlstate_of($$update public.categories set budget_group = 'qualquer' where id = pg_temp.fx('laz')$$),
          '23514', 'G4 valor fora da lista é recusado');
select is(pg_temp.sqlstate_of($$insert into public.categories (household_id, name, type, budget_group) values (pg_temp.fx('h'), 'Nasce com grupo', 'expense', 'essential')$$),
          '42501', 'G5 o grupo não é informável na criação (só por update)');

-- relatório: filha herda o grupo da mãe; sem grupo vai para "none"
insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status) values
  (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('sal'), 'income',  'Salário',  1000.00, '2026-10-05', 'paid'),
  (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('alu'), 'expense', 'Aluguel',   300.00, '2026-10-06', 'paid'),
  (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('mor'), 'expense', 'Luz',       100.00, '2026-10-07', 'paid'),
  (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('laz'), 'expense', 'Cinema',    200.00, '2026-10-08', 'paid'),
  (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('out'), 'expense', 'Diversos',  100.00, '2026-10-09', 'paid'),
  (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('laz'), 'expense', 'Planejado', 999.00, '2026-10-20', 'planned'),
  (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('laz'), 'expense', 'Fora',      999.00, '2026-09-20', 'paid');
select is(pg_temp.rel(),
  'essential=400.00/57.1/40.0 lifestyle=200.00/28.6/20.0 investment=0.00/0.0/0.0 none=100.00/14.3/10.0',
  'R1 filha herda o grupo da mãe; sem grupo vai para none; só pago e só no período');
select is((select sum(amount) from public.budget_rule_report(pg_temp.fx('h'), '2026-10-01', '2026-10-31')),
          (select expense_paid from public.period_summary(pg_temp.fx('h'), '2026-10-01', '2026-10-31')),
          'R2 a soma dos grupos é a despesa paga do period_summary');
select is((select count(*) from public.budget_rule_report(pg_temp.fx('h'), '2027-01-01', '2027-01-31') where share_income is null),
          4::bigint, 'R3 mês sem renda: % da renda nulo (não divide por zero), 4 linhas');

-- outra família e anon
select pg_temp.login('00000000-0000-0000-0000-0000000037a2');
insert into fixture select 'h2', public.create_household('Casa Outra');
select is((select count(*) from public.budget_rule_report(pg_temp.fx('h'), '2026-10-01', '2026-10-31')), 0::bigint,
          'R4 quem não é da família recebe zero linhas');
select is((select count(*) from public.categories where id = pg_temp.fx('laz')), 0::bigint, 'R5 e nem enxerga a categoria (RLS)');
select set_config('request.jwt.claims', '{}', true), set_config('role', 'anon', true);
select is(pg_temp.sqlstate_of($$select * from public.budget_rule_report(pg_temp.fx('h'), '2026-10-01', '2026-10-31')$$),
          '42501', 'R6 anon não executa');

select * from finish();
rollback;
