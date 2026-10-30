-- 22_recurrence_frequency: migration 016. Frequências (semanal, quinzenal, mensal, bimestral, trimestral, semestral,
-- anual, personalizada), regras de calendário, compatibilidade das regras mensais, geração idempotente,
-- validações da RPC e projeção das assinaturas de cartão com a mesma série de datas.
-- Datas fixas no futuro (2027+) para não depender do relógio; os casos de "hoje" usam datas relativas.
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
create function pg_temp.hoje() returns date language sql as $f$ select (now() at time zone 'America/Sao_Paulo')::date $f$;
create function pg_temp.mes(n integer) returns date language sql as $f$
  select (date_trunc('month', pg_temp.hoje()) + make_interval(months => n))::date $f$;
-- série da regra entre duas datas, como texto
create function pg_temp.serie(p_rec uuid, p_de date, p_ate date) returns text language sql as $f$
  select coalesce(string_agg(d::text, ' ' order by d), '')
    from public.recurrences r cross join lateral private.recurrence_occurrences(r, p_de, p_ate) d
   where r.id = p_rec $f$;
grant execute on function pg_temp.fx(text), pg_temp.sqlstate_of(text), pg_temp.hoje(), pg_temp.mes(integer),
  pg_temp.serie(uuid, date, date) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000022a1', 'rf1@teste.com'),
  ('00000000-0000-0000-0000-0000000022a2', 'rf2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000022a1');
insert into fixture select 'h', public.create_household('Casa Frequência');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 1000, pg_temp.mes(-12)) returning id)
  insert into fixture select 'bank', id from i;
insert into fixture select 'cexp', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';
insert into fixture select 'cinc', id from public.categories where household_id = pg_temp.fx('h') and type = 'income' and system_key is null limit 1;
insert into fixture select 'card', public.create_debt('Cartão', 'card', pg_temp.mes(-6), 0);
select public.set_card_cycle(pg_temp.fx('card'), 17, 25);

-- atalho: cria regra de despesa em conta com frequência
create function pg_temp.regra(p_day integer, p_start date, p_unit text, p_every integer, p_end date default null)
returns uuid language sql as $f$
  select public.recurrence_create('expense', 'Teste', 10, p_day, p_start, pg_temp.fx('bank'), null, null,
                                  pg_temp.fx('cexp'), p_end, p_unit, p_every) $f$;
grant execute on function pg_temp.regra(integer, date, text, integer, date) to public;

-- RF1: regras mensais geram EXATAMENTE as datas da fórmula antiga (migration 006: mês a mês desde o mês de
-- start_date, dia limitado ao último do mês, >= start_date). 31 dias × 3 inícios × 5 anos.
reset role;
-- O banco corta a série das frequências novas na data de cadastro (created_at). As regras de calendário abaixo usam datas
-- fixas de 2027 em diante e não podem depender do dia em que o teste roda: nascem "cadastradas" em 2026-01-01.
-- (Criada com o papel de dono, fora do login do cliente, que não tem UPDATE em created_at.)
create function pg_temp.antigar(p_id uuid) returns uuid language sql security definer as $f$
  update public.recurrences set created_at = timestamptz '2026-01-01 12:00:00-03' where id = p_id returning id $f$;
grant execute on function pg_temp.antigar(uuid) to public;
create function pg_temp.regra_fixa(p_day integer, p_start date, p_unit text, p_every integer, p_end date default null)
returns uuid language sql as $f$ select pg_temp.antigar(pg_temp.regra(p_day, p_start, p_unit, p_every, p_end)) $f$;
grant execute on function pg_temp.regra_fixa(integer, date, text, integer, date) to public;
create temp table rf1 (dia int, inicio date, id uuid);
grant all on rf1 to public;
select pg_temp.login('00000000-0000-0000-0000-0000000022a1');
insert into rf1 select d, i, pg_temp.regra(d, i, 'month', 1)
  from generate_series(1, 31) d, unnest(array[date '2027-01-01', date '2027-02-15', date '2028-01-31']) i;
reset role;
select is(
  (select count(*) from rf1 r
    where pg_temp.serie(r.id, date '2027-01-01', date '2031-12-31') is distinct from (
      select string_agg(o::text, ' ' order by o) from (
        select private.card_day_in_month((date_trunc('month', r.inicio) + make_interval(months => k))::date, r.dia) o
          from generate_series(0, 70) k) s
       where o >= r.inicio and o <= date '2031-12-31')),
  0::bigint, 'RF1 mensal: 93 regras com as mesmas datas da fórmula antiga, em 5 anos');
select pg_temp.login('00000000-0000-0000-0000-0000000022a1');

-- RF2–RF9: calendário
insert into fixture select 'm31', pg_temp.regra_fixa(31, '2027-01-01', 'month', 1);
select is(pg_temp.serie(pg_temp.fx('m31'), '2027-01-01', '2027-05-31'),
  '2027-01-31 2027-02-28 2027-03-31 2027-04-30 2027-05-31', 'RF2 mensal dia 31: último dia nos meses curtos, sem escorregar');
insert into fixture select 'a29', pg_temp.regra_fixa(29, '2028-02-01', 'month', 12);
select is(pg_temp.serie(pg_temp.fx('a29'), '2028-01-01', '2032-12-31'),
  '2028-02-29 2029-02-28 2030-02-28 2031-02-28 2032-02-29', 'RF3 anual dia 29 em fevereiro: 28/02 no ano comum, 29/02 no bissexto');
insert into fixture select 't31', pg_temp.regra_fixa(31, '2027-01-01', 'month', 3);
select is(pg_temp.serie(pg_temp.fx('t31'), '2027-01-01', '2027-12-31'),
  '2027-01-31 2027-04-30 2027-07-31 2027-10-31', 'RF4 trimestral dia 31');
insert into fixture select 's10', pg_temp.regra_fixa(10, '2027-03-15', 'month', 6);
select is(pg_temp.serie(pg_temp.fx('s10'), '2027-01-01', '2028-12-31'),
  '2027-09-10 2028-03-10 2028-09-10', 'RF5 semestral: dia 10 de março já passou do início (15/03), começa em setembro');
insert into fixture select 'b30', pg_temp.regra_fixa(30, '2027-12-01', 'month', 2);
select is(pg_temp.serie(pg_temp.fx('b30'), '2027-12-01', '2028-06-30'),
  '2027-12-30 2028-02-29 2028-04-30 2028-06-30', 'RF6 bimestral dia 30: fevereiro bissexto vira 29');
insert into fixture select 'w1', pg_temp.regra_fixa(null, '2027-01-01', 'week', 1);
select is(pg_temp.serie(pg_temp.fx('w1'), '2027-01-01', '2027-01-31'),
  '2027-01-01 2027-01-08 2027-01-15 2027-01-22 2027-01-29', 'RF7 semanal: toda sexta a partir de 01/01/2027');
insert into fixture select 'w2', pg_temp.regra_fixa(null, '2027-01-01', 'week', 2);
select is(pg_temp.serie(pg_temp.fx('w2'), '2027-01-01', '2027-02-28'),
  '2027-01-01 2027-01-15 2027-01-29 2027-02-12 2027-02-26', 'RF8 quinzenal = a cada 14 dias (não duas vezes por mês)');
insert into fixture select 'w2f', pg_temp.regra_fixa(null, '2027-01-01', 'week', 2, '2027-01-20');
select is(pg_temp.serie(pg_temp.fx('w2f'), '2027-01-01', '2027-12-31'),
  '2027-01-01 2027-01-15', 'RF9 data final é a última ocorrência possível');
select is(pg_temp.serie(pg_temp.fx('w1'), '2027-01-10', '2027-01-20'),
  '2027-01-15', 'RF9b janela no meio da série semanal');
insert into fixture select 'p5', pg_temp.regra_fixa(15, '2027-01-01', 'month', 5);
select is(pg_temp.serie(pg_temp.fx('p5'), '2027-01-01', '2028-01-31'),
  '2027-01-15 2027-06-15 2027-11-15', 'RF9c personalizada: a cada 5 meses');
select is((select day from public.recurrences where id = pg_temp.fx('w1')), null::smallint, 'RF9d semanal grava dia nulo');

-- RF10: início no passado — mensal gera desde o início (como sempre); frequência nova, só do cadastro em diante
insert into fixture select 'pm', pg_temp.regra(extract(day from pg_temp.hoje())::int, pg_temp.mes(-2), 'month', 1);
insert into fixture select 'pw', pg_temp.regra(null, pg_temp.hoje() - 63, 'week', 1);
select ok((select min(d) from public.recurrences r cross join lateral private.recurrence_occurrences(r, '2000-01-01', pg_temp.hoje()) d
            where r.id = pg_temp.fx('pm')) < pg_temp.mes(-1), 'RF10 mensal com início no passado gera desde o início');
select is((select string_agg(d::text, ' ') from public.recurrences r
            cross join lateral private.recurrence_occurrences(r, '2000-01-01', pg_temp.hoje()) d where r.id = pg_temp.fx('pw')),
  pg_temp.hoje()::text, 'RF10 semanal com início há 9 semanas: só a de hoje (dia do cadastro), sem 9 atrasados');

-- RF11: validações da RPC
select is(pg_temp.sqlstate_of($$select pg_temp.regra(null, '2027-01-01', 'month', 1)$$), '22023', 'RF11 mensal sem dia: 22023');
select is(pg_temp.sqlstate_of($$select pg_temp.regra(10, '2027-01-01', 'month', 13)$$), '22023', 'RF11 a cada 13 meses: 22023');
select is(pg_temp.sqlstate_of($$select pg_temp.regra(10, '2027-01-01', 'month', 0)$$), '22023', 'RF11 a cada 0: 22023');
select is(pg_temp.sqlstate_of($$select pg_temp.regra(null, '2027-01-01', 'week', 5)$$), '22023', 'RF11 a cada 5 semanas: 22023');
select is(pg_temp.sqlstate_of($$select pg_temp.regra(10, '2027-01-01', 'day', 1)$$), '22023', 'RF11 unidade desconhecida: 22023');
select is(pg_temp.sqlstate_of($$select public.recurrence_create('expense', 'Teste', 10, 10, '2027-01-01', pg_temp.fx('bank'), null, null, pg_temp.fx('cexp'), null, null, 1)$$),
  '22023', 'RF11 unidade nula: 22023');
insert into fixture select 'semana_dia', pg_temp.regra(20, '2027-01-01', 'week', 1);
select is((select day from public.recurrences where id = pg_temp.fx('semana_dia')), null::smallint, 'RF11 semanal ignora o dia informado');
-- chamada antiga (sem os parâmetros novos), como o app atual faz: cria mensal
insert into fixture select 'antiga', public.recurrence_create('expense', 'Luz', 10, 10, '2027-01-01', pg_temp.fx('bank'), null, null, pg_temp.fx('cexp'));
select is((select freq_unit || '/' || freq_every || '/' || day from public.recurrences where id = pg_temp.fx('antiga')),
  'month/1/10', 'RF11 chamada sem frequência continua criando regra mensal');
reset role;
select is(pg_temp.sqlstate_of($$insert into public.recurrences (household_id, kind, description, amount, day, start_date, account_id, category_id, freq_unit, freq_every)
  values (pg_temp.fx('h'), 'expense', 'X', 1, 10, '2027-01-01', pg_temp.fx('bank'), pg_temp.fx('cexp'), 'week', 1)$$),
  '23514', 'RF11 constraint: semanal com dia é recusada no banco');
select is(pg_temp.sqlstate_of($$insert into public.recurrences (household_id, kind, description, amount, day, start_date, account_id, category_id)
  values (pg_temp.fx('h'), 'expense', 'X', 1, null, '2027-01-01', pg_temp.fx('bank'), pg_temp.fx('cexp'))$$),
  '23514', 'RF11 constraint: mensal sem dia é recusada no banco');
select pg_temp.login('00000000-0000-0000-0000-0000000022a1');

-- RF12: geração em conta — semanal a partir de hoje, até o horizonte (fim do mês +2), idempotente
reset role;
update public.recurrences set active = false where household_id = pg_temp.fx('h');  -- isola a geração
select pg_temp.login('00000000-0000-0000-0000-0000000022a1');
insert into fixture select 'sal', public.recurrence_create('income', 'Diária', 150, null, pg_temp.hoje(), pg_temp.fx('bank'),
                                                           null, null, pg_temp.fx('cinc'), null, 'week', 1);
select ok(public.recurrence_materialize() > 0, 'RF12 gera as ocorrências semanais');
select is((select string_agg(date::text, ' ' order by date) from public.transactions where recurrence_id = pg_temp.fx('sal')),
  (select string_agg(d::date::text, ' ' order by d) from generate_series(pg_temp.hoje(), (pg_temp.mes(3) - 1), interval '7 days') d),
  'RF12 uma por semana, de hoje até o fim do mês +2, todas planejadas');
select is((select count(*) from public.transactions where recurrence_id = pg_temp.fx('sal') and status <> 'planned'), 0::bigint,
  'RF12 todas como Planejado');
select is(public.recurrence_materialize(), 0, 'RF12 segunda geração não cria nada');
select lives_ok($$update public.transactions set deleted_at = now()
  where recurrence_id = pg_temp.fx('sal') and date = (select max(date) from public.transactions where recurrence_id = pg_temp.fx('sal'))$$,
  'RF12 exclui a última ocorrência');
select is(public.recurrence_materialize(), 0, 'RF12 a excluída não volta');
select lives_ok($$select public.recurrence_end(pg_temp.fx('sal'), pg_temp.hoje() + 7)$$, 'RF12 encerra em hoje+7');
select is((select count(*) from public.transactions where recurrence_id = pg_temp.fx('sal') and deleted_at is null), 2::bigint,
  'RF12 encerrar deixa só as de hoje e hoje+7');

-- RF13: projeção das assinaturas de cartão usa a mesma série (fechamento dia 17)
-- anual dia 5 a partir do mês que vem: só entra na fatura daquele mês (e 12 meses depois), não todo mês
insert into fixture select 'anual', public.recurrence_create('card', 'Anuidade streaming', 199.90, 5, pg_temp.mes(1), null, null,
                                                             pg_temp.fx('card'), pg_temp.fx('cexp'), null, 'month', 12);
create function pg_temp.pend(p_rec uuid, n integer) returns bigint language sql as $f$
  select count(*) from private.card_recurrence_pending(pg_temp.fx('h'), pg_temp.mes(n), (pg_temp.mes(n + 1) - 1)) x
   join public.recurrences r on r.id = p_rec and r.amount = x.amount $f$;
grant execute on function pg_temp.pend(uuid, integer) to public;
select is(array[pg_temp.pend(pg_temp.fx('anual'), 1), pg_temp.pend(pg_temp.fx('anual'), 2), pg_temp.pend(pg_temp.fx('anual'), 3),
                pg_temp.pend(pg_temp.fx('anual'), 12), pg_temp.pend(pg_temp.fx('anual'), 13)],
  array[1, 0, 0, 0, 1]::bigint[], 'RF13 anual no cartão: projeta só no mês da fatura, de 12 em 12 meses');
-- semanal a partir de hoje: na fatura do mês +3 (fecha dia 17) entram as compras de 17 do mês +2 a 16 do mês +3
-- (compra NO dia do fechamento vai para a fatura seguinte: 20 - Regras do dinheiro)
insert into fixture select 'semanal', public.recurrence_create('card', 'Feira semanal', 33.33, null, pg_temp.hoje(), null, null,
                                                               pg_temp.fx('card'), pg_temp.fx('cexp'), null, 'week', 1);
select is(pg_temp.pend(pg_temp.fx('semanal'), 3),
  (select count(*) from generate_series(pg_temp.hoje(), pg_temp.mes(4), interval '7 days') d
    where d::date between pg_temp.mes(2) + 16 and pg_temp.mes(3) + 15),
  'RF13 semanal no cartão: projeta cada semana que cai na fatura (não uma por mês)');

-- RF14: isolamento — a outra família não vê as regras nem as datas
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000022a2');
select is((select count(*) from public.recurrences where id = pg_temp.fx('w1')), 0::bigint, 'RF14 outra família não vê a regra');
select is(pg_temp.serie(pg_temp.fx('w1'), '2027-01-01', '2027-12-31'), '', 'RF14 nem a série de datas dela');

select * from finish();
rollback;
