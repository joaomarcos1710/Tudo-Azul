-- 23_category_visual: ícone e cor da categoria (colunas da migration 001, gravadas pela tela Categorias).
-- Garante que o app consegue gravar e apagar a escolha com o papel authenticated e que o banco recusa valor inválido.
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
  ('00000000-0000-0000-0000-0000000023a1', 'v1@teste.com'),
  ('00000000-0000-0000-0000-0000000023a2', 'v2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000023a1');
insert into fixture select 'h', public.create_household('Casa Visual');
insert into fixture select 'mer', id from public.categories where household_id = pg_temp.fx('h') and name = 'Mercado';

select is((select (icon, color)::text from public.categories where id = pg_temp.fx('mer')), '(,)',
          'CV1 categoria padrão nasce sem ícone e sem cor (o app sugere pelo nome)');

update public.categories set icon = 'sacola', color = '#9333EA' where id = pg_temp.fx('mer');
select is((select icon || '|' || color from public.categories where id = pg_temp.fx('mer')), 'sacola|#9333EA',
          'CV2 membro grava ícone e cor');

update public.categories set icon = null, color = null where id = pg_temp.fx('mer');
select is((select (icon, color)::text from public.categories where id = pg_temp.fx('mer')), '(,)',
          'CV3 "Auto" apaga a escolha (volta para a sugestão)');

select is(pg_temp.sqlstate_of(format('update public.categories set color = %L where id = %L', 'azul', pg_temp.fx('mer'))), '23514',
          'CV4 cor fora do formato #RRGGBB é recusada');
select is(pg_temp.sqlstate_of(format('update public.categories set icon = %L where id = %L', repeat('x', 41), pg_temp.fx('mer'))), '23514',
          'CV5 ícone com mais de 40 caracteres é recusado');

with c as (insert into public.categories (household_id, name, type, icon, color)
           values (pg_temp.fx('h'), 'Academia', 'expense', 'haltere', '#0891B2') returning id)
  insert into fixture select 'acad', id from c;
select is((select icon || '|' || color from public.categories where id = pg_temp.fx('acad')), 'haltere|#0891B2',
          'CV6 categoria nova já pode nascer com ícone e cor');

-- outra família não altera
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000023a2');
update public.categories set icon = 'raio' where id = pg_temp.fx('acad');
reset role;
select is((select icon from public.categories where id = pg_temp.fx('acad')), 'haltere',
          'CV7 quem não é da família não muda o ícone (RLS)');

select * from finish();
rollback;
