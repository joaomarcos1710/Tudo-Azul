-- 131_ledger_filter_totals: migration 139. O total do rodapé de Lançamentos com filtro ligado e SEM texto de busca: o mesmo
-- ledger_search / ledger_search_totals da 138, com p_query nulo. Lançamentos e compras do cartão, pagos e previstos juntos;
-- texto em branco continua recusado (nulo é "não busquei", branco é engano). As funções vão por SQL dinâmico: sem a
-- migration, o nulo é recusado e as asserções falham sem abortar o arquivo.
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
-- descrições do que a busca achou, em ordem; texto nulo = só os filtros; 'ERRO <sqlstate>' se falhar
create function pg_temp.achou(p_q text, p_account uuid default null, p_category uuid default null, p_type text default null,
  p_status text default null, p_card uuid default null, p_fixed boolean default false, p_installments boolean default false)
returns text[] language plpgsql as $f$
declare r text[];
begin
  execute 'select coalesce(array_agg(nome order by nome collate "C"), ''{}'') from (
             select case s.source when ''card'' then ''card:'' || i.description else t.description end as nome
               from public.ledger_search($1, ''2026-10-01'', ''2026-10-31'', $2, $3, $4, $5, $6, $7, $8, $9) s
               left join public.transactions t on s.source = ''transaction'' and t.id = s.id
               left join public.debt_installments i on s.source = ''card'' and i.id = s.id) q'
    into r using pg_temp.fx('h'), p_q, p_account, p_category, p_type, p_status, p_card, p_fixed, p_installments;
  return r;
exception when others then return array['ERRO ' || sqlstate];
end $f$;
-- "moeda|quantidade|entradas|saídas" por moeda, na ordem do banco
create function pg_temp.total(p_q text, p_type text default null, p_status text default null, p_category uuid default null)
returns text[] language plpgsql as $f$
declare r text[];
begin
  execute 'select coalesce(array_agg(currency_code || ''|'' || item_count || ''|'' || income::numeric(14,2) || ''|''
                    || expense::numeric(14,2) order by ord), ''{}'')
             from (select x.*, row_number() over () as ord
                     from public.ledger_search_totals($1, ''2026-10-01'', ''2026-10-31'', $2, p_type => $3, p_status => $4,
                                                      p_category => $5) x) q'
    into r using pg_temp.fx('h'), p_q, p_type, p_status, p_category;
  return r;
exception when others then return array['ERRO ' || sqlstate];
end $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid),
  pg_temp.achou(text, uuid, uuid, text, text, uuid, boolean, boolean), pg_temp.total(text, text, text, uuid) to public;

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000131a1', 'f1@teste131.com', now()),
  ('00000000-0000-0000-0000-0000000131a2', 'f2@teste131.com', now());

select pg_temp.login('00000000-0000-0000-0000-0000000131a1');
insert into fixture select 'h', public.create_household('Casa do Filtro');
insert into fixture select 'cat', id from public.categories where household_id = pg_temp.fx('h') and name = 'Mercado';
insert into fixture select 'rec', id from public.categories where household_id = pg_temp.fx('h') and type = 'income' order by name limit 1;
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 5000.00, '2026-01-01') returning id)
  insert into fixture select 'brl', id from i;
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Poupança', 'savings', 0, '2026-01-01') returning id)
  insert into fixture select 'poup', id from i;
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date, currency_code)
           values (pg_temp.fx('h'), 'Conta em dólar', 'checking', 0, '2026-01-01', 'USD') returning id)
  insert into fixture select 'usd', id from i;

-- Outubro de 2026 (no período): despesa paga 287,34, despesa planejada 30,00, receita paga 100,00, despesa em dólar 10,00,
-- transferência 50,00. Fora: setembro, lixeira.
insert into public.transactions (household_id, type, status, date, amount, description, notes, account_id, category_id)
values (pg_temp.fx('h'), 'expense', 'paid', '2026-10-10', 287.34, 'Flora Energia', null, pg_temp.fx('brl'), pg_temp.fx('cat')),
       (pg_temp.fx('h'), 'expense', 'planned', '2026-10-20', 30.00, 'Mercado', 'flores', pg_temp.fx('brl'), pg_temp.fx('cat')),
       (pg_temp.fx('h'), 'income', 'paid', '2026-10-05', 100.00, 'Reembolso', null, pg_temp.fx('brl'), pg_temp.fx('rec')),
       (pg_temp.fx('h'), 'expense', 'paid', '2026-10-07', 10.00, 'Dólar', null, pg_temp.fx('usd'), pg_temp.fx('cat')),
       (pg_temp.fx('h'), 'expense', 'paid', '2026-09-30', 999.00, 'De setembro', null, pg_temp.fx('brl'), pg_temp.fx('cat')),
       (pg_temp.fx('h'), 'expense', 'paid', '2026-10-11', 888.00, 'Apagada', null, pg_temp.fx('brl'), pg_temp.fx('cat'));
insert into public.transactions (household_id, type, status, date, amount, description, account_id, destination_account_id)
values (pg_temp.fx('h'), 'transfer', 'paid', '2026-10-15', 50.00, 'Guardar', pg_temp.fx('brl'), pg_temp.fx('poup'));
update public.transactions set deleted_at = now() where household_id = pg_temp.fx('h') and description = 'Apagada';

-- Cartão (fecha 18, vence 25, paga pelo Banco): 60,00 de 20/09 e a 1ª parcela (30,00) de 90,00 em 3x vencem em outubro;
-- a de 70,00 de 20/10 vence em novembro (fora).
insert into fixture select 'card', public.create_debt('Cartão', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('card'), 18, 25);
select public.set_card_pay_account(pg_temp.fx('card'), pg_temp.fx('brl'));
select public.card_purchase(pg_temp.fx('card'), '2026-09-20', 60.00, 1, pg_temp.fx('cat'), 'Café do cartão');
select public.card_purchase(pg_temp.fx('card'), '2026-10-20', 70.00, 1, pg_temp.fx('cat'), 'Compra de novembro');
select public.card_purchase(pg_temp.fx('card'), '2026-09-21', 90.00, 3, pg_temp.fx('cat'), 'Parcelada');

-- ---------------------------------------------------------------------------
-- 1. Só filtros (texto nulo)
-- ---------------------------------------------------------------------------
select is(pg_temp.achou(null), array['Dólar', 'Flora Energia', 'Guardar', 'Mercado', 'Reembolso', 'card:Café do cartão', 'card:Parcelada'],
  'N1 sem texto e sem filtro: tudo do período (lançamentos, transferência, outra moeda e as parcelas de cartão que vencem nele)');
select is(pg_temp.achou(null, p_type => 'income'), array['Reembolso'], 'N2 só receitas: sem cartão');
select is(pg_temp.achou(null, p_type => 'expense'), array['Dólar', 'Flora Energia', 'Mercado', 'card:Café do cartão', 'card:Parcelada'],
  'N3 só despesas: lançamentos e compras do cartão');
select is(pg_temp.achou(null, p_status => 'planned'), array['Mercado'], 'N4 só pendentes: a compra do cartão não entra');
select is(pg_temp.achou(null, p_card => pg_temp.fx('card')), array['card:Café do cartão', 'card:Parcelada'], 'N5 só o cartão: nenhum lançamento');
select is(pg_temp.achou(null, p_category => pg_temp.fx('cat')), array['Dólar', 'Flora Energia', 'Mercado', 'card:Café do cartão', 'card:Parcelada'],
  'N6 categoria Mercado: lançamentos e parcelas da categoria');
select is(pg_temp.achou(null, p_fixed => true), '{}'::text[], 'N7 só fixos: nenhum recorrente aqui');
select is(pg_temp.achou(null, p_type => 'expense', p_account => pg_temp.fx('brl')), array['Flora Energia', 'Mercado', 'card:Café do cartão', 'card:Parcelada'],
  'N8 despesas da conta Banco: o cartão pago por ela entra, a conta em dólar não');
select is(pg_temp.achou('flora', p_type => 'expense'), array['Flora Energia'], 'N9 com texto continua igual ao da 138 (a busca não quebrou)');

-- ---------------------------------------------------------------------------
-- 2. Totais por moeda, somados no banco
-- ---------------------------------------------------------------------------
select is(pg_temp.total(null), array['BRL|6|100.00|407.34', 'USD|1|0.00|10.00'],
  'T1 sem filtro: 6 itens em reais (transferência só na quantidade), entradas 100,00, saídas 287,34 + 30,00 + 60,00 + 30,00; dólar à parte');
select is(pg_temp.total(null, 'expense'), array['BRL|4|0.00|407.34', 'USD|1|0.00|10.00'], 'T2 despesas: pagas, previstas e cartão juntos; a transferência não é despesa');
select is(pg_temp.total(null, null, 'planned'), array['BRL|1|0.00|30.00'], 'T3 pendentes: só o previsto, em reais');
select is(pg_temp.total(null, null, null, pg_temp.fx('rec')), array['BRL|1|100.00|0.00'], 'T4 categoria de receita: só a receita');

-- ---------------------------------------------------------------------------
-- 3. Validação e isolamento
-- ---------------------------------------------------------------------------
select is(pg_temp.achou('   '), array['ERRO 22023'], 'V1 texto só com espaços continua recusado');
select is(pg_temp.achou(''), array['ERRO 22023'], 'V2 texto vazio continua recusado (nulo é que vale "sem texto")');
select is(pg_temp.achou(repeat('a', 101)), array['ERRO 22023'], 'V3 texto com mais de 100 letras continua recusado');
select ok(not has_function_privilege('anon', 'public.ledger_search(uuid, date, date, text, uuid, uuid, text, text, uuid, boolean, boolean)', 'EXECUTE'),
  'V4 anon continua sem EXECUTE depois do create or replace');
select ok(not (select prosecdef from pg_proc where oid = 'public.ledger_search(uuid, date, date, text, uuid, uuid, text, text, uuid, boolean, boolean)'::regprocedure),
  'V5 continua SECURITY INVOKER');

select pg_temp.login('00000000-0000-0000-0000-0000000131a2');
select is(pg_temp.achou(null), '{}'::text[], 'S1 outra família não vê nada desta, nem sem texto');

select * from finish();
rollback;
