-- 95_budget_card_pending: migration 101 (20261110100000). budget_projection ganha, no fim, `planned_card`: a parte do
-- `planned` que é parcela de cartão já lançada e ainda não cobrada (fatura que ainda não fechou). Quando a fatura fecha,
-- a parcela vira cobrança e passa para `spent`; por isso `planned_card` nunca se sobrepõe a `spent` e `planned_card <=
-- planned`. Nenhum número antigo muda: o teste compara linha a linha com uma cópia da versão anterior (056).
-- Datas fixas no passado, com "hoje" passado como parâmetro: o teste não depende do dia em que roda.
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
-- gasto|planejado|cartão lançado|projetado|sobra de uma categoria (planned_card lido por nome, via jsonb: sem a
-- migration a coluna não existe e o teste falha nas comparações, não com erro de compilação)
create function pg_temp.bp(p_cat uuid, p_month date, p_today date) returns text language sql as $f$
  select b.spent::numeric(14,2) || '|' || b.planned::numeric(14,2) || '|' || coalesce((to_jsonb(b)->>'planned_card')::numeric(14,2)::text, 'sem coluna')
         || '|' || b.projected::numeric(14,2) || '|' || b.remaining::numeric(14,2)
    from public.budget_projection(pg_temp.fx('h'), p_month, p_today) b where b.category_id = p_cat $f$;

-- Cópia fiel da budget_projection da migration 056 (20261105000100), a versão anterior: prova que nenhum número antigo
-- muda (category_id, nome, limite, gasto, planejado, ritmo, projetado, sobra).
create function pg_temp.bp_antiga(p_household uuid, p_month date, p_today date)
returns table (category_id uuid, category_name text, amount_limit numeric, spent numeric, planned numeric,
               pace_extra numeric, projected numeric, remaining numeric)
language sql stable security invoker set search_path = '' as $f$
  with m as (
    select date_trunc('month', p_month::timestamp)::date as first_day,
           (date_trunc('month', p_month::timestamp) + interval '1 month - 1 day')::date as last_day
  ), d as (
    select m.first_day, m.last_day, (m.last_day - m.first_day + 1) as n,
           greatest(0, least(p_today, m.last_day) - m.first_day + 1) as elapsed
      from m
  )
  select u.category_id, u.category_name, u.amount_limit, u.spent,
         pl.planned, pc.pace_extra,
         u.spent + pl.planned + pc.pace_extra,
         u.amount_limit - (u.spent + pl.planned + pc.pace_extra)
    from d
   cross join lateral public.budget_usage(p_household, d.first_day) u
   cross join lateral (
     select coalesce((select sum(t.amount) from public.transactions t
                        join public.categories tc on tc.household_id = t.household_id and tc.id = t.category_id
                       where t.household_id = p_household and t.type = 'expense' and t.status = 'planned'
                         and t.deleted_at is null and t.date between d.first_day and d.last_day
                         and (tc.id = u.category_id or tc.parent_id = u.category_id)
                         and exists (select 1 from public.accounts ac where ac.household_id = t.household_id
                                       and ac.id = t.account_id and ac.currency_code = 'BRL')), 0)
          + coalesce((select sum(i.face - coalesce((select sum(e.amount) from public.debt_events e
                                                      where e.installment_id = i.id and e.kind in ('charge', 'cancel')
                                                        and e.voided_at is null), 0))
                        from public.debt_installments i
                        join public.categories ic on ic.household_id = i.household_id and ic.id = i.category_id
                       where i.household_id = p_household and i.due_date between d.first_day and d.last_day
                         and (ic.id = u.category_id or ic.parent_id = u.category_id)), 0)
          + coalesce((select sum(x.amount) from private.card_recurrence_pending(p_household, d.first_day, d.last_day) x
                        join public.categories xc on xc.household_id = p_household and xc.id = x.category_id
                       where (xc.id = u.category_id or xc.parent_id = u.category_id)), 0) as planned
   ) pl
   cross join lateral (
     select case when d.elapsed >= 7
                 then round(coalesce((select sum(t.amount) from public.transactions t
                                        join public.categories tc on tc.household_id = t.household_id and tc.id = t.category_id
                                       where t.household_id = p_household and t.type = 'expense' and t.status = 'paid'
                                         and t.deleted_at is null and t.occurrence_date is null
                                         and t.date between d.first_day and least(p_today, d.last_day)
                                         and (tc.id = u.category_id or tc.parent_id = u.category_id)
                                         and exists (select 1 from public.accounts ac where ac.household_id = t.household_id
                                                       and ac.id = t.account_id and ac.currency_code = 'BRL')), 0)
                            / d.elapsed * (d.n - d.elapsed), 2)
                 else 0 end as pace_extra
   ) pc
   where (select private.is_member(p_household))
   order by u.category_name
$f$;
-- nova = antiga em todas as colunas antigas, nos meses 03, 04 e 05/2026, com "hoje" no começo, no meio e depois deles;
-- e planned_card entre 0 e planned. Devolve as diferenças (vazio = igual).
create function pg_temp.diferencas() returns text[] language sql as $f$
  with casos as (
    select m::date as mes, t::date as hoje
      from unnest(array['2026-03-01','2026-04-01','2026-05-01']) m
     cross join unnest(array['2026-03-03','2026-03-20','2026-04-15','2026-06-30']) t
  ), nova as (
    select c.mes, c.hoje, b.category_id, b.category_name, b.amount_limit, b.spent, b.planned, b.pace_extra, b.projected, b.remaining
      from casos c cross join lateral public.budget_projection(pg_temp.fx('h'), c.mes, c.hoje) b
  ), antiga as (
    select c.mes, c.hoje, a.*
      from casos c cross join lateral pg_temp.bp_antiga(pg_temp.fx('h'), c.mes, c.hoje) a
  ), dif as (
    (select 'só na nova: ' || n::text from (select * from nova except all select * from antiga) n)
    union all
    (select 'só na antiga: ' || a::text from (select * from antiga except all select * from nova) a)
    union all
    (select 'fora de 0..planned: ' || b::text
       from casos c cross join lateral public.budget_projection(pg_temp.fx('h'), c.mes, c.hoje) b
      where not ((to_jsonb(b)->>'planned_card')::numeric between 0 and b.planned))
  )
  select coalesce(array_agg(x order by x), '{}') from dif d(x) $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.sqlstate_of(text), pg_temp.bp(uuid, date, date),
  pg_temp.bp_antiga(uuid, date, date), pg_temp.diferencas() to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000095a1', 'oc1@teste.com'),
  ('00000000-0000-0000-0000-0000000095a2', 'oc2@teste.com');

-- ---------------------------------------------------------------------------
-- Fixture: família A, contas BRL e USD, Compras pessoais (com a subcategoria Roupas) e Mercado
-- ---------------------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000095a1');
insert into fixture select 'h', public.create_household('Casa do Orçamento');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 5000.00, '2026-01-01') returning id)
  insert into fixture select 'bank', id from i;
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date, currency_code)
           values (pg_temp.fx('h'), 'Conta em dólar', 'checking', 500.00, '2026-01-01', 'USD') returning id)
  insert into fixture select 'usd', id from i;
insert into fixture select 'compras', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';
insert into fixture select 'mercado', id from public.categories where household_id = pg_temp.fx('h') and name = 'Mercado';
with c as (insert into public.categories (household_id, name, type, parent_id)
           values (pg_temp.fx('h'), 'Roupas', 'expense', pg_temp.fx('compras')) returning id)
  insert into fixture select 'roupas', id from c;
insert into public.budgets (household_id, category_id, month, amount_limit)
  select pg_temp.fx('h'), c, m, 1000.00
    from unnest(array[pg_temp.fx('compras'), pg_temp.fx('mercado')]) c
   cross join unnest(array['2026-03-01','2026-04-01','2026-05-01']::date[]) m;

-- Cartão: fecha dia 10, vence dia 20.
insert into fixture select 'card', public.create_debt('Cartão', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('card'), 10, 20);
-- TV 300,00 em 3x em 05/03 (Compras): parcelas de 100,00 que fecham em 10/03, 10/04 e 10/05
insert into fixture select 'tv', public.card_purchase(pg_temp.fx('card'), '2026-03-05', 300.00, 3, pg_temp.fx('compras'), 'TV');
-- Casaco 90,00 à vista em 06/03 na SUBcategoria Roupas: fecha 10/03 e soma em Compras
select public.card_purchase(pg_temp.fx('card'), '2026-03-06', 90.00, 1, pg_temp.fx('roupas'), 'Casaco');
-- Despesas planejadas fora do cartão em Compras: 40,00 em reais (entra em planned, NÃO em planned_card) e 70,00 em
-- dólar (fora do orçamento, que é só em reais)
insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status) values
  (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('compras'), 'expense', 'Presente', 40.00, '2026-03-25', 'planned'),
  (pg_temp.fx('h'), pg_temp.fx('usd'),  pg_temp.fx('compras'), 'expense', 'Loja online', 70.00, '2026-03-25', 'planned'),
  -- gasto pago em Mercado (dá ritmo para a comparação com a versão antiga)
  (pg_temp.fx('h'), pg_temp.fx('bank'), pg_temp.fx('mercado'), 'expense', 'Feira', 70.00, '2026-03-02', 'paid');
-- Assinatura de cartão de 25,00 todo dia 08 (março e abril), ainda não gerada: fica em planned (card_recurrence_pending)
-- e NÃO em planned_card (não é compra lançada). Inserida direto, para não gerar ocorrência pela data real de hoje.
reset role;
insert into public.recurrences (household_id, kind, description, amount, day, start_date, end_date, debt_id, category_id)
values (pg_temp.fx('h'), 'card', 'Streaming', 25.00, 8, '2026-03-08', '2026-04-30', pg_temp.fx('card'), pg_temp.fx('compras'));
select pg_temp.login('00000000-0000-0000-0000-0000000095a1');

-- ---------------------------------------------------------------------------
-- 0. Forma: a coluna nova é a última, a função continua SECURITY INVOKER e só authenticated executa
-- ---------------------------------------------------------------------------
reset role;
select is((select proargnames[array_upper(proargnames, 1)] from pg_proc where oid = 'public.budget_projection(uuid,date,date)'::regprocedure),
          'planned_card', 'F1 planned_card é a última coluna do retorno');
select is((select array_to_string(proargnames[4:11], ',') from pg_proc where oid = 'public.budget_projection(uuid,date,date)'::regprocedure),
          'category_id,category_name,amount_limit,spent,planned,pace_extra,projected,remaining',
          'F2 as colunas antigas continuam na mesma ordem');
select is((select prosecdef from pg_proc where oid = 'public.budget_projection(uuid,date,date)'::regprocedure), false,
          'F3 continua SECURITY INVOKER');
select ok(has_function_privilege('authenticated', 'public.budget_projection(uuid,date,date)', 'execute')
          and not has_function_privilege('anon', 'public.budget_projection(uuid,date,date)', 'execute'),
          'F4 authenticated executa; anon não');
select pg_temp.login('00000000-0000-0000-0000-0000000095a1');

-- ---------------------------------------------------------------------------
-- 1. Fatura aberta (nada cobrado ainda): a compra lançada está no planejado e em planned_card
-- ---------------------------------------------------------------------------
-- Compras 03/2026: gasto 0; planejado 40 (presente BRL) + 100 (TV 1/3) + 90 (casaco, subcategoria) + 25 (assinatura) = 255;
-- cartão lançado 190; projetado 255; sobra 745. O USD fica fora de tudo.
select is(pg_temp.bp(pg_temp.fx('compras'), '2026-03-01', '2026-03-07'), '0.00|255.00|190.00|255.00|745.00',
          'C1 fatura aberta: planned_card = TV 1/3 + casaco da subcategoria (190); presente, assinatura e USD fora dele');
select is(pg_temp.bp(pg_temp.fx('compras'), '2026-04-01', '2026-03-07'), '0.00|125.00|100.00|125.00|875.00',
          'C2 abril: TV 2/3 (100) em planned_card; assinatura de abril (25) só em planned');
select is(pg_temp.bp(pg_temp.fx('mercado'), '2026-03-01', '2026-03-07'), '70.00|0.00|0.00|310.00|690.00',
          'C3 categoria sem cartão: planned_card zero (gasto 70 e ritmo 70/7×24 = 240 iguais aos de antes)');
select is((select count(*) from public.budget_projection(pg_temp.fx('h'), '2026-03-01', '2026-03-07') where category_id = pg_temp.fx('roupas')),
          0::bigint, 'C4 subcategoria sem orçamento próprio não ganha linha: soma na categoria-mãe');
select is(pg_temp.diferencas(), '{}'::text[], 'C5 fatura aberta: nenhum número antigo muda (igual à versão 056)');

-- ---------------------------------------------------------------------------
-- 2. Fatura de março fechada e NÃO paga: a compra virou cobrança (spent) e sai de planned_card (sem dupla contagem)
-- ---------------------------------------------------------------------------
select is(public.card_bill_due('2026-03-15'), 2, 'C6 fechamento de 10/03 cobra TV 1/3 e casaco');
select is(pg_temp.bp(pg_temp.fx('compras'), '2026-03-01', '2026-03-15'), '190.00|65.00|0.00|255.00|745.00',
          'C7 fatura fechada não paga: 190 em spent, planned_card 0 (nada contado duas vezes; projetado igual)');
select is(public.card_bill_due('2026-03-15'), 0, 'C8 idempotência: cobrar de novo não cria nada');
select is(pg_temp.bp(pg_temp.fx('compras'), '2026-03-01', '2026-03-15'), '190.00|65.00|0.00|255.00|745.00',
          'C9 idempotência: os números não mudam');
select is(pg_temp.bp(pg_temp.fx('compras'), '2026-04-01', '2026-03-15'), '0.00|125.00|100.00|125.00|875.00',
          'C10 abril não muda com o fechamento de março');
select is(pg_temp.diferencas(), '{}'::text[], 'C11 fatura fechada: nenhum número antigo muda');

-- ---------------------------------------------------------------------------
-- 3. Fatura de março paga: o pagamento não é despesa; nada muda
-- ---------------------------------------------------------------------------
select ok(public.debt_pay(pg_temp.fx('card'), '2026-03-20', pg_temp.fx('bank'), 190.00) is not null, 'C12 paga a fatura de março');
select is(pg_temp.bp(pg_temp.fx('compras'), '2026-03-01', '2026-03-20'), '190.00|65.00|0.00|255.00|745.00',
          'C13 fatura paga: planned_card continua 0 em março');
select is(pg_temp.bp(pg_temp.fx('compras'), '2026-04-01', '2026-03-20'), '0.00|125.00|100.00|125.00|875.00',
          'C14 fatura paga: abril (ainda aberta) continua com 100 em planned_card');

-- ---------------------------------------------------------------------------
-- 4. Estorno e cancelamento reduzem
-- ---------------------------------------------------------------------------
-- estorno de 30,00 na TV 2/3 (ainda não cobrada): vira 'cancel' e abate de planned e de planned_card
select ok(public.debt_refund((select id from public.debt_installments where debt_id = pg_temp.fx('card') and plan = pg_temp.fx('tv')::text and seq = 2),
                             '2026-03-21', 30.00) is not null, 'C15 estorno de 30,00 na parcela de abril');
select is(pg_temp.bp(pg_temp.fx('compras'), '2026-04-01', '2026-03-21'), '0.00|95.00|70.00|95.00|905.00',
          'C16 estorno: planned_card de abril cai de 100 para 70 (planned de 125 para 95)');
-- compra de 50,00 em 22/03 (fecha 10/04) e depois excluída: entra e sai
insert into fixture select 'bota', public.card_purchase(pg_temp.fx('card'), '2026-03-22', 50.00, 1, pg_temp.fx('roupas'), 'Bota');
select is(pg_temp.bp(pg_temp.fx('compras'), '2026-04-01', '2026-03-22'), '0.00|145.00|120.00|145.00|855.00',
          'C17 compra nova na subcategoria entra em planned_card de abril (70 + 50)');
select ok(public.card_purchase_delete(pg_temp.fx('card'), pg_temp.fx('bota')::text, 'comprei errado') is not null, 'C18 exclui a compra');
select is(pg_temp.bp(pg_temp.fx('compras'), '2026-04-01', '2026-03-22'), '0.00|95.00|70.00|95.00|905.00',
          'C19 compra excluída (cancelamento): sai de planned_card');
select is(pg_temp.diferencas(), '{}'::text[], 'C20 depois de estorno e exclusão: nenhum número antigo muda');

-- ---------------------------------------------------------------------------
-- 5. Antecipação: a parcela é cobrada antes (vai para spent do mês da antecipação) e sai de planned_card
-- ---------------------------------------------------------------------------
select ok(public.debt_anticipate(pg_temp.fx('card'), '2026-03-26', pg_temp.fx('bank'),
            array[(select id from public.debt_installments where debt_id = pg_temp.fx('card') and plan = pg_temp.fx('tv')::text and seq = 3)],
            array[100.00], array[0.00]) is not null, 'C21 antecipa a TV 3/3 (fecharia em 10/05)');
select is(pg_temp.bp(pg_temp.fx('compras'), '2026-05-01', '2026-03-26'), '0.00|0.00|0.00|0.00|1000.00',
          'C22 maio: a parcela antecipada sai de planned_card');
select is(pg_temp.bp(pg_temp.fx('compras'), '2026-03-01', '2026-03-26'), '290.00|65.00|0.00|355.00|645.00',
          'C23 março: a antecipação é gasto de março (190 + 100), não cartão a pagar');

-- ---------------------------------------------------------------------------
-- 6. Pagamento adiantado (antes do fechamento) NÃO tira a compra de planned_card: adiantamento não é despesa e a parcela
--    só é cobrada no fechamento (decisão de 24/10/2026, migration 010). Fica registrado para não mudar sem querer.
-- ---------------------------------------------------------------------------
select ok(public.debt_pay(pg_temp.fx('card'), '2026-03-27', pg_temp.fx('bank'), 70.00) is not null, 'C24 paga 70,00 adiantado');
select is(pg_temp.bp(pg_temp.fx('compras'), '2026-04-01', '2026-03-27'), '0.00|95.00|70.00|95.00|905.00',
          'C25 adiantamento: abril continua com 70 em planned_card até o fechamento');
select is(pg_temp.diferencas(), '{}'::text[], 'C26 depois de antecipação e adiantamento: nenhum número antigo muda');

-- idempotência da leitura: duas chamadas iguais
select is((select array_agg(b::text order by b.category_name) from public.budget_projection(pg_temp.fx('h'), '2026-04-01', '2026-03-27') b),
          (select array_agg(b::text order by b.category_name) from public.budget_projection(pg_temp.fx('h'), '2026-04-01', '2026-03-27') b),
          'C27 chamar duas vezes devolve o mesmo');

-- ---------------------------------------------------------------------------
-- 7. Isolamento e privilégio
-- ---------------------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000095a2');
insert into fixture select 'h2', public.create_household('Outra casa');
select is((select count(*) from public.budget_projection(pg_temp.fx('h'), '2026-04-01', '2026-03-27')), 0::bigint,
          'C28 outra família não lê a projeção (nem planned_card) da primeira');
select is((select count(*) from public.budget_projection(pg_temp.fx('h2'), '2026-04-01', '2026-03-27')), 0::bigint,
          'C29 a segunda família, sem orçamento, não vê nada');
select pg_temp.login('00000000-0000-0000-0000-0000000095a1');
select is(pg_temp.sqlstate_of(format($$insert into public.debt_installments (household_id, debt_id, plan, seq, due_date, face, category_id)
                                      values (%L, %L, 'x', 1, '2026-04-10', 10.00, %L)$$,
                                     pg_temp.fx('h'), pg_temp.fx('card'), pg_temp.fx('compras'))),
          '42501', 'C30 o cliente não grava parcela direto na tabela (só pelas funções do cartão)');
reset role;
select ok(not has_function_privilege('anon', 'public.budget_projection(uuid,date,date)', 'execute'), 'C31 anon continua sem executar');

select * from finish();
rollback;
