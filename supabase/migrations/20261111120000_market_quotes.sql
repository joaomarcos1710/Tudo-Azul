-- Tudo Azul — migration 109: cotação da bolsa (ações, fundos imobiliários, ETFs) buscada todo dia útil na brapi
--
-- Pedido do dono (11/11/2026): o valor das ações e dos fundos imobiliários acompanhar a bolsa, sem digitar. O câmbio
-- continua só pela PTAX do Banco Central (migration 108, decisão do mesmo dia); aqui entra só a renda variável brasileira.
-- Fonte: brapi.dev (GET /api/v2/stocks/quote?symbols=CODIGO, com a chave no cabeçalho Authorization). No plano
-- gratuito: 15.000 chamadas por mês, 1 código por chamada, 1 chamada por vez, atraso de ~30 minutos.
--
-- O que entra:
--   1. public.market_quotes: uma cotação por código e por dia (o preço de uma cota, a moeda, o horário do pregão e a
--      fonte). É dado de mercado, igual para todas as famílias, como fx_rates: quem está logado lê, ninguém do app grava.
--      Uma nova busca no mesmo dia troca o preço só se o horário do pregão for mais novo (a busca da noite fica com o
--      fechamento); dia que passou não muda mais.
--   2. public.investment_assets.market_quote (falso por padrão): o ativo segue a cotação da bolsa. É uma escolha de quem
--      usa, por ativo, e não uma dedução pelo código: um ativo lançado "só pelo valor" guarda 1 unidade (ou frações) no
--      lugar das cotas, e multiplicar isso pelo preço da bolsa faria o valor desabar. Nenhum ativo existente muda.
--      public.investment_asset_set_market_quote(p_asset, p_on) liga e desliga. Para ligar: ação, fundo imobiliário, ETF
--      ou fundo, em reais, com código da B3 (4 letras e 1 ou 2 números, ex.: PETR4), e todas as operações em quantidade
--      inteira (fração de cota é sinal de lançamento pelo valor).
--   3. private.investment_quote_symbol(ligado, ticker, classe, moeda): o código a consultar, ou nulo quando o ativo não
--      segue a bolsa. É o único lugar que decide isso.
--   4. private.investment_price_at(família, ativo, data): o preço de uma unidade na data, a data dele e a fonte. Regra do
--      dono: entre a última avaliação digitada e a última cotação da bolsa, vale a MAIS RECENTE; no mesmo dia, a digitada
--      ("Atualizar valor" continua servindo de correção). Sem nenhuma das duas, devolve vazio (quem chama usa o custo).
--   5. public.investment_portfolio e public.investment_history passam a ler o preço por (4). São as duas únicas funções
--      que calculam valor de mercado; totais, alocação, liquidez, instituição, aportes, patrimônio e Início chamam
--      investment_portfolio e mudam junto. Mesmas assinaturas, mesmas colunas e mesmos grants. Para ativo que não segue a
--      bolsa o resultado é idêntico ao de antes.
--   6. public.investment_operation_record_by_value recusa ativo que segue a bolsa ("lance a quantidade de cotas e o
--      preço"). O resto da função é o da migration 104, sem mudança. A avaliação pelo total (investment_valuation_record_
--      total) continua aceita: ela divide pelo número de cotas, que nesses ativos é o real.
--   7. private.market_quote_record(código, resposta): lê a resposta da brapi e grava a cotação. Ignora (devolve falso) o
--      que não serve de preço: código que a brapi trocou por outro (pode vir com proporção de conversão) e cotação que
--      não é em reais. Resposta fora do formato LEVANTA erro.
--   8. private.market_quotes_fetch(p_limit): busca, um por vez (até 200 por rodada), os códigos dos ativos ativos que seguem a bolsa (de todas
--      as famílias, sem repetir) e grava. A chave fica no cofre do Supabase (Vault), no segredo "brapi_token": nunca em
--      código, variável, URL ou log. Sem ativo para buscar, não precisa da chave e devolve um texto. Sem a chave, com a
--      chave recusada (401/403), cota esgotada (429) ou qualquer outra falha, LEVANTA erro: o cron mostra "failed" e a
--      rodada inteira é desfeita (a próxima tenta de novo). Código que a brapi não conhece (404) não é falha: conta
--      como "sem cotação" e os outros seguem.
--   9. Agendamento: job cotacoes-bolsa, dias úteis às 17:30 e 22:30 UTC (14:30 e 19:30 em Brasília): uma no meio do
--      pregão e outra depois do fechamento. Feriado devolve o último pregão (mesma linha, nada muda).
--
-- Códigos de erro: 42501 não autenticado ou ativo de outra família/inexistente; 22023 ativo que não pode seguir a bolsa,
-- operação pelo valor em ativo que segue a bolsa, código ou resposta inválidos; 58000 cofre ou chave ausente, ou a brapi
-- respondeu diferente de 200 e de 404.
-- Teste: 103_market_quotes (falha sem esta migration).

-- ---------------------------------------------------------------------------
-- 1. Cotações de mercado
-- ---------------------------------------------------------------------------
create table public.market_quotes (
  symbol        text not null check (symbol ~ '^[A-Z]{4}[0-9]{1,2}$'),
  quote_date    date not null check (quote_date between date '2000-01-01' and date '2100-01-01'),
  price         numeric not null check (price > 0 and price = round(price, 10) and abs(price) < 1e12),
  currency_code text not null references public.currencies(code),
  market_time   timestamptz not null,
  source        text not null check (char_length(btrim(source)) between 1 and 40),
  fetched_at    timestamptz not null default now(),
  primary key (symbol, quote_date)
);

-- a política de leitura está logo depois da coluna market_quote (bloco 2 e 3)

-- ---------------------------------------------------------------------------
-- 2 e 3. O ativo segue a bolsa?
-- ---------------------------------------------------------------------------
alter table public.investment_assets add column market_quote boolean not null default false;

alter table public.market_quotes enable row level security;


create function private.investment_quote_symbol(p_on boolean, p_ticker text, p_class text, p_currency text)
returns text
language sql immutable security invoker set search_path = '' as $$
  select case when p_on and p_currency = 'BRL' and p_class in ('equity', 'reit', 'etf', 'fund')
                   and upper(btrim(p_ticker)) ~ '^[A-Z]{4}[0-9]{1,2}$'
              then upper(btrim(p_ticker)) end
$$;

-- I4: cada família só enxerga as cotações dos códigos que ela própria segue (a RLS de investment_assets já limita a ela)
create policy market_quotes_select on public.market_quotes
  for select to authenticated using (exists (
    select 1 from public.investment_assets a
     where a.market_quote
       and private.investment_quote_symbol(a.market_quote, a.ticker, a.asset_class, a.currency_code) = market_quotes.symbol));
revoke all on public.market_quotes from public, anon, authenticated;
grant select on public.market_quotes to authenticated;

create function public.investment_asset_set_market_quote(p_asset uuid, p_on boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_asset public.investment_assets%rowtype;
begin
  if auth.uid() is null then raise exception 'não autenticado' using errcode = '42501'; end if;
  select * into v_asset from public.investment_assets where id = p_asset for update;
  if not found or not private.is_member(v_asset.household_id) then
    raise exception 'ativo não encontrado' using errcode = '42501';
  end if;
  if p_on is null then
    raise exception 'escolha inválida' using errcode = '22023';
  end if;
  if p_on then
    if private.investment_quote_symbol(true, v_asset.ticker, v_asset.asset_class, v_asset.currency_code) is null then
      raise exception 'para seguir a cotação da bolsa, o ativo precisa ser ação, fundo imobiliário, ETF ou fundo, em reais, com o código da B3 (ex.: PETR4)'
        using errcode = '22023';
    end if;
    -- fração de cota não existe na B3: é sinal de aporte ou resgate lançado só pelo valor (cotas escondidas)
    if exists (select 1 from public.investment_operations o
                where o.asset_id = v_asset.id and o.household_id = v_asset.household_id
                  and o.voided_at is null and o.quantity <> trunc(o.quantity)) then
      raise exception 'este ativo tem lançamento só pelo valor (sem a quantidade de cotas); a cotação da bolsa precisa da quantidade real'
        using errcode = '22023';
    end if;
  end if;
  update public.investment_assets set market_quote = p_on where id = v_asset.id;
end $$;

-- ---------------------------------------------------------------------------
-- 4. O preço de uma unidade na data
-- ---------------------------------------------------------------------------
create function private.investment_price_at(p_household uuid, p_asset uuid, p_as_of date)
returns table (unit_price numeric, price_date date, source text)
language sql stable security invoker set search_path = '' as $$
  select c.unit_price, c.price_date, c.source
    from (
      (select x.unit_price, x.valuation_date as price_date, x.source, 0 as ordem
         from public.investment_valuations x
        where x.asset_id = p_asset and x.household_id = p_household and x.valuation_date <= p_as_of
        order by x.valuation_date desc, x.created_at desc limit 1)
      union all
      (select q.price, q.quote_date, q.source, 1
         from public.investment_assets a
         join public.market_quotes q
           on q.symbol = private.investment_quote_symbol(a.market_quote, a.ticker, a.asset_class, a.currency_code)
          and q.currency_code = a.currency_code
        where a.id = p_asset and a.household_id = p_household and q.quote_date <= p_as_of
        order by q.quote_date desc limit 1)
    ) c
   order by c.price_date desc, c.ordem
   limit 1
$$;

-- ---------------------------------------------------------------------------
-- 5. Posição e histórico leem o preço por investment_price_at
-- ---------------------------------------------------------------------------
-- Corpo da migration 043 (20261103150100); muda só de onde vem o preço (o left join lateral do fim).
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
    v.price_date,v.source
  from positions p
  join public.investment_assets a on a.id=p.asset_id and a.household_id=p_household
  left join lateral private.investment_price_at(p_household, p.asset_id, p_as_of) v on true
  where p.quantity>0 and a.active
  order by a.currency_code,a.name
$$;

-- Corpo da migration 043 (20261103150100); muda só de onde vem o preço de cada fim de mês.
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
      -- mesma regra de private.investment_price_at, embutida: a função separada custa ~6× no histórico (1.480 chamadas)
      left join lateral (
        select u.unit_price from (
          (select x.unit_price, x.valuation_date as d, 0 as ordem
             from public.investment_valuations x
            where x.asset_id = a.id and x.household_id = p_household and x.valuation_date <= f.fim
            order by x.valuation_date desc, x.created_at desc limit 1)
          union all
          (select q.price, q.quote_date, 1
             from public.market_quotes q
            where q.symbol = private.investment_quote_symbol(a.market_quote, a.ticker, a.asset_class, a.currency_code)
              and q.currency_code = a.currency_code and q.quote_date <= f.fim
            order by q.quote_date desc limit 1)
        ) u
        order by u.d desc, u.ordem limit 1
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

-- ---------------------------------------------------------------------------
-- 6. Lançamento só pelo valor: recusado em ativo que segue a bolsa (resto igual à migration 104)
-- ---------------------------------------------------------------------------
create or replace function public.investment_operation_record_by_value(
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
  v_last date;
begin
  if auth.uid() is null then raise exception 'não autenticado' using errcode = '42501'; end if;
  select * into v_asset from public.investment_assets where id = p_asset for update;
  if not found or not private.is_member(v_asset.household_id) then
    raise exception 'ativo não encontrado' using errcode = '42501';
  end if;
  -- ativo com a escolha ligada: a quantidade tem de ser a de cotas de verdade. Vale mesmo com o código fora da bolsa
  -- agora (B2: se o código voltar, a fração seria multiplicada pela cotação)
  if v_asset.market_quote then
    raise exception 'este ativo acompanha a cotação da bolsa: lance a quantidade de cotas e o preço' using errcode = '22023';
  end if;
  if p_date is null or p_kind is null or p_kind not in ('buy','sell')
     or p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) or p_amount >= 1e12 then
    raise exception 'dados da operação inválidos' using errcode = '22023';
  end if;

  -- último movimento do ativo: operação não anulada ou avaliação
  select greatest(
    (select max(o.operation_date) from public.investment_operations o
      where o.asset_id = v_asset.id and o.household_id = v_asset.household_id and o.voided_at is null),
    (select max(x.valuation_date) from public.investment_valuations x
      where x.asset_id = v_asset.id and x.household_id = v_asset.household_id))
    into v_last;
  if v_last is not null and p_date < v_last then
    raise exception 'este investimento já tem movimento em %; pelo valor, use essa data ou uma posterior', to_char(v_last, 'DD/MM/YYYY')
      using errcode = '22023';
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
    -- primeira posição: 1 unidade pelo valor
    if p_kind = 'sell' then
      raise exception 'este ativo não tem posição nesta data para resgatar' using errcode = '23514';
    end if;
    return public.investment_operation_record(p_asset, p_date, 'buy', 1, p_amount, 0, p_notes, p_account);
  end if;

  if p_kind = 'sell' then
    v_market := round(v_held * v_price, 2);
    if v_held <= 0 or p_amount > v_market then
      raise exception 'resgate maior que o valor do investimento nesta data (R$ %); se o valor mudou, registre a avaliação antes',
        replace(replace(replace(to_char(v_market, 'FM999,999,999,990.00'), ',', '#'), '.', ','), '#', '.')
        using errcode = '23514';
    end if;
    -- resgatar o valor todo zera a posição exatamente (sem sobra de fração de unidade)
    v_qty := case when p_amount = v_market then v_held else least(round(p_amount / v_price, 12), v_held) end;
    -- sem resto invisível: unidades que sobrariam valendo R$ 0,00 ficariam presas (nem resgate nem arquivo)
    if v_qty < v_held and round((v_held - v_qty) * v_price, 2) = 0 then
      raise exception 'sobraria menos de 1 centavo neste investimento; para zerar, resgate o total de R$ %',
        replace(replace(replace(to_char(v_market, 'FM999,999,999,990.00'), ',', '#'), '.', ','), '#', '.')
        using errcode = '23514';
    end if;
  else
    v_qty := round(p_amount / v_price, 12);
  end if;

  if v_qty is null or v_qty <= 0 or round(v_qty * v_price, 2) <> p_amount then
    raise exception 'não foi possível registrar este valor sem diferença de centavos'
      using errcode = '22023';
  end if;
  return public.investment_operation_record(p_asset, p_date, p_kind, v_qty, v_price, 0, p_notes, p_account);
end $$;

revoke execute on function public.investment_asset_set_market_quote(uuid, boolean) from public, anon;
grant execute on function public.investment_asset_set_market_quote(uuid, boolean) to authenticated;
-- as duas são chamadas de dentro de funções SECURITY INVOKER (posição e histórico): quem está logado precisa executar
revoke execute on function private.investment_quote_symbol(boolean, text, text, text),
  private.investment_price_at(uuid, uuid, date) from public, anon;
grant execute on function private.investment_quote_symbol(boolean, text, text, text),
  private.investment_price_at(uuid, uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Gravar a resposta da brapi
-- ---------------------------------------------------------------------------
create function private.market_quote_record(p_symbol text, p_payload jsonb)
returns boolean
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_item jsonb;
  v_data jsonb;
  v_price numeric;
  v_time timestamptz;
  v_date date;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if p_symbol is null or p_symbol !~ '^[A-Z]{4}[0-9]{1,2}$' then
    raise exception 'cotação da bolsa: código inválido' using errcode = '22023';
  end if;
  if p_payload is null or jsonb_typeof(p_payload -> 'results') is distinct from 'array' then
    raise exception 'cotação de %: resposta fora do formato', p_symbol using errcode = '22023';
  end if;
  select r into v_item from jsonb_array_elements(p_payload -> 'results') r
   where r ->> 'requestedSymbol' = p_symbol limit 1;
  if v_item is null then
    return false;  -- a brapi deixa fora de results o código que não tem cotação
  end if;
  -- código trocado: a brapi devolve o papel novo, às vezes com proporção de conversão; não serve de preço para este
  if v_item ->> 'changed' is distinct from 'false' or v_item ->> 'symbol' is distinct from p_symbol then
    return false;
  end if;
  v_data := v_item -> 'data';
  if jsonb_typeof(v_data) is distinct from 'object' then
    raise exception 'cotação de %: resposta fora do formato', p_symbol using errcode = '22023';
  end if;
  if v_data ->> 'currency' is distinct from 'BRL' then
    return false;
  end if;
  begin
    v_price := round((v_data ->> 'regularMarketPrice')::numeric, 10);
    v_time := (v_data ->> 'regularMarketTime')::timestamptz;
  exception when others then
    raise exception 'cotação de %: preço ou horário fora do formato', p_symbol using errcode = '22023';
  end;
  if v_price is null or v_time is null or v_price <= 0 or v_price >= 1e12 then
    raise exception 'cotação de %: preço ou horário fora do formato', p_symbol using errcode = '22023';
  end if;
  v_date := (v_time at time zone 'America/Sao_Paulo')::date;
  if v_date > v_hoje or v_date < date '2000-01-01' then
    raise exception 'cotação de %: data do pregão fora do esperado (%)', p_symbol, v_date using errcode = '22023';
  end if;
  insert into public.market_quotes (symbol, quote_date, price, currency_code, market_time, source)
  values (p_symbol, v_date, v_price, 'BRL', v_time, 'brapi')
  on conflict (symbol, quote_date) do update
    set price = excluded.price, market_time = excluded.market_time, source = excluded.source, fetched_at = now()
    where public.market_quotes.market_time < excluded.market_time;
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- 8. Buscar na brapi
-- ---------------------------------------------------------------------------
create function private.market_quotes_fetch(p_limit integer default 200)
returns text
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_symbols text[];
  v_total integer;
  v_symbol text;
  v_token text;
  v_resposta record;
  v_falhou boolean;
  v_ok integer := 0;
  v_sem integer := 0;
  v_erro integer := 0;
  v_teto integer := least(greatest(coalesce(p_limit, 200), 1), 200);
begin
  select count(distinct private.investment_quote_symbol(a.market_quote, a.ticker, a.asset_class, a.currency_code))
    into v_total
    from public.investment_assets a
   where a.active and a.market_quote
     and private.investment_quote_symbol(a.market_quote, a.ticker, a.asset_class, a.currency_code) is not null;
  -- I1: sem teto alfabético silencioso. Até 200 códigos por rodada; o que sobra aparece no retorno, não some
  select coalesce(array_agg(x.s order by x.s), '{}') into v_symbols
    from (select distinct private.investment_quote_symbol(a.market_quote, a.ticker, a.asset_class, a.currency_code) as s
            from public.investment_assets a
           where a.active and a.market_quote
             and private.investment_quote_symbol(a.market_quote, a.ticker, a.asset_class, a.currency_code) is not null
           order by 1
           limit v_teto) x;
  if cardinality(v_symbols) = 0 then
    return 'nenhum ativo segue a cotação da bolsa';
  end if;

  -- a chave só existe no cofre; sem cofre ou sem chave a busca ESTOURA antes de qualquer chamada de rede
  if to_regclass('vault.decrypted_secrets') is null then
    raise exception 'cotações da bolsa: este banco não tem o cofre de segredos (Vault)' using errcode = '58000';
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into v_token using 'brapi_token';
  v_token := nullif(btrim(v_token), '');
  if v_token is null then
    raise exception 'cotações da bolsa: a chave da brapi não está no cofre (segredo brapi_token)' using errcode = '58000';
  end if;

  perform set_config('http.timeout_msec', '20000', true);
  begin
    execute 'select fx_http.http_set_curlopt($1, $2)' using 'CURLOPT_TIMEOUT_MS', '20000';
  exception when others then null;
  end;

  foreach v_symbol in array v_symbols loop
    v_falhou := false;
    -- o código passou pelo formato da B3 (só letras e números): não há o que escapar na URL. A chave vai no cabeçalho.
    begin
      execute 'select r.status, r.content from fx_http.http((''GET'', $1, '
           || 'array[fx_http.http_header(''Authorization'', $2)], null, null)::fx_http.http_request) r'
        into v_resposta using 'https://brapi.dev/api/v2/stocks/quote?symbols=' || v_symbol, 'Bearer ' || v_token;
    exception when others then
      v_falhou := true; -- rede, tempo limite ou resposta que não é HTTP: erro deste código
    end;
    if v_falhou then
      v_erro := v_erro + 1;
    elsif v_resposta.status = 200 then
      -- I2: resposta fora do formato de UM código não derruba os outros
      begin
        if private.market_quote_record(v_symbol, v_resposta.content::jsonb) then
          v_ok := v_ok + 1;
        else
          v_sem := v_sem + 1;
        end if;
      exception when others then
        v_erro := v_erro + 1;
      end;
    elsif v_resposta.status = 404 then
      v_sem := v_sem + 1;
    elsif v_resposta.status in (401, 403, 429) then
      -- chave recusada ou cota esgotada: não adianta seguir; a rodada para e o cron mostra "failed"
      -- só o status e o código: nada da resposta nem da chave vai para a mensagem
      raise exception 'cotações da bolsa: a brapi respondeu % (chave ou cota), parando a rodada', v_resposta.status using errcode = '58000';
    else
      v_erro := v_erro + 1;
    end if;
  end loop;

  -- nada deu certo nesta rodada: é falha de verdade (o cron mostra "failed"). Com algum acerto, os erros ficam no retorno
  if v_ok = 0 and v_erro > 0 then
    raise exception 'cotações da bolsa: nenhum dos % códigos teve cotação (% com erro)', cardinality(v_symbols), v_erro using errcode = '58000';
  end if;
  return format('%s com cotação; %s sem cotação; %s com erro; %s ficaram de fora desta rodada (teto de %s)',
    v_ok, v_sem, v_erro, v_total - cardinality(v_symbols), v_teto);
end $$;

revoke execute on function private.market_quote_record(text, jsonb), private.market_quotes_fetch(integer)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. Agendamento (só onde há pg_cron)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('cotacoes-bolsa', '30 17,22 * * 1-5', $c$select private.market_quotes_fetch()$c$);
    -- I6: 09:00 de Brasília, de terça a sábado: traz o fechamento do pregão anterior e corrige a linha do dia (um preço
    -- do meio do pregão que nenhuma rodada depois corrigiu não fica para sempre)
    perform cron.schedule('cotacoes-bolsa-manha', '0 12 * * 2-6', $c$select private.market_quotes_fetch()$c$);
  end if;
end $$;
