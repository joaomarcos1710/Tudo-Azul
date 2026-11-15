-- 127: detalhe de UMA categoria de despesa, para o dono abrir uma barra do gráfico e ver o que a compõe.
--
-- Problema (revisão de 15/11/2026): a barra "Mercado R$ 150" soma a mãe e as filhas, usa o fechamento da fatura do cartão,
-- só pago, só reais e estorno na data do estorno. A lista de Lançamentos filtra por categoria exata e põe o cartão no
-- vencimento: lista e barra NÃO batem. Reimplementar a regra no front duplicaria a regra de despesa e somaria dinheiro lá.
--
-- Solução: ler os MESMOS itens da barra (private.expense_items_basis, que parte de private.expense_items) e devolvê-los
-- agrupados por dia e categoria, com o total já somado no banco. Barra e detalhe usam o mesmo código e batem por construção.
-- Nenhuma regra de despesa é copiada: qualquer mudança futura em expense_items vale aqui também.
--
-- public.expense_category_detail(p_household, p_from, p_to, p_category, p_basis default 'invoice')
--   p_category: a categoria RAIZ da barra (subcategorias entram: coalesce(parent_id, id) = p_category).
--   retorno: day, category_id, name (da categoria do item), parent_name (nulo se for a raiz), amount (soma do dia nessa
--   categoria; linhas que somam zero ficam de fora) e total (soma de TODAS as linhas, igual à barra, calculada aqui).
--   p_basis fora de ('invoice','purchase','installment') ou nulo: 22023. Quem não é da família recebe zero linhas.
-- atalho: sem descrição do lançamento, porque private.expense_items devolve só (dia, categoria, valor), sem o id da origem;
--   melhorar quando expense_items puder carregar a origem (exige recriar a função e as que dependem dela).
-- Teste: 121_expense_category_detail (falha sem esta migration).

create function public.expense_category_detail(p_household uuid, p_from date, p_to date, p_category uuid,
                                               p_basis text default 'invoice')
returns table (day date, category_id uuid, name text, parent_name text, amount numeric, total numeric)
language plpgsql stable security invoker set search_path = '' as $$
#variable_conflict use_column
begin
  if p_basis is null or p_basis not in ('invoice', 'purchase', 'installment') then
    raise exception 'base inválida: use invoice, purchase ou installment' using errcode = '22023';
  end if;
  return query
  with itens as (
    select x.day, x.category_id, sum(x.amount) as amount
      from private.expense_items_basis(p_household, p_from, p_to, p_basis) x
      join public.categories c on c.household_id = p_household and c.id = x.category_id
     where coalesce(c.parent_id, c.id) = p_category
     group by x.day, x.category_id
    having sum(x.amount) <> 0
  )
  select i.day, i.category_id, c.name, p.name, i.amount, sum(i.amount) over ()
    from itens i
    join public.categories c on c.household_id = p_household and c.id = i.category_id
    left join public.categories p on p.household_id = p_household and p.id = c.parent_id
   where (select private.is_member(p_household))
   order by i.day desc, c.name;
end $$;

revoke execute on function public.expense_category_detail(uuid, date, date, uuid, text) from public, anon;
grant execute on function public.expense_category_detail(uuid, date, date, uuid, text) to authenticated;
