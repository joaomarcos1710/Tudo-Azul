-- 54_reset_all_tables: migration 054. O "zerar tudo" (migration 009) não conhecia as tabelas criadas depois:
-- investimentos (ativos, operações, avaliações, proventos), bens da família (com avaliações) e a agenda de parcelas
-- do contrato de dívida. A prévia passa a contá-las e o reset passa a apagá-las, sem quebrar e sem tocar a vizinha.
-- Datas relativas a hoje em São Paulo (operação, avaliação e provento pago não podem ser futuros).
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
-- linhas de cada tabela nova numa família (visto pelo chamador logado, sob RLS)
create function pg_temp.novas(p_h uuid) returns text language sql as $f$
  select concat_ws(' ',
    'ativos=' || (select count(*) from public.investment_assets where household_id = p_h),
    'operacoes=' || (select count(*) from public.investment_operations where household_id = p_h),
    'avaliacoes=' || (select count(*) from public.investment_valuations where household_id = p_h),
    'proventos=' || (select count(*) from public.investment_distributions where household_id = p_h),
    'bens=' || (select count(*) from public.family_assets where household_id = p_h),
    'avaliacoes_bens=' || (select count(*) from public.family_asset_valuations where household_id = p_h),
    'agenda=' || (select count(*) from public.debt_payment_schedule where household_id = p_h)) $f$;
-- as mesmas contagens, lidas da prévia (ou do jsonb que o reset devolve)
create function pg_temp.chaves(p jsonb) returns text language sql as $f$
  select concat_ws(' ',
    'ativos=' || coalesce(p ->> 'investment_assets', '?'),
    'operacoes=' || coalesce(p ->> 'investment_operations', '?'),
    'avaliacoes=' || coalesce(p ->> 'investment_valuations', '?'),
    'proventos=' || coalesce(p ->> 'investment_distributions', '?'),
    'bens=' || coalesce(p ->> 'family_assets', '?'),
    'avaliacoes_bens=' || coalesce(p ->> 'family_asset_valuations', '?'),
    'agenda=' || coalesce(p ->> 'schedule', '?')) $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.hoje(), pg_temp.sqlstate_of(text),
  pg_temp.novas(uuid), pg_temp.chaves(jsonb) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000054a1', 'r54a@teste.com'),
  ('00000000-0000-0000-0000-0000000054a2', 'r54b@teste.com');

-- ---- família vizinha (54a2): um ativo com operação e um bem; não pode ser tocada ----
select pg_temp.login('00000000-0000-0000-0000-0000000054a2');
insert into fixture select 'h2', public.create_household('Casa Vizinha 54');
insert into fixture select 'v_ativo', public.investment_asset_create(pg_temp.fx('h2'), 'Tesouro Vizinho', null, 'fixed_income', 'BRL');
select public.investment_operation_record(pg_temp.fx('v_ativo'), pg_temp.hoje() - 5, 'buy', 1, 1000, 0, null);
insert into fixture select 'v_bem', public.family_asset_create(
  pg_temp.fx('h2'), 'Carro vizinho', 'vehicle', null, 'BRL', 'Família', 100, pg_temp.hoje() - 30, 30000, pg_temp.hoje() - 30, 'Tabela');
reset role;

-- ---- família H (54a1, dono): investimento completo, bem com histórico, dívida com agenda de contrato paga ----
select pg_temp.login('00000000-0000-0000-0000-0000000054a1');
insert into fixture select 'h', public.create_household('Casa 54');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Corretora', 'investment', 5000, pg_temp.hoje() - 90) returning id)
  insert into fixture select 'conta', id from i;
insert into fixture select 'cat', id from public.categories where household_id = pg_temp.fx('h') and name = 'Impostos e taxas' and type = 'expense';
insert into fixture select 'fii', public.investment_asset_create(pg_temp.fx('h'), 'FII Teste', 'TSTE11', 'reit', 'BRL');
select public.investment_operation_record(pg_temp.fx('fii'), pg_temp.hoje() - 20, 'buy', 10, 100, 1, 'compra');
select public.investment_operation_record(pg_temp.fx('fii'), pg_temp.hoje() - 10, 'sell', 4, 110, 0, 'venda');
select public.investment_valuation_record(pg_temp.fx('fii'), pg_temp.hoje() - 1, 105, 'Extrato');
-- provento pago: vira receita na conta, ligada ao ativo (investment_distributions -> transactions)
select public.investment_distribution_record(pg_temp.fx('fii'), 'dividend', pg_temp.hoje() - 3, 12.34, pg_temp.fx('conta'));
-- bem com duas avaliações (a inicial e uma nova)
insert into fixture select 'bem', public.family_asset_create(
  pg_temp.fx('h'), 'Casa de praia', 'real_estate', null, 'BRL', 'Família', 50, pg_temp.hoje() - 400, 200000, pg_temp.hoje() - 400, 'Escritura');
select public.family_asset_valuation_record(pg_temp.fx('bem'), pg_temp.hoje() - 2, 210000, 'Corretor', null);
-- financiamento com agenda de contrato e a primeira parcela baixada (evento ligado à agenda)
insert into fixture select 'fin', public.create_debt('Financiamento 54', 'financing', pg_temp.hoje() - 10, 1000);
select public.debt_contract_set(pg_temp.fx('fin'), 'Banco teste', 'CTR-54', 3, 3, 100, 28, 'account_debit', pg_temp.fx('conta'), pg_temp.hoje() + 20);
select public.debt_schedule_record_payment(
  (select id from public.debt_payment_schedule where debt_id = pg_temp.fx('fin') and installment_number = 1),
  pg_temp.hoje(), pg_temp.fx('conta'), 80, 20, 0, pg_temp.fx('cat'), false);

select is(pg_temp.novas(pg_temp.fx('h')), 'ativos=1 operacoes=2 avaliacoes=1 proventos=1 bens=1 avaliacoes_bens=2 agenda=3',
          'R1 a fixture tem investimento, operações, avaliação, provento, bem com histórico e agenda de contrato');

-- ---- prévia: conta as tabelas novas ----
select is(pg_temp.chaves(public.reset_preview(pg_temp.fx('h'))),
          'ativos=1 operacoes=2 avaliacoes=1 proventos=1 bens=1 avaliacoes_bens=2 agenda=3',
          'R2 a prévia conta ativos, operações, avaliações, proventos, bens, avaliações de bens e agenda');
select is((public.reset_preview(pg_temp.fx('h')) ->> 'accounts')::int, 1, 'R3 a prévia continua contando as contas');
select is(public.reset_preview(pg_temp.fx('h2')), null, 'R4 prévia da família alheia: nada');

-- ---- segurança continua igual ----
select is(pg_temp.sqlstate_of(format($$select public.reset_household(%L, 'zerar')$$, pg_temp.fx('h'))), '22023', 'R5 frase errada: 22023');
select is(pg_temp.novas(pg_temp.fx('h')), 'ativos=1 operacoes=2 avaliacoes=1 proventos=1 bens=1 avaliacoes_bens=2 agenda=3',
          'R6 frase errada não apagou nada');
select is(pg_temp.sqlstate_of(format($$select public.reset_household(%L, 'zerar tudo')$$, pg_temp.fx('h2'))), '42501',
          'R7 dono de outra família é recusado');

-- ---- zerar: não quebra, apaga tudo e devolve as contagens ----
create temp table resultado (j jsonb);
grant all on resultado to public;
select is(pg_temp.sqlstate_of(format($$insert into resultado select public.reset_household(%L, 'zerar tudo')$$, pg_temp.fx('h'))), null,
          'R8 zerar com investimento, bem e agenda roda sem erro');
-- em produção as FKs adiadas são conferidas no COMMIT; aqui o teste termina em rollback, então força agora
select is(pg_temp.sqlstate_of($$set constraints all immediate$$), null, 'R9 as checagens adiadas passam depois de apagar tudo');
select is(pg_temp.chaves((select j from resultado)),
          'ativos=1 operacoes=2 avaliacoes=1 proventos=1 bens=1 avaliacoes_bens=2 agenda=3',
          'R10 o reset devolve quantos de cada tabela nova sumiram');
select is(pg_temp.novas(pg_temp.fx('h')), 'ativos=0 operacoes=0 avaliacoes=0 proventos=0 bens=0 avaliacoes_bens=0 agenda=0',
          'R11 nada das tabelas novas sobrou');
select is(pg_temp.chaves(public.reset_preview(pg_temp.fx('h'))),
          'ativos=0 operacoes=0 avaliacoes=0 proventos=0 bens=0 avaliacoes_bens=0 agenda=0', 'R12 a prévia depois de zerar: tudo zero');
select is((select count(*) from public.transactions where household_id = pg_temp.fx('h')), 0::bigint, 'R13 nem a receita do provento');
select is((select count(*) from public.accounts where household_id = pg_temp.fx('h')), 0::bigint, 'R14 nem a conta');
select is((select count(*) from public.debts where household_id = pg_temp.fx('h')), 0::bigint, 'R15 nem a dívida');
select is(pg_temp.chaves((select counts from public.household_resets where household_id = pg_temp.fx('h'))),
          'ativos=1 operacoes=2 avaliacoes=1 proventos=1 bens=1 avaliacoes_bens=2 agenda=3',
          'R16 o registro do zerar guarda as contagens novas');

-- R17: família só com um bem (sem conta nem lançamento) também é zerada e registrada
insert into fixture select 'bem2', public.family_asset_create(
  pg_temp.fx('h'), 'Quadro', 'collectible', null, 'BRL', 'Família', 100, null, 500, pg_temp.hoje(), 'Estimativa');
select is((public.reset_household(pg_temp.fx('h'), 'zerar tudo') ->> 'family_assets')::int, 1, 'R17 só um bem: o zerar apaga');
select is((select count(*) from public.household_resets where household_id = pg_temp.fx('h')), 2::bigint,
          'R18 e registra (o bem conta como dado a zerar)');
reset role;

-- ---- a vizinha ficou intacta ----
select pg_temp.login('00000000-0000-0000-0000-0000000054a2');
select is(pg_temp.novas(pg_temp.fx('h2')), 'ativos=1 operacoes=1 avaliacoes=0 proventos=0 bens=1 avaliacoes_bens=1 agenda=0',
          'R19 família vizinha: investimento e bem intactos');
reset role;

select * from finish();
rollback;
