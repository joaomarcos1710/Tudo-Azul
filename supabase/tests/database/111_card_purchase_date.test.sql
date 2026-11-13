-- 111_card_purchase_date: corrigir a data da compra de uma compra de cartão já lançada (public.card_purchase_set_date,
-- migration 20261113100000). Muda só purchase_date de TODAS as parcelas da compra; a fatura de cada parcela não muda
-- (due_date, closing_day, due_day iguais); card_months, saldo e resumo do período iguais antes e depois; vale também para
-- parcela já cobrada e de fatura paga e travada; assinatura de cartão é recusada; outra família, anônimo e data inválida
-- são recusados. O gatilho de imutabilidade continua barrando qualquer outra mudança (a marca só libera purchase_date).
-- Sem a migration este arquivo falha nas asserções (a função é chamada por SQL dinâmico), sem abortar.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create temp table fixture (k text primary key, v uuid);
grant all on fixture to public;
create temp table nota (k text primary key, v text);
grant all on nota to public;
create function pg_temp.fx(p_k text) returns uuid language sql as $f$ select v from fixture where k = p_k $f$;
create function pg_temp.nt(p_k text) returns text language sql as $f$ select v from nota where k = p_k $f$;
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
create function pg_temp.hoje() returns date language sql stable as $f$ select (now() at time zone 'America/Sao_Paulo')::date $f$;
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
-- muda a data da compra pela RPC (SQL dinâmico: sem a migration devolve o erro, não aborta); devolve o nº de parcelas ou o sqlstate
create function pg_temp.mudar(p_k text, p_plan text, p_data date) returns text language plpgsql as $f$
declare r integer;
begin
  execute 'select public.card_purchase_set_date($1, $2, $3)' into r using pg_temp.fx(p_k), p_plan, p_data;
  return r::text;
exception when others then return 'erro ' || sqlstate;
end $f$;
-- as datas de compra de uma compra, na ordem das parcelas
create function pg_temp.datas(p_k text, p_plan text) returns text language sql as $f$
  select coalesce(string_agg(coalesce(purchase_date::text, 'nula'), ',' order by seq), '-')
    from public.debt_installments where debt_id = pg_temp.fx(p_k) and plan = p_plan $f$;
-- a fatura de cada parcela (o que NÃO pode mudar): due_date, closing_day, due_day
create function pg_temp.faturas(p_k text, p_plan text) returns text language sql as $f$
  select coalesce(string_agg(due_date || '/' || closing_day || '/' || due_day, ',' order by seq), '-')
    from public.debt_installments where debt_id = pg_temp.fx(p_k) and plan = p_plan $f$;
-- tudo o que é dinheiro/fatura: card_months inteiro + saldo da dívida + resumo do período
create function pg_temp.dinheiro(p_card uuid) returns text language sql as $f$
  select coalesce((select string_agg(label || ':' || charged::numeric(14,2) || '/' || pending::numeric(14,2) || '/' || total::numeric(14,2)
                                     || '/' || paid::numeric(14,2) || '/' || items, ',' order by label)
                     from public.card_months(p_card)), '-')
      || '|' || (select coalesce(sum(i.face), 0)::numeric(14,2) from public.debt_installments i where i.debt_id = p_card)
$f$;
create function pg_temp.plano(p_k text, p_desc text) returns text language sql as $f$
  select plan from public.debt_installments where debt_id = pg_temp.fx(p_k) and description = p_desc order by seq limit 1 $f$;
grant execute on all functions in schema pg_temp to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000111001', 'd1@teste.com'),
  ('00000000-0000-0000-0000-000000111002', 'd2@teste.com');

-- Família 1: cartão A fecha 17, vence 25. X (300,00 em 3x, 05/08: ago/set/out) e Y (100,00, 05/09). Fatura de agosto paga e travada.
select pg_temp.login('00000000-0000-0000-0000-000000111001');
insert into fixture select 'h', public.create_household('Casa das datas');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 5000.00, '2026-01-01') returning id)
  insert into fixture select 'bank', id from i;
insert into fixture select 'exp', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';
insert into fixture select 'a', public.create_debt('Cartão A', 'card', '2026-07-01', 0);
select public.set_card_cycle(pg_temp.fx('a'), 17, 25);
insert into fixture select 'x', public.card_purchase(pg_temp.fx('a'), '2026-08-05', 300.00, 3, pg_temp.fx('exp'), 'Compra X');
insert into fixture select 'y', public.card_purchase(pg_temp.fx('a'), '2026-09-05', 100.00, 1, pg_temp.fx('exp'), 'Compra Y');
select public.card_bill_due('2026-10-31');
select public.debt_pay(pg_temp.fx('a'), '2026-08-25', pg_temp.fx('bank'), 100.00,
                       (select id from public.debt_invoices where debt_id = pg_temp.fx('a') and label = '2026-08'));
insert into nota select 'px', pg_temp.plano('a', 'Compra X');
insert into nota select 'py', pg_temp.plano('a', 'Compra Y');
insert into nota select 'dinheiro0', pg_temp.dinheiro(pg_temp.fx('a'));
insert into nota select 'faturasX0', pg_temp.faturas('a', pg_temp.nt('px'));
insert into fixture select 'loan', public.create_debt('Empréstimo', 'loan', '2026-07-01', 0);
-- assinatura de cartão (parcela com recurrence_id)
insert into fixture select 's', public.create_debt('Cartão S', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('s'), 17, 25);
insert into fixture select 'r', public.recurrence_create('card', 'Streaming', 29.90, extract(day from pg_temp.hoje())::int, pg_temp.hoje(), null, null,
                                                         pg_temp.fx('s'), pg_temp.fx('exp'), null, 'month', 1);
select public.recurrence_materialize();
select public.card_scheduled_sync();

-- Família 2
select pg_temp.login('00000000-0000-0000-0000-000000111002');
insert into fixture select 'h2', public.create_household('Outra casa');
select pg_temp.login('00000000-0000-0000-0000-000000111001');

-- ---- forma e permissões ----
select has_function('public', 'card_purchase_set_date', array['uuid', 'text', 'date'], 'D1 existe card_purchase_set_date(uuid, text, date)');
select is((select p.prosecdef from pg_proc p where p.oid = to_regprocedure('public.card_purchase_set_date(uuid, text, date)')), true, 'D2 é SECURITY DEFINER (grava a marca de sessão)');
select is((select p.proconfig::text from pg_proc p where p.oid = to_regprocedure('public.card_purchase_set_date(uuid, text, date)')), '{"search_path=\"\""}', 'D3 search_path vazio');
select is(has_function_privilege('anon', to_regprocedure('public.card_purchase_set_date(uuid, text, date)'), 'EXECUTE'), false, 'D4 anon não executa');
select is(has_function_privilege('authenticated', to_regprocedure('public.card_purchase_set_date(uuid, text, date)'), 'EXECUTE'), true, 'D5 authenticated executa');

-- ---- a data muda, em todas as parcelas, e só ela ----
select is(pg_temp.datas('a', pg_temp.nt('px')), '2026-08-05,2026-08-05,2026-08-05', 'D6 antes: as 3 parcelas de X têm a data 05/08');
select is(pg_temp.mudar('a', pg_temp.nt('px'), date '2026-08-03'), '3', 'D7 corrigir X para 03/08 muda as 3 parcelas');
select is(pg_temp.datas('a', pg_temp.nt('px')), '2026-08-03,2026-08-03,2026-08-03', 'D8 todas as parcelas da compra ficam com a data nova');
select is(pg_temp.datas('a', pg_temp.nt('py')), '2026-09-05', 'D9 outra compra do mesmo cartão não muda');
select is(pg_temp.faturas('a', pg_temp.nt('px')), pg_temp.nt('faturasX0'), 'D10 a fatura de cada parcela (due_date e dias do ciclo) NÃO mudou');
select is(pg_temp.dinheiro(pg_temp.fx('a')), pg_temp.nt('dinheiro0'), 'D11 card_months, total e saldo da dívida iguais antes e depois (a data não mexe em dinheiro)');
select is(pg_temp.mudar('a', pg_temp.nt('px'), date '2026-08-03'), '0', 'D12 repetir a mesma data não regrava nada (0 parcelas)');

-- ---- vale também para fatura paga e travada (agosto pagou a 1ª parcela de X) ----
select is(pg_temp.mudar('a', pg_temp.nt('px'), date '2026-08-04'), '3', 'D13 compra com parcela em fatura paga e travada também muda de data (é só classificação)');
select is(pg_temp.dinheiro(pg_temp.fx('a')), pg_temp.nt('dinheiro0'), 'D14 e continua sem mexer em dinheiro');

-- ---- recusas ----
select is(pg_temp.mudar('a', pg_temp.nt('px'), (pg_temp.hoje() + 1)), 'erro 22023', 'D15 data futura: recusada (22023)');
select is(pg_temp.mudar('a', pg_temp.nt('px'), null), 'erro 22023', 'D16 data nula: recusada (22023)');
select is(pg_temp.mudar('a', pg_temp.nt('px'), date '1999-12-31'), 'erro 22023', 'D17 data antes de 2000: recusada (22023)');
select is(pg_temp.mudar('a', 'plano-que-nao-existe', date '2026-08-03'), 'erro 55000', 'D18 compra inexistente: 55000');
select is(pg_temp.mudar('a', null, date '2026-08-03'), 'erro 55000', 'D19 compra nula: 55000');
select is(pg_temp.mudar('loan', pg_temp.nt('px'), date '2026-08-03'), 'erro 22023', 'D20 dívida que não é cartão: 22023');
select is(pg_temp.mudar('s', (select plan from public.debt_installments where debt_id = pg_temp.fx('s') and recurrence_id = pg_temp.fx('r') limit 1), pg_temp.hoje()),
          'erro 55000', 'D21 assinatura de cartão (parcela com recurrence_id): recusada (55000)');
select is((select purchase_date::text from public.debt_installments where debt_id = pg_temp.fx('s') and recurrence_id = pg_temp.fx('r') limit 1), pg_temp.hoje()::text,
          'D22 e a data da assinatura continua a da cobrança');

-- ---- o gatilho de imutabilidade continua barrando o resto ----
-- Estas quatro rodam como superusuário (reset role): o usuário logado nem tem UPDATE na tabela, e o 42501 de permissão
-- esconderia o gatilho. Como superusuário, só o gatilho barra.
reset role;
select is(pg_temp.sqlstate_of($q$update public.debt_installments set purchase_date = date '2026-08-02' where debt_id = pg_temp.fx('a')$q$), '42501',
          'D23 sem a RPC, mudar a data direto continua barrado pelo gatilho (parcela é imutável)');
select is(pg_temp.sqlstate_of($q$select set_config('app.card_purchase_date', 'on', true); update public.debt_installments set face = face + 1 where debt_id = pg_temp.fx('a')$q$), '42501',
          'D24 mesmo com a marca ligada, mudar o valor é barrado pelo gatilho');
select is(pg_temp.sqlstate_of($q$select set_config('app.card_purchase_date', 'on', true); update public.debt_installments set due_date = due_date + 31 where debt_id = pg_temp.fx('a')$q$), '42501',
          'D25 mesmo com a marca ligada, mudar a fatura (due_date) é barrado pelo gatilho');
select is(pg_temp.sqlstate_of($q$select set_config('app.card_purchase_date', 'on', true); update public.debt_installments set person_id = null, description = description || 'x' where debt_id = pg_temp.fx('a')$q$), '42501',
          'D25b mesmo com a marca ligada, mudar a descrição é barrado pelo gatilho');
select is(coalesce(current_setting('app.card_purchase_date', true), ''), '', 'D26 a marca de sessão volta ao que era depois da RPC (e dos testes acima)');
select pg_temp.login('00000000-0000-0000-0000-000000111001');

-- ---- outra família e anônimo ----
select pg_temp.login('00000000-0000-0000-0000-000000111002');
select is(pg_temp.mudar('a', pg_temp.nt('px'), date '2026-08-03'), 'erro 42501', 'D27 outra família não muda a data da nossa compra (42501)');
select pg_temp.anon();
select is(pg_temp.mudar('a', pg_temp.nt('px'), date '2026-08-03'), 'erro 42501', 'D28 anônimo sem execute (42501)');
select pg_temp.login('00000000-0000-0000-0000-000000111001');
select is(pg_temp.datas('a', pg_temp.nt('px')), '2026-08-04,2026-08-04,2026-08-04', 'D29 depois das recusas a compra X continua com a última data boa');

select * from finish();
rollback;
