-- 88: card_scheduled_sync e card_scheduled_invoices (migration 20261110030000), etapa 2 da recorrência no cartão.
-- Datas relativas a hoje em São Paulo (a função usa hoje): a regra começa no dia 15 do mês que vem.
-- Falha sem a migration (as funções não existem).
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
-- dia 15 do mês que vem
create function pg_temp.inicio() returns date language sql stable as $f$
  select (date_trunc('month', pg_temp.hoje()) + interval '1 month' + interval '14 days')::date $f$;
create function pg_temp.limites() returns text language sql as $f$
  select coalesce(string_agg(debt_id || ':' || coalesce(committed::text, '-') || ':' || coalesce(available::text, '-'), ',' order by debt_id), '')
    from public.card_limits(pg_temp.fx('h'), pg_temp.hoje()) $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.sqlstate_of(text), pg_temp.hoje(), pg_temp.inicio(), pg_temp.limites() to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000088a1', 's1@teste.com'),
  ('00000000-0000-0000-0000-0000000088a2', 's2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000088a1');
insert into fixture select 'h', public.create_household('Casa dos Agendados 2');
insert into fixture select 'cat', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';
insert into fixture select 'a', public.create_debt('Cartão A', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('a'), 10, 20);
insert into fixture select 'r', public.recurrence_create('card', 'Streaming', 50.00, 15, pg_temp.inicio(), null, null, pg_temp.fx('a'), pg_temp.fx('cat'));
insert into nota select 'limite_antes', pg_temp.limites();

select is(public.card_scheduled_sync(), 12, 'SY1 gera 12 itens: um por mês, do mês que vem até o fim do horizonte de 12 meses');
select is((select count(*) from public.card_scheduled_items where status = 'scheduled'), 12::bigint, 'SY2 os 12 ficam agendados');
select is(public.card_scheduled_sync(), 0, 'SY3 rodar de novo não muda nada');
select is((select min(occurrence_date) from public.card_scheduled_items), pg_temp.inicio(), 'SY4 o primeiro é a primeira ocorrência da regra');
select is((select closing_date from public.card_scheduled_items where occurrence_date = pg_temp.inicio()),
          (date_trunc('month', pg_temp.inicio()) + interval '1 month' + interval '9 days')::date,
          'SY5 compra no dia 15 entra na fatura que fecha no dia 10 do mês seguinte');

-- nada vira parcela e o limite não muda nesta etapa
select is((select count(*) from public.debt_installments where debt_id = pg_temp.fx('a')), 0::bigint, 'SY6 nenhuma parcela é criada');
select is(pg_temp.limites(), (select v from nota where k = 'limite_antes'), 'SY7 o limite do cartão não muda com os itens agendados');

-- leitura por fatura: total somado no banco, igual ao das previstas derivadas da regra
select is((select count(*) from public.card_scheduled_invoices(pg_temp.fx('a'))), 12::bigint, 'SY8 uma linha por fatura futura');
select is((select total from public.card_scheduled_invoices(pg_temp.fx('a')) order by closing_date limit 1), 50.00::numeric, 'SY9 total da primeira fatura');
select is((select items from public.card_scheduled_invoices(pg_temp.fx('a')) order by closing_date limit 1), 1, 'SY10 um item na primeira fatura');
select is((select i.total from public.card_scheduled_invoices(pg_temp.fx('a')) i order by closing_date limit 1),
          (select sum(p.amount) from public.card_subscription_previews(pg_temp.fx('a'),
             (select label from public.card_scheduled_invoices(pg_temp.fx('a')) order by closing_date limit 1)) p),
          'SY11 o total agendado da fatura é igual à soma das previstas (nada duplicado nem perdido)');
select is((select due_date from public.card_scheduled_invoices(pg_temp.fx('a')) order by closing_date limit 1),
          (select closing_date + 10 from public.card_scheduled_invoices(pg_temp.fx('a')) order by closing_date limit 1),
          'SY12 vencimento pelo ciclo do cartão (fecha 10, vence 20)');

-- a regra mudou de valor: os agendados não editados acompanham; o editado ("só esta") fica
reset role;
update public.card_scheduled_items set edited = true, amount = 1.00
 where recurrence_id = pg_temp.fx('r') and occurrence_date = pg_temp.inicio();
update public.recurrences set amount = 60.00 where id = pg_temp.fx('r');
select pg_temp.login('00000000-0000-0000-0000-0000000088a1');
select is(public.card_scheduled_sync(), 11, 'SY13 11 itens acompanham o valor novo da regra');
select is((select count(*) from public.card_scheduled_items where amount = 60.00), 11::bigint, 'SY14 os não editados ficam com 60,00');
select is((select amount from public.card_scheduled_items where occurrence_date = pg_temp.inicio()), 1.00::numeric, 'SY15 o item editado à mão não é sobrescrito');

-- ocorrência que virou parcela (recurrence_materialize, no dia) sai dos agendados
reset role;
insert into public.debt_installments (household_id, debt_id, plan, seq, due_date, face, category_id, description, purchase_date,
                                      closing_day, due_day, recurrence_id, occurrence_date)
select pg_temp.fx('h'), pg_temp.fx('a'), gen_random_uuid()::text, 1, s.closing_date, 60.00, pg_temp.fx('cat'), 'Streaming', s.occurrence_date,
       10, 20, pg_temp.fx('r'), s.occurrence_date
  from public.card_scheduled_items s where s.recurrence_id = pg_temp.fx('r') and not s.edited
 order by s.occurrence_date limit 1;
select pg_temp.login('00000000-0000-0000-0000-0000000088a1');
select is(public.card_scheduled_sync(), 1, 'SY16 a ocorrência que virou parcela sai dos agendados');
select is((select count(*) from public.card_scheduled_items where status = 'scheduled'), 11::bigint, 'SY17 sobram 11 (10 da regra + o editado)');

-- regra desativada: os não editados somem, o editado fica
reset role;
update public.recurrences set active = false where id = pg_temp.fx('r');
select pg_temp.login('00000000-0000-0000-0000-0000000088a1');
select is(public.card_scheduled_sync(), 10, 'SY18 regra desativada: os 10 agendados não editados são removidos');
select is((select count(*) from public.card_scheduled_items), 1::bigint, 'SY19 só o editado à mão continua');

-- outra família: não vê nem gera nada desta
select pg_temp.login('00000000-0000-0000-0000-0000000088a2');
select is((select count(*) from public.card_scheduled_invoices(pg_temp.fx('a'))), 0::bigint, 'SY20 outra família não lê as faturas agendadas');
select is(pg_temp.sqlstate_of('select public.card_scheduled_sync()'), '42501', 'SY21 quem não tem família não gera nada');

select ok(has_function_privilege('authenticated', 'public.card_scheduled_sync()', 'EXECUTE'), 'SY22 authenticated executa a geração');
select ok(not has_function_privilege('anon', 'public.card_scheduled_sync()', 'EXECUTE'), 'SY23 anon não executa a geração');
select ok(not has_function_privilege('anon', 'public.card_scheduled_invoices(uuid)', 'EXECUTE'), 'SY24 anon não lê');

select * from finish();
rollback;
