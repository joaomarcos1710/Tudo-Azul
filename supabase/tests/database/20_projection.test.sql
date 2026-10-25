-- 20_projection: migration 013. Projeção do mês e por orçamento: já gasto + já previsto + ritmo do variável × dias que faltam.
-- Datas fixas (hoje = 10/10/2026 passado como parâmetro): o teste não depende do dia em que roda.
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
create function pg_temp.mp(p_month date, p_today date) returns text language sql as $f$
  select days_in_month || '|' || days_elapsed || '|' || days_left || '|' || spent::numeric(14,2) || '|' || planned::numeric(14,2) || '|'
         || variable_so_far::numeric(14,2) || '|' || pace_extra::numeric(14,2) || '|' || projected::numeric(14,2)
    from public.month_projection(pg_temp.fx('h'), p_month, p_today) $f$;
create function pg_temp.bp(p_cat uuid, p_month date, p_today date) returns text language sql as $f$
  select amount_limit::numeric(14,2) || '|' || spent::numeric(14,2) || '|' || planned::numeric(14,2) || '|' || pace_extra::numeric(14,2)
         || '|' || projected::numeric(14,2) || '|' || remaining::numeric(14,2)
    from public.budget_projection(pg_temp.fx('h'), p_month, p_today) where category_id = p_cat $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.mp(date, date), pg_temp.bp(uuid, date, date) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000020a1', 'p1@teste.com'),
  ('00000000-0000-0000-0000-0000000020a2', 'p2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000020a1');
insert into fixture select 'h', public.create_household('Casa Projeção');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 0, '2026-10-01') returning id)
  insert into fixture select 'bank', id from i;
insert into fixture select 'mercado', id from public.categories where household_id = pg_temp.fx('h') and name = 'Mercado';
with c as (insert into public.categories (household_id, name, type, parent_id) values (pg_temp.fx('h'), 'Feira', 'expense', pg_temp.fx('mercado')) returning id)
  insert into fixture select 'feira', id from c;
insert into fixture select 'moradia', id from public.categories where household_id = pg_temp.fx('h') and name = 'Moradia';
insert into fixture select 'compras', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';

-- uma regra recorrente (inserida direto: o teste não quer gerar ocorrências pela data real de hoje)
reset role;
insert into public.recurrences (id, household_id, kind, description, amount, day, start_date, account_id, category_id)
values ('00000000-0000-0000-0000-00000000fe01', pg_temp.fx('h'), 'expense', 'Aluguel', 1000.00, 1, '2026-10-01', pg_temp.fx('bank'), pg_temp.fx('moradia'));
-- o aluguel pago veio da recorrência (o cliente não grava recurrence_id; quem gera é o banco)
insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status, recurrence_id, occurrence_date) values
  (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('moradia'), 'expense', 'Aluguel',  1000.00, '2026-10-01', 'paid', '00000000-0000-0000-0000-00000000fe01', '2026-10-01');
select pg_temp.login('00000000-0000-0000-0000-0000000020a1');
insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status) values
  (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('mercado'), 'expense', 'Mercado',      200.00, '2026-10-05', 'paid'),
  (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('feira'),   'expense', 'Feira',        100.00, '2026-10-08', 'paid'),
  (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('mercado'), 'expense', 'Previsto fim', 150.00, '2026-10-20', 'planned'),
  (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('mercado'), 'expense', 'Atrasado',      50.00, '2026-10-03', 'planned'),
  (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('mercado'), 'expense', 'Excluído',     999.00, '2026-10-22', 'planned');
update public.transactions set deleted_at = now() where description = 'Excluído';

-- cartão com compra de 100,00 em 2x em 05/10 (fecha dia 25): parcelas de 50,00 em 25/10 e 25/11, ainda sem cobrança
insert into fixture select 'card', public.create_debt('Cartão', 'card', '2026-10-01', 0);
select public.set_card_cycle(pg_temp.fx('card'), 25, 5);
select public.card_purchase(pg_temp.fx('card'), '2026-10-05', 100.00, 2, pg_temp.fx('compras'), 'Compra cartão');

insert into public.budgets (household_id, category_id, month, amount_limit) values
  (pg_temp.fx('h'), pg_temp.fx('mercado'), '2026-10-01', 1000.00),
  (pg_temp.fx('h'), pg_temp.fx('compras'), '2026-10-01', 300.00);

-- mês: gasto 1.300 (aluguel 1.000 + mercado 200 + feira 100); previsto 250 (150 + 50 atrasado + parcela de 50 do cartão);
-- variável pago 300 (o aluguel recorrente fica fora) em 10 dias = 30/dia; faltam 21 dias = 630; projetado 1.300 + 250 + 630 = 2.180
select is(pg_temp.mp('2026-10-01', '2026-10-10'), '31|10|21|1300.00|250.00|300.00|630.00|2180.00',
          'PJ1 projeção do mês: gasto + previsto + ritmo do variável (recorrente fora do ritmo, excluído fora de tudo)');
select is((select pace_per_day::numeric(14,2) from public.month_projection(pg_temp.fx('h'), '2026-10-01', '2026-10-10')), 30.00::numeric,
          'PJ2 ritmo diário do variável: 300,00 em 10 dias = 30,00');
select is((select spent from public.month_projection(pg_temp.fx('h'), '2026-10-01', '2026-10-10')),
          (select expense_paid from public.period_summary(pg_temp.fx('h'), '2026-10-01', '2026-10-31')),
          'PJ3 "já gasto" é exatamente o expense_paid de period_summary');
select is((select planned from public.month_projection(pg_temp.fx('h'), '2026-10-01', '2026-10-10')),
          (select expense_planned from public.period_summary(pg_temp.fx('h'), '2026-10-01', '2026-10-31')),
          'PJ4 "já previsto" é exatamente o expense_planned de period_summary');

-- mês passado visto de novembro: sem ritmo (não faltam dias); o previsto que ficou sem pagar continua
select is(pg_temp.mp('2026-10-01', '2026-11-15'), '31|31|0|1300.00|250.00|300.00|0.00|1550.00',
          'PJ5 mês que já acabou: sem extrapolar (ritmo zero)');
-- mês futuro: nada gasto, só o previsto (a 2ª parcela do cartão cai em novembro)
select is(pg_temp.mp('2026-11-01', '2026-10-10'), '30|0|30|0.00|50.00|0.00|0.00|50.00',
          'PJ6 mês futuro: só o previsto, sem ritmo');
-- primeiro dia do mês, nada gasto: não divide por zero
select is(pg_temp.mp('2026-12-01', '2026-12-01'), '31|1|30|0.00|0.00|0.00|0.00|0.00', 'PJ7 dia 1 sem gasto: projeção zero');
select is(pg_temp.mp('2026-02-01', '2026-02-10'), '28|10|18|0.00|0.00|0.00|0.00|0.00', 'PJ8 fevereiro tem 28 dias');

-- por orçamento: Mercado (raiz soma Feira): gasto 300, previsto 200 (150 + 50), ritmo 300/10×21 = 630, projetado 1.130 (limite 1.000)
select is(pg_temp.bp(pg_temp.fx('mercado'), '2026-10-01', '2026-10-10'), '1000.00|300.00|200.00|630.00|1130.00|-130.00',
          'PB1 orçamento Mercado estoura na projeção: sobra negativa de 130,00');
select is((select spent from public.budget_projection(pg_temp.fx('h'), '2026-10-01', '2026-10-10') where category_id = pg_temp.fx('mercado')),
          (select spent from public.budget_usage(pg_temp.fx('h'), '2026-10-01') where category_id = pg_temp.fx('mercado')),
          'PB2 o gasto é exatamente o de budget_usage (mesma fonte da tela de Orçamentos)');
-- orçamento no cartão: parcela de 50,00 prevista, sem ritmo (nada pago em Compras pessoais)
select is(pg_temp.bp(pg_temp.fx('compras'), '2026-10-01', '2026-10-10'), '300.00|0.00|50.00|0.00|50.00|250.00',
          'PB3 orçamento de categoria só com cartão: a parcela futura entra no previsto');
select is((select count(*) from public.budget_projection(pg_temp.fx('h'), '2026-11-01', '2026-10-10')), 0::bigint,
          'PB4 mês sem orçamento definido: nenhuma linha');

-- isolamento entre famílias
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000020a2');
insert into fixture select 'h2', public.create_household('Casa Alheia');
select is((select count(*) from public.month_projection(pg_temp.fx('h'), '2026-10-01', '2026-10-10')), 0::bigint, 'PJ9 outra família não lê a minha projeção do mês');
select is((select count(*) from public.budget_projection(pg_temp.fx('h'), '2026-10-01', '2026-10-10')), 0::bigint, 'PJ10 outra família não lê a minha projeção por orçamento');
reset role;

select * from finish();
rollback;
