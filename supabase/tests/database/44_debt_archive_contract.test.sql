-- 44_debt_archive_contract: migration 045. Arquivar e excluir empréstimo/financiamento com contrato e agenda.
-- Datas relativas a hoje em São Paulo; nada depende de data fixa nem do fuso do servidor.
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
create function pg_temp.hoje() returns date language sql as $f$ select (now() at time zone 'America/Sao_Paulo')::date $f$;
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
-- n-ésima parcela do contrato da dívida (1 = primeira)
create function pg_temp.parcela(p_k text, p_n integer) returns uuid language sql as $f$
  select id from public.debt_payment_schedule where debt_id = pg_temp.fx(p_k) and installment_number = p_n $f$;
create function pg_temp.status_parcela(p_k text, p_n integer) returns text language sql as $f$
  select status from public.debt_payment_schedule where debt_id = pg_temp.fx(p_k) and installment_number = p_n $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.hoje(), pg_temp.sqlstate_of(text),
  pg_temp.parcela(text, integer), pg_temp.status_parcela(text, integer) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000044a1', 'a1@teste.com'),
  ('00000000-0000-0000-0000-0000000044a2', 'a2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000044a1');
insert into fixture select 'h', public.create_household('Casa Dividas');

-- consignado de 3 parcelas de 500 sobre saldo de 1000: quitar as duas primeiras zera o saldo e sobra a 3ª planejada
insert into fixture select 'quita', public.create_debt('Consignado quitável', 'loan', pg_temp.hoje() - 10, 1000);
select public.debt_contract_set(pg_temp.fx('quita'), 'Banco', null, 3, 3, 500.00, 5, 'payroll', null,
  (date_trunc('month', pg_temp.hoje()) + interval '1 month' + interval '4 days')::date);

select is(pg_temp.sqlstate_of($$select public.debt_archive(pg_temp.fx('quita'))$$), '23514', 'A1 com saldo: recusa arquivar');
select is((select active from public.debts where id = pg_temp.fx('quita')), true, 'A1.1 e continua ativa');
select is((select count(*) from public.debt_payment_schedule where debt_id = pg_temp.fx('quita') and status = 'planned'), 3::bigint, 'A1.2 a agenda não foi mexida pela recusa');

select public.debt_schedule_record_payment(pg_temp.parcela('quita', 1), pg_temp.hoje(), null, 500, 0, 0, null, false);
select public.debt_schedule_record_payment(pg_temp.parcela('quita', 2), pg_temp.hoje(), null, 500, 0, 0, null, false);
select is((select debt from public.debt_balances(pg_temp.fx('h'), pg_temp.hoje()) where debt_id = pg_temp.fx('quita')), 0::numeric, 'A2 duas parcelas pagas: saldo zerado');
select is(pg_temp.status_parcela('quita', 3), 'planned', 'A2.1 a 3ª parcela segue planejada (sobra do contrato)');

select lives_ok($$select public.debt_archive(pg_temp.fx('quita'))$$, 'A3 quitada: arquiva');
select is((select active from public.debts where id = pg_temp.fx('quita')), false, 'A3.1 ficou arquivada');
select is(pg_temp.status_parcela('quita', 3), 'cancelled', 'A3.2 a parcela planejada que sobrou foi cancelada (não vira compromisso futuro)');
select is(pg_temp.status_parcela('quita', 1) || '/' || pg_temp.status_parcela('quita', 2), 'paid/paid', 'A3.3 as pagas continuam pagas');
select is((select remaining_installments from public.debts where id = pg_temp.fx('quita')), 0, 'A3.4 parcelas restantes zeradas');
select is((select count(*) from public.debt_events where debt_id = pg_temp.fx('quita') and kind = 'payroll_payment' and voided_at is null), 2::bigint, 'A3.5 o histórico de pagamentos fica');
select is((select count(*) from public.debt_balances(pg_temp.fx('h'), pg_temp.hoje()) where debt_id = pg_temp.fx('quita') and planned_remaining <> 0), 0::bigint, 'A3.6 sem compromisso futuro');

select lives_ok($$select public.debt_archive(pg_temp.fx('quita'))$$, 'A4 arquivar de novo não dá erro');
select lives_ok($$select public.debt_unarchive(pg_temp.fx('quita'))$$, 'A5 reativa');
select is((select active from public.debts where id = pg_temp.fx('quita')), true, 'A5.1 voltou a ativa');
select is(pg_temp.status_parcela('quita', 3), 'cancelled', 'A5.2 reativar não recria a parcela cancelada');
select is(pg_temp.sqlstate_of($$select public.debt_delete(pg_temp.fx('quita'))$$), '23503', 'A6 quitada com pagamentos: não exclui (só arquivar)');

-- dívida sem contrato e sem movimento: arquiva (saldo zero) e exclui
insert into fixture select 'zero', public.create_debt('Sem nada', 'loan', pg_temp.hoje() - 10, 0);
select lives_ok($$select public.debt_archive(pg_temp.fx('zero'))$$, 'B1 sem contrato e sem saldo: arquiva');
select is((select remaining_installments from public.debts where id = pg_temp.fx('zero')), null, 'B1.1 sem contrato, parcelas restantes seguem nulas');

-- contrato novo, nada pago: excluir leva a agenda junto
insert into fixture select 'virgem', public.create_debt('Contrato errado', 'financing', pg_temp.hoje() - 10, 900);
select public.debt_contract_set(pg_temp.fx('virgem'), 'Banco', null, 3, 3, 300.00, 5, 'payroll', null,
  (date_trunc('month', pg_temp.hoje()) + interval '1 month' + interval '4 days')::date);
select is((select count(*) from public.debt_payment_schedule where debt_id = pg_temp.fx('virgem')), 3::bigint, 'C1 contrato novo tem 3 parcelas planejadas');
select lives_ok($$select public.debt_delete(pg_temp.fx('virgem'))$$, 'C2 nada foi pago: exclui');
select is((select count(*) from public.debts where id = pg_temp.fx('virgem')), 0::bigint, 'C2.1 a dívida saiu');
select is((select count(*) from public.debt_payment_schedule where debt_id = pg_temp.fx('virgem')), 0::bigint, 'C2.2 e a agenda planejada saiu junto');

-- uma parcela paga: já tem histórico
insert into fixture select 'paga1', public.create_debt('Com um pagamento', 'loan', pg_temp.hoje() - 10, 900);
select public.debt_contract_set(pg_temp.fx('paga1'), 'Banco', null, 3, 3, 300.00, 5, 'payroll', null,
  (date_trunc('month', pg_temp.hoje()) + interval '1 month' + interval '4 days')::date);
select public.debt_schedule_record_payment(pg_temp.parcela('paga1', 1), pg_temp.hoje(), null, 300, 0, 0, null, false);
select is(pg_temp.sqlstate_of($$select public.debt_delete(pg_temp.fx('paga1'))$$), '23503', 'D1 com parcela paga: não exclui');
select is(pg_temp.sqlstate_of($$select public.debt_archive(pg_temp.fx('paga1'))$$), '23514', 'D2 com saldo: não arquiva');

-- outra família não mexe
select pg_temp.login('00000000-0000-0000-0000-0000000044a2');
select is(pg_temp.sqlstate_of($$select public.debt_archive(pg_temp.fx('paga1'))$$), '42501', 'E1 quem não é da família não arquiva');
select is(pg_temp.sqlstate_of($$select public.debt_delete(pg_temp.fx('paga1'))$$), '42501', 'E2 nem exclui');

select * from finish();
rollback;
