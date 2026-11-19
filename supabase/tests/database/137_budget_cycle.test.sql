-- 137_budget_cycle: migration 144 (20261119100000). O orçamento passa a valer pelo ciclo do dia em que o mês começa.
-- Chave do orçamento = dia 1 do mês em que o ciclo COMEÇA; com dia 20 a chave 2026-03 vai de 20/03 a 19/04. Com dia 1 (ou sem
-- passar o dia) nada muda: é o mês de calendário. Datas fixas e "hoje" passado como parâmetro.
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
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.sqlstate_of(text) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000137a01', 'ciclo1@teste.com'),
  ('00000000-0000-0000-0000-000000137a02', 'ciclo2@teste.com');

-- Família A: conta em reais e em dólar, Mercado com limite 1000,00 na chave 2026-03, cartão que fecha dia 10
select pg_temp.login('00000000-0000-0000-0000-000000137a01');
insert into fixture select 'h', public.create_household('Casa do Ciclo');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 5000.00, '2026-01-01') returning id)
  insert into fixture select 'bank', id from i;
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date, currency_code)
           values (pg_temp.fx('h'), 'Conta em dólar', 'checking', 500.00, '2026-01-01', 'USD') returning id)
  insert into fixture select 'usd', id from i;
insert into fixture select 'mercado', id from public.categories where household_id = pg_temp.fx('h') and name = 'Mercado';
insert into public.budgets (household_id, category_id, month, amount_limit)
  values (pg_temp.fx('h'), pg_temp.fx('mercado'), '2026-03-01', 1000.00);
-- pago em reais: 19/03 (50) fica fora do ciclo 20→19; 20/03 (70) e 19/04 (30) dentro; 20/04 (999) é do ciclo seguinte
insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status) values
  (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('mercado'), 'expense', 'Dia 19/03', 50.00, '2026-03-19', 'paid'),
  (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('mercado'), 'expense', 'Dia 20/03', 70.00, '2026-03-20', 'paid'),
  (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('mercado'), 'expense', 'Dia 19/04', 30.00, '2026-04-19', 'paid'),
  (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('mercado'), 'expense', 'Dia 20/04', 999.00, '2026-04-20', 'paid'),
  -- dólar não entra no orçamento, nem no ciclo
  (pg_temp.fx('h'), pg_temp.fx('usd'), pg_temp.fx('mercado'), 'expense', 'Em dólar', 77.00, '2026-03-25', 'paid'),
  -- planejado dentro do ciclo (10/04) e fora dele (15/03 e 25/04)
  (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('mercado'), 'expense', 'Plan no ciclo', 200.00, '2026-04-10', 'planned'),
  (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('mercado'), 'expense', 'Plan antes', 11.00, '2026-03-15', 'planned'),
  (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('mercado'), 'expense', 'Plan depois', 13.00, '2026-04-25', 'planned');
-- Cartão (fecha dia 10): compra de 05/03 (60,00) fecha em 10/03, antes do ciclo; a de 25/03 (90,00) fecha em 10/04, dentro
insert into fixture select 'card', public.create_debt('Cartão', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('card'), 10, 20);
select public.card_purchase(pg_temp.fx('card'), '2026-03-05', 60.00, 1, pg_temp.fx('mercado'), 'Cartão antes');
select public.card_purchase(pg_temp.fx('card'), '2026-03-25', 90.00, 1, pg_temp.fx('mercado'), 'Cartão no ciclo');
select public.card_bill_due('2026-04-15');

-- Família B (isolamento)
select pg_temp.login('00000000-0000-0000-0000-000000137a02');
insert into fixture select 'hb', public.create_household('Casa de fora');

-- ---------------------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-000000137a01');

-- Mês de calendário (sem dia, ou dia 1): 19/03 e 20/03 de março + cartão que fechou 10/03 = 50 + 70 + 60
select is((select spent from public.budget_usage(pg_temp.fx('h'), '2026-03-01') where category_id = pg_temp.fx('mercado')), 180.00,
  'C1 sem passar o dia: mês de calendário (março: 50 + 70 + cartão 60)');
select is((select spent from public.budget_usage(pg_temp.fx('h'), '2026-03-01', 1) where category_id = pg_temp.fx('mercado')), 180.00,
  'C2 dia 1 é igual a não passar o dia');
-- Ciclo do dia 20: 20/03 a 19/04 = 70 + 30 + cartão 90 (fechou 10/04); fora: 19/03, 20/04, dólar e o cartão de 10/03
select is((select spent from public.budget_usage(pg_temp.fx('h'), '2026-03-01', 20) where category_id = pg_temp.fx('mercado')), 190.00,
  'C3 dia 20: gasto de 20/03 a 19/04 (70 + 30 + cartão 90)');
select is((select spent from public.budget_usage(pg_temp.fx('h'), '2026-03-15', 20) where category_id = pg_temp.fx('mercado')), 190.00,
  'C4 qualquer data do mês da chave dá o mesmo ciclo');
select is((select remaining || '|' || percent from public.budget_usage(pg_temp.fx('h'), '2026-03-01', 20) where category_id = pg_temp.fx('mercado')),
  '810.00|19.0', 'C5 restante e percentual saem do gasto do ciclo');

-- Projeção do ciclo, "hoje" = 05/04: 17 dias decorridos de 31; ritmo = só o pago sem cartão em 20/03..05/04 (70) / 17 × 14
select is((select spent::numeric(14,2) || '|' || planned::numeric(14,2) || '|' || pace_extra::numeric(14,2) || '|' || projected::numeric(14,2)
                  || '|' || remaining::numeric(14,2)
             from public.budget_projection(pg_temp.fx('h'), '2026-03-01', '2026-04-05', 20) where category_id = pg_temp.fx('mercado')),
  '190.00|200.00|57.65|447.65|552.35',
  'C6 dia 20: gasto 190, planejado 200 (só o de 10/04), ritmo 57,65, projetado 447,65');
-- Sem o dia, a projeção continua a de calendário (hoje 05/04 já passou de março: 31 de 31 dias, sem ritmo, planejado de março)
select is((select spent::numeric(14,2) || '|' || planned::numeric(14,2) || '|' || pace_extra::numeric(14,2)
             from public.budget_projection(pg_temp.fx('h'), '2026-03-01', '2026-04-05') where category_id = pg_temp.fx('mercado')),
  '180.00|11.00|0.00', 'C7 sem o dia: março de calendário (gasto 180, planejado 11, sem ritmo)');
-- Primeiro dia do ciclo: nada decorrido além de 1 dia
select is((select pace_extra from public.budget_projection(pg_temp.fx('h'), '2026-03-01', '2026-03-22', 20) where category_id = pg_temp.fx('mercado')),
  0.00::numeric, 'C8 menos de 7 dias no ciclo: sem ritmo');

-- Dia inválido: erro, nunca resultado vazio
select is(pg_temp.sqlstate_of(format('select * from public.budget_usage(%L, %L, 0)', pg_temp.fx('h'), '2026-03-01')), '22023', 'C9 dia 0 é recusado');
select is(pg_temp.sqlstate_of(format('select * from public.budget_usage(%L, %L, 29)', pg_temp.fx('h'), '2026-03-01')), '22023', 'C10 dia 29 é recusado');
select is(pg_temp.sqlstate_of(format('select * from public.budget_projection(%L, %L, %L, null)', pg_temp.fx('h'), '2026-03-01', '2026-04-05')), '22023', 'C11 dia nulo é recusado');
select lives_ok(format('select * from public.budget_usage(%L, %L, 28)', pg_temp.fx('h'), '2026-03-01'), 'C12 dia 28 vale');

-- Isolamento e permissões
select pg_temp.login('00000000-0000-0000-0000-000000137a02');
select is((select count(*) from public.budget_usage(pg_temp.fx('h'), '2026-03-01', 20)), 0::bigint, 'C13 outra família não lê o orçamento (uso)');
select is((select count(*) from public.budget_projection(pg_temp.fx('h'), '2026-03-01', '2026-04-05', 20)), 0::bigint, 'C14 outra família não lê o orçamento (projeção)');
select ok(not has_function_privilege('anon', 'public.budget_usage(uuid,date,int)', 'EXECUTE'), 'C15 anon não executa budget_usage');
select ok(not has_function_privilege('anon', 'public.budget_projection(uuid,date,date,int)', 'EXECUTE'), 'C16 anon não executa budget_projection');
select ok(has_function_privilege('authenticated', 'public.budget_projection(uuid,date,date,int)', 'EXECUTE'), 'C17 authenticated executa budget_projection');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('budget_usage', 'budget_projection')), 2::bigint,
  'C18 sem sobrecarga antiga: uma assinatura de cada');

select * from finish();
rollback;
