-- 102_fx_ptax: migration 108 (20261110170000_fx_ptax.sql). Cotação PTAX do BCB gravada em fx_rates e conversão para
-- reais (public.fx_to_brl). A busca na rede (private.fx_ptax_fetch) não roda aqui: o teste usa respostas no formato real
-- da API (o mesmo JSON que o BCB devolveu em 10/11/2026) com cotações inventadas. Datas relativas a hoje.
-- Sem a migration este arquivo falha (as funções não existem).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create temp table fixture (k text primary key, v uuid);
grant all on fixture to public;
create function pg_temp.login(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $f$;
create function pg_temp.erro_de(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
-- um boletim no formato do BCB: "YYYY-MM-DD HH:MI:SS.ffffff"
create function pg_temp.bol(p_dia date, p_hora text, p_compra text, p_tipo text) returns jsonb language sql as $f$
  select jsonb_build_object('cotacaoCompra', p_compra::numeric, 'cotacaoVenda', p_compra::numeric + 0.0006,
                            'dataHoraCotacao', to_char(p_dia, 'YYYY-MM-DD') || ' ' || p_hora, 'tipoBoletim', p_tipo) $f$;
create function pg_temp.resp(variadic p_bol jsonb[]) returns jsonb language sql as $f$
  select jsonb_build_object('@odata.context', 'teste', 'value', to_jsonb(p_bol)) $f$;
create function pg_temp.taxa(p_moeda text, p_dia date) returns numeric language sql as $f$
  select rate from public.fx_rates where base = p_moeda and quote = 'BRL' and rate_date = p_dia $f$;
create function pg_temp.d(p_n integer) returns date language sql as $f$ select current_date - p_n $f$;
grant execute on all functions in schema pg_temp to public;

-- ---- F: forma e permissões ----
select has_function('private', 'fx_ptax_record', array['text', 'jsonb'], 'F1 existe private.fx_ptax_record(text, jsonb)');
select has_function('private', 'fx_ptax_fetch', array['text', 'integer'], 'F2 existe private.fx_ptax_fetch(text, integer)');
select has_function('public', 'fx_to_brl', array['text[]', 'numeric[]', 'date'], 'F3 existe public.fx_to_brl(text[], numeric[], date)');
select is(pg_get_function_result('public.fx_to_brl(text[], numeric[], date)'::regprocedure),
          'TABLE(ord integer, currency text, amount numeric, amount_brl numeric, rate numeric, rate_date date)', 'F4 colunas de fx_to_brl');
select ok(not (select prosecdef from pg_proc where oid = 'public.fx_to_brl(text[], numeric[], date)'::regprocedure)
          and not (select prosecdef from pg_proc where oid = 'private.fx_ptax_record(text, jsonb)'::regprocedure)
          and not (select prosecdef from pg_proc where oid = 'private.fx_ptax_fetch(text, integer)'::regprocedure),
          'F5 as três são SECURITY INVOKER');
select ok((select proconfig from pg_proc where oid = 'public.fx_to_brl(text[], numeric[], date)'::regprocedure) = array['search_path=""'],
          'F6 fx_to_brl com search_path vazio');
select ok(has_function_privilege('authenticated', 'public.fx_to_brl(text[], numeric[], date)', 'execute')
          and not has_function_privilege('anon', 'public.fx_to_brl(text[], numeric[], date)', 'execute'),
          'F7 fx_to_brl: authenticated executa, anon não');
select ok(not has_function_privilege('authenticated', 'private.fx_ptax_record(text, jsonb)', 'execute')
          and not has_function_privilege('anon', 'private.fx_ptax_record(text, jsonb)', 'execute')
          and not has_function_privilege('authenticated', 'private.fx_ptax_fetch(text, integer)', 'execute')
          and not has_function_privilege('anon', 'private.fx_ptax_fetch(text, integer)', 'execute'),
          'F8 gravar e buscar a PTAX: ninguém do app executa (só o agendamento, como dono do banco)');
-- cron.job só existe onde há pg_cron (no CI com o Supabase completo); no Postgres local a conferência é dinâmica
create function pg_temp.agendado(p_job text, p_comando text) returns boolean language plpgsql as $f$
declare v boolean;
begin
  -- onde o pg_cron EXISTE (Supabase) mas o schema cron não está lá, a migration não o instalou: falha, não "pula"
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then return true; end if;
  if not exists (select 1 from pg_namespace where nspname = 'cron') then return false; end if;
  execute $q$select exists (select 1 from cron.job where jobname = $1 and schedule = '15 17,21 * * 1-5' and command = $2)$q$
    into v using p_job, p_comando;
  return v;
end $f$;
select ok(pg_temp.agendado('ptax-usd', $$select private.fx_ptax_fetch('USD', 10)$$)
          and pg_temp.agendado('ptax-eur', $$select private.fx_ptax_fetch('EUR', 10)$$),
          'F9 onde há pg_cron, um job por moeda (ptax-usd e ptax-eur), dias úteis, 17:15 e 21:15 UTC'
          || case when exists (select 1 from pg_available_extensions where name = 'pg_cron') then '' else ' [sem pg_cron neste banco: não conferido]' end);

-- A extensão http (chamada web a partir do banco) fica num schema que o app não alcança. Onde ela existe (CI com o
-- Supabase completo), confere de verdade; no Postgres local ela não existe e a descrição diz que não foi conferido.
create function pg_temp.http_fechada() returns boolean language plpgsql as $f$
declare v_schema text;
begin
  -- onde a http EXISTE (Supabase) a migration tem de tê-la instalado em fx_http; onde não existe (Postgres local), não há o que conferir
  if not exists (select 1 from pg_available_extensions where name = 'http') then return true; end if;
  select n.nspname into v_schema from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'http';
  return v_schema = 'fx_http'
     and not has_schema_privilege('anon', 'fx_http', 'usage')
     and not has_schema_privilege('authenticated', 'fx_http', 'usage')
     and not has_schema_privilege('service_role', 'fx_http', 'usage');
end $f$;
select ok(pg_temp.http_fechada(),
          'F10 a extensão http, quando existe, está no schema fx_http e anon, authenticated e service_role não têm USAGE nele (o app não alcança http_get)'
          || case when exists (select 1 from pg_available_extensions where name = 'http') then '' else ' [sem a extensão neste banco: não conferido]' end);
select ok(case when exists (select 1 from pg_extension where extname = 'http')
               then not has_schema_privilege('anon', 'fx_http', 'usage') and not has_schema_privilege('authenticated', 'fx_http', 'usage')
               else not exists (select 1 from pg_available_extensions where name = 'http') end,
          'F11 anon e authenticated não chegam a http_get (sem USAGE no schema fx_http)');

-- ---- R: gravar a resposta do BCB ----
select is(private.fx_ptax_record('USD', pg_temp.resp(
  pg_temp.bol(pg_temp.d(3), '10:04:14.777223', '5.48920', 'Abertura'),
  pg_temp.bol(pg_temp.d(3), '11:06:13.67204', '5.49090', 'Intermediário'),
  pg_temp.bol(pg_temp.d(3), '13:06:31.943412', '5.49290', 'Fechamento'),
  pg_temp.bol(pg_temp.d(2), '10:07:11.299421', '5.46630', 'Abertura'),
  pg_temp.bol(pg_temp.d(2), '13:05:19.232051', '5.47720', 'Fechamento'))), 2,
  'R1 dois dias com fechamento: grava duas cotações');
select is(pg_temp.taxa('USD', pg_temp.d(3)), 5.49290, 'R1.1 vale a COMPRA do boletim de FECHAMENTO (não a abertura nem o intermediário)');
select is(pg_temp.taxa('USD', pg_temp.d(2)), 5.47720, 'R1.2 o outro dia também');
select is((select source from public.fx_rates where base = 'USD' and rate_date = pg_temp.d(3)), 'PTAX BCB (compra, fechamento)', 'R1.3 a fonte fica registrada');
select is(private.fx_ptax_record('USD', pg_temp.resp(
  pg_temp.bol(pg_temp.d(3), '13:06:31.943412', '9.99999', 'Fechamento'))), 0,
  'R2 dia que já tem cotação: não grava de novo');
select is(pg_temp.taxa('USD', pg_temp.d(3)), 5.49290, 'R2.1 e a cotação gravada não muda (a tabela é imutável)');
select is(private.fx_ptax_record('USD', pg_temp.resp(
  pg_temp.bol(pg_temp.d(1), '10:00:00.000000', '5.40000', 'Abertura'),
  pg_temp.bol(pg_temp.d(1), '11:00:00.000000', '5.41000', 'Intermediário'))), 0,
  'R3 dia só com boletins de abertura e intermediário (antes das 13h): nada gravado');
select is(private.fx_ptax_record('EUR', pg_temp.resp(
  pg_temp.bol(pg_temp.d(2), '13:05:20.000000', '6.30000', 'Fechamento'))), 1, 'R4 euro grava à parte');
select is(pg_temp.taxa('EUR', pg_temp.d(2)), 6.30000, 'R4.1 euro com a sua cotação');
select is(private.fx_ptax_record('USD', pg_temp.resp(
  pg_temp.bol(pg_temp.d(-1), '13:05:00.000000', '5.10000', 'Fechamento'),
  jsonb_build_object('cotacaoCompra', 'abc', 'dataHoraCotacao', to_char(pg_temp.d(5), 'YYYY-MM-DD') || ' 13:05:00.000000', 'tipoBoletim', 'Fechamento'),
  pg_temp.bol(pg_temp.d(6), '13:05:00.000000', '0', 'Fechamento'),
  jsonb_build_object('cotacaoCompra', 5.2, 'dataHoraCotacao', 'ontem', 'tipoBoletim', 'Fechamento'))), 0,
  'R5 data futura, cotação que não é número, cotação zero e data fora do formato: nada gravado');
select is(private.fx_ptax_record('USD', pg_temp.resp(
  pg_temp.bol(pg_temp.d(7), '13:05:00.000000', '5.30000', 'Fechamento'),
  pg_temp.bol(pg_temp.d(7), '13:20:00.000000', '5.31000', 'Fechamento'))), 1,
  'R6 dois fechamentos no mesmo dia: grava um');
select is(pg_temp.taxa('USD', pg_temp.d(7)), 5.31000, 'R6.1 o mais recente');
select is(private.fx_ptax_record('USD', jsonb_build_object('value', jsonb_build_array(
  jsonb_build_object('cotacaoCompra', 5.1, 'dataHoraCotacao', '2026-02-30 13:05:00.000000', 'tipoBoletim', 'Fechamento'),
  pg_temp.bol(pg_temp.d(8), '13:05:00.000000', '5.20000', 'Fechamento'),
  to_jsonb('texto solto'::text), to_jsonb(7), 'null'::jsonb))), 1,
  'R6.2 data que não existe (30/02) e itens que nem são boletim: ignorados, e o boletim bom do mesmo lote é gravado');
select is(pg_temp.taxa('USD', pg_temp.d(8)), 5.20000, 'R6.3 o boletim bom foi gravado mesmo com lixo no lote');
select is(private.fx_ptax_record('USD', null), 0, 'R7 resposta nula: nada');
select is(private.fx_ptax_record('USD', '{"value": "x"}'::jsonb), 0, 'R7.1 value que não é lista: nada');
select is(private.fx_ptax_record('USD', '{"erro": 1}'::jsonb), 0, 'R7.2 sem value: nada');
select is(private.fx_ptax_record('USD', pg_temp.resp(variadic array[]::jsonb[])), 0, 'R7.3 lista vazia (fim de semana): nada');
select is(pg_temp.erro_de($$select private.fx_ptax_record('GBP', '{"value": []}'::jsonb)$$), '22023', 'R8 moeda sem PTAX configurada: 22023');
select is(pg_temp.erro_de($$select private.fx_ptax_record(null, '{"value": []}'::jsonb)$$), '22023', 'R8.1 moeda nula: 22023');
select is(pg_temp.erro_de($$update public.fx_rates set rate = 1 where base = 'USD'$$), '42501', 'R9 cotação continua imutável');
select is((select count(*) from public.fx_rates)::integer, 5, 'R10 ao todo: 4 dias de dólar e 1 de euro');

-- ---- B: a busca falha alto (nunca em silêncio) ----
select is(pg_temp.erro_de($$select private.fx_ptax_fetch('GBP', 10)$$), '22023', 'B1 moeda sem PTAX: 22023');
select is(pg_temp.erro_de($$select private.fx_ptax_fetch(null, 10)$$), '22023', 'B1.1 moeda nula: 22023');
-- Sem a extensão (Postgres local) a busca tem de ESTOURAR (o cron mostra "failed"), não devolver 0 como se tudo estivesse bem.
-- Com a extensão (CI) a função faria uma chamada de rede de verdade, que um teste não faz: a descrição diz que não foi conferido.
select ok(case when exists (select 1 from pg_extension where extname = 'http') then true
               else pg_temp.erro_de($$select private.fx_ptax_fetch('USD', 10)$$) is not null end,
          'B2 sem a extensão http a busca levanta erro (o agendamento falha de forma visível)'
          || case when exists (select 1 from pg_extension where extname = 'http') then ' [com a extensão neste banco: a chamada de rede não é testada aqui]' else '' end);
select is((select count(*) from public.fx_rates)::integer, 5, 'B3 a busca que falhou não gravou nada');

-- ---- C: conversão para reais ----
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000010801', 'fx@teste.com');
select pg_temp.login('00000000-0000-0000-0000-000000010801');
select is(pg_temp.erro_de($$update public.fx_rates set rate = 1$$), '42501', 'C0 o app não altera cotação');
select is(pg_temp.erro_de($$insert into public.fx_rates (base, quote, rate, rate_date, source) values ('USD', 'BRL', 1, current_date, 'x')$$), '42501',
          'C0.1 nem grava cotação');
select results_eq(
  $$select ord, currency, amount, amount_brl, rate, rate_date from public.fx_to_brl(array['USD', 'EUR', 'BRL'], array[100, 33.14, 50]::numeric[], current_date)$$,
  $$values (1, 'USD', 100::numeric, 547.72::numeric, 5.47720::numeric, current_date - 2),
           (2, 'EUR', 33.14::numeric, 208.78::numeric, 6.30000::numeric, current_date - 2),
           (3, 'BRL', 50::numeric, 50.00::numeric, 1::numeric, current_date)$$,
  'C1 dólar e euro pela cotação mais recente, real por 1; cada valor arredondado a 2 casas no banco (33,14 × 6,30 = 208,782 → 208,78)');
select is((select amount_brl from public.fx_to_brl(array['USD'], array[100]::numeric[], current_date - 3)), 549.29,
          'C2 numa data passada, a cotação daquele dia');
select is((select rate_date from public.fx_to_brl(array['USD'], array[1]::numeric[], current_date - 4)), current_date - 7,
          'C3 dia sem cotação (fim de semana, feriado): vale a anterior, até 7 dias');
select is((select amount_brl from public.fx_to_brl(array['EUR'], array[10]::numeric[], current_date + 6)), null::numeric,
          'C4 cotação com mais de 7 dias: sem conversão (nulo, a tela não inventa número)');
select is((select amount_brl from public.fx_to_brl(array['USD'], array[10]::numeric[], current_date - 30)), null::numeric,
          'C5 antes da primeira cotação: nulo');
select is((select amount_brl from public.fx_to_brl(array['USD'], array[null]::numeric[], current_date)), null::numeric, 'C6 valor nulo: nulo');
select is((select count(*) from public.fx_to_brl(array[]::text[], array[]::numeric[], current_date))::integer, 0, 'C7 listas vazias: nenhuma linha');
select is((select count(*) from public.fx_to_brl(null, array[1]::numeric[], current_date))::integer, 0, 'C7.1 lista nula: nenhuma linha');
select is(pg_temp.erro_de($$select * from public.fx_to_brl(array['USD', 'EUR'], array[1]::numeric[], current_date)$$), '22023',
          'C8 listas de tamanhos diferentes: 22023');
select is(pg_temp.erro_de($$select * from public.fx_to_brl(array_fill('USD'::text, array[201]), array_fill(1::numeric, array[201]), current_date)$$), '22023',
          'C8.1 mais de 200 valores: 22023');
select is((select amount_brl from public.fx_to_brl(array['USD'], array[-12.5]::numeric[], current_date)), -68.47,
          'C9 negativo também converte (saldo devedor): −12,50 × 5,4772 = −68,465 → −68,47');
select is((select count(*) from public.fx_rates)::integer, 5, 'C10 converter não grava nada');

-- anon não converte
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select is(pg_temp.erro_de($$select * from public.fx_to_brl(array['USD'], array[1]::numeric[], current_date)$$), '42501', 'C11 anon: 42501');
reset role;

select * from finish();
rollback;
