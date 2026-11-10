-- 90: etapa 4 da recorrência no cartão (migration 20261110050000): "só esta" e "esta e as próximas".
-- Falha sem a migration (as funções não existem). Datas relativas a hoje em São Paulo.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create temp table fixture (k text primary key, v uuid);
create temp table nota (k text primary key, v text);
grant all on fixture, nota to public;
create function pg_temp.fx(p_k text) returns uuid language sql as $f$ select v from fixture where k = p_k $f$;
create function pg_temp.login(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $f$;
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
create function pg_temp.hoje() returns date language sql stable as $f$ select (now() at time zone 'America/Sao_Paulo')::date $f$;
-- item da regra na data de ocorrência pedida
create function pg_temp.item(p_rule text, p_occ date) returns uuid language sql as $f$
  select id from public.card_scheduled_items where recurrence_id = pg_temp.fx(p_rule) and occurrence_date = p_occ $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.sqlstate_of(text), pg_temp.hoje(), pg_temp.item(text, date) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000090a1', 'e1@teste.com'),
  ('00000000-0000-0000-0000-0000000090a2', 'e2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000090a1');
insert into fixture select 'h', public.create_household('Casa das Exceções');
insert into fixture select 'cat', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';
insert into fixture select 'a', public.create_debt('Cartão A', 'card', '2026-01-01', 0);
-- fechou há 5 dias: a fatura aberta fecha em ~25 dias e as seguintes depois
select public.set_card_cycle(pg_temp.fx('a'), least(28, extract(day from pg_temp.hoje() - 5)::int),
  case when least(28, extract(day from pg_temp.hoje() - 5)::int) = 28 then 27 else 28 end);
-- semanal a cada 1 semana, começando daqui a 10 dias: várias ocorrências futuras, espaçadas de 7 dias
insert into fixture select 'r', public.recurrence_create('card', 'Semanal', 10.00, null, pg_temp.hoje() + 10, null, null, pg_temp.fx('a'), pg_temp.fx('cat'), null, 'week', 1);
select public.card_scheduled_sync();
select cmp_ok((select count(*) from public.card_scheduled_items where recurrence_id = pg_temp.fx('r')), '>', 20::bigint, 'ED0 há várias ocorrências agendadas (cenário válido)');

-- ----------------------------------------------------------------------------
-- Só esta: editar
-- ----------------------------------------------------------------------------
select lives_ok(format($q$select public.card_scheduled_item_update(%L, %L, 12.34, 'Semanal editada', %L)$q$,
  pg_temp.item('r', pg_temp.hoje() + 17), pg_temp.hoje() + 19, pg_temp.fx('cat')), 'ED1 editar só esta: data, valor e descrição');
select is((select amount from public.card_scheduled_items where id = pg_temp.item('r', pg_temp.hoje() + 17)), 12.34::numeric, 'ED2 o valor muda só nesta');
select is((select charge_date from public.card_scheduled_items where id = pg_temp.item('r', pg_temp.hoje() + 17)), pg_temp.hoje() + 19, 'ED3 e a data de cobrança');
select is((select edited from public.card_scheduled_items where id = pg_temp.item('r', pg_temp.hoje() + 17)), true, 'ED4 fica marcada como editada à mão');
select is((select amount from public.card_scheduled_items where id = pg_temp.item('r', pg_temp.hoje() + 24)), 10.00::numeric, 'ED5 as outras ocorrências não mudam');
select is(public.card_scheduled_sync(), 0, 'ED6 o sync não desfaz a edição (item editado não é tocado)');
select is((select amount from public.card_scheduled_items where id = pg_temp.item('r', pg_temp.hoje() + 17)), 12.34::numeric, 'ED7 a edição continua depois do sync');

-- a lista da fatura mostra o item editado com os valores dele
select is((select count(*) from public.card_subscription_previews(pg_temp.fx('a'),
  (select to_char(closing_date, 'YYYY-MM') from public.card_scheduled_items where id = pg_temp.item('r', pg_temp.hoje() + 17)))
  where item_id = pg_temp.item('r', pg_temp.hoje() + 17) and amount = 12.34 and edited and charge_date = pg_temp.hoje() + 19), 1::bigint,
  'ED8 a lista da fatura traz o item editado, com valor, data e a marca de editado');

select is(pg_temp.sqlstate_of(format($q$select public.card_scheduled_item_update(%L, %L, 12.34, 'X', %L)$q$, pg_temp.item('r', pg_temp.hoje() + 24), pg_temp.hoje(), pg_temp.fx('cat'))),
  '22023', 'ED9 data de hoje ou passada é recusada');
select is(pg_temp.sqlstate_of(format($q$select public.card_scheduled_item_update(%L, %L, 0, 'X', %L)$q$, pg_temp.item('r', pg_temp.hoje() + 24), pg_temp.hoje() + 30, pg_temp.fx('cat'))),
  '22023', 'ED10 valor zero é recusado');
select is(pg_temp.sqlstate_of(format($q$select public.card_scheduled_item_update(%L, %L, 1.005, 'X', %L)$q$, pg_temp.item('r', pg_temp.hoje() + 24), pg_temp.hoje() + 30, pg_temp.fx('cat'))),
  '22003', 'ED11 mais de 2 casas é recusado');
select is(pg_temp.sqlstate_of(format($q$select public.card_scheduled_item_update(%L, %L, 1, '  ', %L)$q$, pg_temp.item('r', pg_temp.hoje() + 24), pg_temp.hoje() + 30, pg_temp.fx('cat'))),
  '22023', 'ED12 descrição vazia é recusada');
select is((select amount from public.card_scheduled_items where id = pg_temp.item('r', pg_temp.hoje() + 24)), 10.00::numeric, 'ED13 o pedido recusado não mudou nada');

-- ----------------------------------------------------------------------------
-- Só esta: cancelar, e o cancelamento não volta no dia
-- ----------------------------------------------------------------------------
select lives_ok(format($q$select public.card_scheduled_item_cancel(%L)$q$, pg_temp.item('r', pg_temp.hoje() + 24)), 'ED14 cancelar só esta');
select is((select status from public.card_scheduled_items where id = pg_temp.item('r', pg_temp.hoje() + 24)), 'cancelled', 'ED15 fica cancelada');
select is(public.card_scheduled_sync(), 0, 'ED16 o sync não recria a cancelada');
select is((select count(*) from public.card_scheduled_items where recurrence_id = pg_temp.fx('r') and occurrence_date = pg_temp.hoje() + 24), 1::bigint, 'ED17 continua uma só linha para essa data');
select is((select count(*) from public.card_subscription_previews(pg_temp.fx('a'),
  (select to_char(closing_date, 'YYYY-MM') from public.card_scheduled_items where id = pg_temp.item('r', pg_temp.hoje() + 24)))
  where occurrence_date = pg_temp.hoje() + 24), 0::bigint, 'ED18 a cancelada não aparece na lista da fatura');
select is((select count(*) from private.card_recurrence_pending(pg_temp.fx('h'), '2000-01-01', '2100-01-01') where occurrence_date = pg_temp.hoje() + 24), 0::bigint,
  'ED19 nem nas previstas das projeções');
select is(pg_temp.sqlstate_of(format($q$select public.card_scheduled_item_cancel(%L)$q$, pg_temp.item('r', pg_temp.hoje() + 24))), '55000', 'ED20 cancelar de novo é recusado (já não está agendada)');

-- a geração no dia não recria a cancelada: duas regras mensais que começam 3 dias atrás (a ocorrência já "chegou");
-- uma tem item cancelado (como se a pessoa tivesse cancelado antes), a outra não tem item nenhum (controle)
insert into fixture select 'p', public.recurrence_create('card', 'Com cancelada', 11.00, extract(day from pg_temp.hoje() - 3)::int, pg_temp.hoje() - 3, null, null, pg_temp.fx('a'), pg_temp.fx('cat'));
insert into fixture select 'q', public.recurrence_create('card', 'Controle', 12.00, extract(day from pg_temp.hoje() - 3)::int, pg_temp.hoje() - 3, null, null, pg_temp.fx('a'), pg_temp.fx('cat'));
reset role;
insert into public.card_scheduled_items (household_id, debt_id, recurrence_id, occurrence_date, charge_date, closing_date, amount, description, category_id, status)
values (pg_temp.fx('h'), pg_temp.fx('a'), pg_temp.fx('p'), pg_temp.hoje() - 3, pg_temp.hoje() - 3,
        (select private.card_cycle_first(d, pg_temp.hoje() - 3) from public.debts d where d.id = pg_temp.fx('a')), 11.00, 'Com cancelada', pg_temp.fx('cat'), 'cancelled');
select pg_temp.login('00000000-0000-0000-0000-0000000090a1');
select public.recurrence_materialize();
select is((select count(*) from public.debt_installments where recurrence_id = pg_temp.fx('q') and occurrence_date = pg_temp.hoje() - 3), 1::bigint,
  'ED21 controle: sem item, a geração no dia cria a parcela como sempre');
select is((select count(*) from public.debt_installments where recurrence_id = pg_temp.fx('p') and occurrence_date = pg_temp.hoje() - 3), 0::bigint,
  'ED21b com item cancelado, a geração no dia NÃO cria a parcela (a cancelada não volta)');

-- ----------------------------------------------------------------------------
-- Esta e as próximas: encerrar
-- ----------------------------------------------------------------------------
select is(pg_temp.sqlstate_of(format($q$select public.card_scheduled_from_here(%L, 'x')$q$, pg_temp.item('r', pg_temp.hoje() + 31))), '22023', 'ED22 ação inválida é recusada');
insert into nota select 'antes', count(*)::text from public.card_scheduled_items where recurrence_id = pg_temp.fx('r') and status = 'scheduled' and occurrence_date >= pg_temp.hoje() + 31;
select is(public.card_scheduled_from_here(pg_temp.item('r', pg_temp.hoje() + 31), 'end'), (select v::int from nota where k = 'antes'), 'ED23 encerrar daqui remove esta e as próximas agendadas');
select is((select max(occurrence_date) from public.card_scheduled_items where recurrence_id = pg_temp.fx('r') and status = 'scheduled'), pg_temp.hoje() + 17,
  'ED24 as anteriores continuam (a última agendada é a de antes)');
select is((select end_date from public.recurrences where id = pg_temp.fx('r')), pg_temp.hoje() + 30, 'ED25 a regra passa a terminar na véspera desta ocorrência');
select public.card_scheduled_sync();
select is((select count(*) from public.card_scheduled_items where recurrence_id = pg_temp.fx('r') and status = 'scheduled' and occurrence_date >= pg_temp.hoje() + 31), 0::bigint,
  'ED26 o sync não recria as próximas depois de encerrar');

-- ----------------------------------------------------------------------------
-- Esta e as próximas: mudar (a regra se divide em duas)
-- ----------------------------------------------------------------------------
-- nova assinatura mensal para testar a mudança
insert into fixture select 'm', public.recurrence_create('card', 'Mensal', 20.00, extract(day from pg_temp.hoje() + 12)::int, pg_temp.hoje() + 12, null, null, pg_temp.fx('a'), pg_temp.fx('cat'));
select public.card_scheduled_sync();
insert into nota select 'm_seg', (select occurrence_date::text from public.card_scheduled_items where recurrence_id = pg_temp.fx('m') order by occurrence_date offset 1 limit 1);
insert into nota select 'm_antes', (select count(*)::text from public.card_scheduled_items where recurrence_id = pg_temp.fx('m') and status = 'scheduled');
-- muda a 2ª ocorrência em diante: valor 25,00 e uma data 3 dias depois
select lives_ok(format($q$select public.card_scheduled_from_here(%L, 'update', %L, 25.00, 'Mensal nova', %L)$q$,
  pg_temp.item('m', (select v::date from nota where k = 'm_seg')), (select v::date + 3 from nota where k = 'm_seg'), pg_temp.fx('cat')), 'ED27 mudar daqui em diante');
select is((select count(*) from public.recurrences where debt_id = pg_temp.fx('a') and description = 'Mensal'), 1::bigint, 'ED28 a regra antiga continua, agora encerrada na véspera');
select is((select end_date from public.recurrences where id = pg_temp.fx('m')), (select v::date - 1 from nota where k = 'm_seg'), 'ED29 a antiga termina na véspera da ocorrência escolhida');
select is((select count(*) from public.recurrences where debt_id = pg_temp.fx('a') and description = 'Mensal nova'), 1::bigint, 'ED30 nasce uma regra nova com os dados novos');
select is((select amount from public.recurrences where description = 'Mensal nova'), 25.00::numeric, 'ED31 com o valor novo');
select is((select start_date from public.recurrences where description = 'Mensal nova'), (select v::date + 3 from nota where k = 'm_seg'), 'ED32 começando na data nova');
select is((select count(*) from public.card_scheduled_items where recurrence_id = pg_temp.fx('m') and status = 'scheduled'), 1::bigint,
  'ED33 a regra antiga fica só com a ocorrência anterior à escolhida');
select cmp_ok((select count(*) from public.card_scheduled_items i join public.recurrences r on r.id = i.recurrence_id where r.description = 'Mensal nova'), '>', 5::bigint,
  'ED34 a regra nova já tem as ocorrências geradas (sync dentro da função)');
select is(pg_temp.sqlstate_of(format($q$select public.card_scheduled_from_here(%L, 'update', %L, 25.00, 'X', %L)$q$,
  (select i.id from public.card_scheduled_items i join public.recurrences r on r.id = i.recurrence_id where r.description = 'Mensal nova' order by i.occurrence_date offset 1 limit 1),
  (select i.occurrence_date - 40 from public.card_scheduled_items i join public.recurrences r on r.id = i.recurrence_id where r.description = 'Mensal nova' order by i.occurrence_date offset 1 limit 1),
  pg_temp.fx('cat'))), '22023', 'ED35 a data nova não pode ficar antes da cobrança anterior da regra');

-- ----------------------------------------------------------------------------
-- Item já convertido não muda por aqui; segurança
-- ----------------------------------------------------------------------------
reset role;
update public.card_scheduled_items set status = 'converted' where id = (select id from public.card_scheduled_items where recurrence_id = pg_temp.fx('r') and status = 'scheduled' order by occurrence_date limit 1);
select pg_temp.login('00000000-0000-0000-0000-0000000090a1');
select is(pg_temp.sqlstate_of(format($q$select public.card_scheduled_item_cancel(%L)$q$, (select id from public.card_scheduled_items where recurrence_id = pg_temp.fx('r') and status = 'converted' limit 1))),
  '55000', 'ED36 item já convertido em compra não é mexido por aqui');

select pg_temp.login('00000000-0000-0000-0000-0000000090a2');
select is(pg_temp.sqlstate_of(format($q$select public.card_scheduled_item_cancel(%L)$q$, (select id from public.card_scheduled_items limit 1))), '42501', 'ED37 quem não tem família não mexe');
reset role;
select ok(has_function_privilege('authenticated', 'public.card_scheduled_from_here(uuid, text, date, numeric, text, uuid)', 'EXECUTE'), 'ED38 authenticated executa');
select ok(not has_function_privilege('anon', 'public.card_scheduled_from_here(uuid, text, date, numeric, text, uuid)', 'EXECUTE'), 'ED39 anon não executa');
select ok(not has_function_privilege('authenticated', 'private.card_scheduled_item_lock(uuid)', 'EXECUTE'), 'ED40 o auxiliar privado não é executável pelo app');

select * from finish();
rollback;
