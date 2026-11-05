-- 57_home_alerts: migration 057. Avisos do topo do Início: a receber e a pagar nos próximos 7 dias, fatura de cartão
-- que vence em até 7 dias e vencidos. Só contas BRL; família vizinha isolada. "Hoje" é passado como parâmetro
-- (20/04/2026), então o teste não depende da data do servidor. Sem dado real.
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
-- a função nova vai por SQL dinâmico: sem a migration ela não existe e o teste falha nas asserções, sem abortar o arquivo
create function pg_temp.avisos(p_h uuid, p_hoje date) returns text language plpgsql as $f$
declare r text;
begin
  execute 'select coalesce(string_agg(x.kind || ''|'' || x.item_count || ''|'' || x.total || ''|'' || x.first_date
                                      || ''|'' || coalesce(x.target_name, ''''), '';'' order by x.n), '''')
             from public.home_alerts($1, $2) with ordinality as x(kind, item_count, total, first_date, target_id, target_name, n)'
    into r using p_h, p_hoje;
  return r;
exception when others then return 'erro: ' || sqlerrm;
end $f$;
create function pg_temp.aviso(p_h uuid, p_kind text) returns text language plpgsql as $f$
declare r text;
begin
  execute 'select x.item_count || ''|'' || x.total || ''|'' || x.first_date from public.home_alerts($1, date ''2026-04-20'') x
            where x.kind = $2'
    into r using p_h, p_kind;
  return coalesce(r, 'nenhum');
exception when others then return 'erro: ' || sqlerrm;
end $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.avisos(uuid, date), pg_temp.aviso(uuid, text) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000057a1', 'avisos-a@teste.com'),
  ('00000000-0000-0000-0000-0000000057a2', 'avisos-b@teste.com');

-- família vizinha: tem um planejado na janela que nunca pode aparecer na família de teste
select pg_temp.login('00000000-0000-0000-0000-0000000057a2');
insert into fixture select 'h2', public.create_household('Casa vizinha');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h2'), 'Corrente vizinha', 'checking', 0, '2026-01-01') returning id)
  insert into fixture select 'c2', id from i;
insert into public.transactions (household_id, account_id, category_id, type, amount, date, status, description)
select pg_temp.fx('h2'), pg_temp.fx('c2'), id, 'expense', 777, '2026-04-22', 'planned', 'Da vizinha'
  from public.categories where household_id = pg_temp.fx('h2') and type = 'expense' and system_key = 'uncategorized';

select pg_temp.login('00000000-0000-0000-0000-0000000057a1');
insert into fixture select 'h', public.create_household('Casa Avisos');
insert into public.accounts (household_id, name, type, initial_balance, opening_date, currency_code) values
  (pg_temp.fx('h'), 'Corrente', 'checking', 1000, '2026-01-01', 'BRL'),
  (pg_temp.fx('h'), 'Poupança', 'checking', 0, '2026-01-01', 'BRL'),
  (pg_temp.fx('h'), 'Conta em dólar', 'checking', 0, '2026-01-01', 'USD');
insert into fixture select 'brl', id from public.accounts where household_id = pg_temp.fx('h') and name = 'Corrente';
insert into fixture select 'brl2', id from public.accounts where household_id = pg_temp.fx('h') and name = 'Poupança';
insert into fixture select 'usd', id from public.accounts where household_id = pg_temp.fx('h') and name = 'Conta em dólar';
insert into fixture select 'cexp', id from public.categories where household_id = pg_temp.fx('h') and type = 'expense' and system_key = 'uncategorized';
insert into fixture select 'cinc', id from public.categories where household_id = pg_temp.fx('h') and type = 'income' and system_key = 'uncategorized';

-- 1. sem nada planejado: nenhum aviso ----------------------------------------------
select is(pg_temp.avisos(pg_temp.fx('h'), '2026-04-20'), '', 'A1 sem planejados nem faturas: nenhum aviso (a faixa some)');

-- planejados (hoje = 20/04/2026)
insert into public.transactions (household_id, account_id, category_id, type, amount, date, status, description) values
  (pg_temp.fx('h'), pg_temp.fx('brl'), pg_temp.fx('cinc'), 'income',  200.00, '2026-04-23', 'planned', 'Receita em 3 dias'),
  (pg_temp.fx('h'), pg_temp.fx('brl'), pg_temp.fx('cinc'), 'income',  999.00, '2026-04-30', 'planned', 'Receita em 10 dias'),
  (pg_temp.fx('h'), pg_temp.fx('brl'), pg_temp.fx('cexp'), 'expense',  50.00, '2026-04-22', 'planned', 'Despesa em 2 dias'),
  (pg_temp.fx('h'), pg_temp.fx('brl'), pg_temp.fx('cexp'), 'expense',  12.50, '2026-04-27', 'planned', 'Despesa em 7 dias'),
  (pg_temp.fx('h'), pg_temp.fx('brl'), pg_temp.fx('cexp'), 'expense',  70.00, '2026-04-21', 'paid',    'Despesa já paga'),
  (pg_temp.fx('h'), pg_temp.fx('brl'), pg_temp.fx('cexp'), 'expense', 888.00, '2026-04-22', 'planned', 'Na lixeira'),
  (pg_temp.fx('h'), pg_temp.fx('usd'), pg_temp.fx('cexp'), 'expense',  40.00, '2026-04-22', 'planned', 'Despesa em dólar'),
  (pg_temp.fx('h'), pg_temp.fx('usd'), pg_temp.fx('cinc'), 'income',   41.00, '2026-04-22', 'planned', 'Receita em dólar'),
  (pg_temp.fx('h'), pg_temp.fx('brl'), pg_temp.fx('cexp'), 'expense',  30.00, '2026-04-10', 'planned', 'Despesa vencida'),
  (pg_temp.fx('h'), pg_temp.fx('brl'), pg_temp.fx('cinc'), 'income',   15.00, '2026-04-15', 'planned', 'Receita atrasada'),
  (pg_temp.fx('h'), pg_temp.fx('usd'), pg_temp.fx('cexp'), 'expense',  60.00, '2026-04-12', 'planned', 'Vencida em dólar');
update public.transactions set deleted_at = now() where household_id = pg_temp.fx('h') and description = 'Na lixeira';
-- transferência planejada: nem a pagar nem a receber
insert into public.transactions (household_id, account_id, destination_account_id, type, amount, date, status)
values (pg_temp.fx('h'), pg_temp.fx('brl'), pg_temp.fx('brl2'), 'transfer', 500, '2026-04-22', 'planned');
-- parcela de dívida (boleto): 3 × 1.000, a primeira em 25/04 (dentro), as outras em maio e junho (fora)
insert into fixture select 'div', public.create_debt('Financiamento', 'financing', '2026-01-01', 3000);
select public.debt_contract_set(pg_temp.fx('div'), 'Banco', null, 3, 3, 1000.00, 1, 'boleto', null, '2026-04-25');
-- cartão: fecha dia 17, vence dia 25. Abril (vence 25/04, dentro); março (venceu 25/03) e maio (vence 25/05) fora.
insert into fixture select 'cartao', public.create_debt('Cartão Azul', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('cartao'), 17, 25);
select public.card_purchase(pg_temp.fx('cartao'), '2026-03-10', 250.00, 1, pg_temp.fx('cexp'), 'Março');
select public.card_purchase(pg_temp.fx('cartao'), '2026-04-05',  80.00, 1, pg_temp.fx('cexp'), 'Abril');
select public.card_purchase(pg_temp.fx('cartao'), '2026-04-19',  33.00, 1, pg_temp.fx('cexp'), 'Maio');

-- 2. cada aviso ----------------------------------------------------------------------
select is(pg_temp.aviso(pg_temp.fx('h'), 'receivable'), '1|200.00|2026-04-23',
  'A2 a receber: só a receita em 3 dias (a de 10 dias e a da conta em dólar ficam fora)');
select is(pg_temp.aviso(pg_temp.fx('h'), 'payable'), '3|1062.50|2026-04-22',
  'A3 a pagar: 50 + 12,50 (no 7º dia) + parcela de 1.000; paga, lixeira, dólar e transferência ficam fora');
select is(pg_temp.aviso(pg_temp.fx('h'), 'invoice'), '1|80.00|2026-04-25',
  'A4 fatura: a de abril (vence em 5 dias), pelo que falta pagar; março e maio fora');
select is((select target_name || '|' || (target_id = pg_temp.fx('cartao'))::text from public.home_alerts(pg_temp.fx('h'), '2026-04-20') where kind = 'invoice'),
  'Cartão Azul|true', 'A4.1 a fatura diz o cartão (nome e id, para abrir a tela dele)');
select is(pg_temp.aviso(pg_temp.fx('h'), 'overdue_payable'), '1|30.00|2026-04-10',
  'A5 vencidos a pagar: a despesa de 10/04 (a vencida em dólar fica fora)');
select is(pg_temp.aviso(pg_temp.fx('h'), 'overdue_receivable'), '1|15.00|2026-04-15', 'A6 vencidos a receber: a receita de 15/04');
select is(pg_temp.avisos(pg_temp.fx('h'), '2026-04-20'),
  'overdue_payable|1|30.00|2026-04-10|;overdue_receivable|1|15.00|2026-04-15|;invoice|1|80.00|2026-04-25|Cartão Azul;payable|3|1062.50|2026-04-22|;receivable|1|200.00|2026-04-23|',
  'A7 ordem: vencidos, faturas, a pagar, a receber');

-- 3. pagar tira do aviso -------------------------------------------------------------
update public.transactions set status = 'paid' where household_id = pg_temp.fx('h') and description = 'Receita em 3 dias';
select is(pg_temp.aviso(pg_temp.fx('h'), 'receivable'), 'nenhum', 'A8 receita marcada como recebida: o aviso de a receber some');

-- 4. outra data: a de 10 dias entra quando faltar 7 ---------------------------------------
select is(pg_temp.aviso(pg_temp.fx('h'), 'receivable'), 'nenhum', 'A9 em 20/04 a receita de 30/04 ainda não aparece');
select is((select item_count || '|' || total from public.home_alerts(pg_temp.fx('h'), '2026-04-23') where kind = 'receivable'), '1|999.00',
  'A9.1 em 23/04 (7 dias antes) a receita de 30/04 aparece');

-- 5. família vizinha isolada ---------------------------------------------------------
select ok(pg_temp.avisos(pg_temp.fx('h'), '2026-04-20') not like '%777%', 'A10 o planejado da família vizinha não entra');
select pg_temp.login('00000000-0000-0000-0000-0000000057a2');
select is(pg_temp.avisos(pg_temp.fx('h'), '2026-04-20'), '', 'A11 quem é de outra família não vê os avisos desta');
select is(pg_temp.aviso(pg_temp.fx('h2'), 'payable'), '1|777.00|2026-04-22', 'A11.1 e vê só os da própria família');

-- 6. segurança ------------------------------------------------------------------------
reset role;
select ok(not has_function_privilege('anon', 'public.home_alerts(uuid, date)', 'EXECUTE'), 'A12 anon não executa');
select ok(has_function_privilege('authenticated', 'public.home_alerts(uuid, date)', 'EXECUTE'), 'A12.1 authenticated executa');
select ok(not (select prosecdef from pg_proc where oid = 'public.home_alerts(uuid, date)'::regprocedure), 'A12.2 SECURITY INVOKER');

select * from finish();
rollback;
