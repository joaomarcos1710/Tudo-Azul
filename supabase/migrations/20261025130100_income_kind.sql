-- Tudo Azul — migration 012: renda regular × eventual
--
-- Pedido do dono (25/10/2026), vindo das planilhas antigas (linhas "Receitas Fixas", "Receitas Variáveis"
-- e "Não Tributadas": 13º, férias, PLR, FGTS, restituição). A renda mensal varia muito; a parte eventual
-- distorce qualquer média. A pergunta que o relatório responde: "a renda REGULAR cobre as despesas?".
--
-- O que esta migration acrescenta (nada é alterado nem apagado nas migrations anteriores):
--   1. categories.eventual: marca a categoria de RECEITA como eventual (padrão: regular). Subcategoria
--      herda a marca da categoria mãe. "Sem categoria" nunca é eventual.
--   2. income_regularity: receita regular, receita eventual, despesa e cobertura (% da despesa coberta
--      pela renda regular) de um período. Despesa vem de period_summary (mesma regra do resto do app).
--
-- A marca só muda como a receita é AGRUPADA no relatório; nenhum saldo, total do mês ou lançamento muda.

alter table public.categories
  add column eventual boolean not null default false,
  add constraint categories_eventual_income_only check (not eventual or (type = 'income' and system_key is null));

grant update (eventual) on public.categories to authenticated;
-- o grant de insert não inclui a coluna nova: categoria nasce regular e é marcada depois (update)

create function public.income_regularity(p_household uuid, p_from date, p_to date)
returns table (income_regular numeric, income_eventual numeric, expense_paid numeric, coverage_pct numeric)
language sql stable security invoker set search_path = '' as $$
  select s.reg, s.ev, e.expense_paid,
         case when e.expense_paid > 0 then round(100 * s.reg / e.expense_paid, 1) end
    from (
      select coalesce(sum(t.amount) filter (where not (c.eventual or coalesce(p.eventual, false))), 0) as reg,
             coalesce(sum(t.amount) filter (where c.eventual or coalesce(p.eventual, false)), 0)       as ev
        from public.transactions t
        left join public.categories c on c.household_id = t.household_id and c.id = t.category_id
        left join public.categories p on p.household_id = c.household_id and p.id = c.parent_id
       where t.household_id = p_household and t.deleted_at is null
         and t.type = 'income' and t.status = 'paid'
         and t.date between p_from and p_to
    ) s
   cross join lateral (select ps.expense_paid from public.period_summary(p_household, p_from, p_to) ps) e
   where (select private.is_member(p_household))
$$;

revoke execute on function public.income_regularity(uuid, date, date) from public, anon;
grant execute on function public.income_regularity(uuid, date, date) to authenticated;
