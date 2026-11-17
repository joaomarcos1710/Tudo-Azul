-- 124_debt_balance_adjust: migration 132. "Corrigir saldo pelo extrato" de empréstimo/financiamento: grava só a diferença
-- (adjust_up / adjust_down), muda o saldo da dívida e nada mais (nenhuma conta, nenhuma despesa, nenhum fluxo de caixa).
-- Datas fixas no passado (outubro de 2026). A RPC nova vai por SQL dinâmico: sem a migration, as asserções falham sem abortar.
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
-- corrige o saldo; devolve o id do ajuste, 'nulo' quando nada foi gravado, ou 'ERRO <sqlstate>'
create function pg_temp.corrigir(p_k text, p_data date, p_saldo numeric) returns text language plpgsql as $f$
declare r uuid;
begin
  execute 'select public.debt_set_balance($1, $2, $3)' into r using pg_temp.fx(p_k), p_data, p_saldo;
  return coalesce(r::text, 'nulo');
exception when others then return 'ERRO ' || sqlstate;
end $f$;
create function pg_temp.divida(p_k text, p_data date default date '2026-10-31') returns numeric language sql as $f$
  select debt from public.debt_balances(pg_temp.fx('h'), p_data) where debt_id = pg_temp.fx(p_k) $f$;
create function pg_temp.contas() returns text language sql as $f$
  select string_agg(account_id::text || '=' || balance::text, ';' order by account_id)
    from public.account_balances(pg_temp.fx('h'), date '2026-10-31') $f$;
create function pg_temp.resumo() returns text language sql as $f$
  select income_paid || '|' || expense_paid || '|' || result from public.period_summary(pg_temp.fx('h'), date '2026-10-01', date '2026-10-31') $f$;
create function pg_temp.fluxo() returns text language sql as $f$
  select string_agg(total_income || '|' || total_expense || '|' || closing_balance, ';')
    from public.cash_flow_series(pg_temp.fx('h'), date '2026-10-01', date '2026-10-31', 'month') $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.sqlstate_of(text), pg_temp.corrigir(text, date, numeric),
  pg_temp.divida(text, date), pg_temp.contas(), pg_temp.resumo(), pg_temp.fluxo() to public;
create temp table antes (k text primary key, t text);
grant all on antes to public;

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000124a1', 'ajuste1@teste.com', now()),
  ('00000000-0000-0000-0000-0000000124a2', 'ajuste2@teste.com', now());

select pg_temp.login('00000000-0000-0000-0000-0000000124a1');
insert into fixture select 'h', public.create_household('Casa do Ajuste');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Corrente', 'checking', 10000, date '2026-01-01') returning id)
  insert into fixture select 'conta', id from i;
insert into fixture select 'cat', id from public.categories where household_id = pg_temp.fx('h') and name = 'Mercado';
-- consignado com saldo informado de 135.992,25 em 09/10/2026; um cartão para o caso recusado
insert into fixture select 'consig', public.create_debt('Consignado', 'loan', date '2026-10-09', 135992.25);
insert into fixture select 'cartao', public.create_debt('Cartão', 'card', date '2026-01-01', 0);
insert into public.transactions (household_id, account_id, category_id, type, amount, date, status, description)
values (pg_temp.fx('h'), pg_temp.fx('conta'), pg_temp.fx('cat'), 'expense', 150, date '2026-10-05', 'paid', 'Mercado');

select is(pg_temp.divida('consig'), 135992.25::numeric, 'F1 saldo do app: o informado no cadastro');
insert into antes values ('contas', pg_temp.contas()), ('resumo', pg_temp.resumo()), ('fluxo', pg_temp.fluxo());

-- ---------------------------------------------------------------------------
-- 1. Sobe o saldo: o banco diz 136.540,78 em 17/10 (juros dos dias corridos)
-- ---------------------------------------------------------------------------
select isnt(pg_temp.corrigir('consig', date '2026-10-17', 136540.78), null, 'A1 corrigir para 136.540,78 grava um ajuste');
select is((select kind || '|' || amount || '|' || (account_id is null) || '|' || (category_id is null) from public.debt_events
            where debt_id = pg_temp.fx('consig') and voided_at is null),
          'adjust_up|548.53|true|true', 'A2 grava só a diferença (548,53), para cima, sem conta e sem categoria');
select is(pg_temp.divida('consig', date '2026-10-16'), 135992.25::numeric, 'A3 antes da data do extrato, o saldo é o de antes');
select is(pg_temp.divida('consig'), 136540.78::numeric, 'A4 da data do extrato em diante, o saldo é o informado');
select is(pg_temp.contas(), (select t from antes where k = 'contas'), 'A5 nenhuma conta muda');
select is(pg_temp.resumo(), (select t from antes where k = 'resumo'), 'A6 receitas, despesas e resultado do mês não mudam (não é gasto)');
select is(pg_temp.fluxo(), (select t from antes where k = 'fluxo'), 'A7 o fluxo de caixa não muda');
select is((select count(*)::int from public.calendar_day_totals(pg_temp.fx('h'), date '2026-10-17', date '2026-10-17')), 0,
          'A8 o Calendário não mostra o ajuste (não é entrada nem saída)');

-- ---------------------------------------------------------------------------
-- 2. Já bate: nada é gravado; desce o saldo; anular volta
-- ---------------------------------------------------------------------------
select is(pg_temp.corrigir('consig', date '2026-10-20', 136540.78), 'nulo', 'B1 saldo já igual: nada a gravar');
select is((select count(*)::int from public.debt_events where debt_id = pg_temp.fx('consig')), 1, 'B2 continua um ajuste só');
select isnt(pg_temp.corrigir('consig', date '2026-10-25', 136000.00), null, 'B3 corrigir para baixo');
select is((select kind || '|' || amount from public.debt_events where debt_id = pg_temp.fx('consig') and date = date '2026-10-25'),
          'adjust_down|540.78', 'B4 desce a diferença (540,78)');
select is(pg_temp.divida('consig'), 136000.00::numeric, 'B5 saldo é o novo informado');
select lives_ok(format($$select public.debt_void(%L, 'lancei errado')$$,
                       (select id from public.debt_events where debt_id = pg_temp.fx('consig') and date = date '2026-10-25')),
                'B6 o ajuste pode ser anulado');
select is(pg_temp.divida('consig'), 136540.78::numeric, 'B7 anulado, volta ao saldo de antes dele');
select isnt(pg_temp.corrigir('consig', date '2026-10-26', 0), null, 'B8 saldo zero é aceito (dívida quitada pelo extrato)');
select is(pg_temp.divida('consig'), 0::numeric, 'B9 saldo zero');

-- ---------------------------------------------------------------------------
-- 2b. Ordem (achado do revisor): correção anterior à última é recusada; na mesma data, acerta por cima;
--     movimento com data anterior à última correção é recusado (o extrato já o contava)
-- ---------------------------------------------------------------------------
-- a última correção não anulada agora é a de 26/10 (saldo 0); antes dela, nada passa
select is(pg_temp.corrigir('consig', date '2026-10-17', 136540.78), 'ERRO 22023', 'O1 correção ANTES da última: recusada (desmontaria o saldo da mais nova)');
select is(pg_temp.divida('consig'), 0::numeric, 'O2 o saldo da correção mais nova continua o do extrato');
select isnt(pg_temp.corrigir('consig', date '2026-10-26', 1000.00), null, 'O3 na MESMA data: corrige por cima (conserta valor digitado errado)');
select is(pg_temp.divida('consig'), 1000.00::numeric, 'O4 o saldo é o último informado');
select is(pg_temp.sqlstate_of(format($$select public.debt_record_payment(%L, date '2026-10-20', %L, 100)$$, pg_temp.fx('consig'), pg_temp.fx('conta'))),
          '23514', 'O5 pagamento com data ANTES da última correção: recusado (contaria duas vezes)');
select lives_ok(format($$select public.debt_record_payment(%L, date '2026-10-27', %L, 100)$$, pg_temp.fx('consig'), pg_temp.fx('conta')),
                'O6 pagamento depois da correção: passa');
select is(pg_temp.divida('consig'), 900.00::numeric, 'O7 e reduz o saldo corrigido');
select is(pg_temp.sqlstate_of(format($$select public.debt_record_payment(%L, date '2026-10-28', %L, 5000)$$, pg_temp.fx('consig'), pg_temp.fx('conta'))),
          '23514', 'O8 pagamento acima do saldo corrigido: recusado (debt_chk enxerga o ajuste)');

-- financiamento também; data de hoje é aceita; arquivada é recusada
insert into fixture select 'fin', public.create_debt('Financiamento', 'financing', date '2026-10-01', 5000);
select isnt(pg_temp.corrigir('fin', ((now() at time zone 'America/Sao_Paulo')::date), 5100.00), null, 'O9 financiamento, com a data de hoje: aceito');
select is(pg_temp.divida('fin', ((now() at time zone 'America/Sao_Paulo')::date)), 5100.00::numeric, 'O10 saldo do financiamento corrigido');
insert into fixture select 'zerada', public.create_debt('Zerada', 'loan', date '2026-10-01', 0);
select public.debt_archive(pg_temp.fx('zerada'));
select is(pg_temp.corrigir('zerada', date '2026-10-17', 5000), 'ERRO 55000', 'O11 dívida arquivada: recusada');
-- o patrimônio enxerga o ajuste (net_worth lê o saldo da dívida)
select is((select debt from public.net_worth(pg_temp.fx('h'), date '2026-10-31')),
          (select sum(debt) from public.debt_balances(pg_temp.fx('h'), date '2026-10-31')),
          'O12 o patrimônio usa o saldo corrigido');

-- ---------------------------------------------------------------------------
-- 3. Recusas, privilégios e isolamento
-- ---------------------------------------------------------------------------
select is(pg_temp.corrigir('cartao', date '2026-10-17', 100), 'ERRO 23514', 'V1 cartão: recusado (o saldo do cartão é a soma das faturas)');
select is(pg_temp.corrigir('consig', ((now() at time zone 'America/Sao_Paulo')::date + 1), 100), 'ERRO 22023', 'V2 data no futuro: recusada');
select is(pg_temp.corrigir('consig', date '2026-10-09', 100), 'ERRO 22023', 'V3 na data do cadastro (ou antes): recusada');
select is(pg_temp.corrigir('consig', date '2026-10-27', -1), 'ERRO 22023', 'V4 saldo negativo: recusado');
select is(pg_temp.corrigir('consig', date '2026-10-27', 1.005), 'ERRO 22003', 'V5 mais de 2 casas: recusado (22003, como o resto do banco)');
select is(pg_temp.sqlstate_of(format($$insert into public.debt_events (household_id, debt_id, date, kind, amount)
            values (%L, %L, date '2026-10-28', 'adjust_up', 1)$$, pg_temp.fx('h'), pg_temp.fx('consig'))),
          '42501', 'V6a ninguém grava ajuste direto na tabela: só pela RPC');
-- a forma (como dono do banco, que passa a RLS): ajuste com conta é recusado
reset role;
select is(pg_temp.sqlstate_of(format($$insert into public.debt_events (household_id, debt_id, date, kind, amount, account_id)
            values (%L, %L, date '2026-10-28', 'adjust_up', 1, %L)$$, pg_temp.fx('h'), pg_temp.fx('consig'), pg_temp.fx('conta'))),
          '23514', 'V6b ajuste com conta: a forma recusa');
select pg_temp.login('00000000-0000-0000-0000-0000000124a1');
select ok(not has_function_privilege('anon', 'public.debt_set_balance(uuid, date, numeric)', 'EXECUTE'), 'V7 anon sem EXECUTE');
select ok(has_function_privilege('authenticated', 'public.debt_set_balance(uuid, date, numeric)', 'EXECUTE'), 'V8 authenticated com EXECUTE');

select pg_temp.login('00000000-0000-0000-0000-0000000124a2');
select public.create_household('Outra casa');
select is(pg_temp.corrigir('consig', date '2026-10-27', 1), 'ERRO 42501', 'S1 outra família não corrige a dívida de outra casa');

select * from finish();
rollback;
