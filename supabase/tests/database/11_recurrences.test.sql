-- 11_recurrences: migration 006. Regras recorrentes em conta (planejados até 2 meses à frente) e
-- assinatura no cartão (compra no dia da ocorrência), idempotência, edição, encerramento e isolamento.
-- As datas são relativas a hoje (São Paulo): a geração depende do relógio.
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
-- hoje em SP e início do mês, deslocado em n meses
create function pg_temp.hoje() returns date language sql as $f$ select (now() at time zone 'America/Sao_Paulo')::date $f$;
create function pg_temp.mes(n integer) returns date language sql as $f$
  select (date_trunc('month', pg_temp.hoje()) + make_interval(months => n))::date $f$;
create function pg_temp.datas(p_rec uuid) returns date[] language sql as $f$
  select coalesce(array_agg(date order by date), '{}') from public.transactions
   where recurrence_id = p_rec and deleted_at is null $f$;
grant execute on function pg_temp.fx(text), pg_temp.sqlstate_of(text), pg_temp.hoje(), pg_temp.mes(integer),
  pg_temp.datas(uuid) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000011a1', 'rc1@teste.com'),
  ('00000000-0000-0000-0000-0000000011a2', 'rc2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000011a1');
insert into fixture select 'h', public.create_household('Casa Recorrente');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 1000, pg_temp.mes(-6)) returning id)
  insert into fixture select 'bank', id from i;
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Poupança', 'savings', 0, pg_temp.mes(-6)) returning id)
  insert into fixture select 'poup', id from i;
insert into fixture select 'cexp', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';
insert into fixture select 'cinc', id from public.categories where household_id = pg_temp.fx('h') and type = 'income' and system_key is null limit 1;
insert into fixture select 'card', public.create_debt('Nubank', 'card', pg_temp.mes(-6), 0);
select public.set_card_cycle(pg_temp.fx('card'), 17, 25);

-- RC1: validações e forma
select is(pg_temp.sqlstate_of($$select public.recurrence_create('expense', 'Luz', 0, 10, pg_temp.mes(0), pg_temp.fx('bank'), null, null, pg_temp.fx('cexp'))$$),
          '22023', 'RC1 valor zero: recusado');
select is(pg_temp.sqlstate_of($$select public.recurrence_create('expense', 'Luz', 10, 32, pg_temp.mes(0), pg_temp.fx('bank'), null, null, pg_temp.fx('cexp'))$$),
          '22023', 'RC1 dia 32: recusado');
select is(pg_temp.sqlstate_of($$select public.recurrence_create('expense', 'Luz', 10, 10, pg_temp.mes(0), pg_temp.fx('bank'), null, null, null)$$),
          '23514', 'RC1 despesa sem categoria: recusada');
select is(pg_temp.sqlstate_of($$select public.recurrence_create('income', 'Salário', 10, 5, pg_temp.mes(0), pg_temp.fx('bank'), null, null, pg_temp.fx('cexp'))$$),
          '23503', 'RC1 receita com categoria de despesa: recusada pela FK');
select is(pg_temp.sqlstate_of($$select public.recurrence_create('card', 'Netflix', 55.90, 5, pg_temp.mes(0), null, null, pg_temp.fx('bank'), pg_temp.fx('cexp'))$$),
          '23514', 'RC1 assinatura fora de cartão: recusada');
select is(pg_temp.sqlstate_of($$select public.recurrence_create('expense', 'Luz', 10.001, 10, pg_temp.mes(0), pg_temp.fx('bank'), null, null, pg_temp.fx('cexp'))$$),
          '22003', 'RC1 mais de 2 casas: recusado');

-- RC2: despesa mensal em conta desde 2 meses atrás, dia 10: gera de mês −2 até mês +2 (5 planejados)
insert into fixture select 'luz', public.recurrence_create('expense', 'Luz', 180.00, 10, pg_temp.mes(-2), pg_temp.fx('bank'), null, null, pg_temp.fx('cexp'));
select is(public.recurrence_materialize(), 5, 'RC2 primeira geração: 5 lançamentos (mês −2 a +2)');
select is(pg_temp.datas(pg_temp.fx('luz')),
          array[pg_temp.mes(-2) + 9, pg_temp.mes(-1) + 9, pg_temp.mes(0) + 9, pg_temp.mes(1) + 9, pg_temp.mes(2) + 9],
          'RC2 todo dia 10');
select is((select array_agg(distinct status || '|' || amount || '|' || type) from public.transactions where recurrence_id = pg_temp.fx('luz')),
          array['planned|180.00|expense'], 'RC2 planejados de despesa, valor da regra');

-- RC3: idempotente
select is(public.recurrence_materialize(), 0, 'RC3 segunda geração: nada novo');

-- RC4: corrigir o valor de um mês e pagar (fluxo normal de Lançamentos)
select lives_ok($$update public.transactions set amount = 187.40, status = 'paid'
                   where recurrence_id = pg_temp.fx('luz') and date = pg_temp.mes(-1) + 9$$,
                'RC4 conta chegou: valor corrigido e pago');

-- RC5: ocorrência excluída não volta
select lives_ok($$update public.transactions set deleted_at = now()
                   where recurrence_id = pg_temp.fx('luz') and date = pg_temp.mes(1) + 9$$, 'RC5 exclui o mês +1');
select is(public.recurrence_materialize(), 0, 'RC5 geração não recria o excluído');

-- RC6: mudar a regra vale para planejados de hoje em diante; pagos e passados ficam
select lives_ok($$select public.recurrence_update(pg_temp.fx('luz'), 'Conta de luz', 200.00)$$, 'RC6 reajuste para 200');
select is((select amount from public.transactions where recurrence_id = pg_temp.fx('luz') and date = pg_temp.mes(-1) + 9),
          187.40, 'RC6 mês pago não muda');
select is((select amount from public.transactions where recurrence_id = pg_temp.fx('luz') and date = pg_temp.mes(2) + 9),
          200.00, 'RC6 planejado futuro passa a 200');
select is((select description from public.transactions where recurrence_id = pg_temp.fx('luz') and date = pg_temp.mes(2) + 9),
          'Conta de luz', 'RC6 descrição atualizada');

-- RC7: dia 31 vira o último dia do mês; transferência e receita também geram
insert into fixture select 'poupar', public.recurrence_create('transfer', 'Guardar', 500.00, 31, pg_temp.mes(0), pg_temp.fx('bank'), pg_temp.fx('poup'));
insert into fixture select 'sal', public.recurrence_create('income', 'Salário', 8000.00, 5, pg_temp.mes(0), pg_temp.fx('bank'), null, null, pg_temp.fx('cinc'));
select is(public.recurrence_materialize(), 6, 'RC7 transferência e salário: 3 meses cada');
select is(pg_temp.datas(pg_temp.fx('poupar')),
          array[(pg_temp.mes(1) - 1), (pg_temp.mes(2) - 1), (pg_temp.mes(3) - 1)],
          'RC7 dia 31 = último dia de cada mês');

-- RC8: assinatura no cartão — só até hoje, compra à vista que entra na fatura pelo fechamento
insert into fixture select 'netflix', public.recurrence_create('card', 'Netflix', 55.90, 1, pg_temp.mes(-1), null, null, pg_temp.fx('card'), pg_temp.fx('cexp'));
select is(public.recurrence_materialize(), 2, 'RC8 assinatura dia 1: mês −1 e este mês (nunca futuro)');
select is((select array_agg(purchase_date || '|' || due_date || '|' || face || '|' || description order by purchase_date)
             from public.debt_installments where recurrence_id = pg_temp.fx('netflix')),
          array[pg_temp.mes(-1) || '|' || (pg_temp.mes(-1) + 16) || '|55.90|Netflix',
                pg_temp.mes(0)  || '|' || (pg_temp.mes(0)  + 16) || '|55.90|Netflix'],
          'RC8 compra no dia 1 cai na fatura que fecha dia 17 do mesmo mês');
select is(public.recurrence_materialize(), 0, 'RC8 idempotente no cartão');

-- RC9: encerrar para de gerar e manda planejados futuros para a lixeira; a conta pode ser desativada
select lives_ok($$select public.recurrence_end(pg_temp.fx('luz'))$$, 'RC9 encerra a luz hoje');
select is((select count(*) from public.transactions
            where recurrence_id = pg_temp.fx('luz') and deleted_at is null and date > pg_temp.hoje()), 0::bigint,
          'RC9 nenhum planejado futuro da luz');
select is((select count(*) from public.transactions where recurrence_id = pg_temp.fx('luz') and status = 'paid'), 1::bigint,
          'RC9 o mês pago continua');
select is(public.recurrence_materialize(), 0, 'RC9 regra encerrada não gera mais');

-- RC10: cliente não grava nem altera regra nem forja o vínculo direto
select is(pg_temp.sqlstate_of($$insert into public.recurrences (household_id, kind, description, amount, day, start_date, account_id, category_id)
          values (pg_temp.fx('h'), 'expense', 'x', 1, 1, pg_temp.mes(0), pg_temp.fx('bank'), pg_temp.fx('cexp'))$$),
          '42501', 'RC10 INSERT direto em recurrences: sem privilégio');
select is(pg_temp.sqlstate_of($$update public.transactions set recurrence_id = null where recurrence_id = pg_temp.fx('sal')$$),
          '42501', 'RC10 cliente não altera recurrence_id');

-- RC11: isolamento
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000011a2');
select public.create_household('Outra Casa');
select is((select count(*) from public.recurrences), 0::bigint, 'RC11 outra família não vê as regras');
select is(pg_temp.sqlstate_of($$select public.recurrence_update(pg_temp.fx('sal'), 'x', 1)$$), '42501', 'RC11 não edita regra alheia');
select is(pg_temp.sqlstate_of($$select public.recurrence_end(pg_temp.fx('sal'))$$), '42501', 'RC11 não encerra regra alheia');
select is(public.recurrence_materialize(), 0, 'RC11 geração da outra família não toca nas regras alheias');

select * from finish();
rollback;
