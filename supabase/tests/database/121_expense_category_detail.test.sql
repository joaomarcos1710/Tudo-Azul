-- 121_expense_category_detail: migration 127. O detalhe de uma categoria RAIZ (expense_category_detail) lê os mesmos
-- itens da barra do gráfico (expenses_by_category / _basis): o total do detalhe tem de ser IGUAL ao valor da barra,
-- nas três bases, com subcategoria, cartão (fechamento × compra × parcela), estorno, cancelamento, dólar e lixeira.
-- Cenário copiado do teste 62. A função nova vai por SQL dinâmico: sem a migration as asserções falham sem abortar.
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
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
-- relatório inteiro: "categoria|valor|%" na ordem do banco; 'ERRO <sqlstate>' se a função falhar ou não existir
create function pg_temp.rel(p_h uuid, p_from date, p_to date, p_basis text, p_top integer default null) returns text[]
language plpgsql as $f$
declare r text[];
begin
  execute 'select coalesce(array_agg(coalesce(name, ''?'') || ''|'' || amount::numeric(14,2) || ''|'' || share), ''{}'')
             from public.expenses_by_category_basis($1, $2, $3, $4, $5)'
    into r using p_h, p_from, p_to, p_basis, p_top;
  return r;
exception when others then return array['ERRO ' || sqlstate];
end $f$;
-- valor de UMA categoria no mês AAAA-MM (0 se não aparece); null se a função falhar
create function pg_temp.cat(p_basis text, p_mes text, p_cat text) returns numeric language plpgsql as $f$
declare v numeric; d date := (p_mes || '-01')::date;
begin
  execute 'select coalesce(sum(amount), 0)::numeric(14,2) from public.expenses_by_category_basis($1, $2, $3, $4) where category_id = $5'
    into v using pg_temp.fx('h'), d, (d + interval '1 month - 1 day')::date, p_basis, pg_temp.fx(p_cat);
  return v;
exception when others then return null;
end $f$;
-- série mensal de uma categoria a partir de p_mes, n meses
create function pg_temp.serie(p_basis text, p_mes text, p_n integer, p_cat text) returns numeric[] language sql as $f$
  select array_agg(pg_temp.cat(p_basis, to_char((p_mes || '-01')::date + make_interval(months => k), 'YYYY-MM'), p_cat) order by k)
    from generate_series(0, p_n - 1) k $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.sqlstate_of(text),
  pg_temp.rel(uuid, date, date, text, integer), pg_temp.cat(text, text, text), pg_temp.serie(text, text, integer, text) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000121a1', 'b1@teste.com'),
  ('00000000-0000-0000-0000-0000000121a2', 'b2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000121a1');
insert into fixture select 'h', public.create_household('Casa do Detalhe');
insert into fixture select 'A', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';
insert into fixture select 'B', id from public.categories where household_id = pg_temp.fx('h') and name = 'Lazer';
insert into fixture select 'C', id from public.categories where household_id = pg_temp.fx('h') and name = 'Mercado';
insert into fixture select 'D', id from public.categories where household_id = pg_temp.fx('h') and name = 'Assinaturas';
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 50000.00, '2025-01-01') returning id)
  insert into fixture select 'brl', id from i;
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date, currency_code)
           values (pg_temp.fx('h'), 'Conta em dólar', 'checking', 0, '2025-01-01', 'USD') returning id)
  insert into fixture select 'usd', id from i;

-- Cartão: fecha dia 18, vence 25.
insert into fixture select 'card', public.create_debt('Cartão', 'card', '2025-01-01', 0);
select public.set_card_cycle(pg_temp.fx('card'), 18, 25);

-- Compra 1: TV de 1.200,00 em 10x no dia 20/07/2025 (depois do fechamento de julho): faturas de 18/08/2025 a 18/05/2026.
select public.card_purchase(pg_temp.fx('card'), '2025-07-20', 1200.00, 10, pg_temp.fx('A'), 'TV');
-- Compra 2: 300,00 em 3x em 05/09/2025 (Lazer): faturas 18/09, 18/10 e 18/11/2025.
select public.card_purchase(pg_temp.fx('card'), '2025-09-05', 300.00, 3, pg_temp.fx('B'), 'Show');
-- Assinatura de cartão (ocorrência de 25/07/2025 já parcelada, como recurrence_materialize faria; regra começa em 2030
-- para nada mais ser gerado): fatura de 18/08/2025.
insert into fixture select 'rec', public.recurrence_create('card', 'Streaming', 30.00, 25, '2030-07-25', null, null, pg_temp.fx('card'), pg_temp.fx('D'));
reset role;
insert into public.debt_installments (household_id, debt_id, plan, seq, due_date, face, category_id, description,
                                      purchase_date, closing_day, due_day, recurrence_id, occurrence_date)
values (pg_temp.fx('h'), pg_temp.fx('card'), gen_random_uuid()::text, 1, '2025-08-18', 30.00, pg_temp.fx('D'), 'Streaming',
        '2025-07-25', 18, 25, pg_temp.fx('rec'), '2025-07-25');
select pg_temp.login('00000000-0000-0000-0000-0000000121a1');

-- cobra até outubro; cancela a 3ª parcela da compra 2 antes de cobrar (estorno de parcela futura = 'cancel'); cobra o resto
select public.card_bill_due('2025-10-31');
select public.debt_refund((select id from public.debt_installments where debt_id = pg_temp.fx('card') and description = 'Show' and seq = 3),
                          '2025-11-01', 100.00);
select public.card_bill_due('2026-06-30');
-- estorno parcial de 50,00 da 1ª parcela da compra 2, já cobrada ('credit'), em 02/10/2025
select public.debt_refund((select id from public.debt_installments where debt_id = pg_temp.fx('card') and description = 'Show' and seq = 1),
                          '2025-10-02', 50.00);

-- Fora do cartão (Mercado): 80,00 pago em 10/07/2025 em reais; 999,00 em dólar (fica fora); 77,00 na lixeira (fora).
insert into public.transactions (household_id, type, status, date, amount, description, account_id, category_id)
values (pg_temp.fx('h'), 'expense', 'paid', '2025-07-10', 80.00, 'Feira', pg_temp.fx('brl'), pg_temp.fx('C')),
       (pg_temp.fx('h'), 'expense', 'paid', '2025-07-11', 999.00, 'Mercado em Miami', pg_temp.fx('usd'), pg_temp.fx('C'));
insert into public.transactions (household_id, type, status, date, amount, description, account_id, category_id)
values (pg_temp.fx('h'), 'expense', 'paid', '2025-07-12', 77.00, 'Apagada', pg_temp.fx('brl'), pg_temp.fx('C'));
update public.transactions set deleted_at = now() where household_id = pg_temp.fx('h') and description = 'Apagada';
-- orçamento de julho/2025 em Compras pessoais (a compra é de julho, mas o orçamento segue a fatura)
insert into public.budgets (household_id, category_id, month, amount_limit) values (pg_temp.fx('h'), pg_temp.fx('A'), '2025-07-01', 500.00);


-- Subcategoria "Feira livre" dentro de Mercado: 30,00 em 12/07/2025 pagos em reais (a barra "Mercado" soma mãe + filha).
insert into public.categories (household_id, name, type, parent_id) values (pg_temp.fx('h'), 'Feira livre', 'expense', pg_temp.fx('C'));
insert into fixture select 'C2', id from public.categories where household_id = pg_temp.fx('h') and name = 'Feira livre';
insert into public.transactions (household_id, type, status, date, amount, description, account_id, category_id)
values (pg_temp.fx('h'), 'expense', 'paid', '2025-07-12', 30.00, 'Banca', pg_temp.fx('brl'), pg_temp.fx('C2'));

-- helpers do detalhe (SQL dinâmico: sem a migration 127 as asserções falham sem abortar o arquivo)
-- "dia|categoria|principal|valor" na ordem do banco
create function pg_temp.det(p_h uuid, p_from date, p_to date, p_cat uuid, p_basis text) returns text[]
language plpgsql as $f$
declare r text[];
begin
  execute 'select coalesce(array_agg(day || ''|'' || name || ''|'' || coalesce(parent_name, '''') || ''|'' || amount::numeric(14,2) order by ord), ''{}'')
             from (select d.*, row_number() over () as ord from public.expense_category_detail($1, $2, $3, $4, $5) d) q'
    into r using p_h, p_from, p_to, p_cat, p_basis;
  return r;
exception when others then return array['ERRO ' || sqlstate];
end $f$;
-- total do detalhe (calculado no banco) de uma categoria raiz no mês AAAA-MM; 0 se não há linhas; null se falhar
create function pg_temp.dtot(p_basis text, p_mes text, p_cat text) returns numeric language plpgsql as $f$
declare v numeric; d date := (p_mes || '-01')::date;
begin
  execute 'select coalesce(max(total), 0)::numeric(14,2) from public.expense_category_detail($1, $2, $3, $4, $5)'
    into v using pg_temp.fx('h'), d, (d + interval '1 month - 1 day')::date, pg_temp.fx(p_cat), p_basis;
  return v;
exception when others then return null;
end $f$;
create function pg_temp.dserie(p_basis text, p_mes text, p_n integer, p_cat text) returns numeric[] language sql as $f$
  select array_agg(pg_temp.dtot(p_basis, to_char((p_mes || '-01')::date + make_interval(months => k), 'YYYY-MM'), p_cat) order by k)
    from generate_series(0, p_n - 1) k $f$;
grant execute on function pg_temp.det(uuid, date, date, uuid, text), pg_temp.dtot(text, text, text), pg_temp.dserie(text, text, integer, text) to public;

-- ---------------------------------------------------------------------------
-- 1. O total do detalhe é IGUAL ao valor da barra, mês a mês, nas três bases, para cada categoria raiz
-- ---------------------------------------------------------------------------
select is(pg_temp.dserie(b, '2025-07', 12, k), pg_temp.serie(b, '2025-07', 12, k),
          format('D1 base %s, categoria %s: total do detalhe = valor da barra em cada mês de jul/2025 a jun/2026', b, k))
  from unnest(array['invoice', 'purchase', 'installment']) b, unnest(array['A', 'B', 'C', 'D']) k;
-- e no período inteiro de uma vez (o intervalo não muda o que é item)
select is((select coalesce(max(total), 0)::numeric(14,2) from public.expense_category_detail(pg_temp.fx('h'), '2025-07-01', '2026-06-30', pg_temp.fx('A'), b)),
          (select coalesce(sum(amount), 0)::numeric(14,2) from public.expenses_by_category_basis(pg_temp.fx('h'), '2025-07-01', '2026-06-30', b) where category_id = pg_temp.fx('A')),
          format('D2 base %s: período inteiro de Compras pessoais, detalhe = barra', b))
  from unnest(array['invoice', 'purchase', 'installment']) b;
-- base invoice = expenses_by_category (a barra de sempre)
select is((select coalesce(max(total), 0)::numeric(14,2) from public.expense_category_detail(pg_temp.fx('h'), '2025-07-01', '2025-12-31', pg_temp.fx('C'))),
          (select coalesce(sum(amount), 0)::numeric(14,2) from public.expenses_by_category(pg_temp.fx('h'), '2025-07-01', '2025-12-31') where category_id = pg_temp.fx('C')),
          'D3 base padrão (invoice): detalhe de Mercado = expenses_by_category');

-- ---------------------------------------------------------------------------
-- 2. Subcategoria soma na mãe; dólar e lixeira ficam fora; linhas por dia e categoria
-- ---------------------------------------------------------------------------
select is(pg_temp.det(pg_temp.fx('h'), '2025-07-01', '2025-07-31', pg_temp.fx('C'), 'invoice'),
          array['2025-07-12|Feira livre|Mercado|30.00', '2025-07-10|Mercado||80.00'],
          'M1 Mercado em julho: a filha (30,00) e a mãe (80,00); o dólar (999,00) e a lixeira (77,00) ficam fora');
select is(pg_temp.dtot('invoice', '2025-07', 'C'), 110.00::numeric, 'M2 total de Mercado em julho: 110,00 (mãe + filha)');
select is(pg_temp.det(pg_temp.fx('h'), '2025-07-01', '2025-07-31', pg_temp.fx('C2'), 'invoice'), '{}'::text[],
          'M3 passar uma SUBcategoria como p_category não devolve nada: o detalhe é da categoria raiz da barra');

-- ---------------------------------------------------------------------------
-- 3. Cartão: cada base põe o gasto no seu dia; estorno e cancelamento
-- ---------------------------------------------------------------------------
select is(pg_temp.det(pg_temp.fx('h'), '2025-07-01', '2025-07-31', pg_temp.fx('A'), 'purchase'), array['2025-07-20|Compras pessoais||1200.00'],
          'C1 base compra: os 1.200,00 da TV inteiros no dia da compra');
select is(pg_temp.det(pg_temp.fx('h'), '2025-07-01', '2025-07-31', pg_temp.fx('A'), 'invoice'), '{}'::text[],
          'C2 base fatura: a TV não aparece em julho (1º fechamento é agosto)');
select is(pg_temp.det(pg_temp.fx('h'), '2025-08-01', '2025-08-31', pg_temp.fx('A'), 'invoice'), array['2025-08-18|Compras pessoais||120.00'],
          'C3 base fatura: 120,00 no fechamento de 18/08/2025');
select is(pg_temp.dserie('invoice', '2025-09', 3, 'B'), array[100, 50, 0]::numeric[],
          'C4 Lazer pela fatura: 100; 100 − estorno 50; nada (parcela cancelada)');
select is(pg_temp.det(pg_temp.fx('h'), '2025-11-01', '2025-11-30', pg_temp.fx('B'), 'purchase'), '{}'::text[],
          'C5 Lazer na base compra em novembro: nenhuma linha (cobrança tirada, valor posto em setembro, sem "R$ 0,00")');

-- ---------------------------------------------------------------------------
-- 4. Parâmetro inválido, privilégios e isolamento
-- ---------------------------------------------------------------------------
select is(pg_temp.sqlstate_of(format($$select * from public.expense_category_detail(%L, '2025-07-01', '2025-07-31', %L, 'due')$$, pg_temp.fx('h'), pg_temp.fx('C'))),
          '22023', 'P1 base desconhecida: recusada (22023)');
select is(pg_temp.sqlstate_of(format($$select * from public.expense_category_detail(%L, '2025-07-01', '2025-07-31', %L, null)$$, pg_temp.fx('h'), pg_temp.fx('C'))),
          '22023', 'P2 base nula: recusada (22023)');
select ok(not has_function_privilege('anon', 'public.expense_category_detail(uuid, date, date, uuid, text)', 'EXECUTE'), 'P3 anon sem EXECUTE');
select ok(has_function_privilege('authenticated', 'public.expense_category_detail(uuid, date, date, uuid, text)', 'EXECUTE'), 'P4 authenticated com EXECUTE');
select ok(not (select prosecdef from pg_proc where oid = 'public.expense_category_detail(uuid, date, date, uuid, text)'::regprocedure), 'P5 SECURITY INVOKER');

select pg_temp.login('00000000-0000-0000-0000-0000000121a2');
select public.create_household('Outra casa');
select is(pg_temp.det(pg_temp.fx('h'), '2025-07-01', '2026-06-30', pg_temp.fx('C'), b), '{}'::text[],
          format('S1 base %s: outra família recebe zero linhas', b))
  from unnest(array['invoice', 'purchase', 'installment']) b;

select * from finish();
rollback;
