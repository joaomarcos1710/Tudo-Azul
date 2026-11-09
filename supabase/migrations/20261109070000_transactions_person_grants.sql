-- Lançamentos: o front grava person_id e is_shared_expense (classificação de pessoas, #205) em todo insert e update
-- (src/lib/lancamentos.ts, linha()), mas o grant de coluna para `authenticated` nunca incluiu essas duas colunas.
-- Resultado em produção: criar e editar lançamento falhava com 42501 ("permission denied for table transactions").
-- A integridade continua no banco: transactions_person_fk garante que a pessoa é da mesma família, e a check
-- constraint impede despesa compartilhada com pessoa. Nenhuma policy de RLS muda.

grant insert (person_id, is_shared_expense) on public.transactions to authenticated;
grant update (person_id, is_shared_expense) on public.transactions to authenticated;
