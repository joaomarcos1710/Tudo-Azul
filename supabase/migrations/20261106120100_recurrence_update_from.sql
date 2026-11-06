-- Tudo Azul — migration 074: editar um lançamento recorrente e escolher "Este e os próximos"
--
-- Pedido do dono (06/11/2026, #193): "Eu mudei a data e o valor de um pagamento recorrente. Isso deveria recolocar para
-- os outros meses, contudo deveria aparecer a mensagem" (o diálogo do Organizze: "Este lançamento se repete em outras
-- datas. O que deseja fazer?" → Atualizar apenas este · Este e os próximos · Cancelar).
--
-- "Apenas este" já existia (o UPDATE comum do lançamento; a ocorrência fica diferente da regra = editada à mão, a mesma
-- marca implícita da 015/036). Esta migration faz o "Este e os próximos":
--   public.recurrence_update_from(p_transaction, p_date, p_description, p_amount, p_category, p_status, p_notes,
--                                 p_account, p_destination) → integer
-- Uma chamada só grava o formulário inteiro (situação, observação e conta valem só para esta ocorrência): ou tudo, ou
-- nada (antes eram a RPC e depois um UPDATE; se o segundo falhasse, a regra já tinha mudado).
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
--   1. Esta ocorrência: data = p_date, valor, descrição, categoria, situação, observação e conta (qualquer situação,
--      como a edição comum).
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
-- Limites (decisão do dono, #193):
--   * a data nova fica ESTRITAMENTE entre a ocorrência anterior e a seguinte (datas reais e chaves; sem vizinha gerada,
--     a posição vizinha da série) e, no mensal, dentro do mês da ocorrência (no bimestral em diante, dos N meses dela).
--     Mudar de mês (ou de semana) é "Atualizar apenas este": senão um mês ficaria com duas e outro vazio;
--   * ocorrência anterior ao começo atual da série (um "este e os próximos" mais adiante já reancorou a regra) é
--     recusada com a data de onde editar: a regra guarda uma grade só, e recalcular as chaves da anterior criaria
--     ocorrências em dobro (semanal, a cada N dias, bimestral) ou mudaria a data das próximas sem pedido (mensal).
--
-- Recusas: 42501 não autenticado, lançamento de outra família ou inexistente (mesma resposta, antes de qualquer outra);
-- 22023 lançamento que não é de recorrente, valor ≤ 0, data fora de 2000–2100, situação inválida, sem conta (ou sem
-- destino na transferência), descrição vazia ou com mais de 80 caracteres (limite da regra), receita/despesa sem
-- categoria ou com categoria desativada que a regra ainda não tem, data fora do intervalo acima, ocorrência anterior ao
-- começo da série; 55000 lançamento na lixeira, recorrente encerrado (active = false), período conciliado (gatilho);
-- 23514 categoria de outro tipo, conta desativada (gatilho).
-- Recorrente de CARTÃO não passa por aqui: as ocorrências dele são parcelas da fatura (debt_installments, imutáveis), não
-- lançamentos; continua sendo editado em Recorrentes (recurrence_update).
--
-- Segurança: a função pública é SECURITY INVOKER (como pedido): lê o lançamento com a RLS de quem chama e confere
-- private.is_member. A gravação precisa de colunas que o cliente não tem (recurrences, transactions.occurrence_date),
-- então passa por private.recurrence_update_from_apply (SECURITY DEFINER), que confere is_member logo depois de ler o
-- lançamento, trava a regra por private.recurrence_lock (família atual de quem chama) e confere que o lançamento é dela.
-- O schema private não é exposto pela API.
-- Gatilhos de sempre: transactions_guard (centavos, conta desativada/abertura), transactions_period_guard (período
-- conciliado; mudar só a chave não dispara), recurrences_money_guard e os CHECKs da regra.
-- "Editado à mão" aqui é TUDO OU NADA por ocorrência: a próxima planejada só acompanha se data (na chave), valor,
-- descrição e categoria ainda forem os da regra antiga; se UM deles difere, ela não muda em nada (nem a data, nem os
-- outros campos). É diferente da edição em Recorrentes (recurrence_update, 015/036), que segue campo a campo (o valor
-- acompanha mesmo com a descrição corrigida). Motivo: aqui a data também muda, e mover uma ocorrência que alguém ajustou
-- misturaria a correção dele com a regra nova.
-- Atalho: a marca é a diferença com a regra (sem coluna nova); editar um campo para exatamente o valor da regra volta a
-- acompanhar. Melhorar se o dono pedir uma marca explícita de "corrigido à mão".
--
-- Também nesta migration (revisão de dinheiro do #193):
--   * public.home_indicators (corpo da 073, 20261106113100_audit_fixes.sql): a renda regular ESPERADA do mês fechado
--     deixa de recalcular as ocorrências pela regra viva (que "este e os próximos" reancora: start_date vai para frente
--     e o valor muda, e a esperada de outubro caía a 0 ou mudava de valor) e passa a sair das ocorrências daquele mês:
--     os lançamentos gerados (valor do lançamento) + as ainda não geradas (private.account_recurrence_pending).
--   * public.recurrence_end (corpo da 031, 20261031175000_recurrence_end_delete.sql): sem o greatest(p_end,
--     start_date), que deixava planejados vivos entre a data pedida e um start_date reancorado para o futuro.
-- Teste: 74_recurrence_update_from (falha sem esta migration).

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
                                                     p_amount numeric, p_category uuid, p_status text, p_notes text,
                                                     p_account uuid, p_destination uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  t public.transactions%rowtype;
  v public.recurrences%rowtype;   -- a regra ANTES da mudança (sob lock)
  v_desc text := btrim(coalesce(p_description, ''));
  v_cat uuid;
  v_tipo text;
  v_cat_ativa boolean;
  v_mudou_data boolean;
  v_anchor date;
  v_day integer;
  v_end date;
  v_lo date;
  v_hi date;
  v_j integer;
  v_n integer;
  v_ids uuid[];
  v_antigas date[];
begin
  if (select auth.uid()) is null then
    raise exception 'não autenticado' using errcode = '42501';
  end if;
  select * into t from public.transactions where id = p_transaction;
  -- SECURITY DEFINER lê sem RLS: a família vem antes de qualquer outra resposta (não revela que o lançamento existe)
  if not found or not private.is_member(t.household_id) then
    raise exception 'lançamento não encontrado' using errcode = '42501';
  end if;
  if t.recurrence_id is null then
    raise exception 'este lançamento não vem de um recorrente' using errcode = '22023';
  end if;
  v := private.recurrence_lock(t.recurrence_id);             -- 42501 se a regra não é da família de quem chama
  if v.household_id <> t.household_id or v.kind = 'card' then
    raise exception 'lançamento não encontrado' using errcode = '42501';
  end if;
  if not v.active then
    raise exception 'este recorrente foi encerrado: use "Atualizar apenas este"' using errcode = '55000';
  end if;
  select * into t from public.transactions where id = p_transaction for update;
  if t.deleted_at is not null then
    raise exception 'lançamento na lixeira: restaure antes de editar' using errcode = '55000';
  end if;
  if p_amount is null or p_amount <= 0 or p_date is null or p_date not between date '2000-01-01' and date '2100-01-01'
     or p_status is null or p_status not in ('paid', 'planned') or p_account is null
     or (v.kind = 'transfer' and p_destination is null) then
    raise exception 'parâmetros inválidos' using errcode = '22023';
  end if;
  if char_length(v_desc) not between 1 and 80 then
    raise exception 'descrição do recorrente: de 1 a 80 caracteres' using errcode = '22023';
  end if;
  -- categoria: obrigatória em receita e despesa (como no formulário: "Escolha a categoria"), nenhuma em transferência.
  -- Antes, nula virava a da regra sem avisar.
  if v.kind = 'transfer' then
    v_cat := null;
  else
    if p_category is null then
      raise exception 'escolha a categoria' using errcode = '22023';
    end if;
    v_cat := p_category;
    select c.type, c.active into v_tipo, v_cat_ativa
      from public.categories c where c.household_id = v.household_id and c.id = v_cat;
    if v_tipo is distinct from (case when v.kind = 'income' then 'income' else 'expense' end) then
      raise exception 'a categoria precisa ser de %', case when v.kind = 'income' then 'receita' else 'despesa' end
        using errcode = '23514';
    end if;
    -- categoria desativada não entra na série; manter a que a regra já tem continua possível (o formulário oferece a atual)
    if not v_cat_ativa and v_cat is distinct from v.category_id then
      raise exception 'categoria desativada: escolha outra' using errcode = '22023';
    end if;
  end if;

  -- Ocorrência ANTES do começo atual da série: um "Este e os próximos" numa ocorrência mais adiante já reancorou a regra
  -- (começo e, no mensal, o dia). As anteriores ficaram na grade antiga e a regra só conhece a nova: recalcular as
  -- chaves daqui em diante numa grade só ou criaria ocorrências em dobro (a geração segue o começo da regra) ou mudaria
  -- a data das próximas sem o usuário pedir. Recusa e diz de onde dá para editar.
  if t.occurrence_date < v.start_date then
    raise exception 'este recorrente foi alterado a partir de %: para mudar a série, edite a ocorrência dessa data ou uma depois dela; para mudar só esta, use "Atualizar apenas este"', v.start_date
      using errcode = '22023';
  end if;

  -- a série nova: começa nesta ocorrência, na data nova (só se a data mudou nesta edição). Voltar para a data da própria
  -- série (a chave) não conta como mudança: mantém o dia (mensal dia 31 → 28/02 não vira "dia 28").
  v_mudou_data := p_date <> t.date and p_date <> t.occurrence_date;
  v_anchor := case when v_mudou_data then p_date else t.occurrence_date end;
  v_day := case when v.freq_unit <> 'month' then null
                when v_mudou_data then extract(day from p_date)::int
                else v.day end;

  -- Trocar de período (decisão do dono, #193): a data nova fica ESTRITAMENTE entre a ocorrência anterior e a seguinte,
  -- pelas datas reais e pelas chaves (a anterior pode ter sido movida à mão). Fora disso um mês ficaria com duas e outro
  -- vazio. Sem anterior/seguinte gerada, o limite é a posição vizinha na série.
  if p_date <> t.date then
    select max(greatest(x.date, x.occurrence_date)) into v_lo
      from public.transactions x where x.recurrence_id = v.id and x.occurrence_date < t.occurrence_date;
    select min(least(x.date, x.occurrence_date)) into v_hi
      from public.transactions x where x.recurrence_id = v.id and x.occurrence_date > t.occurrence_date;
    v_lo := coalesce(v_lo, private.recurrence_slot(v.freq_unit, v.freq_every, v.day, t.occurrence_date, -1));
    v_hi := coalesce(v_hi, private.recurrence_slot(v.freq_unit, v.freq_every, v.day, t.occurrence_date, 1));
    -- no mensal, também dentro do período desta posição (o mês da chave; no bimestral em diante, os N meses): a de
    -- janeiro em 25/12 fica entre as vizinhas (10/12 e 10/02), mas deixaria dezembro com duas e janeiro vazio
    if v.freq_unit = 'month' then
      v_lo := greatest(v_lo, (date_trunc('month', t.occurrence_date) - interval '1 day')::date);
      v_hi := least(v_hi, (date_trunc('month', t.occurrence_date) + make_interval(months => v.freq_every))::date);
    end if;
    if not (p_date > v_lo and p_date < v_hi) then
      raise exception 'a nova data precisa ficar depois de % e antes de %; para mudar de %, use "Atualizar apenas este"',
        v_lo, v_hi, case v.freq_unit when 'month' then 'mês' when 'week' then 'semana' else 'período' end
        using errcode = '22023';
    end if;
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
  --    (recurrence_id, occurrence_date) é conferido linha a linha, e a chave nova de uma pode ser a antiga da seguinte.
  --    Chave nula não colide. Daqui em diante todas estão na grade da regra (a recusa acima garante), então os passos
  --    contados da chave desta valem para todas.
  select array_agg(x.id order by x.occurrence_date), array_agg(x.occurrence_date order by x.occurrence_date)
    into v_ids, v_antigas
    from public.transactions x
   where x.recurrence_id = v.id and x.occurrence_date >= t.occurrence_date;
  update public.transactions x set occurrence_date = null where x.id = any (v_ids);

  -- 2. cada uma recebe a chave nova; esta ocorrência recebe a edição inteira do formulário (inclusive situação,
  --    observação e conta, que valem só para ela); as próximas planejadas, fora da lixeira e ainda iguais à regra antiga
  --    (data na chave, valor, descrição e categoria) acompanham a regra nova. As demais (pagas, na lixeira, corrigidas à
  --    mão) só trocam a chave. Os gatilhos de sempre (transactions_guard: conta desativada, centavos;
  --    transactions_period_guard: período conciliado) valem aqui como no UPDATE comum, e qualquer recusa desfaz tudo.
  update public.transactions x
     set occurrence_date = m.chave,
         date        = case when x.id = t.id then p_date when m.segue then m.chave else x.date end,
         amount      = case when x.id = t.id or m.segue then p_amount else x.amount end,
         description = case when x.id = t.id or m.segue then v_desc else x.description end,
         category_id = case when x.id = t.id or m.segue then v_cat else x.category_id end,
         status      = case when x.id = t.id then p_status else x.status end,
         notes       = case when x.id = t.id then p_notes else x.notes end,
         account_id  = case when x.id = t.id then p_account else x.account_id end,
         destination_account_id = case when x.id = t.id then (case when v.kind = 'transfer' then p_destination end)
                                       else x.destination_account_id end
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
revoke execute on function private.recurrence_update_from_apply(uuid, date, text, numeric, uuid, text, text, uuid, uuid)
  from public, anon;
-- a função pública (SECURITY INVOKER) roda como quem chama, que precisa poder executar esta; o schema private não é
-- exposto pela API, e ela mesma confere a família (is_member e recurrence_lock)
grant execute on function private.recurrence_update_from_apply(uuid, date, text, numeric, uuid, text, text, uuid, uuid)
  to authenticated;

create function public.recurrence_update_from(p_transaction uuid, p_date date, p_description text, p_amount numeric,
                                              p_category uuid, p_status text, p_notes text, p_account uuid,
                                              p_destination uuid)
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
  return private.recurrence_update_from_apply(p_transaction, p_date, p_description, p_amount, p_category, p_status,
                                              p_notes, p_account, p_destination);
end $$;
revoke execute on function public.recurrence_update_from(uuid, date, text, numeric, uuid, text, text, uuid, uuid)
  from public, anon;
grant execute on function public.recurrence_update_from(uuid, date, text, numeric, uuid, text, text, uuid, uuid)
  to authenticated;


-- ---------------------------------------------------------------------------
-- B1. Indicadores do Início (corpo da 073, 20261106113100_audit_fixes.sql; só o CTE `esperada` muda)
-- ---------------------------------------------------------------------------
create or replace function public.home_indicators(p_household uuid, p_as_of date)
returns table (
  month_start date, month_end date, closed_month_start date, closed_month_end date,
  accounts_active numeric, card_bills_closed numeric, available numeric,
  accounts_total numeric, credit_receivable numeric, family_assets numeric, investments numeric,
  debt_total numeric, planned_commitments numeric, net_worth numeric,
  income numeric, expense numeric, result numeric,
  savings_income numeric, savings_expense numeric, savings_result numeric, savings_rate numeric, savings_band text,
  reserve numeric, closed_months integer, typical_expense numeric, reserve_months numeric, reserve_band text,
  debt_installments numeric, regular_income_expected numeric, regular_income_received numeric, regular_income numeric,
  regular_income_source text, commitment_pct numeric, commitment_band text
)
-- jit = off: a consulta junta várias funções de 1000 linhas estimadas e passa do jit_above_cost; no volume do #182 a
-- compilação JIT levava ~600 ms de um total de ~870 ms. Sem JIT: ~260 ms. O resultado não muda.
language sql stable security invoker set search_path = '' set jit = off as $$
  with m as (
    select date_trunc('month', p_as_of)::date as ini,
           (date_trunc('month', p_as_of) + interval '1 month - 1 day')::date as fim,
           (date_trunc('month', p_as_of) - interval '1 month')::date as fini,
           (date_trunc('month', p_as_of) - interval '1 day')::date as ffim,
           (date_trunc('month', p_as_of) - interval '6 months')::date as ini6
  ),
  contas as materialized (
    select coalesce(sum(b.balance) filter (where b.active and b.type in
             ('checking', 'savings', 'brokerage', 'fixed_income', 'variable_income', 'crypto', 'cash')), 0) as ativas,
           coalesce(sum(b.balance) filter (where b.active and b.type = 'savings'), 0) as reserva,
           coalesce(sum(b.balance), 0) as todas
      from public.account_balances(p_household, p_as_of) b
     where b.currency_code = 'BRL'
  ),
  dividas as materialized (
    select coalesce(sum(x.debt), 0) as debt, coalesce(sum(x.credit_receivable), 0) as cr,
           coalesce(sum(x.planned_remaining), 0) as pc,
           coalesce(sum(x.debt) filter (where x.kind = 'card'), 0) as cartao_fechadas
      from public.debt_balances(p_household, p_as_of) x
  ),
  inv as materialized (
    select round(coalesce(sum(i.market_value) filter (where i.currency_code = 'BRL'), 0), 2) as brl
      from public.investment_totals(p_household, p_as_of) i
  ),
  -- o mês corrente, ATÉ HOJE: period_summary do 1º dia até p_as_of (073: antes ia até o fim do mês e contava o pago com
  -- data futura), sem tirar nada
  mes as materialized (select ps.* from m cross join lateral public.period_summary(p_household, m.ini, least(p_as_of, m.fim)) ps),
  -- despesa de cada mês fechado (até 6), pela regra de sempre (private.expense_items = a despesa de period_summary),
  -- sem as categorias marcadas como "não conta como consumo" (só a marcada; a subcategoria não herda)
  desp_mes as materialized (
    select date_trunc('month', x.day)::date as mes, sum(x.amount) as total
      from m cross join lateral private.expense_items(p_household, m.ini6, m.ffim) x
      left join public.categories c on c.household_id = p_household and c.id = x.category_id
     where not coalesce(c.non_consumption, false)
     group by 1
  ),
  -- meses fechados da janela que já tinham conta aberta (família nova não conta meses que não existiam)
  meses as (
    select g.d::date as mes
      from m cross join lateral generate_series(m.ini6, m.ffim, interval '1 month') g(d)
     where (g.d + interval '1 month - 1 day')::date
           >= (select min(a.opening_date) from public.accounts a where a.household_id = p_household)
  ),
  -- despesa típica = MEDIANA dos meses contados (mês sem despesa conta como zero): um mês com quitação ou repasse
  -- grande não puxa a régua da reserva
  serie as (
    select coalesce(d.total, 0) as v, row_number() over (order by coalesce(d.total, 0)) as rn, count(*) over () as n
      from meses left join desp_mes d on d.mes = meses.mes
  ),
  tipica as (
    select coalesce(max(n), 0)::integer as n,
           round(avg(v) filter (where rn in ((n + 1) / 2, (n + 2) / 2)), 2) as mediana
      from serie
  ),
  -- receitas pagas do último mês fechado, em reais (lançamentos + crédito avulso do cartão já fechado, como
  -- income_regularity), com as marcas da categoria: eventual herda da mãe (012); "não é consumo" não herda
  renda_itens as materialized (
    select r.amount,
           coalesce(c.eventual, false) or coalesce(p.eventual, false) as eventual,
           coalesce(c.non_consumption, false) as fora
      from (
        select t.category_id, t.amount
          from m, public.transactions t
         where t.household_id = p_household and t.deleted_at is null
           and t.type = 'income' and t.status = 'paid' and t.date between m.fini and m.ffim
           and exists (select 1 from public.accounts ac where ac.household_id = t.household_id and ac.id = t.account_id
                         and ac.currency_code = 'BRL')
        union all
        select ci.category_id, ci.amount
          from m cross join lateral private.card_income_items(p_household, m.fini, m.ffim) ci
         where ci.paid
      ) r
      left join public.categories c on c.household_id = p_household and c.id = r.category_id
      left join public.categories p on p.household_id = c.household_id and p.id = c.parent_id
  ),
  renda as (
    select coalesce(sum(amount) filter (where not fora), 0) as rec,
           coalesce(sum(amount) filter (where not fora and not eventual), 0) as regular
      from renda_itens
  ),
  -- renda regular ESPERADA no mês fechado: as OCORRÊNCIAS daquele mês das recorrentes de receita ativas, em conta ativa
  -- em reais, de categoria regular (nem eventual, nem "não é consumo"):
  --   * as já geradas: o lançamento (pela chave occurrence_date no mês, fora da lixeira), com o valor e a categoria
  --     dele; pago ou planejado;
  --   * as ainda não geradas: private.account_recurrence_pending (regra viva, sem lançamento nenhum naquela chave).
  -- (074) Antes recalculava pela regra viva (recurrence_occurrences × valor da regra): depois de um "este e os próximos"
  -- com data nova, a regra começa no mês corrente e a esperada do mês fechado caía a 0; com valor novo, mudava o
  -- passado. O lançamento guarda o que aquele mês era. Ocorrência na lixeira não conta (antes contava pela regra).
  esperada_itens as materialized (
    select t.amount, t.category_id
      from m, public.transactions t
      join public.recurrences r on r.household_id = t.household_id and r.id = t.recurrence_id
                               and r.kind = 'income' and r.active
      join public.accounts ac on ac.household_id = t.household_id and ac.id = t.account_id
                             and ac.currency_code = 'BRL' and ac.active
     where t.household_id = p_household and t.recurrence_id is not null and t.type = 'income'
       and t.deleted_at is null and t.occurrence_date between m.fini and m.ffim
    union all
    select pr.amount, r.category_id
      from m cross join lateral private.account_recurrence_pending(p_household, m.fini, m.ffim) pr
      join public.recurrences r on r.household_id = p_household and r.id = pr.recurrence_id
      join public.accounts ac on ac.household_id = p_household and ac.id = pr.account_id
                             and ac.currency_code = 'BRL' and ac.active
     where pr.kind = 'income'
  ),
  esperada as (
    select coalesce(sum(e.amount), 0) as total
      from esperada_itens e
      left join public.categories c on c.household_id = p_household and c.id = e.category_id
      left join public.categories p on p.household_id = c.household_id and p.id = c.parent_id
     where not (coalesce(c.eventual, false) or coalesce(p.eventual, false))
       and not coalesce(c.non_consumption, false)
  ),
  -- parcelas de contrato que vencem no mês fechado (paga ou a pagar; a cancelada não), de empréstimo, financiamento e
  -- consignado. A planejada de dívida arquivada não conta (a dívida saiu do dia a dia).
  parcelas as (
    select coalesce(sum(s.amount), 0) as total
      from m
      join public.debt_payment_schedule s on s.household_id = p_household and s.due_date between m.fini and m.ffim
      join public.debts d on d.household_id = s.household_id and d.id = s.debt_id and d.kind in ('loan', 'financing')
     where s.status = 'paid' or (s.status = 'planned' and d.active)
  ),
  calc as (
    select m.ini, m.fim, m.fini, m.ffim, contas.ativas, contas.reserva, contas.todas, dividas.cartao_fechadas,
           dividas.debt, dividas.cr, dividas.pc, round(private.family_assets_brl(p_household, p_as_of), 2) as bens, inv.brl as inv,
           mes.income_paid as rec, mes.expense_paid as desp, mes.result as res,
           renda.rec as prec, coalesce((select d.total from desp_mes d where d.mes = m.fini), 0) as pdesp,
           tipica.n as meses, tipica.mediana as tip,
           esperada.total as esp, renda.regular as recebida, greatest(esperada.total, renda.regular) as reg,
           parcelas.total as parc
      from m, contas, dividas, inv, mes, renda, tipica, esperada, parcelas
  ),
  calc2 as (
    select c.*,
           case when c.prec > 0 then round(100 * (c.prec - c.pdesp) / c.prec, 1) end as taxa,
           case when c.tip > 0 then round(c.reserva / c.tip, 1) end as cob,
           case when c.reg > 0 then round(100 * c.parc / c.reg, 1) end as comp
      from calc c
  )
  select c.ini, c.fim, c.fini, c.ffim,
         c.ativas, c.cartao_fechadas, c.ativas - c.cartao_fechadas,
         c.todas, c.cr, c.bens, c.inv, c.debt, c.pc, c.todas + c.cr + c.bens - c.debt + c.inv,
         c.rec, c.desp, c.res,
         c.prec, c.pdesp, c.prec - c.pdesp, c.taxa,
         case when c.taxa is null then null when c.taxa < 0 then 'critico' when c.taxa < 10 then 'atencao' else 'saudavel' end,
         c.reserva, c.meses, c.tip, c.cob,
         case when c.cob is null then null when c.cob < 3 then 'critico' when c.cob < 6 then 'atencao' else 'saudavel' end,
         c.parc, c.esp, c.recebida, c.reg,
         case when c.esp > c.recebida then 'recurring' else 'received' end,
         c.comp,
         case when c.comp is null then null when c.comp > 40 then 'critico' when c.comp > 30 then 'atencao' else 'saudavel' end
    from calc2 c
   where (select private.is_member(p_household))
$$;

revoke execute on function public.home_indicators(uuid, date) from public, anon;
grant execute on function public.home_indicators(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- I1. Encerrar um recorrente (corpo da 031, 20261031175000_recurrence_end_delete.sql; sem o greatest com start_date)
-- ---------------------------------------------------------------------------
-- Antes: v_end := greatest(p_end, start_date). Depois de um "este e os próximos" com data nova, start_date fica no futuro
-- (ex.: 15/12) e encerrar em 06/11 só mandava para a lixeira os planejados DEPOIS de 15/12: o de 10/11 e o próprio
-- 15/12 ficavam vivos, de uma regra que não existe mais. Agora a data pedida (ou hoje) vale: todo planejado depois dela
-- vai para a lixeira. A regra continua sendo apagada (031), então não há data final a ajustar; pagos e os planejados
-- até a data ficam, sem vínculo (ON DELETE SET NULL).
create or replace function public.recurrence_end(p_id uuid, p_end date default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.recurrences%rowtype;
  v_end date;
begin
  v := private.recurrence_lock(p_id);
  v_end := coalesce(p_end, private.today_sp());

  update public.transactions
     set deleted_at = now()
   where recurrence_id = v.id
     and status = 'planned'
     and deleted_at is null
     and date > v_end;

  perform set_config('app.card_edit', 'on', true);
  delete from public.recurrences where id = v.id;
  perform set_config('app.card_edit', 'off', true);
end
$$;
revoke execute on function public.recurrence_end(uuid, date) from public, anon;
grant execute on function public.recurrence_end(uuid, date) to authenticated;
