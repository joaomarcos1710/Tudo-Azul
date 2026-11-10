-- Tudo Azul — migration 077: trocar a categoria de um crédito/reembolso de cartão (PR #202)
--
-- Problema (dono, 06/11/2026): 31 créditos de cartão (debt_events.kind = 'income_credit', "Estorno de IOF") estão em
-- "Outras receitas" e precisam ir para a subcategoria nova "Estorno de IOF" (marcada "não conta como consumo", 071).
-- O evento de dívida é imutável (private.debt_events_guard, migration 013: só voided_at/voided_by/void_reason mudam, o
-- resto é 42501) e anular + recriar não serve: 14 estão em faturas pagas, que a trava da 064 (card_paid_invoice_lock)
-- não deixa mexer.
--
-- Desenho (o menor caminho, pelos padrões que o projeto já tem):
--   * public.card_credit_set_category(p_events uuid[], p_category uuid) returns integer — em lote, tudo ou nada, como
--     transactions_bulk_set_category (053): troca SÓ category_id de eventos income_credit da família de quem chama.
--     Devolve quantos mudaram de fato (o que já estava na categoria pedida não conta nem é regravado).
--   * SECURITY DEFINER, como toda escrita em debt_events (authenticated só tem SELECT na tabela: card_credit_income,
--     debt_void, card_installment_edit…): com SECURITY INVOKER o UPDATE seria recusado pelo grant, e abrir grant de coluna
--     + policy de UPDATE para o cliente criaria um caminho de escrita direto que hoje não existe. As checagens são as de
--     sempre: autenticado, private.debt_lock em cada cartão dos eventos (membro da família + FOR UPDATE), todos os
--     eventos existem, da mesma família, income_credit, não anulados; categoria da família, de RECEITA e ativa (a mesma
--     regra de card_credit_income: "Sem categoria" de receita não é proibida lá, então não é aqui).
--   * A brecha no guard é a marca de sessão app.card_credit_category = 'on', ligada por set_config(..., true) (local à
--     transação) SÓ dentro da RPC, em volta do UPDATE — o mesmo padrão de app.card_edit (card_installment_edit, 017),
--     app.debt_anchor_edit (card_set_start, 051) e app.service_read (daily_digest_service, 050). O cliente não alcança
--     set_config pelo PostgREST (só funções do schema public). Com a marca ligada, o guard aceita a troca de category_id
--     APENAS em kind = 'income_credit'; qualquer outra coluna (amount, date, invoice_id, category_type, note…) continua
--     42501, com ou sem a marca. category_type fica imutável: no income_credit é sempre 'income'
--     (debt_events_income_credit_shape) e a FK composta (household_id, category_id, category_type) garante que a categoria
--     nova é de receita da mesma família.
--   * Fatura paga NÃO impede (decisão registrada em 30 - Decisões): a trava da 064 protege total e pago da fatura
--     (valores e datas); a categoria é só classificação, não entra em card_months nem no saldo do cartão. A RPC não
--     chama private.card_paid_lock_check porque nada que ela lê muda.
--
-- Códigos: 42501 não autenticado / evento não encontrado ou de outra família; 22023 parâmetro; 55000 evento anulado;
-- 23514 evento que não é crédito avulso ou categoria inválida. Testes: 77_card_credit_set_category; 00_audit.

-- ---------------------------------------------------------------------------
-- 1. Guard: recriado a partir do corpo da 055 (20261104235100_account_currency.sql, "debt_events_guard (create or
--    replace da 052)"). Única diferença: category_id sai da tupla comparada e ganha a regra própria logo abaixo.
-- ---------------------------------------------------------------------------
create or replace function private.debt_events_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.amount is not null then
      if new.amount <> round(new.amount,2) then
        raise exception 'valor com mais de 2 casas decimais: %',new.amount using errcode = '22003';
      end if;
      new.amount := round(new.amount,2);
    end if;
    if new.account_id is not null and exists (
      select 1 from public.accounts a
      where a.household_id=new.household_id and a.id=new.account_id and not a.active
    ) then
      raise exception 'conta desativada' using errcode = '23514';
    end if;
    perform private.account_brl_only(new.household_id, new.account_id);
    return new;
  end if;
  if old.voided_at is not null then
    raise exception 'evento já anulado não pode ser alterado' using errcode = '55000';
  end if;
  if (new.id,new.household_id,new.debt_id,new.date,new.kind,new.amount,new.account_id,new.installment_id,
      new.invoice_id,new.op_id,new.note,new.created_by,new.created_at,new.schedule_id,
      new.category_type,new.credit_date)
     is distinct from
     (old.id,old.household_id,old.debt_id,old.date,old.kind,old.amount,old.account_id,old.installment_id,
      old.invoice_id,old.op_id,old.note,old.created_by,old.created_at,old.schedule_id,
      old.category_type,old.credit_date) then
    raise exception 'evento é imutável: use a anulação' using errcode = '42501';
  end if;
  -- migration 077: a categoria do crédito avulso muda só pela RPC card_credit_set_category (marca de sessão)
  if new.category_id is distinct from old.category_id
     and not (old.kind = 'income_credit' and coalesce(current_setting('app.card_credit_category', true), '') = 'on') then
    raise exception 'evento é imutável: use a anulação' using errcode = '42501';
  end if;
  return new;
end
$$;

revoke execute on function private.debt_events_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. RPC
-- ---------------------------------------------------------------------------
create function public.card_credit_set_category(p_events uuid[], p_category uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
  v_achados integer;
  v_familias integer;
  v_familia uuid;
  v_debt uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'não autenticado' using errcode = '42501';
  end if;
  if p_events is null or cardinality(p_events) = 0 then
    raise exception 'escolha ao menos um crédito' using errcode = '22023';
  end if;
  if array_position(p_events, null) is not null then
    raise exception 'lista de créditos com item vazio' using errcode = '22023';
  end if;
  select count(distinct x) into v_n from unnest(p_events) as x;
  if v_n > 500 then
    raise exception 'no máximo 500 créditos por vez (foram %)', v_n using errcode = '22023';
  end if;
  if p_category is null then
    raise exception 'escolha a categoria' using errcode = '22023';
  end if;

  -- trava cada cartão envolvido (membro da família + FOR UPDATE, como as outras RPCs de dívida). Evento de outra
  -- família cai aqui como "registro não encontrado", sem dizer se o id existe.
  for v_debt in select distinct e.debt_id from public.debt_events e where e.id = any (p_events) order by 1 loop
    perform private.debt_lock(v_debt);
  end loop;
  perform 1 from public.debt_events e where e.id = any (p_events) order by e.id for update;
  select count(*), count(distinct e.household_id), min(e.household_id::text)::uuid
    into v_achados, v_familias, v_familia
    from public.debt_events e where e.id = any (p_events);
  if v_achados <> v_n then
    raise exception 'crédito não encontrado' using errcode = '42501';
  end if;
  if v_familias <> 1 or not private.is_member(v_familia) then
    raise exception 'crédito não encontrado' using errcode = '42501';
  end if;
  if exists (select 1 from public.debt_events e where e.id = any (p_events) and e.kind <> 'income_credit') then
    raise exception 'só crédito ou reembolso avulso do cartão troca de categoria' using errcode = '23514';
  end if;
  if exists (select 1 from public.debt_events e where e.id = any (p_events) and e.voided_at is not null) then
    raise exception 'há crédito anulado na seleção' using errcode = '55000';
  end if;
  if not exists (
    select 1 from public.categories c
     where c.household_id = v_familia and c.id = p_category and c.type = 'income' and c.active
  ) then
    raise exception 'categoria de receita inválida ou inativa' using errcode = '23514';
  end if;

  perform set_config('app.card_credit_category', 'on', true);
  update public.debt_events e set category_id = p_category
   where e.id = any (p_events) and e.category_id is distinct from p_category;
  get diagnostics v_n = row_count;
  perform set_config('app.card_credit_category', 'off', true);
  return v_n;
end $$;

revoke execute on function public.card_credit_set_category(uuid[], uuid) from public, anon;
grant execute on function public.card_credit_set_category(uuid[], uuid) to authenticated;
