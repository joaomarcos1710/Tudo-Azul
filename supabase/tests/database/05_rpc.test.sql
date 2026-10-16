-- 05_rpc: famílias, convites, membros e exclusão (C3, D1, F1, N1, N5, N3 e a guarda de owner).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ---- auxiliares de teste (temporários; somem no rollback) ----
create temp table fixture (k text primary key, v uuid, t text);
grant all on fixture to public;

create function pg_temp.fx(p_k text) returns uuid language sql as $f$ select v from fixture where k = p_k $f$;
create function pg_temp.fxt(p_k text) returns text language sql as $f$ select t from fixture where k = p_k $f$;
create function pg_temp.mkuser(p_id uuid, p_email text, p_name text default null) returns void language sql as $f$
  insert into auth.users (id, email, raw_user_meta_data)
  values (p_id, p_email, case when p_name is null then '{}'::jsonb else jsonb_build_object('name', p_name) end)
$f$;
-- Troca para um papel REAL (authenticated/anon). Sem isso a RLS não é exercitada.
create function pg_temp.login(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $f$;
create function pg_temp.login_anon() returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
end $f$;
-- Executa um comando e devolve o SQLSTATE do erro (ou NULL se não houve erro)
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
create function pg_temp.msg_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate || ' ' || sqlerrm; end $f$;

create function pg_temp.rows_of(p_sql text) returns bigint language plpgsql as $f$
declare n bigint; begin execute p_sql; get diagnostics n = row_count; return n; end $f$;
grant execute on function pg_temp.rows_of(text), pg_temp.fx(text), pg_temp.fxt(text), pg_temp.sqlstate_of(text), pg_temp.msg_of(text) to public;

-- usuários fixos
select pg_temp.mkuser('00000000-0000-0000-0000-0000000000a1', 'u1@teste.com', 'Ana');
select pg_temp.mkuser('00000000-0000-0000-0000-0000000000a2', 'u2@teste.com', 'Bia');
select pg_temp.mkuser('00000000-0000-0000-0000-0000000000a3', 'u3@teste.com', 'Caio');
select pg_temp.mkuser('00000000-0000-0000-0000-0000000000a4', 'u4@teste.com');

-- As funções SECURITY DEFINER ignoram a RLS: aqui se testa a verificação interna de cada uma.
-- Usuários: U1 owner da H1; U2 convidado; U3 owner da H3; U4 sem família.

create function pg_temp.as_uid(p_uid text) returns void language sql as $f$
  select pg_temp.login(p_uid::uuid) $f$;
grant execute on function pg_temp.as_uid(text) to public;

-- ======== create_household ========
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select is(pg_temp.sqlstate_of($$select public.create_household('   ')$$), '22023', 'nome em branco: 22023');
select is(pg_temp.sqlstate_of(format($$select public.create_household(%L)$$, repeat('x', 81))), '22023', 'nome com mais de 80 caracteres: 22023');
insert into fixture select 'h1', public.create_household('  Casa 1  '), null;
select is((select name from public.households where id = pg_temp.fx('h1')), 'Casa 1', 'o nome é aparado');
select is((select role from public.household_members where household_id = pg_temp.fx('h1') and user_id = auth.uid()), 'owner', 'quem cria vira owner');
select is((select member_limit::int from public.households where id = pg_temp.fx('h1')), 2, 'limite padrão de membros = 2');
-- F1 / N1: segundo vínculo
select is(pg_temp.sqlstate_of($$select public.create_household('Outra')$$), '55000', 'F1 create_household de quem já tem família: 55000');
-- C3: categorias padrão
select is((select count(*) from public.categories where household_id = pg_temp.fx('h1')), 17::bigint, 'C3 17 categorias (4 receitas + 13 despesas, incluindo as 2 "Sem categoria")');
select is((select count(*) from public.categories where household_id = pg_temp.fx('h1') and type = 'income'), 4::bigint, 'C3 4 categorias de receita');
select is((select count(*) from public.categories where household_id = pg_temp.fx('h1') and type = 'expense'), 13::bigint, 'C3 13 categorias de despesa');
select is((select count(*) from public.categories where household_id = pg_temp.fx('h1') and system_key = 'uncategorized'), 2::bigint, 'C3 exatamente 2 "Sem categoria" (uma por tipo)');
select is((select count(*) from public.categories where household_id = pg_temp.fx('h1') and name in ('Compras pessoais', 'Viagens') and type = 'expense'), 2::bigint, 'as categorias "Compras pessoais" e "Viagens" foram incluídas em despesas');
select is((select count(*) from public.categories where household_id = pg_temp.fx('h1') and parent_id is not null), 0::bigint, 'as categorias padrão são todas de nível raiz');
reset role;

-- ======== convites ========
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select is(pg_temp.sqlstate_of($$select public.create_invitation('sem-arroba')$$), '22023', 'e-mail inválido: 22023');
select is(pg_temp.sqlstate_of($$select public.create_invitation('')$$), '22023', 'e-mail vazio: 22023');
insert into fixture select 'tok_a', null, public.create_invitation('  U2@Teste.com ');
select is(char_length(pg_temp.fxt('tok_a')), 64, 'token com 64 caracteres');
-- reenvio: o pendente anterior para o mesmo e-mail é descartado
insert into fixture select 'tok_b', null, public.create_invitation('u2@teste.com');
select isnt(pg_temp.fxt('tok_a'), pg_temp.fxt('tok_b'), 'reenvio gera token novo');
select is((select count(*) from public.invitations where household_id = pg_temp.fx('h1')), 1::bigint, 'reenvio mantém um único convite pendente');
select is((select email from public.invitations where household_id = pg_temp.fx('h1')), 'u2@teste.com', 'e-mail normalizado em minúsculas e aparado');
reset role;
-- só o hash fica no banco
select is((select count(*) from public.invitations where token_hash = pg_temp.fxt('tok_b')), 0::bigint, 'o token não está gravado em claro');
select is((select count(*) from public.invitations where token_hash = encode(sha256(convert_to(pg_temp.fxt('tok_b'), 'UTF8')), 'hex')), 1::bigint, 'o que está gravado é o sha256 do token');

-- N5: e-mail da conta precisa ser o do convite; erro genérico
select pg_temp.login('00000000-0000-0000-0000-0000000000a4');
select is(pg_temp.sqlstate_of(format($$select public.accept_invitation(%L)$$, pg_temp.fxt('tok_b'))), '22023', 'N5 conta com outro e-mail não aceita o convite');
select is(pg_temp.msg_of(format($$select public.accept_invitation(%L)$$, pg_temp.fxt('tok_b'))), '22023 convite inválido ou expirado', 'N5 mensagem genérica (não revela que o convite existe)');
select is(pg_temp.msg_of($$select public.accept_invitation('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef')$$), '22023 convite inválido ou expirado', 'token inexistente: mesma mensagem');
select is(pg_temp.sqlstate_of($$select public.accept_invitation('curto')$$), '22023', 'token curto demais: 22023');
select is(pg_temp.sqlstate_of($$select public.accept_invitation(null)$$), '22023', 'token nulo: 22023');
reset role;

-- convite vencido
update public.invitations set created_at = now() - interval '10 days', expires_at = now() - interval '3 days'
 where household_id = pg_temp.fx('h1');
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select is(pg_temp.sqlstate_of(format($$select public.accept_invitation(%L)$$, pg_temp.fxt('tok_b'))), '22023', 'convite vencido: 22023');
reset role;
-- restaura a validade e aceita
update public.invitations set created_at = now(), expires_at = now() + interval '7 days' where household_id = pg_temp.fx('h1');
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select is(public.accept_invitation(pg_temp.fxt('tok_b')), pg_temp.fx('h1'), 'U2 aceita o convite e entra na H1');
select is((select role from public.household_members where user_id = auth.uid()), 'member', 'quem aceita entra como member');
select is(pg_temp.sqlstate_of(format($$select public.accept_invitation(%L)$$, pg_temp.fxt('tok_b'))), '22023', 'reutilizar o mesmo token: 22023');
select is(pg_temp.sqlstate_of($$select public.create_household('Outra')$$), '55000', 'F1 quem já é membro não cria outra família');
reset role;
select is((select accepted_by::text from public.invitations where household_id = pg_temp.fx('h1')), '00000000-0000-0000-0000-0000000000a2', 'accepted_by registrado');

-- limite de 2 membros (N3)
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select is(pg_temp.sqlstate_of($$select public.create_invitation('terceiro@teste.com')$$), '55000', 'N3 família com 2 membros não convida o terceiro');
reset role;
-- o gatilho da tabela também barra (defesa em profundidade), mesmo para o owner do banco
select is(pg_temp.sqlstate_of(format($$insert into public.household_members (household_id, user_id, role) values (%L, '00000000-0000-0000-0000-0000000000a4', 'member')$$, pg_temp.fx('h1'))), '55000', 'N3 members_limit_guard barra o terceiro membro direto na tabela');

-- convite pendente também ocupa vaga: família de 2 com 1 membro + 1 pendente
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
insert into fixture select 'h3', public.create_household('Casa 3'), null;
insert into fixture select 'tok_c', null, public.create_invitation('u4@teste.com');
select is(pg_temp.sqlstate_of($$select public.create_invitation('quinto@teste.com')$$), '55000', 'N3 membro + convite pendente = 2: o próximo convite é barrado');
-- reenviar para o MESMO e-mail continua permitido (substitui o pendente)
select is(pg_temp.sqlstate_of($$select public.create_invitation('u4@teste.com')$$), null, 'N3 reenviar ao mesmo e-mail não conta duas vezes');
reset role;

-- convite de outra família endereçado a outro e-mail continua inválido para U2
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select is(pg_temp.sqlstate_of(format($$select public.accept_invitation(%L)$$, pg_temp.fxt('tok_c'))), '22023', 'convite para outro e-mail é inválido para U2');
reset role;

-- F1 por convite: U3 já tem família (H3) e recebe convite da H1 no seu e-mail
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
-- (H1 está cheia; abre vaga removendo U2 para testar só o vínculo único)
select public.remove_member('00000000-0000-0000-0000-0000000000a2');
insert into fixture select 'tok_f1', null, public.create_invitation('u3@teste.com');
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select is(pg_temp.sqlstate_of(format($$select public.accept_invitation(%L)$$, pg_temp.fxt('tok_f1'))), '55000', 'F1 quem já tem família não aceita convite de outra');
reset role;
delete from public.invitations where email = 'u3@teste.com';  -- libera a vaga ocupada pelo convite pendente
-- volta ao estado esperado pelo resto do teste: U2 é membro de novo
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
insert into fixture select 'tok_back', null, public.create_invitation('u2@teste.com');
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select public.accept_invitation(pg_temp.fxt('tok_back'));
reset role;

-- ======== remove_member / leave_household ========
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select is(pg_temp.sqlstate_of('select public.remove_member(''00000000-0000-0000-0000-0000000000a1'')'), '22023', 'owner não remove a si mesmo por remove_member');
select is(pg_temp.sqlstate_of('select public.remove_member(''00000000-0000-0000-0000-0000000000a4'')'), '22023', 'remover quem não é da família: 22023');
select is(pg_temp.sqlstate_of('select public.remove_member(null)'), '22023', 'remove_member(null): 22023');
select is(pg_temp.sqlstate_of('select public.leave_household()'), '55000', 'o único owner não sai da família');
reset role;
-- U2 sai por conta própria
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select is(pg_temp.sqlstate_of('select public.leave_household()'), null, 'membro comum sai da família');
select is((select count(*) from public.household_members where user_id = auth.uid()), 0::bigint, 'U2 não tem mais vínculo');
select is((select count(*) from public.accounts), 0::bigint, 'U2 deixou de ver os dados da H1');
select is(pg_temp.sqlstate_of('select public.leave_household()'), '55000', 'sair sem ter família: 55000');
reset role;
-- U2 volta por novo convite e é removido pelo owner
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
insert into fixture select 'tok_d', null, public.create_invitation('u2@teste.com');
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select is(public.accept_invitation(pg_temp.fxt('tok_d')), pg_temp.fx('h1'), 'U2 volta por novo convite');
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select is(pg_temp.sqlstate_of('select public.remove_member(''00000000-0000-0000-0000-0000000000a2'')'), null, 'owner remove o membro');
select is((select count(*) from public.household_members where household_id = pg_temp.fx('h1')), 1::bigint, 'sobra só o owner');
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select is(pg_temp.sqlstate_of('select public.remove_member(''00000000-0000-0000-0000-0000000000a1'')'), '42501', 'ex-membro não remove ninguém');
select is((select count(*) from public.households), 0::bigint, 'ex-membro não vê mais a família');
reset role;

-- guarda de owner: nunca pode ficar família sem owner (mesmo para o dono do banco, no commit/imediato)
create function pg_temp.owner_probe(p_h uuid) returns void language plpgsql as $f$
begin
  set constraints all immediate;
  delete from public.household_members where household_id = p_h and role = 'owner';
end $f$;
select is(pg_temp.sqlstate_of(format($$select pg_temp.owner_probe(%L)$$, pg_temp.fx('h1'))), '23514', 'família não fica sem owner (members_owner_guard)');
create function pg_temp.owner_demote(p_h uuid) returns void language plpgsql as $f$
begin
  set constraints all immediate;
  update public.household_members set role = 'member' where household_id = p_h and role = 'owner';
end $f$;
select is(pg_temp.sqlstate_of(format($$select pg_temp.owner_demote(%L)$$, pg_temp.fx('h1'))), '23514', 'rebaixar o único owner também é barrado');

-- ======== delete_household / D1 ========
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date) values (pg_temp.fx('h1'), 'Antiga', 'cash', 10, '2026-01-01') returning id) insert into fixture select 'd_a1', id, null from i;
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date) values (pg_temp.fx('h1'), 'Corrente', 'checking', 10, '2026-01-01') returning id) insert into fixture select 'd_a2', id, null from i;
insert into fixture select 'd_cat', id, null from public.categories where household_id = pg_temp.fx('h1') and name = 'Mercado';
insert into public.categories (household_id, name, type, parent_id) values (pg_temp.fx('h1'), 'Feira', 'expense', pg_temp.fx('d_cat'));
insert into fixture select 'd_t1', id, null from (select id from public.categories where household_id = pg_temp.fx('h1') and system_key = 'uncategorized' and type = 'expense') x;
insert into public.transactions (household_id, account_id, category_id, type, amount, date) values (pg_temp.fx('h1'), pg_temp.fx('d_a1'), pg_temp.fx('d_t1'), 'expense', 5, '2026-02-01');
insert into public.transactions (household_id, account_id, category_id, type, amount, date) values (pg_temp.fx('h1'), pg_temp.fx('d_a2'), pg_temp.fx('d_cat'), 'expense', 7, '2026-02-02');
insert into public.transactions (household_id, account_id, destination_account_id, type, amount, date) values (pg_temp.fx('h1'), pg_temp.fx('d_a2'), pg_temp.fx('d_a1'), 'transfer', 3, '2026-02-03');
update public.transactions set deleted_at = now() where household_id = pg_temp.fx('h1') and type = 'expense' and amount = 7;
insert into public.budgets (household_id, category_id, month, amount_limit) values (pg_temp.fx('h1'), pg_temp.fx('d_cat'), '2026-02-01', 100);
update public.accounts set active = false where id = pg_temp.fx('d_a1');
insert into fixture select 'tok_e', null, public.create_invitation('pendente@teste.com');
reset role;
select cmp_ok((select count(*) from public.transactions where household_id = pg_temp.fx('h1')), '=', 3::bigint, 'D1 preparado: 3 lançamentos (1 na lixeira), conta desativada, orçamento, convite pendente');

-- quem não é owner não exclui
select pg_temp.login('00000000-0000-0000-0000-0000000000a4');
select is(pg_temp.sqlstate_of('select public.delete_household()'), '42501', 'quem não tem família não exclui nada');
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select is(pg_temp.sqlstate_of('select public.delete_household()'), null, 'D1 delete_household de família com tudo: sem erro (nenhuma guarda ou FK barrou a cascata)');
reset role;
select is((select count(*) from public.households where id = pg_temp.fx('h1')), 0::bigint, 'D1 a família sumiu');
select is((select count(*) from public.household_members where household_id = pg_temp.fx('h1')), 0::bigint, 'D1 sem membros');
select is((select count(*) from public.accounts where household_id = pg_temp.fx('h1')), 0::bigint, 'D1 sem contas');
select is((select count(*) from public.categories where household_id = pg_temp.fx('h1')), 0::bigint, 'D1 sem categorias (inclusive as duas "Sem categoria")');
select is((select count(*) from public.transactions where household_id = pg_temp.fx('h1')), 0::bigint, 'D1 sem lançamentos (inclusive o da lixeira)');
select is((select count(*) from public.budgets where household_id = pg_temp.fx('h1')), 0::bigint, 'D1 sem orçamentos');
select is((select count(*) from public.invitations where household_id = pg_temp.fx('h1')), 0::bigint, 'D1 sem convites');
select is((select count(*) from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'), 1::bigint, 'o perfil do usuário permanece');
-- U1 pode criar outra família depois
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select is(pg_temp.sqlstate_of($$select public.create_household('Casa nova')$$), null, 'após excluir a família, o usuário cria outra');
reset role;

-- a exclusão de uma família não toca a outra
select is((select count(*) from public.households where id = pg_temp.fx('h3')), 1::bigint, 'a H3 continua existindo');
select is((select count(*) from public.categories where household_id = pg_temp.fx('h3')), 17::bigint, 'a H3 mantém suas 17 categorias');

-- ======== perfil automático (trigger em auth.users) ========
select is((select name from public.profiles where id = '00000000-0000-0000-0000-0000000000a4'), 'u4', 'sem nome nos metadados, o perfil usa a parte local do e-mail');
select is((select name from public.profiles where id = '00000000-0000-0000-0000-0000000000a2'), 'Bia', 'nome vem de raw_user_meta_data (só para exibição)');

select * from finish();
rollback;
