-- 03_balance: saldo derivado, relatórios e conservação (S1–S14, A1, A2, A6, A9, T-INV).
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

-- Valores esperados vêm do modelo de referência em Python (docs/MODELO-DE-DADOS.md, seção 9).

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


-- S1
select is(pg_temp.bal('a', '2026-02-28'), 1000.00::numeric, 'S1 saldo de A em 28/02 sem lançamentos');
-- S2
insert into fixture select 'i1', pg_temp.ins('income', 'a', 200, '2026-02-10'), null;
select is(pg_temp.bal('a', '2026-02-28'), 1200.00::numeric, 'S2 receita de 200 em A: 1.200,00');
-- S3
insert into fixture select 'tr', pg_temp.ins('transfer', 'a', 300, '2026-03-15', 'b'), null;
select is(pg_temp.bal('a', '2026-03-31'), 900.00::numeric, 'S3 A em 31/03 = 900,00');
select is(pg_temp.bal('b', '2026-03-31'), 800.00::numeric, 'S3 B em 31/03 = 800,00');
-- S8
select is((select count(*) from public.account_balances(pg_temp.fx('h'), '2026-02-28')), 1::bigint, 'S8 em 28/02 só uma conta aparece');
select is((select count(*) from public.account_balances(pg_temp.fx('h'), '2026-02-28') where account_id = pg_temp.fx('b')), 0::bigint, 'S8 B ausente antes da abertura');
-- S4
select is(pg_temp.sqlstate_of(format($$select pg_temp.ins('expense', 'b', 50, '2026-02-15')$$)), null, 'S4 despesa de 50 em B antes da abertura: aceita');
select is(pg_temp.bal('b', '2026-03-31'), 800.00::numeric, 'S4 saldo de B segue 800,00');
select is((select expense_paid from public.period_summary(pg_temp.fx('h'), '2026-02-01', '2026-02-28')), 50.00::numeric, 'S4 a despesa aparece no relatório de fevereiro');
select is((select income_paid from public.period_summary(pg_temp.fx('h'), '2026-02-01', '2026-02-28')), 200.00::numeric, 'receita de fevereiro = 200,00');
-- S5
insert into fixture select 'pl', pg_temp.ins('expense', 'a', 99.99, '2026-03-20', null, 'planned'), null;
select is(pg_temp.bal('a', '2026-03-31'), 900.00::numeric, 'S5 planejada não altera o saldo de A');
select is(pg_temp.bal('b', '2026-03-31'), 800.00::numeric, 'S5 planejada não altera o saldo de B');
select is((select expense_planned from public.period_summary(pg_temp.fx('h'), '2026-03-01', '2026-03-31')), 99.99::numeric, 'S5 a planejada aparece só no total planejado');
select is((select expense_paid from public.period_summary(pg_temp.fx('h'), '2026-03-01', '2026-03-31')), 0::numeric, 'S5 despesa realizada de março = 0 (transferência não é despesa)');
select is((select income_paid from public.period_summary(pg_temp.fx('h'), '2026-03-01', '2026-03-31')), 0::numeric, 'receita realizada de março = 0 (transferência não é receita)');
-- conservação em 31/03: 1000 + 500 + 200 = 1700 (transferência neutra; despesa pré-abertura e planejada fora)
select is((select total from public.balance_totals(pg_temp.fx('h'), '2026-03-31')), 1700.00::numeric, 'total de saldos em 31/03 = 1.700,00');

-- S9: recuar a abertura de B faz a despesa de 50 passar a contar
update public.accounts set opening_date = '2026-02-01' where id = pg_temp.fx('b');
select is(pg_temp.bal('b', '2026-03-31'), 750.00::numeric, 'S9 B com abertura em 01/02: 750,00');
select is((select total from public.balance_totals(pg_temp.fx('h'), '2026-03-31')), 1650.00::numeric, 'S9 total passa a 1.650,00 (a despesa de 50 passou a contar)');
update public.accounts set opening_date = '2026-03-01' where id = pg_temp.fx('b');
select is(pg_temp.bal('b', '2026-03-31'), 800.00::numeric, 'S9 voltando a abertura, B = 800,00 de novo (nada armazenado)');

-- S10
select is(pg_temp.sqlstate_of(format($$update public.accounts set opening_date = '2026-03-20' where id = %L$$, pg_temp.fx('b'))), '23514', 'S10 abertura de B em 20/03 com transferência de 15/03: rejeitado');

-- S7: transferência no dia da abertura conta no saldo
insert into fixture select 'tr7', pg_temp.ins('transfer', 'a', 100, '2026-03-01', 'b'), null;
select is(pg_temp.bal('b', '2026-03-01'), 600.00::numeric, 'S7 B em 01/03 = 500 + 100 (o dia da abertura conta)');
select is(pg_temp.bal('a', '2026-03-01'), 1100.00::numeric, 'S7 A em 01/03 = 1.200 - 100');
update public.transactions set deleted_at = now() where id = pg_temp.fx('tr7');
select is(pg_temp.bal('b', '2026-03-01'), 500.00::numeric, 'S7 depois da lixeira, B em 01/03 = 500,00');

-- S11, S12
update public.transactions set deleted_at = now() where id = pg_temp.fx('tr');
select is(pg_temp.bal('a', '2026-03-31'), 1200.00::numeric, 'S11 transferência na lixeira: A = 1.200,00');
select is(pg_temp.bal('b', '2026-03-31'), 500.00::numeric, 'S11 transferência na lixeira: B = 500,00');
select is(pg_temp.sqlstate_of(format($$update public.transactions set deleted_at = null where id = %L$$, pg_temp.fx('tr'))), null, 'S12 restaurar a transferência: aceito');
select is(pg_temp.bal('a', '2026-03-31'), 900.00::numeric, 'S12 A volta a 900,00');
select is(pg_temp.bal('b', '2026-03-31'), 800.00::numeric, 'S12 B volta a 800,00');

-- S13: transferência na lixeira, abertura de B empurrada para depois dela, restauração recusada
update public.transactions set deleted_at = now() where id = pg_temp.fx('tr');
select is(pg_temp.sqlstate_of(format($$update public.accounts set opening_date = '2026-03-20' where id = %L$$, pg_temp.fx('b'))), null, 'S13 com a transferência na lixeira, mover a abertura é aceito');
select is(pg_temp.sqlstate_of(format($$update public.transactions set deleted_at = null where id = %L$$, pg_temp.fx('tr'))), '23514', 'S13 restaurar transferência anterior à abertura: rejeitado');
update public.accounts set opening_date = '2026-03-01' where id = pg_temp.fx('b');
select is(pg_temp.sqlstate_of(format($$update public.transactions set deleted_at = null where id = %L$$, pg_temp.fx('tr'))), null, 'S13 com a abertura de volta, restaurar é aceito');

-- S14: editar o valor muda o saldo na hora
update public.transactions set amount = 250 where id = pg_temp.fx('i1');
select is(pg_temp.bal('a', '2026-02-28'), 1250.00::numeric, 'S14 receita editada para 250: saldo de A = 1.250,00');
update public.transactions set amount = 200 where id = pg_temp.fx('i1');
select is(pg_temp.bal('a', '2026-02-28'), 1200.00::numeric, 'S14 voltando a 200: 1.200,00');

-- lançamento excluído (lixeira) sai do saldo e do resumo
insert into fixture select 'lx', pg_temp.ins('expense', 'a', 70, '2026-02-12'), null;
select is(pg_temp.bal('a', '2026-02-28'), 1130.00::numeric, 'despesa de 70 reduz o saldo');
update public.transactions set deleted_at = now() where id = pg_temp.fx('lx');
select is(pg_temp.bal('a', '2026-02-28'), 1200.00::numeric, 'despesa na lixeira sai do saldo');
select is((select expense_paid from public.period_summary(pg_temp.fx('h'), '2026-02-01', '2026-02-28')), 50.00::numeric, 'despesa na lixeira sai do resumo');

-- A1, A2, A9
update public.accounts set active = false where id = pg_temp.fx('b');
select is(pg_temp.bal('b', '2026-03-31'), 800.00::numeric, 'A1 B desativada continua com 800,00');
select is((select active from public.account_balances(pg_temp.fx('h'), '2026-03-31') where account_id = pg_temp.fx('b')), false, 'A1 B aparece com active = false');
select is((select total from public.balance_totals(pg_temp.fx('h'), '2026-03-31')), 1700.00::numeric, 'A2 total = 1.700,00');
select is((select total_active from public.balance_totals(pg_temp.fx('h'), '2026-03-31')), 900.00::numeric, 'A2 total_active = 900,00');
select is((select total_inactive from public.balance_totals(pg_temp.fx('h'), '2026-03-31')), 800.00::numeric, 'A2 total_inactive = 800,00');
select ok((select total = total_active + total_inactive from public.balance_totals(pg_temp.fx('h'), '2026-03-31')), 'A2 total = ativas + inativas');
select is((select count(*) from public.account_balances(pg_temp.fx('h'), '2026-02-28')), 1::bigint, 'A9 consulta de 28/02: só A (B ainda não existia)');
-- A6: editar valor de lançamento já existente em conta desativada
update public.transactions set amount = 310 where id = pg_temp.fx('tr');
select is(pg_temp.bal('b', '2026-03-31'), 810.00::numeric, 'A6 editar a transferência com B desativada: aceito, B = 810,00');
update public.transactions set amount = 300 where id = pg_temp.fx('tr');
select is(pg_temp.bal('b', '2026-03-31'), 800.00::numeric, 'A6 revertido: 800,00');
-- A10: desativar com saldo ≠ 0 foi aceito acima e o saldo permanece no total
update public.accounts set active = true where id = pg_temp.fx('b');

-- ---------------------------------------------------------------------------
-- T-INV: conservação em cenários aleatórios, incluindo excluídos, planejados e
-- contas desativadas depois de terem movimento. Roda como dono do banco
-- (bypass de RLS) numa família à parte. Semente fixa => reprodutível.
-- ---------------------------------------------------------------------------
reset role;
create temp table tinv (k text primary key, v bigint not null);
select setseed(0.4242);
do $do$
declare
  v_h uuid; v_cx uuid; v_ci uuid;
  v_acc uuid[]; v_open date[]; v_ids uuid[];
  i int; j int; k int;
  v_d date; v_o1 int; v_o2 int; v_amt numeric; v_type text; v_st text;
  v_asof date; v_total numeric; v_exp numeric;
  n_cen int := 0; n_bad int := 0; n_tr_ok int := 0; n_tr_rej int := 0; n_deact_ok int := 0; n_deact_rej int := 0;
begin
  insert into public.households (name) values ('T-INV') returning id into v_h;
  insert into public.categories (household_id, name, type) values (v_h, 'x', 'expense') returning id into v_cx;
  insert into public.categories (household_id, name, type) values (v_h, 'y', 'income')  returning id into v_ci;
  for i in 1..300 loop
    v_acc := array[]::uuid[]; v_open := array[]::date[];
    for j in 1..4 loop
      v_acc := v_acc || gen_random_uuid();
      v_open := v_open || (date '2026-01-01' + floor(random() * 100)::int);
      insert into public.accounts (id, household_id, name, type, initial_balance, opening_date)
      values (v_acc[j], v_h, 'c' || j, 'checking', round((random() * 900 - 100)::numeric, 2), v_open[j]);
    end loop;
    for k in 1..25 loop
      v_d := date '2026-01-01' + floor(random() * 200)::int;
      v_amt := round((0.01 + random() * 300)::numeric, 2);
      v_st := case when random() < 0.25 then 'planned' else 'paid' end;
      v_type := (array['income', 'expense', 'transfer'])[1 + floor(random() * 3)::int];
      v_o1 := 1 + floor(random() * 4)::int;
      begin
        if v_type = 'transfer' then
          v_o2 := 1 + ((v_o1 - 1 + 1 + floor(random() * 3)::int) % 4);
          insert into public.transactions (household_id, account_id, destination_account_id, type, amount, date, status, deleted_at)
          values (v_h, v_acc[v_o1], v_acc[v_o2], 'transfer', v_amt, v_d, v_st, case when random() < 0.1 then now() end);
          n_tr_ok := n_tr_ok + 1;
        else
          insert into public.transactions (household_id, account_id, category_id, type, amount, date, status, deleted_at)
          values (v_h, v_acc[v_o1], case v_type when 'income' then v_ci else v_cx end, v_type, v_amt, v_d, v_st,
                  case when random() < 0.1 then now() end);
        end if;
      exception when sqlstate '23514' then
        n_tr_rej := n_tr_rej + 1;   -- transferência anterior à abertura: rejeitada pela regra
      end;
    end loop;
    -- desativa contas ao acaso, depois de terem movimento
    for j in 1..4 loop
      if random() < 0.5 then
        begin
          update public.accounts set active = false where id = v_acc[j];
          n_deact_ok := n_deact_ok + 1;
        exception when sqlstate '23514' then
          n_deact_rej := n_deact_rej + 1;  -- tinha planejado em aberto
        end;
      end if;
    end loop;
    -- confere em 3 datas por cenário
    for k in 1..3 loop
      v_asof := date '2026-01-01' + floor(random() * 230)::int;
      select coalesce(sum(b.balance), 0) into v_total from public.account_balances(v_h, v_asof) b;
      select coalesce(sum(a.initial_balance), 0) into v_exp from public.accounts a
       where a.household_id = v_h and a.opening_date <= v_asof;
      v_exp := v_exp + coalesce((
        select sum(case t.type when 'income' then t.amount else -t.amount end)
          from public.transactions t join public.accounts a on a.id = t.account_id and a.household_id = t.household_id
         where t.household_id = v_h and t.deleted_at is null and t.status = 'paid'
           and t.type in ('income', 'expense') and t.date >= a.opening_date and t.date <= v_asof), 0);
      n_cen := n_cen + 1;
      if v_total <> v_exp then n_bad := n_bad + 1; end if;
      -- total = ativas + inativas
      if (select total <> total_active + total_inactive from public.balance_totals(v_h, v_asof)) then n_bad := n_bad + 1; end if;
    end loop;
    delete from public.transactions where household_id = v_h;
    delete from public.accounts where household_id = v_h;
  end loop;
  insert into tinv values ('cenarios', n_cen), ('divergencias', n_bad), ('transf_aceitas', n_tr_ok),
    ('rejeitadas', n_tr_rej), ('desativadas', n_deact_ok), ('desativacao_barrada', n_deact_rej);
end
$do$;
select is((select v from tinv where k = 'cenarios'), 900::bigint, 'T-INV 900 conferências executadas (300 cenários x 3 datas)');
select is((select v from tinv where k = 'divergencias'), 0::bigint, 'T-INV nenhuma divergência: Σ saldos = Σ saldo inicial + receitas − despesas (todas as contas abertas até D)');
select cmp_ok((select v from tinv where k = 'transf_aceitas'), '>', 500::bigint, 'T-INV o teste exercitou transferências aceitas (não é vacuoso)');
select cmp_ok((select v from tinv where k = 'rejeitadas'), '>', 50::bigint, 'T-INV o teste exercitou a rejeição de transferência anterior à abertura');
select cmp_ok((select v from tinv where k = 'desativadas'), '>', 100::bigint, 'T-INV contas desativadas depois de terem movimento entraram no cálculo');

select * from finish();
rollback;
