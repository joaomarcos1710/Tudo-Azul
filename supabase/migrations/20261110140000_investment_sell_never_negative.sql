-- Tudo Azul — migration 105: venda de investimento não deixa a posição negativa em nenhuma data
--
-- Bug achado pelo teste da 104 (10/11/2026), em produção desde a migration 100: investment_operation_record conferia a
-- venda só contra a posição ATÉ a data dela. Uma venda com data anterior a outra venda já gravada era aceita:
--   compra de 10 em 10/01, venda de 10 em 10/03, venda de 10 em 10/02  →  posição −10.
-- Com conta escolhida (100), o resgate voltava para a conta duas vezes e o patrimônio subia num dinheiro que não existe.
-- Com a posição negativa, um aporte seguinte ainda fazia investment_portfolio devolver custo e valor nulos.
--
-- Correção: na venda, depois da conferência de sempre, calcula a quantidade acumulada ao fim de cada data já com a venda
-- nova e recusa (23514) se ficar negativa em qualquer data. É a mesma conta de mínimo acumulado que
-- investment_operation_void já usa. Corpo da função: o da migration 100 (20261110090000), com esse único acréscimo.
-- Mesma assinatura, mesmos grants (create or replace). O caminho por valor (104) chama esta função e fica coberto junto.
--
-- Nenhum dado é alterado. Posição que já estivesse negativa continuaria como está (em produção não há nenhuma: conferido
-- em 10/11/2026).
-- Teste: 99_investment_sell_never_negative (falha sem esta migration).

create or replace function public.investment_operation_record(
  p_asset uuid, p_date date, p_kind text, p_quantity numeric,
  p_unit_price numeric, p_fees numeric default 0, p_notes text default null, p_account uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_asset public.investment_assets%rowtype;
  v_acc public.accounts%rowtype;
  v_held numeric;
  v_id uuid;
  v_valor numeric;
  v_carteira uuid;
  v_tx uuid;
  v_min numeric;
begin
  if auth.uid() is null then raise exception 'não autenticado' using errcode = '42501'; end if;
  select * into v_asset from public.investment_assets where id = p_asset for update;
  if not found or not private.is_member(v_asset.household_id) then
    raise exception 'ativo não encontrado' using errcode = '42501';
  end if;
  if not v_asset.active then raise exception 'ativo arquivado' using errcode = '55000'; end if;
  if p_date is null or p_date > private.today_sp() or p_date < date '2000-01-01'
     or p_kind not in ('buy','sell') or p_quantity is null or p_quantity <= 0
     or p_quantity <> round(p_quantity,12)
     or p_unit_price is null or p_unit_price <= 0 or p_unit_price <> round(p_unit_price,10)
     or p_fees is null or p_fees < 0 or p_fees <> round(p_fees,2)
     or abs(p_quantity) >= 1e18 or abs(p_unit_price) >= 1e12 or abs(p_fees) >= 1e12
     or (p_notes is not null and char_length(p_notes) > 500) then
    raise exception 'dados da operação inválidos' using errcode = '22023';
  end if;
  -- (100) conta que paga a compra ou recebe a venda
  if p_account is not null then
    select * into v_acc from public.accounts where id = p_account for share;
    if not found or v_acc.household_id <> v_asset.household_id then
      raise exception 'conta não encontrada' using errcode = '42501';
    end if;
    if v_acc.system_role is not null then
      raise exception 'conta inválida: a carteira de investimentos não paga nem recebe operações' using errcode = '22023';
    end if;
    if not v_acc.active then
      raise exception 'conta inválida: a conta está arquivada' using errcode = '22023';
    end if;
    if v_asset.currency_code <> 'BRL' or v_acc.currency_code <> 'BRL' then
      raise exception 'conta inválida: só ativo em reais movimenta conta, e só conta em reais' using errcode = '22023';
    end if;
    v_valor := round(case when p_kind = 'buy' then p_quantity * p_unit_price + p_fees
                          else p_quantity * p_unit_price - p_fees end, 2);
    if v_valor <= 0 then
      raise exception 'o valor líquido da operação na conta (%) precisa ser maior que zero', v_valor using errcode = '22023';
    end if;
    if v_valor >= 1e12 then
      raise exception 'dados da operação inválidos' using errcode = '22023';
    end if;
  end if;
  if p_kind = 'sell' then
    select coalesce(sum(case when o.kind='buy' then o.quantity else -o.quantity end),0)
      into v_held from public.investment_operations o
     where o.asset_id = v_asset.id and o.household_id = v_asset.household_id
       and o.operation_date <= p_date and o.voided_at is null;
    if p_quantity > v_held then
      raise exception 'quantidade vendida supera a posição disponível' using errcode = '23514';
    end if;
    -- (105) a posição não pode ficar negativa em NENHUMA data: a conferência acima só olha até a data desta venda, então
    -- uma venda com data anterior a outra venda já gravada passava e vendia as mesmas unidades duas vezes.
    select min(s.saldo) into v_min from (
      select sum(sum(x.q)) over (order by x.d) as saldo
        from (
          select o.operation_date as d, case when o.kind = 'buy' then o.quantity else -o.quantity end as q
            from public.investment_operations o
           where o.asset_id = v_asset.id and o.household_id = v_asset.household_id and o.voided_at is null
          union all
          select p_date, -p_quantity
        ) x
       group by x.d
    ) s;
    if v_min < 0 then
      raise exception 'esta venda usaria unidades que já foram vendidas depois desta data; confira as vendas posteriores'
        using errcode = '23514';
    end if;
  end if;
  if p_account is not null then
    v_carteira := private.investment_portfolio_account(v_asset.household_id);
    perform set_config('app.investment_portfolio', v_asset.household_id::text, true);
    insert into public.transactions (household_id, account_id, destination_account_id, type, description, amount, date, status)
    values (v_asset.household_id,
            case when p_kind = 'buy' then p_account else v_carteira end,
            case when p_kind = 'buy' then v_carteira else p_account end,
            'transfer',
            case when p_kind = 'buy' then 'Aporte: ' else 'Resgate: ' end || v_asset.name,
            v_valor, p_date, 'paid')
    returning id into v_tx;
    perform set_config('app.investment_portfolio', '', true);
  end if;
  insert into public.investment_operations
    (household_id,asset_id,operation_date,kind,quantity,unit_price,fees,notes,created_by,transaction_id)
  values (v_asset.household_id,v_asset.id,p_date,p_kind,p_quantity,p_unit_price,p_fees,p_notes,auth.uid(),v_tx)
  returning id into v_id;
  return v_id;
end $$;
