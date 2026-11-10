-- 75_net_worth_single: migration 075. Um patrimônio só no app: o "Patrimônio total" do Início (home_indicators) é o
-- mesmo de net_worth_with_assets (Análises) e NÃO soma a carteira de Investimentos (investment_totals), que pode ser o
-- mesmo dinheiro de uma conta de renda fixa/variável/cripto (070). O campo `investments` continua sendo devolvido, à
-- parte. A tabela public."Teste1" (criada à mão no painel) não existe depois. Permissões e forma da função não mudam.
-- Dados inventados; datas relativas a hoje em São Paulo. Sem a migration, N1–N3 falham (o Início dava 2X).
--
-- REGRA MUDOU na migration 099 (20261110080000_investment_liquidity.sql, decisão do dono de 10/11/2026, "opção C"): o
-- Patrimônio total volta a SOMAR a carteira em reais, no Início E em Análises (a 075 foi revogada nesse ponto). O que
-- continua valendo daqui: um número só no app (Início = net_worth_with_assets), `investments` devolvido, a tabela
-- "Teste1" fora, forma e permissões. N2, N3 e N7 tiveram a expectativa trocada (antes: 1.000, sem investimentos, 16.000).
-- N2 fica como registro do efeito colateral conhecido: a MESMA aplicação cadastrada como conta de renda fixa e como
-- ativo da carteira conta duas vezes; o banco não sabe que são o mesmo dinheiro.
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
create function pg_temp.conta(p_h uuid, p_nome text, p_tipo text, p_saldo numeric, p_abre date)
returns uuid language plpgsql as $f$
declare v uuid;
begin
  insert into public.accounts (household_id, name, type, initial_balance, opening_date, currency_code)
  values (p_h, p_nome, p_tipo, p_saldo, p_abre, 'BRL') returning id into v;
  return v;
end $f$;
grant execute on all functions in schema pg_temp to public;

-- ---- a tabela criada à mão no painel ----
select is(to_regclass('public."Teste1"'), null::regclass, 'T1 public."Teste1" não existe');

-- ---- forma e permissões (as mesmas da 074) ----
select ok(not has_function_privilege('anon', 'public.home_indicators(uuid, date)', 'EXECUTE'), 'P1 anon não executa');
select ok(has_function_privilege('authenticated', 'public.home_indicators(uuid, date)', 'EXECUTE'), 'P2 authenticated executa');
select ok(not (select prosecdef from pg_proc where oid = 'public.home_indicators(uuid, date)'::regprocedure), 'P3 SECURITY INVOKER');
select is((select proconfig from pg_proc where oid = 'public.home_indicators(uuid, date)'::regprocedure),
          array['search_path=""', 'jit=off'], 'P4 search_path vazio e sem JIT');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000075a1', 'p1@teste.com'),
  ('00000000-0000-0000-0000-0000000075a2', 'p2@teste.com');
select pg_temp.login('00000000-0000-0000-0000-0000000075a1');
insert into fixture select 'h', public.create_household('Casa Patrimônio');

-- R$ 1.000 numa conta de renda fixa (070) e a MESMA aplicação cadastrada na carteira: 10 cotas × R$ 100
select pg_temp.conta(pg_temp.fx('h'), 'CDB de teste', 'fixed_income', 1000, pg_temp.hoje() - 30);
insert into fixture select 'inv', public.investment_asset_create(pg_temp.fx('h'), 'CDB de teste', null, 'fund', 'BRL');
select public.investment_operation_record(pg_temp.fx('inv'), pg_temp.hoje() - 5, 'buy', 10, 100, 0, 'compra de teste');

create temp view hi with (security_invoker = true) as select * from public.home_indicators(pg_temp.fx('h'), pg_temp.hoje());
grant select on hi to public;
create temp view nw with (security_invoker = true) as select * from public.net_worth_with_assets(pg_temp.fx('h'), pg_temp.hoje());
grant select on nw to public;

select is((select net_worth from hi), (select net_worth from nw), 'N1 patrimônio do Início = net_worth_with_assets (Análises)');
select is((select net_worth from hi), 2000.00, 'N2 (099) conta de renda fixa 1.000 + carteira 1.000 = 2.000: cadastrado nos dois lugares, soma duas vezes');
select is((select net_worth from hi), (select accounts_total + credit_receivable + family_assets + investments - debt_total from hi),
          'N3 (099) patrimônio = contas + crédito a receber + bens + carteira em reais − dívidas');
select is((select investments from hi), 1000.00, 'N4 a carteira continua sendo devolvida no campo próprio');
select is((select accounts_total from hi), 1000.00, 'N5 a conta de renda fixa está em "todas as contas"');

-- com bem e dívida, continua igual a Análises
select public.family_asset_create(pg_temp.fx('h'), 'Carro de teste', 'vehicle', null, 'BRL', 'Família', 100, pg_temp.hoje() - 10, 20000, pg_temp.hoje() - 9, 'Avaliação de teste');
select public.create_debt('Empréstimo de teste', 'loan', pg_temp.hoje() - 10, 5000);
select is((select net_worth from hi), (select net_worth from nw), 'N6 com bem e dívida, ainda = net_worth_with_assets');
select is((select net_worth from hi), 17000.00, 'N7 (099) 1.000 + 20.000 + 1.000 da carteira − 5.000');

-- ---- isolamento ----
select pg_temp.login('00000000-0000-0000-0000-0000000075a2');
select is((select count(*) from public.home_indicators(pg_temp.fx('h'), pg_temp.hoje())), 0::bigint, 'I1 quem não é da família não vê nada');

select * from finish();
rollback;
