-- Tudo Azul — migration 139: total do rodapé de Lançamentos com filtro ligado (handoff "Extrato e Gastos", PR 3).
--
-- Decisões do dono (17/11/2026):
--   * com filtro de tipo, categoria, situação, cartão, fixos ou parcelados, o rodapé mostra o total do filtro;
--   * soma lançamentos e compras do cartão (a mesma regra da busca, migration 138); juros, tarifa, parcelas de
--     empréstimo e pagamento de fatura ficam fora do total e a tela diz isso;
--   * pagos e previstos juntos (uma compra de cartão não vira "paga" por conta da fatura).
--
-- O que muda: public.ledger_search passa a aceitar p_query nulo = sem filtro de texto (só os outros filtros). As duas
-- funções da 138 já têm os mesmos filtros da lista; assim o total do filtro e o da busca são a mesma conta e não há
-- função nova (ledger_search_totals não muda: soma sobre ledger_search). Texto em branco ('' ou só espaços) continua
-- recusado: nulo é "não busquei", branco é engano. A 138 já está aplicada e não é editada: esta migration recria
-- ledger_search com a mesma assinatura (create or replace).
-- Teste: 131_ledger_filter_totals (falha sem esta migration); o 130 continua valendo.

create or replace function public.ledger_search(
  p_household uuid, p_from date, p_to date, p_query text,
  p_account uuid default null, p_category uuid default null, p_type text default null, p_status text default null,
  p_card uuid default null, p_fixed boolean default false, p_installments boolean default false)
returns table (source text, id uuid, kind text, amount numeric, currency_code text)
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_q text := btrim(coalesce(p_query, ''));
  v_pat text;
begin
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'período inválido' using errcode = '22023';
  end if;
  if p_query is not null and (v_q = '' or char_length(v_q) > 100) then
    raise exception 'texto da busca vazio ou longo demais' using errcode = '22023';
  end if;
  -- sem acento e em minúsculas dos dois lados; % _ e \ digitados valem como texto, não como curinga; nulo = sem texto
  if p_query is not null then
    v_pat := '%' || replace(replace(replace(lower(translate(v_q,
               'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
               'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  return query
  select 'transaction'::text, t.id, t.type, t.amount, a.currency_code
    from public.transactions t
    join public.accounts a on a.household_id = t.household_id and a.id = t.account_id
   where t.household_id = p_household and t.deleted_at is null and t.date between p_from and p_to
     and p_card is null
     and (p_account is null or t.account_id = p_account or t.destination_account_id = p_account)
     and (p_category is null or t.category_id = p_category)
     and (p_type is null or t.type = p_type)
     and (p_status is null or t.status = p_status)
     and (not coalesce(p_fixed, false) or t.recurrence_id is not null)
     and (not coalesce(p_installments, false) or t.installment_group is not null)
     and (v_pat is null
       or lower(translate(t.description,
            'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
            'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')) like v_pat
       or lower(translate(coalesce(t.notes, ''),
            'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
            'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')) like v_pat)
     and (select private.is_member(p_household))
  union all
  select 'card'::text, ci.installment_id, 'expense'::text, ci.face, 'BRL'::text
    from public.debts d
   cross join lateral public.card_months(d.id) m
   cross join lateral public.card_items(d.id, m.label) ci
   where d.household_id = p_household and d.kind = 'card'
     and m.due_date between p_from and p_to
     and (p_type is null or p_type = 'expense')
     and p_status is null and not coalesce(p_fixed, false) and not coalesce(p_installments, false)
     and (p_account is null or d.pay_account_id = p_account)
     and (p_card is null or d.id = p_card)
     and (p_category is null or ci.category_id = p_category)
     and (v_pat is null
       or lower(translate(coalesce(ci.description, ''),
            'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
            'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')) like v_pat)
     and (select private.is_member(p_household));
end $$;
