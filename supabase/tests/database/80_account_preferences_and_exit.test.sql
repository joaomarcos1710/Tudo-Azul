-- 80: preferências individuais, limpeza restrita de lançamentos e exclusão de conta preservando o histórico familiar.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

select has_table('public','user_preferences','preferências individuais existem');
select has_column('public','user_preferences','ordem_lancamentos','ordenação é persistida');
select has_column('public','user_preferences','periodo_padrao','período padrão é persistido');
select has_column('public','user_preferences','saldo_diario','exibição do saldo diário é persistida');
select ok((select relrowsecurity from pg_class where oid = 'public.user_preferences'::regclass),
  'preferências têm RLS habilitado');
select ok((select count(*) = 3 from pg_policies where schemaname = 'public' and tablename = 'user_preferences'),
  'há políticas próprias para SELECT, INSERT e UPDATE');
select ok(has_table_privilege('authenticated','public.user_preferences','SELECT')
  and has_table_privilege('authenticated','public.user_preferences','INSERT')
  and has_table_privilege('authenticated','public.user_preferences','UPDATE')
  and not has_table_privilege('authenticated','public.user_preferences','DELETE'),
  'usuário autenticado pode ler e alterar somente sua preferência, sem hard delete');
select ok(not has_table_privilege('anon','public.user_preferences','SELECT'),
  'usuário anônimo não lê preferências');

select has_function('public','prepare_account_deletion',array['uuid'],
  'função de preparação da exclusão existe');
select has_function('public','rollback_account_deletion',array['jsonb'],
  'função de reversão da titularidade existe');
select ok(has_function_privilege('service_role','public.prepare_account_deletion(uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.prepare_account_deletion(uuid)','EXECUTE')
  and not has_function_privilege('anon','public.prepare_account_deletion(uuid)','EXECUTE'),
  'somente service_role pode preparar exclusão de conta');
select ok(has_function_privilege('service_role','public.rollback_account_deletion(jsonb)','EXECUTE')
  and not has_function_privilege('authenticated','public.rollback_account_deletion(jsonb)','EXECUTE'),
  'somente service_role pode reverter a transferência');
select ok((select prosecdef from pg_proc where oid = 'public.prepare_account_deletion(uuid)'::regprocedure),
  'preparação executa com privilégio controlado no servidor');
select ok((select prosecdef from pg_proc where oid = 'public.rollback_account_deletion(jsonb)'::regprocedure),
  'reversão executa com privilégio controlado no servidor');


select has_function('public','account_balances_daily',array['uuid','date','date'],
  'saldo diário vem da fonte oficial de saldos por conta e moeda');
select ok(has_function_privilege('authenticated','public.account_balances_daily(uuid,date,date)','EXECUTE')
  and not has_function_privilege('anon','public.account_balances_daily(uuid,date,date)','EXECUTE'),
  'série diária só é consultável por sessão autenticada');
select ok(not (select prosecdef from pg_proc where oid = 'public.account_balances_daily(uuid,date,date)'::regprocedure),
  'série diária respeita RLS como função invoker');

select has_function('public','clear_household_transactions',array['uuid','text'],
  'função de limpeza restrita de lançamentos existe');
select ok(has_function_privilege('authenticated','public.clear_household_transactions(uuid,text)','EXECUTE')
  and not has_function_privilege('anon','public.clear_household_transactions(uuid,text)','EXECUTE'),
  'limpeza disponível apenas para sessão autenticada');
select ok((select prosecdef from pg_proc where oid = 'public.clear_household_transactions(uuid,text)'::regprocedure),
  'limpeza verifica titularidade no servidor');

select ok(not exists (
  select 1 from pg_constraint
  where conname in (
    'family_assets_created_by_fkey',
    'family_asset_valuations_created_by_fkey',
    'investment_distributions_created_by_fkey',
    'investment_operations_created_by_fkey',
    'investment_operations_voided_by_fkey',
    'investment_valuations_created_by_fkey'
  ) and confdeltype <> 'n'
), 'exclusão de perfil não bloqueia nem apaga bens e histórico de investimentos');

select ok(not exists (
  select 1 from information_schema.columns
  where table_schema='public'
    and ((table_name='family_assets' and column_name='created_by')
      or (table_name='family_asset_valuations' and column_name='created_by')
      or (table_name='investment_distributions' and column_name='created_by')
      or (table_name='investment_operations' and column_name='created_by')
      or (table_name='investment_valuations' and column_name='created_by'))
    and is_nullable <> 'YES'
), 'autoria pessoal pode ser anonimizada sem apagar registros familiares');


-- Testes comportamentais da limpeza: somente titular, frase exata e isolamento entre famílias.
create temp table fixture80 (k text primary key, v uuid);
create temp table fixture80_txt (k text primary key, v text);
grant all on fixture80, fixture80_txt to public;
create function pg_temp.fx80(p_k text) returns uuid language sql as $f$
  select v from fixture80 where k = p_k
$f$;
create function pg_temp.login80(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end
$f$;
create function pg_temp.sqlstate80(p_sql text) returns text language plpgsql as $f$
begin
  execute p_sql;
  return null;
exception when others then return sqlstate;
end
$f$;
grant execute on function pg_temp.fx80(text), pg_temp.login80(uuid), pg_temp.sqlstate80(text) to public;

insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-0000000080a1','prefs-owner@teste.com'),
 ('00000000-0000-0000-0000-0000000080a2','prefs-member@teste.com'),
 ('00000000-0000-0000-0000-0000000080a3','prefs-other@teste.com');

select pg_temp.login80('00000000-0000-0000-0000-0000000080a1');
insert into fixture80 select 'household', public.create_household('Família Preferências');
insert into fixture80_txt select 'invite', public.create_invitation('prefs-member@teste.com');
reset role;
select pg_temp.login80('00000000-0000-0000-0000-0000000080a2');
select public.accept_invitation((select v from fixture80_txt where k='invite'));
reset role;
select pg_temp.login80('00000000-0000-0000-0000-0000000080a3');
insert into fixture80 select 'other_household', public.create_household('Outra Família');
with a as (
  insert into public.accounts (household_id,name,type,initial_balance,opening_date)
  values (pg_temp.fx80('other_household'),'Conta vizinha','checking',250,'2026-10-01') returning id
) insert into fixture80 select 'other_account',id from a;
insert into fixture80 select 'other_category',id from public.categories
  where household_id=pg_temp.fx80('other_household') and name='Compras pessoais' and type='expense' limit 1;
insert into public.transactions (household_id,account_id,category_id,type,description,amount,date,status)
values (pg_temp.fx80('other_household'),pg_temp.fx80('other_account'),pg_temp.fx80('other_category'),
  'expense','Lançamento da vizinha',12,'2026-11-01','paid');
reset role;

select pg_temp.login80('00000000-0000-0000-0000-0000000080a1');
with a as (
  insert into public.accounts (household_id,name,type,initial_balance,opening_date)
  values (pg_temp.fx80('household'),'Conta preservada','checking',1000,'2026-10-01') returning id
) insert into fixture80 select 'account',id from a;
insert into fixture80 select 'expense_category',id from public.categories where household_id=pg_temp.fx80('household') and name='Compras pessoais' and type='expense' limit 1;
insert into fixture80 select 'asset', public.investment_asset_create(
  pg_temp.fx80('household'),'Ativo de teste','TEST','fund','BRL'
);
insert into public.transactions (household_id,account_id,category_id,type,description,amount,date,status)
values
 (pg_temp.fx80('household'),pg_temp.fx80('account'),pg_temp.fx80('expense_category'),'expense','Pago',10,'2026-11-01','paid'),
 (pg_temp.fx80('household'),pg_temp.fx80('account'),pg_temp.fx80('expense_category'),'expense','Planejado',20,'2026-11-02','planned');
with tx as (
  insert into public.transactions (household_id,account_id,category_id,type,description,amount,date,status)
  values (pg_temp.fx80('household'),pg_temp.fx80('account'),pg_temp.fx80('expense_category'),'expense','Na lixeira',5,'2026-11-03','paid')
  returning id
) update public.transactions set deleted_at=now() where id=(select id from tx);
select public.investment_distribution_record(pg_temp.fx80('asset'),'dividend','2026-11-04',3,pg_temp.fx80('account'));
reset role;

-- Membro, titular de outra família e frase incorreta não podem apagar.
select pg_temp.login80('00000000-0000-0000-0000-0000000080a2');
select is(pg_temp.sqlstate80(format(
  $q$select public.clear_household_transactions(%L,'excluir transações')$q$,pg_temp.fx80('household')
)), '42501', 'membro não titular não pode limpar os lançamentos');
reset role;
select pg_temp.login80('00000000-0000-0000-0000-0000000080a3');
select is(pg_temp.sqlstate80(format(
  $q$select public.clear_household_transactions(%L,'excluir transações')$q$,pg_temp.fx80('household')
)), '42501', 'outra família não pode ser limpa');
reset role;
select pg_temp.login80('00000000-0000-0000-0000-0000000080a1');
select is(pg_temp.sqlstate80(format(
  $q$select public.clear_household_transactions(%L,'errado')$q$,pg_temp.fx80('household')
)), '22023', 'frase incorreta é recusada');

-- Titular limpa pagos, planejados, lixeira e provento vinculado.
select is((public.clear_household_transactions(pg_temp.fx80('household'),'  EXCLUIR TRANSAÇÕES  ')->>'transactions_deleted')::int,
  4, 'titular remove todos os quatro lançamentos da família');
select is((select count(*) from public.transactions where household_id=pg_temp.fx80('household')),0::bigint,
  'nenhum lançamento ativo, planejado ou na lixeira permanece');
select is((select count(*) from public.investment_distributions where household_id=pg_temp.fx80('household')),0::bigint,
  'provento vinculado é removido pela cascata da FK');
select is((select count(*) from public.accounts where household_id=pg_temp.fx80('household')),1::bigint,
  'conta permanece cadastrada');
select ok((select count(*) > 0 from public.categories where household_id=pg_temp.fx80('household') and type='expense'),
  'categorias permanecem cadastradas');
select is((select count(*) from public.investment_assets where household_id=pg_temp.fx80('household')),1::bigint,
  'ativo de investimento permanece cadastrado');
select is((select balance from public.account_balances(pg_temp.fx80('household'),'2026-11-30')
  where account_id=pg_temp.fx80('account')),1000::numeric,
  'saldo volta ao saldo inicial da conta');
select is((select count(*) from public.transactions where household_id=pg_temp.fx80('other_household')),1::bigint,
  'lançamento da outra família permanece intacto');
select is((public.clear_household_transactions(pg_temp.fx80('household'),'excluir transações')->>'transactions_deleted')::int,
  0, 'repetir a operação numa família vazia não apaga mais nada');
reset role;

select * from finish();
rollback;
