-- 67_cash_flow_series_rapida: migration 067. Em produção a 066 estourava o statement_timeout (8 s) porque chamava
-- balance_totals_projected uma vez por linha (30 no diário). A regra do saldo continua testada no 66 (o saldo de cada
-- linha anda junto com o resultado); aqui fica a guarda de desempenho: no máximo UMA chamada de saldo por chamada.
begin;
create extension if not exists pgtap with schema extensions;
select plan(2);

select is(
  (select (length(p.prosrc) - length(replace(p.prosrc, 'balance_totals_projected(', ''))) / length('balance_totals_projected(')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'cash_flow_series'),
  1,
  'cash_flow_series chama balance_totals_projected uma vez só (saldo de abertura), não por linha');

select ok(
  (select p.prosrc ~* 'over \(order by l\.ini' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'cash_flow_series'),
  'o saldo de cada linha é o de abertura + o resultado acumulado (janela ordenada)');

select * from finish();
rollback;
