-- 00_audit: estrutura, privilégios e funções. Roda como superusuário só para LER
-- o catálogo; não testa comportamento (isso é papel dos outros arquivos).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Tabelas e policies exatamente as esperadas (nada sobrando sem revisão)
select tables_are('public',
  array['accounts','budgets','categories','debt_events','debt_installments','debt_invoices','debts','household_members','households','invitations','profiles','transactions'],
  'schema public contém só as tabelas esperadas');

select is_empty($$
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity
$$, 'RLS ligada em toda tabela do schema public');

select policies_are('public','profiles',          array['profiles_select','profiles_update']);
select policies_are('public','households',        array['households_select','households_update']);
select policies_are('public','household_members', array['household_members_select']);
select policies_are('public','invitations',       array['invitations_select']);
select policies_are('public','accounts',          array['accounts_select','accounts_insert','accounts_update','accounts_delete']);
select policies_are('public','categories',        array['categories_select','categories_insert','categories_update','categories_delete']);
select policies_are('public','debts',             array['debts_select']);
select policies_are('public','debt_invoices',     array['debt_invoices_select']);
select policies_are('public','debt_installments', array['debt_installments_select']);
select policies_are('public','debt_events',       array['debt_events_select']);
select policies_are('public','transactions',      array['transactions_select','transactions_insert','transactions_update']);
select policies_are('public','budgets',           array['budgets_select','budgets_insert','budgets_update','budgets_delete']);

select is_empty($$
  select p.tablename, p.policyname from pg_policies p
   where p.schemaname = 'public' and not ('authenticated' = any (p.roles))
      or p.schemaname = 'public' and array_length(p.roles, 1) <> 1
$$, 'toda policy é TO authenticated e só para ele');

-- anon: nada
select is_empty($$
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public','private') and c.relkind in ('r','p','v','m')
     and (has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          or has_any_column_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,REFERENCES'))
$$, 'anon sem nenhum privilégio em tabelas (tabela ou coluna)');
select ok(not has_schema_privilege('anon', 'private', 'USAGE'), 'anon sem USAGE no schema private');
select ok(has_schema_privilege('authenticated', 'private', 'USAGE'), 'authenticated tem USAGE em private (as policies chamam is_member)');
select ok(not has_schema_privilege('authenticated', 'private', 'CREATE'), 'authenticated não cria objetos em private');
select ok(not has_schema_privilege('authenticated', 'public', 'CREATE'), 'authenticated não cria objetos em public');

-- authenticated: nenhum privilégio de tabela inteira de escrita; SELECT de tabela só onde esperado
select is_empty($$
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,TRUNCATE,REFERENCES,TRIGGER')
$$, 'authenticated sem INSERT/UPDATE/TRUNCATE/REFERENCES/TRIGGER no nível da tabela (só por coluna)');

select is_empty($$
  select t from unnest(array['transactions','household_members','invitations','households','profiles']) t
   where has_table_privilege('authenticated', 'public.' || t, 'DELETE')
$$, 'authenticated sem DELETE em transactions, household_members, invitations, households, profiles');

select is_empty($$
  select t from unnest(array['households','household_members','invitations','profiles','transactions']) t
   where has_any_column_privilege('authenticated', 'public.' || t, 'INSERT')
     and t in ('households','household_members','invitations','profiles')
$$, 'authenticated sem INSERT em households, household_members, invitations, profiles (só por RPC/trigger)');

select ok(not has_any_column_privilege('authenticated', 'public.household_members', 'UPDATE'), 'sem UPDATE em household_members');
select ok(not has_any_column_privilege('authenticated', 'public.invitations', 'UPDATE'), 'sem UPDATE em invitations');

-- Privilégios por coluna: o que o cliente NÃO pode tocar
select ok(not has_column_privilege('authenticated','public.transactions','household_id','UPDATE'), 'transactions.household_id imutável pelo cliente');
select ok(not has_column_privilege('authenticated','public.transactions','created_by','UPDATE'),   'transactions.created_by não atualizável');
select ok(not has_column_privilege('authenticated','public.transactions','created_by','INSERT'),   'transactions.created_by não informável (vem de auth.uid())');
select ok(not has_column_privilege('authenticated','public.transactions','id','UPDATE'),            'transactions.id imutável');
select ok(not has_column_privilege('authenticated','public.transactions','deleted_at','INSERT'),   'lançamento não nasce na lixeira');
select ok(not has_column_privilege('authenticated','public.accounts','household_id','UPDATE'),     'accounts.household_id imutável');
select ok(not has_column_privilege('authenticated','public.categories','system_key','INSERT'),     'categories.system_key não informável');
select ok(not has_column_privilege('authenticated','public.categories','system_key','UPDATE'),     'categories.system_key imutável');
select ok(not has_column_privilege('authenticated','public.categories','type','UPDATE'),           'categories.type imutável pelo cliente');
select ok(not has_column_privilege('authenticated','public.categories','household_id','UPDATE'),   'categories.household_id imutável');
select ok(not has_column_privilege('authenticated','public.households','member_limit','UPDATE'),  'households.member_limit só pelo administrador do banco');
select ok(not has_column_privilege('authenticated','public.invitations','token_hash','SELECT'),    'invitations.token_hash ilegível');
select ok(not has_column_privilege('authenticated','public.budgets','category_type','INSERT'),     'budgets.category_type não informável');
select ok(not has_column_privilege('authenticated','public.budgets','household_id','UPDATE'),      'budgets.household_id imutável');
select ok(not has_column_privilege('authenticated','public.budgets','category_id','UPDATE'),       'budgets.category_id imutável');
-- ...e o que PODE
select ok(has_column_privilege('authenticated','public.transactions','deleted_at','UPDATE'),       'lixeira = UPDATE deleted_at');
select ok(has_column_privilege('authenticated','public.transactions','amount','INSERT'),           'transactions.amount informável');
select ok(has_column_privilege('authenticated','public.accounts','opening_date','UPDATE'),         'accounts.opening_date editável (com guarda)');
select ok(has_column_privilege('authenticated','public.invitations','email','SELECT'),             'invitations.email legível (owner, via policy)');

-- Funções: exatamente as esperadas
select functions_are('public', array[
  'accept_invitation','account_balances','balance_totals','budget_usage','card_bill_due','card_items','card_months',
  'card_purchase','create_debt','create_debt_installments','create_debt_invoice','create_household','create_invitation','debt_anticipate','debt_balances','debt_bill',
  'debt_loan_event','debt_pay','debt_refund','debt_return','debt_void','delete_household','leave_household',
  'net_worth','period_summary','remove_member','set_card_cycle'],
  'funções do schema public');
select functions_are('private', array[
  'accounts_guard','budgets_guard','card_day_in_month','card_due_date','card_first_closing',
  'categories_guard','current_household','debt_balance','debt_chk','debt_chk_trg',
  'debt_effect','debt_events_guard','debt_installments_card_only','debt_installments_immutable','debt_lock','debt_money_guard','debts_immutable',
  'handle_new_user','is_member','is_owner','members_limit_guard','members_owner_guard','seed_default_categories',
  'shares_household','today_sp','touch_updated_at','transactions_guard'],
  'funções do schema private');

-- Nenhuma função com EXECUTE para PUBLIC (ACL nula = padrão do PostgreSQL = PUBLIC)
select is_empty($$
  select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public','private')
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
     and (p.proacl is null
          or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
$$, 'nenhuma função de public/private executável por PUBLIC');

select is_empty($$
  select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public','private')
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
     and has_function_privilege('anon', p.oid, 'EXECUTE')
$$, 'anon não executa nenhuma função');

select is(
  array(select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname in ('public','private')
           and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
           and has_function_privilege('authenticated', p.oid, 'EXECUTE')
         order by 1),
  array['private.is_member','private.is_owner','private.shares_household',
        'public.accept_invitation','public.account_balances','public.balance_totals',
        'public.budget_usage','public.card_bill_due','public.card_items','public.card_months','public.card_purchase','public.create_debt','public.create_debt_installments','public.create_debt_invoice',
        'public.create_household','public.create_invitation','public.debt_anticipate','public.debt_balances',
        'public.debt_bill','public.debt_loan_event','public.debt_pay','public.debt_refund','public.debt_return',
        'public.debt_void','public.delete_household','public.leave_household','public.net_worth',
        'public.period_summary','public.remove_member','public.set_card_cycle']::text[],
  'lista de funções executáveis por authenticated é exatamente a esperada (funções de trigger: nenhuma)');

-- Toda função tem search_path fixo; SECURITY DEFINER só nas esperadas
select is_empty($$
  select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public','private')
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
$$, 'toda função de public/private tem search_path fixo');

select is(
  array(select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname in ('public','private') and p.prosecdef
         order by 1),
  array['private.current_household','private.debt_balance','private.debt_chk','private.debt_chk_trg',
        'private.debt_lock','private.handle_new_user','private.is_member','private.is_owner',
        'private.members_owner_guard','private.seed_default_categories','private.shares_household',
        'public.accept_invitation','public.card_bill_due','public.card_purchase',
        'public.create_debt','public.create_debt_installments','public.create_debt_invoice',
        'public.create_household','public.create_invitation','public.debt_anticipate','public.debt_bill',
        'public.debt_loan_event','public.debt_pay','public.debt_refund','public.debt_return','public.debt_void',
        'public.delete_household','public.leave_household','public.remove_member','public.set_card_cycle']::text[],
  'SECURITY DEFINER apenas nas funções auditadas (seção 6.1 do plano)');

select is(
  array(select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname in ('account_balances','balance_totals','period_summary','budget_usage','debt_balances','net_worth')
           and not p.prosecdef order by 1),
  array['account_balances','balance_totals','budget_usage','debt_balances','net_worth','period_summary']::text[],
  'funções de relatório são SECURITY INVOKER (a RLS do chamador decide)');

-- Todas as tabelas de public têm dono = quem roda as migrations (e nenhuma tem FORCE: as RPCs
-- SECURITY DEFINER dependem de verificações internas, não da RLS)
select is_empty($$
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relforcerowsecurity
$$, 'nenhuma tabela com FORCE ROW LEVEL SECURITY (decisão registrada no plano)');

select * from finish();
rollback;
