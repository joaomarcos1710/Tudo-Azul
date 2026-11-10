-- 76_available_liquid: migration 076. O "Disponível" do Início (home_indicators) conta só o dinheiro que dá para usar
-- no mesmo dia: contas ATIVAS em reais dos tipos checking, savings, cash e brokerage, menos as faturas de cartão
-- FECHADAS a pagar. fixed_income, variable_income e crypto ficam fora do Disponível e continuam no Patrimônio total
-- (= net_worth_with_assets, que não muda). Conta arquivada de qualquer tipo e conta em dólar ficam fora do Disponível.
-- Dados inventados; datas relativas a hoje em São Paulo. Sem a migration, L1, L3 e L4 falham (dava 6.850 / 7.050).
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
create function pg_temp.hoje() returns date language sql as $f$ select (now() at time zone 'America/Sao_Paulo')::date $f$;
create function pg_temp.conta(p_h uuid, p_nome text, p_tipo text, p_saldo numeric, p_abre date, p_moeda text default 'BRL')
returns uuid language plpgsql as $f$
declare v uuid;
begin
  insert into public.accounts (household_id, name, type, initial_balance, opening_date, currency_code)
  values (p_h, p_nome, p_tipo, p_saldo, p_abre, p_moeda) returning id into v;
  return v;
end $f$;
grant execute on all functions in schema pg_temp to public;

-- ---- forma e permissões (as mesmas da 075) ----
select ok(not has_function_privilege('anon', 'public.home_indicators(uuid, date)', 'EXECUTE'), 'P1 anon não executa');
select ok(has_function_privilege('authenticated', 'public.home_indicators(uuid, date)', 'EXECUTE'), 'P2 authenticated executa');
select ok(not (select prosecdef from pg_proc where oid = 'public.home_indicators(uuid, date)'::regprocedure), 'P3 SECURITY INVOKER');
select is((select proconfig from pg_proc where oid = 'public.home_indicators(uuid, date)'::regprocedure),
          array['search_path=""', 'jit=off'], 'P4 search_path vazio e sem JIT');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000076a1', 'l1@teste.com'),
  ('00000000-0000-0000-0000-0000000076a2', 'l2@teste.com');
select pg_temp.login('00000000-0000-0000-0000-0000000076a1');
insert into fixture select 'h', public.create_household('Casa Disponível');

-- líquidas (entram no Disponível): 1.000 + 500 + 100 + 50 = 1.650
select pg_temp.conta(pg_temp.fx('h'), 'Conta corrente de teste', 'checking', 1000, pg_temp.hoje() - 30);
select pg_temp.conta(pg_temp.fx('h'), 'Reserva de teste', 'savings', 500, pg_temp.hoje() - 30);
select pg_temp.conta(pg_temp.fx('h'), 'Carteira de teste', 'cash', 100, pg_temp.hoje() - 30);
select pg_temp.conta(pg_temp.fx('h'), 'Corretora de teste', 'brokerage', 50, pg_temp.hoje() - 30);
-- precisam ser resgatadas/vendidas (fora do Disponível, no Patrimônio): 2.000 + 3.000 + 400 = 5.400
select pg_temp.conta(pg_temp.fx('h'), 'Renda fixa de teste', 'fixed_income', 2000, pg_temp.hoje() - 30);
select pg_temp.conta(pg_temp.fx('h'), 'Renda variável de teste', 'variable_income', 3000, pg_temp.hoje() - 30);
select pg_temp.conta(pg_temp.fx('h'), 'Cripto de teste', 'crypto', 400, pg_temp.hoje() - 30);
-- uma arquivada de cada um dos 7 tipos, R$ 10 cada (fora do Disponível; o Patrimônio soma todas as contas em reais)
insert into fixture
select 'arq_' || tipo, pg_temp.conta(pg_temp.fx('h'), 'Arquivada ' || tipo, tipo, 10, pg_temp.hoje() - 30)
  from unnest(array['checking', 'savings', 'cash', 'brokerage', 'fixed_income', 'variable_income', 'crypto']) tipo;
update public.accounts set active = false where id in (select v from fixture where k like 'arq\_%');
-- em dólar, de tipos líquidos: fora de tudo que é em reais
select pg_temp.conta(pg_temp.fx('h'), 'Conta em dólar', 'checking', 999, pg_temp.hoje() - 30, 'USD');
select pg_temp.conta(pg_temp.fx('h'), 'Reserva em dólar', 'savings', 888, pg_temp.hoje() - 30, 'USD');
-- cartão com R$ 200 de fatura fechada a pagar (saldo de referência)
select public.create_debt('Cartão de teste', 'card', pg_temp.hoje() - 10, 200);

select is((select count(*) from public.accounts where household_id = pg_temp.fx('h') and not active), 7::bigint,
          'F1 sete contas arquivadas, uma de cada tipo');

create temp view hi with (security_invoker = true) as select * from public.home_indicators(pg_temp.fx('h'), pg_temp.hoje());
grant select on hi to public;
create temp view nw with (security_invoker = true) as select * from public.net_worth_with_assets(pg_temp.fx('h'), pg_temp.hoje());
grant select on nw to public;

-- ---- Disponível ----
select is((select available from hi), 1450.00, 'L1 Disponível = 1.000 + 500 + 100 + 50 − 200 (renda fixa, variável e cripto fora)');
select is((select card_bills_closed from hi), 200.00, 'L2 fatura fechada a pagar');
select is((select accounts_active from hi), 1650.00, 'L3 contas líquidas ativas em reais: os 4 tipos (arquivadas e dólar fora)');
select is((select accounts_active from hi),
          (select sum(total_active) from public.balance_totals_by_type(pg_temp.fx('h'), pg_temp.hoje())
            where account_type in ('checking', 'savings', 'cash', 'brokerage')),
          'L4 o mesmo total ativo dos 4 tipos de balance_totals_by_type');
select is((select available from hi), (select accounts_active - card_bills_closed from hi), 'L5 disponível = contas líquidas − fatura fechada');

-- ---- Patrimônio não muda ----
select is((select net_worth from hi), (select net_worth from nw), 'W1 patrimônio do Início = net_worth_with_assets (Análises)');
select is((select accounts_total from hi), 7120.00, 'W2 todas as contas em reais: 1.650 + 5.400 + 70 das arquivadas (dólar fora)');
select is((select net_worth from hi), 6920.00, 'W3 patrimônio = 7.120 − 200 da fatura: renda fixa, variável e cripto continuam nele');

-- ---- isolamento ----
select pg_temp.login('00000000-0000-0000-0000-0000000076a2');
select is((select count(*) from public.home_indicators(pg_temp.fx('h'), pg_temp.hoje())), 0::bigint, 'I1 quem não é da família não vê nada');

select * from finish();
rollback;
