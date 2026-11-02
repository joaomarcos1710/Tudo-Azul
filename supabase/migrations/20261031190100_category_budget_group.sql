-- Tudo Azul — migration 032: grupo da regra 50-30-20 nas categorias
--
-- Pedido do dono (02/11/2026), a partir do protótipo de tela: classificar cada categoria de DESPESA em
--   essential (necessidades, meta 50%), lifestyle (desejos, meta 30%) ou investment (poupar/investir, meta 20%)
-- e ver quanto da renda do período foi para cada grupo.
--
-- O que esta migration acrescenta (nada é alterado nem apagado nas migrations anteriores):
--   1. categories.budget_group: nulo = sem grupo (padrão). Só categoria de despesa e que não seja a de sistema.
--      Subcategoria herda o grupo da categoria mãe (a marca da mãe vale; a da filha só vale se a mãe não tem).
--      NENHUMA categoria existente é classificada aqui: quem escolhe é a pessoa (o app só sugere pelo nome).
--   2. budget_rule_report: despesa paga do período por grupo (+ "none" para o que não tem grupo), com o % da
--      despesa e o % da renda. Dinheiro e percentuais saem do banco (o front não soma).
--
-- A marca só muda como a despesa é AGRUPADA no relatório; nenhum saldo, total do mês ou lançamento muda.

alter table public.categories
  add column budget_group text,
  add constraint categories_budget_group_valid check (
    budget_group is null
    or (budget_group in ('essential', 'lifestyle', 'investment') and type = 'expense' and system_key is null));

grant update (budget_group) on public.categories to authenticated;
-- o grant de insert não inclui a coluna nova: categoria nasce sem grupo e é classificada depois (update)

-- Despesa paga do período por grupo. base de renda = receitas pagas do período (regulares + eventuais).
-- share_expense = % da despesa total; share_income = % da renda (nulo se não houve renda). 1 casa decimal.
create function public.budget_rule_report(p_household uuid, p_from date, p_to date)
returns table (grp text, amount numeric, share_expense numeric, share_income numeric)
language sql stable security invoker set search_path = '' as $$
  with itens as (
    select coalesce(p.budget_group, c.budget_group, 'none') as grp, x.amount
      from private.expense_items(p_household, p_from, p_to) x
      join public.categories c on c.household_id = p_household and c.id = x.category_id
      left join public.categories p on p.household_id = c.household_id and p.id = c.parent_id
  ), por_grupo as (
    select g.grp, coalesce(sum(i.amount), 0) as total
      from (values ('essential'), ('lifestyle'), ('investment'), ('none')) g(grp)
      left join itens i on i.grp = g.grp group by g.grp
  ), renda as (
    select coalesce(sum(t.amount), 0) as total
      from public.transactions t
     where t.household_id = p_household and t.type = 'income' and t.status = 'paid'
       and t.deleted_at is null and t.date between p_from and p_to
  )
  select g.grp, g.total,
         case when sum(g.total) over () = 0 then 0 else round(100 * g.total / sum(g.total) over (), 1) end,
         case when r.total = 0 then null else round(100 * g.total / r.total, 1) end
    from por_grupo g cross join renda r
   where (select private.is_member(p_household))
   order by array_position(array['essential', 'lifestyle', 'investment', 'none'], g.grp)
$$;

revoke execute on function public.budget_rule_report(uuid, date, date) from public, anon;
grant execute on function public.budget_rule_report(uuid, date, date) to authenticated;
