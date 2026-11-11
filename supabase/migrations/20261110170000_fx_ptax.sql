-- Tudo Azul — migration 108: cotação PTAX do Banco Central, buscada todo dia, e conversão para reais
--
-- Pedido do dono (10/11/2026): ver quanto vale em reais o que está em dólar e em euro ("≈ R$"), com a cotação PTAX de
-- compra (decisão de 04/11/2026). A migration 027 já tem a tabela public.fx_rates (uma cotação por dia, imutável, com a
-- fonte) e public.fx_rate_at (procura até 7 dias para trás). Faltava quem a alimentasse. Nada aqui muda saldo, total,
-- patrimônio ou relatório: a conversão é só para mostrar ao lado do valor na moeda original.
--
-- O que entra:
--   1. As extensões http (chamada web síncrona) e pg_cron (agendamento), só onde existem: no Supabase (produção e o CI
--      com `supabase start`). No Postgres local de testes não existem; aí só as funções são criadas.
--   2. private.fx_ptax_record(p_currency, p_payload): lê a resposta da API PTAX (OData do BCB) e grava em fx_rates a
--      cotação de COMPRA do boletim de FECHAMENTO de cada dia: base = a moeda, quote = BRL, taxa = reais por 1 unidade.
--      Dia que já tem cotação não muda (a tabela é imutável; on conflict do nothing). Devolve quantas linhas gravou.
--   3. private.fx_ptax_fetch(p_days): busca os últimos p_days dias de USD e EUR na API do BCB e grava. Uma moeda que
--      falha (rede, resposta fora do formato) vira aviso no log e não impede a outra. Pede vários dias de propósito:
--      um dia que falhou é preenchido na execução seguinte.
--   4. Agendamento "ptax-diaria": dias úteis às 17:15 e 21:15 UTC (14:15 e 18:15 em Brasília). O BCB publica o
--      fechamento por volta das 13h de Brasília; a segunda execução cobre atraso ou falha da primeira.
--   5. public.fx_to_brl(p_currencies, p_amounts, p_date): converte uma lista de valores para reais pela cotação mais
--      recente até p_date (no máximo 7 dias antes, a regra de fx_rate_at). Arredonda cada valor a 2 casas no banco; sem
--      cotação recente, amount_brl vem nulo (a tela não inventa número). O front não multiplica dinheiro.
-- Fonte: https://olinda.bcb.gov.br (serviço PTAX, sem chave nem cadastro).
--
-- Códigos de erro: 22023 listas de tamanhos diferentes ou com mais de 200 itens; moeda que não é USD nem EUR em
-- fx_ptax_record.
-- Teste: 102_fx_ptax (falha sem esta migration).

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'http') then
    create extension if not exists http with schema extensions;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
  end if;
end $$;

create function private.fx_ptax_record(p_currency text, p_payload jsonb)
returns integer
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_inseridas integer;
begin
  if p_currency is null or p_currency not in ('USD', 'EUR') then
    raise exception 'moeda sem PTAX configurada: %', p_currency using errcode = '22023';
  end if;
  if p_payload is null or jsonb_typeof(p_payload -> 'value') is distinct from 'array' then
    return 0;
  end if;

  with boletins as (
    select left(b ->> 'dataHoraCotacao', 10)::date as dia,
           (b ->> 'cotacaoCompra')::numeric as taxa,
           b ->> 'dataHoraCotacao' as quando
      from jsonb_array_elements(p_payload -> 'value') b
     where b ->> 'tipoBoletim' = 'Fechamento'
       and b ->> 'dataHoraCotacao' ~ '^\d{4}-\d{2}-\d{2}'
       and b ->> 'cotacaoCompra' ~ '^\d+(\.\d+)?$'
  ), um_por_dia as (
    select distinct on (dia) dia, taxa
      from boletins
     where taxa > 0 and taxa < 1e12 and dia <= current_date
     order by dia, quando desc
  ), gravadas as (
    insert into public.fx_rates (base, quote, rate, rate_date, source)
    select p_currency, 'BRL', taxa, dia, 'PTAX BCB (compra, fechamento)' from um_por_dia
    on conflict (base, quote, rate_date) do nothing
    returning 1
  )
  select count(*) into v_inseridas from gravadas;
  return v_inseridas;
end $$;

create function private.fx_ptax_fetch(p_days integer default 10)
returns integer
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_de date := v_hoje - least(greatest(coalesce(p_days, 10), 1), 60);
  v_moeda text;
  v_url text;
  v_resposta record;
  v_total integer := 0;
begin
  foreach v_moeda in array array['USD', 'EUR'] loop
    begin
      v_url := 'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/'
        || 'CotacaoMoedaPeriodo(moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)'
        || '?@moeda=%27' || v_moeda || '%27'
        || '&@dataInicial=%27' || to_char(v_de, 'MM-DD-YYYY') || '%27'
        || '&@dataFinalCotacao=%27' || to_char(v_hoje, 'MM-DD-YYYY') || '%27'
        || '&$format=json&$select=cotacaoCompra,dataHoraCotacao,tipoBoletim';
      execute 'select status, content from extensions.http_get($1)' into v_resposta using v_url;
      if v_resposta.status = 200 then
        v_total := v_total + private.fx_ptax_record(v_moeda, v_resposta.content::jsonb);
      else
        raise warning 'PTAX %: o BCB respondeu %', v_moeda, v_resposta.status;
      end if;
    exception when others then
      raise warning 'PTAX %: % (%)', v_moeda, sqlerrm, sqlstate;
    end;
  end loop;
  return v_total;
end $$;

revoke execute on function private.fx_ptax_record(text, jsonb), private.fx_ptax_fetch(integer) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('ptax-diaria', '15 17,21 * * 1-5', 'select private.fx_ptax_fetch(10)');
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
