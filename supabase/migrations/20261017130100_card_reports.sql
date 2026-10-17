-- Tudo Azul — migration 005: relatórios do cartão para a tela (somente leitura)
--
-- O front nunca soma dinheiro: os totais por fatura e o que resta de cada parcela vêm daqui.
-- Duas funções SECURITY INVOKER (a RLS do chamador decide, como os demais relatórios):
--   card_months(p_debt): uma linha por fatura (mês do fechamento) com cobrado, a cobrar e pago.
--   card_items(p_debt, p_month): as parcelas de uma fatura, com "n de N" e o quanto ainda falta cobrar.
-- Nenhuma tabela é alterada.

create function public.card_months(p_debt uuid)
returns table (label text, closing_date date, due_date date, charged numeric, pending numeric,
               total numeric, paid numeric, items integer, invoice_id uuid)
language sql stable security invoker set search_path = '' as $$
  with d as (
    select id, household_id, closing_day, due_day from public.debts
     where id = p_debt and kind = 'card' and (select private.is_member(household_id))
  ), parc as (
    select i.id, i.due_date, i.face,
           coalesce((select sum(case e.kind when 'charge' then e.amount when 'credit' then -e.amount else 0 end)
                       from public.debt_events e
                      where e.installment_id = i.id and e.voided_at is null and e.kind in ('charge', 'credit')), 0) as cobrado,
           i.face - coalesce((select sum(e.amount) from public.debt_events e
                               where e.installment_id = i.id and e.voided_at is null
                                 and e.kind in ('charge', 'cancel')), 0) as resta
      from public.debt_installments i join d on d.household_id = i.household_id and d.id = i.debt_id
  ), meses as (
    select to_char(p.due_date, 'YYYY-MM') as label, min(p.due_date) as closing_date,
           sum(p.cobrado) as charged, sum(p.resta) as pending, count(*)::int as items
      from parc p group by 1
  )
  select m.label, m.closing_date,
         -- mesma regra de private.card_due_date (migration 004), escrita aqui porque este relatório roda
         -- como o chamador, que não executa funções de private: vence no mesmo mês se o dia de vencimento
         -- for depois do de fechamento, senão no mês seguinte; dia inexistente vira o último do mês.
         coalesce(inv.due_date, (
           select make_date(extract(year from b)::int, extract(month from b)::int,
                            least(d.due_day, extract(day from (b + interval '1 month - 1 day'))::int))
             from (select (date_trunc('month', m.closing_date)
                           + case when d.due_day > d.closing_day then interval '0' else interval '1 month' end)::date as b) x
            where d.closing_day is not null)),
         m.charged, m.pending, m.charged + m.pending,
         coalesce((select sum(e.amount) from public.debt_events e
                    where e.invoice_id = inv.id and e.voided_at is null and e.kind = 'payment'), 0),
         m.items, inv.id
    from meses m cross join d
    left join public.debt_invoices inv
      on inv.household_id = d.household_id and inv.debt_id = d.id and inv.label = m.label
   order by m.label
$$;

create function public.card_items(p_debt uuid, p_label text)
returns table (installment_id uuid, plan text, seq integer, plan_count integer, description text,
               purchase_date date, closing_date date, face numeric, remaining numeric, category_id uuid)
language sql stable security invoker set search_path = '' as $$
  select i.id, i.plan, i.seq,
         (select count(*)::int from public.debt_installments x where x.debt_id = i.debt_id and x.plan = i.plan),
         i.description, i.purchase_date, i.due_date, i.face,
         i.face - coalesce((select sum(e.amount) from public.debt_events e
                             where e.installment_id = i.id and e.voided_at is null
                               and e.kind in ('charge', 'cancel')), 0),
         i.category_id
    from public.debt_installments i
   where i.debt_id = p_debt and to_char(i.due_date, 'YYYY-MM') = p_label
     and (select private.is_member(i.household_id))
   order by i.purchase_date nulls first, i.description, i.seq
$$;

revoke execute on function public.card_months(uuid), public.card_items(uuid, text) from public, anon;
grant execute on function public.card_months(uuid), public.card_items(uuid, text) to authenticated;
