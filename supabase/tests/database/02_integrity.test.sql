-- 02_integrity: regras que o banco impõe (CHECK, FK composta, triggers), rodando como usuário real.
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

-- Cobre C1–C6, S6, S7, S15–S17, A3–A5, A7, B1–B5, B8–B12 e as guardas de categoria/conta.

-- ---- cenário-base: família "Casa Teste" (U1 owner), contas A e B, categorias ----
create function pg_temp.ins(p_type text, p_acc text, p_amt numeric, p_date date,
                            p_dst text default null, p_status text default 'paid', p_cat text default null)
returns uuid language plpgsql as $f$
declare v uuid;
begin
  insert into public.transactions (household_id, account_id, destination_account_id, category_id, type, amount, date, status)
  values (pg_temp.fx('h'), pg_temp.fx(p_acc), pg_temp.fx(p_dst),
          case when p_cat is not null then pg_temp.fx(p_cat)
               when p_type = 'income' then pg_temp.fx('cinc')
               when p_type = 'expense' then pg_temp.fx('cexp') end,
          p_type, p_amt, p_date, p_status)
  returning id into v;
  return v;
end $f$;
create function pg_temp.bal(p_acc text, p_d date) returns numeric language sql as $f$
  select balance from public.account_balances(pg_temp.fx('h'), p_d) where account_id = pg_temp.fx(p_acc) $f$;
grant execute on function pg_temp.ins(text, text, numeric, date, text, text, text), pg_temp.bal(text, date) to public;

select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
insert into fixture select 'h', public.create_household('Casa Teste'), null;
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Conta A', 'checking', 1000.00, '2026-01-01') returning id)
  insert into fixture select 'a', id, null from i;
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Conta B', 'savings', 500.00, '2026-03-01') returning id)
  insert into fixture select 'b', id, null from i;
insert into fixture select 'cexp', id, null from public.categories where household_id = pg_temp.fx('h') and name = 'Mercado';
insert into fixture select 'cinc', id, null from public.categories where household_id = pg_temp.fx('h') and name = 'Salário';
insert into fixture select 'sx_exp', id, null from public.categories where household_id = pg_temp.fx('h') and system_key = 'uncategorized' and type = 'expense';
insert into fixture select 'sx_inc', id, null from public.categories where household_id = pg_temp.fx('h') and system_key = 'uncategorized' and type = 'income';
-- o login de U1 segue ativo para o corpo do teste


-- ======== forma do lançamento (C1, C2, S16, S17) ========
select is(pg_temp.sqlstate_of(format($$insert into public.transactions (household_id, account_id, type, amount, date) values (%L, %L, 'expense', 10, '2026-02-01')$$, pg_temp.fx('h'), pg_temp.fx('a'))), '23514', 'C1 despesa sem categoria: CHECK');
select ok(pg_temp.msg_of(format($$insert into public.transactions (household_id, account_id, type, amount, date) values (%L, %L, 'income', 10, '2026-02-01')$$, pg_temp.fx('h'), pg_temp.fx('a'))) like '%transactions_shape%', 'C1 receita sem categoria: é o CHECK transactions_shape que recusa (não a FK)');
select is(pg_temp.sqlstate_of(format($$insert into public.transactions (household_id, account_id, destination_account_id, category_id, type, amount, date) values (%L, %L, %L, %L, 'transfer', 10, '2026-03-10')$$, pg_temp.fx('h'), pg_temp.fx('a'), pg_temp.fx('b'), pg_temp.fx('cexp'))), '23514', 'C2 transferência com categoria: CHECK');
select is(pg_temp.sqlstate_of(format($$insert into public.transactions (household_id, account_id, destination_account_id, type, amount, date) values (%L, %L, %L, 'transfer', 10, '2026-03-10')$$, pg_temp.fx('h'), pg_temp.fx('a'), pg_temp.fx('a'))), '23514', 'S16 transferência com origem = destino: CHECK');
select is(pg_temp.sqlstate_of(format($$insert into public.transactions (household_id, account_id, type, amount, date) values (%L, %L, 'transfer', 10, '2026-03-10')$$, pg_temp.fx('h'), pg_temp.fx('a'))), '23514', 'transferência sem destino: CHECK');
select is(pg_temp.sqlstate_of(format($$insert into public.transactions (household_id, account_id, destination_account_id, category_id, type, amount, date) values (%L, %L, %L, %L, 'expense', 10, '2026-03-10')$$, pg_temp.fx('h'), pg_temp.fx('a'), pg_temp.fx('b'), pg_temp.fx('cexp'))), '23514', 'despesa com conta de destino: CHECK');
select is(pg_temp.sqlstate_of(format($$select pg_temp.ins('income', 'a', 0, '2026-02-01')$$)), '23514', 'S17 receita com valor 0: CHECK');
select is(pg_temp.sqlstate_of(format($$select pg_temp.ins('income', 'a', -10, '2026-02-01')$$)), '23514', 'S17 receita com valor negativo: CHECK');
select is(pg_temp.sqlstate_of(format($$insert into public.transactions (household_id, account_id, category_id, type, amount, date, status) values (%L, %L, %L, 'expense', 10, '2026-02-01', 'xx')$$, pg_temp.fx('h'), pg_temp.fx('a'), pg_temp.fx('cexp'))), '23514', 'status inválido: CHECK');
select is(pg_temp.sqlstate_of(format($$insert into public.transactions (household_id, account_id, category_id, type, amount, date) values (%L, %L, %L, 'expense', 10, '1999-12-31')$$, pg_temp.fx('h'), pg_temp.fx('a'), pg_temp.fx('cexp'))), '23514', 'data fora do intervalo aceito: CHECK');
select is(pg_temp.sqlstate_of(format($$select pg_temp.ins('expense', 'a', 10, '2026-02-01')$$)), null, 'despesa válida é aceita (controle)');

-- ======== categoria x tipo (C6, B11) ========
select is(pg_temp.sqlstate_of(format($$select pg_temp.ins('expense', 'a', 10, '2026-02-01', null, 'paid', 'sx_inc')$$)), '23503', 'C6 despesa com "Sem categoria" de receita: FK composta');
select is(pg_temp.sqlstate_of(format($$select pg_temp.ins('expense', 'a', 10, '2026-02-01', null, 'paid', 'cinc')$$)), '23503', 'B11 despesa com categoria de receita: FK composta');
select is(pg_temp.sqlstate_of(format($$select pg_temp.ins('income', 'a', 10, '2026-02-01', null, 'paid', 'cexp')$$)), '23503', 'receita com categoria de despesa: FK composta');
select is(pg_temp.sqlstate_of(format($$select pg_temp.ins('expense', 'a', 10, '2026-02-01', null, 'paid', 'sx_exp')$$)), null, 'despesa usando "Sem categoria" de despesa é aceita');

-- ======== transferência x abertura das contas (S6, S7, S10 parcial) ========
select is(pg_temp.sqlstate_of(format($$select pg_temp.ins('transfer', 'a', 300, '2026-02-20', 'b')$$)), '23514', 'S6 transferência A→B antes da abertura de B: rejeitada');
select ok(pg_temp.msg_of(format($$select pg_temp.ins('transfer', 'a', 300, '2026-02-20', 'b')$$)) like '%abertura da conta de destino%', 'S6 a mensagem aponta a conta de destino');
select is(pg_temp.sqlstate_of(format($$select pg_temp.ins('transfer', 'b', 300, '2026-02-20', 'a')$$)), '23514', 'S6 transferência B→A antes da abertura de B (origem): rejeitada');
select ok(pg_temp.msg_of(format($$select pg_temp.ins('transfer', 'b', 300, '2026-02-20', 'a')$$)) like '%abertura da conta de origem%', 'S6 a mensagem aponta a conta de origem');
select is(pg_temp.sqlstate_of(format($$select pg_temp.ins('transfer', 'a', 100, '2026-03-01', 'b')$$)), null, 'S7 transferência na própria data de abertura de B: aceita');
select is(pg_temp.sqlstate_of(format($$select pg_temp.ins('transfer', 'a', 100, '2026-03-15', 'b')$$)), null, 'transferência depois da abertura: aceita');
-- receitas e despesas anteriores à abertura são permitidas (histórico)
select is(pg_temp.sqlstate_of(format($$select pg_temp.ins('expense', 'b', 50, '2026-02-15')$$)), null, 'despesa anterior à abertura de B: aceita');
select is(pg_temp.sqlstate_of(format($$select pg_temp.ins('income', 'b', 50, '2026-02-15')$$)), null, 'receita anterior à abertura de B: aceita');
select is(pg_temp.sqlstate_of(format($$update public.accounts set opening_date = '2026-03-20' where id = %L$$, pg_temp.fx('b'))), '23514', 'S10 mover a abertura de B para depois de uma transferência existente: rejeitado');
select is(pg_temp.sqlstate_of(format($$update public.accounts set opening_date = '2026-03-10' where id = %L$$, pg_temp.fx('b'))), '23514', 'mover a abertura de B para depois da transferência de 01/03: rejeitado');
select is(pg_temp.sqlstate_of(format($$update public.accounts set opening_date = '2026-02-01' where id = %L$$, pg_temp.fx('b'))), null, 'mover a abertura de B para antes é permitido');
select is(pg_temp.sqlstate_of(format($$update public.accounts set opening_date = '1999-01-01' where id = %L$$, pg_temp.fx('b'))), '23514', 'abertura fora do intervalo aceito: CHECK');
select is(pg_temp.sqlstate_of(format($$update public.accounts set opening_date = '2026-03-01' where id = %L$$, pg_temp.fx('b'))), null, 'volta a abertura de B para 01/03');

-- ======== contas desativadas (A3–A5, A7, S15) ========
select is(pg_temp.sqlstate_of(format($$update public.accounts set active = false where id = %L$$, pg_temp.fx('b'))), null, 'desativa B (sem planejados)');
select is(pg_temp.sqlstate_of(format($$select pg_temp.ins('income', 'b', 10, '2026-04-01')$$)), '23514', 'A3 receita em conta desativada: rejeitada');
select is(pg_temp.sqlstate_of(format($$select pg_temp.ins('expense', 'b', 10, '2026-04-01')$$)), '23514', 'A3 despesa em conta desativada: rejeitada');
select is(pg_temp.sqlstate_of(format($$select pg_temp.ins('transfer', 'a', 10, '2026-04-01', 'b')$$)), '23514', 'A3/S15 transferência com DESTINO desativado: rejeitada');
select is(pg_temp.sqlstate_of(format($$select pg_temp.ins('transfer', 'b', 10, '2026-04-01', 'a')$$)), '23514', 'A3 transferência com ORIGEM desativada: rejeitada');
insert into fixture select 'ta', pg_temp.ins('expense', 'a', 15, '2026-04-02'), null;
select is(pg_temp.sqlstate_of(format($$update public.transactions set account_id = %L where id = %L$$, pg_temp.fx('b'), pg_temp.fx('ta'))), '23514', 'A5 trocar o lançamento de A para B desativada: rejeitado');
select is(pg_temp.sqlstate_of(format($$update public.transactions set amount = 16 where id = %L$$, pg_temp.fx('ta'))), null, 'editar valor de lançamento de conta ATIVA: aceito (controle)');
-- A4: restaurar da lixeira em conta desativada
select is(pg_temp.sqlstate_of(format($$update public.accounts set active = true where id = %L$$, pg_temp.fx('b'))), null, 'reativa B (A8)');
insert into fixture select 'tb', pg_temp.ins('expense', 'b', 20, '2026-04-03'), null;
select is(pg_temp.sqlstate_of(format($$update public.transactions set deleted_at = now() where id = %L$$, pg_temp.fx('tb'))), null, 'manda o lançamento de B para a lixeira');
select is(pg_temp.sqlstate_of(format($$update public.accounts set active = false where id = %L$$, pg_temp.fx('b'))), null, 'desativa B de novo (lixeira não conta como planejado)');
select is(pg_temp.sqlstate_of(format($$update public.transactions set deleted_at = null where id = %L$$, pg_temp.fx('tb'))), '23514', 'A4 restaurar da lixeira um lançamento de B desativada: rejeitado');
select is(pg_temp.sqlstate_of(format($$update public.accounts set active = true where id = %L$$, pg_temp.fx('b'))), null, 'A8 reativa B');
select is(pg_temp.sqlstate_of(format($$update public.transactions set deleted_at = null where id = %L$$, pg_temp.fx('tb'))), null, 'A8 restaurar o lançamento depois de reativar: aceito');
select is(pg_temp.sqlstate_of(format($$select pg_temp.ins('income', 'b', 10, '2026-04-04')$$)), null, 'A8 novo lançamento em B reativada: aceito');
-- A7: planejado em aberto impede desativar
insert into fixture select 'tp', pg_temp.ins('expense', 'a', 30, '2026-05-01', null, 'planned'), null;
select is(pg_temp.sqlstate_of(format($$update public.accounts set active = false where id = %L$$, pg_temp.fx('a'))), '23514', 'A7 desativar conta com lançamento planejado em aberto: rejeitado');
select is(pg_temp.sqlstate_of(format($$update public.transactions set deleted_at = now() where id = %L$$, pg_temp.fx('tp'))), null, 'exclui (lixeira) o planejado');
select is(pg_temp.sqlstate_of(format($$update public.accounts set active = false where id = %L$$, pg_temp.fx('a'))), null, 'agora desativar A é aceito');
select is(pg_temp.sqlstate_of(format($$update public.accounts set active = true where id = %L$$, pg_temp.fx('a'))), null, 'reativa A');
-- planejado numa transferência também impede (conta de destino)
insert into fixture select 'tp2', pg_temp.ins('transfer', 'a', 5, '2026-05-02', 'b', 'planned'), null;
select is(pg_temp.sqlstate_of(format($$update public.accounts set active = false where id = %L$$, pg_temp.fx('b'))), '23514', 'planejado com B como destino impede desativar B');

-- ======== contas: nome e dados ========
select is(pg_temp.sqlstate_of(format($$insert into public.accounts (household_id, name, type, opening_date) values (%L, '  conta a ', 'cash', '2026-01-01')$$, pg_temp.fx('h'))), '23505', 'nome de conta duplicado (sem diferenciar caixa/espaços): rejeitado');
select is(pg_temp.sqlstate_of(format($$insert into public.accounts (household_id, name, type, opening_date) values (%L, 'X', 'poupanca', '2026-01-01')$$, pg_temp.fx('h'))), '23514', 'tipo de conta inválido: CHECK');
select is(pg_temp.sqlstate_of(format($$insert into public.accounts (household_id, name, type, opening_date) values (%L, '   ', 'cash', '2026-01-01')$$, pg_temp.fx('h'))), '23514', 'nome de conta em branco: CHECK');

-- ======== "Sem categoria" (C4, C5) ========
select is(pg_temp.sqlstate_of(format($$insert into public.categories (household_id, name, type) values (%L, 'Sem categoria', 'expense')$$, pg_temp.fx('h'))), '23505', 'C4 segunda "Sem categoria" pelo nome: rejeitada');
select is(pg_temp.sqlstate_of(format($$insert into public.categories (household_id, name, type, system_key) values (%L, 'Outra', 'expense', 'uncategorized')$$, pg_temp.fx('h'))), '42501', 'system_key não é informável pelo cliente');
reset role;
select is(pg_temp.sqlstate_of(format($$insert into public.categories (household_id, name, type, system_key) values (%L, 'Outra', 'expense', 'uncategorized')$$, pg_temp.fx('h'))), '23505', 'C4 índice único parcial também barra quem tem privilégio (owner do banco)');
select is((select count(*) from public.categories where household_id = pg_temp.fx('h') and system_key = 'uncategorized'), 2::bigint, 'C3 continuam exatamente 2 "Sem categoria" (uma por tipo)');
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select is(pg_temp.sqlstate_of(format($$update public.categories set name = 'Renomeada' where id = %L$$, pg_temp.fx('sx_exp'))), '23514', 'C5 renomear "Sem categoria": rejeitado');
select is(pg_temp.sqlstate_of(format($$update public.categories set active = false where id = %L$$, pg_temp.fx('sx_exp'))), '23514', 'C5 desativar "Sem categoria": rejeitado');
select is(pg_temp.sqlstate_of(format($$update public.categories set parent_id = %L where id = %L$$, pg_temp.fx('cexp'), pg_temp.fx('sx_exp'))), '23514', 'C5 mover "Sem categoria" para baixo de outra: rejeitado');
select is(pg_temp.sqlstate_of(format($$update public.categories set color = '#112233' where id = %L$$, pg_temp.fx('sx_exp'))), null, 'C5 cor e ícone de "Sem categoria" PODEM mudar (a guarda protege nome, tipo, mãe e active)');
select is(pg_temp.sqlstate_of(format($$delete from public.categories where id = %L$$, pg_temp.fx('sx_exp'))), '23514', 'C5 excluir "Sem categoria": rejeitado');
select is(pg_temp.sqlstate_of(format($$insert into public.categories (household_id, name, type, parent_id) values (%L, 'Filha', 'expense', %L)$$, pg_temp.fx('h'), pg_temp.fx('sx_exp'))), '23514', 'C5 criar filha de "Sem categoria": rejeitado');

-- ======== categorias: 1 nível, tipo da mãe (B8, B9, B10) ========
insert into fixture select 'lazer', id, null from (select id from public.categories where household_id = pg_temp.fx('h') and name = 'Lazer' and type = 'expense') x;
select ok(pg_temp.fx('lazer') is not null, 'a categoria padrão "Lazer" existe');
select is(pg_temp.sqlstate_of(format($$insert into public.categories (household_id, name, type, parent_id) values (%L, 'Cinema', 'expense', %L)$$, pg_temp.fx('h'), pg_temp.fx('lazer'))), null, 'subcategoria de categoria raiz: aceita');
insert into fixture select 'cinema', id, null from public.categories where household_id = pg_temp.fx('h') and name = 'Cinema';
select is(pg_temp.sqlstate_of(format($$insert into public.categories (household_id, name, type, parent_id) values (%L, 'Neto', 'expense', %L)$$, pg_temp.fx('h'), pg_temp.fx('cinema'))), '23514', 'B9 subcategoria de subcategoria: rejeitada');
select is(pg_temp.sqlstate_of(format($$insert into public.categories (household_id, name, type, parent_id) values (%L, 'Tipo errado', 'income', %L)$$, pg_temp.fx('h'), pg_temp.fx('lazer'))), '23503', 'B8 subcategoria com tipo diferente da mãe: FK composta');
select is(pg_temp.sqlstate_of(format($$update public.categories set parent_id = %L where id = %L$$, pg_temp.fx('cinema'), pg_temp.fx('lazer'))), '23514', 'categoria com subcategorias não vira subcategoria');
select is(pg_temp.sqlstate_of(format($$insert into public.categories (household_id, name, type) values (%L, ' LAZER ', 'expense')$$, pg_temp.fx('h'))), '23505', 'nome de categoria duplicado no mesmo nível/tipo: rejeitado');
select is(pg_temp.sqlstate_of(format($$insert into public.categories (household_id, name, type) values (%L, 'Lazer', 'income')$$, pg_temp.fx('h'))), null, 'mesmo nome em tipo diferente é aceito');
select is(pg_temp.sqlstate_of(format($$insert into public.categories (household_id, name, type, color) values (%L, 'Cor ruim', 'expense', 'azul')$$, pg_temp.fx('h'))), '23514', 'cor inválida: CHECK');
select is(pg_temp.sqlstate_of(format($$update public.categories set type = 'income' where id = %L$$, pg_temp.fx('cexp'))), '42501', 'B10 o cliente não tem privilégio para mudar o type da categoria');
reset role;
select is(pg_temp.sqlstate_of(format($$update public.categories set type = 'income' where id = %L$$, pg_temp.fx('cexp'))), '23503', 'B10 mudar o type de categoria que já tem lançamento: FK composta (mesmo para o owner do banco)');
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');

-- ======== orçamentos (B1–B5, B9) ========
select is(pg_temp.sqlstate_of(format($$insert into public.budgets (household_id, category_id, month, amount_limit) values (%L, %L, '2026-03-01', 100)$$, pg_temp.fx('h'), pg_temp.fx('cinc'))), '23503', 'B1 orçamento em categoria de receita: FK composta');
select is(pg_temp.sqlstate_of(format($$insert into public.budgets (household_id, category_id, category_type, month, amount_limit) values (%L, %L, 'income', '2026-03-01', 100)$$, pg_temp.fx('h'), pg_temp.fx('cexp'))), '42501', 'B2 category_type não é informável pelo cliente');
reset role;
select is(pg_temp.sqlstate_of(format($$insert into public.budgets (household_id, category_id, category_type, month, amount_limit) values (%L, %L, 'income', '2026-03-01', 100)$$, pg_temp.fx('h'), pg_temp.fx('cexp'))), '23514', 'B2 category_type = income: CHECK (mesmo para o owner do banco)');
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select is(pg_temp.sqlstate_of(format($$insert into public.budgets (household_id, category_id, month, amount_limit) values (%L, %L, '2026-03-01', 100)$$, pg_temp.fx('h'), pg_temp.fx('cexp'))), null, 'B3 orçamento sem category_type em despesa raiz: aceito (DEFAULT)');
select is((select category_type from public.budgets where category_id = pg_temp.fx('cexp')), 'expense', 'B3 category_type ficou "expense"');
select is(pg_temp.sqlstate_of(format($$insert into public.budgets (household_id, category_id, month, amount_limit) values (%L, %L, '2026-03-01', 100)$$, pg_temp.fx('h'), pg_temp.fx('cinema'))), '23514', 'B4 orçamento em subcategoria: rejeitado');
select is(pg_temp.sqlstate_of(format($$insert into public.budgets (household_id, category_id, month, amount_limit) values (%L, %L, '2026-03-02', 100)$$, pg_temp.fx('h'), pg_temp.fx('lazer'))), '23514', 'B5 month fora do dia 1: CHECK');
select is(pg_temp.sqlstate_of(format($$insert into public.budgets (household_id, category_id, month, amount_limit) values (%L, %L, '2026-03-01', 100)$$, pg_temp.fx('h'), pg_temp.fx('cexp'))), '23505', 'um orçamento por (categoria, mês): duplicado rejeitado');
select is(pg_temp.sqlstate_of(format($$update public.categories set parent_id = %L where id = %L$$, pg_temp.fx('lazer'), pg_temp.fx('cexp'))), '23514', 'categoria com orçamento não vira subcategoria');
select is(pg_temp.sqlstate_of(format($$insert into public.budgets (household_id, category_id, month, amount_limit) values (%L, %L, '2026-04-01', 100)$$, pg_temp.fx('h'), pg_temp.fx('sx_exp'))), null, 'orçamento em "Sem categoria" de despesa é raiz: aceito');

select * from finish();
rollback;
