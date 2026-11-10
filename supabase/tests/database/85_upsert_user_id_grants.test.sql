-- 85: upsert do front (onConflict user_id) em user_preferences e daily_digest_settings, como o PostgREST gera.
-- Sem a migration 20261109080000 os dois INSERT ... ON CONFLICT DO UPDATE falham com 42501.
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
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.sqlstate_of(text) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000085a1', 'dono85@teste.com'),
  ('00000000-0000-0000-0000-0000000085a2', 'outro85@teste.com');
select pg_temp.login('00000000-0000-0000-0000-0000000085a1');
insert into fixture select 'h', public.create_household('Casa Upsert');

-- grants
select ok(has_column_privilege('authenticated', 'public.user_preferences', 'user_id', 'UPDATE'),
  'G1 user_preferences.user_id entra no SET do upsert');
select ok(has_column_privilege('authenticated', 'public.daily_digest_settings', 'user_id', 'UPDATE'),
  'G2 daily_digest_settings.user_id entra no SET do upsert');

-- 1. user_preferences: primeira gravação e regravação, no formato do PostgREST
select pg_temp.login('00000000-0000-0000-0000-0000000085a1');
select lives_ok($$
  insert into public.user_preferences (user_id, ordem_lancamentos, periodo_padrao, saldo_diario, updated_at)
  values ('00000000-0000-0000-0000-0000000085a1', 'asc', 'weekly', false, now())
  on conflict (user_id) do update set user_id = excluded.user_id, ordem_lancamentos = excluded.ordem_lancamentos,
    periodo_padrao = excluded.periodo_padrao, saldo_diario = excluded.saldo_diario, updated_at = excluded.updated_at
$$, 'P1 salvar preferências pela primeira vez (upsert)');
select lives_ok($$
  insert into public.user_preferences (user_id, ordem_lancamentos, periodo_padrao, saldo_diario, updated_at)
  values ('00000000-0000-0000-0000-0000000085a1', 'desc', 'monthly', true, now())
  on conflict (user_id) do update set user_id = excluded.user_id, ordem_lancamentos = excluded.ordem_lancamentos,
    periodo_padrao = excluded.periodo_padrao, saldo_diario = excluded.saldo_diario, updated_at = excluded.updated_at
$$, 'P2 salvar de novo atualiza a mesma linha');
select is((select ordem_lancamentos from public.user_preferences where user_id = '00000000-0000-0000-0000-0000000085a1'),
  'desc', 'P3 o valor novo ficou gravado');
select is((select count(*) from public.user_preferences)::int, 1, 'P4 uma linha só');
-- segurança: o grant em user_id não permite mover a linha para outra pessoa (WITH CHECK da policy)
select is(pg_temp.sqlstate_of($$update public.user_preferences set user_id = '00000000-0000-0000-0000-0000000085a2'$$),
  '42501', 'P5 não dá para passar a preferência para outro usuário');

-- 2. daily_digest_settings: mesmo formato
select lives_ok($$
  insert into public.daily_digest_settings (user_id, household_id, enabled, send_hour, hide_values)
  values ('00000000-0000-0000-0000-0000000085a1', pg_temp.fx('h'), true, 8, true)
  on conflict (user_id) do update set user_id = excluded.user_id, household_id = excluded.household_id,
    enabled = excluded.enabled, send_hour = excluded.send_hour, hide_values = excluded.hide_values
$$, 'A1 ligar o aviso diário (upsert)');
select lives_ok($$
  insert into public.daily_digest_settings (user_id, household_id, enabled, send_hour, hide_values)
  values ('00000000-0000-0000-0000-0000000085a1', pg_temp.fx('h'), false, 9, false)
  on conflict (user_id) do update set user_id = excluded.user_id, household_id = excluded.household_id,
    enabled = excluded.enabled, send_hour = excluded.send_hour, hide_values = excluded.hide_values
$$, 'A2 salvar de novo atualiza');
select is((select send_hour from public.daily_digest_settings where user_id = '00000000-0000-0000-0000-0000000085a1'),
  9::smallint, 'A3 a hora nova ficou gravada');
select is(pg_temp.sqlstate_of($$update public.daily_digest_settings set user_id = '00000000-0000-0000-0000-0000000085a2'$$),
  '42501', 'A4 não dá para passar o aviso para outro usuário');

select * from finish();
rollback;
