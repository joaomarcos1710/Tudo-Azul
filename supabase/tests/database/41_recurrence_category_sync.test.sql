-- 41_recurrence_category_sync: migration 036. Trocar a categoria do recorrente vale para as ocorrências passadas e
-- futuras, pagas ou não, e para as parcelas de assinatura de cartão, sem desfazer o que foi mudado à mão.
-- Datas relativas a hoje em São Paulo; os casos de "passado" e "futuro" usam meses inteiros para não depender do dia.
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
-- dia 15 do mês (hoje + n meses)
create function pg_temp.d15(n integer) returns date language sql as $f$
  select (date_trunc('month', pg_temp.hoje()) + make_interval(months => n))::date + 14 $f$;
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
create function pg_temp.cat_de(p_rec text, p_date date) returns uuid language sql as $f$
  select category_id from public.transactions where recurrence_id = pg_temp.fx(p_rec) and date = p_date $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.hoje(), pg_temp.d15(integer),
  pg_temp.sqlstate_of(text), pg_temp.cat_de(text, date) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000041a1', 'r1@teste.com'),
  ('00000000-0000-0000-0000-0000000041a2', 'r2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000041a1');
insert into fixture select 'h', public.create_household('Casa Recorrente');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 0, pg_temp.d15(-6)) returning id)
  insert into fixture select 'bank', id from i;
with c as (insert into public.categories (household_id, name, type) values (pg_temp.fx('h'), 'Categoria velha', 'expense') returning id)
  insert into fixture select 'velha', id from c;
with c as (insert into public.categories (household_id, name, type) values (pg_temp.fx('h'), 'Categoria nova', 'expense') returning id)
  insert into fixture select 'nova', id from c;
with c as (insert into public.categories (household_id, name, type) values (pg_temp.fx('h'), 'Escolhida a mao', 'expense') returning id)
  insert into fixture select 'manual', id from c;
with c as (insert into public.categories (household_id, name, type) values (pg_temp.fx('h'), 'Receita X', 'income') returning id)
  insert into fixture select 'receita', id from c;

-- ---- recorrente de conta: ocorrências nos meses -3 a +4 (dia 15) ----
insert into fixture select 'rec', public.recurrence_create('expense', 'Academia', 100.00, 15, pg_temp.d15(-3), pg_temp.fx('bank'), null, null, pg_temp.fx('velha'));
select public.recurrence_materialize();
select is((select count(*) from public.transactions where recurrence_id = pg_temp.fx('rec') and date between pg_temp.d15(-3) and pg_temp.d15(4)),
          8::bigint, 'P0 oito ocorrências (meses -3 a +4)');

-- estado de partida: -3 paga; -2 categoria escolhida à mão; -1 na lixeira; +2 (futuro) escolhida à mão
update public.transactions set status = 'paid' where recurrence_id = pg_temp.fx('rec') and date = pg_temp.d15(-3);
update public.transactions set category_id = pg_temp.fx('manual') where recurrence_id = pg_temp.fx('rec') and date in (pg_temp.d15(-2), pg_temp.d15(2));
update public.transactions set deleted_at = now() where recurrence_id = pg_temp.fx('rec') and date = pg_temp.d15(-1);

select public.recurrence_update(pg_temp.fx('rec'), 'Academia', 150.00, pg_temp.fx('nova'));

-- A paga no passado acompanha a nova categoria, mas NÃO muda de valor, data nem status
select is(pg_temp.cat_de('rec', pg_temp.d15(-3)), pg_temp.fx('nova'), 'A1 paga no passado: categoria nova');
select is((select amount::numeric(14,2) || '|' || status from public.transactions where recurrence_id = pg_temp.fx('rec') and date = pg_temp.d15(-3)),
          '100.00|paid', 'A1.1 e continua com o valor e o status que tinha');
-- B editada à mão: fica
select is(pg_temp.cat_de('rec', pg_temp.d15(-2)), pg_temp.fx('manual'), 'B1 passada com categoria escolhida à mão: preservada');
select is(pg_temp.cat_de('rec', pg_temp.d15(2)), pg_temp.fx('manual'), 'B2 futura com categoria escolhida à mão: preservada');
-- C lixeira
select is(pg_temp.cat_de('rec', pg_temp.d15(-1)), pg_temp.fx('nova'), 'C1 na lixeira também (restaurar não traz a velha de volta)');
select is((select deleted_at is not null from public.transactions where recurrence_id = pg_temp.fx('rec') and date = pg_temp.d15(-1)), true, 'C1.1 e segue na lixeira');
-- D futuras: categoria e valor novos
select is(pg_temp.cat_de('rec', pg_temp.d15(3)), pg_temp.fx('nova'), 'D1 futura não editada: categoria nova');
select is((select amount::numeric(14,2) from public.transactions where recurrence_id = pg_temp.fx('rec') and date = pg_temp.d15(3)),
          150.00::numeric, 'D1.1 e valor novo (como na 015)');
-- E ninguém ficou na categoria velha, exceto nada; e nada foi duplicado
select is((select count(*) from public.transactions where recurrence_id = pg_temp.fx('rec') and category_id = pg_temp.fx('velha')), 0::bigint,
          'E1 nenhuma ocorrência ficou com a categoria velha');
select is((select count(*) from public.transactions where recurrence_id = pg_temp.fx('rec') and date between pg_temp.d15(-3) and pg_temp.d15(4)),
          8::bigint, 'E2 nada duplicado nem perdido');
-- F relatório: a despesa paga do mês -3 aparece na categoria nova
select is((select amount::numeric(14,2) from public.expenses_by_category(pg_temp.fx('h'), pg_temp.d15(-3) - 14, pg_temp.d15(-3) + 15) where category_id = pg_temp.fx('nova')),
          100.00::numeric, 'F1 expenses_by_category enxerga a paga na categoria nova');

-- G trocar para a MESMA categoria não mexe em nada; categoria de outro tipo é recusada
select lives_ok($$select public.recurrence_update(pg_temp.fx('rec'), 'Academia', 150.00, pg_temp.fx('nova'))$$, 'G1 repetir a mesma categoria: nada a fazer');
select is(pg_temp.cat_de('rec', pg_temp.d15(-2)), pg_temp.fx('manual'), 'G1.1 e a escolhida à mão continua');
select is(pg_temp.sqlstate_of($$select public.recurrence_update(pg_temp.fx('rec'), 'Academia', 150.00, pg_temp.fx('receita'))$$) is not null, true,
          'G2 categoria de receita numa despesa: recusada');
select is((select count(*) from public.transactions where recurrence_id = pg_temp.fx('rec') and category_id = pg_temp.fx('receita')), 0::bigint,
          'G2.1 e nada ficou pela metade');

-- ---- transferência: sem categoria, nada a propagar ----
with a as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Poupanca', 'savings', 0, pg_temp.d15(-6)) returning id)
  insert into fixture select 'poup', id from a;
insert into fixture select 'rect', public.recurrence_create('transfer', 'Reserva', 50.00, 15, pg_temp.d15(-2), pg_temp.fx('bank'), pg_temp.fx('poup'));
select public.recurrence_materialize();
select lives_ok($$select public.recurrence_update(pg_temp.fx('rect'), 'Reserva', 60.00, null)$$, 'H1 transferência segue funcionando');
select is((select count(*) from public.transactions where recurrence_id = pg_temp.fx('rect') and category_id is not null), 0::bigint, 'H1.1 e continua sem categoria');

-- ---- assinatura de cartão: as ocorrências são parcelas ----
insert into fixture select 'cartao', public.create_debt('Cartão', 'card', pg_temp.d15(-6), 0);
select public.set_card_cycle(pg_temp.fx('cartao'), 17, 25);
insert into fixture select 'recc', public.recurrence_create('card', 'Streaming', 20.00, 5, pg_temp.d15(-3) - 10, null, null, pg_temp.fx('cartao'), pg_temp.fx('velha'));
select public.recurrence_materialize();
select ok((select count(*) from public.debt_installments where recurrence_id = pg_temp.fx('recc')) >= 3, 'K0 a assinatura gerou parcelas passadas');
select public.recurrence_update(pg_temp.fx('recc'), 'Streaming', 20.00, pg_temp.fx('nova'));
select is((select count(*) from public.debt_installments where recurrence_id = pg_temp.fx('recc') and category_id = pg_temp.fx('velha')), 0::bigint,
          'K1 nenhuma parcela da assinatura ficou na categoria velha');
select is((select count(*) from public.debt_installments where recurrence_id = pg_temp.fx('recc') and category_id = pg_temp.fx('nova')),
          (select count(*) from public.debt_installments where recurrence_id = pg_temp.fx('recc')), 'K1.1 todas foram para a nova');
select is((select string_agg(distinct face::numeric(14,2)::text, ',') from public.debt_installments where recurrence_id = pg_temp.fx('recc')),
          '20.00', 'K2 o valor das parcelas não mudou');
select is((select current_setting('app.recurrence_category', true)), 'off', 'K3 o sinal de exceção é desligado ao fim da função');
-- a trava de imutabilidade continua barrando qualquer outro caminho
select is(pg_temp.sqlstate_of($$update public.debt_installments set category_id = pg_temp.fx('velha') where recurrence_id = pg_temp.fx('recc')$$),
          '42501', 'K4 o cliente não troca a categoria de parcela por fora da função');

-- ---- outra família e anon ----
select pg_temp.login('00000000-0000-0000-0000-0000000041a2');
insert into fixture select 'h2', public.create_household('Casa Outra');
select is(pg_temp.sqlstate_of($$select public.recurrence_update(pg_temp.fx('rec'), 'X', 1.00, pg_temp.fx('manual'))$$), '42501', 'Z1 recorrente de outra família: 42501');
select set_config('request.jwt.claims', '{}', true), set_config('role', 'anon', true);
select is(pg_temp.sqlstate_of($$select public.recurrence_update(pg_temp.fx('rec'), 'X', 1.00, pg_temp.fx('manual'))$$), '42501', 'Z2 anon: 42501');

select * from finish();
rollback;
