-- Tudo Azul — migration 062: base dos gastos de cartão nos relatórios POR CATEGORIA (fatura, compra ou parcela).
-- Decisão do dono (05/11/2026, inspirada no Organizze: "Gastos de cartão com base na: data da fatura / data da compra /
-- data da parcela"). Vale SÓ para o relatório de despesas por categoria. Totais do mês, orçamento, saldo,
-- period_summary, projeções e o resultado continuam SEMPRE pela fatura (nenhuma dessas funções muda aqui).
--
-- Bases:
--   * 'invoice' (padrão, a de sempre): exatamente private.expense_items (046/056) — a parcela é despesa no mês do
--     FECHAMENTO da fatura, quando é cobrada (evento 'charge'); estorno ('credit') abate na data dele.
--   * 'purchase': o valor inteiro da compra (todas as parcelas, LÍQUIDAS: face − cancelado − estornado) na DATA DA COMPRA.
--   * 'installment': cada parcela líquida na data da compra + (n − 1) meses (dia limitado ao fim do mês, como
--     date + interval do PostgreSQL), independente do fechamento.
--   Nas bases 'purchase' e 'installment' a parcela conta mesmo antes de a fatura fechar (a compra já foi feita); na
--   'invoice' só a cobrada (como hoje). Por isso, no mês corrente, as bases podem somar valores diferentes.
--
-- Quais parcelas mudam de data: só as de COMPRA de cartão — debt_installments de dívida kind = 'card', com
-- purchase_date, SEM recurrence_id (assinatura de cartão fica pela fatura nas três bases: uma cobrança por mês) e com
-- fechamento depois da data de referência do cartão (a mesma regra de card_bill_due; antes disso nunca é cobrada).
-- Todo o resto (lançamentos fora do cartão, só de contas BRL; juros e tarifas; principal de empréstimo; parcelas sem
-- data de compra) é igual nas três bases.
--
-- Desenho (sem copiar a regra de despesa): private.expense_items_basis parte de private.expense_items e, nas bases
-- 'purchase'/'installment', TIRA as cobranças e estornos dessas parcelas (que estão na data do fechamento/estorno) e
-- PÕE o valor líquido delas na data da base. Assim qualquer mudança futura em expense_items vale aqui também.
-- Lixeira (deleted_at) e anulados (voided_at) seguem fora: expense_items já filtra; o líquido só soma eventos vivos.
--
-- Funções novas (nenhuma é recriada; expenses_by_category continua com a mesma assinatura e o mesmo corpo):
--   private.expense_items_basis(p_household, p_from, p_to, p_basis)
--   public.expenses_by_category_basis(p_household, p_from, p_to, p_basis, p_top default null)
--     mesmo retorno de expenses_by_category (category_id, name, amount, share), mesmo p_top/"Outros".
--     p_basis fora de ('invoice','purchase','installment') ou nulo: 22023.
-- Teste: 62_card_expense_basis (falha sem esta migration).

create function private.expense_items_basis(p_household uuid, p_from date, p_to date, p_basis text)
returns table (day date, category_id uuid, amount numeric)
language sql stable security invoker set search_path = '' as $$
  with compra as (
    -- parcelas de compra de cartão que mudam de data fora da base 'invoice'
    select i.id, i.category_id, i.face, i.seq, i.purchase_date
      from public.debt_installments i
      join public.debts d on d.household_id = i.household_id and d.id = i.debt_id
     where i.household_id = p_household and p_basis in ('purchase', 'installment')
       and d.kind = 'card' and i.purchase_date is not null and i.recurrence_id is null
       and i.due_date > d.reference_date
  )
  select x.day, x.category_id, x.amount from private.expense_items(p_household, p_from, p_to) x
  union all
  -- tira a cobrança/estorno dessas parcelas da data do fechamento (mesmo valor e categoria de expense_items)
  select e.date, coalesce(e.category_id, c.category_id),
         case when e.kind = 'credit' then e.amount else -e.amount end
    from public.debt_events e
    join compra c on c.id = e.installment_id
   where e.household_id = p_household and e.voided_at is null
     and e.kind in ('charge', 'credit') and e.date between p_from and p_to
  union all
  -- põe o valor líquido (face − cancelado − estornado) na data da base
  select b.dia, c.category_id,
         c.face - coalesce((select sum(e.amount) from public.debt_events e
                             where e.household_id = p_household and e.installment_id = c.id
                               and e.kind in ('cancel', 'credit') and e.voided_at is null), 0)
    from compra c
   cross join lateral (
     select case when p_basis = 'purchase' then c.purchase_date
                 else (c.purchase_date + make_interval(months => c.seq - 1))::date end as dia
   ) b
   where b.dia between p_from and p_to
$$;

revoke execute on function private.expense_items_basis(uuid, date, date, text) from public, anon;
grant execute on function private.expense_items_basis(uuid, date, date, text) to authenticated;

-- Despesas por categoria RAIZ com a base escolhida. Corpo igual ao de expenses_by_category (migration 008), lendo
-- private.expense_items_basis. Na base 'invoice' devolve o mesmo que expenses_by_category, com uma diferença: categoria
-- com soma ZERO não aparece (nas outras bases a cobrança tirada do mês e o valor posto em outro mês deixariam linhas
-- "R$ 0,00" no gráfico).
create function public.expenses_by_category_basis(p_household uuid, p_from date, p_to date, p_basis text,
                                                  p_top integer default null)
returns table (category_id uuid, name text, amount numeric, share numeric)
language plpgsql stable security invoker set search_path = '' as $$
#variable_conflict use_column
begin
  if p_basis is null or p_basis not in ('invoice', 'purchase', 'installment') then
    raise exception 'base inválida: use invoice, purchase ou installment' using errcode = '22023';
  end if;
  return query
  with itens as (
    select coalesce(c.parent_id, c.id) as raiz, x.amount
      from private.expense_items_basis(p_household, p_from, p_to, p_basis) x
      join public.categories c on c.household_id = p_household and c.id = x.category_id
  ), por_raiz as (
    select r.raiz, c.name, sum(r.amount) as total
      from itens r join public.categories c on c.household_id = p_household and c.id = r.raiz
     group by r.raiz, c.name
    having sum(r.amount) <> 0
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
         case when sum(f.total) over () = 0 then 0::numeric else round(100 * f.total / sum(f.total) over (), 1) end
    from final f
   where (select private.is_member(p_household))
   order by f.pos;
end $$;

revoke execute on function public.expenses_by_category_basis(uuid, date, date, text, integer) from public, anon;
grant execute on function public.expenses_by_category_basis(uuid, date, date, text, integer) to authenticated;
