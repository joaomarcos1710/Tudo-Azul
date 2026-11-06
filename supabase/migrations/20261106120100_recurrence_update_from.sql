-- Tudo Azul — migration 073: editar um lançamento recorrente e escolher "Este e os próximos"
--
-- Pedido do dono (06/11/2026, #191): "Eu mudei a data e o valor de um pagamento recorrente. Isso deveria recolocar para
-- os outros meses, contudo deveria aparecer a mensagem" (o diálogo do Organizze: "Este lançamento se repete em outras
-- datas. O que deseja fazer?" → Atualizar apenas este · Este e os próximos · Cancelar).
--
-- "Apenas este" já existia (o UPDATE comum do lançamento; a ocorrência fica diferente da regra = editada à mão, a mesma
-- marca implícita da 015/036). Esta migration faz o "Este e os próximos":
--   public.recurrence_update_from(p_transaction, p_date, p_description, p_amount, p_category) → integer
--
-- Caminho escolhido: a MESMA regra é reancorada nesta ocorrência (não "encerrar a antiga + criar outra"). Motivos:
--   * recurrence_end (031) APAGA a regra e manda para a lixeira TODOS os planejados depois da data, inclusive os
--     corrigidos à mão (o pedido diz que esses não mudam) e desfaz o vínculo do histórico pago com a regra;
--   * uma segunda regra apareceria como mais um card em Recorrentes (063), com a "antiga" encerrada que a 031 decidiu
--     não guardar; o equivalente mensal, os previstos (068/069) e o saldo previsto já leem a regra viva, então mudar a
--     própria regra os corrige de uma vez, sem tocar nessas funções;
--   * o par único (recurrence_id, occurrence_date) continua sendo a proteção contra duplicar e contra "ressuscitar"
--     ocorrência excluída: as ocorrências desta em diante só trocam de chave (occurrence_date) para a data da série nova.
--
-- O que a função faz, numa transação (tudo ou nada):
--   1. Esta ocorrência: data = p_date, valor, descrição e categoria novos (qualquer situação, como a edição comum).
--   2. A regra: valor, descrição e categoria novos. Se a DATA mudou nesta edição (p_date ≠ data gravada), a série passa
--      a começar em p_date (start_date) e, na frequência mensal, o dia passa a ser o de p_date (dia 10 → dia 15). A data
--      final (se houver) anda junto: a última ocorrência continua sendo a última. Sem mudança de data, a série fica.
--   3. As ocorrências DEPOIS desta (pela ordem da série):
--        * planejadas, fora da lixeira e ainda iguais à regra antiga (data = a da série, valor, descrição e categoria):
--          recebem a data da série nova e os valores novos;
--        * pagas, na lixeira e as corrigidas à mão: ficam como estão (só a chave interna acompanha a série nova, para a
--          geração não criar outra no mesmo lugar nem trazer de volta a excluída).
--      As anteriores a esta (pagas ou não) não mudam. A categoria NÃO volta para o passado (diferente de recurrence_update,
--      que vale para todas): "este e os próximos" é daqui em diante.
--   4. O que ainda não foi gerado sai da regra nova na próxima recurrence_materialize (o app chama ao abrir).
--
-- Recusas: 42501 não autenticado, lançamento de outra família ou inexistente (mesma resposta); 22023 lançamento que não
-- é de recorrente, valor ≤ 0, data fora de 2000–2100, descrição vazia ou com mais de 80 caracteres (limite da regra), ou
-- nova data que não fica depois da ocorrência anterior; 55000 lançamento na lixeira; 23514 categoria de outro tipo.
-- Recorrente de CARTÃO não passa por aqui: as ocorrências dele são parcelas da fatura (debt_installments, imutáveis), não
-- lançamentos; continua sendo editado em Recorrentes (recurrence_update).
--
-- Segurança: a função pública é SECURITY INVOKER (como pedido): lê o lançamento com a RLS de quem chama e confere
-- private.is_member. A gravação precisa de colunas que o cliente não tem (recurrences, transactions.occurrence_date),
-- então passa por private.recurrence_update_from_apply (SECURITY DEFINER), que trava a regra por private.recurrence_lock
-- (família atual de quem chama) e confere que o lançamento é dela. O schema private não é exposto pela API.
-- Gatilhos de sempre: transactions_guard (centavos, conta desativada/abertura), transactions_period_guard (período
-- conciliado; mudar só a chave não dispara), recurrences_money_guard e os CHECKs da regra.
-- Atalho: o "editado à mão" é a diferença com a regra (mesma marca da 015); editar um campo para exatamente o valor da
-- regra continua acompanhando. Teste: 73_recurrence_update_from (falha sem esta migration).

-- Data da j-ésima ocorrência de uma série que tem `p_anchor` como ocorrência 0 (mesma regra de recurrence_occurrences:
-- mês = dia fixo limitado ao último dia do mês; semana e dia = anchor + j×passo).
create function private.recurrence_slot(p_unit text, p_every integer, p_day integer, p_anchor date, p_j integer)
returns date language sql immutable set search_path = '' as $$
  select case p_unit
    when 'month' then (
      select make_date(extract(year from m)::int, extract(month from m)::int,
                       least(p_day, extract(day from (m + interval '1 month - 1 day'))::int))
        from (select (date_trunc('month', p_anchor) + make_interval(months => p_j * p_every))::date as m) x)
    when 'week' then p_anchor + p_j * 7 * p_every
    else p_anchor + p_j * p_every
  end
$$;
revoke execute on function private.recurrence_slot(text, integer, integer, date, integer) from public, anon, authenticated;

-- Quantos passos da série há de p_from até p_to (as duas datas da mesma série; p_to ≥ p_from).
create function private.recurrence_steps(p_unit text, p_every integer, p_from date, p_to date)
returns integer language sql immutable set search_path = '' as $$
  select case p_unit
    when 'month' then ((extract(year from p_to)::int * 12 + extract(month from p_to)::int)
                     - (extract(year from p_from)::int * 12 + extract(month from p_from)::int)) / p_every
    when 'week' then (p_to - p_from) / (7 * p_every)
    else (p_to - p_from) / p_every
  end
$$;
revoke execute on function private.recurrence_steps(text, integer, date, date) from public, anon, authenticated;

create function private.recurrence_update_from_apply(p_transaction uuid, p_date date, p_description text,
                                                     p_amount numeric, p_category uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  t public.transactions%rowtype;
  v public.recurrences%rowtype;   -- a regra ANTES da mudança (sob lock)
  v_desc text := btrim(coalesce(p_description, ''));
  v_cat uuid;
  v_tipo text;
  v_mudou_data boolean;
  v_anchor date;
  v_day integer;
  v_end date;
  v_j integer;
  v_n integer;
  v_ids uuid[];
  v_antigas date[];
begin
  if (select auth.uid()) is null then
    raise exception 'não autenticado' using errcode = '42501';
  end if;
  select * into t from public.transactions where id = p_transaction;
  if not found then
    raise exception 'lançamento não encontrado' using errcode = '42501';
  end if;
  if t.recurrence_id is null then
    raise exception 'este lançamento não vem de um recorrente' using errcode = '22023';
  end if;
  v := private.recurrence_lock(t.recurrence_id);             -- 42501 se a regra não é da família de quem chama
  if v.household_id <> t.household_id or v.kind = 'card' then
    raise exception 'lançamento não encontrado' using errcode = '42501';
  end if;
  select * into t from public.transactions where id = p_transaction for update;
  if t.deleted_at is not null then
    raise exception 'lançamento na lixeira: restaure antes de editar' using errcode = '55000';
  end if;
  if p_amount is null or p_amount <= 0 or p_date is null or p_date not between date '2000-01-01' and date '2100-01-01' then
    raise exception 'parâmetros inválidos' using errcode = '22023';
  end if;
  if char_length(v_desc) not between 1 and 80 then
    raise exception 'descrição do recorrente: de 1 a 80 caracteres' using errcode = '22023';
  end if;
  v_cat := case when v.kind = 'transfer' then null else coalesce(p_category, v.category_id) end;
  if v_cat is not null then
    select c.type into v_tipo from public.categories c where c.household_id = v.household_id and c.id = v_cat;
    if v_tipo is distinct from (case when v.kind = 'income' then 'income' else 'expense' end) then
      raise exception 'a categoria precisa ser de %', case when v.kind = 'income' then 'receita' else 'despesa' end
        using errcode = '23514';
    end if;
  end if;

  -- a série nova: começa nesta ocorrência, na data nova (só se a data mudou nesta edição). Voltar para a data da própria
  -- série (a chave) não conta como mudança: mantém o dia (mensal dia 31 → 28/02 não vira "dia 28").
  v_mudou_data := p_date <> t.date and p_date <> t.occurrence_date;
  v_anchor := case when v_mudou_data then p_date else t.occurrence_date end;
  v_day := case when v.freq_unit <> 'month' then null
                when v_mudou_data then extract(day from p_date)::int
                else v.day end;
  if exists (select 1 from public.transactions x
              where x.recurrence_id = v.id and x.occurrence_date < t.occurrence_date and x.occurrence_date >= v_anchor) then
    raise exception 'a nova data precisa ficar depois da ocorrência anterior deste recorrente' using errcode = '22023';
  end if;

  -- data final: a última ocorrência possível continua sendo a mesma posição da série
  v_end := v.end_date;
  if v_end is not null and v_end >= t.occurrence_date then
    v_j := private.recurrence_steps(v.freq_unit, v.freq_every, t.occurrence_date, v_end);
    while v_j > 0 and private.recurrence_slot(v.freq_unit, v.freq_every, v.day, t.occurrence_date, v_j) > v_end loop
      v_j := v_j - 1;
    end loop;
    v_end := private.recurrence_slot(v.freq_unit, v.freq_every, v_day, v_anchor, v_j);
  end if;

  -- quantas das próximas vão acompanhar (o retorno)
  select count(*) into v_n
    from public.transactions x
   where x.recurrence_id = v.id and x.occurrence_date > t.occurrence_date and x.id <> t.id
     and x.status = 'planned' and x.deleted_at is null and x.date = x.occurrence_date
     and x.amount = v.amount and x.description = v.description and x.category_id is not distinct from v.category_id;

  -- 1. a chave (occurrence_date) desta em diante passa para a série nova. Duas etapas: o índice único
  --    (recurrence_id, occurrence_date) é conferido linha a linha, e a chave nova de uma pode ser a antiga da seguinte
  --    (ex.: mover a de dezembro para janeiro). Chave nula não colide.
  select array_agg(x.id order by x.occurrence_date), array_agg(x.occurrence_date order by x.occurrence_date)
    into v_ids, v_antigas
    from public.transactions x
   where x.recurrence_id = v.id and x.occurrence_date >= t.occurrence_date;
  update public.transactions x set occurrence_date = null where x.id = any (v_ids);

  -- 2. cada uma recebe a chave nova; esta ocorrência recebe a edição; as próximas planejadas, fora da lixeira e ainda
  --    iguais à regra antiga (data na chave, valor, descrição e categoria) acompanham a regra nova. As demais (pagas, na
  --    lixeira, corrigidas à mão) só trocam a chave.
  update public.transactions x
     set occurrence_date = m.chave,
         date        = case when x.id = t.id then p_date when m.segue then m.chave else x.date end,
         amount      = case when x.id = t.id or m.segue then p_amount else x.amount end,
         description = case when x.id = t.id or m.segue then v_desc else x.description end,
         category_id = case when x.id = t.id or m.segue then v_cat else x.category_id end
    from (select u.id, u.antiga,
                 private.recurrence_slot(v.freq_unit, v.freq_every, v_day, v_anchor,
                                         private.recurrence_steps(v.freq_unit, v.freq_every, t.occurrence_date, u.antiga)) as chave,
                 (y.id <> t.id and y.status = 'planned' and y.deleted_at is null and y.date = u.antiga
                  and y.amount = v.amount and y.description = v.description
                  and y.category_id is not distinct from v.category_id) as segue
            from unnest(v_ids, v_antigas) as u(id, antiga)
            join public.transactions y on y.id = u.id) m
   where m.id = x.id;

  -- 3. a regra: valores novos e, se a data mudou, o começo e o dia da série
  update public.recurrences
     set description = v_desc, amount = p_amount, category_id = v_cat,
         start_date = case when v_mudou_data then v_anchor else start_date end,
         day = v_day, end_date = v_end
   where id = v.id;
  return v_n;
end $$;
revoke execute on function private.recurrence_update_from_apply(uuid, date, text, numeric, uuid) from public, anon;
-- a função pública (SECURITY INVOKER) roda como quem chama, que precisa poder executar esta; o schema private não é
-- exposto pela API, e ela mesma confere a família (recurrence_lock)
grant execute on function private.recurrence_update_from_apply(uuid, date, text, numeric, uuid) to authenticated;

create function public.recurrence_update_from(p_transaction uuid, p_date date, p_description text, p_amount numeric,
                                              p_category uuid default null)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  v_h uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'não autenticado' using errcode = '42501';
  end if;
  -- lido com a RLS de quem chama: lançamento de outra família não aparece
  select t.household_id into v_h from public.transactions t where t.id = p_transaction;
  if v_h is null or not private.is_member(v_h) then
    raise exception 'lançamento não encontrado' using errcode = '42501';
  end if;
  return private.recurrence_update_from_apply(p_transaction, p_date, p_description, p_amount, p_category);
end $$;
revoke execute on function public.recurrence_update_from(uuid, date, text, numeric, uuid) from public, anon;
grant execute on function public.recurrence_update_from(uuid, date, text, numeric, uuid) to authenticated;
