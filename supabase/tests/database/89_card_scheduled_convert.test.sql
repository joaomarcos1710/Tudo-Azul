-- 89: card_scheduled_convert (migration 20261110040000), etapa 3 da recorrência no cartão estilo Organizze.
-- O item agendado vira parcela quando a fatura anterior fecha (a fatura dele passa a ser a aberta); só aí o limite muda.
-- Datas relativas a hoje em São Paulo: o cartão fechou há 5 dias, então a fatura aberta fecha em ~25 dias.
-- Falha sem a migration (a função não existe).
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
create function pg_temp.comprometido() returns numeric language sql as $f$
  select committed from public.card_limits(pg_temp.fx('h'), pg_temp.hoje()) where debt_id = pg_temp.fx('a') $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.sqlstate_of(text), pg_temp.hoje(), pg_temp.comprometido() to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000089a1', 'c1@teste.com'),
  ('00000000-0000-0000-0000-0000000089a2', 'c2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000089a1');
insert into fixture select 'h', public.create_household('Casa da Conversão');
insert into fixture select 'cat', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';
insert into fixture select 'a', public.create_debt('Cartão A', 'card', '2026-01-01', 0);
-- fechou há 5 dias (dia do mês limitado a 28); vence no dia 28 (ou 27 se o fechamento for 28)
select public.set_card_cycle(pg_temp.fx('a'), least(28, extract(day from pg_temp.hoje() - 5)::int),
  case when least(28, extract(day from pg_temp.hoje() - 5)::int) = 28 then 27 else 28 end);
select public.set_card_limit(pg_temp.fx('a'), 100000.00);
-- assinatura diária de 5,00: garante várias ocorrências na fatura aberta
insert into fixture select 'r', public.recurrence_create('card', 'Diária', 5.00, null, pg_temp.hoje() + 1, null, null, pg_temp.fx('a'), pg_temp.fx('cat'), null, 'day', 1);
select public.card_scheduled_sync();

-- o fechamento da fatura aberta, como o banco calcula (função privada: só como dono do banco)
reset role;
insert into fixture select 'x', gen_random_uuid();
insert into nota select 'c0', private.card_cycle_first(d, pg_temp.hoje())::text from public.debts d where d.id = pg_temp.fx('a');
insert into nota select 'a_converter', count(*)::text from public.card_scheduled_items
  where debt_id = pg_temp.fx('a') and status = 'scheduled' and closing_date <= (select v::date from nota where k = 'c0');
insert into nota select 'a_ficar', count(*)::text from public.card_scheduled_items
  where debt_id = pg_temp.fx('a') and status = 'scheduled' and closing_date > (select v::date from nota where k = 'c0');
-- item cancelado ("só esta") e item editado à mão, ambos na fatura aberta
update public.card_scheduled_items set status = 'cancelled'
 where debt_id = pg_temp.fx('a') and occurrence_date = pg_temp.hoje() + 1;
update public.card_scheduled_items set edited = true, amount = 7.77, charge_date = pg_temp.hoje() + 3
 where debt_id = pg_temp.fx('a') and occurrence_date = pg_temp.hoje() + 2;
select pg_temp.login('00000000-0000-0000-0000-0000000089a1');
insert into nota select 'limite_antes', pg_temp.comprometido()::text;

select cmp_ok((select v::int from nota where k = 'a_converter'), '>', 10, 'CV0 há várias ocorrências na fatura aberta (cenário válido)');
select cmp_ok((select v::int from nota where k = 'a_ficar'), '>', 100, 'CV0b e muitas nas faturas seguintes');

select is(public.card_scheduled_convert(), (select v::int - 1 from nota where k = 'a_converter'),
  'CV1 converte as da fatura aberta, menos a cancelada');
select is((select count(*) from public.card_scheduled_items where status = 'converted'), (select v::bigint - 1 from nota where k = 'a_converter'),
  'CV2 os itens convertidos ficam marcados e ligados à parcela');
select is((select count(*) from public.card_scheduled_items where status = 'converted' and installment_id is null), 0::bigint, 'CV3 todo item convertido guarda o id da parcela');
select is((select count(*) from public.card_scheduled_items where status = 'scheduled'), (select v::bigint from nota where k = 'a_ficar'),
  'CV4 as das faturas seguintes continuam agendadas');
select is((select count(*) from public.card_scheduled_items where status = 'cancelled'), 1::bigint, 'CV5 a cancelada não vira parcela');

-- as parcelas: na fatura aberta, com a data de cobrança de cada item
select is((select count(*) from public.debt_installments where debt_id = pg_temp.fx('a') and recurrence_id is not null),
          (select v::bigint - 1 from nota where k = 'a_converter'), 'CV6 uma parcela por item convertido');
select is((select count(distinct due_date) from public.debt_installments where debt_id = pg_temp.fx('a')), 1::bigint, 'CV7 todas na mesma fatura');
select is((select min(due_date)::text from public.debt_installments where debt_id = pg_temp.fx('a')), (select v from nota where k = 'c0'),
  'CV8 a fatura é a que fecha em c0 (a aberta)');
select is((select face from public.debt_installments where debt_id = pg_temp.fx('a') and occurrence_date = pg_temp.hoje() + 2), 7.77::numeric,
  'CV9 o item editado à mão converte com o valor dele');
select is((select purchase_date from public.debt_installments where debt_id = pg_temp.fx('a') and occurrence_date = pg_temp.hoje() + 2), pg_temp.hoje() + 3,
  'CV10 e com a data de cobrança dele, mesmo depois de hoje');

-- o limite passa a seguir a regra do dono: sobe pelo que foi convertido, uma vez só
select is(pg_temp.comprometido() - (select v::numeric from nota where k = 'limite_antes'),
          (select sum(face) from public.debt_installments where debt_id = pg_temp.fx('a')),
          'CV11 o limite comprometido sobe exatamente pelo valor das parcelas convertidas');

-- nada em dobro: as convertidas saem das previstas e do sync
-- as convertidas viraram parcela e a cancelada não volta (etapa 4): a fatura aberta não tem mais nenhuma prevista
select is((select count(*) from public.card_subscription_previews(pg_temp.fx('a'), to_char((select v::date from nota where k = 'c0'), 'YYYY-MM'))), 0::bigint,
          'CV12 a fatura aberta não lista mais previstas: as convertidas viraram parcela e a cancelada não volta');
select is((select count(*) from public.card_pending_subscriptions(pg_temp.fx('h'), pg_temp.hoje()) where debt_id = pg_temp.fx('a')), 0::bigint,
          'CV13 o previsto da fatura aberta zera: o que virou parcela não soma de novo e a cancelada não conta');
select is(public.card_scheduled_sync(), 0, 'CV14 o sync não recria nem mexe nos convertidos');
select is(public.card_scheduled_convert(), 0, 'CV15 converter de novo não faz nada (sem parcela duplicada)');
select is((select count(*) from public.debt_installments where debt_id = pg_temp.fx('a') and recurrence_id is not null),
          (select v::bigint - 1 from nota where k = 'a_converter'), 'CV16 continua uma parcela por item');

-- recurrence_materialize no dia da cobrança não duplica o que já foi convertido (mesmo par regra + ocorrência)
select is(pg_temp.sqlstate_of('select public.recurrence_materialize()'), null, 'CV17 gerar os recorrentes não falha com parcelas já convertidas');
select is((select count(*) from public.debt_installments where debt_id = pg_temp.fx('a') and recurrence_id is not null),
          (select v::bigint - 1 from nota where k = 'a_converter'), 'CV18 e não cria parcela em dobro');

-- segurança
select pg_temp.login('00000000-0000-0000-0000-0000000089a2');
select is(pg_temp.sqlstate_of('select public.card_scheduled_convert()'), '42501', 'CV19 quem não tem família não converte nada');
select ok(has_function_privilege('authenticated', 'public.card_scheduled_convert()', 'EXECUTE'), 'CV20 authenticated executa');
select ok(not has_function_privilege('anon', 'public.card_scheduled_convert()', 'EXECUTE'), 'CV21 anon não executa');

select * from finish();
rollback;
