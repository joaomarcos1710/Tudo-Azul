-- 73_recurrence_update_from: migration 073. Editar um lançamento recorrente e escolher "Este e os próximos"
-- (public.recurrence_update_from). A regra é reancorada nesta ocorrência: valor, descrição e categoria novos e, se a data
-- mudou, o dia novo; as próximas planejadas que ninguém corrigiu acompanham; pagas, na lixeira e corrigidas à mão ficam;
-- a ocorrência editada fica na data nova; a geração não duplica; o resumo de Recorrentes (063) e o saldo previsto (069)
-- refletem; outra família e anon não conseguem. Datas relativas a hoje em São Paulo (a geração usa o relógio): a regra
-- começa no mês que vem. Sem dado real. A função nova vai por SQL dinâmico: sem a migration as asserções falham sem
-- abortar o arquivo.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create temp table fixture (k text primary key, v uuid);
grant all on fixture to public;
create temp table datas (k text primary key, d date);
grant all on datas to public;
create function pg_temp.fx(p_k text) returns uuid language sql as $f$ select v from fixture where k = p_k $f$;
create function pg_temp.dt(p_k text) returns date language sql as $f$ select d from datas where k = p_k $f$;
create function pg_temp.login(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $f$;
-- "Este e os próximos": devolve o número que a função devolve, ou "erro SQLSTATE"
create function pg_temp.proximos(p_t uuid, p_d date, p_desc text, p_v numeric, p_cat uuid) returns text language plpgsql as $f$
declare r text;
begin
  execute 'select public.recurrence_update_from($1, $2, $3, $4, $5)::text' into r using p_t, p_d, p_desc, p_v, p_cat;
  return r;
exception when others then return 'erro ' || sqlstate;
end $f$;
-- "data|valor|descrição|categoria|situação|na lixeira" de um lançamento
create function pg_temp.lanc(p_k text) returns text language sql as $f$
  select t.date || '|' || t.amount::numeric(14,2) || '|' || t.description || '|' ||
         coalesce((select f.k from fixture f where f.v = t.category_id and f.k like 'cat%'), '-') || '|' || t.status || '|' ||
         (t.deleted_at is not null)
    from public.transactions t where t.id = pg_temp.fx(p_k) $f$;
-- dia 10 (ou p_dia) do mês M + k
create function pg_temp.dia(p_k integer, p_dia integer default 10) returns date language sql as $f$
  select (pg_temp.dt('M') + make_interval(months => p_k) + make_interval(days => p_dia - 1))::date $f$;
grant execute on function pg_temp.fx(text), pg_temp.dt(text), pg_temp.login(uuid), pg_temp.proximos(uuid, date, text, numeric, uuid),
  pg_temp.lanc(text), pg_temp.dia(integer, integer) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000073a1', 'proximos-a@teste.com'),
  ('00000000-0000-0000-0000-0000000073a2', 'proximos-b@teste.com');

-- M = 1º dia do mês que vem (em São Paulo)
insert into datas values ('M', (date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date) + interval '1 month')::date);

-- família vizinha
select pg_temp.login('00000000-0000-0000-0000-0000000073a2');
insert into fixture select 'h2', public.create_household('Casa vizinha');

select pg_temp.login('00000000-0000-0000-0000-0000000073a1');
insert into fixture select 'h', public.create_household('Casa Próximos');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Corrente', 'checking', 1000, '2026-01-01') returning id)
  insert into fixture select 'cc', id from i;
insert into fixture select 'catA', id from public.categories where household_id = pg_temp.fx('h') and type = 'expense' and system_key = 'uncategorized';
with i as (insert into public.categories (household_id, name, type) values (pg_temp.fx('h'), 'Energia', 'expense') returning id)
  insert into fixture select 'catB', id from i;
insert into fixture select 'catR', id from public.categories where household_id = pg_temp.fx('h') and type = 'income' and system_key = 'uncategorized';

-- Luz: mensal, dia 10, R$ 100,00, desde o dia 10 do mês que vem
insert into fixture select 'r', public.recurrence_create('expense', 'Luz', 100.00, 10, pg_temp.dia(0), pg_temp.fx('cc'), null, null, pg_temp.fx('catA'));
select public.recurrence_materialize();
insert into fixture select 'o' || k, (select id from public.transactions where recurrence_id = pg_temp.fx('r') and occurrence_date = pg_temp.dia(k))
  from generate_series(0, 8) k;
select is((select count(*) from fixture where k like 'o%' and v is not null), 9::bigint, 'P0 as 9 primeiras ocorrências foram geradas (dia 10)');
create temp table antes as select count(*) as n from public.transactions where recurrence_id = pg_temp.fx('r');
grant all on antes to public;

-- o1 paga (adiantada), o2 com o valor corrigido à mão, o3 com a data corrigida à mão, o4 na lixeira
update public.transactions set status = 'paid' where id = pg_temp.fx('o1');
update public.transactions set amount = 130.00 where id = pg_temp.fx('o2');
update public.transactions set date = pg_temp.dia(3, 12) where id = pg_temp.fx('o3');
update public.transactions set deleted_at = now() where id = pg_temp.fx('o4');
-- um lançamento solto (não é de recorrente)
with i as (insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status)
           values (pg_temp.fx('h'), pg_temp.fx('cc'), pg_temp.fx('catA'), 'expense', 'Solto', 10.00, pg_temp.dia(0), 'planned') returning id)
  insert into fixture select 'solto', id from i;

-- saldo previsto no fim do mês M+5 e total do resumo, antes
create temp table previsto (k text primary key, v numeric);
grant all on previsto to public;
insert into previsto select 'antes', total from public.balance_totals_projected(pg_temp.fx('h'), (pg_temp.dt('M') + interval '6 months - 1 day')::date, true);

-- recusas antes de mexer
select is(pg_temp.proximos(pg_temp.fx('solto'), pg_temp.dia(0, 15), 'Solto', 20.00, pg_temp.fx('catA')), 'erro 22023', 'P1 lançamento que não é de recorrente: recusado');
select is(pg_temp.proximos(pg_temp.fx('o0'), pg_temp.dia(0, 15), 'Luz', 0, pg_temp.fx('catA')), 'erro 22023', 'P2 valor zero: recusado');
select is(pg_temp.proximos(pg_temp.fx('o0'), pg_temp.dia(0, 15), '   ', 120.00, pg_temp.fx('catA')), 'erro 22023', 'P3 descrição vazia: recusada');
select is(pg_temp.proximos(pg_temp.fx('o0'), pg_temp.dia(0, 15), 'Luz', 120.00, pg_temp.fx('catR')), 'erro 23514', 'P4 categoria de receita numa despesa: recusada');
select is(pg_temp.proximos(pg_temp.fx('o4'), pg_temp.dia(4, 15), 'Luz', 120.00, pg_temp.fx('catA')), 'erro 55000', 'P5 ocorrência na lixeira: recusada');
select is(pg_temp.proximos(pg_temp.fx('o5'), pg_temp.dia(4, 10), 'Luz', 120.00, pg_temp.fx('catA')), 'erro 22023', 'P6 nova data no lugar da ocorrência anterior: recusada');

-- outra família e anon
select pg_temp.login('00000000-0000-0000-0000-0000000073a2');
select is(pg_temp.proximos(pg_temp.fx('o0'), pg_temp.dia(0, 15), 'Invasão', 1.00, null), 'erro 42501', 'P7 outra família não consegue');
set local role anon;
select is(pg_temp.proximos(pg_temp.fx('o0'), pg_temp.dia(0, 15), 'Invasão', 1.00, null), 'erro 42501', 'P8 anon não executa');
reset role;
select is((select amount::numeric(14,2)::text || '|' || day from public.recurrences where id = pg_temp.fx('r')), '100.00|10', 'P9 as recusas não mexeram na regra');

-- "Este e os próximos" na 1ª: dia 10 → dia 15, R$ 100,00 → R$ 120,00, "Luz" → "Luz nova", categoria A → B
select pg_temp.login('00000000-0000-0000-0000-0000000073a1');
select is(pg_temp.proximos(pg_temp.fx('o0'), pg_temp.dia(0, 15), ' Luz nova ', 120.00, pg_temp.fx('catB')),
  ((select n from antes) - 5)::text, 'P10 devolve quantas próximas acompanharam (todas menos a editada, a paga, as duas corrigidas e a excluída)');

select is(pg_temp.lanc('o0'), pg_temp.dia(0, 15) || '|120.00|Luz nova|catB|planned|false', 'P11 a ocorrência editada fica na data nova, com os valores novos');
select is(pg_temp.lanc('o1'), pg_temp.dia(1) || '|100.00|Luz|catA|paid|false', 'P12 a paga não muda');
select is(pg_temp.lanc('o2'), pg_temp.dia(2) || '|130.00|Luz|catA|planned|false', 'P13 a de valor corrigido à mão não muda');
select is(pg_temp.lanc('o3'), pg_temp.dia(3, 12) || '|100.00|Luz|catA|planned|false', 'P14 a de data corrigida à mão não muda');
select is(pg_temp.lanc('o4'), pg_temp.dia(4) || '|100.00|Luz|catA|planned|true', 'P15 a excluída continua na lixeira, como estava');
select is(pg_temp.lanc('o5'), pg_temp.dia(5, 15) || '|120.00|Luz nova|catB|planned|false', 'P16 as próximas: dia novo, valor, descrição e categoria novos');
select is(pg_temp.lanc('o8'), pg_temp.dia(8, 15) || '|120.00|Luz nova|catB|planned|false', 'P17 ... até a última gerada');
select is((select amount::numeric(14,2) || '|' || day || '|' || start_date || '|' || description || '|' || (category_id = pg_temp.fx('catB'))
             from public.recurrences where id = pg_temp.fx('r')),
  '120.00|15|' || pg_temp.dia(0, 15) || '|Luz nova|true', 'P18 a regra: valor, dia, começo, descrição e categoria novos');
select is((select count(*) from public.transactions where recurrence_id = pg_temp.fx('r') and occurrence_date is not null
              and occurrence_date >= pg_temp.dia(0) and extract(day from occurrence_date) = 15),
  (select n from antes), 'P19 todas as chaves desta em diante estão na série nova (inclusive paga, corrigidas e excluída)');

-- a geração não duplica nem traz de volta a excluída; cada mês continua com uma só ocorrência
select is(public.recurrence_materialize(), 0, 'P20 recurrence_materialize não cria nada a mais');
select is((select count(*) from public.transactions where recurrence_id = pg_temp.fx('r')), (select n from antes), 'P21 mesmo número de ocorrências');
select is((select count(*) from (select date_trunc('month', occurrence_date) from public.transactions
                                   where recurrence_id = pg_temp.fx('r') group by 1 having count(*) > 1) x), 0::bigint,
  'P22 nenhum mês com duas ocorrências');

-- resumo de Recorrentes (063) e saldo previsto (069)
select is((select total_per_occurrence::numeric(14,2)::text || '|' || total_monthly::numeric(14,2)
             from public.recurrence_summary(pg_temp.fx('h')) where grouping_level = 'medium' and medium = 'account' and kind = 'expense'),
  '120.00|120.00', 'P23 o resumo de Recorrentes já mostra R$ 120,00');
-- até o fim de M+5: mudaram o0 e o5 (100 → 120); o1 paga, o2 e o3 corrigidas, o4 excluída
select is((select total from public.balance_totals_projected(pg_temp.fx('h'), (pg_temp.dt('M') + interval '6 months - 1 day')::date, true)),
  (select v from previsto where k = 'antes') - 40, 'P24 o saldo previsto desconta os R$ 20,00 a mais de cada próxima planejada');

-- sem mudar a data: só os valores, desta em diante; a anterior fica com a categoria que tinha
select is(pg_temp.proximos(pg_temp.fx('o6'), pg_temp.dia(6, 15), 'Luz nova', 150.00, pg_temp.fx('catB')),
  ((select n from antes) - 7)::text, 'P25 sem mudar a data: as próximas acompanham');
select is((select amount::numeric(14,2) || '|' || day || '|' || start_date from public.recurrences where id = pg_temp.fx('r')),
  '150.00|15|' || pg_temp.dia(0, 15), 'P26 sem mudar a data: o dia e o começo da série ficam');
select is(pg_temp.lanc('o5'), pg_temp.dia(5, 15) || '|120.00|Luz nova|catB|planned|false', 'P27 a anterior não muda');
select is(pg_temp.lanc('o7'), pg_temp.dia(7, 15) || '|150.00|Luz nova|catB|planned|false', 'P28 a próxima vai para R$ 150,00');

-- voltar a corrigida à mão (dia 12) para a data da série (dia 15) não é "mudar a data": a série não é reancorada nela
select is(pg_temp.proximos(pg_temp.fx('o3'), pg_temp.dia(3, 15), 'Luz nova', 150.00, pg_temp.fx('catB')),
  ((select n from antes) - 6)::text, 'P28a voltar para a data da série: as próximas iguais à regra acompanham');
select is((select day || '|' || start_date from public.recurrences where id = pg_temp.fx('r')),
  '15|' || pg_temp.dia(0, 15), 'P28b a série continua começando na 1ª (não reancora na data da própria série)');
select is(pg_temp.lanc('o3'), pg_temp.dia(3, 15) || '|150.00|Luz nova|catB|planned|false', 'P28c a ocorrência volta para a data da série');

-- recorrente com data final: a última continua sendo a última (4 ocorrências, dia 5 → dia 8 a partir da 2ª)
insert into fixture select 'rf', public.recurrence_create('expense', 'Curso', 50.00, 5, pg_temp.dia(0, 5), pg_temp.fx('cc'), null, null,
  pg_temp.fx('catA'), pg_temp.dia(3, 5));
select public.recurrence_materialize();
insert into fixture select 'f' || k, (select id from public.transactions where recurrence_id = pg_temp.fx('rf') and occurrence_date = pg_temp.dia(k, 5))
  from generate_series(0, 3) k;
select is(pg_temp.proximos(pg_temp.fx('f1'), pg_temp.dia(1, 8), 'Curso', 50.00, pg_temp.fx('catA')), '2', 'P29 com data final: as duas seguintes acompanham');
select is((select end_date from public.recurrences where id = pg_temp.fx('rf')), pg_temp.dia(3, 8), 'P30 a data final anda junto (dia 8 da última)');
select is(pg_temp.lanc('f0'), pg_temp.dia(0, 5) || '|50.00|Curso|catA|planned|false', 'P31 a anterior fica no dia 5');
select is(pg_temp.lanc('f3'), pg_temp.dia(3, 8) || '|50.00|Curso|catA|planned|false', 'P32 a última vai para o dia 8');
select is(public.recurrence_materialize(), 0, 'P33 nada a mais gerado');
select is((select count(*) from public.transactions where recurrence_id = pg_temp.fx('rf')), 4::bigint, 'P34 continuam 4 ocorrências');

-- empurrar a 3ª para o lugar da 4ª (mesmo dia, um mês à frente): a chave nova de uma é a antiga da seguinte, sem colidir
select is(pg_temp.proximos(pg_temp.fx('f2'), pg_temp.dia(3, 8), 'Curso', 50.00, pg_temp.fx('catA')), '1',
  'P35 empurrar para depois da seguinte: aceito, sem colisão de chave');
select is(pg_temp.lanc('f3'), pg_temp.dia(4, 8) || '|50.00|Curso|catA|planned|false', 'P36 a seguinte anda um mês junto');

select * from finish();
rollback;
