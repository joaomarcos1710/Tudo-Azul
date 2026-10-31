-- 27_archive_delete: migration 020. Arquivar/reativar/excluir cartão (dívida) e excluir conta.
-- Arquivar: some das escolhas e o histórico fica; recusa dívida com saldo, parcelas a vencer ou recorrente ativo.
-- Excluir: só o que nunca teve movimento. A API não apaga conta direto: account_delete é o único caminho.
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
create function pg_temp.anon() returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('role', 'anon', true);
end $f$;
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
create function pg_temp.hoje() returns date language sql as $f$ select (now() at time zone 'America/Sao_Paulo')::date $f$;
create function pg_temp.mes(n integer) returns date language sql as $f$
  select (date_trunc('month', pg_temp.hoje()) + make_interval(months => n))::date $f$;
create function pg_temp.conta(p_nome text) returns uuid language plpgsql as $f$
declare v uuid;
begin
  insert into public.accounts (household_id, name, type, initial_balance, opening_date)
  values (pg_temp.fx('h'), p_nome, 'checking', 100, pg_temp.mes(-12)) returning id into v;
  return v;
end $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.anon(), pg_temp.sqlstate_of(text), pg_temp.hoje(),
  pg_temp.mes(integer), pg_temp.conta(text) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000027a1', 'ad1@teste.com'),
  ('00000000-0000-0000-0000-0000000027a2', 'ad2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000027a1');
insert into fixture select 'h', public.create_household('Casa Arquivo');
insert into fixture select 'cexp', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';
insert into fixture select 'banco', pg_temp.conta('Banco');

-- ---- cartão sem movimento: excluir funciona ----
insert into fixture select 'novo', public.create_debt('Cartão errado', 'card', pg_temp.mes(-6), 0);
select is((select active from public.debts where id = pg_temp.fx('novo')), true, 'AD0 cartão novo nasce ativo');
select lives_ok($$select public.debt_delete(pg_temp.fx('novo'))$$, 'AD1 cartão sem movimento é excluído');
select is((select count(*) from public.debts where id = pg_temp.fx('novo')), 0::bigint, 'AD1.1 a linha sumiu');

-- ---- cartão com compra: não arquiva (parcelas a vencer) nem exclui ----
insert into fixture select 'usado', public.create_debt('Cartão usado', 'card', pg_temp.mes(-6), 0);
select public.set_card_cycle(pg_temp.fx('usado'), 17, 25);
insert into fixture select 'plano', public.card_purchase(pg_temp.fx('usado'), pg_temp.mes(0), 300.00, 3, pg_temp.fx('cexp'), 'Geladeira');
select is(pg_temp.sqlstate_of($$select public.debt_archive(pg_temp.fx('usado'))$$), '23514', 'AD2 não arquiva com parcelas a vencer');
select is((select active from public.debts where id = pg_temp.fx('usado')), true, 'AD2.1 continua ativo');
select is(pg_temp.sqlstate_of($$select public.debt_delete(pg_temp.fx('usado'))$$), '23503', 'AD3 não exclui cartão com compra');

-- ---- compra cancelada: saldo zero, arquiva; histórico impede excluir; reativa ----
select public.card_purchase_delete(pg_temp.fx('usado'), pg_temp.fx('plano')::text, 'lançada errada');
select lives_ok($$select public.debt_archive(pg_temp.fx('usado'))$$, 'AD4 arquiva com saldo e parcelas zerados');
select is((select active from public.debts where id = pg_temp.fx('usado')), false, 'AD4.1 ficou arquivado');
select is((select count(*) from public.debt_balances(pg_temp.fx('h'), pg_temp.hoje()) where debt_id = pg_temp.fx('usado')),
          1::bigint, 'AD4.2 a dívida arquivada continua em debt_balances (nada some dos totais)');
select is(pg_temp.sqlstate_of($$select public.debt_delete(pg_temp.fx('usado'))$$), '23503', 'AD5 arquivado com histórico não pode ser excluído');
select lives_ok($$select public.debt_unarchive(pg_temp.fx('usado'))$$, 'AD6 reativa');
select is((select active from public.debts where id = pg_temp.fx('usado')), true, 'AD6.1 voltou a ficar ativo');

-- ---- recorrente ativo no cartão impede arquivar; excluir a regra libera ----
insert into fixture select 'rec', public.recurrence_create('card', 'Streaming', 20, 5, pg_temp.mes(3), null, null, pg_temp.fx('usado'), pg_temp.fx('cexp'));
select is(pg_temp.sqlstate_of($$select public.debt_archive(pg_temp.fx('usado'))$$), '23514', 'AD7 não arquiva com recorrente ativo');
select public.recurrence_delete(pg_temp.fx('rec'));
select lives_ok($$select public.debt_archive(pg_temp.fx('usado'))$$, 'AD8 arquiva depois de excluir o recorrente');

-- ---- cartão que só tem recorrente (sem compra) não exclui ----
insert into fixture select 'sorec', public.create_debt('Cartão com regra', 'card', pg_temp.mes(-6), 0);
select public.set_card_cycle(pg_temp.fx('sorec'), 17, 25);
insert into fixture select 'rec2', public.recurrence_create('card', 'Assinatura', 10, 5, pg_temp.mes(3), null, null, pg_temp.fx('sorec'), pg_temp.fx('cexp'));
select is(pg_temp.sqlstate_of($$select public.debt_delete(pg_temp.fx('sorec'))$$), '23503', 'AD9 recorrente ligado impede excluir');

-- ---- dívida com saldo de abertura não arquiva ----
insert into fixture select 'devendo', public.create_debt('Cartão com saldo', 'card', pg_temp.mes(-1), 500);
select is(pg_temp.sqlstate_of($$select public.debt_archive(pg_temp.fx('devendo'))$$), '23514', 'AD10 saldo devedor impede arquivar');

-- ---- conta: excluir só sem movimento ----
insert into fixture select 'limpa', pg_temp.conta('Conta limpa');
select lives_ok($$select public.account_delete(pg_temp.fx('limpa'))$$, 'AC1 conta sem movimento é excluída');
select is((select count(*) from public.accounts where id = pg_temp.fx('limpa')), 0::bigint, 'AC1.1 a linha sumiu');

insert into fixture select 'comlanc', pg_temp.conta('Com lançamento');
insert into fixture select 'destino', pg_temp.conta('Só destino');
insert into fixture select 'lixeira', pg_temp.conta('Na lixeira');
insert into fixture select 'comreg', pg_temp.conta('Com regra');
insert into fixture select 'conferida', pg_temp.conta('Conferida');
insert into public.transactions (household_id, account_id, category_id, type, amount, date, status)
  values (pg_temp.fx('h'), pg_temp.fx('comlanc'), pg_temp.fx('cexp'), 'expense', 10, pg_temp.mes(-1), 'paid');
insert into public.transactions (household_id, account_id, destination_account_id, type, amount, date, status)
  values (pg_temp.fx('h'), pg_temp.fx('banco'), pg_temp.fx('destino'), 'transfer', 10, pg_temp.mes(-1), 'paid');
insert into public.transactions (household_id, account_id, category_id, type, amount, date, status)
  values (pg_temp.fx('h'), pg_temp.fx('lixeira'), pg_temp.fx('cexp'), 'expense', 10, pg_temp.mes(-1), 'paid');
update public.transactions set deleted_at = now() where account_id = pg_temp.fx('lixeira');
insert into fixture select 'regra', public.recurrence_create('expense', 'Luz', 10, 5, pg_temp.mes(3), pg_temp.fx('comreg'), null, null, pg_temp.fx('cexp'));
-- Fixture de registro anterior à descontinuação: a conta continua protegida contra cascade.
reset role;
insert into public.account_reconciliations (household_id, account_id, as_of, statement_balance, transactions, created_by)
values (pg_temp.fx('h'), pg_temp.fx('conferida'), pg_temp.mes(-6), 100.00, 0, null);
select pg_temp.login('00000000-0000-0000-0000-0000000027a1');

select is(pg_temp.sqlstate_of($$select public.account_delete(pg_temp.fx('comlanc'))$$), '23503', 'AC2 lançamento impede excluir');
select is(pg_temp.sqlstate_of($$select public.account_delete(pg_temp.fx('destino'))$$), '23503', 'AC3 destino de transferência impede excluir');
select is(pg_temp.sqlstate_of($$select public.account_delete(pg_temp.fx('lixeira'))$$), '23503', 'AC4 lançamento na lixeira também impede');
select is(pg_temp.sqlstate_of($$select public.account_delete(pg_temp.fx('comreg'))$$), '23503', 'AC5 recorrente ligado impede excluir');
select is(pg_temp.sqlstate_of($$select public.account_delete(pg_temp.fx('conferida'))$$), '23503', 'AC6 histórico legado impede excluir a conta (sem cascade)');
select is((select count(*) from public.account_reconciliations where account_id = pg_temp.fx('conferida')), 1::bigint, 'AC6.1 o registro histórico continua lá');

-- ---- outra família e anon ----
select pg_temp.login('00000000-0000-0000-0000-0000000027a2');
insert into fixture select 'h2', public.create_household('Casa Outra');
select is(pg_temp.sqlstate_of($$select public.debt_archive(pg_temp.fx('usado'))$$), '42501', 'AI1 arquivar cartão de outra família: 42501');
select is(pg_temp.sqlstate_of($$select public.debt_unarchive(pg_temp.fx('usado'))$$), '42501', 'AI2 reativar cartão de outra família: 42501');
select is(pg_temp.sqlstate_of($$select public.debt_delete(pg_temp.fx('devendo'))$$), '42501', 'AI3 excluir cartão de outra família: 42501');
select is(pg_temp.sqlstate_of($$select public.account_delete(pg_temp.fx('banco'))$$), '42501', 'AI4 excluir conta de outra família: 42501');
select is((select count(*) from public.debts where id = pg_temp.fx('devendo')), 0::bigint, 'AI5 e a outra família nem enxerga o cartão (RLS)');

select pg_temp.anon();
select is(pg_temp.sqlstate_of($$select public.debt_archive(pg_temp.fx('usado'))$$), '42501', 'AN1 anon não arquiva');
select is(pg_temp.sqlstate_of($$select public.debt_unarchive(pg_temp.fx('usado'))$$), '42501', 'AN2 anon não reativa');
select is(pg_temp.sqlstate_of($$select public.debt_delete(pg_temp.fx('devendo'))$$), '42501', 'AN3 anon não exclui cartão');
select is(pg_temp.sqlstate_of($$select public.account_delete(pg_temp.fx('banco'))$$), '42501', 'AN4 anon não exclui conta');

select * from finish();
rollback;
