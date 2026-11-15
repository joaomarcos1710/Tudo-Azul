-- 119_recurrence_next_dates: próxima cobrança REAL de cada recorrente de conta (migration 20261115140000, public.recurrence_next_dates).
-- Leitura pura. A data é a menor entre o lançamento PLANEJADO (fora da lixeira, de hoje em diante) e a ocorrência da regra que ainda não
-- virou lançamento. Ocorrência já paga (adiantada) ou na lixeira não é mais "próxima". Cartão, encerrada e desativada ficam de fora.
-- Datas relativas a hoje em São Paulo. Dados inventados. Sem a migration este arquivo falha (a função não existe).
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
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);
end $f$;
create function pg_temp.hoje() returns date language sql stable as $f$ select (now() at time zone 'America/Sao_Paulo')::date $f$;
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
-- a próxima data de uma regra (ou '-' se não há linha); por SQL dinâmico para a falta da função não abortar o arquivo
create function pg_temp.prox(p_h uuid, p_k text) returns text language plpgsql as $f$
declare r text;
begin
  execute $q$select coalesce((select next_date::text from public.recurrence_next_dates($1) where recurrence_id = $2), '-')$q$
    into r using p_h, pg_temp.fx(p_k);
  return r;
exception when others then return 'erro: ' || sqlerrm;
end $f$;
create function pg_temp.linhas(p_h uuid) returns text language plpgsql as $f$
declare r text;
begin
  execute $q$select count(*)::text from public.recurrence_next_dates($1)$q$ into r using p_h;
  return r;
exception when others then return 'erro: ' || sqlerrm;
end $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.anon(), pg_temp.hoje(), pg_temp.sqlstate_of(text),
  pg_temp.prox(uuid, text), pg_temp.linhas(uuid) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000119001', 'pr1@teste.com'),
  ('00000000-0000-0000-0000-000000119002', 'pr2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-000000119001');
insert into fixture select 'h', public.create_household('Casa das próximas datas');
with a as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 1000.00, '2020-01-01') returning id)
  insert into fixture select 'bank', id from a;
insert into fixture select 'cexp', id from public.categories where household_id = pg_temp.fx('h') and type = 'expense' order by name limit 1;
insert into fixture select 'card', public.create_debt('Cartão P', 'card', '2020-01-01', 0);
select public.set_card_cycle(pg_temp.fx('card'), 17, 25);

select is(pg_temp.linhas(pg_temp.fx('h')), '0', 'P1 sem recorrentes: nenhuma linha');

-- todas mensais no dia de hoje, começando há 3 meses (a ocorrência de hoje e as passadas existem como lançamento)
insert into fixture select 'paga',   public.recurrence_create('expense', 'Paga adiantada', 100.00, extract(day from pg_temp.hoje())::int, (pg_temp.hoje() - interval '3 months')::date, pg_temp.fx('bank'), null, null, pg_temp.fx('cexp'), null, 'month', 1);
insert into fixture select 'lixo',   public.recurrence_create('expense', 'Apagada', 100.00, extract(day from pg_temp.hoje())::int, (pg_temp.hoje() - interval '3 months')::date, pg_temp.fx('bank'), null, null, pg_temp.fx('cexp'), null, 'month', 1);
insert into fixture select 'movida', public.recurrence_create('expense', 'Data movida', 100.00, extract(day from pg_temp.hoje())::int, (pg_temp.hoje() - interval '3 months')::date, pg_temp.fx('bank'), null, null, pg_temp.fx('cexp'), null, 'month', 1);
insert into fixture select 'aberta', public.recurrence_create('expense', 'Em aberto', 100.00, extract(day from pg_temp.hoje())::int, (pg_temp.hoje() - interval '3 months')::date, pg_temp.fx('bank'), null, null, pg_temp.fx('cexp'), null, 'month', 1);
insert into fixture select 'fim',    public.recurrence_create('expense', 'Encerrada', 100.00, extract(day from pg_temp.hoje())::int, (pg_temp.hoje() - interval '3 months')::date, pg_temp.fx('bank'), null, null, pg_temp.fx('cexp'), null, 'month', 1);
insert into fixture select 'off',    public.recurrence_create('expense', 'Desativada', 100.00, extract(day from pg_temp.hoje())::int, (pg_temp.hoje() - interval '3 months')::date, pg_temp.fx('bank'), null, null, pg_temp.fx('cexp'), null, 'month', 1);
insert into fixture select 'cartao', public.recurrence_create('card', 'Assinatura', 30.00, extract(day from pg_temp.hoje())::int, (pg_temp.hoje() - interval '3 months')::date, null, null, pg_temp.fx('card'), pg_temp.fx('cexp'), null, 'month', 1);
select public.recurrence_materialize();

select ok((select count(*) from public.transactions where recurrence_id = pg_temp.fx('paga') and occurrence_date = pg_temp.hoje()) = 1,
  'P2 pré-condição: a ocorrência de hoje da Paga adiantada já virou lançamento');

-- "paga adiantada": a ocorrência de hoje foi paga dois dias antes
update public.transactions set status = 'paid', date = pg_temp.hoje() - 2
 where recurrence_id = pg_temp.fx('paga') and occurrence_date = pg_temp.hoje();
-- "apagada": a ocorrência de hoje foi para a lixeira (a geração não a traz de volta)
update public.transactions set deleted_at = now()
 where recurrence_id = pg_temp.fx('lixo') and occurrence_date = pg_temp.hoje();
-- "data movida": a ocorrência de hoje segue planejada, mas a pessoa passou a data para daqui a 3 dias
update public.transactions set date = pg_temp.hoje() + 3
 where recurrence_id = pg_temp.fx('movida') and occurrence_date = pg_temp.hoje();
-- encerrada e desativada (como superusuário: quem está logado não tem UPDATE direto na tabela; o app usa as RPCs de encerrar e apagar)
reset role;
update public.recurrences set end_date = pg_temp.hoje() - 1 where id = pg_temp.fx('fim');
update public.recurrences set active = false where id = pg_temp.fx('off');
select pg_temp.login('00000000-0000-0000-0000-000000119001');

select is(pg_temp.prox(pg_temp.fx('h'), 'paga'), (pg_temp.hoje() + interval '1 month')::date::text,
  'P3 ocorrência de hoje já paga (adiantada): a próxima é a do mês seguinte, não a de hoje');
select is(pg_temp.prox(pg_temp.fx('h'), 'lixo'), (pg_temp.hoje() + interval '1 month')::date::text,
  'P4 ocorrência de hoje apagada (lixeira): a próxima é a do mês seguinte');
select is(pg_temp.prox(pg_temp.fx('h'), 'movida'), (pg_temp.hoje() + 3)::text,
  'P5 lançamento planejado com a data movida: vale a data real (hoje + 3)');
select is(pg_temp.prox(pg_temp.fx('h'), 'aberta'), pg_temp.hoje()::text,
  'P6 ocorrência de hoje ainda planejada: a próxima é hoje');
select is(pg_temp.prox(pg_temp.fx('h'), 'fim'), '-', 'P7 regra encerrada: sem linha');
select is(pg_temp.prox(pg_temp.fx('h'), 'off'), '-', 'P8 regra desativada: sem linha');
select is(pg_temp.prox(pg_temp.fx('h'), 'cartao'), '-', 'P9 assinatura de cartão fica de fora (a tela segue pela regra)');
select is(pg_temp.linhas(pg_temp.fx('h')), '4', 'P10 quatro regras de conta com próxima data (paga, apagada, movida, em aberto)');

-- uma regra nova, ainda sem lançamento gerado: vale a data da regra (começa daqui a 10 dias)
insert into fixture select 'futura', public.recurrence_create('expense', 'Começa depois', 100.00, extract(day from pg_temp.hoje() + 10)::int, pg_temp.hoje() + 10, pg_temp.fx('bank'), null, null, pg_temp.fx('cexp'), null, 'month', 1);
select is(pg_temp.prox(pg_temp.fx('h'), 'futura'), (pg_temp.hoje() + 10)::text, 'P11 regra ainda sem lançamento gerado: vale a data da regra');

-- isolamento, anônimo e grants
select pg_temp.login('00000000-0000-0000-0000-000000119002');
select is(pg_temp.linhas(pg_temp.fx('h')), '0', 'P12 outro usuário não vê as datas da nossa família');
select pg_temp.anon();
select is(pg_temp.sqlstate_of($q$select * from public.recurrence_next_dates(pg_temp.fx('h'))$q$), '42501', 'P13 anônimo sem execute');
select pg_temp.login('00000000-0000-0000-0000-000000119001');
select is(has_function_privilege('authenticated', 'public.recurrence_next_dates(uuid)', 'execute'), true, 'P14 authenticated executa');
select is(has_function_privilege('anon', 'public.recurrence_next_dates(uuid)', 'execute'), false, 'P15 anon não executa');

select * from finish();
rollback;
