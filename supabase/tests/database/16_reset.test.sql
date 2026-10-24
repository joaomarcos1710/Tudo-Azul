-- 16_reset: migration 009. "Zerar tudo": só o dono, só com a frase conferida no banco, apaga os dados
-- financeiros da própria família (inclusive períodos conciliados, cartão, dívida e lixeira), mantém família,
-- membros e categorias, registra a operação e nunca toca a família de outro usuário.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create temp table fixture (k text primary key, v uuid);
create temp table fixture_txt (k text primary key, v text);
grant all on fixture, fixture_txt to public;
create function pg_temp.fx(p_k text) returns uuid language sql as $f$ select v from fixture where k = p_k $f$;
create function pg_temp.login(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $f$;
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
-- quanto sobra de dado financeiro de uma família, visto pelo chamador logado
create function pg_temp.sobra(p_h uuid) returns bigint language sql as $f$
  select (public.reset_preview(p_h) ->> 'transactions')::bigint + (public.reset_preview(p_h) ->> 'accounts')::bigint
       + (public.reset_preview(p_h) ->> 'debts')::bigint + (public.reset_preview(p_h) ->> 'installments')::bigint
       + (public.reset_preview(p_h) ->> 'events')::bigint + (public.reset_preview(p_h) ->> 'recurrences')::bigint
       + (public.reset_preview(p_h) ->> 'reconciliations')::bigint + (public.reset_preview(p_h) ->> 'budgets')::bigint $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.sqlstate_of(text), pg_temp.sobra(uuid) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000016a1', 'z1@teste.com'),
  ('00000000-0000-0000-0000-0000000016a2', 'z2@teste.com'),
  ('00000000-0000-0000-0000-0000000016a3', 'z3@teste.com');

-- ---- família H1: z1 dono, z2 membro; família H2: z3 dono ----
select pg_temp.login('00000000-0000-0000-0000-0000000016a1');
insert into fixture select 'h1', public.create_household('Casa Zerada');
insert into fixture_txt select 'tok', public.create_invitation('z2@teste.com');
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000016a2');
select public.accept_invitation((select v from fixture_txt where k = 'tok'));
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000016a3');
insert into fixture select 'h2', public.create_household('Casa Vizinha');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h2'), 'Conta Vizinha', 'checking', 700.00, '2026-10-01') returning id)
  insert into fixture select 'v_acc', id from i;
insert into fixture select 'v_cat', id from public.categories where household_id = pg_temp.fx('h2') and name = 'Compras pessoais';
insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status)
values (pg_temp.fx('h2'), pg_temp.fx('v_acc'), pg_temp.fx('v_cat'), 'expense', 'Vizinho', 12.34, '2026-10-05', 'paid');
insert into fixture select 'v_card', public.create_debt('Cartão Vizinho', 'card', '2026-10-01', 0);
reset role;

-- fixture rica de H1, montada pelas próprias RPCs como o dono
select pg_temp.login('00000000-0000-0000-0000-0000000016a1');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h1'), 'Itaú', 'checking', 1000.00, '2026-10-01') returning id)
  insert into fixture select 'itau', id from i;
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h1'), 'Poupança', 'savings', 0, '2026-10-01') returning id)
  insert into fixture select 'poup', id from i;
insert into fixture select 'cexp', id from public.categories where household_id = pg_temp.fx('h1') and name = 'Compras pessoais';
insert into fixture select 'cinc', id from public.categories where household_id = pg_temp.fx('h1') and type = 'income' and system_key is null limit 1;
-- conciliação do Itaú até 05/10 (trava o período; o zerar tem que passar por cima)
select public.reconcile_account(pg_temp.fx('itau'), '2026-10-05', 1000.00);
insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status)
values (pg_temp.fx('h1'), pg_temp.fx('itau'), pg_temp.fx('cexp'), 'expense', 'Mercado', 250.40, '2026-10-10', 'paid'),
       (pg_temp.fx('h1'), pg_temp.fx('itau'), pg_temp.fx('cinc'), 'income', 'Salário', 5000.00, '2026-10-11', 'paid'),
       (pg_temp.fx('h1'), pg_temp.fx('itau'), pg_temp.fx('cexp'), 'expense', 'Luz planejada', 180.00, '2026-10-30', 'planned');
insert into public.transactions (household_id, account_id, destination_account_id, type, description, amount, date, status)
values (pg_temp.fx('h1'), pg_temp.fx('itau'), pg_temp.fx('poup'), 'transfer', 'Guardar', 500.00, '2026-10-12', 'paid');
-- lançamento na lixeira também some
with i as (insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status)
           values (pg_temp.fx('h1'), pg_temp.fx('itau'), pg_temp.fx('cexp'), 'expense', 'Na lixeira', 9.99, '2026-10-13', 'paid') returning id)
  update public.transactions set deleted_at = now() where id = (select id from i);
-- cartão: compra parcelada, cobrança, pagamento de fatura; empréstimo com juros
insert into fixture select 'card', public.create_debt('Cartão', 'card', '2026-09-30', 0);
select public.set_card_cycle(pg_temp.fx('card'), 17, 25);
select public.card_purchase(pg_temp.fx('card'), '2026-10-02', 300.00, 3, pg_temp.fx('cexp'), 'Fone');
select public.card_bill_due('2026-10-31');
select public.debt_pay(pg_temp.fx('card'), '2026-10-25', pg_temp.fx('itau'), 100.00,
                       (select id from public.debt_invoices where debt_id = pg_temp.fx('card') and label = '2026-10'));
insert into fixture select 'loan', public.create_debt('Empréstimo', 'loan', '2026-10-01', 0);
select public.debt_loan_event(pg_temp.fx('loan'), '2026-10-08', 'disbursement', pg_temp.fx('itau'), 1000.00);
select public.debt_loan_event(pg_temp.fx('loan'), '2026-10-10', 'interest', pg_temp.fx('itau'), 10.00, pg_temp.fx('cexp'));
-- recorrência (gera lançamentos planejados ligados à regra) e orçamento
select public.recurrence_create('expense', 'Internet', 120.00, 28, '2026-10-01', pg_temp.fx('itau'), null, null, pg_temp.fx('cexp'), null);
select public.recurrence_materialize();
insert into public.budgets (household_id, category_id, month, amount_limit) values (pg_temp.fx('h1'), pg_temp.fx('cexp'), '2026-10-01', 500.00);
reset role;

-- ---- Z1: não-dono e outra família são recusados; nada some ----
select pg_temp.login('00000000-0000-0000-0000-0000000016a2');
select is(pg_temp.sqlstate_of(format($$select public.reset_household(%L, 'zerar tudo')$$, pg_temp.fx('h1'))), '42501',
          'Z1 membro que não é dono é recusado');
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000016a3');
select is(pg_temp.sqlstate_of(format($$select public.reset_household(%L, 'zerar tudo')$$, pg_temp.fx('h1'))), '42501',
          'Z2 dono de OUTRA família é recusado');
select is(pg_temp.sqlstate_of($$select public.reset_household(null, 'zerar tudo')$$), '42501', 'Z3 família nula é recusada');
reset role;
-- sem login (sem auth.uid()): recusa
select set_config('request.jwt.claims', '', true);
select is(pg_temp.sqlstate_of(format($$select public.reset_household(%L, 'zerar tudo')$$, pg_temp.fx('h1'))), '42501',
          'Z4 sem auth.uid() é recusado dentro da função');
select pg_temp.login('00000000-0000-0000-0000-0000000016a1');
select ok(pg_temp.sobra(pg_temp.fx('h1')) > 10, 'Z5 a fixture tem bastante dado antes de zerar');
-- guarda a contagem de lançamentos de antes (a recorrência gera planejados conforme a data de hoje, então não é fixa)
insert into fixture_txt select 'tx_antes', (public.reset_preview(pg_temp.fx('h1')) ->> 'transactions');

-- ---- Z6: frase errada ou vazia recusa e não apaga nada ----
select is(pg_temp.sqlstate_of(format($$select public.reset_household(%L, 'zerar')$$, pg_temp.fx('h1'))), '22023', 'Z6 frase errada: 22023');
select is(pg_temp.sqlstate_of(format($$select public.reset_household(%L, '')$$, pg_temp.fx('h1'))), '22023', 'Z7 frase vazia: 22023');
select is(pg_temp.sqlstate_of(format($$select public.reset_household(%L, null)$$, pg_temp.fx('h1'))), '22023', 'Z8 frase nula: 22023');
select ok(pg_temp.sobra(pg_temp.fx('h1')) > 10, 'Z9 frase errada não apagou nada');

-- ---- Z10: prévia mostra contagens certas ----
select is((public.reset_preview(pg_temp.fx('h1')) ->> 'accounts')::int, 2, 'Z10 prévia: 2 contas');
select is((public.reset_preview(pg_temp.fx('h1')) ->> 'debts')::int, 2, 'Z11 prévia: 2 dívidas (cartão e empréstimo)');
select is((public.reset_preview(pg_temp.fx('h1')) ->> 'reconciliations')::int, 1, 'Z12 prévia: 1 conciliação');
select is((public.reset_preview(pg_temp.fx('h1')) ->> 'installments')::int, 3, 'Z13 prévia: 3 parcelas de cartão');
select is((select count(*) from public.household_resets), 0::bigint, 'Z14 nenhum registro de zerar antes');
select is(public.reset_preview(pg_temp.fx('h2')), null, 'Z15 prévia da família alheia: nada');
select is(pg_temp.sqlstate_of(format($$select public.reset_household(%L, 'zerar tudo')$$, pg_temp.fx('h1'))), null, 'Z16 dono com a frase: roda');
-- em produção a checagem de dívida é adiada ao COMMIT; aqui o teste termina em rollback, então força o disparo agora
select is(pg_temp.sqlstate_of($$set constraints all immediate$$), null,
          'Z16b as checagens adiadas (dívida, FKs) passam depois de apagar tudo, como no commit real');
reset role;

-- ---- depois: tudo zerado, família/membros/categorias intactos, outra família intacta ----
select pg_temp.login('00000000-0000-0000-0000-0000000016a1');
select is(pg_temp.sobra(pg_temp.fx('h1')), 0::bigint, 'Z17 nada financeiro sobrou (inclusive conciliado, cartão, dívida, lixeira)');
select is((select count(*) from public.account_balances(pg_temp.fx('h1'), '2026-12-31')), 0::bigint, 'Z18 sem contas, sem saldos');
select is((select debt + credit_receivable + available + net_worth from public.net_worth(pg_temp.fx('h1'), '2026-12-31')), 0::numeric,
          'Z19 patrimônio zerado');
select ok((select count(*) from public.categories where household_id = pg_temp.fx('h1')) > 0, 'Z20 categorias ficaram');
select is((select count(*) from public.household_members where household_id = pg_temp.fx('h1')), 2::bigint, 'Z21 membros ficaram');
select is((select name from public.households where id = pg_temp.fx('h1')), 'Casa Zerada', 'Z22 a família ficou');
select is((select count(*) from public.household_resets where household_id = pg_temp.fx('h1')), 1::bigint, 'Z23 a operação foi registrada');
select is((select counts ->> 'transactions' from public.household_resets where household_id = pg_temp.fx('h1')),
          (select v from fixture_txt where k = 'tx_antes'), 'Z24 o registro guarda quantos lançamentos sumiram (os mesmos da prévia)');
select is((select counts ->> 'reconciliations' from public.household_resets where household_id = pg_temp.fx('h1')), '1', 'Z25 registro: 1 conciliação');

-- Z26: recomeça do zero, sem trava de período
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h1'), 'Itaú novo', 'checking', 321.00, '2026-10-01') returning id)
  insert into fixture select 'novo', id from i;
insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status)
values (pg_temp.fx('h1'), pg_temp.fx('novo'), pg_temp.fx('cexp'), 'expense', 'Recomeço', 21.00, '2026-10-02', 'paid');
select is((select balance from public.account_balances(pg_temp.fx('h1'), '2026-10-31') where account_id = pg_temp.fx('novo')), 300.00::numeric,
          'Z26 depois de zerar dá para cadastrar de novo, com data antiga (a trava de período sumiu junto)');

-- Z27: zerar de novo é inofensivo (e a frase aceita maiúsculas e espaços)
select is((public.reset_household(pg_temp.fx('h1'), '  ZERAR TUDO  ') ->> 'transactions')::int, 1, 'Z27 segundo zerar: apaga só o que há (1) e aceita ZERAR TUDO');
select is(pg_temp.sobra(pg_temp.fx('h1')), 0::bigint, 'Z28 zerado de novo');
select is((select count(*) from public.household_resets), 2::bigint, 'Z29 dois registros');
-- cliente não grava no registro
select is(pg_temp.sqlstate_of(format($$insert into public.household_resets (household_id, counts) values (%L, '{}')$$, pg_temp.fx('h1'))), '42501',
          'Z30 o cliente não grava em household_resets');
select is(pg_temp.sqlstate_of($$delete from public.household_resets$$), '42501', 'Z31 nem apaga o registro');
reset role;

-- a família vizinha ficou intacta
select pg_temp.login('00000000-0000-0000-0000-0000000016a3');
select is((select count(*) from public.accounts where household_id = pg_temp.fx('h2')), 1::bigint, 'Z32 família vizinha: conta intacta');
select is((select count(*) from public.transactions where household_id = pg_temp.fx('h2')), 1::bigint, 'Z33 família vizinha: lançamento intacto');
select is((select count(*) from public.debts where household_id = pg_temp.fx('h2')), 1::bigint, 'Z34 família vizinha: cartão intacto');
select is((select balance from public.account_balances(pg_temp.fx('h2'), '2026-10-31')), 687.66::numeric, 'Z35 família vizinha: saldo intacto');
select is((select count(*) from public.household_resets), 0::bigint, 'Z36 a vizinha não vê o registro da outra');
reset role;

-- anônimo
select is(has_function_privilege('anon', 'public.reset_household(uuid, text)', 'EXECUTE'), false, 'Z37 anon não executa reset_household');
select is(has_function_privilege('anon', 'public.reset_preview(uuid)', 'EXECUTE'), false, 'Z38 anon não executa reset_preview');

select * from finish();
rollback;
