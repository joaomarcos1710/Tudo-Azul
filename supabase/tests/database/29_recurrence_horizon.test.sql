-- 29_recurrence_horizon: migration 022. Horizonte da geração de recorrentes em conta.
-- Sem data final: até o fim do mês daqui a 12 meses. Com data final: até ela (teto de 360 meses; semanal, 24).
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
create function pg_temp.mes(n integer) returns date language sql as $f$
  select (date_trunc('month', pg_temp.hoje()) + make_interval(months => n))::date $f$;
create function pg_temp.qtd(p_regra uuid) returns bigint language sql as $f$
  select count(*) from public.transactions where recurrence_id = p_regra $f$;
create function pg_temp.ultima(p_regra uuid) returns date language sql as $f$
  select max(date) from public.transactions where recurrence_id = p_regra $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.hoje(), pg_temp.mes(integer),
  pg_temp.qtd(uuid), pg_temp.ultima(uuid) to public;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000029a1', 'hz1@teste.com');
select pg_temp.login('00000000-0000-0000-0000-0000000029a1');
insert into fixture select 'h', public.create_household('Casa Horizonte');
insert into public.accounts (household_id, name, type, initial_balance, opening_date)
  values (pg_temp.fx('h'), 'Banco', 'checking', 100, pg_temp.mes(-12));
insert into fixture select 'bank', id from public.accounts where household_id = pg_temp.fx('h') and name = 'Banco';
insert into fixture select 'cexp', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';

-- RH1: sem data final (aluguel): do mês 0 ao mês +12, 13 planejados; nada além
insert into fixture select 'aluguel', public.recurrence_create('expense', 'Aluguel', 1500, 5, pg_temp.mes(0), pg_temp.fx('bank'), null, null, pg_temp.fx('cexp'));
select is(public.recurrence_materialize(), 13, 'RH1 sem data final: 13 planejados (mês 0 a +12)');
select is(pg_temp.ultima(pg_temp.fx('aluguel')), pg_temp.mes(12) + 4, 'RH1.1 o último é o do mês +12');
select is((select count(*) from public.transactions where recurrence_id = pg_temp.fx('aluguel') and date >= pg_temp.mes(13)),
          0::bigint, 'RH1.2 nada depois do fim do mês +12');
select is(public.recurrence_materialize(), 0, 'RH1.3 segunda geração não cria nada (idempotente)');

-- RH2: empréstimo de 120 parcelas (data final = 120ª parcela): todas aparecem
insert into fixture select 'emp', public.recurrence_create('expense', 'Empréstimo', 800, 10, pg_temp.mes(0), pg_temp.fx('bank'), null, null,
                                                         pg_temp.fx('cexp'), pg_temp.mes(119) + 9);
select public.recurrence_materialize();
select is(pg_temp.qtd(pg_temp.fx('emp')), 120::bigint, 'RH2 data final em 120 meses: 120 planejados');
select is(pg_temp.ultima(pg_temp.fx('emp')), pg_temp.mes(119) + 9, 'RH2.1 o último é exatamente a data final');
select is(public.recurrence_materialize(), 0, 'RH2.2 idempotente com 120 linhas');

-- RH3: financiamento de 360 parcelas
insert into fixture select 'fin', public.recurrence_create('expense', 'Financiamento', 2200, 15, pg_temp.mes(0), pg_temp.fx('bank'), null, null,
                                                         pg_temp.fx('cexp'), pg_temp.mes(359) + 14);
select public.recurrence_materialize();
select is(pg_temp.qtd(pg_temp.fx('fin')), 360::bigint, 'RH3 data final em 360 meses: 360 planejados');
select is(pg_temp.ultima(pg_temp.fx('fin')), pg_temp.mes(359) + 14, 'RH3.1 o último é a data final');
select is(public.recurrence_materialize(), 0, 'RH3.2 idempotente com 360 linhas');

-- RH4: data final além do teto de 360 meses: para no fim do mês +360
insert into fixture select 'longa', public.recurrence_create('expense', 'Muito longa', 50, 20, pg_temp.mes(0), pg_temp.fx('bank'), null, null,
                                                           pg_temp.fx('cexp'), pg_temp.mes(500) + 19);
select public.recurrence_materialize();
select is(pg_temp.qtd(pg_temp.fx('longa')), 361::bigint, 'RH4 data final além do teto: 361 planejados (mês 0 a +360)');
select is(pg_temp.ultima(pg_temp.fx('longa')), pg_temp.mes(360) + 19, 'RH4.1 o último é o do mês +360');

-- RH5: semanal. Sem fim: até o fim do mês +12. Com fim distante: até o fim do mês +24.
insert into fixture select 'sem', public.recurrence_create('expense', 'Feira', 90, null, pg_temp.hoje(), pg_temp.fx('bank'), null, null,
                                                         pg_temp.fx('cexp'), null, 'week', 1);
insert into fixture select 'semfim', public.recurrence_create('expense', 'Academia', 40, null, pg_temp.hoje(), pg_temp.fx('bank'), null, null,
                                                            pg_temp.fx('cexp'), pg_temp.hoje() + 3650, 'week', 1);
select public.recurrence_materialize();
select ok(pg_temp.ultima(pg_temp.fx('sem')) <= pg_temp.mes(13) - 1 and pg_temp.ultima(pg_temp.fx('sem')) > pg_temp.mes(13) - 8,
          'RH5 semanal sem data final: a última é da última semana do mês +12');
select ok(pg_temp.ultima(pg_temp.fx('semfim')) <= pg_temp.mes(25) - 1 and pg_temp.ultima(pg_temp.fx('semfim')) > pg_temp.mes(25) - 8,
          'RH5.1 semanal com data final em 10 anos: para no mês +24 (teto da semanal)');

-- RH6: a ocorrência excluída não volta, mesmo longe no futuro
update public.transactions set deleted_at = now() where recurrence_id = pg_temp.fx('fin') and date = pg_temp.mes(300) + 14;
select is(public.recurrence_materialize(), 0, 'RH6 a ocorrência excluída (mês +300) não volta');
select is((select count(*) from public.transactions where recurrence_id = pg_temp.fx('fin') and deleted_at is null), 359::bigint,
          'RH6.1 sobram 359 ativas');

-- RH7: reajustar a regra de 360 parcelas muda todos os planejados de hoje em diante
select lives_ok($$select public.recurrence_update(pg_temp.fx('fin'), 'Financiamento', 2300)$$, 'RH7 reajusta o financiamento para 2300');
select is((select count(*) from public.transactions where recurrence_id = pg_temp.fx('fin') and deleted_at is null
            and status = 'planned' and date >= pg_temp.hoje() and amount <> 2300), 0::bigint,
          'RH7.1 nenhum planejado futuro ficou com o valor antigo');

-- RH8: assinatura de cartão não muda: a compra só nasce no dia da ocorrência
insert into fixture select 'card', public.create_debt('Cartão', 'card', pg_temp.mes(-6), 0);
select public.set_card_cycle(pg_temp.fx('card'), 17, 25);
insert into fixture select 'stream', public.recurrence_create('card', 'Streaming', 30, 5, pg_temp.mes(1), null, null,
                                                            pg_temp.fx('card'), pg_temp.fx('cexp'), pg_temp.mes(36) + 4);
select public.recurrence_materialize();
select is((select count(*) from public.debt_installments where recurrence_id = pg_temp.fx('stream')), 0::bigint,
          'RH8 assinatura no cartão com início futuro e data final distante: nenhuma compra adiantada');

select * from finish();
rollback;
