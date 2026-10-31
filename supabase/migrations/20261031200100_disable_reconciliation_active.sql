-- Tudo Azul — migration 031: desativa a conferência ativa e preserva o histórico
--
-- A conferência manual e as travas de período foram descontinuadas por decisão do dono.
-- Os registros já gravados continuam disponíveis para leitura e exportação. Esta migration
-- não apaga account_reconciliations, transactions.reconciliation_id nem dados existentes.
-- account_movements permanece: a exportação completa usa seus movimentos e a marca histórica.
--
-- As guardas de integridade gerais (transactions_guard, debt_events_guard, accounts_guard)
-- permanecem ativas; removemos apenas as três guardas de período introduzidas pela conferência.

-- Primeiro retirar os triggers que dependem das funções privadas.
drop trigger if exists transactions_period_guard on public.transactions;
drop trigger if exists debt_events_period_guard on public.debt_events;
drop trigger if exists accounts_period_guard on public.accounts;

-- Não existe mais operação ativa de criar ou desfazer conferência.
drop function if exists public.reconcile_account(uuid, date, numeric);
drop function if exists public.reconciliation_undo(uuid);

-- Remover somente as funções exclusivas das travas de período.
drop function if exists private.transactions_period_guard();
drop function if exists private.debt_events_period_guard();
drop function if exists private.accounts_period_guard();
drop function if exists private.reconciled_until(uuid);
