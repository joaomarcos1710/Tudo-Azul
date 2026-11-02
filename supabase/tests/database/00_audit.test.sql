-- 00_audit: estrutura, privilégios e funções. Roda como superusuário só para LER
-- o catálogo; não testa comportamento (isso é papel dos outros arquivos).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Tabelas e policies exatamente as esperadas (nada sobrando sem revisão)
select tables_are('public',
  array['account_reconciliations','accounts','budgets','categories','currencies','debt_events','debt_installment_edits','debt_installments','debt_invoices','debts','fx_rates','household_members','household_resets','households','invitations','investment_assets','investment_distributions','investment_operations','investment_valuations','profiles','recurrences','transactions'],
  'schema public contém só as tabelas esperadas');

select is_empty($$
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity
$$, 'RLS ligada em toda tabela do schema public');

select policies_are('public','profiles',          array['profiles_select','profiles_update']);
select policies_are('public','households',        array['households_select','households_update']);
select policies_are('public','household_members', array['household_members_select']);
select policies_are('public','invitations',       array['invitations_select']);
select policies_are('public','investment_assets', array['investment_assets_select']);
select policies_are('public','investment_distributions', array['investment_distributions_select']);
select policies_are('public','investment_operations', array['investment_operations_select']);
select policies_are('public','investment_valuations', array['investment_valuations_select']);
select policies_are('public','accounts',          array['accounts_select','accounts_insert','accounts_update','accounts_delete']);
select policies_are('public','categories',        array['categories_select','categories_insert','categories_update','categories_delete']);
select policies_are('public','currencies',        array['currencies_select']);
select policies_are('public','fx_rates',           array['fx_rates_select']);
select policies_are('public','debts',             array['debts_select']);
select policies_are('public','debt_invoices',     array['debt_invoices_select']);
select policies_are('public','debt_installments', array['debt_installments_select']);
select policies_are('public','debt_events',       array['debt_events_select']);
select policies_are('public','transactions',      array['transactions_select','transactions_insert','transactions_update']);
select policies_are('public','budgets',           array['budgets_select','budgets_insert','budgets_update','budgets_delete']);
select policies_are('public','recurrences',       array['recurrences_select']);
select policies_are('public','account_reconciliations', array['account_reconciliations_select']);
select policies_are('public','household_resets', array['household_resets_select']);

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
  'accept_invitation','account_balances','account_balances_projected','account_delete','account_movements','balance_totals','balance_totals_projected','budget_projection','budget_rule_report','budget_usage','card_bill_due','card_installment_edit','card_invoices_due','card_invoices_month','card_invoice_reopen','card_items','card_limits','card_months',
  'card_purchase','card_purchase_delete','card_purchase_delete_preview','cash_flow_report','create_card','create_debt','create_debt_installments','create_debt_invoice','create_household','create_invitation','daily_expenses','debt_anticipate','debt_balances','debt_bill',
  'debt_archive','debt_delete','debt_loan_event','debt_pay','debt_record_payment','debt_refund','debt_rename','debt_return','debt_set_terms','debt_unarchive','debt_void','delete_household','expenses_by_category','fx_rate_at','income_regularity','investment_allocation','investment_asset_create','investment_asset_set_subclass','investment_distribution_record','investment_income_by_asset','investment_operation_record','investment_portfolio','investment_totals','investment_valuation_record','leave_household',
  'month_projection','net_worth','period_summary','reconcile_account','recurrence_create','recurrence_delete','recurrence_end','recurrence_materialize','recurrence_update',
  'reconciliation_undo','remove_member','reset_household','reset_preview','set_card_cycle','set_card_identity','set_card_limit','set_card_pay_account'],
  'funções do schema public');
select functions_are('private', array[
  'accounts_guard','accounts_period_guard','budgets_guard','card_day_in_month','card_due_date','card_first_closing','card_recurrence_pending',
  'card_reopen_invoice','card_void_events','categories_guard','current_household','debt_balance','debt_chk','debt_chk_trg',
  'debt_effect','debt_events_guard','debt_events_period_guard','expense_items','fx_rates_immutable','debt_installments_card_only','debt_installments_immutable','debt_lock','debt_money_guard','debts_immutable',
  'handle_new_user','is_member','is_owner','members_limit_guard','members_owner_guard','reconciled_until','recurrence_lock','recurrence_occurrences','recurrences_money_guard','seed_default_categories',
  'shares_household','today_sp','touch_updated_at','transactions_guard','transactions_period_guard'],
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
  array['private.card_recurrence_pending','private.expense_items','private.is_member','private.is_owner','private.reconciled_until','private.recurrence_occurrences','private.shares_household',
        'public.accept_invitation','public.account_balances','public.account_balances_projected','public.account_delete','public.account_movements','public.balance_totals','public.balance_totals_projected',
        'public.budget_projection','public.budget_rule_report','public.budget_usage','public.card_bill_due','public.card_installment_edit','public.card_invoice_reopen','public.card_invoices_due','public.card_invoices_month','public.card_items','public.card_limits','public.card_months','public.card_purchase','public.card_purchase_delete','public.card_purchase_delete_preview','public.cash_flow_report','public.create_card','public.create_debt','public.create_debt_installments','public.create_debt_invoice',
        'public.create_household','public.create_invitation','public.daily_expenses','public.debt_anticipate','public.debt_archive','public.debt_balances',
        'public.debt_bill','public.debt_delete','public.debt_loan_event','public.debt_pay','public.debt_record_payment','public.debt_refund','public.debt_rename','public.debt_return','public.debt_set_terms','public.debt_unarchive',
        'public.debt_void','public.delete_household','public.expenses_by_category','public.fx_rate_at','public.income_regularity','public.investment_allocation','public.investment_asset_create','public.investment_asset_set_subclass','public.investment_distribution_record','public.investment_income_by_asset','public.investment_operation_record','public.investment_portfolio','public.investment_totals','public.investment_valuation_record','public.leave_household','public.month_projection','public.net_worth',
        'public.period_summary','public.reconcile_account','public.reconciliation_undo','public.recurrence_create','public.recurrence_delete','public.recurrence_end',
        'public.recurrence_materialize','public.recurrence_update','public.remove_member','public.reset_household','public.reset_preview','public.set_card_cycle','public.set_card_identity','public.set_card_limit','public.set_card_pay_account']::text[],
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
  array['private.card_reopen_invoice','private.card_void_events','private.current_household','private.debt_balance','private.debt_chk','private.debt_chk_trg',
        'private.debt_lock','private.handle_new_user','private.is_member','private.is_owner',
        'private.members_owner_guard','private.reconciled_until','private.recurrence_lock','private.seed_default_categories','private.shares_household',
        'public.accept_invitation','public.account_delete','public.card_bill_due','public.card_installment_edit','public.card_invoice_reopen',
        'public.card_purchase','public.card_purchase_delete',
        'public.create_card','public.create_debt','public.create_debt_installments','public.create_debt_invoice',
        'public.create_household','public.create_invitation','public.debt_anticipate','public.debt_archive','public.debt_bill','public.debt_delete',
        'public.debt_loan_event','public.debt_pay','public.debt_record_payment','public.debt_refund','public.debt_rename','public.debt_return','public.debt_set_terms','public.debt_unarchive','public.debt_void',
        'public.delete_household','public.investment_asset_create','public.investment_asset_set_subclass','public.investment_distribution_record','public.investment_operation_record','public.investment_valuation_record','public.leave_household','public.reconcile_account','public.reconciliation_undo','public.recurrence_create','public.recurrence_delete',
        'public.recurrence_end','public.recurrence_materialize','public.recurrence_update','public.remove_member',
        'public.reset_household','public.set_card_cycle','public.set_card_identity','public.set_card_limit','public.set_card_pay_account']::text[],
  'SECURITY DEFINER apenas nas funções auditadas (seção 6.1 do plano)');

select is(
  array(select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname in ('account_balances','balance_totals','period_summary','budget_usage','debt_balances','investment_portfolio','investment_totals','net_worth')
           and not p.prosecdef order by 1),
  array['account_balances','balance_totals','budget_usage','debt_balances','investment_portfolio','investment_totals','net_worth','period_summary']::text[],
  'funções de relatório são SECURITY INVOKER (a RLS do chamador decide)');

-- Todas as tabelas de public têm dono = quem roda as migrations (e nenhuma tem FORCE: as RPCs
-- SECURITY DEFINER dependem de verificações internas, não da RLS)
select is_empty($$
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relforcerowsecurity
$$, 'nenhuma tabela com FORCE ROW LEVEL SECURITY (decisão registrada no plano)');

select * from finish();
rollback;
