-- Tudo Azul — migration 008: relatórios do painel (somente leitura)
--
-- Para a nova Visão geral (gráficos): despesas do período por categoria e por dia.
-- Mesma definição de despesa paga do period_summary (migration 002):
--   lançamentos de despesa pagos e fora da lixeira
--   + cobranças de parcela de cartão (charge) − estornos (credit) + juros e tarifas de dívida.
-- Invariante (testada em pgTAP): soma por categoria = soma por dia = period_summary.expense_paid.
-- SECURITY INVOKER: a RLS do chamador decide; quem não é membro recebe zero linhas.
-- Nenhuma tabela é alterada.

create function private.expense_items(p_household uuid, p_from date, p_to date)
returns table (day date, category_id uuid, amount numeric)
language sql stable security invoker set search_path = '' as $$
  select t.date, t.category_id, t.amount
    from public.transactions t
   where t.household_id = p_household and t.type = 'expense' and t.status = 'paid'
     and t.deleted_at is null and t.date between p_from and p_to
  union all
  select e.date, coalesce(e.category_id, i.category_id),
         case when e.kind = 'credit' then -e.amount else e.amount end
    from public.debt_events e
    left join public.debt_installments i on i.household_id = e.household_id and i.id = e.installment_id
   where e.household_id = p_household and e.voided_at is null
     and e.kind in ('charge', 'credit', 'interest', 'fee') and e.date between p_from and p_to
$$;
revoke execute on function private.expense_items(uuid, date, date) from public, anon;
grant execute on function private.expense_items(uuid, date, date) to authenticated;

-- Despesas por categoria RAIZ (subcategoria soma na categoria-mãe), maior primeiro.
-- p_top: mostra as N maiores e junta o resto numa linha "Outros" (category_id nulo), para o gráfico
-- não somar dinheiro no front. share = % do total do período, 1 casa (a soma pode dar 99,9 ou 100,1).
create function public.expenses_by_category(p_household uuid, p_from date, p_to date, p_top integer default null)
returns table (category_id uuid, name text, amount numeric, share numeric)
language sql stable security invoker set search_path = '' as $$
  with itens as (
    select coalesce(c.parent_id, c.id) as raiz, x.amount
      from private.expense_items(p_household, p_from, p_to) x
      join public.categories c on c.household_id = p_household and c.id = x.category_id
  ), por_raiz as (
    select r.raiz, c.name, sum(r.amount) as total
      from itens r join public.categories c on c.household_id = p_household and c.id = r.raiz
     group by r.raiz, c.name
  ), ordenado as (
    select *, row_number() over (order by total desc, name) as pos from por_raiz
  ), dobrado as (
    select case when p_top is null or pos <= p_top then raiz end as raiz,
           case when p_top is null or pos <= p_top then name else 'Outros' end as name,
           case when p_top is null or pos <= p_top then pos else p_top + 1 end as pos,
           total
      from ordenado
  ), final as (
    select raiz, name, pos, sum(total) as total from dobrado group by raiz, name, pos
  )
  select f.raiz, f.name, f.total,
         case when sum(f.total) over () = 0 then 0 else round(100 * f.total / sum(f.total) over (), 1) end
    from final f
   where (select private.is_member(p_household))
   order by f.pos
$$;

-- Despesa de cada dia do período e o acumulado (dias sem despesa aparecem com zero).
create function public.daily_expenses(p_household uuid, p_from date, p_to date)
returns table (day date, amount numeric, cumulative numeric)
language sql stable security invoker set search_path = '' as $$
  with dias as (
    select d::date as day from generate_series(p_from, p_to, interval '1 day') d
  ), por_dia as (
    select x.day, sum(x.amount) as total from private.expense_items(p_household, p_from, p_to) x group by x.day
  )
  select d.day, coalesce(p.total, 0), sum(coalesce(p.total, 0)) over (order by d.day)
    from dias d left join por_dia p on p.day = d.day
   where (select private.is_member(p_household)) and p_to - p_from <= 366
   order by d.day
$$;

revoke execute on function public.expenses_by_category(uuid, date, date, integer), public.daily_expenses(uuid, date, date)
  from public, anon;
grant execute on function public.expenses_by_category(uuid, date, date, integer), public.daily_expenses(uuid, date, date)
  to authenticated;
