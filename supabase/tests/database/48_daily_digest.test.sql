-- 48_daily_digest: migration 047. Aviso diário: is_member com a service_role, resumo do dia, preferências e envios.
-- Datas relativas a hoje em São Paulo.
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
-- a Edge Function: chave do servidor, sem usuário
create function pg_temp.servidor() returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
end $f$;
create function pg_temp.anonimo() returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
end $f$;
create function pg_temp.hoje() returns date language sql as $f$ select (now() at time zone 'America/Sao_Paulo')::date $f$;
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.servidor(), pg_temp.anonimo(), pg_temp.hoje(),
  pg_temp.sqlstate_of(text) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000048a1', 'dono@teste.com'),
  ('00000000-0000-0000-0000-0000000048a2', 'outro@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000048a1');
insert into fixture select 'h', public.create_household('Casa Aviso');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Corrente', 'checking', 5000, pg_temp.hoje() - 90) returning id)
  insert into fixture select 'conta', id from i;
insert into fixture select 'cat', id from public.categories where household_id = pg_temp.fx('h') and type = 'expense' limit 1;

-- vencido (ontem), de hoje, e futuro (não conta)
insert into public.transactions (household_id, account_id, category_id, type, amount, date, status, description) values
  (pg_temp.fx('h'), pg_temp.fx('conta'), pg_temp.fx('cat'), 'expense', 100.00, pg_temp.hoje() - 1, 'planned', 'Luz'),
  (pg_temp.fx('h'), pg_temp.fx('conta'), pg_temp.fx('cat'), 'expense', 50.00, pg_temp.hoje(), 'planned', 'Internet'),
  (pg_temp.fx('h'), pg_temp.fx('conta'), pg_temp.fx('cat'), 'expense', 999.00, pg_temp.hoje() + 5, 'planned', 'Futuro');
-- parcela de dívida vencida ontem, sem baixa (boleto)
insert into fixture select 'div', public.create_debt('Imóvel', 'financing', pg_temp.hoje() - 60, 3000);
select public.debt_contract_set(pg_temp.fx('div'), 'Banco', null, 3, 3, 1000.00, 1, 'boleto', null, pg_temp.hoje() - 1);

-- 1. is_member ---------------------------------------------------------------
select ok(private.is_member(pg_temp.fx('h')), 'M1 dono é membro');
select pg_temp.login('00000000-0000-0000-0000-0000000048a2');
select ok(not private.is_member(pg_temp.fx('h')), 'M2 usuário de outra família continua sem acesso');
select pg_temp.servidor();
select ok(private.is_member(pg_temp.fx('h')), 'M3 service_role (a Edge Function) passa');
reset role;
select set_config('request.jwt.claims', '', true);
select ok(not private.is_member(pg_temp.fx('h')), 'M4 sem login: continua sem acesso');
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select ok(not private.is_member(pg_temp.fx('h')), 'M5 anon: continua sem acesso');

-- 2. resumo do dia -----------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000048a1');
create temp table dono as select * from public.daily_digest(pg_temp.fx('h'), pg_temp.hoje());
grant select on dono to public;
select is((select overdue_count from dono), 2, 'D1 vencidos: o lançamento de ontem e a parcela de ontem');
select is((select overdue_expense from dono), 1100.00::numeric, 'D1.1 saída vencida: 100 + 1.000 da parcela');
select is((select today_count from dono), 1, 'D2 de hoje: um');
select is((select today_expense from dono), 50.00::numeric, 'D2.1 saída de hoje: 50');
select is((select invoices_count from dono), 0, 'D3 sem cartão: nenhuma fatura');
select is((select month_end from dono), (date_trunc('month', pg_temp.hoje()) + interval '1 month - 1 day')::date, 'D4 fim do mês');
select is((select projected_balance from dono),
  (select total from public.balance_totals_projected(pg_temp.fx('h'), (select month_end from dono), true)),
  'D5 saldo previsto = o mesmo balance_totals_projected do Início (uma fonte só)');

select pg_temp.servidor();
select is((select row(d.*)::text from public.daily_digest(pg_temp.fx('h'), pg_temp.hoje()) d),
          (select row(x.*)::text from dono x), 'D6 a Edge Function vê exatamente os mesmos números que o dono');

select pg_temp.login('00000000-0000-0000-0000-0000000048a2');
select is_empty($$select * from public.daily_digest(pg_temp.fx('h'), pg_temp.hoje())$$, 'D7 outra família: nada');

-- 3. preferências ------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000048a1');
select lives_ok($$insert into public.daily_digest_settings (user_id, household_id, enabled)
                  values ('00000000-0000-0000-0000-0000000048a1', pg_temp.fx('h'), true)$$, 'P1 dono liga o aviso');
select ok((select hide_values from public.daily_digest_settings), 'P1.1 esconder valores vem ligado por padrão');
select is((select send_hour from public.daily_digest_settings), 7::smallint, 'P1.2 hora padrão: 7h');
select is(pg_temp.sqlstate_of($$insert into public.daily_digest_settings (user_id, household_id)
                                values ('00000000-0000-0000-0000-0000000048a2', pg_temp.fx('h'))$$), '42501',
  'P2 não cria preferência em nome de outra pessoa');
select is(pg_temp.sqlstate_of($$update public.daily_digest_settings set send_hour = 4$$), '23514', 'P3 hora fora de 5–22: recusa');
select pg_temp.login('00000000-0000-0000-0000-0000000048a2');
select is(pg_temp.sqlstate_of($$insert into public.daily_digest_settings (user_id, household_id)
                                values ('00000000-0000-0000-0000-0000000048a2', pg_temp.fx('h'))$$), '42501',
  'P4 quem não é da família não liga aviso dela');
select is_empty($$select * from public.daily_digest_settings$$, 'P5 não vê a preferência dos outros');

-- 4. destinatários e registro (só a service_role) ------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000048a1');
select is(pg_temp.sqlstate_of($$select * from public.daily_digest_recipients(pg_temp.hoje(), 7::smallint)$$), '42501',
  'R1 usuário comum não lista destinatários (e-mails)');
select is(pg_temp.sqlstate_of($$select public.daily_digest_mark('00000000-0000-0000-0000-0000000048a1', pg_temp.fx('h'), pg_temp.hoje(), 'sent')$$),
  '42501', 'R2 usuário comum não marca envio');
select pg_temp.anonimo();
select is(pg_temp.sqlstate_of($$select * from public.daily_digest_recipients(current_date, 7::smallint)$$), '42501', 'R3 anon também não');

select pg_temp.servidor();
select is((select email from public.daily_digest_recipients(pg_temp.hoje(), 7::smallint)), 'dono@teste.com', 'R4 às 7h: o dono recebe');
select ok((select hide_values from public.daily_digest_recipients(pg_temp.hoje(), 7::smallint)), 'R4.1 com valores escondidos');
select is_empty($$select * from public.daily_digest_recipients(pg_temp.hoje(), 8::smallint)$$, 'R5 às 8h: ninguém');
select ok(public.daily_digest_mark('00000000-0000-0000-0000-0000000048a1', pg_temp.fx('h'), pg_temp.hoje(), 'sent'), 'R6 marca o envio');
select ok(not public.daily_digest_mark('00000000-0000-0000-0000-0000000048a1', pg_temp.fx('h'), pg_temp.hoje(), 'failed', 'x'),
  'R7 segunda marca no mesmo dia não sobrescreve');
select is_empty($$select * from public.daily_digest_recipients(pg_temp.hoje(), 7::smallint)$$, 'R8 já enviado hoje: não manda de novo');

reset role;
select is((select status from private.daily_digest_log), 'sent', 'R9 o registro guarda o primeiro resultado');

select * from finish();
rollback;
