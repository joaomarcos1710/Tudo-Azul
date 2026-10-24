-- 14_dashboard_reports: migration 008. Despesas por categoria (raiz) e por dia, com a mesma
-- definição do period_summary: lançamentos + cobranças de cartão − estornos + juros/tarifas.
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
grant execute on function pg_temp.fx(text) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000014a1', 'dr1@teste.com'),
  ('00000000-0000-0000-0000-0000000014a2', 'dr2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000014a1');
insert into fixture select 'h', public.create_household('Casa Painel');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 5000, '2026-03-01') returning id)
  insert into fixture select 'bank', id from i;
-- categoria-mãe e filha próprias, para testar o agrupamento pela raiz
with i as (insert into public.categories (household_id, name, type) values (pg_temp.fx('h'), 'Casa', 'expense') returning id)
  insert into fixture select 'casa', id from i;
with i as (insert into public.categories (household_id, name, type, parent_id) values (pg_temp.fx('h'), 'Luz', 'expense', pg_temp.fx('casa')) returning id)
  insert into fixture select 'luz', id from i;
insert into fixture select 'comp', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';

insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status) values
  (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('casa'), 'expense', 'Aluguel', 1000.00, '2026-03-05', 'paid'),
  (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('luz'),  'expense', 'Luz', 180.40, '2026-03-10', 'paid'),
  (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('luz'),  'expense', 'Planejado', 99.00, '2026-03-11', 'planned'),
  (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('comp'), 'expense', 'Fora do mês', 50.00, '2026-04-01', 'paid');
-- cartão: compra de 300 em 1x cobrada no fechamento (17/03), estorno parcial de 30
insert into fixture select 'card', public.create_debt('Nubank', 'card', '2026-03-01', 0);
select public.set_card_cycle(pg_temp.fx('card'), 17, 25);
select public.card_purchase(pg_temp.fx('card'), '2026-03-12', 300.00, 1, pg_temp.fx('comp'), 'Tênis');
select public.card_bill_due('2026-03-31');
select public.debt_refund((select id from public.debt_installments where debt_id = pg_temp.fx('card')), '2026-03-20', 30.00);

-- D1: por categoria raiz, maior primeiro, com %
select is((select array_agg(name || '|' || amount || '|' || share order by amount desc)
             from public.expenses_by_category(pg_temp.fx('h'), '2026-03-01', '2026-03-31')),
          array['Casa|1180.40|81.4', 'Compras pessoais|270.00|18.6'],
          'D1 Casa (aluguel + luz da subcategoria) e Compras (cartão 300 − estorno 30); planejado e outro mês fora');

-- D1b: top 1 junta o resto em "Outros"
select is((select array_agg(name || '|' || amount || '|' || share)
             from public.expenses_by_category(pg_temp.fx('h'), '2026-03-01', '2026-03-31', 1)),
          array['Casa|1180.40|81.4', 'Outros|270.00|18.6'], 'D1b top 1: Casa e Outros, na ordem');
select is((select category_id from public.expenses_by_category(pg_temp.fx('h'), '2026-03-01', '2026-03-31', 1) where name = 'Outros'),
          null::uuid, 'D1b Outros sem categoria');

-- D2: soma por categoria = soma por dia = period_summary.expense_paid
select is((select sum(amount) from public.expenses_by_category(pg_temp.fx('h'), '2026-03-01', '2026-03-31')),
          (select expense_paid from public.period_summary(pg_temp.fx('h'), '2026-03-01', '2026-03-31')),
          'D2 total por categoria = period_summary');
select is((select cumulative from public.daily_expenses(pg_temp.fx('h'), '2026-03-01', '2026-03-31') where day = '2026-03-31'),
          (select expense_paid from public.period_summary(pg_temp.fx('h'), '2026-03-01', '2026-03-31')),
          'D2 acumulado do último dia = period_summary');

-- D3: um dia por linha, com zero nos dias sem despesa
select is((select count(*) from public.daily_expenses(pg_temp.fx('h'), '2026-03-01', '2026-03-31')), 31::bigint, 'D3 31 dias');
select is((select array[amount, cumulative] from public.daily_expenses(pg_temp.fx('h'), '2026-03-01', '2026-03-31') where day = '2026-03-17'),
          array[300.00, 1480.40]::numeric[], 'D3 dia 17: cobrança da fatura; acumulado');
select is((select array[amount, cumulative] from public.daily_expenses(pg_temp.fx('h'), '2026-03-01', '2026-03-31') where day = '2026-03-20'),
          array[-30.00, 1450.40]::numeric[], 'D3 dia 20: estorno abate');
select is((select amount from public.daily_expenses(pg_temp.fx('h'), '2026-03-01', '2026-03-31') where day = '2026-03-02'),
          0::numeric, 'D3 dia sem despesa = 0');

-- D4: outra família não vê nada
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000014a2');
select public.create_household('Outra');
select is((select count(*) from public.expenses_by_category(pg_temp.fx('h'), '2026-03-01', '2026-03-31')), 0::bigint, 'D4 categorias: nada');
select is((select count(*) from public.daily_expenses(pg_temp.fx('h'), '2026-03-01', '2026-03-31')), 0::bigint, 'D4 dias: nada');

select * from finish();
rollback;
