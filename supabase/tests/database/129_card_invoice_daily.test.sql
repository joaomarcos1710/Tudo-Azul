-- 129_card_invoice_daily: migration 137. Gasto por dia e ritmo de uma fatura de cartão: compras do ciclo no dia da compra,
-- parcela de compra anterior à parte ("já vinha"), média por dia, projeção do fechamento e a fatura anterior no mesmo ponto.
-- As funções vão por SQL dinâmico: sem a migration as asserções falham sem abortar o arquivo.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create temp table fixture (k text primary key, v uuid);
grant all on fixture to public;
create function pg_temp.fx(p_k text) returns uuid language sql as $f$ select v from fixture where k = p_k $f$;
create function pg_temp.login(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $f$;
-- dias com gasto: "dia|gasto|acumulado|já vinha"; e a contagem de dias
create function pg_temp.dias(p_card uuid, p_label text) returns text[] language plpgsql as $f$
declare r text[];
begin
  execute 'select coalesce(array_agg(day || ''|'' || amount::numeric(14,2) || ''|'' || cumulative::numeric(14,2) || ''|'' || carried::numeric(14,2) order by day), ''{}'')
             from public.card_invoice_daily($1, $2) where amount <> 0' into r using p_card, p_label;
  return r;
exception when others then return array['ERRO ' || sqlstate];
end $f$;
create function pg_temp.qtde_dias(p_card uuid, p_label text) returns text language plpgsql as $f$
declare r text;
begin
  execute 'select count(*) || ''|'' || min(day) || ''|'' || max(day) from public.card_invoice_daily($1, $2)' into r using p_card, p_label;
  return r;
exception when others then return 'ERRO ' || sqlstate;
end $f$;
-- ritmo: "início|fechamento|dias|passados|gasto|já vinha|média|projeção|anterior|anterior no mesmo ponto"
create function pg_temp.ritmo(p_card uuid, p_label text, p_hoje date) returns text language plpgsql as $f$
declare r text;
begin
  execute 'select concat_ws(''|'', cycle_start, closing_date, days_total, days_elapsed, spent::numeric(14,2), carried::numeric(14,2),
                            coalesce(per_day::numeric(14,2)::text, ''-''), coalesce(projected::numeric(14,2)::text, ''-''),
                            coalesce(previous_label, ''-''), coalesce(previous_spent::numeric(14,2)::text, ''-''))
             from public.card_invoice_pace($1, $2, $3)' into r using p_card, p_label, p_hoje;
  return r;
exception when others then return 'ERRO ' || sqlstate;
end $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.dias(uuid, text), pg_temp.qtde_dias(uuid, text),
  pg_temp.ritmo(uuid, text, date) to public;

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000129a1', 'd1@teste129.com', now()),
  ('00000000-0000-0000-0000-0000000129a2', 'd2@teste129.com', now());
select pg_temp.login('00000000-0000-0000-0000-0000000129a1');
insert into fixture select 'h', public.create_household('Casa do Ritmo');
insert into fixture select 'cat', id from public.categories where household_id = pg_temp.fx('h') and name = 'Mercado';

-- Cartão: fecha 18, vence 25. Fatura de setembro (ciclo 19/08 a 18/09, sem fatura antes): 100,00 em 20/08, 50,00 em 10/09
-- e a 1ª parcela (30,00) de uma compra de 90,00 em 3x feita em 25/08. Fatura de outubro (ciclo 19/09 a 18/10): 200,00 em
-- 25/09, 30,00 em 05/10 e a 2ª parcela da compra de agosto (30,00: "já vinha").
insert into fixture select 'card', public.create_debt('Cartão', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('card'), 18, 25);
select public.card_purchase(pg_temp.fx('card'), '2026-08-20', 100.00, 1, pg_temp.fx('cat'), 'Mercado agosto');
select public.card_purchase(pg_temp.fx('card'), '2026-08-25', 90.00, 3, pg_temp.fx('cat'), 'Parcelado');
select public.card_purchase(pg_temp.fx('card'), '2026-09-10', 50.00, 1, pg_temp.fx('cat'), 'Mercado setembro');
select public.card_purchase(pg_temp.fx('card'), '2026-09-25', 200.00, 1, pg_temp.fx('cat'), 'Tênis');
select public.card_purchase(pg_temp.fx('card'), '2026-10-05', 30.00, 1, pg_temp.fx('cat'), 'Farmácia');

-- ---------------------------------------------------------------------------
-- 1. Gasto por dia
-- ---------------------------------------------------------------------------
select is(pg_temp.qtde_dias(pg_temp.fx('card'), '2026-10'), '30|2026-09-19|2026-10-18',
  'D1 outubro: um dia por linha, do dia seguinte ao fechamento de setembro ao fechamento de outubro');
select is(pg_temp.dias(pg_temp.fx('card'), '2026-10'), array['2026-09-25|200.00|200.00|30.00', '2026-10-05|30.00|230.00|30.00'],
  'D2 compras do ciclo no dia da compra, com o acumulado; a 2ª parcela da compra de agosto fica em "já vinha" (30,00)');
select is(pg_temp.qtde_dias(pg_temp.fx('card'), '2026-09'), '31|2026-08-19|2026-09-18',
  'D3 setembro sem fatura antes: ciclo de um mês antes do fechamento');
select is(pg_temp.dias(pg_temp.fx('card'), '2026-09'), array['2026-08-20|100.00|100.00|0.00', '2026-08-25|30.00|130.00|0.00', '2026-09-10|50.00|180.00|0.00'],
  'D4 a 1ª parcela da compra parcelada conta no dia da compra (é do ciclo)');
select is(pg_temp.dias(pg_temp.fx('card'), '2030-01'), '{}'::text[], 'D5 fatura que não existe: nada');

-- ---------------------------------------------------------------------------
-- 2. Ritmo
-- ---------------------------------------------------------------------------
select is(pg_temp.ritmo(pg_temp.fx('card'), '2026-10', '2026-10-05'),
  '2026-09-19|2026-10-18|30|17|230.00|30.00|13.53|435.88|2026-09|130.00',
  'R1 em 05/10 (17º dia): gasto 230, média 13,53/dia, projeção 30 + 230/17×30 = 435,88; setembro no 17º dia: 130,00');
select is(pg_temp.ritmo(pg_temp.fx('card'), '2026-10', '2026-10-30'),
  '2026-09-19|2026-10-18|30|30|230.00|30.00|7.67|260.00|2026-09|180.00',
  'R2 depois do fechamento: ciclo inteiro; projeção = o que a fatura teve (30 + 230)');
select is(pg_temp.ritmo(pg_temp.fx('card'), '2026-10', '2026-09-10'),
  '2026-09-19|2026-10-18|30|0|0.00|30.00|-|-|2026-09|-',
  'R3 antes do ciclo começar: sem média nem projeção');
select is(pg_temp.ritmo(pg_temp.fx('card'), '2026-09', '2026-09-05'),
  '2026-08-19|2026-09-18|31|18|130.00|0.00|7.22|223.89|-|-',
  'R4 sem fatura anterior: sem comparação');
select is(pg_temp.ritmo(pg_temp.fx('card'), '2026-10', null), 'ERRO 22023', 'R5 sem a data de hoje: recusado');

-- ---------------------------------------------------------------------------
-- 3. Privilégios e isolamento
-- ---------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.card_invoice_daily(uuid, text)', 'EXECUTE'), 'V1 anon sem EXECUTE (dia)');
select ok(not has_function_privilege('anon', 'public.card_invoice_pace(uuid, text, date)', 'EXECUTE'), 'V2 anon sem EXECUTE (ritmo)');
select ok(has_function_privilege('authenticated', 'public.card_invoice_pace(uuid, text, date)', 'EXECUTE'), 'V3 authenticated com EXECUTE');
select ok(not (select prosecdef from pg_proc where oid = 'public.card_invoice_pace(uuid, text, date)'::regprocedure), 'V4 SECURITY INVOKER');
select pg_temp.login('00000000-0000-0000-0000-0000000129a2');
select is(pg_temp.dias(pg_temp.fx('card'), '2026-10'), '{}'::text[], 'S1 outra família não vê o gasto por dia');
select is(pg_temp.ritmo(pg_temp.fx('card'), '2026-10', '2026-10-05'), null, 'S2 nem o ritmo');

select * from finish();
rollback;
