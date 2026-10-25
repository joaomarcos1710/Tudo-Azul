-- 19_income_regularity: migration 012. Renda regular × eventual e cobertura da despesa pela renda regular.
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
create function pg_temp.reg(p_from date, p_to date) returns text language sql as $f$
  select income_regular::numeric(14,2) || '|' || income_eventual::numeric(14,2) || '|' || expense_paid::numeric(14,2)
         || '|' || coalesce(coverage_pct::text, 'null')
    from public.income_regularity(pg_temp.fx('h'), p_from, p_to) $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.sqlstate_of(text), pg_temp.reg(date, date) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000019a1', 'r1@teste.com'),
  ('00000000-0000-0000-0000-0000000019a2', 'r2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000019a1');
insert into fixture select 'h', public.create_household('Casa Regular');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 0, '2026-01-01') returning id)
  insert into fixture select 'bank', id from i;
insert into fixture select 'sal', id from public.categories where household_id = pg_temp.fx('h') and name = 'Salário';
insert into fixture select 'despesa', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';
insert into fixture select 'semcat', id from public.categories where household_id = pg_temp.fx('h') and type = 'income' and system_key = 'uncategorized';
with c as (insert into public.categories (household_id, name, type) values (pg_temp.fx('h'), '13º salário', 'income') returning id)
  insert into fixture select '13', id from c;
with c as (insert into public.categories (household_id, name, type, parent_id) values (pg_temp.fx('h'), 'Bônus', 'income', pg_temp.fx('13')) returning id)
  insert into fixture select 'bonus', id from c;

insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status) values
  (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('sal'),   'income',  'Salário', 5000.00, '2026-10-10', 'paid'),
  (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('13'),    'income',  '13º',     2000.00, '2026-10-12', 'paid'),
  (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('bonus'), 'income',  'Bônus',    500.00, '2026-10-13', 'paid'),
  (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('sal'),   'income',  'Previsto',  999.00, '2026-10-28', 'planned'),
  (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('despesa'), 'expense', 'Mercado', 4000.00, '2026-10-15', 'paid');

select is(pg_temp.reg('2026-10-01', '2026-10-31'), '7500.00|0.00|4000.00|187.5',
          'RG1 sem nenhuma marca, tudo é renda regular (padrão): 7.500,00 e cobertura 187,5%');

update public.categories set eventual = true where id = pg_temp.fx('13');
select is(pg_temp.reg('2026-10-01', '2026-10-31'), '5000.00|2500.00|4000.00|125.0',
          'RG2 13º marcado como eventual; a subcategoria Bônus herda a marca da mãe; planejado fica de fora');

-- o total do mês do app não muda com a marca
select is((select income_paid from public.period_summary(pg_temp.fx('h'), '2026-10-01', '2026-10-31')), 7500.00::numeric,
          'RG3 a marca não muda a receita total do mês (7.500,00)');

-- marcar só a subcategoria
update public.categories set eventual = false where id = pg_temp.fx('13');
update public.categories set eventual = true where id = pg_temp.fx('bonus');
select is(pg_temp.reg('2026-10-01', '2026-10-31'), '7000.00|500.00|4000.00|175.0', 'RG4 marcando só a subcategoria, só ela vira eventual');

-- lançamento excluído não conta
update public.transactions set deleted_at = now() where description = 'Bônus';
select is(pg_temp.reg('2026-10-01', '2026-10-31'), '7000.00|0.00|4000.00|175.0', 'RG5 lançamento na lixeira não entra');

-- período sem despesa: cobertura nula, não divisão por zero
select is(pg_temp.reg('2026-09-01', '2026-09-30'), '0.00|0.00|0.00|null', 'RG6 sem despesa no período, cobertura é nula');

-- regras de integridade
select is(pg_temp.sqlstate_of(format($$update public.categories set eventual = true where id = %L$$, pg_temp.fx('despesa'))), '23514',
          'RG7 categoria de despesa não pode ser eventual');
select is(pg_temp.sqlstate_of(format($$update public.categories set eventual = true where id = %L$$, pg_temp.fx('semcat'))), '23514',
          'RG8 "Sem categoria" não pode ser eventual');

-- isolamento
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000019a2');
insert into fixture select 'h2', public.create_household('Casa Alheia');
select is((select count(*) from public.income_regularity(pg_temp.fx('h'), '2026-10-01', '2026-10-31')), 0::bigint,
          'RG9 outra família não lê o relatório da minha');
select is(pg_temp.sqlstate_of(format($$update public.categories set eventual = false where id = %L$$, pg_temp.fx('bonus'))), null,
          'RG10 update em categoria alheia não falha, mas não muda nada (RLS filtra)');
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000019a1');
select is((select eventual from public.categories where id = pg_temp.fx('bonus')), true, 'RG11 a marca da minha subcategoria continua intacta');

select * from finish();
rollback;
