-- 136: assinatura de cartão "a cada 30 dias" (pedido do dono, 18/11/2026: o Meli+ cobra de 30 em 30 dias, um dia a menos por mês).
-- O banco já aceita freq_unit = 'day' com freq_every de 1 a 365 (migration 048); este teste prova que o CARTÃO usa a mesma série:
-- os itens agendados saem espaçados de 30 dias, a edição "esta e as próximas" e o "Já foi cobrada" (143) mantêm o ritmo.
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
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.hoje() to public;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000136a1', 'm1@teste136.com');
select pg_temp.login('00000000-0000-0000-0000-0000000136a1');
insert into fixture select 'h', public.create_household('Casa do Meli');
insert into fixture select 'cat', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';
insert into fixture select 'a', public.create_debt('Cartão A', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('a'), 18, 28);

-- a assinatura começa daqui a 10 dias e repete a cada 30
insert into fixture select 'r', public.recurrence_create('card', 'Meli+', 39.90, null, pg_temp.hoje() + 10, null, null, pg_temp.fx('a'), pg_temp.fx('cat'), null, 'day', 30);
select is((select freq_unit || '/' || freq_every || '/' || coalesce(day::text, 'sem dia') from public.recurrences where id = pg_temp.fx('r')), 'day/30/sem dia',
  'F1 a regra do cartão guarda a frequência em dias: day, a cada 30, sem dia do mês');
select public.card_scheduled_sync();
select cmp_ok((select count(*) from public.card_scheduled_items where recurrence_id = pg_temp.fx('r')), '>=', 10::bigint, 'F2 o sync gera as cobranças dos próximos meses');
select is((select min(occurrence_date) from public.card_scheduled_items where recurrence_id = pg_temp.fx('r')), pg_temp.hoje() + 10, 'F3 a primeira cobrança é o início');
select is((select count(*) from (select occurrence_date - lag(occurrence_date) over (order by occurrence_date) as passo
                                   from public.card_scheduled_items where recurrence_id = pg_temp.fx('r')) x where passo is not null and passo <> 30),
  0::bigint, 'F4 todas as cobranças seguintes ficam a 30 dias uma da outra (não escorrega para o mesmo dia do mês)');
select is((select charge_date from public.card_scheduled_items where recurrence_id = pg_temp.fx('r') and occurrence_date = pg_temp.hoje() + 70),
  pg_temp.hoje() + 70, 'F5 a data de cobrança de cada item é a da ocorrência (início + 60 dias = a terceira cobrança)');
select is(public.card_scheduled_sync(), 0, 'F6 rodar o sync de novo não muda nada');

-- cobrou antes do dia (o caso do Meli+): "Já foi cobrada" (143) mantém o ritmo das demais
select isnt((select public.card_scheduled_charged((select id from public.card_scheduled_items where recurrence_id = pg_temp.fx('r') and occurrence_date = pg_temp.hoje() + 10), pg_temp.hoje())), null,
  'F7 "Já foi cobrada" funciona numa assinatura a cada 30 dias');
select is((select count(*) from (select occurrence_date - lag(occurrence_date) over (order by occurrence_date) as passo
                                   from public.card_scheduled_items where recurrence_id = pg_temp.fx('r') and status = 'scheduled') x where passo is not null and passo <> 30),
  0::bigint, 'F8 as cobranças que seguem agendadas continuam a 30 dias uma da outra');
select is((select count(*) from public.card_scheduled_items where recurrence_id = pg_temp.fx('r') and occurrence_date = pg_temp.hoje() + 10 and status = 'converted'), 1::bigint,
  'F9 a cobrança de hoje virou compra e não está duplicada');

-- "esta e as próximas" mudando a data mantém a frequência de 30 em 30 dias na regra nova
select cmp_ok(public.card_scheduled_from_here((select id from public.card_scheduled_items where recurrence_id = pg_temp.fx('r') and occurrence_date = pg_temp.hoje() + 40),
  'update', pg_temp.hoje() + 41, 39.90, 'Meli+', pg_temp.fx('cat')), '>', 0, 'F10 editar esta e as próximas a partir da segunda cobrança');
select is((select freq_unit || '/' || freq_every from public.recurrences where household_id = pg_temp.fx('h') and description = 'Meli+' and start_date = pg_temp.hoje() + 41),
  'day/30', 'F11 a regra nova começa na data nova e segue a cada 30 dias');
select is((select count(*) from (select occurrence_date - lag(occurrence_date) over (order by occurrence_date) as passo
                                   from public.card_scheduled_items i join public.recurrences r on r.id = i.recurrence_id
                                  where r.household_id = pg_temp.fx('h') and r.start_date = pg_temp.hoje() + 41) x where passo is not null and passo <> 30),
  0::bigint, 'F12 e as cobranças da regra nova também ficam a 30 dias');

select * from finish();
rollback;
