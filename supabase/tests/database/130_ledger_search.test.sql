-- 130_ledger_search: migration 138. Busca em Lançamentos no período da tela: descrição e observação, sem maiúscula nem
-- acento; compras do cartão pela fatura que vence no período; filtros iguais aos da lista; total por moeda somado no
-- banco (transferência só na quantidade). As funções vão por SQL dinâmico: sem a migration as asserções falham sem
-- abortar o arquivo.
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
-- descrições do que a busca achou, em ordem alfabética ("card:" na frente das parcelas); 'ERRO <sqlstate>' se falhar
create function pg_temp.achou(p_q text, p_from date default '2026-10-01', p_to date default '2026-10-31',
  p_account uuid default null, p_category uuid default null, p_type text default null, p_status text default null,
  p_card uuid default null, p_fixed boolean default false, p_installments boolean default false) returns text[]
language plpgsql as $f$
declare r text[];
begin
  execute 'select coalesce(array_agg(nome order by nome collate "C"), ''{}'') from (
             select case s.source when ''card'' then ''card:'' || i.description else t.description end as nome
               from public.ledger_search($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) s
               left join public.transactions t on s.source = ''transaction'' and t.id = s.id
               left join public.debt_installments i on s.source = ''card'' and i.id = s.id) q'
    into r using pg_temp.fx('h'), p_from, p_to, p_q, p_account, p_category, p_type, p_status, p_card, p_fixed, p_installments;
  return r;
exception when others then return array['ERRO ' || sqlstate];
end $f$;
-- "moeda|quantidade|entradas|saídas" por moeda, na ordem do banco
create function pg_temp.total(p_q text, p_type text default null) returns text[] language plpgsql as $f$
declare r text[];
begin
  execute 'select coalesce(array_agg(currency_code || ''|'' || item_count || ''|'' || income::numeric(14,2) || ''|''
                    || expense::numeric(14,2) order by ord), ''{}'')
             from (select x.*, row_number() over () as ord
                     from public.ledger_search_totals($1, ''2026-10-01'', ''2026-10-31'', $2, p_type => $3) x) q'
    into r using pg_temp.fx('h'), p_q, p_type;
  return r;
exception when others then return array['ERRO ' || sqlstate];
end $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid),
  pg_temp.achou(text, date, date, uuid, uuid, text, text, uuid, boolean, boolean), pg_temp.total(text, text) to public;

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000130a1', 'b1@teste130.com', now()),
  ('00000000-0000-0000-0000-0000000130a2', 'b2@teste130.com', now());

select pg_temp.login('00000000-0000-0000-0000-0000000130a1');
insert into fixture select 'h', public.create_household('Casa da Busca');
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

-- Outubro de 2026. Acham "flora": a despesa paga, a planejada pela observação, a receita em maiúsculas com acento, a
-- despesa em dólar e a transferência. Não acham: fora do período, na lixeira e a que não tem o texto.
insert into public.transactions (household_id, type, status, date, amount, description, notes, account_id, category_id)
values (pg_temp.fx('h'), 'expense', 'paid', '2026-10-10', 287.34, 'Flora Energia', null, pg_temp.fx('brl'), pg_temp.fx('cat')),
       (pg_temp.fx('h'), 'expense', 'planned', '2026-10-20', 30.00, 'Mercado', 'flores da floricultura e flora do bairro', pg_temp.fx('brl'), pg_temp.fx('cat')),
       (pg_temp.fx('h'), 'income', 'paid', '2026-10-05', 100.00, 'REEMBOLSO FLÓRA', null, pg_temp.fx('brl'), pg_temp.fx('rec')),
       (pg_temp.fx('h'), 'expense', 'paid', '2026-10-07', 10.00, 'Flora no exterior', null, pg_temp.fx('usd'), pg_temp.fx('cat')),
       (pg_temp.fx('h'), 'expense', 'paid', '2026-09-30', 999.00, 'Flora de setembro', null, pg_temp.fx('brl'), pg_temp.fx('cat')),
       (pg_temp.fx('h'), 'expense', 'paid', '2026-10-11', 888.00, 'Flora apagada', null, pg_temp.fx('brl'), pg_temp.fx('cat')),
       (pg_temp.fx('h'), 'expense', 'paid', '2026-10-12', 77.00, 'Padaria', null, pg_temp.fx('brl'), pg_temp.fx('cat')),
       (pg_temp.fx('h'), 'expense', 'paid', '2026-10-13', 5.00, 'axb', null, pg_temp.fx('brl'), pg_temp.fx('cat')),
       (pg_temp.fx('h'), 'expense', 'paid', '2026-10-14', 6.00, 'Desconto 100%', null, pg_temp.fx('brl'), pg_temp.fx('cat'));
insert into public.transactions (household_id, type, status, date, amount, description, account_id, destination_account_id)
values (pg_temp.fx('h'), 'transfer', 'paid', '2026-10-15', 50.00, 'Guardar para a Flora', pg_temp.fx('brl'), pg_temp.fx('poup'));
update public.transactions set deleted_at = now() where household_id = pg_temp.fx('h') and description = 'Flora apagada';

-- Cartão: fecha 18, vence 25, paga pelo Banco. 20/09 entra na fatura que vence 25/10 (no período); 20/10 na que vence
-- 25/11 (fora); 21/09 em 3 vezes: só a 1ª parcela vence em outubro.
insert into fixture select 'card', public.create_debt('Cartão', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('card'), 18, 25);
select public.set_card_pay_account(pg_temp.fx('card'), pg_temp.fx('brl'));
select public.card_purchase(pg_temp.fx('card'), '2026-09-20', 60.00, 1, pg_temp.fx('cat'), 'Flora Café');
select public.card_purchase(pg_temp.fx('card'), '2026-10-20', 70.00, 1, pg_temp.fx('cat'), 'Flora de novembro');
select public.card_purchase(pg_temp.fx('card'), '2026-09-21', 90.00, 3, pg_temp.fx('cat'), 'Floricultura parcelada');

-- ---------------------------------------------------------------------------
-- 1. O que acha
-- ---------------------------------------------------------------------------
select is(pg_temp.achou('flora'), array['Flora Energia', 'Flora no exterior', 'Guardar para a Flora', 'Mercado', 'REEMBOLSO FLÓRA', 'card:Flora Café'],
  'B1 "flora" acha descrição e observação, maiúscula e acento, a conta em dólar, a transferência e a compra do cartão que '
  'vence no período; fora do período, lixeira e a compra de novembro não');
select is(pg_temp.achou('  FLÓRA  '), pg_temp.achou('flora'), 'B2 espaços nas pontas, maiúscula e acento no texto digitado não mudam nada');
select is(pg_temp.achou('floricultura'), array['Mercado', 'card:Floricultura parcelada'],
  'B3 parcela do cartão: só a que vence no período (1 de 3); a observação também acha');
select is(pg_temp.achou('a_b'), '{}'::text[], 'B4 "_" digitado é texto, não curinga ("axb" não aparece)');
select is(pg_temp.achou('0%'), array['Desconto 100%'], 'B5 "%" digitado é texto');
select is(pg_temp.achou('flora', '2026-09-01', '2026-09-30'), array['Flora de setembro'],
  'B6 o período manda: em setembro, só o de setembro (a compra de 20/09 vence em outubro)');

-- ---------------------------------------------------------------------------
-- 2. Filtros da lista
-- ---------------------------------------------------------------------------
select is(pg_temp.achou('flora', p_type => 'income'), array['REEMBOLSO FLÓRA'], 'F1 tipo receita: sem cartão');
select is(pg_temp.achou('flora', p_status => 'planned'), array['Mercado'], 'F2 situação Pendente: só lançamento (cartão some)');
select is(pg_temp.achou('flora', p_card => pg_temp.fx('card')), array['card:Flora Café'], 'F3 filtro de cartão: só as compras dele');
select is(pg_temp.achou('flora', p_account => pg_temp.fx('poup')), array['Guardar para a Flora'],
  'F4 conta como destino entra (transferência); cartão pago por outra conta não');
select is(pg_temp.achou('flora', p_account => pg_temp.fx('brl')), array['Flora Energia', 'Guardar para a Flora', 'Mercado', 'REEMBOLSO FLÓRA', 'card:Flora Café'],
  'F5 conta Banco: os dela e o cartão pago por ela; a de dólar não');
select is(pg_temp.achou('flora', p_category => pg_temp.fx('rec')), array['REEMBOLSO FLÓRA'], 'F6 categoria filtra lançamento e parcela');
select is(pg_temp.achou('flora', p_fixed => true), '{}'::text[], 'F7 só fixos: nenhum recorrente aqui');

-- ---------------------------------------------------------------------------
-- 3. Totais (somados no banco, por moeda)
-- ---------------------------------------------------------------------------
select is(pg_temp.total('flora'), array['BRL|5|100.00|377.34', 'USD|1|0.00|10.00'],
  'T1 reais: 5 itens, entradas 100,00, saídas 287,34 + 30,00 + 60,00 (cartão); transferência só na quantidade; dólar à parte');
select is(pg_temp.total('padaria'), array['BRL|1|0.00|77.00'], 'T2 um item só');
select is(pg_temp.total('nada disso'), '{}'::text[], 'T3 nada encontrado: sem linhas');
select is(pg_temp.total('flora', 'income'), array['BRL|1|100.00|0.00'], 'T4 o total segue os filtros');

-- ---------------------------------------------------------------------------
-- 4. Validação, privilégios e isolamento
-- ---------------------------------------------------------------------------
select is(pg_temp.achou('   '), array['ERRO 22023'], 'V1 texto em branco: recusado');
select is(pg_temp.achou(repeat('a', 101)), array['ERRO 22023'], 'V2 texto com mais de 100 letras: recusado');
select is(pg_temp.achou('flora', '2026-10-31', '2026-10-01'), array['ERRO 22023'], 'V3 fim antes do início: recusado');
select ok(not has_function_privilege('anon', 'public.ledger_search(uuid, date, date, text, uuid, uuid, text, text, uuid, boolean, boolean)', 'EXECUTE'), 'V4 anon sem EXECUTE');
select ok(has_function_privilege('authenticated', 'public.ledger_search_totals(uuid, date, date, text, uuid, uuid, text, text, uuid, boolean, boolean)', 'EXECUTE'), 'V5 authenticated com EXECUTE');
select ok(not (select prosecdef from pg_proc where oid = 'public.ledger_search(uuid, date, date, text, uuid, uuid, text, text, uuid, boolean, boolean)'::regprocedure), 'V6 SECURITY INVOKER');

select pg_temp.login('00000000-0000-0000-0000-0000000130a2');
select is(pg_temp.achou('flora'), '{}'::text[], 'S1 outra família não acha nada desta');

select * from finish();
rollback;
