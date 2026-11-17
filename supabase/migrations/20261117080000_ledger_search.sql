-- Tudo Azul — migration 138: busca em Lançamentos (handoff "Extrato e Gastos", PR 2).
--
-- Decisões do dono (17/11/2026):
--   * a busca vale no PERÍODO da tela e respeita os outros filtros (não procura em todo o histórico);
--   * procura na descrição e na observação, sem diferença de maiúscula nem de acento;
--   * as compras do cartão entram, com as da conta (cada parcela pela fatura do período);
--   * o resultado traz o total de entradas e de saídas, somado aqui (a tela não soma dinheiro).
--
-- public.ledger_search(p_household, p_from, p_to, p_query, filtros...): o que a busca acha, uma linha por item.
--   source = 'transaction' (lançamento de conta) ou 'card' (parcela de compra do cartão);
--   id     = id do lançamento ou da parcela (debt_installments.id, o installment_id de card_items);
--   kind   = income | expense | transfer (a parcela do cartão é sempre expense);
--   amount = valor como a tela mostra: o do lançamento; na parcela, o face de card_items (já sem cancelamento e crédito);
--   currency_code = moeda da conta do lançamento; cartão em reais.
-- Os mesmos critérios da lista de Lançamentos (src/lib/lancamentos.ts):
--   * lançamento: fora da lixeira, data no período; conta = origem OU destino; categoria, tipo, situação, fixos
--     (recurrence_id) e parcelados (installment_group) iguais aos da consulta da tela; com filtro de cartão, nenhum
--     lançamento (a tela mostra só o cartão);
--   * cartão: parcelas das faturas que VENCEM no período (card_months.due_date), as mesmas linhas de card_items; nada com
--     filtro de receita ou transferência, nem com situação, fixos ou parcelados (que valem só para lançamentos); conta =
--     conta de pagamento do cartão; categoria e cartão filtram a parcela.
-- Fica de fora (não está no que o dono pediu; a tela avisa): pagamento de fatura e parcelas de empréstimo (movimentos de
-- dívida) e créditos avulsos do cartão.
-- atalho: a busca é "contém" (like '%texto%'), sem índice; vale para um período de meses, que é o caso da tela. Medir
-- antes de pôr índice (pg_trgm) se a busca ficar lenta com períodos longos.
--
-- public.ledger_search_totals(mesmos parâmetros): quantidade, entradas e saídas POR MOEDA, somadas sobre ledger_search
-- (a mesma lista que a tela mostra, então total e lista não divergem). Transferência conta na quantidade, não nos valores.
-- Teste: 130_ledger_search (falha sem esta migration).

create function public.ledger_search(
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
  if v_q = '' or char_length(v_q) > 100 then
    raise exception 'texto da busca vazio ou longo demais' using errcode = '22023';
  end if;
  -- sem acento e em minúsculas dos dois lados; % _ e \ digitados valem como texto, não como curinga
  v_pat := '%' || replace(replace(replace(lower(translate(v_q,
             'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
             'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')), '\', '\\'), '%', '\%'), '_', '\_') || '%';
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
     and (lower(translate(t.description,
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
     and lower(translate(coalesce(ci.description, ''),
           'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
           'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')) like v_pat
     and (select private.is_member(p_household));
end $$;

create function public.ledger_search_totals(
  p_household uuid, p_from date, p_to date, p_query text,
  p_account uuid default null, p_category uuid default null, p_type text default null, p_status text default null,
  p_card uuid default null, p_fixed boolean default false, p_installments boolean default false)
returns table (currency_code text, item_count integer, income numeric, expense numeric)
language sql stable security invoker set search_path = '' as $$
  select s.currency_code, count(*)::integer,
         coalesce(sum(s.amount) filter (where s.kind = 'income'), 0),
         coalesce(sum(s.amount) filter (where s.kind = 'expense'), 0)
    from public.ledger_search(p_household, p_from, p_to, p_query, p_account, p_category, p_type, p_status,
                              p_card, p_fixed, p_installments) s
   group by s.currency_code
   order by s.currency_code <> 'BRL', s.currency_code
$$;

revoke execute on function public.ledger_search(uuid, date, date, text, uuid, uuid, text, text, uuid, boolean, boolean) from public, anon;
grant execute on function public.ledger_search(uuid, date, date, text, uuid, uuid, text, text, uuid, boolean, boolean) to authenticated;
revoke execute on function public.ledger_search_totals(uuid, date, date, text, uuid, uuid, text, text, uuid, boolean, boolean) from public, anon;
grant execute on function public.ledger_search_totals(uuid, date, date, text, uuid, uuid, text, text, uuid, boolean, boolean) to authenticated;
