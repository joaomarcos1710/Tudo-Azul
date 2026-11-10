-- Tudo Azul — migration 104: aporte, resgate e avaliação de investimento só pelo valor (sem unidade nem preço)
--
-- Pedido do dono (10/11/2026): conta é só a conta corrente; cofrinho, CDB, reserva e previdência são investimento, mesmo
-- quando o dinheiro vai e volta. Para isso o app precisa aceitar "pus R$ 500" e "tirei R$ 200" num ativo que não tem
-- cota. Até aqui "Só o valor" valia só para a primeira posição (1 unidade pelo valor); o segundo aporte pedia quantidade
-- e preço (atalho registrado na tela e em 40 - Pendências).
--
-- Como funciona (igual à cota de um fundo, mas escondida de quem usa): o valor de um ativo é quantidade × preço da última
-- avaliação (investment_portfolio). Então:
--   • aporte de V reais  = compra de V / preço_atual unidades, ao preço atual;
--   • resgate de V reais = venda de V / preço_atual unidades, ao preço atual (resgatar o valor todo vende todas as unidades);
--   • "hoje vale T reais" = avaliação com preço T / quantidade.
-- Quem faz a conta é o banco, nunca o front. Nenhuma função existente muda: as novas calculam a quantidade ou o preço e
-- chamam investment_operation_record e investment_valuation_record, que continuam com todas as travas (conta em reais,
-- carteira interna, transferência sem despesa nem receita, venda limitada à posição).
--
--   public.investment_operation_record_by_value(p_asset, p_date, p_kind, p_amount, p_notes, p_account)
--     preço usado: a última avaliação até a data; sem avaliação, o custo médio da posição; sem posição nem avaliação
--     (primeira posição), grava 1 unidade pelo valor, como o "Só o valor" de antes.
--   public.investment_valuation_record_total(p_asset, p_date, p_total, p_source)
--     exige posição na data.
-- As duas conferem que quantidade × preço, arredondado a 2 casas, dá exatamente o valor pedido; se não der (números
-- absurdos), recusam em vez de gravar um centavo diferente.
--
-- Extrato do ativo (investment_asset_statement, corpo da 043): a linha de avaliação passa a trazer em `amount` o valor
-- total (unidades na data × preço). Antes vinha nulo e a tela mostrava o preço por unidade, que num ativo sem cota não
-- diz nada a quem usa. Mesma assinatura e mesmos grants; as outras linhas não mudam.
--
-- Teste: 98_investment_by_value (falha sem esta migration).

create function public.investment_operation_record_by_value(
  p_asset uuid, p_date date, p_kind text, p_amount numeric,
  p_notes text default null, p_account uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_asset public.investment_assets%rowtype;
  v_held numeric;
  v_price numeric;
  v_qty numeric;
  v_market numeric;
begin
  if auth.uid() is null then raise exception 'não autenticado' using errcode = '42501'; end if;
  select * into v_asset from public.investment_assets where id = p_asset for update;
  if not found or not private.is_member(v_asset.household_id) then
    raise exception 'ativo não encontrado' using errcode = '42501';
  end if;
  if p_date is null or p_kind is null or p_kind not in ('buy','sell')
     or p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) or p_amount >= 1e12 then
    raise exception 'dados da operação inválidos' using errcode = '22023';
  end if;

  select coalesce(sum(case when o.kind = 'buy' then o.quantity else -o.quantity end), 0)
    into v_held from public.investment_operations o
   where o.asset_id = v_asset.id and o.household_id = v_asset.household_id
     and o.operation_date <= p_date and o.voided_at is null;

  -- preço atual: última avaliação até a data; senão, o custo médio da posição
  select x.unit_price into v_price
    from public.investment_valuations x
   where x.asset_id = v_asset.id and x.household_id = v_asset.household_id and x.valuation_date <= p_date
   order by x.valuation_date desc, x.created_at desc limit 1;
  if v_price is null and v_held > 0 then
    select p.unit_price into v_price
      from public.investment_portfolio(v_asset.household_id, p_date) p where p.asset_id = v_asset.id;
  end if;
  v_price := round(v_price, 10);

  if v_price is null or v_price <= 0 then
    -- primeira posição: 1 unidade pelo valor. Com operação mais nova já gravada, as unidades não teriam a mesma base.
    if p_kind = 'sell' then
      raise exception 'este ativo não tem posição nesta data para resgatar' using errcode = '23514';
    end if;
    if exists (select 1 from public.investment_operations o
                where o.asset_id = v_asset.id and o.household_id = v_asset.household_id
                  and o.voided_at is null and o.operation_date > p_date) then
      raise exception 'já existe operação depois desta data; use uma data igual ou posterior à da primeira operação'
        using errcode = '22023';
    end if;
    return public.investment_operation_record(p_asset, p_date, 'buy', 1, p_amount, 0, p_notes, p_account);
  end if;

  if p_kind = 'sell' then
    v_market := round(v_held * v_price, 2);
    if v_held <= 0 or p_amount > v_market then
      raise exception 'resgate maior que o valor do ativo nesta data (%); se o valor mudou, registre a avaliação antes', v_market
        using errcode = '23514';
    end if;
    -- resgatar o valor todo zera a posição exatamente (sem sobra de fração de unidade)
    v_qty := case when p_amount = v_market then v_held else least(round(p_amount / v_price, 12), v_held) end;
  else
    v_qty := round(p_amount / v_price, 12);
  end if;

  if v_qty is null or v_qty <= 0 or round(v_qty * v_price, 2) <> p_amount then
    raise exception 'não foi possível converter o valor em unidades sem diferença de centavos; registre por unidades'
      using errcode = '22023';
  end if;
  return public.investment_operation_record(p_asset, p_date, p_kind, v_qty, v_price, 0, p_notes, p_account);
end $$;

create function public.investment_valuation_record_total(
  p_asset uuid, p_date date, p_total numeric, p_source text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_asset public.investment_assets%rowtype;
  v_held numeric;
  v_price numeric;
begin
  if auth.uid() is null then raise exception 'não autenticado' using errcode = '42501'; end if;
  select * into v_asset from public.investment_assets where id = p_asset for update;
  if not found or not private.is_member(v_asset.household_id) then
    raise exception 'ativo não encontrado' using errcode = '42501';
  end if;
  if p_date is null or p_total is null or p_total <= 0 or p_total <> round(p_total, 2) or p_total >= 1e12 then
    raise exception 'dados da avaliação inválidos' using errcode = '22023';
  end if;

  select coalesce(sum(case when o.kind = 'buy' then o.quantity else -o.quantity end), 0)
    into v_held from public.investment_operations o
   where o.asset_id = v_asset.id and o.household_id = v_asset.household_id
     and o.operation_date <= p_date and o.voided_at is null;
  if v_held <= 0 then
    raise exception 'este ativo não tem posição nesta data para avaliar' using errcode = '23514';
  end if;

  v_price := round(p_total / v_held, 10);
  if v_price <= 0 or round(v_held * v_price, 2) <> p_total then
    raise exception 'não foi possível converter o valor em preço por unidade sem diferença de centavos; informe o preço por unidade'
      using errcode = '22023';
  end if;
  return public.investment_valuation_record(p_asset, p_date, v_price, p_source);
end $$;

revoke execute on function public.investment_operation_record_by_value(uuid, date, text, numeric, text, uuid),
  public.investment_valuation_record_total(uuid, date, numeric, text) from public, anon;
grant execute on function public.investment_operation_record_by_value(uuid, date, text, numeric, text, uuid),
  public.investment_valuation_record_total(uuid, date, numeric, text) to authenticated;

create or replace function public.investment_asset_statement(p_household uuid, p_asset uuid)
returns table (
  entry_id uuid, entry_kind text, entry_date date, quantity numeric, unit_price numeric,
  fees numeric, amount numeric, distribution_kind text, distribution_status text, source text,
  notes text, voided boolean, void_reason text, voided_at timestamptz, balance_quantity numeric
)
language sql stable security invoker set search_path = '' as $$
  with ativo as (
    select a.id, a.household_id from public.investment_assets a
     where a.id = p_asset and a.household_id = p_household and (select private.is_member(p_household))
  ), linhas as (
    select o.id, o.kind as entry_kind, o.operation_date as entry_date, o.created_at,
           o.quantity, o.unit_price, o.fees,
           round(case when o.kind = 'buy' then o.quantity*o.unit_price + o.fees
                      else o.quantity*o.unit_price - o.fees end, 2) as amount,
           null::text as distribution_kind, null::text as distribution_status, null::text as source,
           o.notes, o.voided_at is not null as voided, o.void_reason, o.voided_at,
           case when o.voided_at is null then
             sum(case when o.voided_at is not null then 0 when o.kind = 'buy' then o.quantity else -o.quantity end)
               over (order by o.operation_date, o.created_at, o.id)
           end as balance_quantity
      from public.investment_operations o join ativo a on a.id = o.asset_id and a.household_id = o.household_id
    union all
    -- (104) valor total da avaliação: unidades em carteira na data × preço da avaliação; sem posição na data, fica nulo
    select v.id, 'valuation', v.valuation_date, v.created_at, null, v.unit_price, null,
           round(v.unit_price * nullif((
             select coalesce(sum(case when o.kind = 'buy' then o.quantity else -o.quantity end), 0)
               from public.investment_operations o
              where o.asset_id = v.asset_id and o.household_id = v.household_id
                and o.operation_date <= v.valuation_date and o.voided_at is null), 0), 2),
           null, null, v.source, null, false, null, null, null
      from public.investment_valuations v join ativo a on a.id = v.asset_id and a.household_id = v.household_id
    union all
    select d.id, 'distribution', t.date, d.created_at, null, null, null, t.amount,
           d.kind, t.status, null, t.notes, false, null, null, null
      from public.investment_distributions d join ativo a on a.id = d.asset_id and a.household_id = d.household_id
      join public.transactions t on t.id = d.transaction_id and t.household_id = d.household_id and t.deleted_at is null
  )
  select l.id, l.entry_kind, l.entry_date, l.quantity, l.unit_price, l.fees, l.amount,
         l.distribution_kind, l.distribution_status, l.source, l.notes, l.voided, l.void_reason,
         l.voided_at, l.balance_quantity
    from linhas l
   order by l.entry_date, l.created_at, l.id
$$;
