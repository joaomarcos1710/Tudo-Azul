-- Tudo Azul — migration 117: proventos previstos que se repetem ("Repetir" no provento) e a leitura dos previstos
--
-- Pedido do dono (13/11/2026): lançar na conta, no cartão e no investimento (ex.: dividendo recorrente) e a página Recorrentes só
-- informar. Decisão do dono: dividendo recorrente é PREVISÃO (planejado), não lançamento automático, e o limite é 12 meses por vez.
--
-- Nada de tipo novo de recorrente: o provento já é uma receita ligada ao ativo (035) e já pode ser "planejado" (não vira pago
-- sozinho; a pessoa marca quando cair). Esta migration só:
--   1. investment_distribution_record_series(...): cria os proventos PLANEJADOS repetidos (a cada 1, 3, 6 ou 12 meses) numa
--      transação só, chamando investment_distribution_record para cada data (as mesmas validações, o mesmo lançamento de receita
--      e o mesmo vínculo); se uma data falhar (conta fechada, período conciliado...), nenhuma é criada.
--   2. investment_planned_income(p_household): por ativo, o que está previsto de hoje a 12 meses (quantidade, próxima data e valor,
--      total). Leitura pura, para a página Recorrentes. Só proventos planejados, fora da lixeira.
-- Não mexe em recurrence_materialize nem em nenhuma tabela.
--
-- Limites: só ativos e contas em BRL (como o provento de hoje); primeira data de hoje em diante; no máximo 12 meses a partir da
-- primeira data (mensal = 12 proventos, trimestral = 4, semestral = 2, anual = 1; a data final nunca passa de 12 meses). O valor é
-- o que a pessoa digita: o app não adivinha dividendo.
-- Erros: 42501 não autenticado, ativo ou conta de outra família; 22023 parâmetro inválido; 55000 ativo arquivado (da função base).
-- SECURITY DEFINER só na série (a função base também é); a leitura é SECURITY INVOKER (a RLS de quem chama decide).

create function public.investment_distribution_record_series(
  p_asset uuid, p_kind text, p_first date, p_amount numeric, p_account uuid,
  p_every_months integer, p_until date default null, p_notes text default null
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_limit date;
  v_last date;
  v_k integer := 0;
  v_date date;
  v_n integer := 0;
begin
  if auth.uid() is null then raise exception 'não autenticado' using errcode = '42501'; end if;
  if p_every_months is null or p_every_months not in (1, 3, 6, 12) then
    raise exception 'a repetição é mensal, trimestral, semestral ou anual' using errcode = '22023';
  end if;
  if p_first is null or p_first < private.today_sp() then
    raise exception 'o primeiro provento previsto não pode ser antes de hoje' using errcode = '22023';
  end if;
  v_limit := (p_first + interval '12 months')::date;          -- exclusivo: nunca passa de 12 meses
  v_last := coalesce(p_until, v_limit - 1);
  if v_last < p_first then
    raise exception 'a data final não pode ser antes da primeira' using errcode = '22023';
  end if;
  loop
    v_date := (p_first + make_interval(months => v_k * p_every_months))::date;
    exit when v_date >= v_limit or v_date > v_last;
    perform public.investment_distribution_record(p_asset, p_kind, v_date, p_amount, p_account, 'planned', p_notes);
    v_n := v_n + 1;
    v_k := v_k + 1;
  end loop;
  return v_n;
end $$;

create function public.investment_planned_income(p_household uuid)
returns table (asset_id uuid, asset_name text, item_count integer, next_date date, next_amount numeric, total_12m numeric)
language sql stable security invoker set search_path = '' as $$
  select a.id, a.name, count(*)::integer, min(t.date), (array_agg(t.amount order by t.date))[1], sum(t.amount)
    from public.investment_distributions d
    join public.transactions t on t.id = d.transaction_id and t.household_id = d.household_id and t.deleted_at is null
    join public.investment_assets a on a.id = d.asset_id and a.household_id = d.household_id
   where d.household_id = p_household
     and (select private.is_member(p_household))
     and t.status = 'planned'
     and t.date >= (now() at time zone 'America/Sao_Paulo')::date
     and t.date < ((now() at time zone 'America/Sao_Paulo')::date + interval '12 months')
   group by a.id, a.name
   order by min(t.date), a.name
$$;

revoke execute on function public.investment_distribution_record_series(uuid, text, date, numeric, uuid, integer, date, text),
  public.investment_planned_income(uuid) from public, anon;
grant execute on function public.investment_distribution_record_series(uuid, text, date, numeric, uuid, integer, date, text),
  public.investment_planned_income(uuid) to authenticated;
