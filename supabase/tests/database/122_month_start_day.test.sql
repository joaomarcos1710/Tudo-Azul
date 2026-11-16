-- 122_month_start_day: migration 128. Dia em que o mês financeiro começa (user_preferences.month_start_day, de 1 a 28, padrão 1) e
-- "Limite diário seguro" dividido pelos dias até a véspera do próximo dia D (decisão do dono, 16/11/2026: salário no dia 20).
-- Leitura de public.get_home_decision_month. Datas relativas a hoje em São Paulo; dados inventados. O Dinheiro Livre NÃO muda com D.
-- Sem a migration este arquivo falha nas asserções (a coluna e as chaves novas não existem).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create temp table fixture (k text primary key, v uuid);
grant all on fixture to public;
create function pg_temp.fx(p_k text) returns uuid language sql as $f$ select v from fixture where k = p_k $f$;
create function pg_temp.hoje() returns date language sql as $f$ select (now() at time zone 'America/Sao_Paulo')::date $f$;
create function pg_temp.mes() returns date language sql as $f$ select date_trunc('month', pg_temp.hoje())::date $f$;
create function pg_temp.login(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $f$;
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
create function pg_temp.home(p_h uuid) returns jsonb language plpgsql as $f$
declare r jsonb;
begin
  execute $q$select public.get_home_decision_month($1, $2)$q$ into r using p_h, pg_temp.mes();
  return r;
exception when others then return null;
end $f$;
-- fim do ciclo calculado de OUTRO jeito (o menor dia D depois de hoje, menos 1), para não repetir a fórmula da migration
create function pg_temp.fim_do_ciclo(p_dia int) returns date language sql as $f$
  select min(d)::date - 1 from generate_series(pg_temp.hoje() + 1, pg_temp.hoje() + 40, interval '1 day') d
   where extract(day from d) = p_dia $f$;
grant execute on function pg_temp.fx(text), pg_temp.hoje(), pg_temp.mes(), pg_temp.login(uuid), pg_temp.sqlstate_of(text),
  pg_temp.home(uuid), pg_temp.fim_do_ciclo(int) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000122001', 'dia1@teste.com'),
  ('00000000-0000-0000-0000-000000122002', 'dia2@teste.com');
select pg_temp.login('00000000-0000-0000-0000-000000122001');
insert into fixture select 'h', public.create_household('Casa do mês financeiro');
insert into public.accounts (household_id, name, type, initial_balance, opening_date, currency_code)
values (pg_temp.fx('h'), 'Corrente', 'checking', 0, '2020-01-01', 'BRL');
insert into fixture select 'brl', id from public.accounts where household_id = pg_temp.fx('h') and name = 'Corrente';
insert into fixture select 'cexp', id from public.categories where household_id = pg_temp.fx('h') and type = 'expense' and system_key = 'uncategorized' limit 1;
insert into fixture select 'cinc', id from public.categories where household_id = pg_temp.fx('h') and type = 'income' and system_key = 'uncategorized' limit 1;
insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status)
values (pg_temp.fx('h'), pg_temp.fx('brl'), pg_temp.fx('cinc'), 'income', 'Salário', 1000, pg_temp.hoje(), 'paid');

-- ---------------------------------------------------------------------------
-- 1. Sem preferência: tudo como antes (dia 1 = mês-calendário)
-- ---------------------------------------------------------------------------
select is((pg_temp.home(pg_temp.fx('h'))->'calculation'->>'monthStartDay')::int, 1, 'D1 sem preferência o dia é 1');
select is((pg_temp.home(pg_temp.fx('h'))->'calculation'->>'dailyLimitUntil')::date,
          (date_trunc('month', pg_temp.hoje()) + interval '1 month - 1 day')::date, 'D2 dia 1: o ciclo termina no último dia do mês');
select is((pg_temp.home(pg_temp.fx('h'))->>'dailySafeLimit')::numeric,
          round(1000::numeric / ((date_trunc('month', pg_temp.hoje()) + interval '1 month - 1 day')::date - pg_temp.hoje() + 1), 2),
          'D3 dia 1: limite diário = livre / dias até o fim do mês (igual a antes da migration)');

-- ---------------------------------------------------------------------------
-- 2. Dia 20 (o caso do dono) e outros dias
-- ---------------------------------------------------------------------------
select pg_temp.sqlstate_of(format($$insert into public.user_preferences (user_id, month_start_day) values (%L, 20)$$, '00000000-0000-0000-0000-000000122001'));
select is((pg_temp.home(pg_temp.fx('h'))->'calculation'->>'monthStartDay')::int, 20, 'D4 com a preferência 20 o JSON diz 20');
select is((pg_temp.home(pg_temp.fx('h'))->'calculation'->>'dailyLimitUntil')::date, pg_temp.fim_do_ciclo(20),
          'D5 dia 20: o ciclo termina na véspera do próximo dia 20');
select is((pg_temp.home(pg_temp.fx('h'))->>'dailySafeLimit')::numeric,
          round(1000::numeric / (pg_temp.fim_do_ciclo(20) - pg_temp.hoje() + 1), 2),
          'D6 dia 20: limite diário = livre / dias até a véspera do próximo dia 20 (conta hoje)');
select is((pg_temp.home(pg_temp.fx('h'))->>'moneyFree')::numeric, 1000::numeric, 'D7 o Dinheiro Livre NÃO muda com o dia (etapa 2 é outra decisão)');

-- o próprio dia D: o ciclo recomeça hoje (o salário acabou de cair), então vai até a véspera do dia D do mês seguinte
update public.user_preferences set month_start_day = least(extract(day from pg_temp.hoje())::int, 28) where user_id = '00000000-0000-0000-0000-000000122001';
select is((pg_temp.home(pg_temp.fx('h'))->'calculation'->>'dailyLimitUntil')::date,
          pg_temp.fim_do_ciclo(least(extract(day from pg_temp.hoje())::int, 28)),
          'D8 hoje é o dia D (ou 28): o ciclo novo começa hoje e termina na véspera do próximo dia D');
-- o dia seguinte ao dia D: o ciclo vai até o dia D do mês que vem menos 1, sem passar do mês
update public.user_preferences set month_start_day = 28 where user_id = '00000000-0000-0000-0000-000000122001';
select is((pg_temp.home(pg_temp.fx('h'))->'calculation'->>'dailyLimitUntil')::date, pg_temp.fim_do_ciclo(28), 'D9 dia 28 funciona em qualquer mês');

-- ---------------------------------------------------------------------------
-- 3. Limites do dia e Dinheiro Livre negativo
-- ---------------------------------------------------------------------------
select is(pg_temp.sqlstate_of(format($$update public.user_preferences set month_start_day = 29 where user_id = %L$$, '00000000-0000-0000-0000-000000122001')),
          '23514', 'V1 dia 29 recusado (fevereiro): o limite é 28');
select is(pg_temp.sqlstate_of(format($$update public.user_preferences set month_start_day = 0 where user_id = %L$$, '00000000-0000-0000-0000-000000122001')),
          '23514', 'V2 dia 0 recusado');
update public.user_preferences set month_start_day = 20 where user_id = '00000000-0000-0000-0000-000000122001';
insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status)
values (pg_temp.fx('h'), pg_temp.fx('brl'), pg_temp.fx('cexp'), 'expense', 'Conta que estoura', 3000, pg_temp.hoje(), 'planned');
select is((pg_temp.home(pg_temp.fx('h'))->>'moneyFree')::numeric, -2000::numeric, 'N1 livre negativo (1000 − 3000)');
select is((pg_temp.home(pg_temp.fx('h'))->>'dailySafeLimit')::numeric, 0::numeric, 'N2 livre negativo: o limite diário é 0, nunca negativo');

-- ---------------------------------------------------------------------------
-- 4. A preferência é de cada pessoa: outra pessoa não vê nem herda a do dono
-- ---------------------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-000000122002');
insert into fixture select 'h2', public.create_household('Outra casa');
select is((select count(*) from public.user_preferences where user_id = '00000000-0000-0000-0000-000000122001'), 0::bigint,
          'R1 outra pessoa não lê a preferência do dono');
select is((pg_temp.home(pg_temp.fx('h2'))->'calculation'->>'monthStartDay')::int, 1, 'R2 outra pessoa sem preferência continua no dia 1');
select is((pg_temp.home(pg_temp.fx('h2'))->'calculation'->>'dailyLimitUntil')::date,
          (date_trunc('month', pg_temp.hoje()) + interval '1 month - 1 day')::date, 'R3 e o ciclo dela termina no fim do mês');

select * from finish();
rollback;
