-- 00_audit: estrutura, privilégios e funções. Roda como superusuário só para LER
-- o catálogo; não testa comportamento (isso é papel dos outros arquivos).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Tabelas e policies exatamente as esperadas (nada sobrando sem revisão)
select tables_are('public',
  array['account_reconciliations','account_tag_links','account_tags','accounts','budgets','card_scheduled_items','categories','currencies','daily_digest_settings','debt_events','debt_installment_edits','debt_installments','debt_invoices','debt_payment_schedule','debts','family_asset_valuations','family_assets','fx_rates','household_members','household_people','household_resets','households','invitations','investment_assets','investment_distributions','investment_operations','investment_valuations','market_quotes','profiles','recurrences','reserve_allocations','reserves','transactions','user_preferences'],
  'schema public contém só as tabelas esperadas');

select is_empty($$
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity
$$, 'RLS ligada em toda tabela do schema public');

select policies_are('public','profiles',          array['profiles_select','profiles_update']);
select policies_are('public','households',        array['households_select','households_update']);
select policies_are('public','household_members', array['household_members_select']);
select policies_are('public','household_people', array['household_people_select','household_people_insert','household_people_update']);
select policies_are('public','invitations',       array['invitations_select']);
select policies_are('public','investment_assets', array['investment_assets_select']);
select policies_are('public','investment_distributions', array['investment_distributions_select']);
select policies_are('public','investment_operations', array['investment_operations_select']);
select policies_are('public','investment_valuations', array['investment_valuations_select']);
select policies_are('public','market_quotes', array['market_quotes_select']);
select policies_are('public','daily_digest_settings', array['daily_digest_settings_insert','daily_digest_settings_select','daily_digest_settings_update']);
select policies_are('public','account_tags',      array['account_tags_select','account_tags_insert','account_tags_update','account_tags_delete']);
select policies_are('public','account_tag_links', array['account_tag_links_select','account_tag_links_insert','account_tag_links_delete']);
select policies_are('public','accounts',          array['accounts_select','accounts_insert','accounts_update','accounts_delete']);
select policies_are('public','categories',        array['categories_select','categories_insert','categories_update','categories_delete']);
select policies_are('public','currencies',        array['currencies_select']);
select policies_are('public','fx_rates',           array['fx_rates_select']);
select policies_are('public','debts',             array['debts_select']);
select policies_are('public','card_scheduled_items', array['card_scheduled_items_select']);
select policies_are('public','debt_invoices',     array['debt_invoices_select']);
select policies_are('public','debt_installments', array['debt_installments_select']);
select policies_are('public','debt_events',       array['debt_events_select']);
select policies_are('public','debt_payment_schedule', array['debt_payment_schedule_select']);
select policies_are('public','family_assets', array['family_assets_select']);
select policies_are('public','family_asset_valuations', array['family_asset_valuations_select']);
select policies_are('public','transactions',      array['transactions_select','transactions_insert','transactions_update']);
select policies_are('public','budgets',           array['budgets_select','budgets_insert','budgets_update','budgets_delete']);
select policies_are('public','recurrences',       array['recurrences_select']);
select policies_are('public','reserve_allocations', array['reserve_allocations_select','reserve_allocations_insert']);
select policies_are('public','reserves', array['reserves_select','reserves_insert','reserves_update']);
select policies_are('public','account_reconciliations', array['account_reconciliations_select']);
select policies_are('public','household_resets', array['household_resets_select']);
select policies_are('public','user_preferences', array['user_preferences_select_own','user_preferences_insert_own','user_preferences_update_own']);

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

-- private.daily_digest_log não usa RLS: o isolamento é explícito por ausência
-- total de privilégios de tabela/coluna para anon e authenticated. A service
-- function SECURITY DEFINER faz a gravação controlada; não expor a tabela.
select ok(not has_table_privilege('anon', 'private.daily_digest_log', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
  'anon não acessa private.daily_digest_log');
select ok(not has_table_privilege('authenticated', 'private.daily_digest_log', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
  'authenticated não acessa private.daily_digest_log');
select ok(not has_any_column_privilege('authenticated', 'private.daily_digest_log', 'SELECT,INSERT,UPDATE,REFERENCES'),
  'authenticated não tem privilégios por coluna em private.daily_digest_log');
select ok(not (select c.relrowsecurity from pg_class c where c.oid = 'private.daily_digest_log'::regclass),
  'private.daily_digest_log permanece sem RLS porque não concede acesso direto');

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
select ok(not has_table_privilege('authenticated', 'public.household_people', 'DELETE'), 'pessoas da família não podem ser apagadas: só inativadas');
select ok(not has_column_privilege('authenticated', 'public.household_people', 'household_id', 'UPDATE'), 'household_people.household_id imutável');
select ok(has_column_privilege('authenticated', 'public.household_people', 'status', 'UPDATE'), 'pessoas podem ser inativadas/reativadas');
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
select ok(not has_column_privilege('authenticated','public.categories','non_consumption','INSERT'), 'categories.non_consumption nasce false (071)');
select ok(has_column_privilege('authenticated','public.categories','non_consumption','UPDATE'),     'categories.non_consumption editável pela família (071, RLS is_member)');
select ok(not has_column_privilege('authenticated','public.households','member_limit','UPDATE'),  'households.member_limit só pelo administrador do banco');
select ok(not has_column_privilege('authenticated','public.invitations','token_hash','SELECT'),    'invitations.token_hash ilegível');
select ok(not has_column_privilege('authenticated','public.budgets','category_type','INSERT'),     'budgets.category_type não informável');
select ok(not has_column_privilege('authenticated','public.budgets','household_id','UPDATE'),      'budgets.household_id imutável');
select ok(not has_column_privilege('authenticated','public.budgets','category_id','UPDATE'),       'budgets.category_id imutável');
select ok(not has_column_privilege('authenticated','public.investment_operations','voided_at','UPDATE'),   'investment_operations.voided_at só pela RPC de anulação');
select ok(not has_column_privilege('authenticated','public.investment_operations','void_reason','UPDATE'), 'investment_operations.void_reason só pela RPC de anulação');
select ok(not has_column_privilege('authenticated','public.reserves','id','INSERT'), 'reserves.id usa default do banco');
select ok(not has_column_privilege('authenticated','public.reserves','created_by','INSERT'), 'reserves.created_by vem de auth.uid()');
select ok(not has_column_privilege('authenticated','public.reserves','status','INSERT'), 'reserves nasce ativa por default, sem status informado pelo cliente');
select ok(not has_column_privilege('authenticated','public.reserves','household_id','UPDATE'), 'reserves.household_id imutável');
select ok(not has_column_privilege('authenticated','public.reserves','currency_code','UPDATE'), 'reserves.currency_code imutável');
select ok(has_column_privilege('authenticated','public.reserves','status','UPDATE'), 'status só é alterável sob guarda da trigger');
select ok(not has_column_privilege('authenticated','public.reserve_allocations','id','INSERT'), 'reserve_allocations.id usa default do banco');
select ok(not has_column_privilege('authenticated','public.reserve_allocations','created_by','INSERT'), 'reserve_allocations.created_by vem de auth.uid()');
select ok(has_column_privilege('authenticated','public.reserve_allocations','idempotency_key','INSERT'), 'RPC invoker pode gravar chave de idempotência');
select ok(not has_any_column_privilege('authenticated','public.reserve_allocations','UPDATE'), 'ledger sem UPDATE por coluna');
select ok(not has_table_privilege('authenticated','public.reserve_allocations','DELETE'), 'ledger sem DELETE no nível da tabela');
-- ...e o que PODE
select ok(has_column_privilege('authenticated','public.transactions','deleted_at','UPDATE'),       'lixeira = UPDATE deleted_at');
select ok(has_column_privilege('authenticated','public.transactions','amount','INSERT'),           'transactions.amount informável');
select ok(has_column_privilege('authenticated','public.accounts','opening_date','UPDATE'),         'accounts.opening_date editável (com guarda)');
select ok(has_column_privilege('authenticated','public.invitations','email','SELECT'),             'invitations.email legível (owner, via policy)');

-- Funções: exatamente as esperadas
select functions_are('public', array[
  'accept_invitation','account_balances','account_balances_daily','account_balances_projected','account_delete','account_flow_report','account_move_to_portfolio','account_movements','account_tags_set','active_installment_plans','balance_totals','balance_totals_by_currency','balance_totals_by_type','balance_totals_projected','budget_projection','budget_rule_report','budget_usage','card_bill_due','card_credit_income','card_credit_set_category','card_installment_edit','card_installment_move','card_invoice_categories','card_invoices_due','card_invoices_month','card_invoice_reopen','card_items','card_limits','card_months','card_overview','card_payment_move','card_pending_subscriptions',
  'card_purchase','card_purchase_at','card_purchase_at_classified','card_purchase_delete','card_purchase_delete_preview','card_purchase_set_date','card_purchase_set_person','card_scheduled_convert','card_scheduled_from_here','card_scheduled_invoices','card_scheduled_item_cancel','card_scheduled_item_update','card_scheduled_sync','card_set_start','card_subscription_previews','cash_flow_report','cash_flow_series','clear_household_transactions','create_card','create_debt','create_debt_installments','create_debt_invoice','create_household','create_invitation','daily_digest','daily_digest_mark','daily_digest_recipients','daily_digest_service','daily_expenses','dashboard_commitment_matrix','debt_anticipate','debt_balances','debt_bill','debt_contract_set',
  'debt_archive','debt_delete','debt_extra_amortize','debt_loan_event','debt_pay','debt_record_payment','debt_refund','debt_rename','debt_return','debt_schedule_record_payment','debt_set_principal_category','debt_set_terms','debt_unarchive','debt_void','delete_household','expenses_by_category','expenses_by_category_basis','family_asset_create','family_asset_delete','family_asset_end','family_asset_valuation_record','fx_rate_at','fx_to_brl','get_home_decision_month','home_alerts','home_indicators','income_regularity','investment_allocation','investment_asset_archive','investment_asset_create','investment_asset_delete','investment_asset_purge','investment_asset_set_institution','investment_asset_set_liquidity','investment_asset_set_market_quote','investment_asset_set_subclass','investment_asset_statement','investment_asset_unarchive','investment_asset_update','investment_contribution_history','investment_contributions','investment_distribution_record','investment_distribution_record_series','installment_month_summary','installment_plan_schedule','installments_ending_soon','investment_planned_income','investment_planned_income_ending','investment_history','investment_income_by_asset','investment_income_totals','investment_institution_totals','investment_liquidity_totals','investment_operation_record','investment_operation_record_by_value','investment_operation_void','investment_portfolio','investment_totals','investment_valuation_record','investment_valuation_record_total','leave_household',
  'month_projection','monthly_expenses_by_person','net_worth','net_worth_with_assets','period_summary','period_summary_by_currency','prepare_account_deletion','reconcile_account','recurrence_create','recurrence_create_classified','recurrence_create_with_nature','recurrence_delete','recurrence_end','recurrence_materialize','recurrence_nature_summary','recurrence_overview','recurrence_set_nature','recurrence_set_person','recurrence_summary','recurrence_update','recurrence_update_classified','recurrence_update_with_nature','recurrence_update_from',
  'reconciliation_undo','record_reserve_allocation','record_reserve_expense','remove_member','reserve_overview','reset_household','reset_preview','rollback_account_deletion','set_card_cycle','set_card_identity','set_card_limit','set_card_pay_account','transaction_installments_create','transaction_installments_create_classified',
  'transactions_bulk_mark_paid','transactions_bulk_mark_planned','transactions_bulk_restore','transactions_bulk_set_category','transactions_bulk_trash'],
  'funções do schema public');
select functions_are('private', array[
  'account_brl_only','account_recurrence_pending','account_tags_limit_guard','account_type_from_legacy','accounts_guard','accounts_period_guard','budgets_guard','card_cycle_closing','card_cycle_closing_day','card_cycle_due','card_cycle_due_day','card_cycle_first','card_day_in_month','card_due_date','card_first_closing','card_pending_by_due','card_recurrence_pending',
  'card_income_items','card_month_labels','card_months_as_of','card_paid_lock_check','card_paid_lock_raise','card_paid_snapshot','card_payment_release','card_payment_release_trg','card_reopen_invoice','card_scheduled_check','card_scheduled_item_lock','card_void_events','categories_guard','current_household','debt_balance','debt_chk','debt_chk_trg',
  'debt_effect','debt_events_card_payment_date','debt_events_guard','debt_events_period_guard','expense_items','expense_items_basis','family_assets_brl','fx_ptax_fetch','fx_ptax_record','fx_rates_immutable','debt_installments_card_only','debt_installments_immutable','debt_lock','debt_money_guard','debt_schedule_restore_void','debts_immutable',
  'ensure_household_person_for_member','handle_new_user','inherit_person_classification','investment_portfolio_account','investment_portfolio_account_guard','investment_portfolio_ref_guard','investment_portfolio_tx_guard','investment_price_at','investment_quote_symbol','is_member','is_owner','loan_principal_items','loan_schedule_planned','market_quote_record','market_quotes_fetch','members_limit_guard','members_owner_guard','reconciled_until','recurrence_lock','recurrence_occurrences','recurrence_slot','recurrence_steps','recurrence_update_from_apply','recurrences_money_guard','reserve_allocations_guard','reserves_delete_guard','reserve_linked_transaction_guard','reserves_guard','seed_default_categories','shares_household','today_sp','touch_updated_at','transactions_bulk_lock','transactions_guard','transactions_period_guard','transfer_same_currency','validate_person_scope','guard_person_active'],
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
  array['private.account_brl_only','private.account_recurrence_pending','private.card_cycle_closing','private.card_cycle_closing_day','private.card_cycle_due','private.card_cycle_due_day','private.card_cycle_first','private.card_income_items','private.card_months_as_of','private.card_pending_by_due','private.card_recurrence_pending','private.expense_items','private.expense_items_basis','private.family_assets_brl','private.investment_price_at','private.investment_quote_symbol','private.is_member','private.is_owner','private.loan_principal_items','private.loan_schedule_planned','private.reconciled_until','private.recurrence_occurrences','private.recurrence_update_from_apply','private.shares_household','private.transactions_bulk_lock','private.transfer_same_currency',
        'public.accept_invitation','public.account_balances','public.account_balances_daily','public.account_balances_projected','public.account_delete','public.account_flow_report','public.account_move_to_portfolio','public.account_movements','public.account_tags_set','public.active_installment_plans','public.balance_totals','public.balance_totals_by_currency','public.balance_totals_by_type','public.balance_totals_projected',
        'public.budget_projection','public.budget_rule_report','public.budget_usage','public.card_bill_due','public.card_credit_income','public.card_credit_set_category','public.card_installment_edit','public.card_installment_move','public.card_invoice_categories','public.card_invoice_reopen','public.card_invoices_due','public.card_invoices_month','public.card_items','public.card_limits','public.card_months','public.card_overview','public.card_payment_move','public.card_pending_subscriptions','public.card_purchase','public.card_purchase_at','public.card_purchase_at_classified','public.card_purchase_delete','public.card_purchase_delete_preview','public.card_purchase_set_date','public.card_purchase_set_person','public.card_scheduled_convert','public.card_scheduled_from_here','public.card_scheduled_invoices','public.card_scheduled_item_cancel','public.card_scheduled_item_update','public.card_scheduled_sync','public.card_set_start','public.card_subscription_previews','public.cash_flow_report','public.cash_flow_series','public.clear_household_transactions','public.create_card','public.create_debt','public.create_debt_installments','public.create_debt_invoice',
        'public.create_household','public.create_invitation','public.daily_digest','public.daily_expenses','public.dashboard_commitment_matrix','public.debt_anticipate','public.debt_archive','public.debt_balances',
        'public.debt_bill','public.debt_contract_set','public.debt_delete','public.debt_extra_amortize','public.debt_loan_event','public.debt_pay','public.debt_record_payment','public.debt_refund','public.debt_rename','public.debt_return','public.debt_schedule_record_payment','public.debt_set_principal_category','public.debt_set_terms','public.debt_unarchive',
        'public.debt_void','public.delete_household','public.expenses_by_category','public.expenses_by_category_basis','public.family_asset_create','public.family_asset_delete','public.family_asset_end','public.family_asset_valuation_record','public.fx_rate_at','public.fx_to_brl','public.get_home_decision_month','public.home_alerts','public.home_indicators','public.income_regularity','public.installment_month_summary','public.installment_plan_schedule','public.installments_ending_soon','public.investment_allocation','public.investment_asset_archive','public.investment_asset_create','public.investment_asset_delete','public.investment_asset_purge','public.investment_asset_set_institution','public.investment_asset_set_liquidity','public.investment_asset_set_market_quote','public.investment_asset_set_subclass','public.investment_asset_statement','public.investment_asset_unarchive','public.investment_asset_update','public.investment_contribution_history','public.investment_contributions','public.investment_distribution_record','public.investment_distribution_record_series','public.investment_history','public.investment_income_by_asset','public.investment_income_totals','public.investment_institution_totals','public.investment_liquidity_totals','public.investment_operation_record','public.investment_operation_record_by_value','public.investment_operation_void','public.investment_planned_income','public.investment_planned_income_ending','public.investment_portfolio','public.investment_totals','public.investment_valuation_record','public.investment_valuation_record_total','public.leave_household','public.month_projection','public.monthly_expenses_by_person','public.net_worth',
        'public.net_worth_with_assets','public.period_summary','public.period_summary_by_currency','public.reconcile_account','public.reconciliation_undo','public.record_reserve_allocation','public.record_reserve_expense','public.recurrence_create','public.recurrence_create_classified','public.recurrence_create_with_nature','public.recurrence_delete','public.recurrence_end',
        'public.recurrence_materialize','public.recurrence_nature_summary','public.recurrence_overview','public.recurrence_set_nature','public.recurrence_set_person','public.recurrence_summary','public.recurrence_update','public.recurrence_update_classified','public.recurrence_update_from','public.recurrence_update_with_nature','public.remove_member','public.reserve_overview','public.reset_household','public.reset_preview','public.set_card_cycle','public.set_card_identity','public.set_card_limit','public.set_card_pay_account','public.transaction_installments_create','public.transaction_installments_create_classified',
        'public.transactions_bulk_mark_paid','public.transactions_bulk_mark_planned','public.transactions_bulk_restore','public.transactions_bulk_set_category','public.transactions_bulk_trash']::text[],
  'lista de funções executáveis por authenticated é exatamente a esperada (funções de trigger: nenhuma)');

select ok(not (select prosecdef from pg_proc where oid='private.reserve_allocations_guard()'::regprocedure), 'reserve_allocations_guard permanece SECURITY INVOKER');
select ok(not (select prosecdef from pg_proc where oid='private.reserves_guard()'::regprocedure), 'reserves_guard permanece SECURITY INVOKER');
select ok(not (select prosecdef from pg_proc where oid='public.record_reserve_expense(uuid,uuid,uuid,numeric,date,text,uuid,text)'::regprocedure), 'record_reserve_expense permanece SECURITY INVOKER');
select ok(not (select prosecdef from pg_proc where oid='public.record_reserve_allocation(uuid,numeric,date,text,uuid)'::regprocedure), 'record_reserve_allocation permanece SECURITY INVOKER');
select ok(not (select prosecdef from pg_proc where oid='public.reserve_overview(uuid)'::regprocedure), 'reserve_overview permanece SECURITY INVOKER');
select ok(exists (select 1 from pg_trigger where tgname = 'transactions_reserve_link_guard' and not tgisinternal),
  'transações vinculadas a reservas têm proteção contra mutação/exclusão');
-- migration 100: Carteira de investimentos (conta interna)
select ok(exists (select 1 from pg_trigger where tgname = 'transactions_investment_portfolio_guard' and not tgisinternal),
  'lançamentos da Carteira de investimentos só mudam pelas operações de Investimentos');
select ok(exists (select 1 from pg_trigger where tgname = 'accounts_investment_portfolio_guard' and not tgisinternal),
  'a Carteira de investimentos não é editada, arquivada nem excluída pelo cliente');
select is((select count(*) from pg_trigger where not tgisinternal and tgname in ('recurrences_investment_portfolio_guard',
  'debts_investment_portfolio_guard','debt_events_investment_portfolio_guard','account_reconciliations_investment_portfolio_guard')),
  4::bigint, 'recorrentes, dívidas, eventos e conferências não usam a Carteira');
select ok(not has_column_privilege('authenticated','public.accounts','system_role','INSERT'), 'accounts.system_role não informável');
select ok(not has_column_privilege('authenticated','public.accounts','system_role','UPDATE'), 'accounts.system_role imutável pelo cliente');
select ok(not has_column_privilege('authenticated','public.investment_operations','transaction_id','UPDATE'), 'investment_operations.transaction_id só pelas RPCs');

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
  array['private.card_month_labels','private.card_payment_release','private.card_payment_release_trg','private.card_reopen_invoice','private.card_scheduled_check','private.card_scheduled_item_lock','private.card_void_events','private.current_household','private.debt_balance','private.debt_chk','private.debt_chk_trg',
        'private.debt_lock','private.debt_schedule_restore_void','private.ensure_household_person_for_member','private.handle_new_user','private.is_member','private.is_owner',
        'private.members_owner_guard','private.reconciled_until','private.recurrence_lock','private.recurrence_update_from_apply','private.seed_default_categories','private.shares_household',
        'public.accept_invitation','public.account_delete','public.account_move_to_portfolio','public.card_bill_due','public.card_credit_income','public.card_credit_set_category','public.card_installment_edit','public.card_installment_move','public.card_invoice_reopen','public.card_payment_move',
        'public.card_purchase','public.card_purchase_at','public.card_purchase_at_classified','public.card_purchase_delete','public.card_purchase_set_date','public.card_purchase_set_person','public.card_scheduled_convert','public.card_scheduled_from_here','public.card_scheduled_item_cancel','public.card_scheduled_item_update','public.card_scheduled_sync','public.card_set_start',
        'public.clear_household_transactions','public.create_card','public.create_debt','public.create_debt_installments','public.create_debt_invoice',
        'public.create_household','public.create_invitation','public.daily_digest_mark','public.daily_digest_recipients','public.debt_anticipate','public.debt_archive','public.debt_bill','public.debt_contract_set','public.debt_delete','public.debt_extra_amortize',
        'public.debt_loan_event','public.debt_pay','public.debt_record_payment','public.debt_refund','public.debt_rename','public.debt_return','public.debt_schedule_record_payment','public.debt_set_principal_category','public.debt_set_terms','public.debt_unarchive','public.debt_void',
        'public.delete_household','public.family_asset_create','public.family_asset_delete','public.family_asset_end','public.family_asset_valuation_record','public.investment_asset_archive','public.investment_asset_create','public.investment_asset_delete','public.investment_asset_purge','public.investment_asset_set_institution','public.investment_asset_set_liquidity','public.investment_asset_set_market_quote','public.investment_asset_set_subclass','public.investment_asset_unarchive','public.investment_asset_update','public.investment_distribution_record','public.investment_distribution_record_series','public.investment_operation_record','public.investment_operation_record_by_value','public.investment_operation_void','public.investment_valuation_record','public.investment_valuation_record_total','public.leave_household','public.prepare_account_deletion','public.reconcile_account','public.reconciliation_undo','public.recurrence_create','public.recurrence_create_classified','public.recurrence_create_with_nature','public.recurrence_delete',
        'public.recurrence_end','public.recurrence_materialize','public.recurrence_set_nature','public.recurrence_set_person','public.recurrence_update','public.recurrence_update_classified','public.recurrence_update_with_nature','public.remove_member',
        'public.reset_household','public.rollback_account_deletion','public.set_card_cycle','public.set_card_identity','public.set_card_limit','public.set_card_pay_account','public.transaction_installments_create','public.transaction_installments_create_classified']::text[],
  'SECURITY DEFINER apenas nas funções auditadas (seção 6.1 do plano)');

select is(
  array(select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname in ('account_balances','account_flow_report','balance_totals','period_summary','budget_usage','debt_balances','get_home_decision_month','home_indicators','investment_portfolio','investment_totals','net_worth','net_worth_with_assets')
           and not p.prosecdef order by 1),
  array['account_balances','account_flow_report','balance_totals','budget_usage','debt_balances','get_home_decision_month','home_indicators','investment_portfolio','investment_totals','net_worth','net_worth_with_assets','period_summary']::text[],
  'funções de relatório são SECURITY INVOKER (a RLS do chamador decide)');

-- Todas as tabelas de public têm dono = quem roda as migrations (e nenhuma tem FORCE: as RPCs
-- SECURITY DEFINER dependem de verificações internas, não da RLS)
select is_empty($$
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relforcerowsecurity
$$, 'nenhuma tabela com FORCE ROW LEVEL SECURITY (decisão registrada no plano)');


-- PR #209: pessoas inativas permanecem no histórico, mas não recebem novas atribuições.
select is((select count(*) from pg_indexes
  where schemaname = 'public'
    and indexname in ('transactions_person_period_idx','debt_installments_person_period_idx')
    and indexdef like '%(household_id, person_id,%'), 2::bigint,
  'índices de classificação cobrem as FKs compostas antes do período');
select is_empty($audit$
  select tablename from pg_indexes
   where schemaname = 'public'
     and indexname in ('transactions_person_period_idx','debt_installments_person_period_idx')
     and indexdef not like '%(household_id, person_id,%'
$audit$, 'nenhum índice de classificação mantém a ordem antiga das colunas');
select ok(exists (select 1 from pg_trigger where tgname = 'transactions_guard_person_active' and not tgisinternal),
  'transactions rejeita novas atribuições a pessoas inativas');
select ok(position('hp.status = true' in pg_get_functiondef('private.validate_person_scope(uuid,uuid,boolean)'::regprocedure)) > 0,
  'validação de pessoa exige status ativo');
select ok(position('hp.status = true' in pg_get_functiondef('private.guard_person_active()'::regprocedure)) > 0,
  'trigger de pessoa exige status ativo em novas atribuições');
select ok(exists (select 1 from pg_trigger where tgname = 'debt_installments_guard_person_active' and not tgisinternal),
  'parcelas rejeitam novas atribuições a pessoas inativas');
select ok(exists (select 1 from pg_trigger where tgname = 'recurrences_guard_person_active' and not tgisinternal),
  'recorrências rejeitam novas atribuições a pessoas inativas');

select * from finish();
rollback;
