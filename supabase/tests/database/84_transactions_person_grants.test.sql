-- 84: o front grava person_id e is_shared_expense em lançamentos (#205). A role `authenticated` precisa de
-- INSERT e UPDATE nessas colunas; sem a migration 20261109070000 estes testes falham.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

select ok(has_column_privilege('authenticated', 'public.transactions', 'person_id', 'INSERT'),
  'authenticated pode gravar person_id no insert de lançamento');
select ok(has_column_privilege('authenticated', 'public.transactions', 'is_shared_expense', 'INSERT'),
  'authenticated pode gravar is_shared_expense no insert de lançamento');
select ok(has_column_privilege('authenticated', 'public.transactions', 'person_id', 'UPDATE'),
  'authenticated pode gravar person_id na edição de lançamento');
select ok(has_column_privilege('authenticated', 'public.transactions', 'is_shared_expense', 'UPDATE'),
  'authenticated pode gravar is_shared_expense na edição de lançamento');

-- Não ampliar: a exclusão continua via UPDATE de deleted_at (lixeira), sem DELETE para authenticated.
select ok(not has_table_privilege('authenticated', 'public.transactions', 'DELETE'),
  'authenticated continua sem DELETE em transactions (lixeira por deleted_at)');

select * from finish();
rollback;
