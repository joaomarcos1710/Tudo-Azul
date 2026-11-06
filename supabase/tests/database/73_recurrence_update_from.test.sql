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
-- "Este e os próximos" com o formulário inteiro: devolve o número que a função devolve, ou "erro SQLSTATE"
create function pg_temp.proximos9(p_t uuid, p_d date, p_desc text, p_v numeric, p_cat uuid, p_st text, p_notas text,
                                  p_conta uuid, p_destino uuid) returns text language plpgsql as $f$
declare r text;
begin
  execute 'select public.recurrence_update_from($1, $2, $3, $4, $5, $6, $7, $8, $9)::text' into r
    using p_t, p_d, p_desc, p_v, p_cat, p_st, p_notas, p_conta, p_destino;
  return r;
exception when others then return 'erro ' || sqlstate;
end $f$;
-- o mesmo, mantendo situação, observação e conta que o lançamento tem (lidos com a RLS de quem chama)
create function pg_temp.proximos(p_t uuid, p_d date, p_desc text, p_v numeric, p_cat uuid) returns text language plpgsql as $f$
declare x public.transactions%rowtype;
begin
  begin
    select * into x from public.transactions where id = p_t;
  exception when others then null;   -- anon não lê: vai sem os campos (a função recusa antes)
  end;
  return pg_temp.proximos9(p_t, p_d, p_desc, p_v, p_cat, x.status, x.notes, x.account_id, x.destination_account_id);
end $f$;
-- a mensagem do erro (para conferir as datas do limite)
create function pg_temp.msg9(p_t uuid, p_d date, p_desc text, p_v numeric, p_cat uuid) returns text language plpgsql as $f$
begin
  execute 'select public.recurrence_update_from($1, $2, $3, $4, $5, $6, $7, $8, $9)'
    using p_t, p_d, p_desc, p_v, p_cat, 'planned', null::text, (select account_id from public.transactions where id = p_t), null::uuid;
  return 'ok';
exception when others then return sqlerrm;
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
  pg_temp.proximos9(uuid, date, text, numeric, uuid, text, text, uuid, uuid), pg_temp.msg9(uuid, date, text, numeric, uuid),
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

-- empurrar a 3ª para o lugar da 4ª (mesmo dia, um mês à frente): agora é mudar de mês, recusado (decisão #191)
select is(pg_temp.proximos(pg_temp.fx('f2'), pg_temp.dia(3, 8), 'Curso', 50.00, pg_temp.fx('catA')), 'erro 22023',
  'P35 empurrar para o mês da seguinte: recusado');
select is(pg_temp.lanc('f2') || ' ' || pg_temp.lanc('f3'),
  pg_temp.dia(2, 8) || '|50.00|Curso|catA|planned|false ' || pg_temp.dia(3, 8) || '|50.00|Curso|catA|planned|false',
  'P36 a recusa não mexe em nada');

-- ===========================================================================================================
-- Revisão de dinheiro (#191): reancorar uma ocorrência mais adiante e depois editar uma ANTERIOR só no valor.
-- Antes: as chaves das próximas eram recalculadas na grade antiga e a regra gerava a partir do começo novo — semanal,
-- a cada N dias e bimestral criavam ocorrências em dobro; o mensal mudava datas sem pedido. Agora: recusado (22023,
-- "edite a partir de <data>"), nada muda, nada a mais é gerado nem previsto.
-- ===========================================================================================================
create temp table snap (r text, id uuid, d date);
grant all on snap to public;
create temp table proj (k text primary key, v numeric);
grant all on proj to public;
-- menor distância (dias) entre duas ocorrências fora da lixeira da regra, e quantas ocorrências a regra ainda prevê até
-- a última gerada (o que account_recurrence_pending somaria ao saldo previsto)
create function pg_temp.menor_intervalo(p_r uuid) returns integer language sql as $f$
  select min(d - ant) from (select date as d, lag(date) over (order by date) as ant from public.transactions
                             where recurrence_id = p_r and deleted_at is null) x $f$;
create function pg_temp.previstas(p_r uuid) returns bigint language sql as $f$
  select count(*) from private.account_recurrence_pending(pg_temp.fx('h'), pg_temp.dt('M'),
                         (select max(date) from public.transactions where recurrence_id = p_r)) p
   where p.recurrence_id = p_r $f$;
create function pg_temp.datas_mudaram(p_r text) returns bigint language sql as $f$
  select count(*) from snap s join public.transactions t on t.id = s.id where s.r = p_r and t.date is distinct from s.d $f$;
create function pg_temp.fotografa(p_r text) returns void language sql as $f$
  insert into snap select p_r, t.id, t.date from public.transactions t where t.recurrence_id = pg_temp.fx(p_r);
  insert into proj select p_r, total from public.balance_totals_projected(pg_temp.fx('h'), (pg_temp.dt('M') + interval '13 months')::date, true) $f$;
grant execute on function pg_temp.menor_intervalo(uuid), pg_temp.previstas(uuid), pg_temp.datas_mudaram(text), pg_temp.fotografa(text) to public;
create function pg_temp.projetado() returns numeric language sql as $f$
  select total from public.balance_totals_projected(pg_temp.fx('h'), (pg_temp.dt('M') + interval '13 months')::date, true) $f$;
grant execute on function pg_temp.projetado() to public;

-- R1 semanal: reancora a 3ª (+2 dias), depois edita a 1ª só no valor
insert into fixture select 'w', public.recurrence_create('expense', 'Feira', 50.00, null, pg_temp.dia(0, 1), pg_temp.fx('cc'), null, null, pg_temp.fx('catA'), null, 'week', 1);
select public.recurrence_materialize();
insert into fixture select 'w' || k, (select id from public.transactions where recurrence_id = pg_temp.fx('w') and occurrence_date = pg_temp.dia(0, 1) + 7 * k) from generate_series(0, 5) k;
select isnt(pg_temp.proximos(pg_temp.fx('w2'), pg_temp.dia(0, 1) + 16, 'Feira', 55.00, pg_temp.fx('catA')), 'erro 22023', 'R1a semanal: reancorar a 3ª dois dias depois é aceito');
select is(public.recurrence_materialize(), 0, 'R1b ... e não gera nada a mais');
select pg_temp.fotografa('w');
select is(pg_temp.proximos(pg_temp.fx('w0'), pg_temp.dia(0, 1), 'Feira', 60.00, pg_temp.fx('catA')), 'erro 22023', 'R1c editar a 1ª (anterior ao começo novo) só no valor: recusado');
select matches(pg_temp.msg9(pg_temp.fx('w0'), pg_temp.dia(0, 1), 'Feira', 60.00, pg_temp.fx('catA')), (pg_temp.dia(0, 1) + 16)::text, 'R1d a mensagem diz de onde editar');
select is(pg_temp.previstas(pg_temp.fx('w')), 0::bigint, 'R1e nenhuma ocorrência prevista em dobro (account_recurrence_pending)');
select is(public.recurrence_materialize(), 0, 'R1f recurrence_materialize devolve 0');
select is(pg_temp.menor_intervalo(pg_temp.fx('w')), 7, 'R1g nenhuma semana com duas ocorrências');
select is(pg_temp.datas_mudaram('w'), 0::bigint, 'R1h nenhuma data mudou');
select is(pg_temp.projetado(), (select v from proj where k = 'w'), 'R1i saldo previsto igual (sem dupla contagem)');

-- R2 a cada 10 dias (com data final): reancora a 3ª (+3 dias), depois edita a 1ª só no valor
insert into fixture select 'd', public.recurrence_create('expense', 'Gás', 30.00, null, pg_temp.dia(0, 1), pg_temp.fx('cc'), null, null, pg_temp.fx('catA'), pg_temp.dia(6, 1), 'day', 10);
select public.recurrence_materialize();
insert into fixture select 'd' || k, (select id from public.transactions where recurrence_id = pg_temp.fx('d') and occurrence_date = pg_temp.dia(0, 1) + 10 * k) from generate_series(0, 5) k;
select isnt(pg_temp.proximos(pg_temp.fx('d2'), pg_temp.dia(0, 1) + 23, 'Gás', 30.00, pg_temp.fx('catA')), 'erro 22023', 'R2a a cada 10 dias: reancorar a 3ª é aceito');
select is(public.recurrence_materialize(), 0, 'R2b ... e não gera nada a mais');
select pg_temp.fotografa('d');
select is(pg_temp.proximos(pg_temp.fx('d0'), pg_temp.dia(0, 1), 'Gás', 35.00, pg_temp.fx('catA')), 'erro 22023', 'R2c editar a 1ª só no valor: recusado');
select is(pg_temp.previstas(pg_temp.fx('d')), 0::bigint, 'R2d nenhuma prevista em dobro');
select is(public.recurrence_materialize(), 0, 'R2e recurrence_materialize devolve 0');
select is(pg_temp.menor_intervalo(pg_temp.fx('d')), 10, 'R2f nenhuma posição com duas ocorrências');
select is(pg_temp.datas_mudaram('d'), 0::bigint, 'R2g nenhuma data mudou');
select is(pg_temp.projetado(), (select v from proj where k = 'd'), 'R2h saldo previsto igual');

-- R3 bimestral: reancora a 3ª (mês +4 → dia 5 do mês +5), depois edita a 1ª só no valor
insert into fixture select 'b', public.recurrence_create('expense', 'IPVA', 70.00, 10, pg_temp.dia(0), pg_temp.fx('cc'), null, null, pg_temp.fx('catA'), null, 'month', 2);
select public.recurrence_materialize();
insert into fixture select 'b' || k, (select id from public.transactions where recurrence_id = pg_temp.fx('b') and occurrence_date = pg_temp.dia(2 * k)) from generate_series(0, 4) k;
select isnt(pg_temp.proximos(pg_temp.fx('b2'), pg_temp.dia(5, 5), 'IPVA', 70.00, pg_temp.fx('catA')), 'erro 22023', 'R3a bimestral: reancorar a 3ª no 2º mês do período dela é aceito');
select is(public.recurrence_materialize(), 0, 'R3b ... e não gera nada a mais');
select pg_temp.fotografa('b');
select is(pg_temp.proximos(pg_temp.fx('b0'), pg_temp.dia(0), 'IPVA', 75.00, pg_temp.fx('catA')), 'erro 22023', 'R3c editar a 1ª só no valor: recusado');
select is(pg_temp.previstas(pg_temp.fx('b')), 0::bigint, 'R3d nenhuma prevista em dobro');
select is(public.recurrence_materialize(), 0, 'R3e recurrence_materialize devolve 0 (não vira mensal)');
select cmp_ok(pg_temp.menor_intervalo(pg_temp.fx('b')), '>=', 55, 'R3f nenhum bimestre com duas ocorrências');
select is(pg_temp.datas_mudaram('b'), 0::bigint, 'R3g nenhuma data mudou');
select is(pg_temp.projetado(), (select v from proj where k = 'b'), 'R3h saldo previsto igual');

-- R4 mensal: reancora a 3ª no dia 20, depois edita a 1ª só no valor (antes: a 2ª ia para o dia 20 sem pedido)
insert into fixture select 'm', public.recurrence_create('expense', 'Net', 80.00, 10, pg_temp.dia(0), pg_temp.fx('cc'), null, null, pg_temp.fx('catA'));
select public.recurrence_materialize();
insert into fixture select 'm' || k, (select id from public.transactions where recurrence_id = pg_temp.fx('m') and occurrence_date = pg_temp.dia(k)) from generate_series(0, 5) k;
select isnt(pg_temp.proximos(pg_temp.fx('m2'), pg_temp.dia(2, 20), 'Net', 80.00, pg_temp.fx('catA')), 'erro 22023', 'R4a mensal: reancorar a 3ª no dia 20 é aceito');
select is(public.recurrence_materialize(), 0, 'R4b ... e não gera nada a mais');
select pg_temp.fotografa('m');
select is(pg_temp.proximos(pg_temp.fx('m0'), pg_temp.dia(0), 'Net', 90.00, pg_temp.fx('catA')), 'erro 22023', 'R4c editar a 1ª só no valor: recusado');
select is(pg_temp.previstas(pg_temp.fx('m')), 0::bigint, 'R4d nenhuma prevista em dobro');
select is(public.recurrence_materialize(), 0, 'R4e recurrence_materialize devolve 0');
select is((select count(*) from (select 1 from public.transactions where recurrence_id = pg_temp.fx('m') and deleted_at is null
                                  group by date_trunc('month', date) having count(*) > 1) x), 0::bigint, 'R4f nenhum mês com duas ocorrências');
select is(pg_temp.datas_mudaram('m'), 0::bigint, 'R4g nenhuma data mudou (a 2ª continua no dia 10)');
select is(pg_temp.projetado(), (select v from proj where k = 'm'), 'R4h saldo previsto igual');
-- de onde a mensagem manda (a reancorada) dá: só o valor, as próximas acompanham e as datas ficam
select is(pg_temp.proximos(pg_temp.fx('m2'), pg_temp.dia(2, 20), 'Net', 90.00, pg_temp.fx('catA')), '9', 'R4i editar a partir da reancorada: aceito (as 9 seguintes geradas acompanham)');
select is(pg_temp.lanc('m1') || ' ' || pg_temp.lanc('m3'),
  pg_temp.dia(1) || '|80.00|Net|catA|planned|false ' || pg_temp.dia(3, 20) || '|90.00|Net|catA|planned|false', 'R4j a anterior fica; a próxima só muda o valor');
select is(public.recurrence_materialize(), 0, 'R4k nada a mais gerado');

-- ===========================================================================================================
-- Trocar de período (decisão do dono, #191): a data nova fica entre a anterior e a seguinte (datas reais) e, no mensal,
-- no mês da ocorrência
-- ===========================================================================================================
insert into fixture select 'c', public.recurrence_create('expense', 'Água', 40.00, 10, pg_temp.dia(0), pg_temp.fx('cc'), null, null, pg_temp.fx('catA'));
select public.recurrence_materialize();
insert into fixture select 'c' || k, (select id from public.transactions where recurrence_id = pg_temp.fx('c') and occurrence_date = pg_temp.dia(k)) from generate_series(0, 4) k;
select is(pg_temp.proximos(pg_temp.fx('c1'), pg_temp.dia(0, 25), 'Água', 40.00, pg_temp.fx('catA')), 'erro 22023', 'T1 mensal: a do mês +1 no dia 25 do mês anterior: recusado');
select matches(pg_temp.msg9(pg_temp.fx('c1'), pg_temp.dia(0, 25), 'Água', 40.00, pg_temp.fx('catA')),
  'depois de ' || (pg_temp.dt('M') + interval '1 month - 1 day')::date || ' e antes de ' || (pg_temp.dt('M') + interval '2 months')::date,
  'T2 a mensagem dá o intervalo (o mês da ocorrência)');
select is(pg_temp.lanc('c1'), pg_temp.dia(1) || '|40.00|Água|catA|planned|false', 'T3 a recusa não mexe');
select is(pg_temp.proximos(pg_temp.fx('c1'), pg_temp.dia(1, 15), 'Água', 40.00, pg_temp.fx('catA')), '10', 'T4 dia 10 → 15 no mesmo mês: aceito');
-- a anterior movida à mão para dentro do mês desta (paga com atraso, dia 5 do mês +3): a data nova precisa ficar depois dela
update public.transactions set date = pg_temp.dia(3, 5), status = 'paid' where id = pg_temp.fx('c2');
select is(pg_temp.proximos(pg_temp.fx('c3'), pg_temp.dia(3, 3), 'Água', 40.00, pg_temp.fx('catA')), 'erro 22023', 'T5 antes da anterior movida à mão: recusado');
select is(pg_temp.proximos(pg_temp.fx('c3'), pg_temp.dia(3, 8), 'Água', 40.00, pg_temp.fx('catA')), '8', 'T6 depois dela, no mesmo mês: aceito');
select is((select count(*) from (select 1 from public.transactions where recurrence_id = pg_temp.fx('c') and deleted_at is null
                                  group by date_trunc('month', date) having count(*) > 1) x), 1::bigint,
  'T7 só o mês da paga com atraso tem duas (a correção à mão do usuário), nenhum outro');
-- semanal: passar da seguinte é recusado; dentro do intervalo, aceito
insert into fixture select 'p', public.recurrence_create('expense', 'Padaria', 20.00, null, pg_temp.dia(0, 2), pg_temp.fx('cc'), null, null, pg_temp.fx('catA'), null, 'week', 1);
select public.recurrence_materialize();
insert into fixture select 'p' || k, (select id from public.transactions where recurrence_id = pg_temp.fx('p') and occurrence_date = pg_temp.dia(0, 2) + 7 * k) from generate_series(0, 3) k;
select is(pg_temp.proximos(pg_temp.fx('p2'), pg_temp.dia(0, 2) + 21, 'Padaria', 20.00, pg_temp.fx('catA')), 'erro 22023', 'T8 semanal: no dia da seguinte: recusado');
select is(pg_temp.proximos(pg_temp.fx('p2'), pg_temp.dia(0, 2) + 7, 'Padaria', 20.00, pg_temp.fx('catA')), 'erro 22023', 'T9 semanal: no dia da anterior: recusado');
select is(pg_temp.proximos(pg_temp.fx('p2'), pg_temp.dia(0, 2) + 15, 'Padaria', 20.00, pg_temp.fx('catA')),
  (select (count(*) - 3)::text from public.transactions where recurrence_id = pg_temp.fx('p') and deleted_at is null), 'T10 semanal: um dia depois: aceito');
select is(public.recurrence_materialize(), 0, 'T11 nada a mais gerado');

-- ===========================================================================================================
-- Uma chamada só (#191): situação, observação e conta vão junto; qualquer recusa desfaz tudo
-- ===========================================================================================================
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Poupança', 'savings', 0, '2026-01-01') returning id)
  insert into fixture select 'cc2', id from i;
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Antiga', 'checking', 0, '2026-01-01') returning id)
  insert into fixture select 'ccx', id from i;
update public.accounts set active = false where id = pg_temp.fx('ccx');
insert into fixture select 's', public.recurrence_create('expense', 'Seguro', 60.00, 7, pg_temp.dia(0, 7), pg_temp.fx('cc'), null, null, pg_temp.fx('catA'));
select public.recurrence_materialize();
insert into fixture select 's' || k, (select id from public.transactions where recurrence_id = pg_temp.fx('s') and occurrence_date = pg_temp.dia(k, 7)) from generate_series(0, 2) k;
select is(pg_temp.proximos9(pg_temp.fx('s0'), pg_temp.dia(0, 7), 'Seguro', 65.00, pg_temp.fx('catA'), 'planned', null, pg_temp.fx('ccx'), null),
  'erro 23514', 'U1 conta desativada: recusado');
select is((select amount::numeric(14,2)::text from public.recurrences where id = pg_temp.fx('s')) || ' ' || pg_temp.lanc('s0') || ' ' || pg_temp.lanc('s1'),
  '60.00 ' || pg_temp.dia(0, 7) || '|60.00|Seguro|catA|planned|false ' || pg_temp.dia(1, 7) || '|60.00|Seguro|catA|planned|false',
  'U2 nada mudou: regra, esta e as próximas');
select is(pg_temp.proximos9(pg_temp.fx('s0'), pg_temp.dia(0, 7), 'Seguro', 65.00, pg_temp.fx('catA'), 'paid', 'débito automático', pg_temp.fx('cc2'), null),
  '11', 'U3 com situação, observação e conta: aceito');
select is((select status || '|' || notes || '|' || (account_id = pg_temp.fx('cc2')) from public.transactions where id = pg_temp.fx('s0')),
  'paid|débito automático|true', 'U4 esta ocorrência recebe situação, observação e conta');
select is((select status || '|' || coalesce(notes, '-') || '|' || (account_id = pg_temp.fx('cc')) || '|' || amount::numeric(14,2) from public.transactions where id = pg_temp.fx('s1')),
  'planned|-|true|65.00', 'U5 a próxima: só o valor (situação, observação e conta valem só para esta)');
select is((select account_id = pg_temp.fx('cc') from public.recurrences where id = pg_temp.fx('s')), true, 'U6 a regra continua na conta dela');
-- período conciliado: marcar como pago numa data já conciliada é recusado e nada muda
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Conciliada', 'checking', 0, '2026-01-01') returning id)
  insert into fixture select 'ccc', id from i;
insert into fixture select 'n', public.recurrence_create('expense', 'Internet', 100.00, 5, pg_temp.dia(0, 5), pg_temp.fx('ccc'), null, null, pg_temp.fx('catA'));
select public.recurrence_materialize();
insert into fixture select 'n' || k, (select id from public.transactions where recurrence_id = pg_temp.fx('n') and occurrence_date = pg_temp.dia(k, 5)) from generate_series(0, 1) k;
reset role;
insert into public.account_reconciliations (household_id, account_id, as_of, statement_balance)
  values (pg_temp.fx('h'), pg_temp.fx('ccc'), pg_temp.dia(0, 28), 0);
select pg_temp.login('00000000-0000-0000-0000-0000000073a1');
select is(pg_temp.proximos9(pg_temp.fx('n0'), pg_temp.dia(0, 5), 'Internet', 120.00, pg_temp.fx('catA'), 'paid', null, pg_temp.fx('ccc'), null),
  'erro 55000', 'U7 pago em período conciliado: recusado');
select is((select amount::numeric(14,2)::text from public.recurrences where id = pg_temp.fx('n')) || ' ' || pg_temp.lanc('n0') || ' ' || pg_temp.lanc('n1'),
  '100.00 ' || pg_temp.dia(0, 5) || '|100.00|Internet|catA|planned|false ' || pg_temp.dia(1, 5) || '|100.00|Internet|catA|planned|false',
  'U8 nada mudou: regra, esta e as próximas');

-- ===========================================================================================================
-- Menores (#191): família antes de tudo, regra encerrada, categoria desativada ou vazia
-- ===========================================================================================================
create function pg_temp.aplica(p_t uuid) returns text language plpgsql as $f$
begin
  perform private.recurrence_update_from_apply(p_t, date '2030-01-01', 'x', 1, null, 'planned', null, null, null);
  return 'ok';
exception when others then return 'erro ' || sqlstate;
end $f$;
grant execute on function pg_temp.aplica(uuid) to public;
select pg_temp.login('00000000-0000-0000-0000-0000000073a2');
select is(pg_temp.aplica(pg_temp.fx('solto')), 'erro 42501', 'V1 outra família chamando a interna com lançamento que não é de recorrente: 42501 (não revela)');
select pg_temp.login('00000000-0000-0000-0000-0000000073a1');
reset role;
update public.recurrences set active = false where id = pg_temp.fx('s');
select pg_temp.login('00000000-0000-0000-0000-0000000073a1');
select is(pg_temp.proximos(pg_temp.fx('s1'), pg_temp.dia(1, 7), 'Seguro', 70.00, pg_temp.fx('catA')), 'erro 55000', 'V2 recorrente encerrado: recusado');
reset role;
update public.recurrences set active = true where id = pg_temp.fx('s');
with i as (insert into public.categories (household_id, name, type, active) values (pg_temp.fx('h'), 'Desativada', 'expense', false) returning id)
  insert into fixture select 'catX', id from i;
select pg_temp.login('00000000-0000-0000-0000-0000000073a1');
select is(pg_temp.proximos(pg_temp.fx('s1'), pg_temp.dia(1, 7), 'Seguro', 70.00, pg_temp.fx('catX')),
  'erro 22023', 'V3 categoria desativada nova na série: recusada');
select is(pg_temp.proximos(pg_temp.fx('s1'), pg_temp.dia(1, 7), 'Seguro', 70.00, null), 'erro 22023', 'V4 despesa sem categoria: recusada (antes virava a da regra sem avisar)');
select is((select amount::numeric(14,2)::text || '|' || (category_id = pg_temp.fx('catA')) from public.recurrences where id = pg_temp.fx('s')),
  '65.00|true', 'V5 as recusas não mexeram na regra');
-- manter a categoria que a regra já tem, mesmo desativada depois, continua possível (o formulário oferece a atual)
reset role;
update public.categories set active = false where id = pg_temp.fx('catB');
select pg_temp.login('00000000-0000-0000-0000-0000000073a1');
select is(pg_temp.proximos(pg_temp.fx('o7'), pg_temp.dia(7, 15), 'Luz nova', 155.00, pg_temp.fx('catB')), '4', 'V6 categoria desativada que a regra já tem: aceita');

select * from finish();
rollback;
