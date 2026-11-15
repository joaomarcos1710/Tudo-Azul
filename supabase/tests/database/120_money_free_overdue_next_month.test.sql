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
  ('00000000-0000-0000-0000-000000120002', 'liv2@teste.com'),
  ('00000000-0000-0000-0000-000000120003', 'liv3@teste.com');
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

-- visão de um mês FUTURO (p_month = mês seguinte): "atrasada" é só o que já venceu (antes de hoje); o que ainda vai vencer antes daquele mês
-- não é atraso. Uma despesa planejada no último dia deste mês (hoje ou depois) não entra como atrasada.
insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status)
values (pg_temp.fx('h'), pg_temp.fx('brl'), pg_temp.fx('cexp'), 'expense', 'Conta no último dia do mês', 7, (pg_temp.mes() + interval '1 month')::date - 1, 'planned');
create function pg_temp.atraso_futuro(p_h uuid) returns numeric language plpgsql as $f$
declare r jsonb;
begin
  execute $q$select public.get_home_decision_month($1, $2)$q$ into r using p_h, (pg_temp.mes() + interval '1 month')::date;
  return (select (i->>'amount')::numeric from jsonb_array_elements(r->'upcoming_commitments') i where i->>'id' = 'overdue:before-month');
exception when others then return -1;
end $f$;
grant execute on function pg_temp.atraso_futuro(uuid) to public;
select is(pg_temp.atraso_futuro(pg_temp.fx('h')), 100::numeric + case when pg_temp.mes() < pg_temp.hoje() then 20 else 0 end,
  'L7c mês futuro: "atrasada" só conta o que já venceu (aluguel 100, mais a do dia 1 se já passou); a de 7 no último dia do mês não é atraso');

-- paga deixa de ser compromisso
update public.transactions set status = 'paid' where household_id = pg_temp.fx('h') and description = 'Aluguel atrasado';
select is((select (i->>'amount')::numeric from jsonb_array_elements(pg_temp.home(pg_temp.fx('h'))->'upcoming_commitments') i where i->>'id' = 'overdue:before-month'),
  null::numeric, 'L8 a atrasada paga sai do compromisso (sem item de atraso)');

-- declara o horizonte
select is((pg_temp.home(pg_temp.fx('h'))->'calculation'->>'horizonMonths')::int, 2, 'L9 o payload declara o horizonte de 2 meses');
select is((pg_temp.home(pg_temp.fx('h'))->'calculation'->>'overdueBeforeMonthIncluded')::boolean, true, 'L10 o payload declara que atrasadas de meses anteriores entram');

-- ---- terceira família: empréstimo/financiamento (ramo debt_payment_schedule) e fatura de cartão já cobrada que vence no mês seguinte ----
select pg_temp.login('00000000-0000-0000-0000-000000120003');
insert into fixture select 'h3', public.create_household('Casa dos empréstimos');
insert into public.accounts (household_id, name, type, initial_balance, opening_date, currency_code)
values (pg_temp.fx('h3'), 'Corrente', 'checking', 1000, '2020-01-01', 'BRL');
insert into fixture select 'cexp3', id from public.categories where household_id = pg_temp.fx('h3') and type = 'expense' and system_key = 'uncategorized' limit 1;
-- financiamento por boleto: 3 parcelas de 100 a partir de 2 meses atrás (dia 10): duas vencidas antes do mês, uma neste mês
insert into fixture select 'fin', public.create_debt('Financiamento', 'financing', pg_temp.hoje() - 120, 10000);
select public.debt_contract_set(pg_temp.fx('fin'), 'Banco', 'C1', 3, 3, 100, 10, 'boleto', null, (pg_temp.mes() - interval '2 months')::date + 9);
select is((select (i->>'amount')::numeric from jsonb_array_elements(pg_temp.home(pg_temp.fx('h3'))->'upcoming_commitments') i where i->>'id' = 'overdue:before-month'),
  200::numeric, 'L12 parcela de financiamento vencida antes do mês (2 x 100) entra como atraso');
select is((pg_temp.home(pg_temp.fx('h3'))->>'plannedOutflows')::numeric, 300::numeric, 'L13 atraso 200 + a parcela deste mês 100 (a deste mês já está na matriz: conta uma vez)');
-- consignado (descontado em folha) fica fora do atraso (dívida arquivada não tem parcela a vencer: o banco recusa arquivar antes de quitar)
insert into fixture select 'folha', public.create_debt('Consignado', 'loan', pg_temp.hoje() - 120, 10000);
select public.debt_contract_set(pg_temp.fx('folha'), 'Banco folha', null, 3, 3, 100, 10, 'payroll', null, (pg_temp.mes() - interval '2 months')::date + 9);
select is((select (i->>'amount')::numeric from jsonb_array_elements(pg_temp.home(pg_temp.fx('h3'))->'upcoming_commitments') i where i->>'id' = 'overdue:before-month'),
  200::numeric, 'L14 consignado vencido não entra no atraso (continua 200)');
-- fatura de cartão JÁ COBRADA (fechada) que vence no mês seguinte: a tesouraria já a descontou; não pode voltar como compromisso.
-- cartão fecha em (dia de hoje − 2) e vence no dia 1: o vencimento é no mês seguinte. Precisa de hoje ≥ dia 4 (senão não há dia de fechamento válido).
insert into fixture select 'cartao', public.create_debt('Cartão fechado', 'card', pg_temp.hoje() - 365, 0);
select case when extract(day from pg_temp.hoje()) >= 4 then public.set_card_cycle(pg_temp.fx('cartao'), extract(day from pg_temp.hoje())::int - 2, 1) end;
select case when extract(day from pg_temp.hoje()) >= 4 then public.card_purchase(pg_temp.fx('cartao'), pg_temp.mes(), 300, 1, pg_temp.fx('cexp3'), 'Compra da fatura fechada') end;
-- cobra as parcelas com fechamento até hoje (como a rotina diária): a fatura passa a estar cobrada e não paga
select case when extract(day from pg_temp.hoje()) >= 4 then public.card_bill_due(pg_temp.hoje()) end;
select case when extract(day from pg_temp.hoje()) >= 4 then
  is((select count(*)::int from jsonb_array_elements(pg_temp.home(pg_temp.fx('h3'))->'upcoming_commitments') i where i->>'id' like 'card-unreconciled:%'), 0,
     'L15 fatura já cobrada que vence no mês seguinte não volta como compromisso (sem dupla contagem com a tesouraria)')
  else skip('L15 dia 1 a 3: não há fechamento válido para este cenário', 1) end;
select case when extract(day from pg_temp.hoje()) >= 4 then
  is((pg_temp.home(pg_temp.fx('h3'))->>'plannedOutflows')::numeric, 300::numeric, 'L16 só o financiamento (200 + 100) compõe os compromissos; a fatura de 300 já está no disponível')
  else skip('L16 dia 1 a 3', 1) end;
select pg_temp.login('00000000-0000-0000-0000-000000120001');

-- isolamento: quem não é da família não recebe nada
select pg_temp.login('00000000-0000-0000-0000-000000120002');
select is(pg_temp.home(pg_temp.fx('h')), null::jsonb, 'L11 outro usuário não recebe a Home da nossa família');

select * from finish();
rollback;
