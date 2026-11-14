-- 116_installment_month_summary: resumo do mês dos parcelamentos, para o card "Parcelas e carnês" (migration 20261114140000).
-- Leitura pura, apoiada em active_installment_plans e installment_plan_schedule (o teste confere a soma contra elas). Datas fixas e corte explícito ('2026-11-12'): não depende do dia em que roda. Dados inventados.
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
grant execute on all functions in schema pg_temp to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000116a01', 'resumo1@teste.com'),
  ('00000000-0000-0000-0000-000000116a02', 'resumo2@teste.com');
select pg_temp.login('00000000-0000-0000-0000-000000116a01');
insert into fixture select 'h', public.create_household('Casa do resumo do mês');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 9000.00, '2026-01-01') returning id)
  insert into fixture select 'bank', id from i;
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date, currency_code)
           values (pg_temp.fx('h'), 'Banco USD', 'checking', 500.00, '2026-01-01', 'USD') returning id)
  insert into fixture select 'usd', id from i;
insert into fixture select 'cat', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';

create function pg_temp.chave_conta(p_desc text) returns text language sql as $f$
  select 'account:' || installment_group::text from public.transactions where description like p_desc || ' %' and installment_number = 1 $f$;
-- a linha da moeda como "ativos|com parcela no mês|total|pago|falta|exemplos"
create function pg_temp.resumo(p_moeda text, p_h text default 'h') returns text language sql as $f$
  select coalesce(active_count || '|' || month_count || '|' || month_total::numeric(14,2) || '|' || paid_total::numeric(14,2) || '|' || pending_total::numeric(14,2) || '|' || examples::text, '-')
    from public.installment_month_summary(pg_temp.fx(p_h), date '2026-11-12') where currency_code = p_moeda $f$;
grant execute on all functions in schema pg_temp to public;

select has_function('public', 'installment_month_summary', array['uuid', 'date'], 'M1 existe installment_month_summary(uuid, date)');
select is((select count(*)::integer from public.installment_month_summary(pg_temp.fx('h'), date '2026-11-12')), 0, 'M2 sem parcelamentos: nenhuma linha');

-- Conta (corte em 12/11/2026), todas em reais salvo o dólar; "no mês" = vence em novembro:
--   Sofá 5x R$ 100 desde 12/09: 1 e 2 pagas; a 3ª (12/11) no mês, depois PAGA no teste
--   Atraso 3x R$ 100 desde 01/09: a 1ª paga; a 3ª (01/11) no mês, vencida e não paga
--   Lixeira 3x R$ 100 desde 20/11, a 3ª na lixeira: a 1ª (20/11) no mês
--   Resto 3x R$ 100,00 desde 20/10 (33,34 + 33,33 + 33,33): a 2ª (20/11) no mês, R$ 33,33
--   Futuro 3x R$ 100 desde 05/12: nenhuma parcela em novembro (ativo, mas fora do mês)
--   Concluído 2x: tudo pago, não é ativo
--   Em dólar 2x USD 100 desde 20/11: a 1ª no mês, em outra moeda
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
select public.transaction_installments_create('expense', 'Futuro', 300, 3, 'month', 1, '2026-12-05', pg_temp.fx('bank'), null, pg_temp.fx('cat'), false);
select public.transaction_installments_create('expense', 'Em dólar', 200, 2, 'month', 1, '2026-11-20', pg_temp.fx('usd'), null, pg_temp.fx('cat'), false);

-- Cartão: Notebook 4x R$ 100 comprado em 10/09 (fecha 5, vence 15): a fatura 2026-10 paga (parcela 1 paga); a 2026-11 vence em 15/11 (no mês)
insert into fixture select 'c', public.create_debt('Cartão C', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('c'), 5, 15);
select public.card_purchase(pg_temp.fx('c'), '2026-09-10', 400.00, 4, pg_temp.fx('cat'), 'Notebook');
select public.debt_pay(pg_temp.fx('c'), '2026-10-20', pg_temp.fx('bank'), 100.00, pg_temp.fat(pg_temp.fx('c'), '2026-10'));

-- nada pago no mês ainda: no mês vencem Sofá 100 + Atraso 100 + Lixeira 100 + Resto 33,33 + Notebook 100 = 433,33
select is(pg_temp.resumo('BRL'), '6|5|433.33|0.00|433.33|{Atraso,Futuro,Lixeira}',
  'M3 em reais: 6 ativos, 5 com parcela no mês, R$ 433,33 no mês (nada pago ainda), exemplos pelas maiores parcelas');
select is(pg_temp.resumo('USD'), '1|1|100.00|0.00|100.00|{"Em dólar"}', 'M4 o parcelamento em dólar fica na moeda dele, sem misturar com reais');

-- pagar a parcela do mês do Sofá: o total do mês não muda; a parte paga sobe e a que falta desce
select public.transactions_bulk_mark_paid(array[pg_temp.tx('Sofá', 3)], '2026-11-12');
select is(pg_temp.resumo('BRL'), '6|5|433.33|100.00|333.33|{Atraso,Futuro,Lixeira}',
  'M5 pagar a parcela do mês move R$ 100 de "falta" para "pago" e não muda o total do mês');

-- o plano que só tem parcela futura conta como ativo, mas não entra no mês
select is((select active_count - month_count from public.installment_month_summary(pg_temp.fx('h'), date '2026-11-12') where currency_code = 'BRL'), 1,
  'M6 o parcelamento sem parcela em novembro (Futuro) é ativo e fica fora do mês');

-- a soma vem das duas funções-base: bate com a linha do tempo (parcelas do mês) e com active_installment_plans (quantos ativos)
select is((select month_total from public.installment_month_summary(pg_temp.fx('h'), date '2026-11-12') where currency_code = 'BRL'),
          (select sum(amount) from public.installment_plan_schedule(pg_temp.fx('h'), date '2026-11-12') where in_month and currency_code = 'BRL'),
  'M7 o total do mês é a soma das parcelas do mês da linha do tempo');
select is((select active_count from public.installment_month_summary(pg_temp.fx('h'), date '2026-11-12') where currency_code = 'BRL'),
          (select count(*)::integer from public.active_installment_plans(pg_temp.fx('h'), date '2026-11-12') where row_kind = 'plan' and currency_code = 'BRL'),
  'M8 os ativos são os de active_installment_plans');
select is((select paid_total + pending_total - month_total from public.installment_month_summary(pg_temp.fx('h'), date '2026-11-12') where currency_code = 'BRL'), 0::numeric,
  'M9 pago + falta = total do mês');

-- o mês muda com a data de corte: em 12/12 vencem Sofá (12/12), Futuro (05/12), Lixeira (20/12), Resto (20/12) e Notebook (15/12); Atraso já acabou o ciclo
select is((select month_count from public.installment_month_summary(pg_temp.fx('h'), date '2026-12-12') where currency_code = 'BRL'), 5,
  'M10 o mês acompanha p_as_of (dezembro: 5 parcelamentos com parcela no mês)');

-- parâmetros e acesso
select is(pg_temp.sqlstate_of($q$select * from public.installment_month_summary(null)$q$), '22023', 'M11 sem família é recusado');
select pg_temp.login('00000000-0000-0000-0000-000000116a02');
select is((select count(*)::integer from public.installment_month_summary(pg_temp.fx('h'), date '2026-11-12')), 0, 'M12 outro usuário não vê os parcelamentos da nossa família');
select pg_temp.anon();
select is(pg_temp.sqlstate_of(format($q$select * from public.installment_month_summary(%L)$q$, pg_temp.fx('h'))), '42501', 'M13 anônimo sem execute');
select pg_temp.login('00000000-0000-0000-0000-000000116a01');
select is(has_function_privilege('authenticated', 'public.installment_month_summary(uuid,date)', 'execute'), true, 'M14 authenticated executa');
select is(has_function_privilege('anon', 'public.installment_month_summary(uuid,date)', 'execute'), false, 'M15 anon não executa');

select * from finish();
rollback;
