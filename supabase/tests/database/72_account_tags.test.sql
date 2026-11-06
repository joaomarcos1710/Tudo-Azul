-- 72_account_tags: migration 072. Etiquetas livres nas contas: nome único sem diferenciar maiúscula, limites,
-- troca atômica (account_tags_set), cascade ao apagar etiqueta/conta/zerar tudo e isolamento entre famílias
-- (outra família não vê, não liga etiqueta minha nem liga etiqueta dela numa conta minha).
-- Dados inventados; datas relativas a hoje em São Paulo.
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
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
create function pg_temp.conta(p_h uuid, p_nome text) returns uuid language plpgsql as $f$
declare v uuid;
begin
  insert into public.accounts (household_id, name, type, initial_balance, opening_date)
  values (p_h, p_nome, 'checking', 100, pg_temp.hoje() - 10) returning id into v;
  return v;
end $f$;
create function pg_temp.etiqueta(p_h uuid, p_nome text) returns uuid language plpgsql as $f$
declare v uuid;
begin
  insert into public.account_tags (household_id, name) values (p_h, p_nome) returning id into v;
  return v;
end $f$;
create function pg_temp.etiquetas_da_conta(p_conta uuid) returns text language sql as $f$
  select coalesce(string_agg(t.name, ',' order by t.name), '')
    from public.account_tag_links l join public.account_tags t on t.id = l.tag_id where l.account_id = p_conta $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.hoje(), pg_temp.sqlstate_of(text),
  pg_temp.conta(uuid, text), pg_temp.etiqueta(uuid, text), pg_temp.etiquetas_da_conta(uuid) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000072a1', 'a1@teste.com'),
  ('00000000-0000-0000-0000-0000000072b1', 'b1@teste.com');

-- família B (outra) com uma conta e uma etiqueta
select pg_temp.login('00000000-0000-0000-0000-0000000072b1');
insert into fixture select 'hb', public.create_household('Casa B');
insert into fixture select 'cb', pg_temp.conta(pg_temp.fx('hb'), 'Conta da B');
insert into fixture select 'tb', pg_temp.etiqueta(pg_temp.fx('hb'), 'Da B');

-- família A (minha)
select pg_temp.login('00000000-0000-0000-0000-0000000072a1');
insert into fixture select 'ha', public.create_household('Casa A');
insert into fixture select 'ca', pg_temp.conta(pg_temp.fx('ha'), 'Conta do dia a dia');
insert into fixture select 'ca2', pg_temp.conta(pg_temp.fx('ha'), 'Reserva');

-- ---- nome ----
select lives_ok($$insert into fixture select 'te', pg_temp.etiqueta(pg_temp.fx('ha'), 'Reserva de emergência')$$, 'N1 cria etiqueta');
select is(pg_temp.sqlstate_of($$select pg_temp.etiqueta(pg_temp.fx('ha'), 'RESERVA DE EMERGÊNCIA')$$), '23505',
  'N2 nome repetido sem diferenciar maiúscula é recusado');
select is(pg_temp.sqlstate_of($$select pg_temp.etiqueta(pg_temp.fx('ha'), '')$$), '23514', 'N3 nome vazio recusado');
select is(pg_temp.sqlstate_of($$select pg_temp.etiqueta(pg_temp.fx('ha'), ' PJ')$$), '23514', 'N4 espaço nas pontas recusado (o app apara)');
select is(pg_temp.sqlstate_of($$select pg_temp.etiqueta(pg_temp.fx('ha'), repeat('x', 31))$$), '23514', 'N5 mais de 30 caracteres recusado');
select lives_ok($$select pg_temp.etiqueta(pg_temp.fx('ha'), repeat('x', 30))$$, 'N6 30 caracteres aceito');
select lives_ok($$insert into fixture select 'tc', pg_temp.etiqueta(pg_temp.fx('ha'), 'Da B')$$,
  'N7 o mesmo nome em outra família não conflita');
select lives_ok($$insert into fixture select 'tp', pg_temp.etiqueta(pg_temp.fx('ha'), 'PJ')$$, 'N8 cria PJ');
select lives_ok(format('update public.account_tags set name = %L where id = %L', 'Conjunta', pg_temp.fx('tc')), 'N9 renomeia');
select is(pg_temp.sqlstate_of(format('update public.account_tags set name = %L where id = %L', 'pj', pg_temp.fx('tc'))), '23505',
  'N10 renomear para nome que já existe (outra caixa) é recusado');

-- ---- ligar etiquetas ----
select lives_ok(format('select public.account_tags_set(%L, array[%L, %L]::uuid[])', pg_temp.fx('ca'), pg_temp.fx('te'), pg_temp.fx('tp')),
  'L1 marca duas etiquetas numa conta');
select is(pg_temp.etiquetas_da_conta(pg_temp.fx('ca')), 'PJ,Reserva de emergência', 'L2 a conta tem as duas');
select lives_ok(format('select public.account_tags_set(%L, array[%L, %L, %L]::uuid[])', pg_temp.fx('ca'), pg_temp.fx('tp'), pg_temp.fx('tc'), pg_temp.fx('tp')),
  'L3 troca: tira uma, põe outra, repetida não duplica');
select is(pg_temp.etiquetas_da_conta(pg_temp.fx('ca')), 'Conjunta,PJ', 'L4 ficou exatamente o pedido');
select lives_ok(format('select public.account_tags_set(%L, array[%L]::uuid[])', pg_temp.fx('ca2'), pg_temp.fx('tp')), 'L5 a mesma etiqueta em outra conta');
select is(pg_temp.sqlstate_of(format('select public.account_tags_set(%L, array[%L]::uuid[])', pg_temp.fx('ca'), pg_temp.fx('tb'))), '23503',
  'L6 etiqueta de outra família numa conta minha é recusada');
select is(pg_temp.sqlstate_of(format('insert into public.account_tag_links (household_id, account_id, tag_id) values (%L, %L, %L)',
  pg_temp.fx('ha'), pg_temp.fx('ca'), pg_temp.fx('tb'))), '23503', 'L7 nem direto na tabela, com a minha família');
select is(pg_temp.sqlstate_of(format('insert into public.account_tag_links (household_id, account_id, tag_id) values (%L, %L, %L)',
  pg_temp.fx('hb'), pg_temp.fx('ca'), pg_temp.fx('tb'))), '42501', 'L8 nem fingindo ser da outra família (RLS)');
select is(pg_temp.etiquetas_da_conta(pg_temp.fx('ca')), 'Conjunta,PJ', 'L9 a conta continua igual depois das recusas');
select is(pg_temp.sqlstate_of(format('select public.account_tags_set(%L, array[%L]::uuid[])', pg_temp.fx('cb'), pg_temp.fx('tp'))), '42501',
  'L10 não troca etiqueta de conta de outra família');
select is(pg_temp.sqlstate_of(format('update public.account_tag_links set household_id = %L where account_id = %L', pg_temp.fx('hb'), pg_temp.fx('ca'))), '42501',
  'L11 ligação não se edita (sem UPDATE)');

-- ---- limites ----
select is(pg_temp.sqlstate_of($$
  do $d$ declare ids uuid[] := '{}'; i int;
  begin
    for i in 1..11 loop ids := ids || pg_temp.etiqueta(pg_temp.fx('ha'), 'Limite ' || i); end loop;
    perform public.account_tags_set(pg_temp.fx('ca2'), ids);
  end $d$ $$), '23514', 'M1 mais de 10 etiquetas numa conta é recusado');
select is(pg_temp.etiquetas_da_conta(pg_temp.fx('ca2')), 'PJ', 'M2 a recusa desfaz a troca inteira');
select lives_ok($$
  do $d$ declare ids uuid[] := '{}'; i int;
  begin
    for i in 1..10 loop ids := ids || pg_temp.etiqueta(pg_temp.fx('ha'), 'Dez ' || i); end loop;
    perform public.account_tags_set(pg_temp.fx('ca2'), ids);
    perform public.account_tags_set(pg_temp.fx('ca2'), ids); -- reenviar as mesmas 10 não esbarra no limite
  end $d$ $$, 'M3 exatamente 10 por conta, e reenviar as mesmas passa');
select is(pg_temp.sqlstate_of($$
  do $d$ declare i int;
  begin
    for i in 1..60 loop perform pg_temp.etiqueta(pg_temp.fx('ha'), 'Muitas ' || i); end loop;
  end $d$ $$), '23514', 'M4 mais de 50 etiquetas na família é recusado');

-- ---- isolamento ----
select pg_temp.login('00000000-0000-0000-0000-0000000072b1');
select is((select count(*) from public.account_tags where household_id = pg_temp.fx('ha')), 0::bigint, 'I1 outra família não vê minhas etiquetas');
select is((select count(*) from public.account_tag_links where household_id = pg_temp.fx('ha')), 0::bigint, 'I2 nem as ligações');
select is(pg_temp.sqlstate_of(format('insert into public.account_tag_links (household_id, account_id, tag_id) values (%L, %L, %L)',
  pg_temp.fx('hb'), pg_temp.fx('cb'), pg_temp.fx('tp'))), '23503', 'I3 não liga a minha etiqueta na conta dela');
select is(pg_temp.sqlstate_of(format('select pg_temp.etiqueta(%L, %L)', pg_temp.fx('ha'), 'Intrusa')), '42501', 'I4 não cria etiqueta na minha família');
update public.account_tags set name = 'Hackeada' where id = pg_temp.fx('tp');
delete from public.account_tags where id = pg_temp.fx('tc');
delete from public.account_tag_links where household_id = pg_temp.fx('ha');

select pg_temp.login('00000000-0000-0000-0000-0000000072a1');
select is(pg_temp.etiquetas_da_conta(pg_temp.fx('ca')), 'Conjunta,PJ', 'I5 o update/delete da outra família não pegou em nada');

-- ---- cascade ----
delete from public.account_tags where id = pg_temp.fx('tc');
select is(pg_temp.etiquetas_da_conta(pg_temp.fx('ca')), 'PJ', 'C1 apagar a etiqueta só tira ela das contas');
select is((select count(*) from public.accounts where id = pg_temp.fx('ca')), 1::bigint, 'C2 a conta continua lá');
select lives_ok(format('select public.account_delete(%L)', pg_temp.fx('ca')), 'C3 conta sem movimento e com etiqueta pode ser excluída');
select is((select count(*) from public.account_tag_links where account_id = pg_temp.fx('ca')), 0::bigint, 'C4 as ligações da conta somem junto');
select is((select count(*) from public.account_tags where id = pg_temp.fx('tp')), 1::bigint, 'C5 a etiqueta fica (pode estar em outras contas)');

-- zerar tudo: as ligações vão com as contas; as etiquetas ficam, como as categorias
select lives_ok(format($$select public.reset_household(%L, 'zerar tudo')$$, pg_temp.fx('ha')), 'Z1 zerar tudo com etiquetas não quebra');
select is((select count(*) from public.account_tag_links where household_id = pg_temp.fx('ha')), 0::bigint, 'Z2 nenhuma ligação sobra');
select ok((select count(*) from public.account_tags where household_id = pg_temp.fx('ha')) > 0, 'Z3 as etiquetas da família ficam');

-- excluir a família apaga as etiquetas (cascade de households)
reset role;
delete from public.households where id = pg_temp.fx('hb');
select is((select count(*) from public.account_tags where household_id = pg_temp.fx('hb')), 0::bigint, 'X1 família apagada leva as etiquetas');

-- ---- privilégios ----
select ok(not has_table_privilege('anon', 'public.account_tags', 'SELECT'), 'P1 anon não lê etiquetas');
select ok(not has_column_privilege('authenticated', 'public.account_tags', 'household_id', 'UPDATE'), 'P2 etiqueta não muda de família');
select ok(not has_any_column_privilege('authenticated', 'public.account_tag_links', 'UPDATE'), 'P3 ligação sem UPDATE');
select ok(not has_function_privilege('authenticated', 'private.account_tags_limit_guard()', 'EXECUTE'), 'P4 trigger não é chamável');

select * from finish();
rollback;
