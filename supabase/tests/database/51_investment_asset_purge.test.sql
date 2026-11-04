-- 51_investment_asset_purge: migration 050. Excluir ativo com o histórico, confirmando pelo nome.
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
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.hoje(), pg_temp.sqlstate_of(text) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000051a1', 'p1@teste.com'),
  ('00000000-0000-0000-0000-0000000051a2', 'p2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000051a1');
insert into fixture select 'h', public.create_household('Casa Purge');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Corretora', 'checking', 1000, pg_temp.hoje() - 90) returning id)
  insert into fixture select 'conta', id from i;
insert into fixture select 'cdb', public.investment_asset_create(pg_temp.fx('h'), 'CDB Teste', null, 'fixed_income', 'BRL');
insert into fixture select 'outro', public.investment_asset_create(pg_temp.fx('h'), 'Outro', null, 'other', 'BRL');
select public.investment_operation_record(pg_temp.fx('cdb'), pg_temp.hoje() - 10, 'buy', 10, 10, 0, null);
select public.investment_operation_record(pg_temp.fx('cdb'), pg_temp.hoje() - 5, 'buy', 5, 10, 0, null);
select public.investment_valuation_record(pg_temp.fx('cdb'), pg_temp.hoje() - 1, 11, 'Manual');
select public.investment_operation_record(pg_temp.fx('outro'), pg_temp.hoje() - 10, 'buy', 1, 10, 0, null);
insert into fixture select 'prov', public.investment_distribution_record(pg_temp.fx('cdb'), 'dividend', pg_temp.hoje() - 2, 7.50, pg_temp.fx('conta'));
create temp table saldo_antes as
  select coalesce(sum(case when type = 'income' then amount else 0 end), 0) as receitas
    from public.transactions where household_id = pg_temp.fx('h') and deleted_at is null;
grant select on saldo_antes to public;

select is(pg_temp.sqlstate_of($$select public.investment_asset_delete(pg_temp.fx('cdb'))$$), '55000',
  'P0 o botão comum continua travado com histórico');
select is(pg_temp.sqlstate_of($$select * from public.investment_asset_purge(pg_temp.fx('cdb'), 'CDB')$$), '22023',
  'P1 nome errado: recusa');
select is(pg_temp.sqlstate_of($$select * from public.investment_asset_purge(pg_temp.fx('cdb'), null)$$), '22023',
  'P1.1 sem nome: recusa');
select ok(exists(select 1 from public.investment_assets where id = pg_temp.fx('cdb')), 'P1.2 depois da recusa o ativo continua');

select pg_temp.login('00000000-0000-0000-0000-0000000051a2');
select is(pg_temp.sqlstate_of($$select * from public.investment_asset_purge(pg_temp.fx('cdb'), 'CDB Teste')$$), '42501',
  'P2 quem não é da família não exclui');

select pg_temp.login('00000000-0000-0000-0000-0000000051a1');
select is((select row(p.*)::text from public.investment_asset_purge(pg_temp.fx('cdb'), '  CDB Teste ') p), '(2,1,1)',
  'P3 nome certo (espaços ignorados): sai com 2 operações, 1 avaliação e 1 provento');
select ok(not exists(select 1 from public.investment_assets where id = pg_temp.fx('cdb')), 'P3.1 ativo excluído');
select is((select count(*)::int from public.investment_operations where asset_id = pg_temp.fx('cdb')), 0, 'P3.2 sem operações');
select is((select count(*)::int from public.investment_valuations where asset_id = pg_temp.fx('cdb')), 0, 'P3.3 sem avaliações');
select is((select coalesce(sum(case when type = 'income' then amount else 0 end), 0) from public.transactions
            where household_id = pg_temp.fx('h') and deleted_at is null), (select receitas from saldo_antes),
  'P4 a receita do provento fica na conta (saldo não muda)');
select is((select count(*)::int from public.investment_operations where asset_id = pg_temp.fx('outro')), 1, 'P5 outro ativo intacto');

reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.sqlstate_of($$select * from public.investment_asset_purge(pg_temp.fx('outro'), 'Outro')$$), '42501', 'P6 sem login: recusa');

select * from finish();
rollback;
