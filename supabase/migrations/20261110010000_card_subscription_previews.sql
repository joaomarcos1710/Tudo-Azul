-- Tudo Azul — recorrência no cartão, fatia 1 ("Ver"): listar as ocorrências previstas de uma fatura
--
-- Pedido do dono (10/11/2026): a recorrência no cartão não aparece na fatura antes do dia da cobrança; ele quer vê-la
-- "lançada no dia certo" (plano em docs/projeto/28). Hoje a fatura só mostra o total "Assinaturas previstas"
-- (card_pending_subscriptions). Esta função devolve CADA ocorrência prevista de uma fatura, com descrição e valor.
--
-- Não grava nada e não mexe em parcela (imutável) nem em limite: as ocorrências continuam derivadas da regra, como em
-- private.card_recurrence_pending (mesma regra: ciclo do mês da fatura, só depois da data de referência do cartão, e só
-- as que ainda não viraram parcela). A soma das linhas de uma fatura é igual ao total de card_pending_subscriptions para
-- a fatura aberta (o teste 86 confere), então o app mostra as linhas sem somar nada no navegador.
--
-- p_label = AAAA-MM do mês do FECHAMENTO da fatura (o mesmo rótulo de card_months/card_items).
-- SECURITY INVOKER: a RLS de debts, recurrences e debt_installments vale; quem não é da família recebe 0 linhas.

create or replace function public.card_subscription_previews(p_debt uuid, p_label text)
returns table (recurrence_id uuid, occurrence_date date, description text, amount numeric,
               category_id uuid, closing_date date)
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_d public.debts%rowtype; v_closing date;
begin
  if p_label is null or p_label !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'fatura inválida: use AAAA-MM' using errcode = '22023';
  end if;
  select * into v_d from public.debts where id = p_debt and kind = 'card';
  if not found or v_d.closing_day is null or not (select private.is_member(v_d.household_id)) then
    return;
  end if;
  v_closing := private.card_cycle_closing(v_d, (p_label || '-01')::date);
  return query
  select r.id, o.occ, r.description, r.amount, r.category_id, v_closing
    from public.recurrences r
   cross join lateral private.recurrence_occurrences(r, (date_trunc('month', v_closing) - interval '1 month')::date, v_closing) o(occ)
   where r.household_id = v_d.household_id and r.kind = 'card' and r.debt_id = v_d.id and r.active
     and o.occ > v_d.reference_date
     and private.card_cycle_first(v_d, o.occ) = v_closing
     and not exists (select 1 from public.debt_installments i
                      where i.recurrence_id = r.id and i.occurrence_date = o.occ)
   order by o.occ, r.description, r.id;
end $$;

revoke execute on function public.card_subscription_previews(uuid, text) from public, anon;
grant execute on function public.card_subscription_previews(uuid, text) to authenticated;
