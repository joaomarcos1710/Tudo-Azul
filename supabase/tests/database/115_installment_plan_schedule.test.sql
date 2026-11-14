-- 115_installment_plan_schedule: linha do tempo das parcelas (migration 20261114120000).
-- Leitura pura. Mesma definição de "parcelamento ativo" e "parcela paga" de active_installment_plans (o teste confere as duas
-- entre si). Datas fixas e corte explícito ('2026-11-12'): não depende do dia em que roda. Dados inventados.
-- Sem a migration este arquivo falha (a função não existe).
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
create function pg_temp.anon() returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);
end $f$;
create function pg_temp.tx(p_desc text, p_n int) returns uuid language sql as $f$
  select id from public.transactions where description like p_desc || ' %' and installment_number = p_n $f$;
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
create function pg_temp.fat(p_card uuid, p_label text) returns uuid language sql as $f$
  select id from public.debt_invoices where debt_id = p_card and label = p_label $f$;
-- a linha do tempo de um plano como "n:estado:valor:data:fatura" separados por espaço (plano pelo começo da chave: descrição do Sofá etc. não vem na função)
create function pg_temp.linha(p_key text, p_h text default 'h') returns text language sql as $f$
  select coalesce(string_agg(installment_number || ':' || state || ':' || amount::numeric(14,2) || ':' || coalesce(due_date::text, '-') || ':' || coalesce(invoice_label, '-')
                             || case when in_month then ':mes' else '' end, ' ' order by installment_number), '-')
    from public.installment_plan_schedule(pg_temp.fx(p_h), date '2026-11-12') where plan_key = p_key $f$;
create function pg_temp.chave_conta(p_desc text) returns text language sql as $f$
  select 'account:' || installment_group::text from public.transactions where description like p_desc || ' %' and installment_number = 1 $f$;
grant execute on all functions in schema pg_temp to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000115a01', 'linha1@teste.com'),
  ('00000000-0000-0000-0000-000000115a02', 'linha2@teste.com');
select pg_temp.login('00000000-0000-0000-0000-000000115a01');
insert into fixture select 'h', public.create_household('Casa da linha do tempo');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 9000.00, '2026-01-01') returning id)
  insert into fixture select 'bank', id from i;
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date, currency_code)
           values (pg_temp.fx('h'), 'Banco USD', 'checking', 500.00, '2026-01-01', 'USD') returning id)
  insert into fixture select 'usd', id from i;
insert into fixture select 'cat', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';

select has_function('public', 'installment_plan_schedule', array['uuid', 'date'], 'L1 existe installment_plan_schedule(uuid, date)');
select is((select count(*)::integer from public.installment_plan_schedule(pg_temp.fx('h'), date '2026-11-12')), 0, 'L2 sem parcelamentos: nenhuma linha');

-- Conta (corte em 12/11/2026):
--   Sofá 5x R$ 100 desde 12/09: 1 e 2 pagas; a 3ª vence HOJE (12/11, "parcela do mês", ainda a vencer); 4ª e 5ª a vencer
--   Atraso 3x R$ 100 desde 01/09: a 1ª paga; a 2ª (01/10) e a 3ª (01/11, a do mês) venceram e não foram pagas
--   Concluído 2x: tudo pago, não é ativo
--   Lixeira 3x desde 20/11, a 3ª na lixeira: sobram 2 parcelas, numeradas 1 e 2
--   Resto 3x R$ 100,00 desde 20/10: a divisão é 33,34 + 33,33 + 33,33
select public.transaction_installments_create('expense', 'Sofá', 500, 5, 'month', 1, '2026-09-12', pg_temp.fx('bank'), null, pg_temp.fx('cat'), false);
select public.transactions_bulk_mark_paid(array[pg_temp.tx('Sofá', 1)], '2026-09-12');
select public.transactions_bulk_mark_paid(array[pg_temp.tx('Sofá', 2)], '2026-10-12');
select public.transaction_installments_create('expense', 'Atraso', 300, 3, 'month', 1, '2026-09-01', pg_temp.fx('bank'), null, pg_temp.fx('cat'), false);
select public.transactions_bulk_mark_paid(array[pg_temp.tx('Atraso', 1)], '2026-09-01');
select public.transaction_installments_create('expense', 'Concluído', 400, 2, 'month', 1, '2026-09-12', pg_temp.fx('bank'), null, pg_temp.fx('cat'), false);
select public.transactions_bulk_mark_paid(array[pg_temp.tx('Concluído', 1), pg_temp.tx('Concluído', 2)], '2026-10-12');
select public.transaction_installments_create('expense', 'Lixeira', 300, 3, 'month', 1, '2026-11-20', pg_temp.fx('bank'), null, pg_temp.fx('cat'), false);
select public.transactions_bulk_trash(array[pg_temp.tx('Lixeira', 3)]);
select public.transaction_installments_create('expense', 'Resto', 100, 3, 'month', 1, '2026-10-20', pg_temp.fx('bank'), null, pg_temp.fx('cat'), false);
select public.transaction_installments_create('expense', 'Em dólar', 200, 2, 'month', 1, '2026-11-20', pg_temp.fx('usd'), null, pg_temp.fx('cat'), false);

select is(pg_temp.linha(pg_temp.chave_conta('Sofá')),
  '1:paid:100.00:2026-09-12:- 2:paid:100.00:2026-10-12:- 3:open:100.00:2026-11-12:-:mes 4:open:100.00:2026-12-12:- 5:open:100.00:2027-01-12:-',
  'L3 Sofá: duas pagas, a do dia do corte é "a vencer" e é a parcela do mês, as outras a vencer; conta não tem rótulo de fatura');
select is(pg_temp.linha(pg_temp.chave_conta('Atraso')),
  '1:paid:100.00:2026-09-01:- 2:overdue:100.00:2026-10-01:- 3:overdue:100.00:2026-11-01:-:mes',
  'L4 Atraso: a não paga que já venceu é "overdue", inclusive a do mês');
select is(pg_temp.linha(pg_temp.chave_conta('Concluído')), '-', 'L5 plano concluído (tudo pago) não aparece');
select is(pg_temp.linha(pg_temp.chave_conta('Lixeira')), '1:open:100.00:2026-11-20:-:mes 2:open:100.00:2026-12-20:-',
  'L6 parcela na lixeira some e a numeração fecha (1 e 2), como o "Parcela n de N" da lista');
select is(pg_temp.linha(pg_temp.chave_conta('Resto')), '1:overdue:33.34:2026-10-20:- 2:open:33.33:2026-11-20:-:mes 3:open:33.33:2026-12-20:-',
  'L7 a sobra de centavos da divisão está na primeira parcela (e ela já venceu sem pagar: "overdue"); o valor vem do banco');
select is((select currency_code from public.installment_plan_schedule(pg_temp.fx('h'), date '2026-11-12') where plan_key = pg_temp.chave_conta('Em dólar') limit 1), 'USD',
  'L8 parcelamento em dólar sai na moeda da conta, sem misturar com reais');

-- Cartão: Notebook 4x R$ 100 comprado em 10/09 (fecha 5, vence 15): faturas 2026-10 a 2027-01
insert into fixture select 'c', public.create_debt('Cartão C', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('c'), 5, 15);
select public.card_purchase(pg_temp.fx('c'), '2026-09-10', 400.00, 4, pg_temp.fx('cat'), 'Notebook');
-- a primeira fatura (2026-10) fecha em 05/10 e é paga por inteiro: a parcela 1 fica "paga"
select public.debt_pay(pg_temp.fx('c'), '2026-10-20', pg_temp.fx('bank'), 100.00, pg_temp.fat(pg_temp.fx('c'), '2026-10'));

select is((select string_agg(installment_number || ':' || state || ':' || invoice_label || ':' || due_date::text || case when in_month then ':mes' else '' end, ' ' order by installment_number)
             from public.installment_plan_schedule(pg_temp.fx('h'), date '2026-11-12') where source_type = 'card'),
  '1:paid:2026-10:2026-10-15 2:open:2026-11:2026-11-15:mes 3:open:2026-12:2026-12-15 4:open:2027-01:2027-01-15',
  'L9 cartão: o rótulo é o da fatura que a tela de Cartões abre, a data é o vencimento da FATURA, a parcela da fatura paga é "paga"');
select is((select count(*)::integer from public.installment_plan_schedule(pg_temp.fx('h'), date '2026-11-12') where source_type = 'card' and source_id = pg_temp.fx('c')), 4,
  'L10 o source_id do cartão é o do cartão (o link da tela usa)');

-- coerência com active_installment_plans (a mesma base): mesmas chaves e mesma quantidade de parcelas vivas
select is((select count(*)::integer from (select distinct plan_key from public.installment_plan_schedule(pg_temp.fx('h'), date '2026-11-12')) s
            where not exists (select 1 from public.active_installment_plans(pg_temp.fx('h'), date '2026-11-12') a where a.row_kind = 'plan' and a.plan_key = s.plan_key)), 0,
  'L11 todo plano da linha do tempo existe em active_installment_plans');
select is((select count(*)::integer from public.active_installment_plans(pg_temp.fx('h'), date '2026-11-12') a where a.row_kind = 'plan'
            and (select count(*) from public.installment_plan_schedule(pg_temp.fx('h'), date '2026-11-12') s where s.plan_key = a.plan_key) <> a.total_count), 0,
  'L12 o número de parcelas de cada plano na linha do tempo é o "N" de active_installment_plans');
select is((select count(*)::integer from public.active_installment_plans(pg_temp.fx('h'), date '2026-11-12') a where a.row_kind = 'plan'
            and (select count(*) from public.installment_plan_schedule(pg_temp.fx('h'), date '2026-11-12') s where s.plan_key = a.plan_key and s.state = 'paid') <> a.paid_count), 0,
  'L13 as parcelas pagas de cada plano batem com o paid_count de active_installment_plans');

-- parâmetros e acesso
select is(pg_temp.sqlstate_of($q$select * from public.installment_plan_schedule(null)$q$), '22023', 'L14 sem família é recusado');
select pg_temp.login('00000000-0000-0000-0000-000000115a02');
select is((select count(*)::integer from public.installment_plan_schedule(pg_temp.fx('h'), date '2026-11-12')), 0, 'L15 outro usuário não vê os parcelamentos da nossa família');
select pg_temp.anon();
select is(pg_temp.sqlstate_of(format($q$select * from public.installment_plan_schedule(%L)$q$, pg_temp.fx('h'))), '42501', 'L16 anônimo sem execute');
select pg_temp.login('00000000-0000-0000-0000-000000115a01');
select is(has_function_privilege('authenticated', 'public.installment_plan_schedule(uuid,date)', 'execute'), true, 'L17 authenticated executa');
select is(has_function_privilege('anon', 'public.installment_plan_schedule(uuid,date)', 'execute'), false, 'L18 anon não executa');

select * from finish();
rollback;
