-- 58_card_value_fixes: migration 058. (1) assinaturas de cartão previstas na fatura aberta (card_pending_subscriptions);
-- (2) pagamento de cartão com data futura recusado; (3) itens da fatura líquidos (estorno/cancelamento) e "n de N" só
-- com parcelas vivas. Mais os casos de calendário pedidos na análise: compra em 28/02 com fechamento 30/31 e 29/02/2028
-- (a troca de ciclo está no teste 59). Datas fixas (passadas ou bem futuras) e, onde a regra
-- depende de hoje, datas relativas a hoje em São Paulo, para o teste não depender do dia em que roda.
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
create function pg_temp.msg_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate || ' ' || sqlerrm; end $f$;
-- hoje em São Paulo (mesma expressão de private.today_sp, que authenticated não executa)
create function pg_temp.hoje() returns date language sql stable as $f$ select (now() at time zone 'America/Sao_Paulo')::date $f$;
-- assinaturas previstas: cartão|fechamento|vencimento|total
create function pg_temp.prev(p_as_of date) returns text[] language sql as $f$
  select coalesce(array_agg(d.name || '|' || p.closing_date || '|' || p.due_date || '|' || p.total::numeric(14,2) order by d.name), '{}')
    from public.card_pending_subscriptions(pg_temp.fx('h'), p_as_of) p join public.debts d on d.id = p.debt_id $f$;
-- itens da fatura: descrição|n/N|valor|falta cobrar
create function pg_temp.itens(p_card uuid, p_label text) returns text[] language sql as $f$
  select coalesce(array_agg(description || '|' || seq || '/' || plan_count || '|' || face::numeric(14,2) || '|' || remaining::numeric(14,2)
                            order by description, seq), '{}')
    from public.card_items(p_card, p_label) $f$;
-- fatura: fechamento|vencimento|total|itens
create function pg_temp.fatura(p_card uuid, p_label text) returns text language sql as $f$
  select closing_date || '|' || due_date || '|' || total::numeric(14,2) || '|' || items
    from public.card_months(p_card) where label = p_label $f$;
create function pg_temp.fecha(p_card uuid, p_desc text) returns date[] language sql as $f$
  select array_agg(due_date order by seq) from public.debt_installments where debt_id = p_card and description = p_desc $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.sqlstate_of(text), pg_temp.msg_of(text), pg_temp.hoje(),
  pg_temp.prev(date), pg_temp.itens(uuid, text), pg_temp.fatura(uuid, text), pg_temp.fecha(uuid, text) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000058a1', 'v1@teste.com'),
  ('00000000-0000-0000-0000-0000000058a2', 'v2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000058a1');
insert into fixture select 'h', public.create_household('Casa dos Cartões');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 5000.00, '2026-01-01') returning id)
  insert into fixture select 'bank', id from i;
insert into fixture select 'cat', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';

-- ---------------------------------------------------------------------------
-- 1. Assinaturas previstas na fatura aberta
-- ---------------------------------------------------------------------------
-- Cartão A: fecha 10, vence 20. Três assinaturas que começam em 2030 (nada materializado ainda):
--   Streaming 50,00 todo dia 15 (mensal); Café 10,00 toda semana desde 02/01; Pedágio 5,00 a cada 10 dias desde 01/01.
insert into fixture select 'a', public.create_debt('Cartão A', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('a'), 10, 20);
insert into fixture select 'r_mes', public.recurrence_create('card', 'Streaming', 50.00, 15, '2030-01-15', null, null, pg_temp.fx('a'), pg_temp.fx('cat'));
insert into fixture select 'r_sem', public.recurrence_create('card', 'Café', 10.00, null, '2030-01-02', null, null, pg_temp.fx('a'), pg_temp.fx('cat'), null, 'week', 1);
insert into fixture select 'r_dia', public.recurrence_create('card', 'Pedágio', 5.00, null, '2030-01-01', null, null, pg_temp.fx('a'), pg_temp.fx('cat'), null, 'day', 10);
-- Cartão B, sem assinatura: não aparece
insert into fixture select 'b', public.create_debt('Cartão B', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('b'), 10, 20);

select is(pg_temp.prev('2030-01-05'), array['Cartão A|2030-01-10|2030-01-20|25.00'],
          'AS1 fatura aberta em 05/01 (fecha 10/01): café 02/01 e 09/01 (20,00) + pedágio 01/01 (5,00); cartão sem assinatura não aparece');
select is(pg_temp.prev('2030-02-03'), array['Cartão A|2030-02-10|2030-02-20|105.00'],
          'AS2 fatura que fecha 10/02: streaming 15/01 (50) + café 16, 23, 30/01 e 06/02 (40) + pedágio 11, 21 e 31/01 (15) — frequência semanal e em dias contam');
select is(pg_temp.prev('2030-02-10'), array['Cartão A|2030-03-10|2030-03-20|105.00'],
          'AS3 no dia do fechamento a aberta já é a seguinte (fecha 10/03), como na compra');

-- A ocorrência que já virou parcela sai da previsão; a fatura "real" (card_months) só tem o que foi parcelado.
-- (Simula recurrence_materialize, que só gera no dia da cobrança: insere a parcela como ela faria.)
reset role;
insert into public.debt_installments (household_id, debt_id, plan, seq, due_date, face, category_id, description,
                                      purchase_date, closing_day, due_day, recurrence_id, occurrence_date)
values (pg_temp.fx('h'), pg_temp.fx('a'), gen_random_uuid()::text, 1, '2030-02-10', 50.00, pg_temp.fx('cat'), 'Streaming',
        '2030-01-15', 10, 20, pg_temp.fx('r_mes'), '2030-01-15');
select pg_temp.login('00000000-0000-0000-0000-0000000058a1');
select is(pg_temp.prev('2030-02-03'), array['Cartão A|2030-02-10|2030-02-20|55.00'],
          'AS4 streaming de 15/01 já parcelado: a previsão cai para 55,00 (sem contar duas vezes)');
select is(pg_temp.fatura(pg_temp.fx('a'), '2030-02'), '2030-02-10|2030-02-20|50.00|1',
          'AS5 card_months não muda: a fatura de fevereiro tem só o que foi parcelado (50,00)');
-- a projeção do mês (que lê card_recurrence_pending, recriada com colunas a mais) segue funcionando
select is((select count(*) from public.month_projection(pg_temp.fx('h'), '2030-02-01', '2030-02-03')), 1::bigint,
          'AS6 month_projection continua lendo card_recurrence_pending');
select is((select count(*) from public.budget_projection(pg_temp.fx('h'), '2030-02-01', '2030-02-03')) >= 0, true,
          'AS7 budget_projection continua lendo card_recurrence_pending');

-- outra família não vê
select pg_temp.login('00000000-0000-0000-0000-0000000058a2');
select public.create_household('Outra');
select is((select count(*) from public.card_pending_subscriptions(pg_temp.fx('h'), '2030-02-03')), 0::bigint,
          'AS8 outra família: nenhuma linha');
select pg_temp.login('00000000-0000-0000-0000-0000000058a1');

-- ---------------------------------------------------------------------------
-- 2. Pagamento de cartão sem data futura
-- ---------------------------------------------------------------------------
-- Cartão P: compra de 100,00 em 05/03/2026, fatura fecha 10/03 e é cobrada.
insert into fixture select 'p', public.create_debt('Cartão P', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('p'), 10, 20);
select public.card_purchase(pg_temp.fx('p'), '2026-03-05', 100.00, 1, pg_temp.fx('cat'), 'Mercado');
select public.card_bill_due('2026-03-31');

select is(pg_temp.msg_of(format($$select public.debt_pay(%L, %L, %L, 10.00)$$, pg_temp.fx('p'), pg_temp.hoje() + 1, pg_temp.fx('bank'))),
          format('22023 o pagamento do cartão não pode ter data futura (%s): registre no dia em que o dinheiro sair da conta (hoje é %s)',
                 pg_temp.hoje() + 1, pg_temp.hoje()),
          'PF1 pagamento de cartão com data de amanhã: recusado com mensagem clara');
select is(pg_temp.sqlstate_of(format($$select public.debt_pay(%L, %L, %L, 10.00, null, true)$$, pg_temp.fx('p'), pg_temp.hoje() + 30, pg_temp.fx('bank'))),
          '22023', 'PF2 amortização extra de cartão com data futura: recusada');
select is(pg_temp.sqlstate_of(format($$select public.debt_anticipate(%L, %L, %L, array[%L::uuid], array[10.00], array[0.00])$$,
                                     pg_temp.fx('p'), pg_temp.hoje() + 1, pg_temp.fx('bank'),
                                     (select id from public.debt_installments where debt_id = pg_temp.fx('p')))),
          '22023', 'PF3 antecipação de cartão com data futura: recusada (o pagamento dela também é pagamento)');
select is((select count(*) from public.debt_events where debt_id = pg_temp.fx('p') and kind in ('payment', 'extra_principal')),
          0::bigint, 'PF4 nada foi gravado');
select ok(public.debt_pay(pg_temp.fx('p'), pg_temp.hoje(), pg_temp.fx('bank'), 100.00,
                          (select id from public.debt_invoices where debt_id = pg_temp.fx('p') and label = '2026-03')) is not null,
          'PF5 pagamento com data de hoje: aceito');
select is((select total::numeric(14,2) || '|' || paid::numeric(14,2) from public.card_months(pg_temp.fx('p')) where label = '2026-03'),
          '100.00|100.00', 'PF6 fatura de março paga');
-- empréstimo continua aceitando data futura (parcela agendada)
insert into fixture select 'loan', public.create_debt('Empréstimo', 'loan', '2026-01-01', 1000.00);
select ok(public.debt_pay(pg_temp.fx('loan'), pg_temp.hoje() + 30, pg_temp.fx('bank'), 100.00) is not null,
          'PF7 empréstimo: pagamento com data futura continua aceito');

-- ---------------------------------------------------------------------------
-- 3. Itens da fatura líquidos e "n de N" só com parcelas vivas
-- ---------------------------------------------------------------------------
-- Cartão I: TV de 300,00 em 3x (fecha 10/02, 10/03, 10/04). A 1ª é cobrada; depois estorno de 30 na 1ª (crédito),
-- cancelamento parcial de 20 na 2ª e cancelamento integral da 3ª (compra encurtada para 2 parcelas).
insert into fixture select 'i', public.create_debt('Cartão I', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('i'), 10, 20);
select public.card_purchase(pg_temp.fx('i'), '2026-02-01', 300.00, 3, pg_temp.fx('cat'), 'TV');
select public.card_bill_due('2026-02-28');
create function pg_temp.parc(p_seq int) returns uuid language sql as $f$
  select id from public.debt_installments where debt_id = pg_temp.fx('i') and description = 'TV' and seq = p_seq $f$;
grant execute on function pg_temp.parc(int) to public;
select public.debt_refund(pg_temp.parc(1), '2026-02-15', 30.00);
select public.debt_refund(pg_temp.parc(2), '2026-02-15', 20.00);
select public.debt_refund(pg_temp.parc(3), '2026-02-15', 100.00);

select is(pg_temp.itens(pg_temp.fx('i'), '2026-02'), array['TV|1/2|70.00|0.00'],
          'IT1 fevereiro: 100 − 30 de estorno = 70,00, e a compra agora tem 2 parcelas (a 3ª foi cancelada)');
select is(pg_temp.itens(pg_temp.fx('i'), '2026-03'), array['TV|2/2|80.00|80.00'],
          'IT2 março: 100 − 20 de cancelamento parcial = 80,00 (tudo ainda a cobrar)');
select is(pg_temp.itens(pg_temp.fx('i'), '2026-04'), '{}'::text[], 'IT3 abril: parcela cancelada não aparece (como antes)');
select is((select sum(face) from public.card_items(pg_temp.fx('i'), '2026-02')) || '|' || (select sum(face) from public.card_items(pg_temp.fx('i'), '2026-03')),
          (select string_agg(total::numeric(14,2)::text, '|' order by label) from public.card_months(pg_temp.fx('i'))),
          'IT4 a soma dos itens bate com o total de cada fatura');

-- ---------------------------------------------------------------------------
-- 4. Calendário: 28/02 com fechamento 30 e 31, ano bissexto, troca de ciclo
-- ---------------------------------------------------------------------------
-- Fecha 30, vence 5. Em fevereiro de 2027 o fechamento é 28/02: compra em 27/02 cai nela; em 28/02 (dia do
-- fechamento) já vai para a de março (30/03).
insert into fixture select 'f30', public.create_debt('Cartão 30', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('f30'), 30, 5);
select public.card_purchase(pg_temp.fx('f30'), '2027-02-27', 10.00, 1, pg_temp.fx('cat'), 'Dia 27');
select public.card_purchase(pg_temp.fx('f30'), '2027-02-28', 20.00, 1, pg_temp.fx('cat'), 'Dia 28');
select is(pg_temp.fecha(pg_temp.fx('f30'), 'Dia 27'), array['2027-02-28'::date], 'CA1 fecha 30: compra em 27/02/2027 fecha em 28/02');
select is(pg_temp.fecha(pg_temp.fx('f30'), 'Dia 28'), array['2027-03-30'::date], 'CA2 fecha 30: compra em 28/02/2027 (dia do fechamento) vai para 30/03');
select is(pg_temp.fatura(pg_temp.fx('f30'), '2027-02'), '2027-02-28|2027-03-05|10.00|1', 'CA3 fatura de fevereiro/2027: fecha 28/02, vence 05/03');
select is(pg_temp.fatura(pg_temp.fx('f30'), '2027-03'), '2027-03-30|2027-04-05|20.00|1', 'CA4 fatura de março/2027: fecha 30/03, vence 05/04');
-- a assinatura segue a mesma regra (dia 31 vira 28/02 em fevereiro)
select public.recurrence_create('card', 'Clube', 7.00, 31, '2030-01-31', null, null, pg_temp.fx('f30'), pg_temp.fx('cat'));
select is(pg_temp.prev('2030-02-27'), array['Cartão 30|2030-02-28|2030-03-05|7.00', 'Cartão A|2030-03-10|2030-03-20|105.00'],
          'CA5 assinatura dia 31 de 31/01/2030 cai na fatura que fecha 28/02 (31 ≥ 30 de janeiro)');
select is(pg_temp.prev('2030-02-28'), array['Cartão 30|2030-03-30|2030-04-05|7.00', 'Cartão A|2030-03-10|2030-03-20|105.00'],
          'CA6 em 28/02 (fechamento) a aberta é a de 30/03, com a assinatura de 28/02');

-- Fecha 31: compra em 28/02/2027 é no dia do fechamento (28/02) e vai para 31/03
insert into fixture select 'f31', public.create_debt('Cartão 31', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('f31'), 31, 5);
select public.card_purchase(pg_temp.fx('f31'), '2027-02-28', 15.00, 1, pg_temp.fx('cat'), 'Dia 28');
select is(pg_temp.fecha(pg_temp.fx('f31'), 'Dia 28'), array['2027-03-31'::date], 'CA7 fecha 31: compra em 28/02/2027 vai para 31/03');
select is(pg_temp.fatura(pg_temp.fx('f31'), '2027-03'), '2027-03-31|2027-04-05|15.00|1', 'CA8 fatura de março/2027 do cartão 31: vence 05/04');

-- Bissexto: fecha 30. Em fevereiro de 2028 o fechamento é 29/02: compra em 28/02 cai nela; em 29/02 vai para 30/03.
select public.card_purchase(pg_temp.fx('f30'), '2028-02-28', 30.00, 2, pg_temp.fx('cat'), 'Bissexto 28');
select public.card_purchase(pg_temp.fx('f30'), '2028-02-29', 40.00, 1, pg_temp.fx('cat'), 'Bissexto 29');
select is(pg_temp.fecha(pg_temp.fx('f30'), 'Bissexto 28'), array['2028-02-29', '2028-03-30']::date[],
          'CA9 2028: compra em 28/02 em 2x fecha em 29/02 e 30/03');
select is(pg_temp.fecha(pg_temp.fx('f30'), 'Bissexto 29'), array['2028-03-30'::date], 'CA10 2028: compra em 29/02 (fechamento) vai para 30/03');
select is(pg_temp.fatura(pg_temp.fx('f30'), '2028-02'), '2028-02-29|2028-03-05|15.00|1', 'CA11 fatura de fevereiro/2028: fecha 29/02, vence 05/03');
select is(pg_temp.fatura(pg_temp.fx('f30'), '2028-03'), '2028-03-30|2028-04-05|55.00|2', 'CA12 fatura de março/2028: 15 + 40');

-- Troca de ciclo que punha dois fechamentos no mesmo mês: era um limite conhecido aqui (CY1–CY3 afirmavam a fatura
-- fundida). A migration 061 mudou a regra (a troca vale a partir do ciclo seguinte ao da fatura aberta hoje) e o caso
-- passou para o teste 59_card_cycle_change, com datas relativas a hoje (a regra depende do dia da troca).

select * from finish();
rollback;
