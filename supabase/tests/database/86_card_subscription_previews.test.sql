-- 86: card_subscription_previews (migration 20261110010000). Lista cada ocorrência prevista de uma fatura de cartão.
-- Falha sem a migration (a função não existe). Datas fixas bem no futuro, para não depender do dia em que roda.
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
-- linhas: descrição|data|valor
create function pg_temp.prev(p_card uuid, p_label text) returns text[] language sql as $f$
  select coalesce(array_agg(description || '|' || occurrence_date || '|' || amount::numeric(14,2) order by occurrence_date, description), '{}')
    from public.card_subscription_previews(p_card, p_label) $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.sqlstate_of(text), pg_temp.prev(uuid, text) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000086a1', 'p1@teste.com'),
  ('00000000-0000-0000-0000-0000000086a2', 'p2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000086a1');
insert into fixture select 'h', public.create_household('Casa das Previstas');
insert into fixture select 'cat', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';
-- Cartão A: fecha 10, vence 20. Streaming 50,00 todo dia 15; Academia 120,00 todo dia 5. Ambas começam em 2030.
insert into fixture select 'a', public.create_debt('Cartão A', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('a'), 10, 20);
insert into fixture select 'r1', public.recurrence_create('card', 'Streaming', 50.00, 15, '2030-01-15', null, null, pg_temp.fx('a'), pg_temp.fx('cat'));
insert into fixture select 'r2', public.recurrence_create('card', 'Academia', 120.00, 5, '2030-01-05', null, null, pg_temp.fx('a'), pg_temp.fx('cat'));
-- Cartão B, sem assinatura
insert into fixture select 'b', public.create_debt('Cartão B', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('b'), 10, 20);

select is(pg_temp.prev(pg_temp.fx('a'), '2030-02'), array['Streaming|2030-01-15|50.00', 'Academia|2030-02-05|120.00'],
  'PR1 a fatura que fecha em 10/02/2030 traz o streaming de 15/01 e a academia de 05/02, uma linha por ocorrência');
select is(pg_temp.prev(pg_temp.fx('a'), '2030-01'), array['Academia|2030-01-05|120.00'],
  'PR2 a fatura que fecha em 10/01/2030 traz só a academia de 05/01 (a de 05/12/2029 é anterior ao início da regra)');
select is(pg_temp.prev(pg_temp.fx('b'), '2030-02'), '{}'::text[], 'PR3 cartão sem assinatura: nenhuma linha');

-- a soma das linhas bate com o total de card_pending_subscriptions (nada duplicado nem perdido)
select is((select sum(amount) from public.card_subscription_previews(pg_temp.fx('a'), '2030-02')),
          (select total from public.card_pending_subscriptions(pg_temp.fx('h'), '2030-02-03') where debt_id = pg_temp.fx('a')),
          'PR4 a soma das linhas da fatura aberta é o total de card_pending_subscriptions');

-- ocorrência que já virou parcela sai da lista (simula recurrence_materialize, que só gera no dia da cobrança)
reset role;
insert into public.debt_installments (household_id, debt_id, plan, seq, due_date, face, category_id, description, purchase_date,
                                      closing_day, due_day, recurrence_id, occurrence_date)
values (pg_temp.fx('h'), pg_temp.fx('a'), gen_random_uuid()::text, 1, '2030-02-10', 50.00, pg_temp.fx('cat'), 'Streaming', '2030-01-15',
        10, 20, pg_temp.fx('r1'), '2030-01-15');
select pg_temp.login('00000000-0000-0000-0000-0000000086a1');
select is(pg_temp.prev(pg_temp.fx('a'), '2030-02'), array['Academia|2030-02-05|120.00'],
  'PR5 a ocorrência que já virou parcela não aparece mais como prevista');

-- regra inativa não aparece
reset role;
update public.recurrences set active = false where id = pg_temp.fx('r2');
select pg_temp.login('00000000-0000-0000-0000-0000000086a1');
select is(pg_temp.prev(pg_temp.fx('a'), '2030-02'), '{}'::text[], 'PR6 recorrência desativada não aparece');

select is(pg_temp.sqlstate_of($q$select * from public.card_subscription_previews(pg_temp.fx('a'), '2030-13')$q$), '22023',
  'PR7 rótulo inválido: erro 22023');
select is(pg_temp.sqlstate_of($q$select * from public.card_subscription_previews(pg_temp.fx('a'), null)$q$), '22023',
  'PR8 rótulo nulo: erro 22023');

-- outra família não vê nada
select pg_temp.login('00000000-0000-0000-0000-0000000086a2');
select is(pg_temp.prev(pg_temp.fx('a'), '2030-02'), '{}'::text[], 'PR9 quem não é da família recebe 0 linhas');

select has_function('public', 'card_subscription_previews', array['uuid', 'text'], 'PR10 a função existe');
select ok(has_function_privilege('authenticated', 'public.card_subscription_previews(uuid, text)', 'EXECUTE'), 'PR11 authenticated executa');
select ok(not has_function_privilege('anon', 'public.card_subscription_previews(uuid, text)', 'EXECUTE'), 'PR12 anon não executa');

select * from finish();
rollback;
