-- 25_recurrence_delete: migration 018. Excluir recorrente: a regra some; planejados de hoje em diante vão para a lixeira;
-- vencidos não pagos, pagos e compras de cartão já geradas ficam intactos (só perdem o vínculo com a regra).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create temp table fixture (k text primary key, v uuid);
grant all on fixture to public;
create temp table antes (k text primary key, n numeric);
grant all on antes to public;
create function pg_temp.fx(p_k text) returns uuid language sql as $f$ select v from fixture where k = p_k $f$;
create function pg_temp.login(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $f$;
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
create function pg_temp.hoje() returns date language sql as $f$ select (now() at time zone 'America/Sao_Paulo')::date $f$;
create function pg_temp.mes(n integer) returns date language sql as $f$
  select (date_trunc('month', pg_temp.hoje()) + make_interval(months => n))::date $f$;
create function pg_temp.n(p_sql text) returns numeric language plpgsql as $f$
declare r numeric; begin execute p_sql into r; return r; end $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.sqlstate_of(text), pg_temp.hoje(),
  pg_temp.mes(integer), pg_temp.n(text) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000025a1', 'rd1@teste.com'),
  ('00000000-0000-0000-0000-0000000025a2', 'rd2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000025a1');
insert into fixture select 'h', public.create_household('Casa Exclusão');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 1000, pg_temp.mes(-12)) returning id)
  insert into fixture select 'bank', id from i;
insert into fixture select 'cexp', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';
insert into fixture select 'card', public.create_debt('Cartão', 'card', pg_temp.mes(-6), 0);
select public.set_card_cycle(pg_temp.fx('card'), 17, 25);

-- regra de despesa em conta (dia 5, começou há 2 meses) e assinatura de cartão (dia 5, começou há 2 meses)
insert into fixture select 'rc', public.recurrence_create('expense', 'Luz', 10, 5, pg_temp.mes(-2), pg_temp.fx('bank'), null, null, pg_temp.fx('cexp'));
insert into fixture select 'rk', public.recurrence_create('card', 'Streaming', 20, 5, pg_temp.mes(-2), null, null, pg_temp.fx('card'), pg_temp.fx('cexp'));
select public.recurrence_materialize();

-- uma ocorrência antiga paga (a mais antiga), e a conta conciliada até a data dela: pago em período conciliado não pode mudar
update public.transactions set status = 'paid'
 where id = (select id from public.transactions where recurrence_id = pg_temp.fx('rc') order by date limit 1);
create temp table datas (k text primary key, d date);
grant all on datas to public;
insert into datas select 'paga', date from public.transactions where recurrence_id = pg_temp.fx('rc') and status = 'paid';
select public.reconcile_account(pg_temp.fx('bank'), (select d from datas where k = 'paga'),
  (select balance from public.account_balances(pg_temp.fx('h'), (select d from datas where k = 'paga')) where account_id = pg_temp.fx('bank')));

-- retrato antes de excluir
insert into antes values
  ('futuros', pg_temp.n($$select count(*) from public.transactions where recurrence_id = pg_temp.fx('rc') and status = 'planned' and deleted_at is null and date >= pg_temp.hoje()$$)),
  ('vencidos', pg_temp.n($$select count(*) from public.transactions where recurrence_id = pg_temp.fx('rc') and status = 'planned' and deleted_at is null and date < pg_temp.hoje()$$)),
  ('pagos', pg_temp.n($$select count(*) from public.transactions where recurrence_id = pg_temp.fx('rc') and status = 'paid'$$)),
  ('parcelas', pg_temp.n($$select count(*) from public.debt_installments where recurrence_id = pg_temp.fx('rk')$$)),
  ('divida', pg_temp.n($$select debt + planned_remaining from public.debt_balances(pg_temp.fx('h'), pg_temp.hoje()) where debt_id = pg_temp.fx('card')$$));

select ok((select n from antes where k = 'futuros') >= 1, 'RD0 há planejados de hoje em diante para testar');
select ok((select n from antes where k = 'parcelas') >= 1, 'RD0 a assinatura do cartão já gerou compras');
select is((select n from antes where k = 'pagos'), 1::numeric, 'RD0 uma ocorrência paga em período conciliado');

-- RD1 a regra de conta: devolve quantos foram para a lixeira e some
select is((select public.recurrence_delete(pg_temp.fx('rc')))::numeric, (select n from antes where k = 'futuros'),
          'RD1 devolve quantos planejados de hoje em diante foram para a lixeira');
select is((select count(*) from public.recurrences where id = pg_temp.fx('rc')), 0::bigint, 'RD2 a regra foi excluída (não fica como encerrada)');
select is((select count(*) from public.transactions where id in (select id from public.transactions) and recurrence_id = pg_temp.fx('rc')), 0::bigint,
          'RD3 nenhum lançamento continua ligado à regra excluída');

reset role;
select is((select count(*) from public.transactions where description = 'Luz' and status = 'planned' and deleted_at is not null and date >= pg_temp.hoje())::numeric,
          (select n from antes where k = 'futuros'), 'RD4 os planejados de hoje em diante estão na lixeira (restauráveis)');
select is((select count(*) from public.transactions where description = 'Luz' and status = 'paid' and deleted_at is null)::numeric, 1::numeric,
          'RD5 o lançamento pago continua intacto, mesmo em período conciliado');
select is((select count(*) from public.transactions where description = 'Luz' and status = 'planned' and deleted_at is null and date < pg_temp.hoje())::numeric,
          (select n from antes where k = 'vencidos'), 'RD6 os planejados vencidos e não pagos continuam para a pessoa decidir');
select is((select count(*) from public.transactions where description = 'Luz' and recurrence_id is not null), 0::bigint,
          'RD7 os lançamentos que ficaram perderam só o vínculo com a regra');
select pg_temp.login('00000000-0000-0000-0000-0000000025a1');

-- RD8 assinatura de cartão: as compras já geradas ficam, a dívida não muda, a regra some
select is((select public.recurrence_delete(pg_temp.fx('rk'))), 0, 'RD8 assinatura de cartão não tem planejado em conta para mandar à lixeira');
select is((select count(*) from public.debt_installments where description = 'Streaming' and recurrence_id is null)::numeric,
          (select n from antes where k = 'parcelas'), 'RD9 as compras já feitas no cartão continuam, sem o vínculo');
select is(pg_temp.n($$select debt + planned_remaining from public.debt_balances(pg_temp.fx('h'), pg_temp.hoje()) where debt_id = pg_temp.fx('card')$$),
          (select n from antes where k = 'divida'), 'RD10 a dívida do cartão não mudou');
select is((select count(*) from public.recurrences where id = pg_temp.fx('rk')), 0::bigint, 'RD11 a assinatura foi excluída');

-- RD12 regra já encerrada também pode ser excluída (os "Encerrados" antigos)
insert into fixture select 're', public.recurrence_create('expense', 'Academia', 90, 10, pg_temp.mes(-1), pg_temp.fx('bank'), null, null, pg_temp.fx('cexp'));
select public.recurrence_materialize();
select lives_ok($select public.recurrence_end(pg_temp.fx('re'), pg_temp.hoje())$, 'RD12 finalizar exclui a regra diretamente');
select is((select count(*) from public.recurrences where id = pg_temp.fx('re')), 0::bigint, 'RD12 a regra finalizada não fica arquivada');
select is((select count(*) from public.transactions where description = 'Academia' and recurrence_id is not null), 0::bigint,
          'RD12 lançamentos históricos perdem o vínculo com a regra finalizada');

-- RD13 excluir de novo: a regra não existe mais
select is(pg_temp.sqlstate_of($$select public.recurrence_delete(pg_temp.fx('re'))$$), '42501', 'RD13 excluir duas vezes: registro não encontrado');

-- RD14 o cliente não apaga direto na tabela (só pela função)
insert into fixture select 'rx', public.recurrence_create('expense', 'Água', 50, 8, pg_temp.mes(0), pg_temp.fx('bank'), null, null, pg_temp.fx('cexp'));
select is(pg_temp.sqlstate_of(format('delete from public.recurrences where id = %L', pg_temp.fx('rx'))), '42501', 'RD14 o cliente não exclui direto na tabela');

-- RD15 quem não é da família não exclui nem descobre
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000025a2');
insert into fixture select 'h2', public.create_household('Outra Casa');
select is(pg_temp.sqlstate_of(format('select public.recurrence_delete(%L)', pg_temp.fx('rx'))), '42501', 'RD15 outra família não exclui a regra');
reset role;
select is((select count(*) from public.recurrences where id = pg_temp.fx('rx')), 1::bigint, 'RD15 a regra continua existindo');

-- RD16 sem login
select is(pg_temp.sqlstate_of(format('select public.recurrence_delete(%L)', pg_temp.fx('rx'))), '42501', 'RD16 sem login (auth.uid nulo) não exclui');

select * from finish();
rollback;
