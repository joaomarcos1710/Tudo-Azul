-- 101_investment_contributions: migration 107 (20261110160000_investment_contributions.sql). Pedido do dono de 10/11/2026:
-- mostrar quanto já entrou, quanto já saiu e quanto rendeu no total em cada investimento, contando o que já foi resgatado.
--   public.investment_contributions(p_household, p_as_of) → level, asset_id, currency_code, contributed, redeemed,
--   net_contributed, market_value, total_result (uma linha por ativo com posição aberta e uma por moeda).
-- O que este arquivo prova:
--   • o caso do dono (pôs 1.000, passou a valer 1.100, tirou 550): 1.000 aportados, 550 resgatados, 450 líquidos, 550 de
--     valor e 100 de rendimento, onde investment_totals mostra custo 500 e resultado 50;
--   • em toda linha, de todo cenário e em toda data: market_value = net_contributed + total_result e net_contributed =
--     contributed − redeemed, no centavo; a linha 'total' de cada moeda = soma dos ativos = investment_totals.market_value;
--   • contributed e redeemed são exatamente o que saiu e voltou da conta (operação com conta, com tarifas);
--   • operação anulada, data de corte, ativo zerado/arquivado/sem operação, duas moedas e proventos;
--   • ninguém lê dado de outra família, anon não executa, e chamar a função não altera nada.
-- pg_temp.confere(família, data) faz a conferência inteira das identidades e devolve "ok <ativos>+<totais>"; a contagem
-- vai no texto esperado para nenhuma conferência passar sem linha nenhuma.
-- Dados inventados; datas relativas a hoje em São Paulo (as RPCs de operação e avaliação recusam data futura):
-- pg_temp.dia(n) = n dias atrás. Cada operação de um mesmo ativo fica numa data diferente: dentro de uma transação só,
-- created_at é igual para todas as linhas e a ordem das operações do mesmo dia ficaria por conta do id.
-- Os nomes dos ativos começam cada um com uma letra maiúscula diferente e sem acento: a função ordena pelo nome, e a
-- ordem de nomes com acento muda conforme o idioma do banco (local C.UTF-8; no CI pode ser outro).
-- Linhas marcadas [documentado] registram um comportamento que é limite conhecido, não um acerto a defender.
-- Sem a migration este arquivo falha: F1 a F10 dão "not ok" e o resto vira erro (a função não existe).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create temp table fixture (k text primary key, v uuid);
grant all on fixture to public;
create temp table foto (k text primary key, v text);
grant all on foto to public;
create temp table num (k text primary key, v numeric);
grant all on num to public;
create temp table fuzz_passos (i integer primary key, tipo text, descricao text, erro text);
grant all on fuzz_passos to public;

create function pg_temp.fx(p_k text) returns uuid language sql as $f$ select v from fixture where k = p_k $f$;
create function pg_temp.n(p_k text) returns numeric language sql as $f$ select v from num where k = p_k $f$;
create function pg_temp.login(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $f$;
create function pg_temp.hoje() returns date language sql as $f$ select (now() at time zone 'America/Sao_Paulo')::date $f$;
-- n dias atrás (negativo = no futuro)
create function pg_temp.dia(p_n integer) returns date language sql as $f$ select pg_temp.hoje() - p_n $f$;
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
create function pg_temp.erro_de(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate || '|' || sqlerrm; end $f$;
create function pg_temp.novo(p_k text, p_nome text, p_classe text default 'fixed_income', p_moeda text default 'BRL') returns void language sql as $f$
  insert into fixture select p_k, public.investment_asset_create(pg_temp.fx('h'), p_nome, null, p_classe, p_moeda) $f$;
-- saldo de hoje de uma conta da família 1
create function pg_temp.saldo(p_k text) returns numeric language sql as $f$
  select b.balance from public.account_balances(pg_temp.fx('h'), pg_temp.hoje()) b where b.account_id = pg_temp.fx(p_k) $f$;
-- a posição de um ativo da família 1 em investment_portfolio: "quantidade|custo|valor|resultado não realizado"
create function pg_temp.pos(p_k text, p_dia date) returns text language sql as $f$
  select concat_ws('|', p.quantity, p.cost_basis, p.market_value, p.unrealized_result)
    from public.investment_portfolio(pg_temp.fx('h'), p_dia) p where p.asset_id = pg_temp.fx(p_k) $f$;
create function pg_temp.custo(p_k text) returns numeric language sql as $f$
  select p.cost_basis from public.investment_portfolio(pg_temp.fx('h'), pg_temp.hoje()) p where p.asset_id = pg_temp.fx(p_k) $f$;
-- unidades em carteira pelo razão (compras − vendas, sem as anuladas)
create function pg_temp.qtd(p_k text) returns numeric language sql as $f$
  select coalesce(sum(case when kind = 'buy' then quantity else -quantity end), 0)
    from public.investment_operations where asset_id = pg_temp.fx(p_k) and voided_at is null $f$;
-- a transferência de uma operação: tipo, situação, sentido, valor, fora da lixeira
create function pg_temp.transf(p_op text) returns text language sql as $f$
  select concat_ws('|', t.type, t.status,
           case when t.account_id = pg_temp.fx('cc') then 'saiu da conta'
                when t.destination_account_id = pg_temp.fx('cc') then 'voltou para a conta' else 'outro' end,
           t.amount, t.deleted_at is null)
    from public.investment_operations o join public.transactions t on t.id = o.transaction_id
   where o.id = pg_temp.fx(p_op) $f$;
-- o retorno inteiro de uma função (família, data) como texto, para comparar antes e depois
create function pg_temp.retrato(p_fn text, p_h uuid, p_dia date) returns text language plpgsql as $f$
declare v text;
begin
  execute format('select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), ''[]''::jsonb)::text from public.%I($1, $2) x', p_fn)
    into v using p_h, p_dia;
  return v;
end $f$;
-- tudo o que as funções de investimento gravam, de todas as famílias (só faz sentido como superusuário, sem RLS)
create function pg_temp.dados() returns text language sql as $f$
  select md5(concat_ws('#',
    (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]')::text from public.investment_assets x),
    (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]')::text from public.investment_operations x),
    (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]')::text from public.investment_valuations x),
    (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]')::text from public.investment_distributions x),
    (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]')::text from public.transactions x),
    (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]')::text from public.accounts x))) $f$;
-- sorteio determinístico (md5 do passo): inteiro de 0 a p_n − 1, igual em qualquer máquina
create function pg_temp.sorteio(p_i integer, p_j integer, p_n bigint) returns bigint language sql immutable as $f$
  select (('x' || substr(md5('tudo-azul-107:' || p_i || ':' || p_j), 1, 8))::bit(32)::bigint) % p_n $f$;
grant execute on all functions in schema pg_temp to public;

-- ---- F: forma e permissões (sem a migration, F1 a F10 dão "not ok" sem erro; o resto do arquivo vira erro) ----
select has_function('public', 'investment_contributions', array['uuid', 'date'], 'F1 existe investment_contributions(uuid, date)');
select is((select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'investment_contributions'), 1::bigint,
          'F2 com uma assinatura só (sem sobrecarga)');
select is((select pg_get_function_arguments(p.oid) from pg_proc p where p.oid = to_regprocedure('public.investment_contributions(uuid, date)')),
          'p_household uuid, p_as_of date', 'F3 parâmetros: p_household uuid, p_as_of date');
select is((select pg_get_function_result(p.oid) from pg_proc p where p.oid = to_regprocedure('public.investment_contributions(uuid, date)')),
          'TABLE(level text, asset_id uuid, currency_code text, contributed numeric, redeemed numeric, net_contributed numeric, market_value numeric, total_result numeric)',
          'F4 colunas e tipos do retorno');
select is((select p.prosecdef from pg_proc p where p.oid = to_regprocedure('public.investment_contributions(uuid, date)')), false,
          'F5 é SECURITY INVOKER (vale a RLS de quem chama)');
select is((select p.proconfig::text from pg_proc p where p.oid = to_regprocedure('public.investment_contributions(uuid, date)')),
          '{"search_path=\"\""}', 'F6 search_path vazio');
select is((select p.provolatile::text || '|' || l.lanname from pg_proc p join pg_language l on l.oid = p.prolang
            where p.oid = to_regprocedure('public.investment_contributions(uuid, date)')),
          's|sql', 'F7 é SQL e STABLE (o Postgres não deixa função STABLE gravar)');
select is(has_function_privilege('anon', to_regprocedure('public.investment_contributions(uuid, date)'), 'EXECUTE'), false, 'F8 anon não executa');
select is(has_function_privilege('authenticated', to_regprocedure('public.investment_contributions(uuid, date)'), 'EXECUTE'), true, 'F9 authenticated executa');
select is((select p.proacl is not null
                  and not exists (select 1 from aclexplode(p.proacl) x where x.grantee = 0 and x.privilege_type = 'EXECUTE')
             from pg_proc p where p.oid = to_regprocedure('public.investment_contributions(uuid, date)')), true,
          'F10 PUBLIC não executa');
select ok(not has_table_privilege('authenticated', 'public.investment_operations', 'INSERT')
          and not has_table_privilege('authenticated', 'public.investment_operations', 'UPDATE')
          and not has_table_privilege('authenticated', 'public.investment_operations', 'DELETE')
          and not has_table_privilege('authenticated', 'public.investment_valuations', 'INSERT'),
          'F11 o cliente continua sem escrever direto em operações e avaliações (a migration não cria tabela nem grant)');

-- helpers que dependem da função nova
-- a linha de um ativo da família 1: "aportado|resgatado|líquido|valor|rendimento" (nulo = o ativo não tem linha)
create function pg_temp.lin(p_k text, p_dia date) returns text language sql as $f$
  select concat_ws('|', c.contributed::numeric(20,2), c.redeemed::numeric(20,2), c.net_contributed::numeric(20,2),
                        c.market_value::numeric(20,2), c.total_result::numeric(20,2))
    from public.investment_contributions(pg_temp.fx('h'), p_dia) c
   where c.level = 'asset' and c.asset_id = pg_temp.fx(p_k) $f$;
-- a linha 'total' de uma moeda, no mesmo formato
create function pg_temp.tot(p_h uuid, p_moeda text, p_dia date) returns text language sql as $f$
  select concat_ws('|', c.contributed::numeric(20,2), c.redeemed::numeric(20,2), c.net_contributed::numeric(20,2),
                        c.market_value::numeric(20,2), c.total_result::numeric(20,2))
    from public.investment_contributions(p_h, p_dia) c
   where c.level = 'total' and c.currency_code = p_moeda $f$;
-- o retorno inteiro, NA ORDEM em que a função devolve: "nível|ativo|moeda|aportado|resgatado|líquido|valor|rendimento;…"
-- (o ativo aparece pela chave da fixture; a linha total, com "-")
create function pg_temp.tudo(p_h uuid, p_dia date) returns text language sql as $f$
  select coalesce(string_agg(concat_ws('|', c.level, case when c.level = 'total' and c.asset_id is null then '-' else coalesce(f.k, '?') end,
                                       c.currency_code, c.contributed::numeric(20,2), c.redeemed::numeric(20,2),
                                       c.net_contributed::numeric(20,2), c.market_value::numeric(20,2), c.total_result::numeric(20,2)),
                             ';' order by c.ord), '(nenhuma linha)')
    from public.investment_contributions(p_h, p_dia)
           with ordinality as c(level, asset_id, currency_code, contributed, redeemed, net_contributed, market_value, total_result, ord)
    left join fixture f on f.v = c.asset_id $f$;
-- A conferência inteira das identidades numa data. Devolve "ok <linhas de ativo>+<linhas de total>" ou a lista do que falhou.
--   1. forma: nível 'asset' com asset_id ou 'total' sem; nenhuma coluna nula; nenhum valor com mais de 2 casas;
--   2. em toda linha: market_value = net_contributed + total_result e net_contributed = contributed − redeemed;
--   3. as linhas de ativo são exatamente as de investment_portfolio, com a mesma moeda e o mesmo market_value;
--   4. em cada moeda há uma linha total, igual à soma dos ativos nas cinco colunas, e o market_value dela é o de investment_totals;
--   5. contributed e redeemed de cada ativo = soma independente feita aqui sobre investment_operations: o valor da
--      transferência quando a operação passou por uma conta; senão, quantidade × preço ± tarifas em centavos.
create function pg_temp.confere(p_h uuid, p_dia date) returns text language sql as $f$
  with c as materialized (select * from public.investment_contributions(p_h, p_dia)),
  p as materialized (select * from public.investment_portfolio(p_h, p_dia)),
  t as materialized (select * from public.investment_totals(p_h, p_dia)),
  o as materialized (
    select op.asset_id,
           coalesce(sum(coalesce(tx.amount, round(op.quantity * op.unit_price + op.fees, 2))) filter (where op.kind = 'buy'), 0) as contributed,
           coalesce(sum(coalesce(tx.amount, round(op.quantity * op.unit_price - op.fees, 2))) filter (where op.kind = 'sell'), 0) as redeemed
      from public.investment_operations op
      left join public.transactions tx on tx.id = op.transaction_id and tx.deleted_at is null
     where op.household_id = p_h and op.operation_date <= p_dia and op.voided_at is null
     group by op.asset_id),
  a as (select * from c where level = 'asset'),
  g as (select * from c where level = 'total'),
  s as (select currency_code, sum(contributed) as contributed, sum(redeemed) as redeemed, sum(net_contributed) as net_contributed,
               sum(market_value) as market_value, sum(total_result) as total_result
          from a group by currency_code),
  problemas(msg) as (
    select 'nível ou asset_id fora do combinado' from c
     where level is null or level not in ('asset', 'total') or (level = 'asset') is distinct from (asset_id is not null)
    union all
    select 'coluna nula' from c
     where currency_code is null or contributed is null or redeemed is null or net_contributed is null
        or market_value is null or total_result is null
    union all
    select 'valor com mais de 2 casas' from c
     where contributed <> round(contributed, 2) or redeemed <> round(redeemed, 2) or net_contributed <> round(net_contributed, 2)
        or market_value <> round(market_value, 2) or total_result <> round(total_result, 2)
    union all
    select 'market_value <> net_contributed + total_result' from c where market_value is distinct from net_contributed + total_result
    union all
    select 'net_contributed <> contributed - redeemed' from c where net_contributed is distinct from contributed - redeemed
    union all
    select 'ativo com mais de uma linha' from a group by asset_id having count(*) > 1
    union all
    select 'moeda com mais de uma linha total' from g group by currency_code having count(*) > 1
    union all
    select 'linhas de ativo diferentes de investment_portfolio' from a full join p on p.asset_id = a.asset_id
     where a.asset_id is null or p.asset_id is null or a.currency_code is distinct from p.currency_code
        or a.market_value is distinct from p.market_value
    union all
    select 'linha total diferente da soma dos ativos' from g full join s on s.currency_code = g.currency_code
     where g.currency_code is null or s.currency_code is null
        or (g.contributed, g.redeemed, g.net_contributed, g.market_value, g.total_result)
           is distinct from (s.contributed, s.redeemed, s.net_contributed, s.market_value, s.total_result)
    union all
    select 'linha total diferente de investment_totals' from g full join t on t.currency_code = g.currency_code
     where g.currency_code is null or t.currency_code is null or g.market_value is distinct from t.market_value
    union all
    select 'contributed ou redeemed diferente da soma independente' from a left join o on o.asset_id = a.asset_id
     where o.asset_id is null or a.contributed is distinct from o.contributed or a.redeemed is distinct from o.redeemed
  )
  select case when exists (select 1 from problemas)
              then (select string_agg(x.msg, '; ' order by x.msg) from (select distinct msg from problemas) x)
              else format('ok %s+%s', (select count(*) from a), (select count(*) from g)) end $f$;
grant execute on all functions in schema pg_temp to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000101a1', 'c1@teste.com'),
  ('00000000-0000-0000-0000-0000000101a2', 'c2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000101a1');
insert into fixture select 'h', public.create_household('Casa dos Aportes');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date, currency_code)
           values (pg_temp.fx('h'), 'Corrente de teste', 'checking', 50000, pg_temp.dia(400), 'BRL') returning id)
  insert into fixture select 'cc', id from i;

-- ---- V: família sem nenhum investimento ----
select is(pg_temp.tudo(pg_temp.fx('h'), pg_temp.hoje()), '(nenhuma linha)', 'V1 família sem investimento: zero linhas (não vem linha total zerada)');
select is(pg_temp.confere(pg_temp.fx('h'), pg_temp.hoje()), 'ok 0+0', 'V1.1 e a conferência fecha com zero linhas');
select pg_temp.novo('semop', 'Nunca operado de teste');
select is(pg_temp.tudo(pg_temp.fx('h'), pg_temp.hoje()), '(nenhuma linha)', 'V2 ativo sem operação: continua sem linha nenhuma');

-- =====================================================================================================
-- A: o caso do dono. Pôs 1.000, passou a valer 1.100, tirou 550 (tudo pelo valor, com conta)
-- =====================================================================================================
select pg_temp.novo('cofre', 'Cofrinho de teste');
insert into num select 'a0_cc', pg_temp.saldo('cc');
select public.investment_operation_record_by_value(pg_temp.fx('cofre'), pg_temp.dia(300), 'buy', 1000.00, null, pg_temp.fx('cc'));
select is(pg_temp.lin('cofre', pg_temp.hoje()), '1000.00|0.00|1000.00|1000.00|0.00', 'A1 depois do aporte: 1.000 aportados, nada resgatado, vale 1.000, rendeu 0');
select public.investment_valuation_record_total(pg_temp.fx('cofre'), pg_temp.dia(290), 1100.00, 'extrato de teste');
select is(pg_temp.lin('cofre', pg_temp.hoje()), '1000.00|0.00|1000.00|1100.00|100.00', 'A2 depois da avaliação: vale 1.100, rendeu 100');
select public.investment_operation_record_by_value(pg_temp.fx('cofre'), pg_temp.dia(280), 'sell', 550.00, null, pg_temp.fx('cc'));
select is((select concat_ws('|', currency_code, cost_basis, market_value, unrealized_result) from public.investment_totals(pg_temp.fx('h'), pg_temp.hoje())),
          'BRL|500.00|550.00|50.00', 'A3 o que já existia (investment_totals): custo 500 e resultado 50, só do que ainda está investido');
select is(pg_temp.lin('cofre', pg_temp.hoje()), '1000.00|550.00|450.00|550.00|100.00',
          'A4 linha do ativo: aportado 1.000, resgatado 550, líquido 450, valor 550, rendimento total 100');
select is(pg_temp.tot(pg_temp.fx('h'), 'BRL', pg_temp.hoje()), '1000.00|550.00|450.00|550.00|100.00', 'A5 linha total em reais: os mesmos números');
select is(pg_temp.tudo(pg_temp.fx('h'), pg_temp.hoje()),
          'asset|cofre|BRL|1000.00|550.00|450.00|550.00|100.00;total|-|BRL|1000.00|550.00|450.00|550.00|100.00',
          'A6 são duas linhas: a do ativo e, depois, a total (com asset_id nulo)');
select is(pg_temp.confere(pg_temp.fx('h'), pg_temp.hoje()), 'ok 1+1', 'A7 identidades conferidas (1 ativo + 1 total)');
select is(pg_temp.saldo('cc'), pg_temp.n('a0_cc') - 1000.00 + 550.00, 'A8 a conta andou exatamente −aportado +resgatado (−1.000 +550)');
select is(pg_temp.tudo(pg_temp.fx('h'), pg_temp.hoje()), pg_temp.tudo(pg_temp.fx('h'), pg_temp.hoje()), 'A9 chamar duas vezes devolve o mesmo');
-- a data de corte, passo a passo
select is(pg_temp.lin('cofre', pg_temp.dia(301)), null, 'A10 na véspera do primeiro aporte: o ativo não tem linha');
select is(pg_temp.tudo(pg_temp.fx('h'), pg_temp.dia(301)), '(nenhuma linha)', 'A10.1 nem há linha total');
select is(pg_temp.lin('cofre', pg_temp.dia(300)), '1000.00|0.00|1000.00|1000.00|0.00', 'A11 no dia do aporte já conta (data de corte inclusive)');
select is(pg_temp.lin('cofre', pg_temp.dia(291)), '1000.00|0.00|1000.00|1000.00|0.00', 'A12 na véspera da avaliação: ainda vale o que entrou');
select is(pg_temp.lin('cofre', pg_temp.dia(290)), '1000.00|0.00|1000.00|1100.00|100.00', 'A12.1 no dia da avaliação: vale 1.100');
select is(pg_temp.lin('cofre', pg_temp.dia(281)), '1000.00|0.00|1000.00|1100.00|100.00', 'A13 na véspera do resgate: o resgate (operação depois da data) não conta');
select is(pg_temp.lin('cofre', pg_temp.dia(280)), '1000.00|550.00|450.00|550.00|100.00', 'A13.1 no dia do resgate já conta (inclusive)');
select is(pg_temp.lin('cofre', pg_temp.dia(-30)), pg_temp.lin('cofre', pg_temp.hoje()), 'A14 data de corte no futuro = hoje');
select is(pg_temp.confere(pg_temp.fx('h'), pg_temp.dia(290)), 'ok 1+1', 'A15 identidades também em data passada');

-- =====================================================================================================
-- B: sem nenhum resgate, aportado × custo de investment_portfolio
-- =====================================================================================================
-- B.1 unidades inteiras, preço com 2 casas, com tarifa: 3 × 33,33 + 1,37 = 101,36 e 2 × 35,10 + 0,99 = 71,19
select pg_temp.novo('acao', 'Bolsa de teste', 'equity');
select public.investment_operation_record(pg_temp.fx('acao'), pg_temp.dia(260), 'buy', 3, 33.33, 1.37);
select public.investment_operation_record(pg_temp.fx('acao'), pg_temp.dia(250), 'buy', 2, 35.10, 0.99);
select is(pg_temp.lin('acao', pg_temp.hoje()), '172.55|0.00|172.55|172.55|0.00', 'B1 duas compras sem resgate: aportado 172,55, rendimento 0');
select is(pg_temp.custo('acao'), 172.55, 'B1.1 = cost_basis de investment_portfolio (172,55)');
select is(pg_temp.lin('acao', pg_temp.dia(251)), '101.36|0.00|101.36|101.36|0.00', 'B1.2 na véspera da segunda compra: só a primeira (101,36)');
select is(pg_temp.lin('acao', pg_temp.dia(250)), '172.55|0.00|172.55|172.55|0.00', 'B1.3 no dia da segunda compra: as duas');
select is(pg_temp.lin('acao', pg_temp.dia(261)), null, 'B1.4 antes da primeira compra: sem linha');
-- B.2 só pelo valor, com avaliação no meio: 1.000 + 500 = 1.500; vale 1.037,53 + 500 = 1.537,53
select pg_temp.novo('junt', 'Juntado por valor de teste');
select public.investment_operation_record_by_value(pg_temp.fx('junt'), pg_temp.dia(260), 'buy', 1000.00);
select public.investment_valuation_record_total(pg_temp.fx('junt'), pg_temp.dia(255), 1037.53, 'extrato de teste');
select public.investment_operation_record_by_value(pg_temp.fx('junt'), pg_temp.dia(250), 'buy', 500.00);
select is(pg_temp.lin('junt', pg_temp.hoje()), '1500.00|0.00|1500.00|1537.53|37.53', 'B2 dois aportes pelo valor (cota fracionada escondida): aportado 1.500,00 exato');
select is(pg_temp.custo('junt'), 1500.00, 'B2.1 = cost_basis (1.500,00)');
select is(pg_temp.pos('junt', pg_temp.hoje()), '1.481913775987|1500.00|1537.53|37.53',
          'B2.2 e, sem resgate, o rendimento total (37,53) é o mesmo unrealized_result de investment_portfolio');
-- B.3 [documentado] preço com 3 casas: 3 compras de 1 × 10,004. Cada uma conta 10,00 (10,004 arredondado); o custo de
-- investment_portfolio arredonda só a soma (30,012 → 30,01). Sem avaliação, o valor é o custo: aparece 1 centavo de "rendimento".
select pg_temp.novo('fra', 'Renda fixa de três casas de teste');
select public.investment_operation_record(pg_temp.fx('fra'), pg_temp.dia(260), 'buy', 1, 10.004);
select public.investment_operation_record(pg_temp.fx('fra'), pg_temp.dia(255), 'buy', 1, 10.004);
select public.investment_operation_record(pg_temp.fx('fra'), pg_temp.dia(250), 'buy', 1, 10.004);
select is(pg_temp.lin('fra', pg_temp.hoje()), '30.00|0.00|30.00|30.01|0.01',
          'B3 [documentado] preço de 3 casas: aportado 30,00 (3 × 10,00); valor 30,01; rendimento de 0,01 sem avaliação nem resgate');
select is(pg_temp.custo('fra'), 30.01, 'B3.1 [documentado] o cost_basis é 30,01');
select is((select c.contributed - pg_temp.custo('fra') from public.investment_contributions(pg_temp.fx('h'), pg_temp.hoje()) c where c.asset_id = pg_temp.fx('fra')),
          -0.01, 'B3.2 [documentado] aportado − cost_basis = −0,01');
-- B.4 [documentado] quantidade fracionada com preço de 2 casas: 3 compras de 0,5 × 20,01 = 10,005. Cada uma conta 10,01;
-- o custo soma 30,015 → 30,02. Aqui a diferença vai para o outro lado.
select pg_temp.novo('frb', 'Previdência de cota fracionada de teste', 'fund');
select public.investment_operation_record(pg_temp.fx('frb'), pg_temp.dia(260), 'buy', 0.5, 20.01);
select public.investment_operation_record(pg_temp.fx('frb'), pg_temp.dia(255), 'buy', 0.5, 20.01);
select public.investment_operation_record(pg_temp.fx('frb'), pg_temp.dia(250), 'buy', 0.5, 20.01);
select is(pg_temp.lin('frb', pg_temp.hoje()), '30.03|0.00|30.03|30.02|-0.01',
          'B4 [documentado] cota fracionada: aportado 30,03 (3 × 10,01); valor 30,02; rendimento de −0,01 sem avaliação nem resgate');
select is((select c.contributed - pg_temp.custo('frb') from public.investment_contributions(pg_temp.fx('h'), pg_temp.hoje()) c where c.asset_id = pg_temp.fx('frb')),
          0.01, 'B4.1 [documentado] aportado − cost_basis = +0,01');
select ok((select bool_and(abs(c.contributed - p.cost_basis) <= 0.005 * 3)
             from public.investment_contributions(pg_temp.fx('h'), pg_temp.hoje()) c
             join public.investment_portfolio(pg_temp.fx('h'), pg_temp.hoje()) p on p.asset_id = c.asset_id
            where c.asset_id in (pg_temp.fx('fra'), pg_temp.fx('frb'))),
          'B4.2 a diferença cabe em meio centavo por compra (3 compras: até 0,015)');
select is(pg_temp.confere(pg_temp.fx('h'), pg_temp.hoje()), 'ok 5+1', 'B5 identidades conferidas (5 ativos + 1 total)');

-- =====================================================================================================
-- C: compra e venda por unidades COM conta e com tarifa: aportado e resgatado = o que saiu e voltou da conta
-- =====================================================================================================
-- C.1 compra 10 × 98,76 + 4,21 = 991,81; venda 4 × 105,43 − 2,34 = 419,38
select pg_temp.novo('fii', 'Imobiliário de teste', 'equity');
insert into num select 'c0_cc', pg_temp.saldo('cc');
insert into fixture select 'fii_c', public.investment_operation_record(pg_temp.fx('fii'), pg_temp.dia(240), 'buy', 10, 98.76, 4.21, null, pg_temp.fx('cc'));
insert into num select 'c1_cc', pg_temp.saldo('cc');
select is(pg_temp.n('c0_cc') - pg_temp.n('c1_cc'), 991.81, 'C1 a compra tirou 991,81 da conta (10 × 98,76 + 4,21 de tarifa)');
select is(pg_temp.transf('fii_c'), 'transfer|paid|saiu da conta|991.81|t', 'C1.1 numa transferência paga de 991,81');
select is(pg_temp.lin('fii', pg_temp.hoje()), '991.81|0.00|991.81|991.81|0.00', 'C1.2 aportado = 991,81, o que saiu da conta');
insert into fixture select 'fii_v', public.investment_operation_record(pg_temp.fx('fii'), pg_temp.dia(230), 'sell', 4, 105.43, 2.34, null, pg_temp.fx('cc'));
select is(pg_temp.saldo('cc') - pg_temp.n('c1_cc'), 419.38, 'C2 a venda devolveu 419,38 à conta (4 × 105,43 − 2,34 de tarifa)');
select is(pg_temp.transf('fii_v'), 'transfer|paid|voltou para a conta|419.38|t', 'C2.1 numa transferência paga de 419,38');
-- custo médio 99,181; ficam 6 unidades: 595,086 → 595,09; rendimento = 595,09 − (991,81 − 419,38) = 22,66
select is(pg_temp.lin('fii', pg_temp.hoje()), '991.81|419.38|572.43|595.09|22.66', 'C2.2 aportado 991,81, resgatado 419,38, líquido 572,43, valor 595,09, rendimento 22,66');
select is(pg_temp.lin('fii', pg_temp.dia(231)), '991.81|0.00|991.81|991.81|0.00', 'C2.3 na véspera da venda: resgatado 0');
select is(pg_temp.lin('fii', pg_temp.dia(230)), '991.81|419.38|572.43|595.09|22.66', 'C2.4 no dia da venda: já conta');
-- C.2 arredondamento em meio centavo: compra 7 × 12,345 + 0,99 = 87,405 → 87,41; venda 3 × 13,335 − 0,50 = 39,505 → 39,51
select pg_temp.novo('tes', 'Tesouro de teste');
insert into num select 'c2_cc', pg_temp.saldo('cc');
insert into fixture select 'tes_c', public.investment_operation_record(pg_temp.fx('tes'), pg_temp.dia(240), 'buy', 7, 12.345, 0.99, null, pg_temp.fx('cc'));
insert into num select 'c3_cc', pg_temp.saldo('cc');
insert into fixture select 'tes_v', public.investment_operation_record(pg_temp.fx('tes'), pg_temp.dia(230), 'sell', 3, 13.335, 0.50, null, pg_temp.fx('cc'));
select is(pg_temp.n('c2_cc') - pg_temp.n('c3_cc'), 87.41, 'C3 compra de 87,405: a conta perde 87,41');
select is(pg_temp.saldo('cc') - pg_temp.n('c3_cc'), 39.51, 'C3.1 venda de 39,505: a conta recebe 39,51');
select is(pg_temp.transf('tes_c') || ' / ' || pg_temp.transf('tes_v'),
          'transfer|paid|saiu da conta|87.41|t / transfer|paid|voltou para a conta|39.51|t', 'C3.2 as duas transferências, com os mesmos centavos');
-- custo 87,405 × 4/7 = 49,9457… → 49,95; rendimento = 49,95 − (87,41 − 39,51) = 2,05
select is(pg_temp.lin('tes', pg_temp.hoje()), '87.41|39.51|47.90|49.95|2.05', 'C3.3 aportado 87,41 e resgatado 39,51: os mesmos centavos da conta');
select results_eq(
  $$select c.asset_id, c.contributed, c.redeemed from public.investment_contributions(pg_temp.fx('h'), pg_temp.hoje()) c
     where c.asset_id in (pg_temp.fx('fii'), pg_temp.fx('tes')) order by 1$$,
  $$select o.asset_id, sum(t.amount) filter (where o.kind = 'buy'), sum(t.amount) filter (where o.kind = 'sell')
      from public.investment_operations o join public.transactions t on t.id = o.transaction_id and t.deleted_at is null
     where o.asset_id in (pg_temp.fx('fii'), pg_temp.fx('tes')) group by 1 order by 1$$,
  'C4 aportado e resgatado de cada ativo = soma das transferências das operações dele');
-- a transferência de uma operação não é apagada nem mandada para a lixeira por fora (trava da migration 100): se fosse,
-- o aportado deixaria de bater com a conta
select is(pg_temp.sqlstate_of($$select public.transactions_bulk_trash(array[(select transaction_id from public.investment_operations where id = pg_temp.fx('fii_c'))])$$),
          '42501', 'C5 mandar a transferência do aporte para a lixeira por fora: 42501');
select is(pg_temp.sqlstate_of($$delete from public.transactions where id = (select transaction_id from public.investment_operations where id = pg_temp.fx('fii_c'))$$),
          '42501', 'C5.1 apagar direto: 42501');
select is(pg_temp.transf('fii_c'), 'transfer|paid|saiu da conta|991.81|t', 'C5.2 a transferência segue inteira');
select is(pg_temp.confere(pg_temp.fx('h'), pg_temp.hoje()), 'ok 7+1', 'C6 identidades conferidas (7 ativos + 1 total)');

-- =====================================================================================================
-- D: operação anulada deixa de contar no aportado, no resgatado e no líquido
-- =====================================================================================================
-- compra A 5 × 20 = 100,00; compra B 5 × 22 + 1,00 = 111,00; venda C 2 × 25 − 0,50 = 49,50 (todas com conta)
select pg_temp.novo('anu', 'Anulações de teste', 'equity');
insert into num select 'd0_cc', pg_temp.saldo('cc');
insert into fixture select 'anu_a', public.investment_operation_record(pg_temp.fx('anu'), pg_temp.dia(220), 'buy', 5, 20.00, 0, null, pg_temp.fx('cc'));
insert into fixture select 'anu_b', public.investment_operation_record(pg_temp.fx('anu'), pg_temp.dia(210), 'buy', 5, 22.00, 1.00, null, pg_temp.fx('cc'));
insert into fixture select 'anu_c', public.investment_operation_record(pg_temp.fx('anu'), pg_temp.dia(200), 'sell', 2, 25.00, 0.50, null, pg_temp.fx('cc'));
select is(pg_temp.lin('anu', pg_temp.hoje()), '211.00|49.50|161.50|168.80|7.30', 'D1 antes de anular: aportado 211, resgatado 49,50, líquido 161,50');
select is(pg_temp.saldo('cc'), pg_temp.n('d0_cc') - 211.00 + 49.50, 'D1.1 a conta andou −211 +49,50');
select public.investment_operation_void(pg_temp.fx('anu_b'), 'compra em dobro (teste)');
select is(pg_temp.lin('anu', pg_temp.hoje()), '100.00|49.50|50.50|60.00|9.50', 'D2 compra B anulada: aportado cai para 100, líquido para 50,50');
select is(pg_temp.saldo('cc'), pg_temp.n('d0_cc') - 100.00 + 49.50, 'D2.1 e os 111,00 voltaram para a conta');
select is(pg_temp.lin('anu', pg_temp.dia(205)), '100.00|0.00|100.00|100.00|0.00', 'D2.2 a anulada some também das datas passadas (entre B e C: só a compra A)');
select is(pg_temp.sqlstate_of($$select public.investment_operation_void(pg_temp.fx('anu_b'), 'compra em dobro (teste)')$$), '55000', 'D3 anular de novo: 55000');
select is(pg_temp.sqlstate_of($$select public.investment_operation_void(pg_temp.fx('anu_a'), 'compra errada (teste)')$$), '23514',
          'D3.1 anular a compra que sustenta a venda: 23514');
select is(pg_temp.lin('anu', pg_temp.hoje()), '100.00|49.50|50.50|60.00|9.50', 'D3.2 as recusas não mudam nenhum número');
select public.investment_operation_void(pg_temp.fx('anu_c'), 'venda errada (teste)');
select is(pg_temp.lin('anu', pg_temp.hoje()), '100.00|0.00|100.00|100.00|0.00', 'D4 venda C anulada: resgatado volta a 0, líquido a 100, rendimento a 0');
select is(pg_temp.saldo('cc'), pg_temp.n('d0_cc') - 100.00, 'D4.1 e os 49,50 saíram de novo da conta');
select is(pg_temp.confere(pg_temp.fx('h'), pg_temp.hoje()), 'ok 8+1', 'D5 identidades conferidas (8 ativos + 1 total)');

-- =====================================================================================================
-- G: resgatou mais do que aportou. Pôs 1.000, valorizou para 2.500, tirou 2.000
-- =====================================================================================================
select pg_temp.novo('gan', 'Ganhador de teste');
select public.investment_operation_record_by_value(pg_temp.fx('gan'), pg_temp.dia(220), 'buy', 1000.00, null, pg_temp.fx('cc'));
select public.investment_valuation_record_total(pg_temp.fx('gan'), pg_temp.dia(210), 2500.00, 'extrato de teste');
select public.investment_operation_record_by_value(pg_temp.fx('gan'), pg_temp.dia(200), 'sell', 2000.00, null, pg_temp.fx('cc'));
select is(pg_temp.lin('gan', pg_temp.hoje()), '1000.00|2000.00|-1000.00|500.00|1500.00',
          'G1 aportado 1.000, resgatado 2.000: líquido NEGATIVO (−1.000), valor 500, rendimento total 1.500');
select is(pg_temp.pos('gan', pg_temp.hoje()), '0.200000000000|200.00|500.00|300.00', 'G1.1 em investment_portfolio: custo 200 e resultado 300 (só o que ficou)');
select is(pg_temp.confere(pg_temp.fx('h'), pg_temp.hoje()), 'ok 9+1', 'G2 identidades conferidas com líquido negativo (9 ativos + 1 total)');

-- ---- conferência do conjunto em reais, antes dos ativos que não podem aparecer ----
-- aportado 100 + 172,55 + 1.000 + 1.000 + 991,81 + 1.500 + 30,03 + 30,00 + 87,41 = 4.911,80
-- resgatado 550 + 2.000 + 419,38 + 39,51 = 3.008,89; valor 100 + 172,55 + 550 + 500 + 595,09 + 1.537,53 + 30,02 + 30,01 + 49,95 = 3.565,15
insert into foto select 'brl', pg_temp.tudo(pg_temp.fx('h'), pg_temp.hoje());
select is((select v from foto where k = 'brl'),
          'asset|anu|BRL|100.00|0.00|100.00|100.00|0.00;asset|acao|BRL|172.55|0.00|172.55|172.55|0.00;'
          || 'asset|cofre|BRL|1000.00|550.00|450.00|550.00|100.00;asset|gan|BRL|1000.00|2000.00|-1000.00|500.00|1500.00;'
          || 'asset|fii|BRL|991.81|419.38|572.43|595.09|22.66;asset|junt|BRL|1500.00|0.00|1500.00|1537.53|37.53;'
          || 'asset|frb|BRL|30.03|0.00|30.03|30.02|-0.01;asset|fra|BRL|30.00|0.00|30.00|30.01|0.01;'
          || 'asset|tes|BRL|87.41|39.51|47.90|49.95|2.05;total|-|BRL|4911.80|3008.89|1902.91|3565.15|1662.24',
          'T1 o retorno inteiro: ativos em ordem de nome e a linha total no fim (4.911,80 − 3.008,89 = 1.902,91; 3.565,15; 1.662,24)');
select is((select market_value from public.investment_totals(pg_temp.fx('h'), pg_temp.hoje()) where currency_code = 'BRL'), 3565.15,
          'T1.1 o valor da linha total é o de investment_totals (3.565,15)');
select is((select investments_brl from public.net_worth_with_assets(pg_temp.fx('h'), pg_temp.hoje())), 3565.15,
          'T1.2 e é o mesmo que entra no patrimônio (net_worth_with_assets.investments_brl)');
-- os ativos operados com conta: cofrinho, imobiliário, tesouro, anulações e ganhador
select is(pg_temp.saldo('cc'),
          50000.00 - (select sum(c.contributed) - sum(c.redeemed) from public.investment_contributions(pg_temp.fx('h'), pg_temp.hoje()) c
                       where c.asset_id in (pg_temp.fx('cofre'), pg_temp.fx('fii'), pg_temp.fx('tes'), pg_temp.fx('anu'), pg_temp.fx('gan'))),
          'T2 saldo da conta = 50.000 − líquido aportado dos ativos operados com conta');
select is(pg_temp.saldo('cc'), 49829.67, 'T2.1 em número: 50.000 − 3.179,22 + 3.008,89 = 49.829,67');

-- =====================================================================================================
-- H: ativo zerado, arquivado, só com operação anulada e sem operação
-- =====================================================================================================
-- zerado: compra 2 × 40 = 80; venda 2 × 45 = 90 (ganho de 10 já realizado)
select pg_temp.novo('zer', 'Zerado de teste', 'equity');
select public.investment_operation_record(pg_temp.fx('zer'), pg_temp.dia(240), 'buy', 2, 40.00);
select is(pg_temp.lin('zer', pg_temp.hoje()), '80.00|0.00|80.00|80.00|0.00', 'H1 com posição, o ativo tem linha');
select public.investment_operation_record(pg_temp.fx('zer'), pg_temp.dia(230), 'sell', 2, 45.00);
select is(pg_temp.lin('zer', pg_temp.hoje()), null, 'H1.1 zerado: sem linha (o ganho de 10 que ele realizou some junto)');
select is(pg_temp.lin('zer', pg_temp.dia(231)), '80.00|0.00|80.00|80.00|0.00', 'H1.2 na véspera de zerar ainda tinha linha');
select is(pg_temp.lin('zer', pg_temp.dia(230)), null, 'H1.3 no dia em que zerou já não tem');
-- arquivado: compra 1 × 70; venda 1 × 75; arquiva (só arquiva sem posição)
select pg_temp.novo('arq', 'Velho arquivado de teste', 'fund');
select public.investment_operation_record(pg_temp.fx('arq'), pg_temp.dia(240), 'buy', 1, 70.00);
select public.investment_operation_record(pg_temp.fx('arq'), pg_temp.dia(230), 'sell', 1, 75.00);
select is(pg_temp.lin('arq', pg_temp.dia(235)), '70.00|0.00|70.00|70.00|0.00', 'H2 antes de arquivar, a data em que ele tinha posição mostra a linha');
select public.investment_asset_archive(pg_temp.fx('arq'));
select is(pg_temp.lin('arq', pg_temp.hoje()), null, 'H2.1 arquivado: sem linha hoje');
select is(pg_temp.lin('arq', pg_temp.dia(235)), null, 'H2.2 [documentado] e some também da data em que tinha posição (igual a investment_portfolio)');
-- só com operação anulada
select pg_temp.novo('anul', 'Só anulada de teste', 'equity');
insert into fixture select 'anul_op', public.investment_operation_record(pg_temp.fx('anul'), pg_temp.dia(240), 'buy', 1, 90.00);
select public.investment_operation_void(pg_temp.fx('anul_op'), 'lançada por engano (teste)');
select is(pg_temp.lin('anul', pg_temp.hoje()), null, 'H3 só com operação anulada: sem linha');
select is(pg_temp.lin('anul', pg_temp.dia(239)), null, 'H3.1 nem na data da operação anulada');
select is(pg_temp.lin('semop', pg_temp.hoje()), null, 'H4 sem operação: sem linha');
select is(pg_temp.tudo(pg_temp.fx('h'), pg_temp.hoje()), (select v from foto where k = 'brl'),
          'H5 os quatro ficam fora das linhas e do total: o retorno é idêntico ao de antes deles');
select is(pg_temp.confere(pg_temp.fx('h'), pg_temp.hoje()), 'ok 9+1', 'H5.1 identidades conferidas (9 ativos + 1 total)');
-- o zerado volta a ter posição: compra 1 × 50. Volta com a história inteira: aportado 80 + 50, resgatado 90.
select public.investment_operation_record(pg_temp.fx('zer'), pg_temp.dia(150), 'buy', 1, 50.00);
select is(pg_temp.lin('zer', pg_temp.hoje()), '130.00|90.00|40.00|50.00|10.00',
          'H6 o zerado que volta: aportado 130 e resgatado 90 desde o começo; o rendimento traz de volta o ganho de 10 do primeiro ciclo');
select is(pg_temp.pos('zer', pg_temp.hoje()), '1|50.00|50.00|0.00', 'H6.1 em investment_portfolio: custo 50 e resultado 0 (só o ciclo novo)');
select is(pg_temp.lin('zer', pg_temp.dia(151)), null, 'H6.2 na véspera da volta: ainda sem linha');
select is(pg_temp.tot(pg_temp.fx('h'), 'BRL', pg_temp.hoje()), '5041.80|3098.89|1942.91|3615.15|1672.24',
          'H6.3 e o total sobe a história inteira dele: +130 aportado, +90 resgatado, +50 de valor, +10 de rendimento');
-- reativar o arquivado (sem posição) não traz linha; com posição nova, volta com a história inteira
select public.investment_asset_unarchive(pg_temp.fx('arq'));
select is(pg_temp.lin('arq', pg_temp.hoje()), null, 'H7 arquivado reativado, ainda sem posição: sem linha hoje');
select is(pg_temp.lin('arq', pg_temp.dia(235)), '70.00|0.00|70.00|70.00|0.00', 'H7.1 mas a data em que tinha posição volta a mostrar a linha');
select public.investment_asset_archive(pg_temp.fx('arq'));
select is(pg_temp.confere(pg_temp.fx('h'), pg_temp.hoje()), 'ok 10+1', 'H8 identidades conferidas (10 ativos + 1 total)');
insert into foto select 'brl_total', pg_temp.tot(pg_temp.fx('h'), 'BRL', pg_temp.hoje());

-- =====================================================================================================
-- I: duas moedas. Ativo em dólar não movimenta conta (regra da migration 100); a linha total é por moeda
-- =====================================================================================================
-- ETF: compra 2 × 100,25 = 200,50; venda 1 × 110,10 − 0,10 = 110,00. Plano: compra 1 × 50,05.
select pg_temp.novo('etf', 'ETF em dólar de teste', 'etf', 'USD');
select pg_temp.novo('plano', 'Plano no exterior de teste', 'fund', 'USD');
select public.investment_operation_record(pg_temp.fx('etf'), pg_temp.dia(240), 'buy', 2, 100.25);
select public.investment_operation_record(pg_temp.fx('etf'), pg_temp.dia(230), 'sell', 1, 110.10, 0.10);
select public.investment_operation_record(pg_temp.fx('plano'), pg_temp.dia(240), 'buy', 1, 50.05);
select is(pg_temp.lin('etf', pg_temp.hoje()), '200.50|110.00|90.50|100.25|9.75', 'I1 ETF em dólar: aportado 200,50, resgatado 110,00, valor 100,25, rendimento 9,75');
select is(pg_temp.tot(pg_temp.fx('h'), 'USD', pg_temp.hoje()), '250.55|110.00|140.55|150.30|9.75', 'I2 total em dólar: só os dois ativos em dólar');
select is(pg_temp.tot(pg_temp.fx('h'), 'BRL', pg_temp.hoje()), (select v from foto where k = 'brl_total'), 'I3 o total em reais não muda um centavo');
select is((select string_agg(currency_code, ',' order by currency_code) from public.investment_contributions(pg_temp.fx('h'), pg_temp.hoje()) where level = 'total'),
          'BRL,USD', 'I4 uma linha total por moeda');
select is((select string_agg(currency_code || '|' || market_value, ';' order by currency_code) from public.investment_totals(pg_temp.fx('h'), pg_temp.hoje())),
          'BRL|3615.15;USD|150.30', 'I4.1 com os mesmos valores de investment_totals');
select matches(pg_temp.tudo(pg_temp.fx('h'), pg_temp.hoje()),
               '^(asset\|[a-z]+\|BRL\|[^;]+;){10}total\|-\|BRL\|[^;]+;asset\|etf\|USD\|200\.50\|110\.00\|90\.50\|100\.25\|9\.75;'
               || 'asset\|plano\|USD\|50\.05\|0\.00\|50\.05\|50\.05\|0\.00;total\|-\|USD\|250\.55\|110\.00\|140\.55\|150\.30\|9\.75$',
               'I5 ordem: os 10 ativos em reais, o total em reais, os 2 em dólar, o total em dólar');
-- a mesma conta de pg_temp.confere, escrita por extenso uma vez: soma dos ativos de cada moeda = linha total = investment_totals
select results_eq(
  $$select currency_code, sum(contributed), sum(redeemed), sum(net_contributed), sum(market_value), sum(total_result)
      from public.investment_contributions(pg_temp.fx('h'), pg_temp.hoje()) where level = 'asset' group by 1 order by 1$$,
  $$select currency_code, contributed, redeemed, net_contributed, market_value, total_result
      from public.investment_contributions(pg_temp.fx('h'), pg_temp.hoje()) where level = 'total' order by 1$$,
  'I5.1 em cada moeda, a soma das linhas de ativo = a linha total, nas cinco colunas');
select results_eq(
  $$select currency_code, market_value from public.investment_contributions(pg_temp.fx('h'), pg_temp.hoje()) where level = 'total' order by 1$$,
  $$select currency_code, market_value from public.investment_totals(pg_temp.fx('h'), pg_temp.hoje()) order by 1$$,
  'I5.2 e o valor da linha total = investment_totals.market_value');
select is(pg_temp.confere(pg_temp.fx('h'), pg_temp.hoje()), 'ok 12+2', 'I6 identidades conferidas (12 ativos + 2 totais)');
select is(pg_temp.confere(pg_temp.fx('h'), pg_temp.dia(235)), 'ok 10+2',
          'I6.1 e há 235 dias (fora anulações, ganhador e o arquivado; o zerado ainda aberto; 8 em reais + 2 em dólar)');

-- =====================================================================================================
-- J: proventos não mudam nenhum número
-- =====================================================================================================
insert into foto select 'j_hoje', pg_temp.tudo(pg_temp.fx('h'), pg_temp.hoje());
insert into foto select 'j_100', pg_temp.tudo(pg_temp.fx('h'), pg_temp.dia(100));
insert into num select 'j0_cc', pg_temp.saldo('cc');
select public.investment_distribution_record(pg_temp.fx('acao'), 'dividend', pg_temp.dia(100), 12.34, pg_temp.fx('cc'));
select public.investment_distribution_record(pg_temp.fx('cofre'), 'income', pg_temp.dia(100), 7.77, pg_temp.fx('cc'));
select public.investment_distribution_record(pg_temp.fx('acao'), 'jcp', pg_temp.dia(90), 5.00, pg_temp.fx('cc'), 'planned');
select is(pg_temp.saldo('cc') - pg_temp.n('j0_cc'), 20.11, 'J1 os proventos pagos entraram na conta (12,34 + 7,77)');
select is(pg_temp.tudo(pg_temp.fx('h'), pg_temp.hoje()), (select v from foto where k = 'j_hoje'), 'J2 e nenhum número de investment_contributions mudou');
select is(pg_temp.tudo(pg_temp.fx('h'), pg_temp.dia(100)), (select v from foto where k = 'j_100'), 'J2.1 nem na data do provento');
select is(pg_temp.confere(pg_temp.fx('h'), pg_temp.hoje()), 'ok 12+2', 'J3 identidades conferidas');

-- ---- E: parâmetros nulos e família que não existe ----
select is(pg_temp.tudo(pg_temp.fx('h'), null), '(nenhuma linha)', 'E1 data nula: zero linhas, sem erro');
select is(pg_temp.tudo(null, pg_temp.hoje()), '(nenhuma linha)', 'E2 família nula: zero linhas, sem erro');
select is(pg_temp.tudo('00000000-0000-0000-0000-000000000000', pg_temp.hoje()), '(nenhuma linha)', 'E3 família que não existe: zero linhas');
select is(pg_temp.tudo(pg_temp.fx('h'), date '1999-12-31'), '(nenhuma linha)', 'E4 data anterior a tudo: zero linhas');

-- =====================================================================================================
-- K: outra família
-- =====================================================================================================
insert into foto select 'k_h1', pg_temp.tudo(pg_temp.fx('h'), pg_temp.hoje());
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000101a2');
insert into fixture select 'h2', public.create_household('Casa Vizinha');
select is(pg_temp.tudo(pg_temp.fx('h'), pg_temp.hoje()), '(nenhuma linha)', 'K1 quem não é da família recebe zero linhas');
select is(pg_temp.tudo(pg_temp.fx('h'), pg_temp.dia(235)), '(nenhuma linha)', 'K1.1 em qualquer data');
select is(pg_temp.tudo(pg_temp.fx('h2'), pg_temp.hoje()), '(nenhuma linha)', 'K1.2 e a própria família, ainda vazia, também');
select is((select count(*) from public.investment_operations where household_id = pg_temp.fx('h')), 0::bigint, 'K1.3 nem lê as operações da outra família na tabela (RLS)');
-- compra 2 × 40 + 0,55 = 80,55; venda 1 × 50 = 50,00; fica 1 unidade ao custo de 40,275 → 40,28
insert into fixture select 'x2', public.investment_asset_create(pg_temp.fx('h2'), 'Fundo da outra casa', null, 'fund', 'BRL');
select public.investment_operation_record(pg_temp.fx('x2'), pg_temp.dia(240), 'buy', 2, 40.00, 0.55);
select public.investment_operation_record(pg_temp.fx('x2'), pg_temp.dia(230), 'sell', 1, 50.00);
select is(pg_temp.tudo(pg_temp.fx('h2'), pg_temp.hoje()), 'asset|x2|BRL|80.55|50.00|30.55|40.28|9.73;total|-|BRL|80.55|50.00|30.55|40.28|9.73',
          'K2 a outra família só vê o que é dela');
select is(pg_temp.confere(pg_temp.fx('h2'), pg_temp.hoje()), 'ok 1+1', 'K2.1 identidades conferidas na outra família');
select is(pg_temp.confere(pg_temp.fx('h'), pg_temp.hoje()), 'ok 0+0', 'K2.2 e a conferência da família 1, vista de fora, não enxerga nada');
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000101a1');
select is(pg_temp.tudo(pg_temp.fx('h'), pg_temp.hoje()), (select v from foto where k = 'k_h1'), 'K3 a família 1 segue com os mesmos números (o ativo da outra não entra)');
select is(pg_temp.tudo(pg_temp.fx('h2'), pg_temp.hoje()), '(nenhuma linha)', 'K3.1 e não lê os da outra');

-- =====================================================================================================
-- Z: sequência sorteada (determinística) num ativo só: 48 passos alternando por valor e por unidades, com avaliações,
-- duas anulações e um resgate total no meio. A cada passo: a operação é aceita; as identidades fecham na família inteira;
-- aportado e resgatado do ativo batem com a soma feita AQUI a partir dos números pedidos; e a conta anda o mesmo.
-- =====================================================================================================
select pg_temp.novo('fuzz', 'Embaralhado de teste');
create function pg_temp.sequencia() returns setof text language plpgsql as $f$
declare
  i integer;
  v_data date;
  v_tipo text;
  v_desc text;
  v_erro text;
  v_q numeric; v_p numeric; v_f numeric; v_valor numeric;
  v_mv numeric; v_qtd numeric;
  v_c numeric := 0;   -- aportado esperado
  v_r numeric := 0;   -- resgatado esperado
  v_op uuid;
  v_ult uuid; v_ult_tipo text; v_ult_valor numeric;
  v_saldo0 numeric := pg_temp.saldo('cc');
  v_obtido text;
begin
  for i in 1..48 loop
    v_data := pg_temp.dia(150 - 3 * i);
    select p.market_value, p.quantity into v_mv, v_qtd
      from public.investment_portfolio(pg_temp.fx('h'), pg_temp.hoje()) p where p.asset_id = pg_temp.fx('fuzz');
    v_mv := coalesce(v_mv, 0); v_qtd := coalesce(v_qtd, 0);
    v_erro := null; v_op := null; v_valor := null;

    if i in (21, 40) and v_ult is not null then v_tipo := 'anulação';
    elsif i = 30 and v_qtd > 0 then v_tipo := 'resgate total por valor';
    elsif i % 6 = 0 and v_qtd > 0 then v_tipo := 'avaliação';
    elsif i % 2 = 1 then v_tipo := case when v_qtd > 0 and pg_temp.sorteio(i, 0, 3) = 0 then 'resgate por valor' else 'aporte por valor' end;
    else v_tipo := case when v_qtd > 0 and pg_temp.sorteio(i, 0, 3) = 0 then 'venda por unidades' else 'compra por unidades' end;
    end if;

    if v_tipo = 'aporte por valor' then
      v_valor := round((pg_temp.sorteio(i, 1, 200000) + 1)::numeric / 100, 2);
      v_desc := format('de %s', v_valor);
    elsif v_tipo = 'resgate por valor' then
      v_valor := least(v_mv, greatest(0.01, round(v_mv * (5 + pg_temp.sorteio(i, 1, 60)) / 100, 2)));
      v_desc := format('de %s (valor do ativo: %s)', v_valor, v_mv);
    elsif v_tipo = 'resgate total por valor' then
      v_valor := v_mv;
      v_desc := format('de %s', v_valor);
    elsif v_tipo = 'compra por unidades' then
      v_q := round((pg_temp.sorteio(i, 1, 5000000) + 1)::numeric / 1000000, 6);
      v_p := round((pg_temp.sorteio(i, 2, 2000000) + 1)::numeric / 10000, 4);
      v_f := round(pg_temp.sorteio(i, 3, 500)::numeric / 100, 2);
      v_valor := round(v_q * v_p + v_f, 2);
      v_desc := format('%s × %s + %s = %s', v_q, v_p, v_f, v_valor);
    elsif v_tipo = 'venda por unidades' then
      v_q := least(v_qtd, greatest(0.000001, round(v_qtd * (5 + pg_temp.sorteio(i, 1, 60)) / 100, 6)));
      v_p := round((pg_temp.sorteio(i, 2, 2000000) + 1)::numeric / 10000, 4);
      v_f := round(pg_temp.sorteio(i, 3, 300)::numeric / 100, 2);
      if round(v_q * v_p, 2) <= 0 then v_p := v_p + 10; end if;
      if round(v_q * v_p - v_f, 2) <= 0 then v_f := 0; end if;
      v_valor := round(v_q * v_p - v_f, 2);
      v_desc := format('%s × %s − %s = %s', v_q, v_p, v_f, v_valor);
    elsif v_tipo = 'avaliação' then
      v_valor := greatest(0.01, round(v_mv * (85 + pg_temp.sorteio(i, 1, 40)) / 100, 2));
      v_desc := format('total de %s (antes: %s)', v_valor, v_mv);
    else
      v_desc := format('da última operação (%s de %s)', v_ult_tipo, v_ult_valor);
    end if;

    begin
      if v_tipo in ('aporte por valor', 'resgate por valor', 'resgate total por valor') then
        v_op := public.investment_operation_record_by_value(pg_temp.fx('fuzz'), v_data,
                  case when v_tipo = 'aporte por valor' then 'buy' else 'sell' end, v_valor, null, pg_temp.fx('cc'));
      elsif v_tipo = 'compra por unidades' then
        v_op := public.investment_operation_record(pg_temp.fx('fuzz'), v_data, 'buy', v_q, v_p, v_f, null, pg_temp.fx('cc'));
      elsif v_tipo = 'venda por unidades' then
        v_op := public.investment_operation_record(pg_temp.fx('fuzz'), v_data, 'sell', v_q, v_p, v_f, null, pg_temp.fx('cc'));
      elsif v_tipo = 'avaliação' then
        perform public.investment_valuation_record_total(pg_temp.fx('fuzz'), v_data, v_valor, 'extrato de teste');
      else
        perform public.investment_operation_void(v_ult, 'anulada na sequência (teste)');
      end if;
    exception when others then
      v_erro := sqlstate || ': ' || sqlerrm;
    end;

    if v_erro is null then
      if v_tipo in ('aporte por valor', 'compra por unidades') then
        v_c := v_c + v_valor; v_ult := v_op; v_ult_tipo := 'buy'; v_ult_valor := v_valor;
      elsif v_tipo in ('resgate por valor', 'resgate total por valor', 'venda por unidades') then
        v_r := v_r + v_valor; v_ult := v_op; v_ult_tipo := 'sell'; v_ult_valor := v_valor;
      elsif v_tipo = 'anulação' then
        if v_ult_tipo = 'buy' then v_c := v_c - v_ult_valor; else v_r := v_r - v_ult_valor; end if;
        v_ult := null;
      end if;
    end if;
    insert into fuzz_passos values (i, v_tipo, v_desc, v_erro);

    return next is(v_erro, null, format('Z%s %s %s: aceito', i, v_tipo, v_desc));
    return next matches(pg_temp.confere(pg_temp.fx('h'), pg_temp.hoje()), '^ok 1[23]\+2$',
                        format('Z%s.1 identidades conferidas na família inteira', i));
    select coalesce((select c.contributed::numeric(20,2) || '|' || c.redeemed::numeric(20,2)
                       from public.investment_contributions(pg_temp.fx('h'), pg_temp.hoje()) c where c.asset_id = pg_temp.fx('fuzz')),
                    'sem linha') || ' / conta ' || (pg_temp.saldo('cc') - v_saldo0)::numeric(20,2)
      into v_obtido;
    return next is(v_obtido,
                   case when pg_temp.qtd('fuzz') > 0 then v_c::numeric(20,2) || '|' || v_r::numeric(20,2) else 'sem linha' end
                     || ' / conta ' || (v_r - v_c)::numeric(20,2),
                   format('Z%s.2 aportado|resgatado = somado no teste; a conta andou resgatado − aportado', i));
  end loop;
  insert into num values ('z_c', v_c), ('z_r', v_r);
end $f$;
grant execute on all functions in schema pg_temp to public;
select * from pg_temp.sequencia();

select is((select string_agg(tipo || ' ' || n, ', ' order by tipo collate "C") from (select tipo, count(*) as n from fuzz_passos where erro is null group by tipo) x),
          'anulação 2, aporte por valor 19, avaliação 7, compra por unidades 10, resgate por valor 4, resgate total por valor 1, venda por unidades 5',
          'Z49 o que a sequência exercitou (determinado pelo sorteio fixo)');
select is((select count(*) from fuzz_passos where erro is not null), 0::bigint, 'Z49.1 nenhum passo foi recusado');
-- soma independente direto sobre investment_operations (sem passar pela transferência nem pelos acumulados do laço)
select is((select concat_ws('|', sum(round(quantity * unit_price + fees, 2)) filter (where kind = 'buy'),
                                 sum(round(quantity * unit_price - fees, 2)) filter (where kind = 'sell'))
             from public.investment_operations where asset_id = pg_temp.fx('fuzz') and voided_at is null),
          pg_temp.n('z_c')::numeric(20,2) || '|' || pg_temp.n('z_r')::numeric(20,2), 'Z50 soma direta sobre investment_operations = o que o laço somou a partir dos valores pedidos');
select is((select concat_ws('|', c.contributed, c.redeemed, c.net_contributed) from public.investment_contributions(pg_temp.fx('h'), pg_temp.hoje()) c
            where c.asset_id = pg_temp.fx('fuzz')),
          concat_ws('|', pg_temp.n('z_c')::numeric(20,2), pg_temp.n('z_r')::numeric(20,2), (pg_temp.n('z_c') - pg_temp.n('z_r'))::numeric(20,2)), 'Z50.1 = aportado, resgatado e líquido da função');
select is((select concat_ws('|', sum(t.amount) filter (where o.kind = 'buy'), sum(t.amount) filter (where o.kind = 'sell'))
             from public.investment_operations o join public.transactions t on t.id = o.transaction_id and t.deleted_at is null
            where o.asset_id = pg_temp.fx('fuzz') and o.voided_at is null),
          pg_temp.n('z_c')::numeric(20,2) || '|' || pg_temp.n('z_r')::numeric(20,2), 'Z50.2 = soma das transferências que saíram e voltaram da conta');
select is((select count(*) from public.investment_operations o join public.transactions t on t.id = o.transaction_id
            where o.asset_id = pg_temp.fx('fuzz') and (o.voided_at is null) <> (t.deleted_at is null)), 0::bigint,
          'Z50.3 só as transferências das operações anuladas estão na lixeira');
select is((select total_result from public.investment_contributions(pg_temp.fx('h'), pg_temp.hoje()) where asset_id = pg_temp.fx('fuzz')),
          (select market_value from public.investment_portfolio(pg_temp.fx('h'), pg_temp.hoje()) where asset_id = pg_temp.fx('fuzz')) - (pg_temp.n('z_c') - pg_temp.n('z_r')),
          'Z50.4 rendimento total = valor de investment_portfolio − (aportado − resgatado)');
-- a sequência vista em cada dia: as mesmas identidades com a data de corte andando do começo ao fim
select is((select string_agg(x.d::text || ': ' || x.r, ' / ' order by x.d)
             from (select pg_temp.dia(n) as d, pg_temp.confere(pg_temp.fx('h'), pg_temp.dia(n)) as r from generate_series(-1, 305) n) x
            where x.r !~ '^ok \d+\+\d+$'), null,
          'Z51 identidades conferidas em TODOS os dias, de 305 dias atrás até amanhã (todos os cenários deste arquivo)');
select is((select count(*) filter (where x.r = 'ok 0+0') || ' dias sem linha, ' || count(*) filter (where x.r <> 'ok 0+0') || ' com linhas'
             from (select pg_temp.confere(pg_temp.fx('h'), pg_temp.dia(n)) as r from generate_series(-1, 305) n) x),
          '5 dias sem linha, 302 com linhas', 'Z51.1 e só os 5 dias antes do primeiro aporte ficam sem linha');

-- =====================================================================================================
-- L: a função só lê. Retrato de antes e depois de chamá-la em todas as datas, para as duas famílias
-- =====================================================================================================
insert into foto select 'l_portfolio', pg_temp.retrato('investment_portfolio', pg_temp.fx('h'), pg_temp.hoje());
insert into foto select 'l_portfolio_235', pg_temp.retrato('investment_portfolio', pg_temp.fx('h'), pg_temp.dia(235));
insert into foto select 'l_totals', pg_temp.retrato('investment_totals', pg_temp.fx('h'), pg_temp.hoje());
insert into foto select 'l_totals_235', pg_temp.retrato('investment_totals', pg_temp.fx('h'), pg_temp.dia(235));
insert into foto select 'l_net_worth', pg_temp.retrato('net_worth_with_assets', pg_temp.fx('h'), pg_temp.hoje());
insert into foto select 'l_net_worth_235', pg_temp.retrato('net_worth_with_assets', pg_temp.fx('h'), pg_temp.dia(235));
insert into foto select 'l_balances', pg_temp.retrato('account_balances', pg_temp.fx('h'), pg_temp.hoje());
insert into foto select 'l_contrib', pg_temp.retrato('investment_contributions', pg_temp.fx('h'), pg_temp.hoje());
select is((select count(*) from foto where k like 'l\_%' and (v is null or v = '[]')), 0::bigint, 'L1 o retrato de antes tem dado em todas as funções');
reset role;
insert into foto select 'l_dados', pg_temp.dados();
select pg_temp.login('00000000-0000-0000-0000-0000000101a1');
select is((select sum((select count(*) from public.investment_contributions(pg_temp.fx('h'), pg_temp.dia(n)))
                    + (select count(*) from public.investment_contributions(pg_temp.fx('h2'), pg_temp.dia(n)))
                    + (select count(*) from public.investment_contributions(null, pg_temp.dia(n))))
             from generate_series(-1, 305) n) > 0, true, 'L2 a função foi chamada 921 vezes (3 por dia, 307 dias)');
select is(pg_temp.retrato('investment_portfolio', pg_temp.fx('h'), pg_temp.hoje()), (select v from foto where k = 'l_portfolio'), 'L3 investment_portfolio igual a antes');
select is(pg_temp.retrato('investment_portfolio', pg_temp.fx('h'), pg_temp.dia(235)), (select v from foto where k = 'l_portfolio_235'), 'L3.1 e em data passada');
select is(pg_temp.retrato('investment_totals', pg_temp.fx('h'), pg_temp.hoje()), (select v from foto where k = 'l_totals'), 'L4 investment_totals igual a antes');
select is(pg_temp.retrato('investment_totals', pg_temp.fx('h'), pg_temp.dia(235)), (select v from foto where k = 'l_totals_235'), 'L4.1 e em data passada');
select is(pg_temp.retrato('net_worth_with_assets', pg_temp.fx('h'), pg_temp.hoje()), (select v from foto where k = 'l_net_worth'), 'L5 net_worth_with_assets igual a antes');
select is(pg_temp.retrato('net_worth_with_assets', pg_temp.fx('h'), pg_temp.dia(235)), (select v from foto where k = 'l_net_worth_235'), 'L5.1 e em data passada');
select is(pg_temp.retrato('account_balances', pg_temp.fx('h'), pg_temp.hoje()), (select v from foto where k = 'l_balances'), 'L6 account_balances igual a antes');
select is(pg_temp.retrato('investment_contributions', pg_temp.fx('h'), pg_temp.hoje()), (select v from foto where k = 'l_contrib'), 'L7 e a própria função devolve o mesmo');
reset role;
select is(pg_temp.dados(), (select v from foto where k = 'l_dados'),
          'L8 nenhuma linha de ativos, operações, avaliações, proventos, lançamentos ou contas mudou (todas as famílias)');

-- ---- N: sessão sem usuário e anon ----
-- papel authenticated com token sem `sub`: a função não recusa, devolve zero linhas (como investment_portfolio)
select set_config('request.jwt.claims', '{}', true), set_config('role', 'authenticated', true);
select is(pg_temp.tudo(pg_temp.fx('h'), pg_temp.hoje()), '(nenhuma linha)', 'N1 sem usuário (token sem sub): zero linhas');
select is(pg_temp.tudo(pg_temp.fx('h2'), pg_temp.hoje()), '(nenhuma linha)', 'N1.1 de qualquer família');
reset role;
select set_config('request.jwt.claims', '{}', true), set_config('role', 'anon', true);
select matches(pg_temp.erro_de($$select * from public.investment_contributions(pg_temp.fx('h'), pg_temp.hoje())$$), '^42501\|',
               'N2 anon: recusado com 42501 (sem permissão de executar)');
select is(pg_temp.sqlstate_of($$select * from public.investment_contributions(null, null)$$), '42501', 'N2.1 anon com parâmetros nulos: 42501 também');
reset role;

select * from finish();
rollback;
