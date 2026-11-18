-- 135: "Já foi cobrada" (migration 20261118100000): vira UMA cobrança agendada em compra na data em que ela de fato aconteceu.
-- Falha sem a migration (a função não existe). Datas relativas a hoje em São Paulo. A função roda por SQL dinâmico para as
-- asserções falharem sem abortar o arquivo.
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
create function pg_temp.hoje() returns date language sql stable as $f$ select (now() at time zone 'America/Sao_Paulo')::date $f$;
create function pg_temp.item(p_rule text, p_occ date) returns uuid language sql as $f$
  select id from public.card_scheduled_items where recurrence_id = pg_temp.fx(p_rule) and occurrence_date = p_occ $f$;
-- cobra o item na data dada; devolve o id da compra ou 'ERRO <sqlstate>'
create function pg_temp.cobrou(p_item uuid, p_data date) returns text language plpgsql as $f$
declare v text;
begin
  execute format('select public.card_scheduled_charged(%L, %L)::text', p_item, p_data) into v;
  return v;
exception when others then return 'ERRO ' || sqlstate;
end $f$;
-- situação "total|pago" da fatura do rótulo AAAA-MM
create function pg_temp.sit(p_card uuid, p_label text) returns text language sql as $f$
  select total::numeric(14,2) || '|' || paid::numeric(14,2) from public.card_months(p_card) where label = p_label $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.sqlstate_of(text), pg_temp.hoje(), pg_temp.item(text, date),
  pg_temp.cobrou(uuid, date), pg_temp.sit(uuid, text) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000135a1', 'c1@teste135.com'),
  ('00000000-0000-0000-0000-0000000135a2', 'c2@teste135.com');

select pg_temp.login('00000000-0000-0000-0000-0000000135a1');
insert into fixture select 'h', public.create_household('Casa da Cobrança');
insert into fixture select 'cat', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';
insert into fixture select 'a', public.create_debt('Cartão A', 'card', '2026-01-01', 0);
-- fechou há 5 dias: a fatura aberta fecha em ~25 dias e as seguintes depois
select public.set_card_cycle(pg_temp.fx('a'), least(28, extract(day from pg_temp.hoje() - 5)::int),
  case when least(28, extract(day from pg_temp.hoje() - 5)::int) = 28 then 27 else 28 end);
-- semanal, começando daqui a 10 dias: várias ocorrências futuras (o Meli+ do dono estava agendado para 24/11 e cobrou em 17/11)
insert into fixture select 'r', public.recurrence_create('card', 'Meli+', 39.90, null, pg_temp.hoje() + 10, null, null, pg_temp.fx('a'), pg_temp.fx('cat'), null, 'week', 1);
select public.card_scheduled_sync();
select cmp_ok((select count(*) from public.card_scheduled_items where recurrence_id = pg_temp.fx('r') and status = 'scheduled'), '>', 10::bigint,
  'CH0 há várias cobranças agendadas (cenário válido)');

-- ---------------------------------------------------------------------------
-- 1. Cobrou hoje, antes do dia agendado
-- ---------------------------------------------------------------------------
select isnt(pg_temp.cobrou(pg_temp.item('r', pg_temp.hoje() + 10), pg_temp.hoje()), null, 'CH1 já foi cobrada hoje: devolve o id da compra');
select is((select status from public.card_scheduled_items where id = pg_temp.item('r', pg_temp.hoje() + 10)), 'converted', 'CH2 o item vira convertido');
select isnt((select installment_id from public.card_scheduled_items where id = pg_temp.item('r', pg_temp.hoje() + 10)), null, 'CH3 e guarda o id da compra');
select is((select charge_date from public.card_scheduled_items where id = pg_temp.item('r', pg_temp.hoje() + 10)), pg_temp.hoje(), 'CH4 a data de cobrança do item passa a ser a real');
select is(
  (select row(i.face, i.purchase_date, i.description, i.category_id, i.recurrence_id, i.occurrence_date)::text
     from public.debt_installments i where i.id = (select installment_id from public.card_scheduled_items where id = pg_temp.item('r', pg_temp.hoje() + 10))),
  row(39.90::numeric, pg_temp.hoje(), 'Meli+'::text, pg_temp.fx('cat'), pg_temp.fx('r'), pg_temp.hoje() + 10)::text,
  'CH5 a compra tem o valor, a descrição e a categoria da assinatura, a data real e o par da regra (recurrence_id, occurrence_date)');
select is((select due_date from public.debt_installments where recurrence_id = pg_temp.fx('r') and occurrence_date = pg_temp.hoje() + 10),
  (select closing_date from public.card_scheduled_items where id = pg_temp.item('r', pg_temp.hoje() + 10)),
  'CH6 a compra entra na fatura do ciclo da data real (a mesma do item)');
select is((select closing_date from public.card_scheduled_items where id = pg_temp.item('r', pg_temp.hoje() + 10)),
  (select min(c.d) from (select (date_trunc('month', pg_temp.hoje()) + make_interval(months => m) + make_interval(days => (v.cd - 1)))::date as d
                           from generate_series(0, 2) m, (select closing_day as cd from public.debts where id = pg_temp.fx('a')) v) c
    where c.d >= pg_temp.hoje()),
  'CH7 a fatura é a do primeiro fechamento a partir da data real (como numa compra comum)');

-- a fatura passa a valer 39,90 UMA vez (a compra nova; o item agendado não soma junto)
select is((select total from public.card_months(pg_temp.fx('a')) where closing_date = (select due_date from public.debt_installments where recurrence_id = pg_temp.fx('r') and occurrence_date = pg_temp.hoje() + 10)),
  39.90::numeric, 'CH6b o total da fatura da compra é 39,90 (uma vez só: a compra nova, sem somar o item agendado)');

-- nada é contado duas vezes
select is((select count(*) from public.debt_installments where recurrence_id = pg_temp.fx('r') and occurrence_date = pg_temp.hoje() + 10), 1::bigint,
  'CH8 uma compra só para a ocorrência');
select is(public.card_scheduled_sync(), 0, 'CH9 o sync não recria a cobrança que virou compra');
select is((select count(*) from public.card_scheduled_items where recurrence_id = pg_temp.fx('r') and occurrence_date = pg_temp.hoje() + 10), 1::bigint,
  'CH10 continua uma só linha de agendamento para essa data');
select is((select count(*) from public.card_subscription_previews(pg_temp.fx('a'),
  (select to_char(closing_date, 'YYYY-MM') from public.card_scheduled_items where id = pg_temp.item('r', pg_temp.hoje() + 10)))
  where item_id = pg_temp.item('r', pg_temp.hoje() + 10)), 0::bigint, 'CH11 sai da lista de assinaturas previstas da fatura');
select is((select status from public.card_scheduled_items where id = pg_temp.item('r', pg_temp.hoje() + 17)), 'scheduled',
  'CH12 as outras cobranças da assinatura seguem agendadas');

-- ---------------------------------------------------------------------------
-- 2. Cobrou alguns dias antes
-- ---------------------------------------------------------------------------
select isnt(pg_temp.cobrou(pg_temp.item('r', pg_temp.hoje() + 17), pg_temp.hoje() - 3), null, 'CH13 cobrança de 3 dias atrás também vira compra');
select is((select purchase_date from public.debt_installments where recurrence_id = pg_temp.fx('r') and occurrence_date = pg_temp.hoje() + 17),
  pg_temp.hoje() - 3, 'CH14 com a data que foi informada');

-- ---------------------------------------------------------------------------
-- 3. Recusas
-- ---------------------------------------------------------------------------
select is(pg_temp.cobrou(pg_temp.item('r', pg_temp.hoje() + 24), pg_temp.hoje() + 1), 'ERRO 22023', 'CH15 data futura é recusada (para o futuro, edita-se a cobrança)');
select is(pg_temp.cobrou(pg_temp.item('r', pg_temp.hoje() + 24), null), 'ERRO 22023', 'CH16 sem data é recusada');
select is(pg_temp.cobrou(pg_temp.item('r', pg_temp.hoje() + 24), date '2025-06-01'), 'ERRO 23514', 'CH17 antes do início do cartão é recusada');
select is((select status from public.card_scheduled_items where id = pg_temp.item('r', pg_temp.hoje() + 24)), 'scheduled', 'CH18 pedido recusado não mexe no item');
select is(pg_temp.cobrou(pg_temp.item('r', pg_temp.hoje() + 10), pg_temp.hoje()), 'ERRO 55000', 'CH19 cobrança que já virou compra não vira de novo');
select lives_ok(format($q$select public.card_scheduled_item_cancel(%L)$q$, pg_temp.item('r', pg_temp.hoje() + 24)), 'CH20 cancela uma cobrança');
select is(pg_temp.cobrou(pg_temp.item('r', pg_temp.hoje() + 24), pg_temp.hoje()), 'ERRO 55000', 'CH21 cobrança cancelada não vira compra');
select is((select count(*) from public.debt_installments where recurrence_id = pg_temp.fx('r')), 2::bigint, 'CH22 só as duas compras de antes: nenhuma recusa criou compra');

-- ---------------------------------------------------------------------------
-- 4. Cobrou há 10 dias, quando o ciclo já fechou (fatura fechada e ainda não paga)
-- ---------------------------------------------------------------------------
select isnt(pg_temp.cobrou(pg_temp.item('r', pg_temp.hoje() + 38), pg_temp.hoje() - 10), null, 'CH23 cobrança de 10 dias atrás (fatura já fechada, não paga) vira compra');
select ok((select i.due_date >= i.purchase_date and i.due_date <= pg_temp.hoje() and extract(day from i.due_date) = i.closing_day
             from public.debt_installments i where i.recurrence_id = pg_temp.fx('r') and i.occurrence_date = pg_temp.hoje() + 38),
  'CH24 entra na fatura que fechou há 5 dias: o fechamento é o primeiro a partir da data, já passou, e cai no dia de fechamento do cartão');
select cmp_ok((select total from public.card_months(pg_temp.fx('a')) where closing_date = (select due_date from public.debt_installments where recurrence_id = pg_temp.fx('r') and occurrence_date = pg_temp.hoje() + 38)),
  '>=', 39.90::numeric, 'CH25 a fatura fechada ganha os 39,90');

-- ---------------------------------------------------------------------------
-- 5. Fatura FECHADA e PAGA fica travada (064): a data não pode cair nela (achado do revisor-dinheiro)
-- ---------------------------------------------------------------------------
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 5000.00, '2026-01-01') returning id)
  insert into fixture select 'bank', id from i;
insert into fixture select 'b', public.create_debt('Cartão B', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('b'), 17, 25);
select public.card_purchase(pg_temp.fx('b'), '2026-03-01', 100.00, 1, pg_temp.fx('cat'), 'Base');
select public.card_bill_due('2026-05-31');
select public.debt_pay(pg_temp.fx('b'), '2026-03-25', pg_temp.fx('bank'), 100.00, (select id from public.debt_invoices where debt_id = pg_temp.fx('b') and label = '2026-03'));
select is(pg_temp.sit(pg_temp.fx('b'), '2026-03'), '100.00|100.00', 'CH26 cenário: fatura de março do cartão B fechada e paga (100,00 | 100,00)');
insert into fixture select 'rb', public.recurrence_create('card', 'Assinatura B', 39.90, null, pg_temp.hoje() + 10, null, null, pg_temp.fx('b'), pg_temp.fx('cat'), null, 'week', 1);
select public.card_scheduled_sync();
insert into fixture select 'item_b', pg_temp.item('rb', pg_temp.hoje() + 10);
select is(pg_temp.cobrou(pg_temp.fx('item_b'), date '2026-03-10'), 'ERRO 55000', 'CH27 data dentro de fatura paga e travada é recusada (55000)');
select is(pg_temp.sit(pg_temp.fx('b'), '2026-03'), '100.00|100.00', 'CH28 a fatura paga não mudou');
select is((select status from public.card_scheduled_items where id = pg_temp.fx('item_b')), 'scheduled', 'CH29 o item continua agendado');
select is((select count(*) from public.debt_installments where recurrence_id = pg_temp.fx('rb')), 0::bigint, 'CH30 nenhuma compra foi criada');
select isnt(pg_temp.cobrou(pg_temp.fx('item_b'), pg_temp.hoje()), null, 'CH31 a data de hoje (fatura aberta) continua valendo no mesmo cartão');

-- ---------------------------------------------------------------------------
-- 6. Devolução em dinheiro já lançada (a mesma guarda de card_purchase_at)
-- ---------------------------------------------------------------------------
insert into fixture select 'c', public.create_debt('Cartão C', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('c'), 17, 25);
insert into fixture select 'pc', public.card_purchase(pg_temp.fx('c'), '2026-04-02', 100.00, 1, pg_temp.fx('cat'), 'Compra devolvida');
-- fatura de abril paga (100,00) e mais 50,00 adiantados: sobra de crédito, que a operadora devolve em dinheiro (refund_cash)
select public.card_bill_due('2026-05-31');
select public.debt_pay(pg_temp.fx('c'), '2026-04-25', pg_temp.fx('bank'), 100.00, (select id from public.debt_invoices where debt_id = pg_temp.fx('c') and label = '2026-04'));
select public.debt_pay(pg_temp.fx('c'), '2026-04-26', pg_temp.fx('bank'), 50.00);
select public.debt_return(pg_temp.fx('c'), date '2026-05-20', pg_temp.fx('bank'), 30.00);
insert into fixture select 'rc', public.recurrence_create('card', 'Assinatura C', 10.00, null, pg_temp.hoje() + 10, null, null, pg_temp.fx('c'), pg_temp.fx('cat'), null, 'week', 1);
select public.card_scheduled_sync();
insert into fixture select 'item_c', pg_temp.item('rc', pg_temp.hoje() + 10);
select is((select count(*) from public.debt_events where debt_id = pg_temp.fx('c') and kind = 'refund_cash' and voided_at is null), 1::bigint, 'CH32 cenário: uma devolução em dinheiro em 20/05/2026');
select is(pg_temp.cobrou(pg_temp.fx('item_c'), date '2026-04-10'), 'ERRO 23514', 'CH33 compra que fecharia antes da devolução é recusada (23514)');
select is((select status from public.card_scheduled_items where id = pg_temp.fx('item_c')), 'scheduled', 'CH34 o item continua agendado');

-- ---------------------------------------------------------------------------
-- 7. Isolamento e privilégios
-- ---------------------------------------------------------------------------
insert into fixture select 'item_h1', pg_temp.item('r', pg_temp.hoje() + 31);
select pg_temp.login('00000000-0000-0000-0000-0000000135a2');
insert into fixture select 'h2', public.create_household('Outra Casa');
select isnt((select v from fixture where k = 'item_h1'), null, 'CH35 cenário: o item da família 1 existe (id guardado)');
select is(pg_temp.cobrou(pg_temp.fx('item_h1'), pg_temp.hoje()), 'ERRO 42501', 'CH36 outra família, que tem casa própria, não consegue cobrar o item da família 1');
select ok(has_function_privilege('authenticated', 'public.card_scheduled_charged(uuid, date)', 'EXECUTE'), 'CH37 authenticated executa');
select ok(not has_function_privilege('anon', 'public.card_scheduled_charged(uuid, date)', 'EXECUTE'), 'CH38 anon não executa');

-- ---------------------------------------------------------------------------
-- 8. A rotina automática (recurrence_materialize e card_scheduled_convert) não recria a compra que já foi lançada à mão
--    (por último: o convert converte, de verdade, outras cobranças que já cabem na fatura aberta, e isso muda o cenário)
-- ---------------------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000135a1');
select lives_ok($q$select public.recurrence_materialize()$q$, 'CH39 recurrence_materialize roda');
select lives_ok($q$select public.card_scheduled_convert()$q$, 'CH40 card_scheduled_convert roda');
select is((select count(*) from public.debt_installments where recurrence_id = pg_temp.fx('r') and occurrence_date = pg_temp.hoje() + 10), 1::bigint,
  'CH41 depois das duas rotinas continua uma compra só para a ocorrência que o dono lançou como já cobrada');
select is((select purchase_date from public.debt_installments where recurrence_id = pg_temp.fx('r') and occurrence_date = pg_temp.hoje() + 10), pg_temp.hoje(),
  'CH42 e ela segue com a data real (hoje), não com a agendada');

select * from finish();
rollback;
