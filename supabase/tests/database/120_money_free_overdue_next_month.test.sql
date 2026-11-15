-- 120_money_free_overdue_next_month: Dinheiro Livre considera a despesa planejada ATRASADA de meses anteriores e o mês SEGUINTE
-- (migration 20261115160000). Leitura pura de public.get_home_decision_month. Datas relativas a hoje em São Paulo; dados inventados.
-- Decisão do dono (15/11/2026): atrasada reduz o livre; horizonte = mês corrente + mês seguinte; receita planejada e outras moedas
-- ficam de fora; o atraso dentro do mês já está na matriz (não conta duas vezes). Sem a migration este arquivo falha nas asserções.
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
-- o JSON da Home do mês atual como jsonb (nulo se der erro); o livre como numérico
create function pg_temp.home(p_h uuid) returns jsonb language plpgsql as $f$
declare r jsonb;
begin
  execute $q$select public.get_home_decision_month($1, $2)$q$ into r using p_h, pg_temp.mes();
  return r;
exception when others then return null;
end $f$;
create function pg_temp.livre(p_h uuid) returns numeric language sql as $f$ select (pg_temp.home(p_h)->>'moneyFree')::numeric $f$;
grant execute on function pg_temp.fx(text), pg_temp.hoje(), pg_temp.mes(), pg_temp.login(uuid), pg_temp.home(uuid), pg_temp.livre(uuid) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000120001', 'liv1@teste.com'),
  ('00000000-0000-0000-0000-000000120002', 'liv2@teste.com');
select pg_temp.login('00000000-0000-0000-0000-000000120001');
insert into fixture select 'h', public.create_household('Casa do dinheiro livre');
insert into public.accounts (household_id, name, type, initial_balance, opening_date, currency_code)
values (pg_temp.fx('h'), 'Corrente', 'checking', 0, '2020-01-01', 'BRL'),
       (pg_temp.fx('h'), 'Dólar', 'checking', 0, '2020-01-01', 'USD');
insert into fixture select 'brl', id from public.accounts where household_id = pg_temp.fx('h') and name = 'Corrente';
insert into fixture select 'usd', id from public.accounts where household_id = pg_temp.fx('h') and name = 'Dólar';
insert into fixture select 'cexp', id from public.categories where household_id = pg_temp.fx('h') and type = 'expense' and system_key = 'uncategorized' limit 1;
insert into fixture select 'cinc', id from public.categories where household_id = pg_temp.fx('h') and type = 'income' and system_key = 'uncategorized' limit 1;

-- disponível de 1000 (receita paga hoje); nenhum compromisso ainda
insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status)
values (pg_temp.fx('h'), pg_temp.fx('brl'), pg_temp.fx('cinc'), 'income', 'Salário', 1000, pg_temp.hoje(), 'paid');

select is(pg_temp.livre(pg_temp.fx('h')), 1000::numeric, 'L1 sem compromisso: o livre é o disponível (1000)');

-- atrasada de dois meses atrás: reduz o livre e aparece como um item próprio
insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status)
values (pg_temp.fx('h'), pg_temp.fx('brl'), pg_temp.fx('cexp'), 'expense', 'Aluguel atrasado', 100, (pg_temp.mes() - interval '2 months')::date + 4, 'planned');
select is(pg_temp.livre(pg_temp.fx('h')), 900::numeric, 'L2 despesa planejada atrasada de mês anterior (100) reduz o livre');
select is((select (i->>'amount')::numeric from jsonb_array_elements(pg_temp.home(pg_temp.fx('h'))->'upcoming_commitments') i where i->>'id' = 'overdue:before-month'),
  100::numeric, 'L2b a atrasada aparece como o item "Despesas em atraso de meses anteriores"');

-- mês seguinte entra
insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status)
values (pg_temp.fx('h'), pg_temp.fx('brl'), pg_temp.fx('cexp'), 'expense', 'Conta do mês seguinte', 50, (pg_temp.mes() + interval '1 month')::date + 9, 'planned');
select is(pg_temp.livre(pg_temp.fx('h')), 850::numeric, 'L3 despesa planejada do mês seguinte (50) reduz o livre');

-- dois meses à frente não entra
insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status)
values (pg_temp.fx('h'), pg_temp.fx('brl'), pg_temp.fx('cexp'), 'expense', 'Conta daqui a dois meses', 30, (pg_temp.mes() + interval '2 months')::date + 3, 'planned');
select is(pg_temp.livre(pg_temp.fx('h')), 850::numeric, 'L4 despesa planejada daqui a dois meses (30) fica fora do horizonte');

-- receita planejada do mês seguinte não entra (decisão: só despesas)
insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status)
values (pg_temp.fx('h'), pg_temp.fx('brl'), pg_temp.fx('cinc'), 'income', 'Receita do mês seguinte', 500, (pg_temp.mes() + interval '1 month')::date + 4, 'planned');
select is(pg_temp.livre(pg_temp.fx('h')), 850::numeric, 'L5 receita planejada não entra no livre');

-- conta em dólar atrasada não entra (só reais)
insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status)
values (pg_temp.fx('h'), pg_temp.fx('usd'), pg_temp.fx('cexp'), 'expense', 'Atrasada em dólar', 4000, (pg_temp.mes() - interval '1 month')::date + 2, 'planned');
select is(pg_temp.livre(pg_temp.fx('h')), 850::numeric, 'L6 atrasada em conta que não é reais fica de fora');

-- despesa planejada no 1º dia do mês corrente: já está na matriz, não é "atrasada de mês anterior": conta uma vez só
insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status)
values (pg_temp.fx('h'), pg_temp.fx('brl'), pg_temp.fx('cexp'), 'expense', 'Conta do dia 1', 20, pg_temp.mes(), 'planned');
select is(pg_temp.livre(pg_temp.fx('h')), 830::numeric, 'L7 despesa planejada do mês corrente (20) conta uma vez, não duas');
select is((select (i->>'amount')::numeric from jsonb_array_elements(pg_temp.home(pg_temp.fx('h'))->'upcoming_commitments') i where i->>'id' = 'overdue:before-month'),
  100::numeric, 'L7b o item de atraso continua só com a de mês anterior (100)');

-- paga deixa de ser compromisso
update public.transactions set status = 'paid' where household_id = pg_temp.fx('h') and description = 'Aluguel atrasado';
select is((select (i->>'amount')::numeric from jsonb_array_elements(pg_temp.home(pg_temp.fx('h'))->'upcoming_commitments') i where i->>'id' = 'overdue:before-month'),
  null::numeric, 'L8 a atrasada paga sai do compromisso (sem item de atraso)');

-- declara o horizonte
select is((pg_temp.home(pg_temp.fx('h'))->'calculation'->>'horizonMonths')::int, 2, 'L9 o payload declara o horizonte de 2 meses');
select is((pg_temp.home(pg_temp.fx('h'))->'calculation'->>'overdueBeforeMonthIncluded')::boolean, true, 'L10 o payload declara que atrasadas de meses anteriores entram');

-- isolamento: quem não é da família não recebe nada
select pg_temp.login('00000000-0000-0000-0000-000000120002');
select is(pg_temp.home(pg_temp.fx('h')), null::jsonb, 'L11 outro usuário não recebe a Home da nossa família');

select * from finish();
rollback;
