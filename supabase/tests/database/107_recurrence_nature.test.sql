-- 107_recurrence_nature: natureza da recorrência (migration 20261112120000). Coluna nullable com check de valores e de
-- consistência com o tipo (receita só 'reimbursement'; despesa e cartão só fixed/subscription/variable; transferência nenhuma),
-- RPC recurrence_set_nature (erros, outra família, anônimo, grants), criar/atualizar com natureza numa transação, e prova de que
-- a natureza não muda dinheiro (recurrence_summary, period_summary, ocorrências). As funções novas vão por SQL dinâmico ou
-- por pg_temp.sqlstate_of: sem a migration o teste falha nas asserções, sem abortar o arquivo. Sem dado real.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create temp table fixture (k text primary key, v uuid);
grant all on fixture to public;
create temp table nota (k text primary key, v text);
grant all on nota to public;
create function pg_temp.fx(p_k text) returns uuid language sql as $f$ select v from fixture where k = p_k $f$;
create function pg_temp.login(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $f$;
create function pg_temp.anon() returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);
end $f$;
create function pg_temp.hoje() returns date language sql stable as $f$ select (now() at time zone 'America/Sao_Paulo')::date $f$;
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
create function pg_temp.nat(p_id uuid) returns text language plpgsql as $f$
declare r text;
begin
  execute 'select coalesce(nature, ''null'') from public.recurrences where id = $1' into r using p_id;
  return coalesce(r, 'sumiu');
exception when others then return 'erro: ' || sqlerrm;
end $f$;
-- Tudo o que é dinheiro da família e das regras: resumo dos recorrentes, resumo do período, ocorrências geradas.
create function pg_temp.dinheiro(p_h uuid) returns text language sql as $f$
  select coalesce((select string_agg(s::text, ';' order by s::text)
                     from (select grouping_level, medium, kind, frequency, item_count,
                                  total_per_occurrence::numeric(14,2) as po, total_monthly::numeric(14,2) as pm
                             from public.recurrence_summary(p_h)) s), '-')
      || '|' || (select to_jsonb(p)::text from public.period_summary(p_h, pg_temp.hoje() - 30, pg_temp.hoje() + 400) p)
      || '|' || (select count(*) || '/' || coalesce(sum(amount), 0)::numeric(14,2) || '/' || coalesce(string_agg(distinct date::text, ','), '-')
                   from public.transactions where household_id = p_h and recurrence_id is not null)
      || '|' || (select count(*) || '/' || coalesce(sum(amount), 0)::numeric(14,2) from public.recurrences where household_id = p_h)
$f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.anon(), pg_temp.hoje(), pg_temp.sqlstate_of(text),
  pg_temp.nat(uuid), pg_temp.dinheiro(uuid) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000107', 'n1@teste.com'),
  ('00000000-0000-0000-0000-000000000108', 'n2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-000000000107');
insert into fixture select 'h', public.create_household('Casa da natureza');
with a as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 1000.00, '2026-01-01') returning id)
  insert into fixture select 'bank', id from a;
with a as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Poupança', 'checking', 0, '2026-01-01') returning id)
  insert into fixture select 'bank2', id from a;
insert into fixture select 'cexp', id from public.categories where household_id = pg_temp.fx('h') and type = 'expense' order by name limit 1;
insert into fixture select 'cinc', id from public.categories where household_id = pg_temp.fx('h') and type = 'income' order by name limit 1;
insert into fixture select 'card', public.create_debt('Cartão N', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('card'), 17, 25);
-- regras (início hoje: gera planejados e dá dinheiro para comparar)
insert into fixture select 'rexp', public.recurrence_create('expense', 'Aluguel', 1500.00, extract(day from pg_temp.hoje())::int, pg_temp.hoje(), pg_temp.fx('bank'), null, null, pg_temp.fx('cexp'), null, 'month', 1);
insert into fixture select 'rinc', public.recurrence_create('income', 'Reembolso plano', 250.50, extract(day from pg_temp.hoje())::int, pg_temp.hoje(), pg_temp.fx('bank'), null, null, pg_temp.fx('cinc'), null, 'month', 1);
insert into fixture select 'rtrf', public.recurrence_create('transfer', 'Reserva', 100.00, extract(day from pg_temp.hoje())::int, pg_temp.hoje(), pg_temp.fx('bank'), pg_temp.fx('bank2'), null, null, null, 'month', 1);
insert into fixture select 'rcard', public.recurrence_create('card', 'Streaming', 29.90, extract(day from pg_temp.hoje())::int, pg_temp.hoje(), null, null, pg_temp.fx('card'), pg_temp.fx('cexp'), null, 'month', 1);
select public.recurrence_materialize();

select pg_temp.login('00000000-0000-0000-0000-000000000108');
insert into fixture select 'h2', public.create_household('Outra casa');
with a as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h2'), 'Banco B', 'checking', 10.00, '2026-01-01') returning id)
  insert into fixture select 'bankb', id from a;
insert into fixture select 'cexpb', id from public.categories where household_id = pg_temp.fx('h2') and type = 'expense' order by name limit 1;
insert into fixture select 'rb', public.recurrence_create('expense', 'Luz B', 80.00, extract(day from pg_temp.hoje())::int, pg_temp.hoje(), pg_temp.fx('bankb'), null, null, pg_temp.fx('cexpb'), null, 'month', 1);

select pg_temp.login('00000000-0000-0000-0000-000000000107');

-- ---- A: coluna e check ----
select is((select data_type || '/' || is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'recurrences' and column_name = 'nature'),
          'text/YES', 'A1 recurrences.nature existe, texto, aceita nulo');
select is(pg_temp.nat(pg_temp.fx('rexp')), 'null', 'A2 regra nova nasce sem classificação (despesa)');
select is(pg_temp.nat(pg_temp.fx('rinc')), 'null', 'A3 regra nova nasce sem classificação (receita)');
select is(pg_temp.nat(pg_temp.fx('rcard')), 'null', 'A4 regra criada pelo caminho antigo nasce sem classificação (o preenchimento é só da migration)');
reset role;
select is(pg_temp.sqlstate_of(format($$update public.recurrences set nature = 'xyz' where id = %L$$, pg_temp.fx('rexp'))), '23514', 'A5 check recusa valor fora da lista');
select is(pg_temp.sqlstate_of(format($$update public.recurrences set nature = 'reimbursement' where id = %L$$, pg_temp.fx('rexp'))), '23514', 'A6 check recusa ressarcimento em despesa');
select is(pg_temp.sqlstate_of(format($$update public.recurrences set nature = 'fixed' where id = %L$$, pg_temp.fx('rinc'))), '23514', 'A7 check recusa custo fixo em receita');
select is(pg_temp.sqlstate_of(format($$update public.recurrences set nature = 'variable' where id = %L$$, pg_temp.fx('rtrf'))), '23514', 'A8 check recusa natureza em transferência');
select is(pg_temp.sqlstate_of(format($$update public.recurrences set nature = 'reimbursement' where id = %L$$, pg_temp.fx('rcard'))), '23514', 'A9 check recusa ressarcimento em assinatura de cartão');
select is(pg_temp.sqlstate_of(format($$update public.recurrences set nature = 'subscription' where id = %L$$, pg_temp.fx('rcard'))), null, 'A10 check aceita assinatura em cartão');

-- ---- B: backfill (o mesmo UPDATE da migration, sobre dados que a migration não viu) ----
update public.recurrences set nature = null where household_id = pg_temp.fx('h');
update public.recurrences set nature = 'subscription' where kind = 'card' and nature is null;
select is((select string_agg(kind || '=' || coalesce(nature, 'null'), ',' order by kind) from public.recurrences where household_id = pg_temp.fx('h')),
          'card=subscription,expense=null,income=null,transfer=null', 'B1 backfill: só o cartão vira assinatura; despesa, receita e transferência ficam sem classificação');
update public.recurrences set nature = null where household_id = pg_temp.fx('h');
select pg_temp.login('00000000-0000-0000-0000-000000000107');

-- ---- C: recurrence_set_nature ----
select is(pg_temp.sqlstate_of(format($$select public.recurrence_set_nature(%L, 'fixed')$$, pg_temp.fx('rexp'))), null, 'C1 define custo fixo na despesa');
select is(pg_temp.nat(pg_temp.fx('rexp')), 'fixed', 'C2 gravou fixed');
select is(pg_temp.sqlstate_of(format($$select public.recurrence_set_nature(%L, 'variable')$$, pg_temp.fx('rexp'))), null, 'C3 troca para variável');
select is(pg_temp.sqlstate_of(format($$select public.recurrence_set_nature(%L, 'subscription')$$, pg_temp.fx('rcard'))), null, 'C4 assinatura no cartão');
select is(pg_temp.sqlstate_of(format($$select public.recurrence_set_nature(%L, 'reimbursement')$$, pg_temp.fx('rinc'))), null, 'C5 ressarcimento na receita');
select is(pg_temp.nat(pg_temp.fx('rinc')), 'reimbursement', 'C6 gravou reimbursement');
select is(pg_temp.sqlstate_of(format($$select public.recurrence_set_nature(%L, null)$$, pg_temp.fx('rinc'))), null, 'C7 nulo limpa a classificação');
select is(pg_temp.nat(pg_temp.fx('rinc')), 'null', 'C8 voltou a sem classificação');
select is(pg_temp.sqlstate_of(format($$select public.recurrence_set_nature(%L)$$, pg_temp.fx('rcard'))), null, 'C9 sem o segundo argumento = limpa');
select is(pg_temp.sqlstate_of(format($$select public.recurrence_set_nature(%L, 'xyz')$$, pg_temp.fx('rexp'))), '22023', 'C10 valor desconhecido: 22023');
select is(pg_temp.sqlstate_of(format($$select public.recurrence_set_nature(%L, '')$$, pg_temp.fx('rexp'))), '22023', 'C11 texto vazio não é "sem classificação": 22023');
select is(pg_temp.sqlstate_of(format($$select public.recurrence_set_nature(%L, 'reimbursement')$$, pg_temp.fx('rexp'))), '55000', 'C12 ressarcimento em despesa: 55000');
select is(pg_temp.sqlstate_of(format($$select public.recurrence_set_nature(%L, 'reimbursement')$$, pg_temp.fx('rcard'))), '55000', 'C13 ressarcimento em cartão: 55000');
select is(pg_temp.sqlstate_of(format($$select public.recurrence_set_nature(%L, 'fixed')$$, pg_temp.fx('rinc'))), '55000', 'C14 custo fixo em receita: 55000');
select is(pg_temp.sqlstate_of(format($$select public.recurrence_set_nature(%L, 'subscription')$$, pg_temp.fx('rtrf'))), '55000', 'C15 natureza em transferência: 55000');
select is(pg_temp.nat(pg_temp.fx('rexp')), 'variable', 'C16 as recusas não mudaram nada');
select is(pg_temp.sqlstate_of(format($$select public.recurrence_set_nature(%L, 'fixed')$$, gen_random_uuid())), '42501', 'C17 regra inexistente: 42501');
select is(pg_temp.sqlstate_of(format($$select public.recurrence_set_nature(%L, 'fixed')$$, pg_temp.fx('rb'))), '42501', 'C18 regra de outra família: 42501');
select pg_temp.login('00000000-0000-0000-0000-000000000108');
select is(pg_temp.sqlstate_of(format($$select public.recurrence_set_nature(%L, 'fixed')$$, pg_temp.fx('rexp'))), '42501', 'C19 a outra família também não alcança a nossa');
select is(pg_temp.nat(pg_temp.fx('rb')), 'null', 'C20 e a regra dela segue intacta');
select pg_temp.anon();
select is(pg_temp.sqlstate_of(format($$select public.recurrence_set_nature(%L, 'fixed')$$, pg_temp.fx('rexp'))), '42501', 'C21 anônimo: sem permissão (42501)');
reset role;
select is(has_function_privilege('anon', 'public.recurrence_set_nature(uuid, text)', 'execute'), false, 'C22 anon sem execute em set_nature');
select is(has_function_privilege('authenticated', 'public.recurrence_set_nature(uuid, text)', 'execute'), true, 'C23 authenticated com execute em set_nature');
select is(has_function_privilege('anon', 'public.recurrence_create_with_nature(text, text, numeric, integer, date, uuid, uuid, uuid, uuid, date, text, integer, uuid, boolean, text)', 'execute'), false, 'C24 anon sem execute em create_with_nature');
select is(has_function_privilege('anon', 'public.recurrence_update_with_nature(uuid, text, numeric, uuid, uuid, boolean, text)', 'execute'), false, 'C25 anon sem execute em update_with_nature');
select is(has_function_privilege('authenticated', 'public.recurrence_create_with_nature(text, text, numeric, integer, date, uuid, uuid, uuid, uuid, date, text, integer, uuid, boolean, text)', 'execute')
          and has_function_privilege('authenticated', 'public.recurrence_update_with_nature(uuid, text, numeric, uuid, uuid, boolean, text)', 'execute'), true, 'C26 authenticated com execute nas duas');
select is((select prosecdef and proconfig = array['search_path=""'] from pg_proc where oid = 'public.recurrence_set_nature(uuid, text)'::regprocedure), true, 'C27 set_nature é SECURITY DEFINER com search_path vazio');
select pg_temp.login('00000000-0000-0000-0000-000000000107');

-- ---- D: criar e atualizar com natureza, numa transação ----
insert into fixture select 'dn', public.recurrence_create_with_nature('expense', 'Internet', 120.00, 10, pg_temp.hoje(), pg_temp.fx('bank'), null, null, pg_temp.fx('cexp'), null, 'month', 1, null, false, 'fixed');
select is(pg_temp.nat(pg_temp.fx('dn')), 'fixed', 'D1 criar com natureza grava a natureza');
insert into fixture select 'dn0', public.recurrence_create_with_nature('expense', 'Padaria', 30.00, 10, pg_temp.hoje(), pg_temp.fx('bank'), null, null, pg_temp.fx('cexp'));
select is(pg_temp.nat(pg_temp.fx('dn0')), 'null', 'D2 criar sem natureza (default) fica sem classificação');
select is(pg_temp.sqlstate_of(format($$select public.recurrence_create_with_nature('expense', 'Errada', 10.00, 10, %L, %L, null, null, %L, null, 'month', 1, null, false, 'reimbursement')$$, pg_temp.hoje(), pg_temp.fx('bank'), pg_temp.fx('cexp'))),
          '55000', 'D3 criar com natureza incompatível é recusado');
select is((select count(*) from public.recurrences where household_id = pg_temp.fx('h') and description = 'Errada'), 0::bigint, 'D4 e nada ficou criado (tudo ou nada)');
select is(pg_temp.sqlstate_of(format($$select public.recurrence_create_with_nature('expense', 'Errada2', 10.00, 10, %L, %L, null, null, %L, null, 'month', 1, null, false, 'xyz')$$, pg_temp.hoje(), pg_temp.fx('bank'), pg_temp.fx('cexp'))),
          '22023', 'D5 criar com valor desconhecido: 22023');
select is((select count(*) from public.recurrences where household_id = pg_temp.fx('h') and description = 'Errada2'), 0::bigint, 'D6 e nada ficou criado');
select is(pg_temp.sqlstate_of(format($$select public.recurrence_update_with_nature(%L, 'Internet fibra', 130.00, %L, null, false, 'variable')$$, pg_temp.fx('dn'), pg_temp.fx('cexp'))), null, 'D7 atualizar com natureza');
select is(pg_temp.nat(pg_temp.fx('dn')) || '|' || (select description || '/' || amount from public.recurrences where id = pg_temp.fx('dn')), 'variable|Internet fibra/130.00', 'D8 gravou a natureza e a edição normal (descrição e valor)');
select is(pg_temp.sqlstate_of(format($$select public.recurrence_update_with_nature(%L, 'Outro nome', 99.00, %L, null, false, 'reimbursement')$$, pg_temp.fx('dn'), pg_temp.fx('cexp'))), '55000', 'D9 atualizar com natureza incompatível é recusado');
select is((select description || '/' || amount || '/' || nature from public.recurrences where id = pg_temp.fx('dn')), 'Internet fibra/130.00/variable', 'D10 e a edição junto também não valeu (tudo ou nada)');
select is(pg_temp.sqlstate_of(format($$select public.recurrence_update_with_nature(%L, 'Internet fibra', 130.00, %L)$$, pg_temp.fx('dn'), pg_temp.fx('cexp'))), null, 'D11 atualizar sem natureza (default) limpa');
select is(pg_temp.nat(pg_temp.fx('dn')), 'null', 'D12 ficou sem classificação');
select is(pg_temp.sqlstate_of(format($$select public.recurrence_update_with_nature(%L, 'X', 1.00, %L, null, false, 'fixed')$$, pg_temp.fx('rb'), pg_temp.fx('cexp'))), '42501', 'D13 atualizar regra de outra família: 42501');
select is(pg_temp.sqlstate_of(format($$select public.recurrence_create_with_nature('transfer', 'T', 10.00, 10, %L, %L, %L, null, null, null, 'month', 1, null, false, 'fixed')$$, pg_temp.hoje(), pg_temp.fx('bank'), pg_temp.fx('bank2'))), '55000', 'D14 transferência com natureza é recusada na criação');
with p as (insert into public.household_people (household_id, name, relationship) values (pg_temp.fx('h'), 'Ana', 'Familiar') returning id)
  insert into fixture select 'ana', id from p;
select is(pg_temp.sqlstate_of(format($$select public.recurrence_update_with_nature(%L, 'Internet fibra', 130.00, %L, %L, false, 'fixed')$$, pg_temp.fx('dn'), pg_temp.fx('cexp'), pg_temp.fx('ana'))), null, 'D15 atualizar com pessoa e natureza');
select is((select person_id::text || '/' || nature from public.recurrences where id = pg_temp.fx('dn')), pg_temp.fx('ana')::text || '/fixed', 'D16 pessoa e natureza gravadas juntas');

-- ---- E: natureza não muda dinheiro nem ocorrências ----
select public.recurrence_materialize();
insert into nota select 'antes', pg_temp.dinheiro(pg_temp.fx('h'));
select public.recurrence_set_nature(pg_temp.fx('rexp'), 'fixed');
select public.recurrence_set_nature(pg_temp.fx('rinc'), 'reimbursement');
select public.recurrence_set_nature(pg_temp.fx('rcard'), 'subscription');
insert into nota select 'depois', pg_temp.dinheiro(pg_temp.fx('h'));
select is((select v from nota where k = 'depois'), (select v from nota where k = 'antes'), 'E1 recurrence_summary, period_summary, ocorrências e valores das regras iguais antes e depois de classificar');
select isnt((select v from nota where k = 'antes'), '-|{}|0/0.00/-|0/0.00', 'E2 a fotografia tem dinheiro de verdade (a comparação não é vazia)');
select is((select count(*) from public.transactions where recurrence_id = pg_temp.fx('rexp')) > 0, true, 'E3 a regra gerou ocorrências');
select public.recurrence_materialize();
select is(pg_temp.dinheiro(pg_temp.fx('h')), (select v from nota where k = 'antes'), 'E4 gerar de novo depois de classificar não muda nada (a geração ignora a natureza)');
select pg_temp.login('00000000-0000-0000-0000-000000000108');
select is((select count(*) from public.recurrences where nature is not null), 0::bigint, 'E5 a outra família não enxerga as regras classificadas da nossa');

select * from finish();
rollback;
