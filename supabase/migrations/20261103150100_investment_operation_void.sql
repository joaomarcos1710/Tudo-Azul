-- Tudo Azul — migration 043: extrato do ativo e anulação auditada de operação de investimento.
--
-- Pedido do dono: registrou uma compra errada e não havia tela que listasse as operações do ativo,
-- nem como desfazê-la (investment_asset_delete, migration 039, recusa ativo com histórico).
-- Regra (a mesma das dívidas, debt_void): dinheiro registrado não se apaga; a operação é ANULADA,
-- com data, autor e motivo. Anulada continua no extrato (riscada) e deixa de contar em posição,
-- custo, histórico, alocação, arquivamento e na checagem de venda.
-- Anular não pode deixar a quantidade negativa em nenhum ponto do razão (ex.: anular a compra que
-- cobre uma venda posterior): recusa 23514; anule a venda antes.

alter table public.investment_operations
  add column voided_at   timestamptz,
  add column voided_by   uuid references public.profiles(id) on delete restrict,
  add column void_reason text,
  add constraint investment_operations_void_chk check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null and void_reason is not null
        and char_length(btrim(void_reason)) between 3 and 200)
  );
-- O cliente só tem SELECT nesta tabela (migration 030: revoke all + grant select); a anulação passa
-- pela RPC abaixo. O teste de auditoria confere que não há UPDATE nas colunas novas.

create function public.investment_operation_void(p_operation uuid, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_op public.investment_operations%rowtype;
  v_asset public.investment_assets%rowtype;
  v_reason text := btrim(p_reason);
  v_min numeric;
begin
  if auth.uid() is null then raise exception 'não autenticado' using errcode = '42501'; end if;
  select * into v_op from public.investment_operations where id = p_operation;
  if not found then raise exception 'operação não encontrada' using errcode = '42501'; end if;
  -- mesma ordem de lock das outras funções de ativo: o ativo primeiro
  select * into v_asset from public.investment_assets
   where id = v_op.asset_id and household_id = v_op.household_id for update;
  if not found or not private.is_member(v_asset.household_id) then
    raise exception 'operação não encontrada' using errcode = '42501';
  end if;
  select * into v_op from public.investment_operations where id = p_operation for update;
  if v_op.voided_at is not null then
    raise exception 'esta operação já foi anulada' using errcode = '55000';
  end if;
  if not v_asset.active then
    raise exception 'ativo arquivado: reative o ativo antes de anular uma operação' using errcode = '55000';
  end if;
  if v_reason is null or char_length(v_reason) not between 3 and 200 then
    raise exception 'informe o motivo da anulação (3 a 200 caracteres)' using errcode = '22023';
  end if;

  -- Quantidade acumulada ao fim de cada data, sem a operação anulada (mesma regra da venda em
  -- investment_operation_record, que compara com a posição até a data da venda).
  select min(saldo) into v_min from (
    select sum(sum(case when o.kind = 'buy' then o.quantity else -o.quantity end))
             over (order by o.operation_date) as saldo
      from public.investment_operations o
     where o.asset_id = v_asset.id and o.household_id = v_asset.household_id
       and o.voided_at is null and o.id <> v_op.id
     group by o.operation_date
  ) s;
  if v_min < 0 then
    raise exception 'não dá para anular: sem esta compra, as vendas posteriores ficariam maiores que a posição. Anule a venda antes.'
      using errcode = '23514';
  end if;

  update public.investment_operations
     set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason
   where id = v_op.id;
end $$;

-- Venda: a posição disponível ignora operações anuladas.
create or replace function public.investment_operation_record(
  p_asset uuid, p_date date, p_kind text, p_quantity numeric,
  p_unit_price numeric, p_fees numeric default 0, p_notes text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_asset public.investment_assets%rowtype;
  v_held numeric;
  v_id uuid;
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
  if p_kind = 'sell' then
    select coalesce(sum(case when o.kind='buy' then o.quantity else -o.quantity end),0)
      into v_held from public.investment_operations o
     where o.asset_id = v_asset.id and o.household_id = v_asset.household_id
       and o.operation_date <= p_date and o.voided_at is null;
    if p_quantity > v_held then
      raise exception 'quantidade vendida supera a posição disponível' using errcode = '23514';
    end if;
  end if;
  insert into public.investment_operations
    (household_id,asset_id,operation_date,kind,quantity,unit_price,fees,notes,created_by)
  values (v_asset.household_id,v_asset.id,p_date,p_kind,p_quantity,p_unit_price,p_fees,p_notes,auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Arquivar: posição aberta calculada sem as anuladas.
create or replace function public.investment_asset_archive(p_asset uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_asset public.investment_assets%rowtype;
  v_held numeric;
begin
  if auth.uid() is null then raise exception 'não autenticado' using errcode = '42501'; end if;
  select * into v_asset from public.investment_assets where id = p_asset for update;
  if not found or not private.is_member(v_asset.household_id) then
    raise exception 'ativo não encontrado' using errcode = '42501';
  end if;
  if not v_asset.active then return; end if;
  select coalesce(sum(case when o.kind = 'buy' then o.quantity else -o.quantity end), 0) into v_held
    from public.investment_operations o
   where o.asset_id = v_asset.id and o.household_id = v_asset.household_id and o.voided_at is null;
  if v_held > 0 then
    raise exception 'ainda há posição aberta: venda tudo antes de arquivar' using errcode = '23514';
  end if;
  update public.investment_assets set active = false where id = v_asset.id;
end $$;

-- Posição (igual à 030, sem as anuladas). investment_totals e investment_allocation só chamam esta.
create or replace function public.investment_portfolio(p_household uuid, p_as_of date)
returns table (
  asset_id uuid, name text, ticker text, asset_class text, currency_code text,
  quantity numeric, average_cost numeric, cost_basis numeric, unit_price numeric,
  market_value numeric, unrealized_result numeric, valuation_date date, valuation_source text
)
language sql stable security invoker set search_path = '' as $$
  with recursive operations as (
    select o.asset_id, o.kind, o.quantity, o.unit_price, o.fees, o.operation_date, o.created_at, o.id,
      row_number() over (partition by o.asset_id order by o.operation_date, o.created_at, o.id) as rn
    from public.investment_operations o
    join public.investment_assets a on a.id=o.asset_id and a.household_id=o.household_id
    where o.household_id=p_household and o.operation_date <= p_as_of and a.active and o.voided_at is null
  ), ledger as (
    select o.asset_id, o.rn,
      o.quantity as quantity,
      o.quantity*o.unit_price + o.fees as cost_basis
    from operations o where o.rn=1 and o.kind='buy'
    union all
    select o.asset_id, o.rn,
      case when o.kind='buy' then l.quantity+o.quantity else l.quantity-o.quantity end,
      case when o.kind='buy' then l.cost_basis + o.quantity*o.unit_price + o.fees
           else l.cost_basis - (l.cost_basis/nullif(l.quantity,0))*o.quantity end
    from ledger l
    join operations o on o.asset_id=l.asset_id and o.rn=l.rn+1
  ), positions as (
    select distinct on (l.asset_id) l.asset_id,l.quantity,l.cost_basis,
      case when l.quantity>0 then l.cost_basis/l.quantity else 0 end as avg_cost
    from ledger l order by l.asset_id,l.rn desc
  )
  select a.id,a.name,a.ticker,a.asset_class,a.currency_code,p.quantity,
    round(p.avg_cost,10),round(p.cost_basis,2),
    coalesce(v.unit_price,p.avg_cost),
    round(p.quantity*coalesce(v.unit_price,p.avg_cost),2),
    round(p.quantity*coalesce(v.unit_price,p.avg_cost)-p.cost_basis,2),
    v.valuation_date,v.source
  from positions p
  join public.investment_assets a on a.id=p.asset_id and a.household_id=p_household
  left join lateral (
    select x.unit_price,x.valuation_date,x.source
    from public.investment_valuations x
    where x.asset_id=p.asset_id and x.household_id=p_household and x.valuation_date<=p_as_of
    order by x.valuation_date desc,x.created_at desc limit 1
  ) v on true
  where p.quantity>0 and a.active
  order by a.currency_code,a.name
$$;

-- Histórico (igual à 041, sem as anuladas).
create or replace function public.investment_history(p_household uuid, p_from date, p_to date)
returns table(month date, currency_code text, market_value numeric, cost_basis numeric)
language sql stable security invoker set search_path = '' as $$
  with recursive meses as (
    select generate_series(
      date_trunc('month', p_from)::date,
      date_trunc('month', p_to)::date,
      interval '1 month'
    )::date as mes
  ), moedas as (
    select distinct a.currency_code
      from public.investment_assets a
     where a.household_id = p_household
  ), operations as (
    select o.asset_id, o.kind, o.quantity, o.unit_price, o.fees, o.operation_date,
      row_number() over (partition by o.asset_id order by o.operation_date, o.created_at, o.id) as rn
    from public.investment_operations o
    where o.household_id = p_household and o.operation_date <= p_to and o.voided_at is null
  ), ledger as (
    select o.asset_id, o.rn, o.operation_date,
      o.quantity as quantity,
      o.quantity*o.unit_price + o.fees as cost_basis
    from operations o where o.rn = 1 and o.kind = 'buy'
    union all
    select o.asset_id, o.rn, o.operation_date,
      case when o.kind = 'buy' then l.quantity + o.quantity else l.quantity - o.quantity end,
      case when o.kind = 'buy' then l.cost_basis + o.quantity*o.unit_price + o.fees
           else l.cost_basis - (l.cost_basis/nullif(l.quantity,0))*o.quantity end
    from ledger l
    join operations o on o.asset_id = l.asset_id and o.rn = l.rn + 1
  ), por_mes as (
    select m.mes, a.currency_code, pos.quantity, pos.cost_basis,
           coalesce(v.unit_price, case when pos.quantity > 0 then pos.cost_basis/pos.quantity else 0 end) as preco
      from meses m
      cross join public.investment_assets a
      cross join lateral (select least((m.mes + interval '1 month - 1 day')::date, p_to) as fim) f
      cross join lateral (
        select l.quantity, l.cost_basis from ledger l
         where l.asset_id = a.id and l.operation_date <= f.fim
         order by l.rn desc limit 1
      ) pos
      left join lateral (
        select x.unit_price from public.investment_valuations x
         where x.asset_id = a.id and x.household_id = p_household and x.valuation_date <= f.fim
         order by x.valuation_date desc, x.created_at desc limit 1
      ) v on true
     where a.household_id = p_household and pos.quantity > 0
  )
  select m.mes, c.currency_code,
         coalesce(round(sum(p.quantity*p.preco) filter (where p.mes is not null), 2), 0)::numeric,
         coalesce(round(sum(p.cost_basis) filter (where p.mes is not null), 2), 0)::numeric
    from meses m
    cross join moedas c
    left join por_mes p on p.mes = m.mes and p.currency_code = c.currency_code
   where p_household is not null and p_from is not null and p_to is not null
     and p_from <= p_to and private.is_member(p_household)
   group by m.mes, c.currency_code
   order by m.mes, c.currency_code
$$;

-- Extrato do ativo: compras, vendas, avaliações e proventos em ordem de data.
-- amount: compra = quantidade × preço + taxa; venda = quantidade × preço − taxa (líquido);
-- provento = valor do lançamento; avaliação = sem valor. balance_quantity = quantidade acumulada
-- após cada compra/venda NÃO anulada (nulo nas demais linhas). Provento na lixeira não aparece.
create function public.investment_asset_statement(p_household uuid, p_asset uuid)
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
    select v.id, 'valuation', v.valuation_date, v.created_at, null, v.unit_price, null, null,
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

revoke execute on function public.investment_operation_void(uuid, text),
  public.investment_asset_statement(uuid, uuid) from public, anon;
grant execute on function public.investment_operation_void(uuid, text),
  public.investment_asset_statement(uuid, uuid) to authenticated;
