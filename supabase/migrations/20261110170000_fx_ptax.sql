-- Tudo Azul — migration 108: cotação PTAX do Banco Central, buscada todo dia, e conversão para reais
--
-- Pedido do dono (10/11/2026): ver quanto vale em reais o que está em dólar e em euro ("≈ R$"), com a cotação PTAX de
-- compra (decisão de 04/11/2026). A migration 027 já tem a tabela public.fx_rates (uma cotação por dia, imutável, com a
-- fonte) e public.fx_rate_at (procura até 7 dias para trás). Faltava quem a alimentasse. Nada aqui muda saldo, total,
-- patrimônio ou relatório: a conversão é só para mostrar ao lado do valor na moeda original.
--
-- O que entra:
--   1. A extensão http (chamada web síncrona) num schema PRÓPRIO, fx_http, e a extensão pg_cron (agendamento), só onde
--      existem: no Supabase (produção e o CI com `supabase start`); no Postgres local de testes não existem.
--      Por que um schema próprio: a extensão http dá EXECUTE a PUBLIC em http_get e afins, e o schema `extensions` do
--      Supabase dá USAGE a anon e authenticated; instalada ali, qualquer usuário logado poderia mandar o banco chamar
--      qualquer endereço da internet (ou da rede interna). Em fx_http ninguém além do dono tem USAGE, então as funções
--      são inalcançáveis para o app, sem depender de revogar permissão de função que não é nossa (um REVOKE de quem não
--      é dono vira só aviso e não faz nada). Se a http já estiver instalada em outro schema, a migration PARA com erro.
--   2. private.fx_ptax_record(p_currency, p_payload): lê a resposta da API PTAX (OData do BCB) e grava em fx_rates a
--      cotação de COMPRA do boletim de FECHAMENTO de cada dia: base = a moeda, quote = BRL, taxa = reais por 1 unidade.
--      Dia que já tem cotação não muda (a tabela é imutável; on conflict do nothing). Um boletim com data ou número
--      inválido é ignorado (aviso no log) sem derrubar os outros. Devolve quantas linhas gravou.
--   3. private.fx_ptax_fetch(p_currency, p_days): busca os últimos p_days dias (1 a 60) de UMA moeda (USD ou EUR) na API
--      do BCB e grava. Se a chamada falhar (rede, status diferente de 200, resposta fora do formato), a função LEVANTA
--      erro: o cron mostra "failed" em cron.job_run_details e nenhuma gravação é perdida, porque cada moeda tem o seu
--      próprio job. Fim de semana e feriado (resposta vazia) não são erro.
--   4. Agendamento: dois jobs, ptax-usd e ptax-eur, dias úteis às 17:15 e 21:15 UTC (14:15 e 18:15 em Brasília). O BCB
--      publica o fechamento por volta das 13h de Brasília; a segunda execução cobre atraso ou falha da primeira, e a
--      janela de 10 dias preenche um dia que falhou.
--   5. public.fx_to_brl(p_currencies, p_amounts, p_date): converte uma lista de valores para reais pela cotação mais
--      recente até p_date (no máximo 7 dias antes, a regra de fx_rate_at). Arredonda cada valor a 2 casas no banco; sem
--      cotação recente, amount_brl vem nulo (a tela não inventa número). O front não multiplica dinheiro.
-- Fonte: https://olinda.bcb.gov.br (serviço PTAX, sem chave nem cadastro).
--
-- Códigos de erro: 22023 listas de tamanhos diferentes ou com mais de 200 itens; moeda que não é USD nem EUR; 58000 o BCB
-- respondeu diferente de 200.
-- Teste: 102_fx_ptax (falha sem esta migration).

do $$
declare
  v_schema text;
begin
  if exists (select 1 from pg_available_extensions where name = 'http') then
    select n.nspname into v_schema from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'http';
    if v_schema is not null and v_schema <> 'fx_http' then
      raise exception 'a extensão http já está instalada no schema %; esta migration a quer em fx_http (fechado ao app). Resolva antes de aplicar.', v_schema;
    end if;
    create schema if not exists fx_http;
    revoke all on schema fx_http from public, anon, authenticated, service_role;
    create extension if not exists http with schema fx_http;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
  end if;
end $$;

create function private.fx_ptax_record(p_currency text, p_payload jsonb)
returns integer
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_b jsonb;
  v_dia date;
  v_taxa numeric;
  v_linhas integer;
  v_total integer := 0;
begin
  if p_currency is null or p_currency not in ('USD', 'EUR') then
    raise exception 'moeda sem PTAX configurada: %', p_currency using errcode = '22023';
  end if;
  if p_payload is null or jsonb_typeof(p_payload -> 'value') is distinct from 'array' then
    return 0;
  end if;

  -- do mais recente para o mais antigo: se um dia tiver dois fechamentos, o primeiro gravado (o mais recente) vence
  for v_b in
    select b from jsonb_array_elements(p_payload -> 'value') b
     where jsonb_typeof(b) = 'object' and b ->> 'tipoBoletim' = 'Fechamento'
     order by b ->> 'dataHoraCotacao' desc nulls last
  loop
    begin
      v_dia := left(v_b ->> 'dataHoraCotacao', 10)::date;
      v_taxa := (v_b ->> 'cotacaoCompra')::numeric;
      if v_dia is null or v_taxa is null or v_taxa <= 0 or v_taxa >= 1e12 or v_dia > current_date then
        continue;
      end if;
      insert into public.fx_rates (base, quote, rate, rate_date, source)
      values (p_currency, 'BRL', v_taxa, v_dia, 'PTAX BCB (compra, fechamento)')
      on conflict (base, quote, rate_date) do nothing;
      get diagnostics v_linhas = row_count;
      v_total := v_total + v_linhas;
    exception when others then
      -- data ou número fora do formato: só este boletim fica de fora
      raise warning 'PTAX %: boletim ignorado (% / %)', p_currency, sqlerrm, sqlstate;
    end;
  end loop;
  return v_total;
end $$;

create function private.fx_ptax_fetch(p_currency text, p_days integer default 10)
returns integer
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_de date := v_hoje - least(greatest(coalesce(p_days, 10), 1), 60);
  v_url text;
  v_resposta record;
begin
  if p_currency is null or p_currency not in ('USD', 'EUR') then
    raise exception 'moeda sem PTAX configurada: %', p_currency using errcode = '22023';
  end if;
  v_url := 'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/'
    || 'CotacaoMoedaPeriodo(moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)'
    || '?@moeda=%27' || p_currency || '%27'
    || '&@dataInicial=%27' || to_char(v_de, 'MM-DD-YYYY') || '%27'
    || '&@dataFinalCotacao=%27' || to_char(v_hoje, 'MM-DD-YYYY') || '%27'
    || '&$format=json&$select=cotacaoCompra,dataHoraCotacao,tipoBoletim';
  -- o padrão da extensão é 5 s; o Olinda às vezes demora mais. Os dois jeitos de configurar, sem erro se a versão não conhece.
  perform set_config('http.timeout_msec', '20000', true);
  begin
    execute 'select fx_http.http_set_curlopt($1, $2)' using 'CURLOPT_TIMEOUT_MS', '20000';
  exception when others then null;
  end;
  -- qualquer falha (extensão ausente, rede, status, formato) sobe: o cron registra "failed" e o dono vê
  execute 'select status, content from fx_http.http_get($1)' into v_resposta using v_url;
  if v_resposta.status is distinct from 200 then
    raise exception 'PTAX %: o BCB respondeu %', p_currency, v_resposta.status using errcode = '58000';
  end if;
  return private.fx_ptax_record(p_currency, v_resposta.content::jsonb);
end $$;

revoke execute on function private.fx_ptax_record(text, jsonb), private.fx_ptax_fetch(text, integer) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('ptax-usd', '15 17,21 * * 1-5', $c$select private.fx_ptax_fetch('USD', 10)$c$);
    perform cron.schedule('ptax-eur', '15 17,21 * * 1-5', $c$select private.fx_ptax_fetch('EUR', 10)$c$);
  end if;
end $$;

create function public.fx_to_brl(p_currencies text[], p_amounts numeric[], p_date date)
returns table (ord integer, currency text, amount numeric, amount_brl numeric, rate numeric, rate_date date)
language plpgsql stable security invoker set search_path = '' as $$
begin
  if p_currencies is null or p_amounts is null or p_date is null then return; end if;
  if coalesce(array_length(p_currencies, 1), 0) <> coalesce(array_length(p_amounts, 1), 0)
     or coalesce(array_length(p_currencies, 1), 0) > 200 then
    raise exception 'listas de moedas e valores com tamanhos diferentes ou grandes demais' using errcode = '22023';
  end if;
  return query
    select i.ord::integer, i.moeda, i.valor,
           case when i.valor is null or f.rate is null then null else round(i.valor * f.rate, 2) end,
           f.rate, f.rate_date
      from unnest(p_currencies, p_amounts) with ordinality as i(moeda, valor, ord)
      left join lateral public.fx_rate_at(i.moeda, 'BRL', p_date) f on true
     order by i.ord;
end $$;

revoke execute on function public.fx_to_brl(text[], numeric[], date) from public, anon;
grant execute on function public.fx_to_brl(text[], numeric[], date) to authenticated;
