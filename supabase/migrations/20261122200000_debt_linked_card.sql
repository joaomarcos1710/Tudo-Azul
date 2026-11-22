-- Migration 148: empréstimo cobrado no cartão (vínculo de exibição).
--
-- Pedido do dono (22/11/2026): a fatura de novembro do CAIXA INFINITE foi parcelada pelo banco em 11x. No app o parcelamento
-- ficou como empréstimo à parte ("Parcelamento fatura CAIXA nov/26"), que deixa certos a dívida total e o caixa, mas o cartão
-- mostra fatura, saldo e limite diferentes do banco. Decisão do dono: VINCULAR o empréstimo ao cartão (não criar parcelamento
-- nativo de fatura, que mexeria no cálculo central das faturas e em vários relatórios de despesa).
--
-- O que muda:
--   * debts.linked_card_id: o cartão em que a parcela do empréstimo/financiamento é cobrada. Só por debt_link_card.
--   * card_linked_invoices(cartão): cada parcela dos empréstimos vinculados na primeira fatura que vence no dia dela ou depois,
--     e o total da fatura com essas parcelas (o número que o banco cobra). Só leitura.
--   * card_linked_summary(família, data): por cartão com vínculo, o saldo devedor dos empréstimos vinculados, a dívida do
--     cartão somada a ele e o limite disponível descontando esse saldo. Só leitura.
--
-- O que NÃO muda (de propósito): card_months, card_invoices_due, debt_balances, net_worth, home_indicators, fluxo de caixa,
-- calendário, saldos previstos, relatórios de despesa. A parcela continua sendo do empréstimo (paga em Dívidas, sai da conta
-- pelo cronograma); se entrasse no total da fatura, apareceria duas vezes nesses lugares. As duas funções novas são as
-- ÚNICAS que somam o empréstimo vinculado ao cartão, e só para exibir.

alter table public.debts add column linked_card_id uuid;

-- excluir o cartão (debt_delete, só cartão sem histórico) desfaz o vínculo em vez de recusar com erro técnico
alter table public.debts add constraint debts_linked_card_fk
  foreign key (household_id, linked_card_id) references public.debts (household_id, id)
  on delete set null (linked_card_id) deferrable initially immediate;

alter table public.debts add constraint debts_linked_card_kind
  check (linked_card_id is null or kind in ('loan', 'financing'));

create index debts_linked_card_idx on public.debts (household_id, linked_card_id) where linked_card_id is not null;

-- ---------------------------------------------------------------------------
-- debt_link_card: vincula (ou, com p_card nulo, desvincula) um empréstimo/financiamento a um cartão ativo da mesma família.
-- ---------------------------------------------------------------------------
create or replace function public.debt_link_card(p_debt uuid, p_card uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.debts%rowtype;
begin
  v := private.debt_lock(p_debt);
  if v.kind not in ('loan', 'financing') then
    raise exception 'só empréstimo ou financiamento pode ser cobrado no cartão' using errcode = '22023';
  end if;
  if p_card is not null and not exists (
    select 1 from public.debts c
     where c.household_id = v.household_id and c.id = p_card and c.kind = 'card' and c.active
  ) then
    raise exception 'cartão inexistente ou arquivado' using errcode = '23514';
  end if;
  update public.debts set linked_card_id = p_card where id = v.id and household_id = v.household_id;
end $$;
revoke execute on function public.debt_link_card(uuid, uuid) from public, anon;
grant execute on function public.debt_link_card(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- card_linked_invoices: uma linha por parcela (não cancelada) de empréstimo ATIVO vinculado, em UMA fatura só: a primeira
-- que vence no dia da parcela ou depois. Candidatas: as faturas do cartão (card_months) e, para meses sem fatura, a de cada
-- mês calculada pelos dias do cartão (com a troca de dias da 061: card_cycle_closing/card_cycle_due), dois meses antes até um
-- depois do da parcela. Assim um mês com duas faturas vencendo (troca de dias) ou sem fatura não repete nem perde parcela.
-- O label é o mês do FECHAMENTO, como em card_months. linked_total e total_with_linked repetem por fatura (a tela não soma).
-- ---------------------------------------------------------------------------
create or replace function public.card_linked_invoices(p_debt uuid)
returns table (label text, due_date date, invoice_total numeric, linked_debt_id uuid, linked_name text,
               installment_number integer, installment_count integer, amount numeric, status text,
               linked_total numeric, total_with_linked numeric)
language sql stable security invoker set search_path = '' as $$
  with c as (
    select d as card, d.id, d.household_id from public.debts d
     where d.id = p_debt and d.kind = 'card' and (select private.is_member(d.household_id))
  ), m as (
    select x.label, x.due_date, x.total from c cross join lateral public.card_months(c.id) x
  ), s as (
    select s.due_date, l.id as debt_id, l.name, s.installment_number, l.original_installments, s.amount, s.status
      from c
      join public.debts l on l.household_id = c.household_id and l.linked_card_id = c.id and l.active
      join public.debt_payment_schedule s on s.household_id = l.household_id and s.debt_id = l.id and s.status <> 'cancelled'
  ), calculadas as (
    select distinct to_char(f.fecha, 'YYYY-MM') as label, private.card_cycle_due(c.card, f.fecha) as due_date
      from c cross join s
      cross join lateral (
        select private.card_cycle_closing(c.card, (date_trunc('month', s.due_date) + make_interval(months => k))::date) as fecha
          from generate_series(-2, 1) k
      ) f
     where (c.card).closing_day is not null
  ), candidatas as (
    select m.label, m.due_date, m.total from m
    union all
    select k.label, k.due_date, 0::numeric from calculadas k where not exists (select 1 from m where m.label = k.label)
  ), j as (
    select s.*, coalesce(e.label, to_char(s.due_date, 'YYYY-MM')) as label, coalesce(e.total, 0) as invoice_total
      from s
      left join lateral (
        select cd.label, cd.total from candidatas cd where cd.due_date >= s.due_date order by cd.due_date, cd.label limit 1
      ) e on true
  )
  select j.label, j.due_date, j.invoice_total, j.debt_id, j.name, j.installment_number, j.original_installments,
         j.amount, j.status,
         sum(j.amount) over (partition by j.label),
         j.invoice_total + sum(j.amount) over (partition by j.label)
    from j
   order by j.due_date, j.name, j.installment_number
$$;
revoke execute on function public.card_linked_invoices(uuid) from public, anon;
grant execute on function public.card_linked_invoices(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- card_linked_summary: por cartão ATIVO que tem empréstimo ATIVO vinculado (com saldo ou não), na data.
--   linked_debt          = soma do saldo devedor (debt_balances.debt) dos empréstimos vinculados
--   debt_with_linked     = dívida do cartão (debt_balances.debt) + linked_debt
--   available_with_linked = card_limits.available − linked_debt (nulo sem limite informado; pode ficar negativo)
-- ---------------------------------------------------------------------------
create or replace function public.card_linked_summary(p_household uuid, p_as_of date)
returns table (debt_id uuid, linked_debt numeric, debt_with_linked numeric, available_with_linked numeric)
language sql stable security invoker set search_path = '' as $$
  with b as (
    select * from public.debt_balances(p_household, p_as_of)
  ), lk as (
    select l.linked_card_id as card_id, sum(coalesce(b.debt, 0)) as linked
      from public.debts l left join b on b.debt_id = l.id
     where l.household_id = p_household and l.linked_card_id is not null and l.active
     group by l.linked_card_id
  )
  select c.id, lk.linked, coalesce(cb.debt, 0) + lk.linked,
         case when cl.available is null then null else cl.available - lk.linked end
    from public.debts c
    join lk on lk.card_id = c.id
    left join b cb on cb.debt_id = c.id
    left join public.card_limits(p_household, p_as_of) cl on cl.debt_id = c.id
   where c.household_id = p_household and c.kind = 'card' and c.active
     and (select private.is_member(p_household))
   order by c.name
$$;
revoke execute on function public.card_linked_summary(uuid, date) from public, anon;
grant execute on function public.card_linked_summary(uuid, date) to authenticated;
