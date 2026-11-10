-- 92_card_months_as_of_eventos_agregados: a migration 20261110070000 troca as três subconsultas por parcela de
-- private.card_months_as_of por uma soma única dos eventos. Aqui a função NOVA é comparada, para vários cartões e várias
-- datas de corte, com uma cópia da função ANTIGA (corpo da 20261109050000, abaixo como pg_temp.card_months_as_of_antiga):
-- a saída tem de ser idêntica linha a linha. Cenários: compra parcelada, parcela editada (cancelamento parcial), compra
-- excluída, crédito avulso (e maior que a fatura), estorno da parcela, pagamento parcial de fatura, adiantamento sem fatura,
-- devolução em dinheiro, evento anulado, saldo de referência e cartão sem parcelas. Datas fixas no passado (hoje >= 10/11/2026).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create temp table fixture (k text primary key, v uuid);
grant all on fixture to public;
create function pg_temp.fx(p_k text) returns uuid language sql as $f$ select v from fixture where k = p_k $f$;
create function pg_temp.hoje() returns date language sql as $f$ select (now() at time zone 'America/Sao_Paulo')::date $f$;
create function pg_temp.login(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $f$;
-- retorna void de propósito: um 'ok' impresso pela chamada seria lido pelo prove como teste sem número e quebraria a sequência
create function pg_temp.tenta(p_sql text) returns void language plpgsql as $f$
begin execute p_sql; exception when others then null; end $f$;
grant execute on function pg_temp.fx(text), pg_temp.hoje(), pg_temp.login(uuid), pg_temp.tenta(text) to public;

create function pg_temp.card_months_as_of_antiga(p_debt uuid, p_as_of date)
returns table (label text, due_date date, charged numeric, pending numeric, total numeric, paid numeric, invoice_id uuid)
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_d record; r record; v_credit numeric; v_ref numeric; v_s0 numeric; v_link numeric; v_total numeric;
  v_use numeric; v_surplus numeric; v_paid numeric; v_due date; v_b date; v_first boolean := true;
begin
  if p_as_of is null then raise exception 'data de corte obrigatória' using errcode = '22023'; end if;
  select d.id, d.household_id, d.closing_day, d.due_day, greatest(0, d.reference_balance) as reference_balance into v_d from public.debts d
   where d.id = p_debt and d.kind = 'card' and (select private.is_member(d.household_id));
  if not found then return; end if;

  -- pagamentos sem fatura: entram como adiantamento. A devolução em dinheiro (refund_cash) tira do adiantamento NA ORDEM
  -- DAS DATAS (correção da 052): a de antes do primeiro fechamento sai daqui; as outras saem no loop, depois da sobra
  -- da fatura cujo fechamento a antecede. Antes ela era descontada no começo, só do que existia sem fatura: a sobra de
  -- uma fatura (pagamento ou crédito avulso acima dela) já devolvida reaparecia como adiantamento.
  select coalesce(sum(e.amount), 0) into v_credit
    from public.debt_events e
   where e.household_id = v_d.household_id and e.debt_id = v_d.id and e.voided_at is null
     and e.kind in ('payment', 'extra_principal') and e.invoice_id is null and e.date <= p_as_of;
  v_ref := v_d.reference_balance;
  v_s0 := least(v_credit, v_ref);
  v_ref := v_ref - v_s0;
  v_credit := v_credit - v_s0;

  for r in
    with parc as (
      select i.id, i.due_date, i.face, i.closing_day, i.due_day,
             coalesce((select sum(case e.kind when 'charge' then e.amount when 'credit' then -e.amount else 0 end)
                         from public.debt_events e
                        where e.installment_id = i.id and e.voided_at is null and e.kind in ('charge', 'credit') and e.date <= p_as_of), 0) as cobrado,
             i.face - coalesce((select sum(e.amount) from public.debt_events e
                                 where e.installment_id = i.id and e.voided_at is null
                                   and e.kind in ('charge', 'cancel') and e.date <= p_as_of), 0) as resta,
             coalesce((select sum(e.amount) from public.debt_events e
                        where e.installment_id = i.id and e.voided_at is null and e.kind = 'cancel' and e.date <= p_as_of), 0) as cancelado
        from public.debt_installments i
       where i.household_id = v_d.household_id and i.debt_id = v_d.id
    ), meses_parc as (
      select to_char(p.due_date, 'YYYY-MM') as label, min(p.due_date) as closing_date,
             sum(p.cobrado) as charged, sum(p.resta) as pending, count(*)::int as items,
             max(p.closing_day) as cd, max(p.due_day) as dd
        from parc p where p.cancelado < p.face group by 1
    ), cred as (
      -- income_credit.date identifica a fatura escolhida; credit_date registra quando o crédito foi efetivamente concedido.
      -- Assim, crédito já recebido reduz a fatura futura sem antecipar crédito que ainda não ocorreu.
      select to_char(e.date, 'YYYY-MM') as label, min(e.date) as closing_date, sum(e.amount) as credits
        from public.debt_events e
       where e.household_id = v_d.household_id and e.debt_id = v_d.id and e.voided_at is null
         and e.kind = 'income_credit' and coalesce(e.credit_date, e.date) <= p_as_of
       group by 1
    ), meses as (
      select coalesce(m.label, c.label) as label, coalesce(m.closing_date, c.closing_date) as closing_date,
             coalesce(m.charged, 0) - coalesce(c.credits, 0) as charged, coalesce(m.pending, 0) as pending,
             coalesce(m.items, 0) as items, m.cd, m.dd, coalesce(c.credits, 0) as credits
        from meses_parc m full join cred c on c.label = m.label
    )
    select m.label, m.closing_date, m.charged, m.pending, m.items, m.cd, m.dd, m.credits, inv.id as inv_id, inv.due_date as inv_due,
           lead(m.closing_date) over (order by m.label) as next_closing,
           coalesce((select sum(e.amount) from public.debt_events e
                      where e.invoice_id = inv.id and e.voided_at is null
                        and e.kind in ('payment', 'extra_principal') and e.date <= p_as_of), 0) as pago_fatura
      from meses m
      left join public.debt_invoices inv
        on inv.household_id = v_d.household_id and inv.debt_id = v_d.id and inv.label = m.label
     order by m.label
  loop
    -- vencimento: o da fatura (se já existe) ou o calculado pelo ciclo da parcela (senão, o do cartão); mesma regra de
    -- private.card_due_date (migration 004), escrita aqui porque este relatório roda como o chamador
    v_due := r.inv_due;
    if v_due is null and coalesce(r.cd, v_d.closing_day) is not null then
      v_b := (date_trunc('month', r.closing_date)
              + case when coalesce(r.dd, v_d.due_day) > coalesce(r.cd, v_d.closing_day)
                     then interval '0' else interval '1 month' end)::date;
      v_due := make_date(extract(year from v_b)::int, extract(month from v_b)::int,
                         least(coalesce(r.dd, v_d.due_day),
                               extract(day from (v_b + interval '1 month - 1 day'))::int));
    end if;

    -- devoluções de antes do primeiro fechamento: saem do adiantamento sem fatura
    if v_first then
      v_credit := greatest(0, v_credit - coalesce((
        select sum(e.amount) from public.debt_events e
         where e.household_id = v_d.household_id and e.debt_id = v_d.id and e.voided_at is null
           and e.kind = 'refund_cash' and e.date < r.closing_date and e.date <= p_as_of), 0));
      v_first := false;
    end if;

    v_total   := greatest(0, r.charged + r.pending);
    v_link    := r.pago_fatura;
    v_use     := least(v_credit, greatest(0, v_total - v_link));
    -- excedente: pagamento acima da fatura + crédito avulso acima da fatura (migration 052)
    v_surplus := greatest(0, v_link - v_total) + greatest(0, -(r.charged + r.pending));
    v_paid    := least(v_total, v_link) + v_use;

    label := r.label; due_date := v_due; invoice_id := r.inv_id;
    charged := r.charged; pending := r.pending; total := v_total; paid := v_paid;
    
    v_s0 := least(v_surplus, v_ref);
    v_ref := v_ref - v_s0;
    v_credit := v_credit - v_use + (v_surplus - v_s0);
    -- devoluções feitas depois deste fechamento (inclusive) e antes do próximo: levam o crédito que existia então
    -- (inclui a sobra desta fatura); greatest(0, …) só protege a tela, debt_chk já garante a ordem
    v_credit := v_credit - coalesce((
      select sum(e.amount) from public.debt_events e
       where e.household_id = v_d.household_id and e.debt_id = v_d.id and e.voided_at is null
         and e.kind = 'refund_cash' and e.date >= r.closing_date and e.date <= p_as_of
         and (r.next_closing is null or e.date < r.next_closing)), 0);
    if v_credit < 0 then v_credit := 0; end if;
    return next;
  end loop;
end $$;


grant execute on function pg_temp.card_months_as_of_antiga(uuid, date) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000092a1', 'a92@teste.com'),
  ('00000000-0000-0000-0000-0000000092a2', 'b92@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000092a1');
insert into fixture select 'h', public.create_household('Casa Eventos');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 9000.00, '2026-01-01') returning id)
  insert into fixture select 'bank', id from i;
insert into fixture select 'cat', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';
insert into fixture select 'inc', id from public.categories where household_id = pg_temp.fx('h') and name = 'Outras receitas';

-- Cartão X: fecha dia 17, vence dia 25.
insert into fixture select 'x', public.create_debt('Cartão X', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('x'), 17, 25);
-- adiantamento sem fatura, antes do primeiro fechamento
select public.debt_pay(pg_temp.fx('x'), '2026-04-20', pg_temp.fx('bank'), 60.00);
insert into fixture select 'p1', public.card_purchase(pg_temp.fx('x'), '2026-05-05', 300.00, 3, pg_temp.fx('cat'), 'Geladeira');
insert into fixture select 'p2', public.card_purchase(pg_temp.fx('x'), '2026-06-20', 120.00, 1, pg_temp.fx('cat'), 'Tênis');
insert into fixture select 'p3', public.card_purchase(pg_temp.fx('x'), '2026-07-10', 90.00, 2, pg_temp.fx('cat'), 'Curso');
insert into fixture select 'p4', public.card_purchase(pg_temp.fx('x'), '2026-08-02', 60.00, 1, pg_temp.fx('cat'), 'Lançada errada');
-- crédito avulso na fatura de junho e um maior que a fatura (setembro não tem compra: sobra vira adiantamento)
select public.card_credit_income(pg_temp.fx('x'), '2026-06-10', 50.00, pg_temp.fx('inc'), 'Estorno de IOF');
select public.card_credit_income(pg_temp.fx('x'), '2026-09-05', 80.00, pg_temp.fx('inc'), 'Reembolso grande');
-- cobra as faturas já fechadas (gera os eventos de cobrança)
select public.card_bill_due('2026-10-31');
-- pagamento parcial da fatura de junho; pagamento sem fatura anulado depois
select public.debt_pay(pg_temp.fx('x'), '2026-06-25', pg_temp.fx('bank'), 100.00,
                       (select id from public.debt_invoices where debt_id = pg_temp.fx('x') and label = '2026-06'));
select public.debt_pay(pg_temp.fx('x'), '2026-07-01', pg_temp.fx('bank'), 10.00);
select public.debt_void((select id from public.debt_events where debt_id = pg_temp.fx('x') and kind in ('payment', 'extra_principal')
                           and amount = 10.00 and voided_at is null limit 1), 'lançado errado');
-- parcela editada para menos (cancelamento parcial), compra excluída (cancelamento total), estorno em parcela
select pg_temp.tenta(format($$select public.card_installment_edit(%L, 70.00, 'ajuste')$$,
         (select id from public.debt_installments where plan = pg_temp.fx('p3')::text order by seq limit 1)));
select pg_temp.tenta(format($$select public.card_purchase_delete(%L, %L, 'compra lançada errada')$$, pg_temp.fx('x'), pg_temp.fx('p4')::text));
select pg_temp.tenta(format($$select public.debt_refund(%L, '2026-08-20', 30.00)$$,
         (select id from public.debt_installments where plan = pg_temp.fx('p2')::text order by seq limit 1)));
-- devolução em dinheiro do adiantamento que sobrou
-- (a devolução em dinheiro precisa de crédito a receber; ela é feita no cartão W, mais abaixo)

-- Cartão Y: com saldo de referência (200,00), fecha dia 5, vence dia 12
insert into fixture select 'y', public.create_debt('Cartão Y', 'card', '2026-01-01', 200.00);
select public.set_card_cycle(pg_temp.fx('y'), 5, 12);
select public.debt_pay(pg_temp.fx('y'), '2026-02-10', pg_temp.fx('bank'), 150.00);
select public.card_purchase(pg_temp.fx('y'), '2026-03-03', 100.00, 2, pg_temp.fx('cat'), 'Compra do Y');
select public.card_bill_due('2026-10-31');

-- Cartão W: pagamento acima da fatura vira crédito a receber, e parte dele é devolvida em dinheiro (refund_cash)
insert into fixture select 'w', public.create_debt('Cartão W', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('w'), 17, 25);
select public.card_purchase(pg_temp.fx('w'), '2026-05-05', 50.00, 1, pg_temp.fx('cat'), 'Compra do W');
select public.card_bill_due('2026-10-31');
select public.debt_pay(pg_temp.fx('w'), '2026-06-01', pg_temp.fx('bank'), 80.00);
select public.debt_return(pg_temp.fx('w'), '2026-08-01', pg_temp.fx('bank'), 20.00);

-- Cartão Z: sem parcelas, só um crédito avulso (cai só no ramo dos créditos)
insert into fixture select 'z', public.create_debt('Cartão Z', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('z'), 10, 20);
select public.card_credit_income(pg_temp.fx('z'), '2026-05-05', 25.00, pg_temp.fx('inc'), 'Cashback');

-- 1) os cenários existem de verdade (se faltar um tipo de evento, a comparação abaixo não prova o que promete)
select ok((select array_agg(distinct kind order by kind) from public.debt_events
            where debt_id in (pg_temp.fx('x'), pg_temp.fx('y'), pg_temp.fx('z'), pg_temp.fx('w')) and voided_at is null)
          @> array['cancel', 'charge', 'credit', 'income_credit', 'payment', 'refund_cash']::text[],
          'E1 há cancelamento, cobrança, estorno de parcela, crédito avulso, pagamento e devolução em dinheiro nos cartões de teste');
select is((select count(*) from public.debt_events where debt_id = pg_temp.fx('x') and voided_at is not null), 3::bigint,
          'E2 há eventos anulados (um pagamento e as 2 cobranças trocadas pela edição da parcela): ficam fora da conta, como antes');
select ok((select count(*) from public.debt_installments where debt_id = pg_temp.fx('x')) >= 7, 'E3 o cartão X tem as parcelas dos cenários');

-- 2) a função nova devolve exatamente o que a antiga devolvia, em todas as combinações cartão x data de corte
create temp table datas(d date);
grant all on datas to public;
insert into datas values ('2026-04-30'), ('2026-05-17'), ('2026-06-30'), ('2026-07-17'), ('2026-08-31'), ('2026-09-30'),
  ('2026-10-31'), ('2026-11-30'), ('2027-06-30');
insert into datas select pg_temp.hoje();
select is((select count(*) from unnest(array[pg_temp.fx('x'), pg_temp.fx('y'), pg_temp.fx('z'), pg_temp.fx('w')]) as c(card)
             cross join datas
            where (select md5(coalesce(string_agg(n::text, '|' order by n.label), '')) from private.card_months_as_of(c.card, datas.d) n)
                  is distinct from
                  (select md5(coalesce(string_agg(o::text, '|' order by o.label), '')) from pg_temp.card_months_as_of_antiga(c.card, datas.d) o)),
          0::bigint, 'E4 nenhuma combinação de cartão e data de corte difere da função antiga (40 combinações)');
select ok((select count(*) from unnest(array[pg_temp.fx('x'), pg_temp.fx('y'), pg_temp.fx('z'), pg_temp.fx('w')]) as c(card)
             cross join datas cross join lateral private.card_months_as_of(c.card, datas.d)) >= 80,
          'E5 a comparação não é vazia: a função devolve faturas em quantidade nas 40 combinações');
select is((select count(*) from private.card_months_as_of(pg_temp.fx('x'), '2026-10-31') where charged > 0 and pending >= 0), 4::bigint,
          'E6 cartão X em 31/10: as 4 faturas com cobrança (mai a ago) seguem com valor; a de setembro é só crédito');

-- 3) quem não é da família continua sem ver nada
select pg_temp.login('00000000-0000-0000-0000-0000000092a2');
insert into fixture select 'h2', public.create_household('Casa Intrusa');
select is((select count(*) from private.card_months_as_of(pg_temp.fx('x'), pg_temp.hoje())), 0::bigint,
          'E7 outra família não enxerga as faturas do cartão X');

-- 4) o índice por fatura existe
select is((select count(*) from pg_indexes where schemaname = 'public' and tablename = 'debt_events' and indexname = 'debt_events_invoice_idx'),
          1::bigint, 'E8 índice debt_events_invoice_idx criado');

select * from finish();
rollback;
