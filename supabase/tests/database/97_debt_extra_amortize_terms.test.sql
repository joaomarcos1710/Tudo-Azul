-- 97_debt_extra_amortize_terms: migration 103. debt_extra_amortize registra a amortização extra e, na mesma transação,
-- reduz o prazo ('term') ou a parcela ('installment') do contrato e refaz a agenda. Dados fictícios, datas fixas.
-- Contrato-base: 12 parcelas de 100, dia 10, 1ª em 10/08/2026; 2 pagas (ago e set) => 10 restantes, próxima: nº 3 em 10/10/2026.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create temp table fixture (k text primary key, v uuid);
grant all on fixture to public;
create temp table antes (k text primary key, t text, n numeric);
grant all on antes to public;
create function pg_temp.fx(p_k text) returns uuid language sql as $f$ select v from fixture where k = p_k $f$;
create function pg_temp.login(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $f$;
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
create function pg_temp.divida(p_k text) returns numeric language sql as $f$
  select debt from public.debt_balances(pg_temp.fx('h'), date '2026-10-31') where debt_id = pg_temp.fx(p_k) $f$;
create function pg_temp.saldo(p_k text) returns numeric language sql as $f$
  select balance from public.account_balances(pg_temp.fx('h'), date '2026-10-31') where account_id = pg_temp.fx(p_k) $f$;
create function pg_temp.contas() returns text language sql as $f$
  select string_agg(account_id::text || '=' || balance::text, ';' order by account_id)
    from public.account_balances(pg_temp.fx('h'), date '2026-10-31') $f$;
create function pg_temp.despesa_mes() returns numeric language sql as $f$
  select expense_paid from public.period_summary(pg_temp.fx('h'), date '2026-10-01', date '2026-10-31') $f$;
create function pg_temp.eventos(p_k text) returns bigint language sql as $f$
  select count(*) from public.debt_events where debt_id = pg_temp.fx(p_k) $f$;
-- agenda como texto: "número:vencimento:valor", por status, até o número p_max
create function pg_temp.agenda(p_k text, p_status text, p_max integer default 100000) returns text language sql as $f$
  select string_agg(installment_number || ':' || due_date || ':' || amount::numeric(14,2), ';' order by installment_number)
    from public.debt_payment_schedule
   where debt_id = pg_temp.fx(p_k) and status = p_status and installment_number <= p_max $f$;
-- contrato inteiro como texto, para provar que uma recusa não mexeu em nada
create function pg_temp.contrato(p_k text) returns text language sql as $f$
  select original_installments || '/' || remaining_installments || '/' || installment_amount::numeric(14,2) || '/' || first_due_date
    from public.debts where id = pg_temp.fx(p_k) $f$;
-- financiamento de 10.000 com contrato de 12 x 100 (débito manual) e 2 parcelas pagas com a conta 'conta'
create function pg_temp.mk(p_k text, p_method text default 'manual', p_acc uuid default null) returns void language plpgsql as $f$
declare v_id uuid; v_i integer;
begin
  v_id := public.create_debt(p_k, 'financing', date '2026-07-01', 10000);
  insert into fixture values (p_k, v_id);
  perform public.debt_contract_set(v_id, 'Banco fictício', 'CTR-97', 12, 12, 100, 10, p_method, p_acc, date '2026-08-10');
  for v_i in 1..2 loop
    perform public.debt_schedule_record_payment(
      (select id from public.debt_payment_schedule where debt_id = v_id and installment_number = v_i),
      make_date(2026, 7 + v_i, 10), coalesce(p_acc, pg_temp.fx('conta')), 100, 0, 0, null, false);
  end loop;
end $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.sqlstate_of(text), pg_temp.divida(text),
  pg_temp.saldo(text), pg_temp.contas(), pg_temp.despesa_mes(), pg_temp.eventos(text), pg_temp.agenda(text, text, integer),
  pg_temp.contrato(text), pg_temp.mk(text, text, uuid) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000097a1', 'amort1@teste.com'),
  ('00000000-0000-0000-0000-0000000097a2', 'amort2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000097a1');
insert into fixture select 'h', public.create_household('Casa Amortização');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Corrente', 'checking', 50000, date '2026-01-01') returning id)
  insert into fixture select 'conta', id from i;
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Débito', 'checking', 1000, date '2026-01-01') returning id)
  insert into fixture select 'debito', id from i;
select pg_temp.mk('prazo');
select pg_temp.mk('parcela');
select pg_temp.mk('fgts');
select pg_temp.mk('tudo');
select pg_temp.mk('atomico');
select pg_temp.mk('debitoauto', 'account_debit', pg_temp.fx('debito'));
insert into fixture select 'semcontrato', public.create_debt('Sem contrato', 'loan', date '2026-07-01', 5000);
insert into fixture select 'cartao', public.create_debt('Cartão', 'card', date '2026-07-01', 0);

-- ---------------------------------------------------------------------------
-- 0. Ponto de partida
-- ---------------------------------------------------------------------------
select is(pg_temp.divida('prazo'), 9800::numeric, 'F1 saldo depois de 2 parcelas pagas: 9.800');
select is(pg_temp.contrato('prazo'), '12/10/100.00/2026-10-10', 'F2 contrato 12 com 10 restantes, parcela 100, próxima em 10/10/2026');
select is(pg_temp.agenda('prazo', 'planned'), (select string_agg(n || ':' || (date '2026-10-10' + make_interval(months => n - 3))::date || ':100.00', ';' order by n)
                                                from generate_series(3, 12) n), 'F3 planejadas 3..12');

-- ---------------------------------------------------------------------------
-- 1. Prazo: amortiza 2.000 e o prazo restante cai de 10 para 6
-- ---------------------------------------------------------------------------
insert into antes values ('pagas_prazo', pg_temp.agenda('prazo', 'paid'), null),
                         ('plan_prazo', pg_temp.agenda('prazo', 'planned', 8), null);
select lives_ok(format($$select public.debt_extra_amortize(%L::uuid, date '2026-10-20', %L::uuid, 2000, 'term', 6)$$,
  pg_temp.fx('prazo'), pg_temp.fx('conta')), 'T1 amortização reduzindo o prazo é aceita');
select is(pg_temp.divida('prazo'), 7800::numeric, 'T2 saldo da dívida cai exatamente o principal (2.000)');
select is((select remaining_installments from public.debts where id = pg_temp.fx('prazo')), 6, 'T3 restantes = 6');
select is((select original_installments from public.debts where id = pg_temp.fx('prazo')), 8, 'T4 total do contrato = 8 (12 - 4 tiradas)');
select is((select installment_amount from public.debts where id = pg_temp.fx('prazo')), 100::numeric, 'T5 parcela igual (100)');
select is((select first_due_date from public.debts where id = pg_temp.fx('prazo')), date '2026-10-10', 'T6 próximo vencimento segue 10/10/2026');
select is((select count(*) from public.debt_payment_schedule where debt_id = pg_temp.fx('prazo') and status = 'planned'), 6::bigint,
  'T7 seis parcelas planejadas');
select is((select min(installment_number) || '-' || max(installment_number) from public.debt_payment_schedule
            where debt_id = pg_temp.fx('prazo') and status = 'planned'), '3-8', 'T8 numeração 3..8');
select is(pg_temp.agenda('prazo', 'planned'), (select t from antes where k = 'plan_prazo'),
  'T9 planejadas = as mesmas 3..8 de antes (mesmas datas e valores, mesma data inicial)');
select is(pg_temp.agenda('prazo', 'paid'), (select t from antes where k = 'pagas_prazo'), 'T10 as 2 pagas intactas');
select is((select count(*) from public.debt_events where debt_id = pg_temp.fx('prazo') and kind = 'extra_principal'
             and amount = 2000 and date = '2026-10-20' and account_id = pg_temp.fx('conta') and voided_at is null), 1::bigint,
  'T11 um evento extra_principal de 2.000 com a conta');
select is(pg_temp.saldo('conta'), 47000::numeric, 'T12 conta: 50.000 - 5 contratos x 2 parcelas de 100 - amortização de 2.000');

-- ---------------------------------------------------------------------------
-- 2. Parcela: amortiza 2.000, prazo igual, parcela 100 -> 80
-- ---------------------------------------------------------------------------
insert into antes values ('pagas_parcela', pg_temp.agenda('parcela', 'paid'), null),
  ('nums_parcela', (select string_agg(installment_number::text || ':' || due_date, ';' order by installment_number)
                      from public.debt_payment_schedule where debt_id = pg_temp.fx('parcela') and status = 'planned'), null);
select lives_ok(format($$select public.debt_extra_amortize(%L::uuid, date '2026-10-20', %L::uuid, 2000, 'installment', null, 80.50)$$,
  pg_temp.fx('parcela'), pg_temp.fx('conta')), 'P1 amortização reduzindo a parcela é aceita');
select is(pg_temp.divida('parcela'), 7800::numeric, 'P2 saldo cai o principal');
select is(pg_temp.contrato('parcela'), '12/10/80.50/2026-10-10', 'P3 restantes e total iguais, parcela 80,50, mesma data inicial');
select is((select count(*) from public.debt_payment_schedule where debt_id = pg_temp.fx('parcela') and status = 'planned'
             and amount = 80.50), 10::bigint, 'P4 as 10 planejadas valem 80,50');
select is((select string_agg(installment_number::text || ':' || due_date, ';' order by installment_number)
             from public.debt_payment_schedule where debt_id = pg_temp.fx('parcela') and status = 'planned'),
  (select t from antes where k = 'nums_parcela'), 'P5 números e vencimentos iguais');
select is(pg_temp.agenda('parcela', 'paid'), (select t from antes where k = 'pagas_parcela'), 'P6 as 2 pagas intactas (100)');
-- parcela igual à atual é permitida (nenhuma redução, só a amortização)
select lives_ok(format($$select public.debt_extra_amortize(%L::uuid, date '2026-10-21', %L::uuid, 100, 'installment', null, 80.50)$$,
  pg_temp.fx('parcela'), pg_temp.fx('conta')), 'P7 parcela igual à atual é aceita');
select is(pg_temp.divida('parcela'), 7700::numeric, 'P8 e o saldo cai de novo');

-- ---------------------------------------------------------------------------
-- 3. Sem conta (FGTS): ajusta o contrato, não mexe em conta nem em despesa do mês
-- ---------------------------------------------------------------------------
insert into antes values ('contas', pg_temp.contas(), null), ('despesa', null, pg_temp.despesa_mes());
select lives_ok($$select public.debt_extra_amortize(pg_temp.fx('fgts'), date '2026-10-20', null, 3000, 'term', 7)$$,
  'G1 amortização sem conta (FGTS) reduzindo o prazo é aceita');
select is(pg_temp.divida('fgts'), 6800::numeric, 'G2 saldo cai 3.000');
select is(pg_temp.contrato('fgts'), '9/7/100.00/2026-10-10', 'G3 prazo 7 restantes, total 9, parcela igual');
select is(pg_temp.agenda('fgts', 'planned'), (select string_agg(n || ':' || (date '2026-10-10' + make_interval(months => n - 3))::date || ':100.00', ';' order by n)
                                               from generate_series(3, 9) n), 'G4 planejadas 3..9');
select is(pg_temp.contas(), (select t from antes where k = 'contas'), 'G5 nenhuma conta muda de saldo');
select is(pg_temp.despesa_mes(), (select n from antes where k = 'despesa'), 'G6 despesa do mês não muda');
select is((select count(*) from public.debt_events where debt_id = pg_temp.fx('fgts') and kind = 'extra_principal'
             and account_id is null and amount = 3000), 1::bigint, 'G7 evento extra sem conta');
select lives_ok($$select public.debt_extra_amortize(pg_temp.fx('fgts'), date '2026-10-21', null, 1000, 'installment', null, 60)$$,
  'G8 sem conta reduzindo a parcela também é aceito');
select is(pg_temp.contrato('fgts'), '9/7/60.00/2026-10-10', 'G9 parcela 60, prazo igual');
select is(pg_temp.contas(), (select t from antes where k = 'contas'), 'G10 contas continuam iguais');

-- ---------------------------------------------------------------------------
-- 4. Atomicidade: ajuste inválido => erro, saldo, contrato, agenda e eventos intactos
-- ---------------------------------------------------------------------------
insert into antes values ('divida_at', null, pg_temp.divida('atomico')), ('contrato_at', pg_temp.contrato('atomico'), null),
  ('agenda_at', pg_temp.agenda('atomico', 'planned'), null), ('ev_at', null, pg_temp.eventos('atomico')),
  ('contas_at', pg_temp.contas(), null),
  ('divida_sc', null, pg_temp.divida('semcontrato')), ('ev_sc', null, pg_temp.eventos('semcontrato')),
  ('divida_cc', null, pg_temp.divida('cartao')), ('ev_cc', null, pg_temp.eventos('cartao'));
select is(pg_temp.sqlstate_of(format($$select public.debt_extra_amortize(%L::uuid, date '2026-10-20', %L::uuid, 500, 'term', 11)$$,
  pg_temp.fx('atomico'), pg_temp.fx('conta'))), '22023', 'A1 prazo maior que o atual: recusado');
select is(pg_temp.sqlstate_of(format($$select public.debt_extra_amortize(%L::uuid, date '2026-10-20', %L::uuid, 500, 'term', -1)$$,
  pg_temp.fx('atomico'), pg_temp.fx('conta'))), '22023', 'A1.1 prazo negativo: recusado');
select is(pg_temp.sqlstate_of(format($$select public.debt_extra_amortize(%L::uuid, date '2026-10-20', %L::uuid, 500, 'term', null)$$,
  pg_temp.fx('atomico'), pg_temp.fx('conta'))), '22023', 'A1.2 prazo nulo: recusado');
select is(pg_temp.sqlstate_of(format($$select public.debt_extra_amortize(%L::uuid, date '2026-10-20', %L::uuid, 500, 'installment', null, 100.01)$$,
  pg_temp.fx('atomico'), pg_temp.fx('conta'))), '22023', 'A2 parcela maior que a atual: recusada');
select is(pg_temp.sqlstate_of(format($$select public.debt_extra_amortize(%L::uuid, date '2026-10-20', %L::uuid, 500, 'installment', null, 0)$$,
  pg_temp.fx('atomico'), pg_temp.fx('conta'))), '22023', 'A2.1 parcela zero: recusada');
select is(pg_temp.sqlstate_of(format($$select public.debt_extra_amortize(%L::uuid, date '2026-10-20', %L::uuid, 500, 'installment', null, null)$$,
  pg_temp.fx('atomico'), pg_temp.fx('conta'))), '22023', 'A2.2 parcela nula: recusada');
select is(pg_temp.sqlstate_of(format($$select public.debt_extra_amortize(%L::uuid, date '2026-10-20', %L::uuid, 500, 'tudo', 5, 50)$$,
  pg_temp.fx('atomico'), pg_temp.fx('conta'))), '22023', 'A3 modo inválido: recusado');
select is(pg_temp.sqlstate_of(format($$select public.debt_extra_amortize(%L::uuid, date '2026-10-20', %L::uuid, 500, null, 5, 50)$$,
  pg_temp.fx('atomico'), pg_temp.fx('conta'))), '22023', 'A3.1 modo nulo: recusado');
select is(pg_temp.sqlstate_of(format($$select public.debt_extra_amortize(%L::uuid, date '2026-10-20', %L::uuid, 500, 'installment', null, 50.005)$$,
  pg_temp.fx('atomico'), pg_temp.fx('conta'))), '22003', 'A4 parcela com 3 casas decimais: recusada');
select is(pg_temp.sqlstate_of(format($$select public.debt_extra_amortize(%L::uuid, date '2026-10-20', %L::uuid, 500, 'term', 5)$$,
  pg_temp.fx('semcontrato'), pg_temp.fx('conta'))), '22023', 'A5 dívida sem contrato: recusada');
select is(pg_temp.sqlstate_of(format($$select public.debt_extra_amortize(%L::uuid, date '2026-10-20', %L::uuid, 500, 'term', 5)$$,
  pg_temp.fx('cartao'), pg_temp.fx('conta'))), '22023', 'A6 cartão: recusado');
-- erro depois do pagamento (conta de débito arquivada faz o debt_contract_set falhar): o pagamento também volta
reset role;
update public.accounts set active = false where id = pg_temp.fx('debito');
select pg_temp.login('00000000-0000-0000-0000-0000000097a1');
insert into antes values ('divida_da', null, pg_temp.divida('debitoauto')), ('ev_da', null, pg_temp.eventos('debitoauto')),
  ('contrato_da', pg_temp.contrato('debitoauto'), null), ('agenda_da', pg_temp.agenda('debitoauto', 'planned'), null);
select is(pg_temp.sqlstate_of(format($$select public.debt_extra_amortize(%L::uuid, date '2026-10-20', %L::uuid, 500, 'term', 5)$$,
  pg_temp.fx('debitoauto'), pg_temp.fx('conta'))), '23514', 'A7 falha tardia no ajuste do contrato (conta de débito arquivada): erro');
select is(pg_temp.divida('debitoauto'), (select n from antes where k = 'divida_da'), 'A7.1 a amortização foi desfeita junto (saldo igual)');
select is(pg_temp.eventos('debitoauto'), (select n from antes where k = 'ev_da')::bigint, 'A7.2 nenhum evento novo');
select is(pg_temp.contrato('debitoauto'), (select t from antes where k = 'contrato_da'), 'A7.3 contrato igual');
select is(pg_temp.agenda('debitoauto', 'planned'), (select t from antes where k = 'agenda_da'), 'A7.4 agenda igual');
-- as recusas acima não deixaram rastro
select is(pg_temp.divida('atomico'), (select n from antes where k = 'divida_at'), 'A8 saldo do contrato intacto');
select is(pg_temp.eventos('atomico'), (select n from antes where k = 'ev_at')::bigint, 'A8.1 nenhum evento novo no contrato');
select is(pg_temp.contrato('atomico'), (select t from antes where k = 'contrato_at'), 'A8.2 contrato intacto');
select is(pg_temp.agenda('atomico', 'planned'), (select t from antes where k = 'agenda_at'), 'A8.3 agenda intacta');
select is(pg_temp.divida('semcontrato'), (select n from antes where k = 'divida_sc'), 'A9 dívida sem contrato intacta');
select is(pg_temp.eventos('semcontrato'), (select n from antes where k = 'ev_sc')::bigint, 'A9.1 sem evento novo');
select is(pg_temp.divida('cartao'), (select n from antes where k = 'divida_cc'), 'A10 cartão intacto');
select is(pg_temp.eventos('cartao'), (select n from antes where k = 'ev_cc')::bigint, 'A10.1 sem evento novo');
select is(pg_temp.contas(), (select t from antes where k = 'contas_at'), 'A11 nenhuma conta mexeu');

-- ---------------------------------------------------------------------------
-- 5. Idempotência: chamar de novo é outra amortização (soma), nunca repete a anterior
-- ---------------------------------------------------------------------------
select lives_ok(format($$select public.debt_extra_amortize(%L::uuid, date '2026-10-20', %L::uuid, 2000, 'term', 6)$$,
  pg_temp.fx('prazo'), pg_temp.fx('conta')), 'I1 segunda chamada no mesmo contrato com prazo igual ao atual é aceita');
select is(pg_temp.divida('prazo'), 5800::numeric, 'I2 saldo cai de novo (soma, 2 amortizações)');
select is(pg_temp.contrato('prazo'), '8/6/100.00/2026-10-10', 'I3 contrato continua 8/6 (prazo igual ao atual não muda nada)');
select is((select count(*) from public.debt_payment_schedule where debt_id = pg_temp.fx('prazo') and status = 'planned'), 6::bigint,
  'I4 agenda sem duplicar parcelas');
select is((select count(*) from public.debt_events where debt_id = pg_temp.fx('prazo') and kind = 'extra_principal'), 2::bigint,
  'I5 dois eventos extra_principal, nenhum a mais');

-- ---------------------------------------------------------------------------
-- 6. Prazo 0: amortiza tudo o que resta
-- ---------------------------------------------------------------------------
select lives_ok(format($$select public.debt_extra_amortize(%L::uuid, date '2026-10-20', %L::uuid, 9800, 'term', 0)$$,
  pg_temp.fx('tudo'), pg_temp.fx('conta')), 'Z1 quitar tudo com prazo 0 é aceito');
select is(pg_temp.divida('tudo'), 0::numeric, 'Z2 saldo zerado');
select is((select remaining_installments from public.debts where id = pg_temp.fx('tudo')), 0, 'Z3 restantes = 0');
select is((select original_installments from public.debts where id = pg_temp.fx('tudo')), 2, 'Z4 total = 2 (só as pagas)');
select is((select count(*) from public.debt_payment_schedule where debt_id = pg_temp.fx('tudo') and status = 'planned'), 0::bigint,
  'Z5 nenhuma parcela planejada');
select is((select count(*) from public.debt_payment_schedule where debt_id = pg_temp.fx('tudo') and status = 'paid'), 2::bigint,
  'Z6 as 2 pagas continuam');
-- sem parcelas em aberto não há o que ajustar
select is(pg_temp.sqlstate_of(format($$select public.debt_extra_amortize(%L::uuid, date '2026-10-21', %L::uuid, 1, 'term', 0)$$,
  pg_temp.fx('tudo'), pg_temp.fx('conta'))), '22023', 'Z7 sem parcela em aberto: recusado');

-- ---------------------------------------------------------------------------
-- 7. Privilégio: cliente não escreve direto no contrato nem na agenda
-- ---------------------------------------------------------------------------
select is(pg_temp.sqlstate_of(format($$update public.debts set remaining_installments = 1 where id = %L::uuid$$, pg_temp.fx('prazo'))),
  '42501', 'V1 update direto em debts: sem permissão');
select is(pg_temp.sqlstate_of(format($$update public.debt_payment_schedule set amount = 1 where debt_id = %L::uuid$$, pg_temp.fx('prazo'))),
  '42501', 'V2 update direto na agenda: sem permissão');
select is(pg_temp.sqlstate_of(format($$delete from public.debt_payment_schedule where debt_id = %L::uuid$$, pg_temp.fx('prazo'))),
  '42501', 'V3 delete direto na agenda: sem permissão');

-- ---------------------------------------------------------------------------
-- 8. Isolamento: outra família e anônimo
-- ---------------------------------------------------------------------------
reset role;
select is(has_function_privilege('anon', 'public.debt_extra_amortize(uuid,date,uuid,numeric,text,integer,numeric,numeric,numeric,uuid)', 'execute'),
  false, 'O1 anon não tem execute');
select is(has_function_privilege('authenticated', 'public.debt_extra_amortize(uuid,date,uuid,numeric,text,integer,numeric,numeric,numeric,uuid)', 'execute'),
  true, 'O1.1 authenticated tem execute');
select pg_temp.login('00000000-0000-0000-0000-0000000097a2');
insert into fixture select 'h2', public.create_household('Casa Vizinha');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h2'), 'Corrente 2', 'checking', 1000, date '2026-01-01') returning id)
  insert into fixture select 'conta2', id from i;
select is(pg_temp.sqlstate_of(format($$select public.debt_extra_amortize(%L::uuid, date '2026-10-22', %L::uuid, 100, 'term', 3)$$,
  pg_temp.fx('parcela'), pg_temp.fx('conta2'))), '42501', 'O2 outra família: dívida alheia recusada');
select is(pg_temp.sqlstate_of(format($$select public.debt_extra_amortize(%L::uuid, date '2026-10-22', null, 100, 'term', 3)$$,
  pg_temp.fx('parcela'))), '42501', 'O3 outra família sem conta: recusada');
reset role;
set local role anon;
select is(pg_temp.sqlstate_of(format($$select public.debt_extra_amortize(%L::uuid, date '2026-10-22', null, 100, 'term', 3)$$,
  pg_temp.fx('parcela'))), '42501', 'O4 anon chamando: sem permissão');
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000097a1');
select is(pg_temp.contrato('parcela'), '12/10/80.50/2026-10-10', 'O5 dívida da família 1 intacta depois das tentativas');
select is(pg_temp.divida('parcela'), 7700::numeric, 'O6 saldo da família 1 intacto');

select * from finish();
rollback;
