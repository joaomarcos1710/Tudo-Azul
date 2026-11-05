-- 63_recurrence_summary: migration 063. Resumo dos recorrentes por meio (conta/cartão), conta/cartão, tipo e frequência,
-- com o total por ocorrência e o equivalente mensal (round(x, 2) por regra, depois soma). Só regras ativas e sem data
-- final passada, só reais (conta USD fora), transferência à parte, família vizinha isolada. As datas finais são relativas
-- a hoje em São Paulo; os inícios são futuros (2030), então nada é materializado. Sem dado real.
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
create function pg_temp.hoje() returns date language sql stable as $f$ select (now() at time zone 'America/Sao_Paulo')::date $f$;
-- a função nova vai por SQL dinâmico: sem a migration ela não existe e o teste falha nas asserções, sem abortar o arquivo.
-- Devolve "qtde|por ocorrência|por mês" da linha pedida (meio/alvo/tipo/frequência nulos = não filtra), ou 'nenhum'.
create function pg_temp.linha(p_h uuid, p_level text, p_medium text, p_kind text, p_freq text default null, p_target uuid default null)
returns text language plpgsql as $f$
declare r text;
begin
  execute 'select string_agg(x.item_count || ''|'' || x.total_per_occurrence::numeric(14,2) || ''|'' || x.total_monthly::numeric(14,2), '';'')
             from public.recurrence_summary($1) x
            where x.grouping_level = $2 and x.medium is not distinct from $3 and x.kind = $4
              and ($5 is null or x.frequency = $5) and ($6 is null or x.target_id = $6)'
    into r using p_h, p_level, p_medium, p_kind, p_freq, p_target;
  return coalesce(r, 'nenhum');
exception when others then return 'erro: ' || sqlerrm;
end $f$;
create function pg_temp.qtde(p_h uuid) returns text language plpgsql as $f$
declare r text;
begin
  execute 'select count(*)::text from public.recurrence_summary($1)' into r using p_h;
  return r;
exception when others then return 'erro: ' || sqlerrm;
end $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.hoje(), pg_temp.linha(uuid, text, text, text, text, uuid),
  pg_temp.qtde(uuid) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000063a1', 'resumo-a@teste.com'),
  ('00000000-0000-0000-0000-0000000063a2', 'resumo-b@teste.com');

-- família vizinha: um recorrente que nunca pode aparecer na família de teste
select pg_temp.login('00000000-0000-0000-0000-0000000063a2');
insert into fixture select 'h2', public.create_household('Casa vizinha');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h2'), 'Corrente vizinha', 'checking', 0, '2026-01-01') returning id)
  insert into fixture select 'c2', id from i;
select public.recurrence_create('expense', 'Da vizinha', 777.00, 5, '2030-01-05', pg_temp.fx('c2'), null, null,
  (select id from public.categories where household_id = pg_temp.fx('h2') and type = 'expense' and system_key = 'uncategorized'));

select pg_temp.login('00000000-0000-0000-0000-0000000063a1');
insert into fixture select 'h', public.create_household('Casa Resumo');
insert into public.accounts (household_id, name, type, initial_balance, opening_date, currency_code) values
  (pg_temp.fx('h'), 'Corrente', 'checking', 0, '2026-01-01', 'BRL'),
  (pg_temp.fx('h'), 'Poupança', 'checking', 0, '2026-01-01', 'BRL'),
  (pg_temp.fx('h'), 'Conta em dólar', 'checking', 0, '2026-01-01', 'USD');
insert into fixture select 'cc', id from public.accounts where household_id = pg_temp.fx('h') and name = 'Corrente';
insert into fixture select 'pp', id from public.accounts where household_id = pg_temp.fx('h') and name = 'Poupança';
insert into fixture select 'usd', id from public.accounts where household_id = pg_temp.fx('h') and name = 'Conta em dólar';
insert into fixture select 'cexp', id from public.categories where household_id = pg_temp.fx('h') and type = 'expense' and system_key = 'uncategorized';
insert into fixture select 'cinc', id from public.categories where household_id = pg_temp.fx('h') and type = 'income' and system_key = 'uncategorized';
insert into fixture select 'card', public.create_debt('Cartão Teste', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('card'), 10, 20);

-- 0. sem recorrentes: nenhuma linha
select is(pg_temp.qtde(pg_temp.fx('h')), '0', 'R0 sem recorrentes: nenhuma linha');

-- despesas em conta (todas na Corrente)
select public.recurrence_create('expense', 'Aluguel', 1000.00, 5, '2030-01-05', pg_temp.fx('cc'), null, null, pg_temp.fx('cexp'));
select public.recurrence_create('expense', 'Seguro anual', 1200.00, 10, '2030-03-10', pg_temp.fx('cc'), null, null, pg_temp.fx('cexp'), null, 'month', 12);
select public.recurrence_create('expense', 'Faxina', 150.00, null, '2030-01-02', pg_temp.fx('cc'), null, null, pg_temp.fx('cexp'), null, 'week', 1);
select public.recurrence_create('expense', 'IPTU', 300.00, 15, '2030-01-15', pg_temp.fx('cc'), null, null, pg_temp.fx('cexp'), null, 'month', 2);
select public.recurrence_create('expense', 'Tri A', 100.00, 1, '2030-01-01', pg_temp.fx('cc'), null, null, pg_temp.fx('cexp'), null, 'month', 3);
select public.recurrence_create('expense', 'Tri B', 100.00, 2, '2030-01-02', pg_temp.fx('cc'), null, null, pg_temp.fx('cexp'), null, 'month', 3);
select public.recurrence_create('expense', 'Tri C', 100.00, 3, '2030-01-03', pg_temp.fx('cc'), null, null, pg_temp.fx('cexp'), null, 'month', 3);
select public.recurrence_create('expense', 'Padaria', 10.00, null, '2030-01-01', pg_temp.fx('cc'), null, null, pg_temp.fx('cexp'), null, 'day', 1);
select public.recurrence_create('expense', 'A cada 4 meses', 80.00, 7, '2030-01-07', pg_temp.fx('cc'), null, null, pg_temp.fx('cexp'), null, 'month', 4);
-- encerrada (data final ontem): fora. Termina hoje: dentro.
select public.recurrence_create('expense', 'Termina hoje', 30.00, 1, '2026-01-01', pg_temp.fx('cc'), null, null, pg_temp.fx('cexp'), pg_temp.hoje());
select public.recurrence_create('expense', 'Encerrada', 999.00, 1, '2026-01-01', pg_temp.fx('cc'), null, null, pg_temp.fx('cexp'), pg_temp.hoje() - 1);
-- inativa (active = false, como um legado antes da migration 031): fora
insert into fixture select 'inativa', public.recurrence_create('expense', 'Inativa', 555.00, 1, '2030-01-01', pg_temp.fx('cc'), null, null, pg_temp.fx('cexp'));
reset role;
update public.recurrences set active = false where id = pg_temp.fx('inativa');
select pg_temp.login('00000000-0000-0000-0000-0000000063a1');
-- conta em dólar: fora dos totais em reais
select public.recurrence_create('expense', 'Em dólar', 40.00, 5, '2030-01-05', pg_temp.fx('usd'), null, null, pg_temp.fx('cexp'));
-- receita, transferência e cartão
select public.recurrence_create('income', 'Salário', 5000.00, 5, '2030-01-05', pg_temp.fx('pp'), null, null, pg_temp.fx('cinc'));
select public.recurrence_create('transfer', 'Reserva', 200.00, 6, '2030-01-06', pg_temp.fx('cc'), pg_temp.fx('pp'));
select public.recurrence_create('card', 'Streaming', 55.90, 15, '2030-01-15', null, null, pg_temp.fx('card'), pg_temp.fx('cexp'));
select public.recurrence_create('card', 'Antivírus', 120.00, 20, '2030-02-20', null, null, pg_temp.fx('card'), pg_temp.fx('cexp'), null, 'month', 12);

-- 1. totais por meio/tipo (cartões do topo)
-- conta/despesa por ocorrência: 1000 + 1200 + 150 + 300 + 3×100 + 10 + 80 + 30 = 3070,00
-- por mês: 1000 + 1200/12 (100,00) + 150×52/12 (650,00) + 300/2 (150,00) + 3×33,33 (99,99) + 10×365/12 (304,17) + 80/4 (20,00) + 30
--        = 2354,16
select is(pg_temp.linha(pg_temp.fx('h'), 'medium', 'account', 'expense'), '10|3070.00|2354.16',
  'R1 conta/saídas: 10 regras, por ocorrência e equivalente mensal (encerrada, inativa e USD fora)');
select is(pg_temp.linha(pg_temp.fx('h'), 'medium', 'account', 'income'), '1|5000.00|5000.00', 'R2 conta/entradas: o salário');
select is(pg_temp.linha(pg_temp.fx('h'), 'medium', 'card', 'expense'), '2|175.90|65.90',
  'R3 cartão/saídas: 55,90 mensal + 120,00 anual (10,00 por mês)');
select is(pg_temp.linha(pg_temp.fx('h'), 'medium', 'account', 'transfer'), '1|200.00|200.00',
  'R4 transferência é linha própria (tipo transfer), fora das saídas');
select is(pg_temp.linha(pg_temp.fx('h'), 'medium', 'card', 'income'), 'nenhum', 'R5 cartão nunca tem entrada recorrente');

-- 2. equivalente mensal por frequência (aba Conta)
select is(pg_temp.linha(pg_temp.fx('h'), 'frequency', 'account', 'expense', 'monthly'), '2|1030.00|1030.00', 'R6 mensal = valor');
select is(pg_temp.linha(pg_temp.fx('h'), 'frequency', 'account', 'expense', 'yearly'), '1|1200.00|100.00', 'R7 anual = valor/12');
select is(pg_temp.linha(pg_temp.fx('h'), 'frequency', 'account', 'expense', 'weekly'), '1|150.00|650.00', 'R8 semanal = valor×52/12');
select is(pg_temp.linha(pg_temp.fx('h'), 'frequency', 'account', 'expense', 'bimonthly'), '1|300.00|150.00', 'R9 a cada 2 meses = valor/2');
select is(pg_temp.linha(pg_temp.fx('h'), 'frequency', 'account', 'expense', 'quarterly'), '3|300.00|99.99',
  'R10 arredondamento por regra: 3 × round(100/3, 2) = 99,99 (não 100,00)');
select is(pg_temp.linha(pg_temp.fx('h'), 'frequency', 'account', 'expense', 'daily'), '1|10.00|304.17', 'R11 diária = valor×365/12, round 2');
select is(pg_temp.linha(pg_temp.fx('h'), 'frequency', 'account', 'expense', 'custom'), '1|80.00|20.00', 'R12 a cada 4 meses = personalizada, valor/4');

-- 3. aba Todos (meio nulo): mensal junta conta e cartão
select is(pg_temp.linha(pg_temp.fx('h'), 'frequency_all', null, 'expense', 'monthly'), '3|1085.90|1085.90',
  'R13 aba Todos: mensais de conta + cartão (Aluguel, Termina hoje, Streaming)');
select is(pg_temp.linha(pg_temp.fx('h'), 'frequency_all', null, 'expense', 'yearly'), '2|1320.00|110.00',
  'R14 aba Todos: anuais de conta + cartão');

-- 4. por conta / por cartão
select is(pg_temp.linha(pg_temp.fx('h'), 'target', 'card', 'expense', null, pg_temp.fx('card')), '2|175.90|65.90', 'R15 por cartão');
select is(pg_temp.linha(pg_temp.fx('h'), 'target', 'account', 'expense', null, pg_temp.fx('cc')), '10|3070.00|2354.16', 'R16 por conta (Corrente)');
select is(pg_temp.linha(pg_temp.fx('h'), 'target', 'account', 'expense', null, pg_temp.fx('usd')), 'nenhum', 'R17 conta USD não aparece');
select is((select string_agg(x.target_name, ',') from public.recurrence_summary(pg_temp.fx('h')) x
            where x.grouping_level = 'target' and x.medium = 'card'), 'Cartão Teste', 'R18 nome do cartão vem do banco');
select is(pg_temp.linha(pg_temp.fx('h'), 'detail', 'account', 'expense', 'weekly', pg_temp.fx('cc')), '1|150.00|650.00',
  'R19 linha mais fina: conta + tipo + frequência');

-- 5. isolamento entre famílias
select is(pg_temp.qtde(pg_temp.fx('h2')), '0', 'R20 a família vizinha não aparece para quem não é membro (is_member)');
select pg_temp.login('00000000-0000-0000-0000-0000000063a2');
select is(pg_temp.linha(pg_temp.fx('h2'), 'medium', 'account', 'expense'), '1|777.00|777.00', 'R21 a vizinha vê só o dela');
select is(pg_temp.qtde(pg_temp.fx('h')), '0', 'R22 e não vê a família de teste');

-- 6. segurança
reset role;
select ok(not (select p.prosecdef from pg_proc p where p.oid = 'public.recurrence_summary(uuid)'::regprocedure), 'R23 SECURITY INVOKER');
select ok(not has_function_privilege('anon', 'public.recurrence_summary(uuid)', 'EXECUTE'), 'R24 anon não executa');

select * from finish();
rollback;
