-- Aviso "a previsão de proventos está acabando" (Recorrentes › Entradas › Proventos previstos).
--
-- O "Repetir" do provento planejado (migration 117) cria até 12 meses de proventos PLANEJADOS e acabou: depois a pessoa precisa
-- registrar de novo, e não havia aviso. Esta leitura diz, por ativo, quando a previsão termina, para a tela avisar com tempo.
--
-- Leitura pura (STABLE, SECURITY INVOKER): confere a família com private.is_member e a RLS decide o resto. Não grava nada.
--
-- O que é "acabando" (decisão: as ocorrências do Repetir NÃO têm código de série, cada provento previsto é independente e ligado
-- ao ativo; então o critério é por ATIVO):
--   * o ativo está ativo (não arquivado) e tem proventos PLANEJADOS de p_as_of em diante (fora da lixeira);
--   * o ÚLTIMO desses planejados cai em até p_days dias (de p_as_of até p_as_of + p_days, os dois dias entram): a previsão acaba;
--   * e há PADRÃO de repetição: pelo menos 2 proventos do ativo (pagos ou planejados, fora da lixeira) nos últimos 12 meses
--     até essa última data. Um provento previsto avulso (sem histórico) não é "série acabando" e não avisa.
-- O que NÃO avisa (atalho, ver Pendências): ativo cuja previsão JÁ acabou (nenhum planejado de hoje em diante).
--
-- Colunas: asset_id, asset_name, last_date (último previsto), last_amount (valor previsto nessa data; soma se houver mais de um),
-- planned_count (quantos previstos de hoje em diante), history_count (proventos do ativo nos últimos 12 meses até last_date).
-- Erros: 22023 sem família ou p_days fora de 1 a 366.

create function public.investment_planned_income_ending(p_household uuid, p_days integer default 60, p_as_of date default null)
returns table (asset_id uuid, asset_name text, last_date date, last_amount numeric, planned_count integer, history_count integer)
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_today date;
begin
  if p_household is null or p_days is null or p_days not between 1 and 366 then
    raise exception 'parâmetros inválidos: informe a família e de 1 a 366 dias' using errcode = '22023';
  end if;
  if not (select private.is_member(p_household)) then
    return;
  end if;
  -- a data de hoje em São Paulo direto (private.today_sp não é executável por authenticated, e esta função é SECURITY INVOKER)
  v_today := coalesce(p_as_of, (now() at time zone 'America/Sao_Paulo')::date);

  return query
  with dist as (
    select d.asset_id, t.date, t.amount, t.status
      from public.investment_distributions d
      join public.transactions t
        on t.id = d.transaction_id and t.household_id = d.household_id and t.deleted_at is null
     where d.household_id = p_household
  ),
  planejados as (
    select x.asset_id, max(x.date) as ultima, count(*)::integer as qtde
      from dist x
     where x.status = 'planned' and x.date >= v_today
     group by x.asset_id
  )
  select a.id, a.name, p.ultima,
         (select sum(x.amount) from dist x where x.asset_id = p.asset_id and x.status = 'planned' and x.date = p.ultima),
         p.qtde,
         (select count(*)::integer from dist x
           where x.asset_id = p.asset_id and x.date > (p.ultima - interval '12 months')::date and x.date <= p.ultima)
    from planejados p
    join public.investment_assets a on a.household_id = p_household and a.id = p.asset_id and a.active
   where p.ultima <= v_today + p_days
     and (select count(*) from dist x
           where x.asset_id = p.asset_id and x.date > (p.ultima - interval '12 months')::date and x.date <= p.ultima) >= 2
   order by p.ultima, a.name;
end
$function$;

revoke execute on function public.investment_planned_income_ending(uuid, integer, date) from public, anon;
grant execute on function public.investment_planned_income_ending(uuid, integer, date) to authenticated;
