-- 53_debt_events_installment_only_idx: migration 053. A busca de private.debt_chk por parcela usa índice.
begin;
create extension if not exists pgtap with schema extensions;
select plan(2);

select has_index('public', 'debt_events', 'debt_events_installment_only_idx', array['installment_id'],
  'debt_events tem índice só por installment_id');

select ok(
  pg_get_indexdef('public.debt_events_installment_only_idx'::regclass)
    ~ 'WHERE \(\(installment_id IS NOT NULL\) AND \(voided_at IS NULL\)\)',
  'índice parcial: só eventos com parcela e não anulados');

select * from finish();
rollback;
