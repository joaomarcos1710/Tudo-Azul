-- 80_dashboard_commitment_matrix: matriz do Dashboard sem dupla contagem e sem conversão implícita.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create temp table fixture (k text primary key, v uuid);
grant all on fixture to public;
create function pg_temp.fx(p_k text) returns uuid language sql as $f$
  select v from fixture where k = p_k
$f$;
create function pg_temp.hoje() returns date language sql as $f$
  select (now() at time zone 'America/Sao_Paulo')::date
$f$;
create function pg_temp.amanha() returns date language sql as $f$
  select pg_temp.hoje() + 1
$f$;
create function pg_temp.login(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end
$f$;
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate;
end
$f$;
grant execute on function pg_temp.fx(text), pg_temp.hoje(), pg_temp.amanha(),
  pg_temp.login(uuid), pg_temp.sqlstate_of(text) to public;

insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-0000000080a1', 'matriz-a@teste.com'),
 ('00000000-0000-0000-0000-0000000080a2', 'matriz-b@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000080a1');
insert into fixture select 'h1', public.create_household('Casa Matriz A');

insert into public.accounts (household_id, name, type, initial_balance, opening_date, currency_code)
values
  (pg_temp.fx('h1'), 'Conta corrente', 'checking', 1000, pg_temp.hoje() - 180, 'BRL'),
  (pg_temp.fx('h1'), 'Conta destino', 'checking', 100, pg_temp.hoje() - 180, 'BRL'),
  (pg_temp.fx('h1'), 'Conta em dólar', 'checking', 100, pg_temp.hoje() - 180, 'USD');
insert into fixture select 'brl', id from public.accounts where household_id = pg_temp.fx('h1') and name = 'Conta corrente';
insert into fixture select 'brl2', id from public.accounts where household_id = pg_temp.fx('h1') and name = 'Conta destino';
insert into fixture select 'usd', id from public.accounts where household_id = pg_temp.fx('h1') and name = 'Conta em dólar';
insert into fixture select 'expense', id from public.categories
 where household_id = pg_temp.fx('h1') and type = 'expense' and system_key = 'uncategorized';
insert into fixture select 'income', id from public.categories
 where household_id = pg_temp.fx('h1') and type = 'income' and system_key = 'uncategorized';

-- Lançamentos planejados de despesa entram; receitas, transferências e itens excluídos não entram.
with x as (
  insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status)
  values (pg_temp.fx('h1'), pg_temp.fx('brl'), pg_temp.fx('expense'), 'expense',
          'Conta avulsa', 80, pg_temp.amanha() + 2, 'planned')
  returning id
)
insert into fixture select 'avulsa', id from x;
insert into public.transactions (household_id, account_id, destination_account_id, category_id, type, description, amount, date, status)
values
  (pg_temp.fx('h1'), pg_temp.fx('brl'), null, pg_temp.fx('income'), 'income',
   'Receita futura', 900, pg_temp.amanha() + 3, 'planned'),
  (pg_temp.fx('h1'), pg_temp.fx('brl'), pg_temp.fx('brl2'), null, 'transfer',
   'Transferência futura', 400, pg_temp.amanha() + 4, 'planned'),
  (pg_temp.fx('h1'), pg_temp.fx('usd'), null, pg_temp.fx('expense'), 'expense',
   'Despesa em dólar', 40, pg_temp.amanha() + 5, 'planned');
with x as (
  insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status)
  values (pg_temp.fx('h1'), pg_temp.fx('brl'), pg_temp.fx('expense'), 'expense',
          'Despesa excluída', 999, pg_temp.amanha() + 6, 'planned')
  returning id
)
update public.transactions t set deleted_at = now() from x where t.id = x.id;

-- Parcelamento comum: a matriz agrupa as parcelas da mesma compra numa única linha.
select public.transaction_installments_create(
  'expense', 'Curso parcelado', 300, 3, 'month', 1, pg_temp.amanha() + 7,
  pg_temp.fx('brl'), null, pg_temp.fx('expense'), false
);

-- Regra recorrente de conta criada antes da materialização: a matriz não pode duplicar a ocorrência.
insert into fixture select 'internet', public.recurrence_create(
  'expense', 'Internet mensal', 120, extract(day from pg_temp.hoje())::integer,
  pg_temp.hoje(), pg_temp.fx('brl'), null, null, pg_temp.fx('expense'), null, 'month', 1
);

-- Cartão e assinatura futura: recurrence_materialize só cria as compras de cartão até hoje.
insert into fixture select 'card', public.create_debt('Nubank', 'card', pg_temp.hoje() - 180, 0);
select public.set_card_cycle(pg_temp.fx('card'), 17, 25);
select public.card_purchase(pg_temp.fx('card'), pg_temp.hoje(), 120, 3, pg_temp.fx('expense'), 'Notebook');
insert into fixture select 'streaming', public.recurrence_create(
  'card', 'Streaming futuro', 39.90, extract(day from pg_temp.amanha())::integer,
  pg_temp.amanha(), null, null, pg_temp.fx('card'), pg_temp.fx('expense'), null, 'month', 1
);

-- Empréstimo com boleto aparece; consignado fica fora da projeção de caixa.
insert into fixture select 'financing', public.create_debt('Financiamento', 'financing', pg_temp.hoje() - 120, 10000);
select public.debt_contract_set(
  pg_temp.fx('financing'), 'Banco teste', 'CTR-80', 6, 6, 500, 20, 'boleto', null,
  pg_temp.amanha() + 15
);
insert into fixture select 'payroll', public.create_debt('Consignado', 'loan', pg_temp.hoje() - 120, 10000);
select public.debt_contract_set(
  pg_temp.fx('payroll'), 'Banco folha', null, 6, 6, 350, 20, 'payroll', null,
  pg_temp.amanha() + 15
);

-- Gera as recorrências de conta; a assinatura futura não é materializada porque ainda não chegou a ocorrência.
select public.recurrence_materialize();

-- Outra regra é criada depois da materialização: a função privada deve completar os meses ainda não gerados.
insert into fixture select 'iptu', public.recurrence_create(
  'expense', 'IPTU ainda não materializado', 210, extract(day from pg_temp.hoje())::integer,
  pg_temp.hoje(), pg_temp.fx('brl'), null, null, pg_temp.fx('expense'), null, 'month', 1
);

-- Despesa avulsa aparece uma vez.
select is((select count(*) from public.dashboard_commitment_matrix(pg_temp.fx('h1'), pg_temp.hoje(), 6)
            where commitment_id = 'transaction:' || pg_temp.fx('avulsa')::text and row_type = 'item'),
          1::bigint, 'M1 lançamento planejado aparece uma vez');
-- Entradas, transferências e lançamentos excluídos não são despesas comprometidas.
select is((select count(*) from public.dashboard_commitment_matrix(pg_temp.fx('h1'), pg_temp.hoje(), 6)
            where description = 'Receita futura'),
          0::bigint, 'M2.1 receitas ficam fora');
select is((select count(*) from public.dashboard_commitment_matrix(pg_temp.fx('h1'), pg_temp.hoje(), 6)
            where description = 'Transferência futura'),
          0::bigint, 'M2.2 transferências ficam fora');
select is((select count(*) from public.dashboard_commitment_matrix(pg_temp.fx('h1'), pg_temp.hoje(), 6)
            where description = 'Despesa excluída'),
          0::bigint, 'M2.3 lançamentos excluídos ficam fora');
-- Conta em moeda estrangeira aparece em moeda própria, sem ser convertida em BRL.
select is((select array[currency_code, amount::text] from public.dashboard_commitment_matrix(pg_temp.fx('h1'), pg_temp.hoje(), 6)
            where description = 'Despesa em dólar' and row_type = 'item'),
          array['USD', '40.00']::text[], 'M3 valor em dólar permanece separado');
-- Parcelamento comum mantém uma única linha lógica, com as três competências.
select is((select count(distinct period_month) from public.dashboard_commitment_matrix(pg_temp.fx('h1'), pg_temp.hoje(), 6)
            where description = 'Curso parcelado' and row_type = 'item'),
          3::bigint, 'M4 compra parcelada ocupa os três meses');
select is((select count(*) from public.dashboard_commitment_matrix(pg_temp.fx('h1'), pg_temp.hoje(), 6)
            where commitment_id like 'transaction-installment:%' and description = 'Curso parcelado'),
          3::bigint, 'M4.1 parcelas permanecem agrupadas sob a mesma chave');
-- Recorrência materializada: uma ocorrência por mês, sem repetir pelo helper de pendentes.
select is((select count(*) from public.dashboard_commitment_matrix(pg_temp.fx('h1'), pg_temp.hoje(), 6)
            where commitment_id = 'account-recurrence:' || pg_temp.fx('internet')::text and row_type = 'item'),
          6::bigint, 'M5 recorrência materializada aparece uma vez por mês');
-- Regra criada depois da materialização: é recuperada pela função de ocorrências pendentes.
select is((select count(*) from public.dashboard_commitment_matrix(pg_temp.fx('h1'), pg_temp.hoje(), 6)
            where commitment_id = 'account-recurrence:' || pg_temp.fx('iptu')::text and row_type = 'item'),
          6::bigint, 'M6 recorrência ainda não materializada é projetada');
-- Compras parceladas do cartão são alocadas pelo vencimento da fatura.
select is((select count(distinct period_month) from public.dashboard_commitment_matrix(pg_temp.fx('h1'), pg_temp.hoje(), 6)
            where description = 'Notebook' and source_type = 'Cartão' and row_type = 'item'),
          3::bigint, 'M7 parcelas de cartão seguem o vencimento das faturas');
-- Assinatura futura aparece uma vez por mês, sem criar debt_installments antes da ocorrência.
select ok((select count(*) >= 5 from public.dashboard_commitment_matrix(pg_temp.fx('h1'), pg_temp.hoje(), 6)
            where commitment_id = 'card-recurrence:' || pg_temp.fx('streaming')::text and row_type = 'item'),
          'M8 assinatura futura é projetada sem antecipar sua materialização');
-- Agenda de financiamento entra, consignado não reduz o caixa.
select ok((select count(*) >= 5 from public.dashboard_commitment_matrix(pg_temp.fx('h1'), pg_temp.hoje(), 6)
            where commitment_id = 'debt-schedule:' || pg_temp.fx('financing')::text and row_type = 'item'),
          'M9 parcelas do financiamento aparecem');
select is((select count(*) from public.dashboard_commitment_matrix(pg_temp.fx('h1'), pg_temp.hoje(), 6)
            where commitment_id = 'debt-schedule:' || pg_temp.fx('payroll')::text),
          0::bigint, 'M9.1 consignado fica fora');
-- O total mensal é calculado na função e deve fechar com os itens da mesma moeda.
select is(
  (select amount from public.dashboard_commitment_matrix(pg_temp.fx('h1'), pg_temp.hoje(), 6)
    where row_type = 'total' and currency_code = 'BRL'
      and period_month = date_trunc('month', pg_temp.hoje()::timestamp)::date),
  (select sum(amount) from public.dashboard_commitment_matrix(pg_temp.fx('h1'), pg_temp.hoje(), 6)
    where row_type = 'item' and currency_code = 'BRL'
      and period_month = date_trunc('month', pg_temp.hoje()::timestamp)::date),
  'M10 total BRL confere com os itens BRL do mês');
select is((select count(*) from public.dashboard_commitment_matrix(pg_temp.fx('h1'), pg_temp.hoje(), 6)
            where row_type = 'total' and currency_code = 'USD'),
          1::bigint, 'M10.1 moeda estrangeira tem total separado');
select is(pg_temp.sqlstate_of(format(
  'select count(*) from public.dashboard_commitment_matrix(%L::uuid, pg_temp.hoje(), 2)',
  pg_temp.fx('h1'))),
  '22023', 'M11 período abaixo de três meses é recusado');

-- Família vizinha não vê os compromissos da primeira família.
select pg_temp.login('00000000-0000-0000-0000-0000000080a2');
insert into fixture select 'h2', public.create_household('Casa Matriz B');
select is((select count(*) from public.dashboard_commitment_matrix(pg_temp.fx('h1'), pg_temp.hoje(), 6)),
          0::bigint, 'M12 outra família não consulta os compromissos alheios');

select * from finish();
rollback;
