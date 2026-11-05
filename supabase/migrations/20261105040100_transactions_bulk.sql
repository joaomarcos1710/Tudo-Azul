-- Tudo Azul — migration 060: edição em lote de lançamentos (Lançamentos no computador, PR #168)
--
-- Pedido do dono (05/11/2026, inspirado no Mobills): selecionar vários lançamentos e, numa ação só, mudar a categoria,
-- marcar como pago ou mandar para a lixeira — com "Desfazer" logo depois.
--
-- Regras (todas as funções):
--   * SECURITY INVOKER: a RLS e os grants de coluna do chamador valem (as mesmas do UPDATE que a tela já faz). Não há
--     caminho novo de escrita: cada função é só um UPDATE em `transactions`, então os gatilhos de sempre rodam linha a
--     linha (transactions_guard: centavos, conta desativada ao restaurar, abertura da conta, moeda da transferência;
--     transactions_period_guard: período conciliado; FK composta da categoria: categoria do mesmo tipo e da mesma família).
--   * Tudo ou nada: é uma instrução por chamada, dentro da transação da RPC; qualquer recusa desfaz todas as linhas.
--   * Todos os ids precisam existir, estar visíveis para quem chama (membro da família, pela RLS) e ser da MESMA família;
--     id repetido conta uma vez; nulo é recusado; no máximo 500 ids distintos por chamada.
--   * Devolvem quantos lançamentos foram de fato alterados (o que já estava no estado pedido não conta nem é regravado).
--   * Só `transactions`: fatura e compra de cartão (debt_installments) não entram aqui.
--
-- Funções:
--   transactions_bulk_set_category(p_ids, p_category)  receita e despesa; transferência recusada (não tem categoria);
--                                                       categoria de outro tipo recusada com mensagem clara.
--   transactions_bulk_mark_paid(p_ids, p_date)         planejado → pago na data p_date (nula = mantém a data de cada um).
--                                                       O valor fica como está (no "Marcar pago" de um só, a pessoa
--                                                       confirma o valor real; em lote não há como, então só a data).
--   transactions_bulk_mark_planned(p_ids, p_dates)     o "Desfazer" do pago: volta a planejado, cada um na data que tinha
--                                                       (p_dates na mesma ordem de p_ids).
--   transactions_bulk_trash(p_ids)                     lixeira (deleted_at), como a exclusão de um só.
--   transactions_bulk_restore(p_ids)                   o "Desfazer" da lixeira.
-- Lançamento na lixeira é recusado em mudar categoria e marcar pago/planejado.
-- Códigos: 22023 parâmetro; 42501 não encontrado/sem acesso; 55000 na lixeira; 23514 regra (tipo de categoria) e os
-- dos gatilhos. Testes: 60_transactions_bulk.

-- Confere os ids e trava as linhas (FOR UPDATE). Devolve a família. Roda como o chamador: a RLS esconde lançamento de
-- outra família, e aí a contagem não bate e a chamada é recusada sem dizer se o id existe.
create function private.transactions_bulk_lock(p_ids uuid[]) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_n integer;
  v_achados integer;
  v_familias integer;
  v_familia uuid;
begin
  if auth.uid() is null then
    raise exception 'não autenticado' using errcode = '42501';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    raise exception 'escolha ao menos um lançamento' using errcode = '22023';
  end if;
  if array_position(p_ids, null) is not null then
    raise exception 'lista de lançamentos com item vazio' using errcode = '22023';
  end if;
  select count(distinct x) into v_n from unnest(p_ids) as x;
  if v_n > 500 then
    raise exception 'no máximo 500 lançamentos por vez (foram %)', v_n using errcode = '22023';
  end if;
  perform 1 from public.transactions t where t.id = any (p_ids) order by t.id for update;
  select count(*), count(distinct t.household_id), min(t.household_id::text)::uuid
    into v_achados, v_familias, v_familia
    from public.transactions t where t.id = any (p_ids);
  if v_achados <> v_n then
    raise exception 'lançamento não encontrado' using errcode = '42501';
  end if;
  if v_familias <> 1 then
    raise exception 'os lançamentos precisam ser da mesma família' using errcode = '42501';
  end if;
  return v_familia;
end $$;

create function public.transactions_bulk_set_category(p_ids uuid[], p_category uuid) returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  v_familia uuid;
  v_tipo text;
  v_n integer;
begin
  v_familia := private.transactions_bulk_lock(p_ids);
  if p_category is null then
    raise exception 'escolha a categoria' using errcode = '22023';
  end if;
  select c.type into v_tipo from public.categories c where c.id = p_category and c.household_id = v_familia;
  if not found then
    raise exception 'categoria não encontrada' using errcode = '42501';
  end if;
  if exists (select 1 from public.transactions t where t.id = any (p_ids) and t.deleted_at is not null) then
    raise exception 'há lançamento na lixeira na seleção; restaure antes de mudar a categoria' using errcode = '55000';
  end if;
  if exists (select 1 from public.transactions t where t.id = any (p_ids) and t.type = 'transfer') then
    raise exception 'transferência não tem categoria; tire as transferências da seleção' using errcode = '22023';
  end if;
  if exists (select 1 from public.transactions t where t.id = any (p_ids) and t.type <> v_tipo) then
    raise exception 'categoria de % só em %; a seleção tem lançamentos do outro tipo',
      case v_tipo when 'income' then 'receita' else 'despesa' end,
      case v_tipo when 'income' then 'receita' else 'despesa' end
      using errcode = '23514';
  end if;
  update public.transactions t set category_id = p_category
   where t.id = any (p_ids) and t.category_id is distinct from p_category;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create function public.transactions_bulk_mark_paid(p_ids uuid[], p_date date default null) returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  v_n integer;
begin
  perform private.transactions_bulk_lock(p_ids);
  if exists (select 1 from public.transactions t where t.id = any (p_ids) and t.deleted_at is not null) then
    raise exception 'há lançamento na lixeira na seleção' using errcode = '55000';
  end if;
  update public.transactions t set status = 'paid', date = coalesce(p_date, t.date)
   where t.id = any (p_ids) and t.status = 'planned';
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create function public.transactions_bulk_mark_planned(p_ids uuid[], p_dates date[]) returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  v_n integer;
begin
  perform private.transactions_bulk_lock(p_ids);
  if p_dates is null or cardinality(p_dates) <> cardinality(p_ids) or array_position(p_dates, null) is not null then
    raise exception 'informe a data de cada lançamento' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_ids, p_dates) as x(id, d) group by x.id having count(distinct x.d) > 1) then
    raise exception 'o mesmo lançamento com duas datas' using errcode = '22023';
  end if;
  if exists (select 1 from public.transactions t where t.id = any (p_ids) and t.deleted_at is not null) then
    raise exception 'há lançamento na lixeira na seleção' using errcode = '55000';
  end if;
  update public.transactions t set status = 'planned', date = x.d
    from (select distinct u.id, u.d from unnest(p_ids, p_dates) as u(id, d)) as x
   where t.id = x.id and t.status = 'paid';
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create function public.transactions_bulk_trash(p_ids uuid[]) returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  v_n integer;
begin
  perform private.transactions_bulk_lock(p_ids);
  update public.transactions t set deleted_at = now()
   where t.id = any (p_ids) and t.deleted_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create function public.transactions_bulk_restore(p_ids uuid[]) returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  v_n integer;
begin
  perform private.transactions_bulk_lock(p_ids);
  update public.transactions t set deleted_at = null
   where t.id = any (p_ids) and t.deleted_at is not null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke execute on function private.transactions_bulk_lock(uuid[]),
  public.transactions_bulk_set_category(uuid[], uuid), public.transactions_bulk_mark_paid(uuid[], date),
  public.transactions_bulk_mark_planned(uuid[], date[]), public.transactions_bulk_trash(uuid[]),
  public.transactions_bulk_restore(uuid[])
  from public, anon;
-- a auxiliar roda como o chamador dentro das RPCs (como private.transfer_same_currency)
grant execute on function private.transactions_bulk_lock(uuid[]),
  public.transactions_bulk_set_category(uuid[], uuid), public.transactions_bulk_mark_paid(uuid[], date),
  public.transactions_bulk_mark_planned(uuid[], date[]), public.transactions_bulk_trash(uuid[]),
  public.transactions_bulk_restore(uuid[])
  to authenticated;
