-- 126_pending_strip: migration 134. Faixa de pendências de Lançamentos: vencidos a pagar e a receber, a pagar e a receber
-- de hoje até o fim do mês. Fatura só fechada; parcela de contrato sem o consignado (payroll); transferência, lançamento
-- pago, apagado, em outra moeda e o que passa do período não entram. Totais somados no banco.
-- A função vai por SQL dinâmico: sem a migration as asserções falham sem abortar o arquivo.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create temp table fixture (k text primary key, v uuid);
grant all on fixture to public;
create function pg_temp.fx(p_k text) returns uuid language sql as $f$ select v from fixture where k = p_k $f$;
create function pg_temp.login(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $f$;
-- "tipo|quantidade|total|primeira data" na ordem do banco; 'ERRO <sqlstate>' se a função falhar ou não existir
create function pg_temp.faixa(p_h uuid, p_hoje date, p_ate date) returns text[] language plpgsql as $f$
declare r text[];
begin
  execute 'select coalesce(array_agg(kind || ''|'' || item_count || ''|'' || total::numeric(14,2) || ''|'' || first_date order by ord), ''{}'')
             from (select f.*, row_number() over () as ord from public.pending_strip($1, $2, $3) f) q'
    into r using p_h, p_hoje, p_ate;
  return r;
exception when others then return array['ERRO ' || sqlstate];
end $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.faixa(uuid, date, date) to public;

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000126a1', 'f1@teste.com', now()),
  ('00000000-0000-0000-0000-0000000126a2', 'f2@teste.com', now());

select pg_temp.login('00000000-0000-0000-0000-0000000126a1');
insert into fixture select 'h', public.create_household('Casa da Faixa');
insert into fixture select 'cat', id from public.categories where household_id = pg_temp.fx('h') and name = 'Mercado';
insert into fixture select 'rec', id from public.categories where household_id = pg_temp.fx('h') and type = 'income' order by name limit 1;
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 5000.00, '2026-01-01') returning id)
  insert into fixture select 'brl', id from i;
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Poupança', 'savings', 0, '2026-01-01') returning id)
  insert into fixture select 'poup', id from i;
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date, currency_code)
           values (pg_temp.fx('h'), 'Conta em dólar', 'checking', 0, '2026-01-01', 'USD') returning id)
  insert into fixture select 'usd', id from i;

-- Hoje = 20/10/2026. Planejados: despesa vencida (05/10), despesa a pagar (25/10), despesa de novembro (03/11), receita
-- vencida (10/10) e a receber (28/10). Fora: despesa paga, transferência planejada, planejada apagada e em dólar.
insert into public.transactions (household_id, type, status, date, amount, description, account_id, category_id)
values (pg_temp.fx('h'), 'expense', 'planned', '2026-10-05', 80.00, 'Vencida', pg_temp.fx('brl'), pg_temp.fx('cat')),
       (pg_temp.fx('h'), 'expense', 'planned', '2026-10-25', 50.00, 'A pagar', pg_temp.fx('brl'), pg_temp.fx('cat')),
       (pg_temp.fx('h'), 'expense', 'planned', '2026-11-03', 999.00, 'Novembro', pg_temp.fx('brl'), pg_temp.fx('cat')),
       (pg_temp.fx('h'), 'income', 'planned', '2026-10-10', 300.00, 'Receita atrasada', pg_temp.fx('brl'), pg_temp.fx('rec')),
       (pg_temp.fx('h'), 'income', 'planned', '2026-10-28', 1000.00, 'Receita do mês', pg_temp.fx('brl'), pg_temp.fx('rec')),
       (pg_temp.fx('h'), 'expense', 'paid', '2026-10-21', 77.00, 'Paga', pg_temp.fx('brl'), pg_temp.fx('cat')),
       (pg_temp.fx('h'), 'expense', 'planned', '2026-10-23', 44.00, 'Apagada', pg_temp.fx('brl'), pg_temp.fx('cat')),
       (pg_temp.fx('h'), 'expense', 'planned', '2026-10-24', 55.00, 'Em dólar', pg_temp.fx('usd'), pg_temp.fx('cat'));
insert into public.transactions (household_id, type, status, date, amount, description, account_id, destination_account_id)
values (pg_temp.fx('h'), 'transfer', 'planned', '2026-10-22', 200.00, 'Guardar', pg_temp.fx('brl'), pg_temp.fx('poup'));
update public.transactions set deleted_at = now() where household_id = pg_temp.fx('h') and description = 'Apagada';

-- Cartão: fecha dia 18, vence 25. Setembro: 150,00 (fatura fechada, venceu 25/09: vencida). Outubro: 300,00 (fechou 18/10,
-- vence 25/10: a pagar). 19/10: 70,00 (fatura que fecha 18/11, ainda ABERTA: fora, mesmo vencendo dentro do período).
insert into fixture select 'card', public.create_debt('Cartão', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('card'), 18, 25);
select public.card_purchase(pg_temp.fx('card'), '2026-09-05', 150.00, 1, pg_temp.fx('cat'), 'Setembro');
select public.card_purchase(pg_temp.fx('card'), '2026-10-05', 300.00, 1, pg_temp.fx('cat'), 'Outubro');
select public.card_purchase(pg_temp.fx('card'), '2026-10-19', 70.00, 1, pg_temp.fx('cat'), 'Aberta');

-- Empréstimo em boleto: 100,00 todo dia 10 desde 10/10 (10/10 vencida). Consignado (payroll): 100,00 todo dia 16 desde
-- 16/10: nunca entra (o salário já vem líquido).
insert into fixture select 'loan', public.create_debt('Empréstimo', 'loan', '2026-09-01', 1200);
select public.debt_contract_set(pg_temp.fx('loan'), 'Banco', null, 12, 12, 100, 10, 'boleto', null, '2026-10-10');
insert into fixture select 'folha', public.create_debt('Consignado', 'loan', '2026-09-01', 300);
select public.debt_contract_set(pg_temp.fx('folha'), 'Banco folha', null, 3, 3, 100, 16, 'payroll', null, '2026-10-16');

-- ---------------------------------------------------------------------------
-- 1. Até o fim de outubro
-- ---------------------------------------------------------------------------
select is(pg_temp.faixa(pg_temp.fx('h'), '2026-10-20', '2026-10-31'), array[
  'overdue_payable|3|330.00|2026-09-25',
  'overdue_receivable|1|300.00|2026-10-10',
  'payable|2|350.00|2026-10-25',
  'receivable|1|1000.00|2026-10-28'],
  'F1 vencidos a pagar = despesa de 05/10 + parcela de 10/10 + fatura de setembro (fechada, venceu); a pagar = despesa de '
  '25/10 + fatura de outubro (fechada); receitas separadas; paga, transferência, apagada, em dólar, consignado e '
  'novembro fora');

-- ---------------------------------------------------------------------------
-- 2. Até o fim de novembro: entram a despesa de 03/11 e a parcela de 10/11; a fatura de novembro (aberta) não
-- ---------------------------------------------------------------------------
select is(pg_temp.faixa(pg_temp.fx('h'), '2026-10-20', '2026-11-30'), array[
  'overdue_payable|3|330.00|2026-09-25',
  'overdue_receivable|1|300.00|2026-10-10',
  'payable|4|1449.00|2026-10-25',
  'receivable|1|1000.00|2026-10-28'],
  'F2 o período manda; fatura aberta fica fora mesmo vencendo dentro dele; o consignado de 16/11 também');

-- no dia do fechamento a fatura já conta como fechada
select is(pg_temp.faixa(pg_temp.fx('h'), '2026-11-18', '2026-11-30'), array[
  'overdue_payable|7|1779.00|2026-09-25',
  'overdue_receivable|2|1300.00|2026-10-10',
  'payable|1|70.00|2026-11-25'],
  'F3 em 18/11 (fechamento): a fatura de novembro entra; o que era futuro em 20/10 virou vencido');

-- ---------------------------------------------------------------------------
-- 3. Período inválido, privilégios e isolamento
-- ---------------------------------------------------------------------------
select is(pg_temp.faixa(pg_temp.fx('h'), '2026-10-20', '2026-10-19'), array['ERRO 22023'], 'V1 fim antes de hoje: recusado');
select is(pg_temp.faixa(pg_temp.fx('h'), null, '2026-10-31'), array['ERRO 22023'], 'V2 hoje nulo: recusado');
select ok(not has_function_privilege('anon', 'public.pending_strip(uuid, date, date)', 'EXECUTE'), 'V3 anon sem EXECUTE');
select ok(has_function_privilege('authenticated', 'public.pending_strip(uuid, date, date)', 'EXECUTE'), 'V4 authenticated com EXECUTE');
select ok(not (select prosecdef from pg_proc where oid = 'public.pending_strip(uuid, date, date)'::regprocedure), 'V5 SECURITY INVOKER');

select pg_temp.login('00000000-0000-0000-0000-0000000126a2');
select is(pg_temp.faixa(pg_temp.fx('h'), '2026-10-20', '2026-10-31'), '{}'::text[], 'S1 outra família não vê as pendências desta');

select * from finish();
rollback;
