-- 65_card_overview: migration 065. public.card_overview(família, mês) devolve numa chamada o que a tela de Cartões lia
-- com card_months por cartão: fatura do mês escolhido (padrão: a atual), a atual, a fechada a pagar mais antiga, limite
-- (card_limits) e assinaturas previstas (card_pending_subscriptions), mais uma linha de totais da família.
-- O que importa é que os números BATAM com as funções que já existem (nenhuma regra nova): por isso a maior parte dos
-- testes compara com card_months / card_limits / card_pending_subscriptions, cartão a cartão. Datas relativas a hoje em
-- São Paulo (a função usa "hoje"), para o teste não depender do dia em que roda.
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
create function pg_temp.hoje() returns date language sql stable as $f$ select (now() at time zone 'America/Sao_Paulo')::date $f$;
-- dia do mês de uma data (para montar ciclos relativos a hoje)
create function pg_temp.dia(p date) returns integer language sql immutable as $f$ select extract(day from p)::int $f$;
-- linha de um cartão no resumo
create function pg_temp.mes(p_card uuid, p_month date default null) returns text language sql as $f$
  select o.month_label || '|' || o.month_closing || '|' || coalesce(o.month_due::text, '-') || '|' || o.month_total::numeric(14,2)
         || '|' || o.month_paid::numeric(14,2) || '|' || o.month_status
    from public.card_overview(pg_temp.fx('h'), p_month) o where o.debt_id = p_card $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.sqlstate_of(text), pg_temp.hoje(), pg_temp.dia(date),
  pg_temp.mes(uuid, date) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000065a1', 'o1@teste.com'),
  ('00000000-0000-0000-0000-0000000065a2', 'o2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000065a1');
insert into fixture select 'h', public.create_household('Casa do Resumo');
insert into fixture select 'cat', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';

-- Cartão Azul: fecha 10, vence 20, limite 5.000,00. Compra de 300,00 há 60 dias (fatura já fechada, cobrada e não
-- paga = a fechada a pagar mais antiga) e compra de 100,00 em 3x hoje (33,34 na atual + 2 futuras).
insert into fixture select 'azul', public.create_debt('Azul', 'card', '2025-01-01', 0);
select public.set_card_cycle(pg_temp.fx('azul'), 10, 20);
select public.set_card_limit(pg_temp.fx('azul'), 5000.00);
select public.card_purchase(pg_temp.fx('azul'), pg_temp.hoje() - 60, 300.00, 1, pg_temp.fx('cat'), 'Mercado antigo');
select public.card_purchase(pg_temp.fx('azul'), pg_temp.hoje(), 100.00, 3, pg_temp.fx('cat'), 'Tênis');
select public.card_bill_due(pg_temp.hoje());

-- Cartão Verde: fecha 5 dias depois de hoje (a atual fecha em hoje+5), limite 1.000,00, assinatura de 39,90 que cobra
-- daqui a 2 dias (ainda não virou parcela: é prevista na fatura atual) e uma compra de 50,00 hoje.
insert into fixture select 'verde', public.create_debt('Verde', 'card', '2025-01-01', 0);
select public.set_card_cycle(pg_temp.fx('verde'), pg_temp.dia(pg_temp.hoje() + 5), pg_temp.dia(pg_temp.hoje() + 15));
select public.set_card_limit(pg_temp.fx('verde'), 1000.00);
select public.card_purchase(pg_temp.fx('verde'), pg_temp.hoje(), 50.00, 1, pg_temp.fx('cat'), 'Farmácia');
insert into fixture select 'assin', public.recurrence_create('card', 'Streaming', 39.90, pg_temp.dia(pg_temp.hoje() + 2),
                                                             pg_temp.hoje() + 2, null, null, pg_temp.fx('verde'), pg_temp.fx('cat'));

-- Cartão Cinza: sem limite e sem compras (fatura atual R$ 0,00, com as datas do ciclo)
insert into fixture select 'cinza', public.create_debt('Cinza', 'card', '2025-01-01', 0);
select public.set_card_cycle(pg_temp.fx('cinza'), 15, 25);

-- Cartão Velho: arquivado (não entra no resumo nem nos totais)
insert into fixture select 'velho', public.create_debt('Velho', 'card', '2025-01-01', 0);
select public.set_card_cycle(pg_temp.fx('velho'), 10, 20);
select public.set_card_limit(pg_temp.fx('velho'), 9999.00);
select public.debt_archive(pg_temp.fx('velho'));

-- Empréstimo da mesma família: não é cartão, não entra
select public.create_debt('Empréstimo', 'loan', '2025-01-01', 0);

-- ---------------------------------------------------------------------------
-- 1. Forma: um cartão ativo por linha + uma linha de totais no fim
-- ---------------------------------------------------------------------------
select is(array(select coalesce(name, '(total)') || ':' || row_kind from public.card_overview(pg_temp.fx('h'))),
          array['Azul:card', 'Cinza:card', 'Verde:card', '(total):total'],
          'CO1 um cartão ativo por linha (pelo nome) e a linha de totais no fim; arquivado e empréstimo fora');

-- ---------------------------------------------------------------------------
-- 2. Cartão a cartão, os números batem com as funções que já existem
-- ---------------------------------------------------------------------------
-- fatura atual = a linha de card_months do ciclo de hoje (ou 0 sem linha); padrão do mês = a atual
select is_empty($$
  select o.name from public.card_overview(pg_temp.fx('h')) o
   where o.row_kind = 'card'
     and (o.current_total is distinct from coalesce((select m.total from public.card_months(o.debt_id) m where m.label = o.current_label), 0)
       or o.month_label is distinct from o.current_label
       or o.month_total is distinct from o.current_total
       or o.month_paid is distinct from coalesce((select m.paid from public.card_months(o.debt_id) m where m.label = o.current_label), 0)
       or o.current_due is distinct from coalesce((select m.due_date from public.card_months(o.debt_id) m where m.label = o.current_label),
                                                   o.current_due))
$$, 'CO2 fatura atual de cada cartão = card_months do ciclo de hoje; sem mês escolhido, o mês é o da atual');

select is_empty($$
  select o.name from public.card_overview(pg_temp.fx('h')) o
    left join lateral (
      select m.label, m.due_date, m.total - m.paid as falta from public.card_months(o.debt_id) m
       where m.closing_date <= pg_temp.hoje() and m.total > 0 and m.paid < m.total order by m.label limit 1) v on true
   where o.row_kind = 'card'
     and (o.oldest_open_label, o.oldest_open_due, o.oldest_open_remaining) is distinct from (v.label, v.due_date, coalesce(v.falta, 0))
$$, 'CO3 fechada a pagar mais antiga = a primeira fatura fechada com pago < total de card_months');

select is_empty($$
  select o.name from public.card_overview(pg_temp.fx('h')) o
    left join public.card_limits(pg_temp.fx('h'), pg_temp.hoje()) l on l.debt_id = o.debt_id
   where o.row_kind = 'card'
     and (o.credit_limit, o.limit_used, o.limit_available) is distinct from (l.credit_limit, l.committed, l.available)
$$, 'CO4 limite, usado e disponível = card_limits de hoje (nulos no cartão sem limite)');

select is_empty($$
  select o.name from public.card_overview(pg_temp.fx('h')) o
    left join public.card_pending_subscriptions(pg_temp.fx('h'), pg_temp.hoje()) s on s.debt_id = o.debt_id
   where o.row_kind = 'card'
     and (o.pending_subscriptions is distinct from coalesce(s.total, 0)
       or o.current_with_subscriptions is distinct from o.current_total + coalesce(s.total, 0)
       or (s.debt_id is not null and s.closing_date is distinct from o.current_closing))
$$, 'CO5 assinaturas previstas = card_pending_subscriptions de hoje, na mesma fatura atual');

-- valores esperados, para não depender só da comparação
select is((select current_total from public.card_overview(pg_temp.fx('h')) where debt_id = pg_temp.fx('azul')), 33.34::numeric,
          'CO6 Azul: fatura atual 33,34 (1ª parcela de 100,00 em 3x leva o resto dos centavos)');
select is((select oldest_open_remaining::numeric(14,2) || '|' || oldest_open_label from public.card_overview(pg_temp.fx('h')) where debt_id = pg_temp.fx('azul')),
          '300.00|' || (select label from public.card_months(pg_temp.fx('azul')) where total = 300.00),
          'CO7 Azul: fechada a pagar mais antiga = a de 300,00');
select is((select pending_subscriptions || '|' || current_total || '|' || current_with_subscriptions
             from public.card_overview(pg_temp.fx('h')) where debt_id = pg_temp.fx('verde')),
          '39.90|50.00|89.90', 'CO8 Verde: atual 50,00 + 39,90 de assinatura prevista = 89,90');
select is((select current_closing from public.card_overview(pg_temp.fx('h')) where debt_id = pg_temp.fx('verde')),
          pg_temp.hoje() + 5, 'CO9 Verde: a atual fecha daqui a 5 dias');
select is((select current_total || '|' || month_status || '|' || (credit_limit is null)
             from public.card_overview(pg_temp.fx('h')) where debt_id = pg_temp.fx('cinza')),
          '0|aberta|true', 'CO10 Cinza: sem compras, atual R$ 0,00 aberta, sem limite');
select is((select current_due = current_closing + 10 and extract(day from current_closing) = 15
                  and current_closing > pg_temp.hoje() and current_closing <= pg_temp.hoje() + 31
             from public.card_overview(pg_temp.fx('h')) where debt_id = pg_temp.fx('cinza')),
          true, 'CO11 Cinza: vencimento da atual pelo ciclo do mês (dia 25), mesmo sem linha em card_months');

-- ---------------------------------------------------------------------------
-- 3. Totais da família = soma das linhas
-- ---------------------------------------------------------------------------
select is((select t.month_total || '|' || t.month_paid || '|' || t.current_total || '|' || t.pending_subscriptions || '|'
                  || t.current_with_subscriptions || '|' || t.oldest_open_remaining || '|' || t.credit_limit || '|' || t.limit_used || '|' || t.limit_available
             from public.card_overview(pg_temp.fx('h')) t where t.row_kind = 'total'),
          (select sum(month_total) || '|' || sum(month_paid) || '|' || sum(current_total) || '|' || sum(pending_subscriptions) || '|'
                  || sum(current_with_subscriptions) || '|' || sum(oldest_open_remaining) || '|' || sum(credit_limit) || '|' || sum(limit_used) || '|' || sum(limit_available)
             from public.card_overview(pg_temp.fx('h')) where row_kind = 'card'),
          'CO12 linha de totais = soma das linhas dos cartões');
select is((select credit_limit || '|' || limit_used || '|' || limit_available from public.card_overview(pg_temp.fx('h')) where row_kind = 'total'),
          (select sum(l.credit_limit) || '|' || sum(l.committed) || '|' || sum(l.available)
             from public.card_limits(pg_temp.fx('h'), pg_temp.hoje()) l join public.debts d on d.id = l.debt_id where d.active),
          'CO13 limites totais = card_limits dos cartões ativos (o arquivado de 9.999,00 fica fora)');
select is((select credit_limit from public.card_overview(pg_temp.fx('h')) where row_kind = 'total'), 6000.00::numeric,
          'CO14 limite total 6.000,00 (5.000 + 1.000; o cartão sem limite não soma)');

-- ---------------------------------------------------------------------------
-- 4. Mês escolhido
-- ---------------------------------------------------------------------------
-- a fatura de 300,00 (fechada, não paga): escolhendo o mês dela
select is(pg_temp.mes(pg_temp.fx('azul'), (select closing_date from public.card_months(pg_temp.fx('azul')) where total = 300.00)),
          (select label || '|' || closing_date || '|' || due_date || '|300.00|0.00|fechada' from public.card_months(pg_temp.fx('azul')) where total = 300.00),
          'CO15 mês escolhido = o da fatura de 300,00: total, pago, fechamento, vencimento e situação "fechada" de card_months');
-- qualquer dia do mês serve (o mês vale pelo rótulo AAAA-MM do fechamento)
select is(pg_temp.mes(pg_temp.fx('azul'), (select date_trunc('month', closing_date)::date + 27 from public.card_months(pg_temp.fx('azul')) where total = 300.00)),
          pg_temp.mes(pg_temp.fx('azul'), (select closing_date from public.card_months(pg_temp.fx('azul')) where total = 300.00)),
          'CO16 qualquer dia do mês escolhido dá a mesma fatura');
-- mês futuro: a 3ª parcela do tênis (33,33), aberta
select is((select month_total || '|' || month_status from public.card_overview(pg_temp.fx('h'),
             (select max(closing_date) from public.card_months(pg_temp.fx('azul')))) where debt_id = pg_temp.fx('azul')),
          '33.33|aberta', 'CO17 mês futuro: a última parcela (33,33), aberta');
-- mês sem nada no cartão: R$ 0,00 com o fechamento do ciclo daquele mês
select is(pg_temp.mes(pg_temp.fx('cinza'), '2031-02-03'), '2031-02|2031-02-15|2031-02-25|0.00|0.00|aberta',
          'CO18 mês sem compras: R$ 0,00 com fechamento e vencimento do ciclo daquele mês');
-- a atual (destaque) não muda com o mês escolhido
select is((select current_total from public.card_overview(pg_temp.fx('h'), '2031-02-03') where debt_id = pg_temp.fx('azul')), 33.34::numeric,
          'CO19 as colunas da fatura atual não dependem do mês escolhido');
-- totais do mês escolhido = soma das faturas daquele mês
select is((select month_total from public.card_overview(pg_temp.fx('h'), (select closing_date from public.card_months(pg_temp.fx('azul')) where total = 300.00))
            where row_kind = 'total'),
          (select sum(month_total) from public.card_overview(pg_temp.fx('h'), (select closing_date from public.card_months(pg_temp.fx('azul')) where total = 300.00))
            where row_kind = 'card'),
          'CO20 total do mês escolhido = soma das faturas daquele mês');
-- explicitamente o mês da atual dá o mesmo que o padrão
select is(pg_temp.mes(pg_temp.fx('azul'), (select current_closing from public.card_overview(pg_temp.fx('h')) where debt_id = pg_temp.fx('azul'))),
          pg_temp.mes(pg_temp.fx('azul')), 'CO21 escolher o mês da fatura atual dá o mesmo que o padrão');

-- pagando a fatura de 300,00 ela vira "paga" e sai da fechada a pagar (lê card_months, que já conta o pagamento)
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 5000.00, '2025-01-01') returning id)
  insert into fixture select 'bank', id from i;
select public.debt_pay(pg_temp.fx('azul'), pg_temp.hoje(), pg_temp.fx('bank'), 300.00,
                       (select invoice_id from public.card_months(pg_temp.fx('azul')) where total = 300.00));
select is(split_part(pg_temp.mes(pg_temp.fx('azul'), (select closing_date from public.card_months(pg_temp.fx('azul')) where total = 300.00)), '|', 6),
          'paga', 'CO22 depois do pagamento: situação "paga"');
select is((select oldest_open_label is null and oldest_open_remaining = 0 from public.card_overview(pg_temp.fx('h')) where debt_id = pg_temp.fx('azul')),
          true, 'CO23 depois do pagamento: sem fechada a pagar');

-- ---------------------------------------------------------------------------
-- 5. Isolamento e segurança
-- ---------------------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000065a2');
insert into fixture select 'h2', public.create_household('Vizinha');
insert into fixture select 'viz', public.create_debt('Vizinho', 'card', '2025-01-01', 0);
select public.set_card_cycle(pg_temp.fx('viz'), 10, 20);
select public.set_card_limit(pg_temp.fx('viz'), 777.00);
select is((select count(*) from public.card_overview(pg_temp.fx('h'))), 0::bigint,
          'CO24 outra família: nenhuma linha (nem a de totais)');
select is(array(select coalesce(name, '(total)') || '|' || coalesce(credit_limit::text, '-') from public.card_overview(pg_temp.fx('h2'))),
          array['Vizinho|777.00', '(total)|777.00'], 'CO25 a vizinha vê só o dela');
select pg_temp.login('00000000-0000-0000-0000-0000000065a1');
select is((select count(*) from public.card_overview(pg_temp.fx('h2'))), 0::bigint, 'CO26 e a família de teste não vê a vizinha');

reset role;
select ok(not (select p.prosecdef from pg_proc p where p.oid = 'public.card_overview(uuid, date)'::regprocedure), 'CO27 SECURITY INVOKER');
select ok(not has_function_privilege('anon', 'public.card_overview(uuid, date)', 'EXECUTE'), 'CO28 anon não executa');
select ok(has_function_privilege('authenticated', 'public.card_overview(uuid, date)', 'EXECUTE'), 'CO29 authenticated executa');
select is((select proconfig from pg_proc where oid = 'public.card_overview(uuid, date)'::regprocedure), array['search_path=""'],
          'CO30 search_path fixo vazio');
set local role anon;
select is(pg_temp.sqlstate_of(format('select * from public.card_overview(%L)', pg_temp.fx('h'))), '42501',
          'CO31 anon chamando: permissão negada');
reset role;

select * from finish();
rollback;
