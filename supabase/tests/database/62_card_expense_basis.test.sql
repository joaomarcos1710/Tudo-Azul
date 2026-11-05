-- 62_card_expense_basis: migration 062. Base dos gastos de cartão no relatório POR CATEGORIA
-- (expenses_by_category_basis): 'invoice' (fechamento da fatura, a de sempre), 'purchase' (compra inteira na data da
-- compra) e 'installment' (parcela n no mês da compra + n − 1). Totais do mês e orçamento seguem pela fatura.
-- Datas fixas no passado (2025/2026): todas as faturas já fecharam, o teste não depende do dia em que roda.
-- A função nova vai por SQL dinâmico: sem a migration as asserções falham sem abortar o arquivo.
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
  ('00000000-0000-0000-0000-0000000062a1', 'b1@teste.com'),
  ('00000000-0000-0000-0000-0000000062a2', 'b2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000062a1');
insert into fixture select 'h', public.create_household('Casa da Base');
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
select pg_temp.login('00000000-0000-0000-0000-0000000062a1');

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

-- ---------------------------------------------------------------------------
-- 1. Compra de 1.200,00 em 10x (Compras pessoais)
-- ---------------------------------------------------------------------------
select is(pg_temp.serie('invoice', '2025-07', 12, 'A'),
          array[0, 120, 120, 120, 120, 120, 120, 120, 120, 120, 120, 0]::numeric[],
          'B1 fatura: 120,00 por mês de agosto/2025 (1º fechamento) a maio/2026; nada em julho nem em junho');
select is(pg_temp.serie('purchase', '2025-07', 12, 'A'),
          array[1200, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]::numeric[],
          'B2 compra: os 1.200,00 inteiros em julho/2025 (data da compra), nada nos meses das faturas');
select is(pg_temp.serie('installment', '2025-07', 12, 'A'),
          array[120, 120, 120, 120, 120, 120, 120, 120, 120, 120, 0, 0]::numeric[],
          'B3 parcela: 120,00 de julho/2025 a abril/2026 (compra + n − 1 meses), sem olhar o fechamento');
select is(pg_temp.rel(pg_temp.fx('h'), '2025-07-01', '2026-06-30', b), array['Compras pessoais|1200.00|82.2', 'Lazer|150.00|10.3', 'Mercado|80.00|5.5', 'Assinaturas|30.00|2.1'],
          format('B4 base %s: no ano inteiro as três bases somam o mesmo (1.200 + 150 + 80 + 30)', b))
  from unnest(array['invoice', 'purchase', 'installment']) b;

-- ---------------------------------------------------------------------------
-- 2. Estorno parcial ('credit' 50) e cancelamento ('cancel' 100) — compra 2 (Lazer, 3x de 100)
-- ---------------------------------------------------------------------------
select is(pg_temp.serie('invoice', '2025-09', 3, 'B'), array[100, 50, 0]::numeric[],
          'E1 fatura: set 100; out 100 − estorno 50 (na data do estorno); nov nada (parcela cancelada não é cobrada)');
select is(pg_temp.serie('purchase', '2025-09', 3, 'B'), array[150, 0, 0]::numeric[],
          'E2 compra: 150,00 líquidos (300 − 50 estornado − 100 cancelado) em setembro; o estorno não cai em outubro');
select is(pg_temp.serie('installment', '2025-09', 3, 'B'), array[50, 100, 0]::numeric[],
          'E3 parcela: 1ª líquida 50 em set, 2ª 100 em out, 3ª cancelada não aparece');
select is((select count(*) from unnest(pg_temp.rel(pg_temp.fx('h'), '2025-11-01', '2025-11-30', 'purchase')) r where r like 'Lazer|%'), 0::bigint,
          'E4 categoria que zera no mês (cobrança tirada, valor posto em outro mês) não aparece com R$ 0,00');

-- compra excluída (card_purchase_delete anula cobranças e cancela o resto): some das três bases
select public.card_purchase(pg_temp.fx('card'), '2025-07-05', 90.00, 3, pg_temp.fx('A'), 'Cadeira');
select public.card_bill_due('2026-06-30');
select public.card_purchase_delete(pg_temp.fx('card'), (select plan from public.debt_installments where debt_id = pg_temp.fx('card') and description = 'Cadeira' limit 1));
select is(pg_temp.cat(b, '2025-07', 'A'), case b when 'purchase' then 1200.00 when 'installment' then 120.00 else 0.00 end,
          format('E5 base %s: compra excluída (anulada) fica de fora', b))
  from unnest(array['invoice', 'purchase', 'installment']) b;

-- ---------------------------------------------------------------------------
-- 3. Fora do cartão e assinatura: iguais nas três bases
-- ---------------------------------------------------------------------------
select is(pg_temp.cat(b, '2025-07', 'C'), 80.00::numeric,
          format('F1 base %s: lançamento fora do cartão no mês dele (só reais; dólar e lixeira fora)', b))
  from unnest(array['invoice', 'purchase', 'installment']) b;
select is(array[pg_temp.cat(b, '2025-07', 'D'), pg_temp.cat(b, '2025-08', 'D')], array[0, 30]::numeric[],
          format('F2 base %s: assinatura de cartão na fatura (agosto), nunca na data da ocorrência', b))
  from unnest(array['invoice', 'purchase', 'installment']) b;

-- base 'invoice' = expenses_by_category (a de sempre), com e sem p_top
select is(pg_temp.rel(pg_temp.fx('h'), '2025-07-01', '2025-12-31', 'invoice'),
          (select array_agg(coalesce(name, '?') || '|' || amount::numeric(14,2) || '|' || share)
             from public.expenses_by_category(pg_temp.fx('h'), '2025-07-01', '2025-12-31')),
          'I1 base invoice devolve o mesmo que expenses_by_category');
select is(pg_temp.rel(pg_temp.fx('h'), '2025-07-01', '2025-12-31', 'invoice', 1),
          (select array_agg(coalesce(name, '?') || '|' || amount::numeric(14,2) || '|' || share)
             from public.expenses_by_category(pg_temp.fx('h'), '2025-07-01', '2025-12-31', 1)),
          'I2 com p_top a base invoice também bate (mesmo "Outros")');
select is(pg_temp.rel(pg_temp.fx('h'), '2025-07-01', '2025-07-31', 'purchase', 1), array['Compras pessoais|1200.00|93.8', 'Outros|80.00|6.3'],
          'I3 p_top na base compra: a maior + "Outros" (somado no banco)');

-- ---------------------------------------------------------------------------
-- 4. Parâmetro inválido, isolamento e funções pela fatura que não mudam
-- ---------------------------------------------------------------------------
select is(pg_temp.sqlstate_of(format($$select * from public.expenses_by_category_basis(%L, '2025-07-01', '2025-07-31', 'due')$$, pg_temp.fx('h'))),
          '22023', 'P1 base desconhecida: recusada (22023)');
select is(pg_temp.sqlstate_of(format($$select * from public.expenses_by_category_basis(%L, '2025-07-01', '2025-07-31', null)$$, pg_temp.fx('h'))),
          '22023', 'P2 base nula: recusada (22023)');

-- totais do mês e orçamento seguem a fatura: julho tem só o Mercado; agosto, as cobranças
select is((select expense_paid::numeric(14,2) from public.period_summary(pg_temp.fx('h'), '2025-07-01', '2025-07-31')), 80.00::numeric,
          'T1 period_summary de julho/2025: só os 80,00 fora do cartão (a compra de julho não entra)');
select is((select expense_paid::numeric(14,2) from public.period_summary(pg_temp.fx('h'), '2025-08-01', '2025-08-31')), 150.00::numeric,
          'T2 period_summary de agosto/2025: 120 (TV) + 30 (assinatura), pela fatura');
select is((select spent::numeric(14,2) from public.budget_usage(pg_temp.fx('h'), '2025-07-01') where category_id = pg_temp.fx('A')), 0.00::numeric,
          'T3 orçamento de julho/2025 em Compras pessoais: nada gasto (a compra conta na fatura de agosto)');
select is((select sum(amount)::numeric(14,2) from public.expenses_by_category(pg_temp.fx('h'), '2025-07-01', '2025-07-31')), 80.00::numeric,
          'T4 expenses_by_category (sem base) não muda: julho só com o Mercado');

-- outra família não vê nada, nem com base válida
select pg_temp.login('00000000-0000-0000-0000-0000000062a2');
select public.create_household('Outra casa');
select is(pg_temp.rel(pg_temp.fx('h'), '2025-07-01', '2026-06-30', b), '{}'::text[],
          format('S1 base %s: outra família recebe zero linhas', b))
  from unnest(array['invoice', 'purchase', 'installment']) b;

select * from finish();
rollback;
