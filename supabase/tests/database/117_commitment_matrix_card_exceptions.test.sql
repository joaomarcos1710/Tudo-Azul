-- 117_commitment_matrix_card_exceptions: a matriz de compromissos respeita as exceções das assinaturas de cartão
-- (migration 20261114160000): cobrança cancelada não aparece, editada vale com o valor novo, dividida não duplica.
-- Datas relativas a hoje em São Paulo (a matriz usa a data de hoje para as faturas). Dados inventados.
-- Falha sem a migration: a matriz mostra a cancelada e o valor antigo da editada.
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
create function pg_temp.hoje() returns date language sql stable as $f$ select (now() at time zone 'America/Sao_Paulo')::date $f$;
-- n-ésimo item agendado (por data de ocorrência) de uma regra
create function pg_temp.item(p_rule text, p_n int) returns uuid language sql as $f$
  select id from public.card_scheduled_items where recurrence_id = pg_temp.fx(p_rule) order by occurrence_date offset p_n - 1 limit 1 $f$;
-- a linha de uma assinatura na matriz, "AAAA-MM:valor" por mês, em ordem
create function pg_temp.meses(p_desc text) returns text language sql as $f$
  select coalesce(string_agg(to_char(period_month, 'YYYY-MM') || ':' || amount::numeric(14,2), ' ' order by period_month), '-')
    from public.dashboard_commitment_matrix(pg_temp.fx('h'), pg_temp.hoje(), 6) where row_type = 'item' and description = p_desc $f$;
-- o n-ésimo mês em que a assinatura-controle aparece
create function pg_temp.mes_n(p_n int) returns text language sql as $f$
  select to_char(period_month, 'YYYY-MM')
    from public.dashboard_commitment_matrix(pg_temp.fx('h'), pg_temp.hoje(), 6) where row_type = 'item' and description = 'Controle'
   order by period_month offset p_n - 1 limit 1 $f$;
grant execute on all functions in schema pg_temp to public;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000117a01', 'mx@teste.com');
select pg_temp.login('00000000-0000-0000-0000-000000117a01');
insert into fixture select 'h', public.create_household('Casa das exceções da matriz');
insert into fixture select 'cat', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';
insert into fixture select 'a', public.create_debt('Cartão A', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('a'), 5, 15);
-- quatro assinaturas mensais de cartão que começam daqui a 12 dias (cada uma com um destino diferente nas exceções)
insert into fixture select 'ctl', public.recurrence_create('card', 'Controle', 10.00, extract(day from pg_temp.hoje() + 12)::int, pg_temp.hoje() + 12, null, null, pg_temp.fx('a'), pg_temp.fx('cat'));
insert into fixture select 'can', public.recurrence_create('card', 'Cancelada', 20.00, extract(day from pg_temp.hoje() + 12)::int, pg_temp.hoje() + 12, null, null, pg_temp.fx('a'), pg_temp.fx('cat'));
insert into fixture select 'edi', public.recurrence_create('card', 'Editada', 30.00, extract(day from pg_temp.hoje() + 12)::int, pg_temp.hoje() + 12, null, null, pg_temp.fx('a'), pg_temp.fx('cat'));
insert into fixture select 'div', public.recurrence_create('card', 'Dividida', 40.00, extract(day from pg_temp.hoje() + 12)::int, pg_temp.hoje() + 12, null, null, pg_temp.fx('a'), pg_temp.fx('cat'));
select public.card_scheduled_sync();

select cmp_ok((select count(*) from public.card_scheduled_items where recurrence_id = pg_temp.fx('ctl')), '>', 6::bigint, 'X0 cenário válido: há mais de 6 cobranças agendadas por assinatura');
-- sem exceção nenhuma: as quatro aparecem iguais, mês a mês, com o valor da regra
select is(pg_temp.meses('Cancelada'), replace(pg_temp.meses('Controle'), ':10.00', ':20.00'), 'X1 sem exceções, a matriz mostra a assinatura em todos os meses, com o valor da regra');
select cmp_ok((select count(*) from public.dashboard_commitment_matrix(pg_temp.fx('h'), pg_temp.hoje(), 6) where row_type = 'item' and description = 'Controle'), '>=', 4::bigint, 'X1b a assinatura-controle aparece em pelo menos 4 meses da janela');

-- exceções feitas na fatura
select public.card_scheduled_item_cancel(pg_temp.item('can', 2));
select public.card_scheduled_item_update(pg_temp.item('edi', 2), (select charge_date from public.card_scheduled_items where id = pg_temp.item('edi', 2)), 99.00, 'Editada', pg_temp.fx('cat'));
select public.card_scheduled_from_here(pg_temp.item('div', 2), 'update', (select charge_date + 2 from public.card_scheduled_items where id = pg_temp.item('div', 2)), 55.00, 'Dividida', pg_temp.fx('cat'));

-- cancelada: o 2º mês some e os outros ficam (a cobrança cancelada não entra na matriz nem no total)
select is(pg_temp.meses('Cancelada'),
  (select string_agg(m || ':20.00', ' ' order by m) from (select pg_temp.mes_n(n) as m from generate_series(1, 5) n) q where m is not null and m <> pg_temp.mes_n(2)),
  'X2 a cobrança cancelada na fatura não aparece na matriz; as outras continuam');
select is((select count(*) from public.dashboard_commitment_matrix(pg_temp.fx('h'), pg_temp.hoje(), 6) where row_type = 'item' and description = 'Cancelada' and to_char(period_month, 'YYYY-MM') = pg_temp.mes_n(2)), 0::bigint,
  'X3 no mês da cancelada não há linha dela');
-- editada: o 2º mês vale o valor novo e os outros o da regra
select is(pg_temp.meses('Editada'),
  (select string_agg(m || case when m = pg_temp.mes_n(2) then ':99.00' else ':30.00' end, ' ' order by m) from (select pg_temp.mes_n(n) as m from generate_series(1, 5) n) q where m is not null),
  'X4 a cobrança editada vale com o valor novo (99,00) e as outras com o da regra (30,00)');
-- dividida: uma linha só por mês (a regra antiga e a nova não se somam), 40 antes da mudança e 55 daí em diante
select is((select count(*) - count(distinct period_month) from public.dashboard_commitment_matrix(pg_temp.fx('h'), pg_temp.hoje(), 6) where row_type = 'item' and description = 'Dividida'), 0::bigint,
  'X5 a assinatura dividida não aparece duas vezes no mesmo mês');
select is(pg_temp.meses('Dividida'),
  (select string_agg(m || case when m = pg_temp.mes_n(1) then ':40.00' else ':55.00' end, ' ' order by m) from (select pg_temp.mes_n(n) as m from generate_series(1, 5) n) q where m is not null),
  'X6 dividida: 40,00 antes da mudança e 55,00 daí em diante');
-- o total de cada mês é a soma das linhas do mês (nada de linha fora do total)
select is((select count(*)::int from (
             select t.period_month from public.dashboard_commitment_matrix(pg_temp.fx('h'), pg_temp.hoje(), 6) t where t.row_type = 'total'
              and t.amount <> (select sum(i.amount) from public.dashboard_commitment_matrix(pg_temp.fx('h'), pg_temp.hoje(), 6) i where i.row_type = 'item' and i.period_month = t.period_month and i.currency_code = t.currency_code)) z), 0,
  'X7 o total de cada mês é a soma das linhas do mês');
-- o mês cancelado tem a soma das outras três assinaturas (10 + 99 + 55), sem os 20 da cancelada
select is((select amount from public.dashboard_commitment_matrix(pg_temp.fx('h'), pg_temp.hoje(), 6) where row_type = 'total' and to_char(period_month, 'YYYY-MM') = pg_temp.mes_n(2)),
  164.00::numeric, 'X8 o total do mês da exceção é 10 + 99 + 55 = 164,00 (a cancelada de 20,00 não entra)');

select * from finish();
rollback;
