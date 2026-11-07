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

select * from finish();
rollback;
