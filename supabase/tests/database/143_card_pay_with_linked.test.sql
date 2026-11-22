-- 143_card_pay_with_linked: migration 149. Pagar a fatura e a parcela do empréstimo cobrado no cartão de uma vez.
--   * card_linked_due: as parcelas ainda não pagas da fatura, com juros = saldo × taxa do contrato.
--   * card_pay_with_linked: fatura + parcelas na mesma transação; mesma chave não paga duas vezes; se a parcela falha,
--     o pagamento da fatura também não entra; a última parcela zera o saldo do empréstimo.
-- As funções novas vão por SQL dinâmico: sem a migration as asserções falham sem abortar o arquivo.
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
-- quantas parcelas baixou, ou 'ERRO <sqlstate>'
create function pg_temp.pagar(p_card uuid, p_date date, p_account uuid, p_amount numeric, p_invoice uuid, p_label text,
                              p_category uuid, p_idem uuid) returns text language plpgsql as $f$
declare n integer;
begin
  execute 'select public.card_pay_with_linked($1,$2,$3,$4,$5,$6,$7,$8)'
    into n using p_card, p_date, p_account, p_amount, p_invoice, p_label, p_category, p_idem;
  return n::text;
exception when others then return 'ERRO ' || sqlstate;
end $f$;
-- "n/N|parcela|juros|principal" de cada parcela a pagar da fatura
create function pg_temp.devidas(p_card uuid, p_label text, p_date date) returns text[] language plpgsql as $f$
declare r text[];
begin
  execute 'select coalesce(array_agg(installment_number || ''/'' || installment_count || ''|'' || amount::numeric(14,2)
                 || ''|'' || interest::numeric(14,2) || ''|'' || principal::numeric(14,2)
                 order by linked_name, installment_number), ''{}'') from public.card_linked_due($1, $2, $3)'
    into r using p_card, p_label, p_date;
  return r;
exception when others then return array['ERRO ' || sqlstate];
end $f$;
create function pg_temp.saldo_conta() returns numeric language sql as $f$
  select balance from public.account_balances(pg_temp.fx('h'), '2027-12-31') where account_id = pg_temp.fx('brl') $f$;
create function pg_temp.divida(p_debt uuid) returns numeric language sql as $f$
  select debt from public.debt_balances(pg_temp.fx('h'), '2027-12-31') where debt_id = p_debt $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.saldo_conta(), pg_temp.divida(uuid),
  pg_temp.pagar(uuid, date, uuid, numeric, uuid, text, uuid, uuid), pg_temp.devidas(uuid, text, date) to public;

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000143a1', 'p1@teste.com', now()),
  ('00000000-0000-0000-0000-0000000143a2', 'p2@teste.com', now());

select pg_temp.login('00000000-0000-0000-0000-0000000143a2');
insert into fixture select 'h2', public.create_household('Casa Dois');

select pg_temp.login('00000000-0000-0000-0000-0000000143a1');
insert into fixture select 'h', public.create_household('Casa do Pagamento');
insert into fixture select 'cat', id from public.categories where household_id = pg_temp.fx('h') and name = 'Mercado';
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 5000.00, '2026-01-01') returning id)
  insert into fixture select 'brl', id from i;

-- Cartão: fecha 18, vence 28. Maio 500,00; junho 200,00.
insert into fixture select 'card', public.create_debt('Cartão', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('card'), 18, 28);
select public.card_purchase(pg_temp.fx('card'), '2026-05-05', 500.00, 1, pg_temp.fx('cat'), 'Maio');
select public.card_purchase(pg_temp.fx('card'), '2026-06-05', 200.00, 1, pg_temp.fx('cat'), 'Junho');
select public.card_bill_due('2026-05-20');
-- Parcelamento: saldo 1.000,00 a 10% ao mês em 3 parcelas de 402,11 (28/05, 28/06, 28/07), cobrado no cartão.
insert into fixture select 'parc', public.create_debt('Parcelamento', 'loan', '2026-04-01', 1000);
select public.debt_set_terms(pg_temp.fx('parc'), 1000, 0);
select public.debt_contract_set(pg_temp.fx('parc'), 'Banco', null, 3, 3, 402.11, 28, 'account_debit', pg_temp.fx('brl'), '2026-05-28');
select public.debt_link_card(pg_temp.fx('parc'), pg_temp.fx('card'));
insert into fixture select 'fat', invoice_id from public.card_months(pg_temp.fx('card')) where label = '2026-05';

-- 1. prévia: juros = 1.000,00 × 10% = 100,00; principal 302,11
select is(pg_temp.devidas(pg_temp.fx('card'), '2026-05', '2026-05-28'), array['1/3|402.11|100.00|302.11'],
  'parcela a pagar da fatura, com juros pela taxa do contrato');

-- 2. validações (nada entra)
select is(pg_temp.pagar(pg_temp.fx('parc'), '2026-05-28', pg_temp.fx('brl'), 500, null, '2026-05', pg_temp.fx('cat'), null),
  'ERRO 22023', 'só cartão');
select is(pg_temp.pagar(pg_temp.fx('card'), '2026-05-28', pg_temp.fx('brl'), 0, null, '2026-04', pg_temp.fx('cat'), null),
  'ERRO 22023', 'fatura anterior a qualquer parcela e valor zero: nada a pagar');
select is(pg_temp.pagar(pg_temp.fx('card'), '2026-05-28', pg_temp.fx('brl'), -1, null, '2026-05', pg_temp.fx('cat'), null),
  'ERRO 22023', 'valor negativo recusado');
-- sem categoria para os juros: a parcela falha e o pagamento da fatura NÃO pode ficar pela metade
select is(pg_temp.pagar(pg_temp.fx('card'), '2026-05-28', pg_temp.fx('brl'), 500, pg_temp.fx('fat'), '2026-05', null,
  '00000000-0000-0000-0000-00000014301f'), 'ERRO 22023', 'juros sem categoria: recusa');
select is(pg_temp.saldo_conta(), 5000.00, 'recusa não deixa pagamento da fatura pela metade (conta intacta)');

-- 3. paga fatura + parcela de uma vez
select is(pg_temp.pagar(pg_temp.fx('card'), '2026-05-28', pg_temp.fx('brl'), 500, pg_temp.fx('fat'), '2026-05', pg_temp.fx('cat'),
  '00000000-0000-0000-0000-000000143001'), '1', 'pagou a fatura e baixou 1 parcela');
select is(pg_temp.saldo_conta(), 4097.89, 'saiu da conta o que o banco cobra: 500,00 + 402,11');
select is((select paid from public.card_months(pg_temp.fx('card')) where label = '2026-05'), 500.00, 'fatura de maio paga');
select is(pg_temp.divida(pg_temp.fx('parc')), 697.89, 'só o principal (302,11) abate o parcelamento');
select is((select status from public.debt_payment_schedule where debt_id = pg_temp.fx('parc') and installment_number = 1), 'paid',
  'parcela 1 baixada');
select is((select amount from public.debt_events where debt_id = pg_temp.fx('parc') and kind = 'interest' and voided_at is null),
  100.00, 'juros de 100,00 lançados como despesa do empréstimo');

-- 4. mesma chave de novo: nada muda
select is(pg_temp.pagar(pg_temp.fx('card'), '2026-05-28', pg_temp.fx('brl'), 500, pg_temp.fx('fat'), '2026-05', pg_temp.fx('cat'),
  '00000000-0000-0000-0000-000000143001'), '0', 'repetir com a mesma chave não baixa nada');
select is(pg_temp.saldo_conta(), 4097.89, 'e não sai dinheiro de novo');

-- 5. só a parcela (valor zero): junho. Juros = 697,89 × 10% = 69,79
select is(pg_temp.devidas(pg_temp.fx('card'), '2026-06', '2026-06-28'), array['2/3|402.11|69.79|332.32'],
  'segunda parcela: juros sobre o saldo que sobrou');
select is(pg_temp.pagar(pg_temp.fx('card'), '2026-06-28', pg_temp.fx('brl'), 0, null, '2026-06', pg_temp.fx('cat'), null),
  '1', 'valor zero paga só a parcela');
select is(pg_temp.divida(pg_temp.fx('parc')), 365.57, 'saldo depois da segunda parcela');

-- 6. última parcela: o principal é o saldo que sobrou (365,57) e o resto é juro (36,54), não saldo × taxa (36,56)
select is(pg_temp.devidas(pg_temp.fx('card'), '2026-07', '2026-07-28'), array['3/3|402.11|36.54|365.57'],
  'última parcela fecha o saldo');
select is(pg_temp.pagar(pg_temp.fx('card'), '2026-07-28', pg_temp.fx('brl'), 0, null, '2026-07', pg_temp.fx('cat'), null),
  '1', 'última parcela paga');
select is(pg_temp.divida(pg_temp.fx('parc')), 0.00, 'parcelamento quitado sem centavo sobrando');
select is(pg_temp.devidas(pg_temp.fx('card'), '2026-07', '2026-07-28'), '{}'::text[], 'nada mais a pagar');

-- 7. parcela que ficou para trás, consignado e empréstimo sem saldo
-- "Atrasado": 300,00 sem juros, 2 × 150,00 (28/08 e 28/09). Agosto não tem fatura no app: a parcela 1 fica para trás e
-- tem de sair junto com a de setembro, na ordem (sem isso o banco recusaria a 2ª: "baixe as parcelas na ordem").
select public.card_purchase(pg_temp.fx('card'), '2026-09-05', 100.00, 1, pg_temp.fx('cat'), 'Setembro');
insert into fixture select 'atras', public.create_debt('Atrasado', 'loan', '2026-08-01', 300);
select public.debt_contract_set(pg_temp.fx('atras'), 'Banco', null, 2, 2, 150, 28, 'account_debit', pg_temp.fx('brl'), '2026-08-28');
select public.debt_link_card(pg_temp.fx('atras'), pg_temp.fx('card'));
-- "Consignado": desconto em folha não sai de conta; não entra no Pagar fatura
insert into fixture select 'cons', public.create_debt('Consignado', 'loan', '2026-08-01', 200);
select public.debt_contract_set(pg_temp.fx('cons'), 'Banco', null, 1, 1, 210, 28, 'payroll', null, '2026-09-28');
select public.debt_link_card(pg_temp.fx('cons'), pg_temp.fx('card'));
-- "Zerado": saldo corrigido para zero com parcela ainda prevista; a parcela inteira viraria juro
insert into fixture select 'zero', public.create_debt('Zerado', 'loan', '2026-08-01', 100);
select public.debt_contract_set(pg_temp.fx('zero'), 'Banco', null, 1, 1, 60, 28, 'account_debit', pg_temp.fx('brl'), '2026-09-28');
select public.debt_set_balance(pg_temp.fx('zero'), '2026-09-01', 0);
select public.debt_link_card(pg_temp.fx('zero'), pg_temp.fx('card'));

select is(pg_temp.devidas(pg_temp.fx('card'), '2026-09', '2026-09-28'), array['1/2|150.00|0.00|150.00', '2/2|150.00|0.00|150.00'],
  'setembro: a parcela atrasada de agosto vem junto; consignado e empréstimo sem saldo ficam de fora');
create temp table antes_set as select pg_temp.saldo_conta() as conta;
grant select on antes_set to public;
select is(pg_temp.pagar(pg_temp.fx('card'), '2026-09-28', pg_temp.fx('brl'), 100, null, '2026-09', null, null),
  '2', 'paga a fatura e baixa as duas parcelas, na ordem do contrato');
select is((select conta from antes_set) - pg_temp.saldo_conta(), 400.00, 'saíram 100,00 da fatura + 2 × 150,00');
select is(pg_temp.divida(pg_temp.fx('atras')), 0.00, 'empréstimo atrasado quitado');
select is((select count(*)::int from public.debt_payment_schedule
            where debt_id in (pg_temp.fx('cons'), pg_temp.fx('zero')) and status = 'planned'), 2,
  'parcelas do consignado e do empréstimo sem saldo continuam previstas (baixa em Dívidas)');

-- 8. outra família não paga cartão alheio
select pg_temp.login('00000000-0000-0000-0000-0000000143a2');
select is(pg_temp.pagar(pg_temp.fx('card'), '2026-06-28', null, 200, null, '2026-06', null, null), 'ERRO 42501',
  'outra família é recusada');
select is(pg_temp.devidas(pg_temp.fx('card'), '2026-06', '2026-06-28'), '{}'::text[], 'outra família não vê as parcelas');

select * from finish();
rollback;
