-- 114_installments_ending_soon: parcelamentos que terminam em breve e quanto liberam por mês (migration 20261114100000).
-- Leitura pura. Mesma definição de "parcelamento ativo" e de "parcela paga" de active_installment_plans (o teste confere as duas
-- funções entre si). Todas as datas são fixas e a data de corte é passada de forma explícita ('2026-11-12'): o resultado não
-- depende do dia em que o teste roda. Dados inventados. Sem a migration este arquivo falha (a função não existe).
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
-- os planos EM REAIS que terminam em breve como texto "nome|última data|valor", em ordem; p_dias é o horizonte
create function pg_temp.fim(p_dias int, p_h text default 'h') returns text language sql as $f$
  select coalesce(string_agg(description || '|' || last_due || '|' || freed_monthly::numeric(14,2), ' ; ' order by last_due, description), '-')
    from public.installments_ending_soon(pg_temp.fx(p_h), p_dias, date '2026-11-12') where row_kind = 'plan' and currency_code = 'BRL' $f$;
create function pg_temp.tot(p_dias int, p_moeda text default 'BRL') returns text language sql as $f$
  select coalesce(plan_count || '|' || freed_monthly::numeric(14,2), '-')
    from public.installments_ending_soon(pg_temp.fx('h'), p_dias, date '2026-11-12') where row_kind = 'total' and currency_code = p_moeda $f$;
grant execute on all functions in schema pg_temp to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000114a01', 'fim1@teste.com'),
  ('00000000-0000-0000-0000-000000114a02', 'fim2@teste.com');
select pg_temp.login('00000000-0000-0000-0000-000000114a01');
insert into fixture select 'h', public.create_household('Casa dos parcelamentos que acabam');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 9000.00, '2026-01-01') returning id)
  insert into fixture select 'bank', id from i;
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date, currency_code)
           values (pg_temp.fx('h'), 'Banco USD', 'checking', 500.00, '2026-01-01', 'USD') returning id)
  insert into fixture select 'usd', id from i;
insert into fixture select 'cat', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';

select has_function('public', 'installments_ending_soon', array['uuid', 'integer', 'date'], 'E1 existe installments_ending_soon(uuid, integer, date)');
select is(pg_temp.fim(60), '-', 'E2 sem parcelamentos: nenhuma linha');

-- Conta (datas fixas; corte em 12/11/2026):
--   Sofá 5x R$ 100 desde 12/09: 1 e 2 pagas; a última vence 12/01/2027 (61 dias depois do corte)
--   Curso 3x R$ 100 desde 20/09, nada pago: a última vence 20/11 (8 dias)
--   Terço 3x R$ 100 desde 25/09: 2 pagas, a última vence 25/11 (13 dias)
--   Pago no mês 3x R$ 100 desde 05/11: a última vence 05/01/2027 (54 dias)
--   Concluído 2x R$ 200: tudo pago, não é ativo
--   Lixeira 3x R$ 100 desde 20/11, a 3ª na lixeira: sobram 2 (a última vence 20/12, 38 dias)
--   Atrasado 2x R$ 100 desde 01/09, nada pago: a última (01/10) já venceu e não foi paga: atraso não conta
select public.transaction_installments_create('expense', 'Sofá', 500, 5, 'month', 1, '2026-09-12', pg_temp.fx('bank'), null, pg_temp.fx('cat'), true);
select public.transactions_bulk_mark_paid(array[pg_temp.tx('Sofá', 2)], '2026-10-12');
select public.transaction_installments_create('expense', 'Curso', 300, 3, 'month', 1, '2026-09-20', pg_temp.fx('bank'), null, pg_temp.fx('cat'), false);
select public.transaction_installments_create('expense', 'Terço', 300, 3, 'month', 1, '2026-09-25', pg_temp.fx('bank'), null, pg_temp.fx('cat'), true);
select public.transactions_bulk_mark_paid(array[pg_temp.tx('Terço', 2)], '2026-10-25');
select public.transaction_installments_create('expense', 'Pago no mês', 300, 3, 'month', 1, '2026-11-05', pg_temp.fx('bank'), null, pg_temp.fx('cat'), true);
select public.transaction_installments_create('expense', 'Concluído', 400, 2, 'month', 1, '2026-09-12', pg_temp.fx('bank'), null, pg_temp.fx('cat'), true);
select public.transactions_bulk_mark_paid(array[pg_temp.tx('Concluído', 2)], '2026-10-12');
select public.transaction_installments_create('expense', 'Lixeira', 300, 3, 'month', 1, '2026-11-20', pg_temp.fx('bank'), null, pg_temp.fx('cat'), false);
select public.transactions_bulk_trash(array[pg_temp.tx('Lixeira', 3)]);
select public.transaction_installments_create('expense', 'Atrasado', 200, 2, 'month', 1, '2026-09-01', pg_temp.fx('bank'), null, pg_temp.fx('cat'), false);
--   Resto 3x R$ 100,00 desde 20/10: a divisão é 33,34 + 33,33 + 33,33; a primeira leva a sobra e a ÚLTIMA (20/12) é o valor-base
--   Quitado 2x R$ 100 desde 12/11, as duas já pagas (a segunda paga em 12/11): plano concluído, mesmo com a última data dentro do horizonte
select public.transaction_installments_create('expense', 'Resto', 100, 3, 'month', 1, '2026-10-20', pg_temp.fx('bank'), null, pg_temp.fx('cat'), false);
select public.transaction_installments_create('expense', 'Quitado', 200, 2, 'month', 1, '2026-11-12', pg_temp.fx('bank'), null, pg_temp.fx('cat'), true);
select public.transactions_bulk_mark_paid(array[pg_temp.tx('Quitado', 2)], '2026-11-12');
-- em dólar: não se mistura com reais
select public.transaction_installments_create('expense', 'Em dólar', 200, 2, 'month', 1, '2026-11-20', pg_temp.fx('usd'), null, pg_temp.fx('cat'), false);

-- Cartão: Notebook 4x R$ 100 comprado em 10/09 (fecha 5, vence 15): faturas 10/2026 a 01/2027, a última vence 15/01/2027
insert into fixture select 'c', public.create_debt('Cartão C', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('c'), 5, 15);
select public.card_purchase(pg_temp.fx('c'), '2026-09-10', 400.00, 4, pg_temp.fx('cat'), 'Notebook');

-- 60 dias: Curso (20/11), Terço (25/11), Lixeira (20/12), Pago no mês (05/01); Sofá (61 dias) e Notebook (64) ficam de fora
select is(pg_temp.fim(60),
  'Curso|2026-11-20|100.00 ; Terço|2026-11-25|100.00 ; Lixeira|2026-12-20|100.00 ; Resto|2026-12-20|33.33 ; Pago no mês|2027-01-05|100.00',
  'E3 em 60 dias: só os que acabam dentro do horizonte, com a última data e o valor da última parcela');
select is(pg_temp.tot(60), '5|433.33', 'E4 o total vem do banco: 5 planos, R$ 433,33 por mês (a tela não soma; a última parcela do Resto vale 33,33, não 33,34)');
select is((select string_agg(description || '|' || last_due, ';') from public.installments_ending_soon(pg_temp.fx('h'), 60, date '2026-11-12') where row_kind = 'plan' and currency_code = 'USD'), 'Em dólar|2026-12-20', 'E5b o plano em dólar aparece à parte, na moeda dele');
select is(pg_temp.tot(60, 'USD'), '1|100.00', 'E5 o parcelamento em dólar fica na moeda dele (1 plano, 100,00), sem misturar com reais');

-- fronteira: o dia do corte + p_dias ENTRA. Sofá vence a 61 dias (12/01/2027); Notebook a 64 (15/01/2027)
select is(pg_temp.fim(61), 'Curso|2026-11-20|100.00 ; Terço|2026-11-25|100.00 ; Lixeira|2026-12-20|100.00 ; Resto|2026-12-20|33.33 ; Pago no mês|2027-01-05|100.00 ; Sofá|2027-01-12|100.00',
  'E6 com 61 dias o Sofá entra (o último dia conta); o Notebook (64) ainda não');
select is(pg_temp.fim(64), 'Curso|2026-11-20|100.00 ; Terço|2026-11-25|100.00 ; Lixeira|2026-12-20|100.00 ; Resto|2026-12-20|33.33 ; Pago no mês|2027-01-05|100.00 ; Sofá|2027-01-12|100.00 ; Notebook|2027-01-15|100.00',
  'E7 com 64 dias o Notebook de cartão entra, com o vencimento da FATURA (15/01), não a data da compra');
select is(pg_temp.fim(7), '-', 'E8 em 7 dias não acaba nada (o Curso acaba em 8)');
select is(pg_temp.fim(8), 'Curso|2026-11-20|100.00', 'E9 em 8 dias só o Curso');

-- o que não conta
select is((select count(*)::integer from public.installments_ending_soon(pg_temp.fx('h'), 366, date '2026-11-12') where description in ('Concluído', 'Atrasado', 'Quitado')), 0,
  'E10 plano concluído (inclusive o quitado com a última data dentro do horizonte) e plano em atraso (última parcela já vencida e não paga) nunca aparecem');

-- confere com active_installment_plans (a mesma base): todo plano que termina em breve é um plano ativo, com a mesma chave e moeda
select is((select count(*)::integer from public.installments_ending_soon(pg_temp.fx('h'), 366, date '2026-11-12') f
            where f.row_kind = 'plan' and not exists (select 1 from public.active_installment_plans(pg_temp.fx('h'), date '2026-11-12') a
                                                        where a.row_kind = 'plan' and a.plan_key = f.plan_key and a.currency_code = f.currency_code)), 0,
  'E11 todo plano que termina em breve existe em active_installment_plans');
select is((select count(*)::integer from public.installments_ending_soon(pg_temp.fx('h'), 366, date '2026-11-12') where row_kind = 'plan'),
          (select count(*)::integer from public.active_installment_plans(pg_temp.fx('h'), date '2026-11-12') where row_kind = 'plan' and next_due is not null and
             not (description in ('Atrasado'))),
  'E12 com 366 dias, todos os planos ativos (menos o que está em atraso) terminam em breve: as duas funções concordam sobre o que é ativo');

-- parâmetros e acesso
select is(pg_temp.sqlstate_of(format($q$select * from public.installments_ending_soon(%L, 0)$q$, pg_temp.fx('h'))), '22023', 'E13 zero dias é recusado');
select is(pg_temp.sqlstate_of(format($q$select * from public.installments_ending_soon(%L, 367)$q$, pg_temp.fx('h'))), '22023', 'E14 mais de 366 dias é recusado');
select is(pg_temp.sqlstate_of($q$select * from public.installments_ending_soon(null)$q$), '22023', 'E15 sem família é recusado');
select pg_temp.login('00000000-0000-0000-0000-000000114a02');
select is(pg_temp.fim(366), '-', 'E16 outro usuário não vê os parcelamentos da nossa família');
select pg_temp.anon();
select is(pg_temp.sqlstate_of(format($q$select * from public.installments_ending_soon(%L, 60)$q$, pg_temp.fx('h'))), '42501', 'E17 anônimo sem execute');
select pg_temp.login('00000000-0000-0000-0000-000000114a01');
select is(has_function_privilege('authenticated', 'public.installments_ending_soon(uuid,integer,date)', 'execute'), true, 'E18 authenticated executa');
select is(has_function_privilege('anon', 'public.installments_ending_soon(uuid,integer,date)', 'execute'), false, 'E19 anon não executa');

select * from finish();
rollback;
