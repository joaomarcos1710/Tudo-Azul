-- 138_card_installment_edit_following: migration 145. Editar o valor de uma parcela do cartão "desta em diante".
-- Pedido do dono (21/11/2026): corrigiu a parcela 2 de 10 do seguro viagem e as outras 8 ficaram com o valor antigo.
-- A função chama card_installment_edit para cada parcela, numa transação só: as travas são as mesmas e, se uma parcela for
-- recusada, nenhuma muda.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ---- auxiliares de teste (temporários; somem no rollback) ----
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
create function pg_temp.parcelas(p_plan uuid) returns text language sql as $f$
  select string_agg(seq || ':' || due_date || ':' || face, ' ' order by seq)
    from public.debt_installments where plan = p_plan::text $f$;
create function pg_temp.uid(p_n integer) returns uuid language sql as $f$
  select ('00000000-0000-0000-0000-000000' || lpad(p_n::text, 6, '0'))::uuid $f$;
-- Cria família, conta "Banco" (5000), categoria de despesa e cartão "Cartão" (fecha 17, vence 25).
create function pg_temp.mk(p_tag text, p_n integer) returns void language plpgsql as $f$
declare v_h uuid; v_acc uuid;
begin
  perform pg_temp.login(pg_temp.uid(p_n));
  v_h := public.create_household('Casa ' || p_tag);
  insert into public.accounts (household_id, name, type, initial_balance, opening_date)
  values (v_h, 'Banco', 'checking', 5000, '2026-01-01') returning id into v_acc;
  insert into fixture values (p_tag || 'h', v_h), (p_tag || 'bank', v_acc);
  insert into fixture select p_tag || 'cat', id from public.categories
   where household_id = v_h and name = 'Compras pessoais';
  insert into fixture select p_tag || 'card', public.create_debt('Cartão', 'card', '2026-01-01', 0);
  perform public.set_card_cycle((select v from fixture where k = p_tag || 'card'), 17, 25);
end $f$;
-- Saldo da conta "Banco" e id da fatura (por rótulo) do cartão do cenário.
create function pg_temp.banco(p_tag text) returns numeric language sql as $f$
  select balance from public.account_balances(pg_temp.fx(p_tag || 'h'), '2099-12-31') where name = 'Banco' $f$;
create function pg_temp.fat(p_tag text, p_label text) returns uuid language sql as $f$
  select id from public.debt_invoices where debt_id = pg_temp.fx(p_tag || 'card') and label = p_label $f$;
grant execute on function pg_temp.fx(text), pg_temp.sqlstate_of(text), pg_temp.parcelas(uuid), pg_temp.uid(integer),
  pg_temp.mk(text, integer), pg_temp.banco(text), pg_temp.fat(text, text), pg_temp.login(uuid) to public;

insert into auth.users (id, email)
select pg_temp.uid(n), 'ef' || n || '@teste.com' from generate_series(138001, 138003) n;
create function pg_temp.parc(p_tag text, p_seq integer) returns uuid language sql as $f$
  select id from public.debt_installments where plan = pg_temp.fx(p_tag)::text and seq = p_seq $f$;
grant execute on function pg_temp.parc(text, integer) to public;

-- =====================================================================================
-- A. O caso do dono: uma já corrigida, as próximas seguem
-- =====================================================================================
select pg_temp.mk('a', 138001);
insert into fixture select 'ap', public.card_purchase(pg_temp.fx('acard'), '2026-03-01', 100.00, 4, pg_temp.fx('acat'), 'Seguro');
select is(pg_temp.parcelas(pg_temp.fx('ap')), '1:2026-03-17:25.00 2:2026-04-17:25.00 3:2026-05-17:25.00 4:2026-06-17:25.00',
          'A0 100,00 em 4x de 25,00');
select lives_ok($$select public.card_installment_edit(pg_temp.parc('ap', 2), 25.10)$$, 'A0 o dono corrige só a 2ª');
select is(public.card_installment_edit_following(pg_temp.parc('ap', 2), 25.10, 'valor da fatura'), 2,
          'A1 desta em diante a partir da 2ª (já corrigida): muda as 2 seguintes e pula a que já está certa');
select is(pg_temp.parcelas(pg_temp.fx('ap')), '1:2026-03-17:25.00 2:2026-04-17:25.10 3:2026-05-17:25.10 4:2026-06-17:25.10',
          'A1 a 1ª (anterior) não muda; 2ª, 3ª e 4ª com 25,10');
select is((select count(*)::int from public.debt_installment_edits where debt_id = pg_temp.fx('acard')), 3,
          'A1 trilha: uma linha por parcela mudada (1 + 2)');
select is((select string_agg(old_face || '>' || new_face || '|' || reason, ' ' order by i.seq)
             from public.debt_installment_edits e join public.debt_installments i on i.id = e.installment_id
            where e.debt_id = pg_temp.fx('acard') and i.seq >= 3),
          '25.00>25.10|valor da fatura 25.00>25.10|valor da fatura', 'A1 trilha com valor antigo, novo e motivo');
select is(pg_temp.sqlstate_of($$select public.card_installment_edit_following(pg_temp.parc('ap', 2), 25.10)$$),
          '22023', 'A2 nada a mudar (todas já estão no valor): recusado');
select is(pg_temp.sqlstate_of($$select public.card_installment_edit_following(pg_temp.parc('ap', 2), 0)$$),
          '22023', 'A2 valor zero: recusado');
select is(pg_temp.sqlstate_of($$select public.card_installment_edit_following(pg_temp.parc('ap', 2), 25.105)$$),
          '22003', 'A2 mais de 2 casas: recusado (regra da edição de uma parcela)');

-- A3: a partir da 1ª, já cobrada e não paga: a fatura se ajusta e o resto segue
select is(public.card_bill_due('2026-03-31'), 1, 'A3 março: 1ª parcela cobrada');
select is(public.card_installment_edit_following(pg_temp.parc('ap', 1), 26.00), 4, 'A3 desta em diante a partir da 1ª: as 4');
select is(pg_temp.parcelas(pg_temp.fx('ap')), '1:2026-03-17:26.00 2:2026-04-17:26.00 3:2026-05-17:26.00 4:2026-06-17:26.00',
          'A3 todas com 26,00');
select is((select debt from public.debt_balances(pg_temp.fx('ah'), '2026-03-31') where name = 'Cartão'), 26.00,
          'A3 dívida de março ajustada para 26,00 (sem cobrar duas vezes)');
select is(public.card_bill_due('2026-03-31'), 0, 'A3 a cobrança automática não cobra de novo');

-- =====================================================================================
-- B. Tudo ou nada: uma parcela recusada no meio desfaz as anteriores
-- =====================================================================================
reset role;
select pg_temp.mk('b', 138002);
insert into fixture select 'bp', public.card_purchase(pg_temp.fx('bcard'), '2026-03-01', 90.00, 3, pg_temp.fx('bcat'), 'Curso');
select is(public.card_bill_due('2026-04-30'), 2, 'B0 março e abril cobrados');
select lives_ok($$select public.debt_pay(pg_temp.fx('bcard'), '2026-04-25', pg_temp.fx('bbank'), 10.00, pg_temp.fat('b', '2026-04'))$$,
                'B0 abril com pagamento parcial (a 2ª parcela fica travada até reabrir)');
select is(pg_temp.sqlstate_of($$select public.card_installment_edit_following(pg_temp.parc('bp', 1), 31.00)$$),
          '55000', 'B1 a 2ª está em fatura com pagamento: recusado');
select is(pg_temp.parcelas(pg_temp.fx('bp')), '1:2026-03-17:30.00 2:2026-04-17:30.00 3:2026-05-17:30.00',
          'B1 nenhuma parcela mudou (a 1ª, que podia, voltou junto)');
select is((select count(*)::int from public.debt_installment_edits where debt_id = pg_temp.fx('bcard')), 0,
          'B1 nenhuma linha na trilha');
select is(public.card_installment_edit_following(pg_temp.parc('bp', 3), 31.00), 1, 'B2 a partir da 3ª (livre): muda só ela');

-- =====================================================================================
-- C. Acesso
-- =====================================================================================
reset role;
select pg_temp.mk('c', 138003);
select is(pg_temp.sqlstate_of($$select public.card_installment_edit_following(pg_temp.parc('ap', 1), 27.00)$$),
          '42501', 'C1 parcela de outra família: recusado');
select is(pg_temp.sqlstate_of($$select public.card_installment_edit_following(gen_random_uuid(), 27.00)$$),
          '42501', 'C1 parcela que não existe: recusado');
reset role;
select ok(not has_function_privilege('anon', 'public.card_installment_edit_following(uuid, numeric, text)', 'execute'),
          'C2 anon não executa');
select ok(has_function_privilege('authenticated', 'public.card_installment_edit_following(uuid, numeric, text)', 'execute'),
          'C2 authenticated executa');

select * from finish();
rollback;
