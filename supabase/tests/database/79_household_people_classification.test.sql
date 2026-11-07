-- 79: classificação de despesas por pessoa, com fonte de verdade do cartão em debt_events.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

select has_column('public','transactions','person_id','transactions recebe classificação individual');
select has_column('public','transactions','is_shared_expense','transactions distingue despesas compartilhadas');
select has_column('public','debt_installments','person_id','parcelas do cartão recebem classificação individual');
select has_column('public','debt_installments','is_shared_expense','parcelas do cartão distinguem despesas compartilhadas');
select has_column('public','recurrences','person_id','regras recorrentes recebem classificação individual');
select has_column('public','recurrences','is_shared_expense','regras recorrentes distinguem despesas compartilhadas');

select has_function('public','card_purchase_at_classified',
  array['uuid','date','numeric','integer','uuid','text','integer','uuid','uuid','boolean'],
  'compra de cartão grava classificação no mesmo commit');
select has_function('public','transaction_installments_create_classified',
  array['text','text','numeric','integer','text','integer','date','uuid','uuid','uuid','boolean','uuid','boolean'],
  'parcelamento em conta grava classificação em todas as parcelas');
select has_function('public','recurrence_create_classified',
  array['text','text','numeric','integer','date','uuid','uuid','uuid','uuid','date','text','integer','uuid','boolean'],
  'criação de recorrente grava classificação');
select has_function('public','recurrence_set_person',
  array['uuid','uuid','boolean'],
  'classificação de recorrente pode ser atualizada');
select has_function('public','monthly_expenses_by_person',
  array['uuid','date','date'],
  'relatório mensal por pessoa está disponível');

select ok(not has_table_privilege('authenticated','public.household_people','DELETE'),
  'cadastro de pessoas continua sem hard delete pelo cliente');
select * from finish();
rollback;
