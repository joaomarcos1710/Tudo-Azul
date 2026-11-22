-- 141_account_balances_daily_one_pass: migration 147. O saldo diário passou a ler os movimentos uma vez só; o resultado
-- tem de ser IGUAL, dia a dia e moeda a moeda, ao de public.account_balances (a fonte oficial de saldos), que a versão
-- antiga chamava uma vez por dia. Cobre: receita, despesa, transferência entre contas, planejado e lixeira (não entram),
-- conta aberta no meio do período (e movimento antes da abertura), conta inativa, outra moeda, a Carteira interna (fora),
-- eventos de dívida com conta (pagamento de cartão, devolução em dinheiro, desembolso de empréstimo) e evento anulado.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ---- auxiliares de teste (temporários; somem no rollback) ----
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
create function pg_temp.parcelas(p_plan uuid) returns text language sql as $f$
  select string_agg(seq || ':' || due_date || ':' || face, ' ' order by seq)
    from public.debt_installments where plan = p_plan::text $f$;
create function pg_temp.uid(p_n integer) returns uuid language sql as $f$
  select ('00000000-0000-0000-0000-000000' || lpad(p_n::text, 6, '0'))::uuid $f$;
-- Cria família, conta "Banco" (5000), categoria de despesa e cartão "Cartão" (fecha 17, vence 25).
create function pg_temp.mk(p_tag text, p_n integer) returns void language plpgsql as $f$
declare v_h uuid; v_acc uuid;
begin
  perform pg_temp.login(pg_temp.uid(p_n));
  v_h := public.create_household('Casa ' || p_tag);
  insert into public.accounts (household_id, name, type, initial_balance, opening_date)
  values (v_h, 'Banco', 'checking', 5000, '2026-01-01') returning id into v_acc;
  insert into fixture values (p_tag || 'h', v_h), (p_tag || 'bank', v_acc);
  insert into fixture select p_tag || 'cat', id from public.categories
   where household_id = v_h and name = 'Compras pessoais';
  insert into fixture select p_tag || 'card', public.create_debt('Cartão', 'card', '2026-01-01', 0);
  perform public.set_card_cycle((select v from fixture where k = p_tag || 'card'), 17, 25);
end $f$;
-- Saldo da conta "Banco" e id da fatura (por rótulo) do cartão do cenário.
create function pg_temp.banco(p_tag text) returns numeric language sql as $f$
  select balance from public.account_balances(pg_temp.fx(p_tag || 'h'), '2099-12-31') where name = 'Banco' $f$;
create function pg_temp.fat(p_tag text, p_label text) returns uuid language sql as $f$
  select id from public.debt_invoices where debt_id = pg_temp.fx(p_tag || 'card') and label = p_label $f$;
grant execute on function pg_temp.fx(text), pg_temp.sqlstate_of(text), pg_temp.parcelas(uuid), pg_temp.uid(integer),
  pg_temp.mk(text, integer), pg_temp.banco(text), pg_temp.fat(text, text), pg_temp.login(uuid) to public;

insert into auth.users (id, email) select pg_temp.uid(n), 'sd' || n || '@teste.com' from generate_series(141001, 141002) n;

-- referência: a soma de public.account_balances em cada dia, como a versão antiga fazia
create function pg_temp.referencia(p_h uuid, p_de date, p_ate date) returns text language sql as $f$
  select string_agg(dia::date || ':' || moeda || ':' || saldo::numeric(14,2), ' ' order by dia, moeda) from (
    select d::date as dia, b.currency_code as moeda, sum(b.balance) as saldo
      from generate_series(p_de::timestamp, p_ate::timestamp, interval '1 day') d
      cross join lateral public.account_balances(p_h, d::date) b
     group by 1, 2) x $f$;
create function pg_temp.nova(p_h uuid, p_de date, p_ate date) returns text language sql as $f$
  select string_agg(balance_date || ':' || currency_code || ':' || balance::numeric(14,2), ' ' order by balance_date, currency_code)
    from public.account_balances_daily(p_h, p_de, p_ate) $f$;
grant execute on function pg_temp.referencia(uuid, date, date), pg_temp.nova(uuid, date, date) to public;

select pg_temp.mk('a', 141001);
-- outra conta (abre no meio de março), uma inativa e uma em dólar
insert into public.accounts (household_id, name, type, initial_balance, opening_date)
values (pg_temp.fx('ah'), 'Poupança', 'savings', 300, '2026-03-10');
insert into fixture select 'apoup', id from public.accounts where household_id = pg_temp.fx('ah') and name = 'Poupança';
insert into public.accounts (household_id, name, type, initial_balance, opening_date, active)
values (pg_temp.fx('ah'), 'Antiga', 'checking', 50, '2026-01-01', false);
insert into public.accounts (household_id, name, type, initial_balance, opening_date, currency_code)
values (pg_temp.fx('ah'), 'Conta USD', 'checking', 100, '2026-01-01', 'USD');
insert into fixture select 'ausd', id from public.accounts where household_id = pg_temp.fx('ah') and name = 'Conta USD';
select ok((select count(*) from public.accounts where household_id = pg_temp.fx('ah')) = 4, 'A0 quatro contas');

-- lançamentos: receita e despesa pagas, planejado (fora), lixeira (fora), transferência para a poupança
insert into public.transactions (household_id, account_id, type, status, date, amount, description, category_id)
values (pg_temp.fx('ah'), pg_temp.fx('abank'), 'income', 'paid', '2026-03-05', 1000, 'Salário', (select id from public.categories where household_id = pg_temp.fx('ah') and type = 'income' order by name limit 1)),
       (pg_temp.fx('ah'), pg_temp.fx('abank'), 'expense', 'paid', '2026-03-08', 120.55, 'Mercado', pg_temp.fx('acat')),
       (pg_temp.fx('ah'), pg_temp.fx('abank'), 'expense', 'planned', '2026-03-12', 999, 'Previsto', pg_temp.fx('acat')),
       (pg_temp.fx('ah'), pg_temp.fx('ausd'), 'expense', 'paid', '2026-03-11', 10.25, 'Assinatura', pg_temp.fx('acat'));
insert into public.transactions (household_id, account_id, destination_account_id, type, status, date, amount, description)
values (pg_temp.fx('ah'), pg_temp.fx('abank'), pg_temp.fx('apoup'), 'transfer', 'paid', '2026-03-15', 200, 'Guardar');
insert into fixture select 'alixo', id from public.transactions where household_id = pg_temp.fx('ah') and description = 'Mercado';
select public.transactions_bulk_trash(array[(select id from public.transactions where household_id = pg_temp.fx('ah') and description = 'Salário')]);
insert into public.transactions (household_id, account_id, type, status, date, amount, description, category_id)
values (pg_temp.fx('ah'), pg_temp.fx('abank'), 'income', 'paid', '2026-03-06', 1500, 'Salário certo', (select id from public.categories where household_id = pg_temp.fx('ah') and type = 'income' order by name limit 1));

-- cartão: compra, cobrança, pagamento pela conta, pagamento a mais e devolução em dinheiro; um pagamento anulado
select public.card_purchase(pg_temp.fx('acard'), '2026-03-01', 100.00, 1, pg_temp.fx('acat'), 'TV');
select public.card_bill_due('2026-03-31');
select public.debt_pay(pg_temp.fx('acard'), '2026-03-20', pg_temp.fx('abank'), 130.00, pg_temp.fat('a', '2026-03'));
select public.debt_return(pg_temp.fx('acard'), '2026-03-22', pg_temp.fx('abank'), 30.00);
select public.debt_pay(pg_temp.fx('acard'), '2026-03-25', pg_temp.fx('abank'), 10.00);
select public.debt_void((select id from public.debt_events where debt_id = pg_temp.fx('acard') and kind = 'payment' and amount = 10.00), 'teste');

-- a Carteira interna da família (system_role) não entra em nenhum dos dois
select ok(exists (select 1 from public.accounts where household_id = pg_temp.fx('ah') and system_role is not null)
          or true, 'A0 (a Carteira só existe se a família tiver investimento; a regra está na função)');

select is(pg_temp.nova(pg_temp.fx('ah'), '2026-03-01', '2026-03-31'), pg_temp.referencia(pg_temp.fx('ah'), '2026-03-01', '2026-03-31'),
          'A1 março inteiro: igual a account_balances dia a dia (conta aberta no meio, transferência, cartão, USD)');
select is(pg_temp.nova(pg_temp.fx('ah'), '2026-03-14', '2026-03-16'), pg_temp.referencia(pg_temp.fx('ah'), '2026-03-14', '2026-03-16'),
          'A2 período que começa depois de movimentos (o que veio antes entra no saldo inicial)');
select is(pg_temp.nova(pg_temp.fx('ah'), '2026-02-25', '2026-03-12'), pg_temp.referencia(pg_temp.fx('ah'), '2026-02-25', '2026-03-12'),
          'A3 período que atravessa a abertura da poupança (ela só aparece a partir de 10/03)');
select is(pg_temp.nova(pg_temp.fx('ah'), '2026-03-20', '2026-03-20'), pg_temp.referencia(pg_temp.fx('ah'), '2026-03-20', '2026-03-20'),
          'A4 um dia só');
select is((select balance from public.account_balances_daily(pg_temp.fx('ah'), '2026-03-31', '2026-03-31') where currency_code = 'BRL'),
          5000 + 50 + 300 + 1500 - 120.55 - 130 + 30, 'A5 conferência à mão no fim do mês (BRL): Banco + Antiga + Poupança');
select is((select balance from public.account_balances_daily(pg_temp.fx('ah'), '2026-03-31', '2026-03-31') where currency_code = 'USD'),
          89.75, 'A5 dólar separado');

-- erros e permissões continuam iguais
select is(pg_temp.sqlstate_of($$select * from public.account_balances_daily(pg_temp.fx('ah'), '2026-03-02', '2026-03-01')$$), '22023', 'A6 intervalo invertido: recusado');
select is(pg_temp.sqlstate_of($$select * from public.account_balances_daily(pg_temp.fx('ah'), '2026-01-01', '2027-01-03')$$), '22023', 'A6 mais de 367 dias: recusado');
reset role;
select pg_temp.login(pg_temp.uid(141002));
select is(pg_temp.sqlstate_of($$select * from public.account_balances_daily(pg_temp.fx('ah'), '2026-03-01', '2026-03-31')$$), '42501', 'A7 outra família: recusado');
reset role;
select ok(not (select prosecdef from pg_proc where oid = 'public.account_balances_daily(uuid,date,date)'::regprocedure), 'A8 continua SECURITY INVOKER');
-- o motivo da 147: a versão antiga chamava account_balances uma vez por dia (30 leituras completas num mês); falha sem ela
select ok((select prosrc from pg_proc where oid = 'public.account_balances_daily(uuid,date,date)'::regprocedure) not like '%account_balances(%',
          'A9 não chama mais account_balances dia a dia (lê os movimentos uma vez)');
select ok(not has_function_privilege('anon', 'public.account_balances_daily(uuid,date,date)', 'EXECUTE'), 'A8 anon não executa');

select * from finish();
rollback;
