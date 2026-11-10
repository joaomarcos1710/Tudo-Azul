-- 91_commitment_matrix_card_months_once: a matriz calcula as faturas de cada cartão uma vez por data de corte
-- distinta (migration 20261110060000), sem mudar nenhum valor.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create temp table fixture (k text primary key, v uuid);
create temp table contagem (k text primary key, n bigint);
grant all on fixture, contagem to public;
create function pg_temp.fx(p_k text) returns uuid language sql as $f$
  select v from fixture where k = p_k
$f$;
create function pg_temp.hoje() returns date language sql as $f$
  select (now() at time zone 'America/Sao_Paulo')::date
$f$;
create function pg_temp.login(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end
$f$;
-- Quantas vezes private.card_months_as_of rodou nesta transação (exige track_functions = all).
create function pg_temp.chamadas() returns bigint language sql as $f$
  select coalesce((select s.calls from pg_stat_xact_user_functions s
                    where s.schemaname = 'private' and s.funcname = 'card_months_as_of'), 0)
$f$;
-- Sem permissão para ligar a contagem (não é superusuário), os testes de contagem são pulados, não falsamente verdes.
create function pg_temp.liga_contagem() returns boolean language plpgsql as $f$
begin
  perform set_config('track_functions', 'all', true);
  return true;
exception when insufficient_privilege then
  return false;
end
$f$;
grant execute on function pg_temp.fx(text), pg_temp.hoje(), pg_temp.login(uuid), pg_temp.chamadas() to public;

create temp table ligado as select pg_temp.liga_contagem() as ok;
grant select on ligado to public;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000091a1', 'matriz-rapida@teste.com');
select pg_temp.login('00000000-0000-0000-0000-0000000091a1');
insert into fixture select 'h1', public.create_household('Casa Matriz Rápida');
insert into fixture select 'expense', id from public.categories
 where household_id = pg_temp.fx('h1') and type = 'expense' and system_key = 'uncategorized';

-- Dois cartões, cada um com uma compra em 3 parcelas (faturas em meses diferentes).
insert into fixture select 'c1', public.create_debt('Cartão um', 'card', pg_temp.hoje() - 180, 0);
select public.set_card_cycle(pg_temp.fx('c1'), 17, 25);
select public.card_purchase(pg_temp.fx('c1'), pg_temp.hoje(), 300, 3, pg_temp.fx('expense'), 'Geladeira');
insert into fixture select 'c2', public.create_debt('Cartão dois', 'card', pg_temp.hoje() - 180, 0);
select public.set_card_cycle(pg_temp.fx('c2'), 5, 12);
select public.card_purchase(pg_temp.fx('c2'), pg_temp.hoje(), 90, 3, pg_temp.fx('expense'), 'Tênis');

-- Do mês corrente em diante a data de corte é sempre hoje: 1 chamada por cartão, não cartões x meses.
insert into contagem select 'antes6', pg_temp.chamadas();
create temp table m6 as select * from public.dashboard_commitment_matrix(pg_temp.fx('h1'), pg_temp.hoje(), 6);
insert into contagem select 'depois6', pg_temp.chamadas();
select case when (select ok from ligado)
  then is((select n from contagem where k = 'depois6') - (select n from contagem where k = 'antes6'), 2::bigint,
          'R1 seis meses a partir de hoje: faturas calculadas 1 vez por cartão (2), não 12')
  else skip('R1 sem permissão para track_functions') end;

-- Meses passados têm data de corte própria (fim de cada mês): uma chamada por cartão e por data distinta.
insert into contagem select 'antes3', pg_temp.chamadas();
create temp table m3 as select * from public.dashboard_commitment_matrix(
  pg_temp.fx('h1'), (date_trunc('month', pg_temp.hoje()::timestamp) - interval '2 months')::date, 3);
insert into contagem select 'depois3', pg_temp.chamadas();
select case when (select ok from ligado)
  then is((select n from contagem where k = 'depois3') - (select n from contagem where k = 'antes3'), 6::bigint,
          'R2 dois meses passados + o corrente: 3 datas de corte x 2 cartões = 6 chamadas')
  else skip('R2 sem permissão para track_functions') end;

-- Os valores continuam os mesmos: cada compra aparece inteira, e o total de cartão bate com o que falta pagar.
select is((select sum(amount) from m6 where row_type = 'item' and description = 'Geladeira'), 300::numeric,
          'R3 as 3 parcelas da geladeira somam o valor da compra');
select is((select sum(amount) from m6 where row_type = 'item' and description = 'Tênis'), 90::numeric,
          'R4 as 3 parcelas do tênis somam o valor da compra');
select is((select count(distinct period_month) from m6 where row_type = 'item' and description = 'Geladeira'), 3::bigint,
          'R5 cada parcela cai no mês da sua fatura');
select is((select sum(amount) from m6 where row_type = 'item' and source_type in ('Cartão', 'Ajuste de fatura')), 390::numeric,
          'R6 o total de cartão na matriz é o que falta pagar nos dois cartões, sem ajuste sobrando');
select is((select count(*) from m6 where row_type = 'item' and commitment_id like 'card-purchase:%'
             group by commitment_id, period_month having count(*) > 1 limit 1), null::bigint,
          'R7 nenhuma parcela duplicada no mesmo mês');

select * from finish();
rollback;
