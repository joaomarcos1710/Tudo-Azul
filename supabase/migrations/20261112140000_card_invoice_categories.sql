-- Tudo Azul — migration 112: despesas por categoria de UMA fatura de cartão (somente leitura)
--
-- Pedido do dono (12/11/2026, referência Organizze): na página da fatura, um botão "Categorias" abre as despesas da fatura
-- por categoria. O banco só tinha o total por categoria por PERÍODO (expenses_by_category*), nunca por fatura, e o front
-- não soma dinheiro de relatório: esta função devolve os totais e os percentuais prontos.
--
-- Valor = o MESMO da fatura. Parte de public.card_items (a lista da fatura): líquido da parcela = valor − cancelado −
-- estornado, parcela totalmente cancelada fora, só parcelas com vencimento (fechamento) no mês do rótulo. É exatamente a
-- parcela de card_months (cobrado − estorno + a cobrar), então
--     soma das categorias = card_months.charged + card_months.pending   (e = card_months.total + card_months.credits
--     quando a fatura não foi zerada pelos créditos avulsos).
-- Decisões (30 - Decisões):
--   * crédito/reembolso AVULSO (income_credit) NÃO entra: é receita (migration 052), não abate despesa de categoria. Por isso
--     a coluna total (soma das categorias) pode passar de card_months.total, que já desconta esses créditos. Estorno de uma
--     compra (kind credit) ENTRA, abatendo a categoria da compra.
--   * assinatura PREVISTA (card_pending_subscriptions) NÃO entra: ainda não é parcela, e card_months também não a conta.
--   * fatura paga/travada continua consultável (só leitura).
-- Agrupa pela categoria RAIZ (subcategoria soma na mãe), como expenses_by_category. Categoria que zera (compra estornada
-- por inteiro) não aparece. share = % do total, 1 casa (a soma pode dar 99,9 ou 100,1). total = soma das categorias,
-- repetida em cada linha (o front só mostra, não soma).
-- SECURITY INVOKER: a RLS do chamador decide; cartão de outra família, rótulo inexistente ou dívida que não é cartão: vazio.

create function public.card_invoice_categories(p_debt uuid, p_label text)
returns table (category_id uuid, name text, amount numeric, share numeric, total numeric)
language sql stable security invoker set search_path = '' as $$
  with cartao as (
    select d.id, d.household_id from public.debts d
     where d.id = p_debt and d.kind = 'card' and (select private.is_member(d.household_id))
  ), por_raiz as (
    select r.id as raiz, r.name, sum(x.face) as soma
      from cartao d
     cross join lateral public.card_items(d.id, p_label) x
      join public.categories c on c.household_id = d.household_id and c.id = x.category_id
      join public.categories r on r.household_id = d.household_id and r.id = coalesce(c.parent_id, c.id)
     group by r.id, r.name
    having sum(x.face) <> 0
  )
  select p.raiz, p.name, p.soma,
         round(100 * p.soma / sum(p.soma) over (), 1),
         sum(p.soma) over ()
    from por_raiz p
   order by p.soma desc, p.name
$$;

revoke execute on function public.card_invoice_categories(uuid, text) from public, anon;
grant execute on function public.card_invoice_categories(uuid, text) to authenticated;
