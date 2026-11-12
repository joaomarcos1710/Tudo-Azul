-- 107_card_invoice_categories: migration 112 (20261112140000_card_invoice_categories.sql). Pedido do dono de 12/11/2026
-- (referência Organizze): despesas por categoria de UMA fatura de cartão, valor e percentual calculados no banco.
-- O que este arquivo prova:
--   • forma e permissões (SECURITY INVOKER, STABLE, search_path vazio; authenticated executa, anon não);
--   • várias categorias e parcelas: o valor é o líquido da parcela da fatura (parcelado cai uma parcela por fatura);
--   • subcategoria soma na categoria raiz (como expenses_by_category);
--   • compra cancelada (excluída) fica fora; estorno de compra abate a categoria da compra;
--   • crédito avulso (receita) NÃO é categoria de despesa; assinatura prevista NÃO entra (decisões em 30 - Decisões);
--   • a soma das categorias bate com card_months (charged + pending, e total + credits) em todas as faturas;
--   • percentuais vêm do banco (1 casa) e a coluna total é a soma das categorias;
--   • fatura paga/travada continua consultável; fatura inexistente, rótulo fora do formato, nulo e dívida que não é
--     cartão devolvem vazio; outra família e anônimo não leem.
-- Cartão fecha dia 17 e vence dia 25; compras de março e abril de 2026 (já fechadas). Dados inventados.
-- Sem a migration este arquivo falha (a função não existe).
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
create function pg_temp.fat(p_card uuid, p_label text) returns uuid language sql as $f$
  select id from public.debt_invoices where debt_id = p_card and label = p_label $f$;
-- "Categoria=valor/%" na ordem do banco, separado por " ; "; o valor em duas casas
create function pg_temp.cats(p_label text) returns text language sql as $f$
  select coalesce(string_agg(name || '=' || amount::numeric(14,2) || '/' || share, ' ; ' order by amount desc, name), '')
    from public.card_invoice_categories(pg_temp.fx('a'), p_label) $f$;
-- a soma das categorias (feita AQUI só para o teste) contra o que card_months mostra
create function pg_temp.soma_cats(p_label text) returns numeric language sql as $f$
  select coalesce(sum(amount), 0) from public.card_invoice_categories(pg_temp.fx('a'), p_label) $f$;
create function pg_temp.m_charged(p_label text) returns numeric language sql as $f$ select charged from public.card_months(pg_temp.fx('a')) where label = p_label $f$;
create function pg_temp.m_pending(p_label text) returns numeric language sql as $f$ select pending from public.card_months(pg_temp.fx('a')) where label = p_label $f$;
create function pg_temp.m_total(p_label text) returns numeric language sql as $f$ select total from public.card_months(pg_temp.fx('a')) where label = p_label $f$;
create function pg_temp.m_credits(p_label text) returns numeric language sql as $f$ select credits from public.card_months(pg_temp.fx('a')) where label = p_label $f$;
create function pg_temp.m_paid(p_label text) returns numeric language sql as $f$ select paid from public.card_months(pg_temp.fx('a')) where label = p_label $f$;
grant execute on all functions in schema pg_temp to public;

-- ---- F: forma e permissões ----
select has_function('public', 'card_invoice_categories', array['uuid', 'text'], 'F1 existe public.card_invoice_categories(uuid, text)');
select is((select prosecdef from pg_proc where oid = 'public.card_invoice_categories(uuid, text)'::regprocedure), false,
          'F2 é SECURITY INVOKER (a RLS de quem chama decide)');
select is((select provolatile from pg_proc where oid = 'public.card_invoice_categories(uuid, text)'::regprocedure), 's', 'F3 é STABLE (só leitura)');
select is((select proconfig::text from pg_proc where oid = 'public.card_invoice_categories(uuid, text)'::regprocedure), '{"search_path=\"\""}', 'F4 search_path vazio');
select ok(has_function_privilege('authenticated', 'public.card_invoice_categories(uuid, text)', 'execute')
          and not has_function_privilege('anon', 'public.card_invoice_categories(uuid, text)', 'execute'),
          'F5 authenticated executa, anon não');

-- ---- dados ----
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000107a1', 'faturacat1@teste.com'),
  ('00000000-0000-0000-0000-0000000107a2', 'faturacat2@teste.com');
select pg_temp.login('00000000-0000-0000-0000-0000000107a1');
insert into fixture select 'h', public.create_household('Casa das Categorias');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 5000.00, '2026-01-01') returning id)
  insert into fixture select 'bank', id from i;
insert into fixture select 'merc', id from public.categories where household_id = pg_temp.fx('h') and name = 'Mercado' and type = 'expense';
insert into fixture select 'lazer', id from public.categories where household_id = pg_temp.fx('h') and name = 'Lazer' and type = 'expense';
insert into fixture select 'comp', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais' and type = 'expense';
insert into fixture select 'rest', id from public.categories where household_id = pg_temp.fx('h') and name = 'Restaurantes' and type = 'expense';
insert into fixture select 'inc', id from public.categories where household_id = pg_temp.fx('h') and type = 'income' order by name limit 1;
with c as (insert into public.categories (household_id, name, type, parent_id)
           values (pg_temp.fx('h'), 'Feira', 'expense', pg_temp.fx('merc')) returning id)
  insert into fixture select 'feira', id from c;

insert into fixture select 'a', public.create_debt('Cartão de teste', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('a'), 17, 25);
-- fatura de março (fecha 17/03)
select public.card_purchase(pg_temp.fx('a'), '2026-03-01', 120.00, 1, pg_temp.fx('merc'), 'Mercado do mês');
select public.card_purchase(pg_temp.fx('a'), '2026-03-02', 80.50, 1, pg_temp.fx('feira'), 'Feira (subcategoria de Mercado)');
select public.card_purchase(pg_temp.fx('a'), '2026-03-05', 90.00, 3, pg_temp.fx('lazer'), 'Show parcelado');
select public.card_purchase(pg_temp.fx('a'), '2026-03-12', 50.00, 1, pg_temp.fx('comp'), 'Blusa');
insert into fixture select 'rest_plano', public.card_purchase(pg_temp.fx('a'), '2026-03-10', 60.00, 1, pg_temp.fx('rest'), 'Jantar cancelado');
select public.card_purchase(pg_temp.fx('a'), '2026-03-03', 20.00, 1, pg_temp.fx('rest'), 'Café estornado por inteiro');
-- fatura de abril (fecha 17/04): uma compra à vista
select public.card_purchase(pg_temp.fx('a'), '2026-03-20', 40.00, 1, pg_temp.fx('merc'), 'Mercado de abril');
-- compra excluída ANTES de cobrar: nenhuma parcela viva sobra
select public.card_purchase_delete(pg_temp.fx('a'), pg_temp.fx('rest_plano')::text, 'jantar lançado por engano (teste)');
-- crédito avulso (receita) em março: não é categoria de despesa
select public.card_credit_income(pg_temp.fx('a'), '2026-03-10', 25.00, pg_temp.fx('inc'), 'Cashback do mês');
select public.card_bill_due('2026-05-31');
-- estorno parcial de uma compra JÁ cobrada: abate a categoria da compra (Compras pessoais 50 − 20)
insert into fixture select 'blusa', id from public.debt_installments where debt_id = pg_temp.fx('a') and description = 'Blusa';
select public.debt_refund(pg_temp.fx('blusa'), '2026-03-20', 20.00, null);
-- estorno TOTAL de outra compra já cobrada: a categoria zera e some da lista (nada de linha "R$ 0,00")
insert into fixture select 'cafe', id from public.debt_installments where debt_id = pg_temp.fx('a') and description = 'Café estornado por inteiro';
select public.debt_refund(pg_temp.fx('cafe'), '2026-03-20', 20.00, null);

-- ---- C: categorias da fatura de março ----
select is(pg_temp.cats('2026-03'), 'Mercado=200.50/77.0 ; Compras pessoais=30.00/11.5 ; Lazer=30.00/11.5',
          'C1 março: Mercado soma a subcategoria Feira (120 + 80,50); Blusa líquida do estorno (50 − 20); Lazer é 1 parcela de 3; jantar cancelado e café estornado por inteiro fora');
select is((select count(*) from public.card_invoice_categories(pg_temp.fx('a'), '2026-03')), 3::bigint, 'C2 três categorias (a cancelada e o crédito avulso não aparecem)');
select is((select min(total) || '/' || max(total) from public.card_invoice_categories(pg_temp.fx('a'), '2026-03')), '260.50/260.50',
          'C3 total = soma das categorias, igual em todas as linhas (só mostrar no front)');
select is((select category_id from public.card_invoice_categories(pg_temp.fx('a'), '2026-03') limit 1), pg_temp.fx('merc'),
          'C4 a linha é da categoria RAIZ (Mercado), não da Feira');
select is((select count(*) from public.card_invoice_categories(pg_temp.fx('a'), '2026-03') where category_id = pg_temp.fx('feira')), 0::bigint,
          'C5 a subcategoria não aparece separada');
select is((select count(*) from public.card_invoice_categories(pg_temp.fx('a'), '2026-03') where category_id = pg_temp.fx('rest')), 0::bigint,
          'C6 nem a compra cancelada nem a compra estornada por inteiro deixam categoria (Restaurantes)');
select is((select count(*) from public.card_invoice_categories(pg_temp.fx('a'), '2026-03') where category_id = pg_temp.fx('inc')), 0::bigint,
          'C7 o crédito avulso (categoria de receita) não vira despesa');

-- ---- S: a soma bate com card_months ----
select is(pg_temp.soma_cats('2026-03'), pg_temp.m_charged('2026-03') + pg_temp.m_pending('2026-03') + pg_temp.m_credits('2026-03'),
          'S1 março: soma das categorias = cobrado + a cobrar + créditos avulsos de card_months');
select is(pg_temp.soma_cats('2026-03'), pg_temp.m_total('2026-03') + pg_temp.m_credits('2026-03'),
          'S2 março: soma das categorias = total da fatura + créditos avulsos (a fatura mostra o total já abatido)');
select is(pg_temp.m_total('2026-03'), 235.50::numeric, 'S3 a fatura de março mostra 235,50 (260,50 − 25 de crédito avulso)');
select is(pg_temp.cats('2026-04'), 'Mercado=40.00/57.1 ; Lazer=30.00/42.9', 'S4 abril: Mercado 40 e a 2ª parcela do show, com percentuais do banco');
select is(pg_temp.soma_cats('2026-04'), pg_temp.m_total('2026-04'), 'S5 abril: sem crédito avulso, soma das categorias = total de card_months');
select is(pg_temp.cats('2026-05'), 'Lazer=30.00/100.0', 'S6 maio: só a 3ª parcela do show, 100%');
select is(pg_temp.soma_cats('2026-05'), pg_temp.m_total('2026-05'), 'S7 maio: soma = total de card_months');
select is((select bool_and(pg_temp.soma_cats(m.label) = m.charged + m.pending + m.credits) from public.card_months(pg_temp.fx('a')) m), true,
          'S8 em TODAS as faturas do cartão: soma das categorias = cobrado + a cobrar + créditos avulsos');

-- parcela ainda NÃO cobrada (a cobrar) também entra, como em card_months.pending (compra de 25/03: abril e maio, sem cobrança)
select public.card_purchase(pg_temp.fx('a'), '2026-03-25', 100.00, 2, pg_temp.fx('comp'), 'Sapato 2x');
select ok(pg_temp.m_pending('2026-05') > 0, 'S9 maio tem parcela a cobrar (o sapato) além da cobrada (o show)');
select is(pg_temp.cats('2026-05'), 'Compras pessoais=50.00/62.5 ; Lazer=30.00/37.5', 'S10 maio: a parcela a cobrar entra com a cobrada, percentuais do banco');
select is(pg_temp.soma_cats('2026-05'), pg_temp.m_pending('2026-05') + pg_temp.m_charged('2026-05'),
          'S11 maio: soma = cobrado + a cobrar de card_months');

-- ---- P: fatura paga continua consultável ----
select public.debt_pay(pg_temp.fx('a'), '2026-03-25', pg_temp.fx('bank'), 235.50, pg_temp.fat(pg_temp.fx('a'), '2026-03'));
select is(pg_temp.m_paid('2026-03'), 235.50::numeric, 'P1 março foi paga por inteiro');
select is(pg_temp.cats('2026-03'), 'Mercado=200.50/77.0 ; Compras pessoais=30.00/11.5 ; Lazer=30.00/11.5', 'P2 fatura paga/travada continua mostrando as categorias');

-- ---- V: vazio ----
select is((select count(*) from public.card_invoice_categories(pg_temp.fx('a'), '2031-01')), 0::bigint, 'V1 fatura inexistente: vazio');
select is((select count(*) from public.card_invoice_categories(pg_temp.fx('a'), 'março')), 0::bigint, 'V2 rótulo fora do formato: vazio');
select is((select count(*) from public.card_invoice_categories(pg_temp.fx('a'), null)), 0::bigint, 'V3 rótulo nulo: vazio');
select is((select count(*) from public.card_invoice_categories(gen_random_uuid(), '2026-03')), 0::bigint, 'V4 cartão inexistente: vazio');
insert into fixture select 'emp', public.create_debt('Empréstimo', 'loan', '2026-01-01', 100);
select is((select count(*) from public.card_invoice_categories(pg_temp.fx('emp'), '2026-03')), 0::bigint, 'V5 dívida que não é cartão: vazio');

-- ---- I: isolamento ----
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000107a2');
insert into fixture select 'h2', public.create_household('Casa Vizinha');
select is((select count(*) from public.card_invoice_categories(pg_temp.fx('a'), '2026-03')), 0::bigint, 'I1 outra família não lê as categorias do cartão alheio');
reset role;
select set_config('request.jwt.claims', '', true);
select set_config('role', 'anon', true);
select is(pg_temp.sqlstate_of(format($$select * from public.card_invoice_categories(%L, '2026-03')$$, pg_temp.fx('a'))), '42501',
          'I2 sem login (anon): sem permissão para executar');
select * from finish();
rollback;
