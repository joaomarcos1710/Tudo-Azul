-- 106_card_installment_move: migration 111 (20261112110000_card_installment_move.sql). Pedido do dono (11/11/2026, etapa 2):
-- mandar UMA parcela de cartão para a fatura anterior ou para a próxima, sem excluir e lançar de novo.
-- O que este arquivo prova:
--   • próxima e anterior: só due_date (o fechamento do mês vizinho) e os dias do ciclo gravados na parcela mudam; valor,
--     data da compra, "n de N" e categoria ficam; nenhum evento nasce; limite e dívida do cartão não mudam; as faturas
--     (card_months e card_months_as_of, iguais) e a projeção por mês (period_summary) acompanham;
--   • duas parcelas da mesma compra podem ficar na mesma fatura (card_items lista as duas, por seq);
--   • mês curto (fecha dia 31: fevereiro 28/29, depois março 31) e troca de dias do cartão (a parcela leva os dias do
--     mês de destino, e o vencimento da fatura sai certo);
--   • só parcela AINDA NÃO COBRADA: cobrada (antecipação), estornada em parte ou inteira e a de fatura fechada (paga e
--     travada, ou a pagar) são recusadas; "anterior" só existe se a anterior ainda não fechou (e a paga não recebe);
--   • pagamento ligado: o pago passa do total e a sobra vira adiantamento; o mês que some solta o pagamento (a #306 só
--     solta por evento de cancelamento/crédito, e mover não cria evento) e ele não volta quando o mês reaparece;
--   • assinatura de cartão: mover a ocorrência não quebra a geração nem a sincronização e não duplica;
--   • cartão sem fechamento, dívida que não é cartão, direção inválida, destino com outro fechamento gravado e destino
--     antes do início do cartão são recusados; parcela continua imutável fora da RPC; anônimo e outra família não movem.
-- Datas relativas a hoje em São Paulo (o cartão fecha dia 17 e vence dia 25); os meses de março a maio de 2026 já estão
-- fechados. Dados inventados. Sem a migration este arquivo falha (a função não existe).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create temp table fixture (k text primary key, v uuid);
create temp table nota (k text primary key, v text);
grant all on fixture, nota to public;
create function pg_temp.fx(p_k text) returns uuid language sql as $f$ select v from fixture where k = p_k $f$;
create function pg_temp.nt(p_k text) returns text language sql as $f$ select v from nota where k = p_k $f$;
create function pg_temp.login(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $f$;
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
create function pg_temp.hoje() returns date language sql stable as $f$ select (now() at time zone 'America/Sao_Paulo')::date $f$;
-- mover: devolve o código do erro (null = deu certo) e, à parte, a mensagem
create function pg_temp.mv(p_k text, p_dir text) returns text language plpgsql as $f$
begin perform public.card_installment_move(pg_temp.fx(p_k), p_dir); return null;
exception when others then return sqlstate; end $f$;
create function pg_temp.mvmsg(p_k text, p_dir text) returns text language plpgsql as $f$
begin perform public.card_installment_move(pg_temp.fx(p_k), p_dir); return null;
exception when others then return sqlstate || ': ' || sqlerrm; end $f$;
-- a parcela como está no banco: "fechamento|dia de fechamento|dia de vencimento|valor|seq|data da compra|plano"
create function pg_temp.inst(p_k text) returns text language sql as $f$
  select concat_ws('|', i.due_date, i.closing_day, i.due_day, i.face, i.seq, i.purchase_date, i.plan)
    from public.debt_installments i where i.id = pg_temp.fx(p_k) $f$;
-- fatura (rótulo AAAA-MM) como "total|pago" de card_months; null = o mês não existe
create function pg_temp.sit(p_card uuid, p_label text) returns text language sql as $f$
  select total::numeric(14,2) || '|' || paid::numeric(14,2) from public.card_months(p_card) where label = p_label $f$;
create function pg_temp.sit_as_of(p_card uuid, p_label text) returns text language sql as $f$
  select total::numeric(14,2) || '|' || paid::numeric(14,2) from private.card_months_as_of(p_card, pg_temp.hoje()) where label = p_label $f$;
create function pg_temp.fat(p_card uuid, p_label text) returns uuid language sql as $f$
  select id from public.debt_invoices where debt_id = p_card and label = p_label $f$;
-- o pagamento: "valor|rótulo da fatura" (ou "sem fatura")
create function pg_temp.pag(p_k text) returns text language sql as $f$
  select concat_ws('|', e.amount, coalesce((select i.label from public.debt_invoices i where i.id = e.invoice_id), 'sem fatura'))
    from public.debt_events e where e.id = pg_temp.fx(p_k) $f$;
-- a fatura aberta do cartão A (a da compra de hoje) e as seguintes: o rótulo depende do dia em que o teste roda
create function pg_temp.mes(p_n integer) returns text language sql as $f$
  select to_char(to_date((select v from nota where k = 'O') || '-01', 'YYYY-MM-DD') + make_interval(months => p_n), 'YYYY-MM') $f$;
-- fechamento (dia 17) da fatura n meses depois da aberta
create function pg_temp.fecha(p_n integer) returns text language sql as $f$ select pg_temp.mes(p_n) || '-17' $f$;
create function pg_temp.comprometido() returns numeric language sql as $f$
  select committed from public.card_limits(pg_temp.fx('h'), pg_temp.hoje()) where debt_id = pg_temp.fx('a') $f$;
create function pg_temp.eventos(p_card uuid) returns bigint language sql as $f$
  select count(*) from public.debt_events where debt_id = p_card $f$;
-- despesa planejada (parcela ainda não cobrada) com fechamento no mês n depois da aberta, de period_summary
create function pg_temp.planejada(p_n integer) returns numeric language sql as $f$
  select expense_planned from public.period_summary(pg_temp.fx('h'),
    to_date(pg_temp.mes(p_n) || '-01', 'YYYY-MM-DD'), (to_date(pg_temp.mes(p_n) || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date) $f$;
-- quantas faturas de card_months e de card_months_as_of diferem (deve ser 0)
create function pg_temp.diferem(p_card uuid) returns bigint language sql as $f$
  select count(*) from public.card_months(p_card) m
    full join private.card_months_as_of(p_card, pg_temp.hoje()) x on x.label = m.label
   where (m.total, m.paid, m.charged, m.pending) is distinct from (x.total, x.paid, x.charged, x.pending) $f$;
grant execute on all functions in schema pg_temp to public;

-- ---- F: forma e permissões ----
select has_function('public', 'card_installment_move', array['uuid', 'text'], 'F1 existe public.card_installment_move(uuid, text)');
select is(pg_get_function_result('public.card_installment_move(uuid, text)'::regprocedure), 'date', 'F2 devolve o fechamento da fatura de destino (date)');
select ok((select prosecdef from pg_proc where oid = 'public.card_installment_move(uuid, text)'::regprocedure), 'F3 é SECURITY DEFINER (grava só pelo dono do banco)');
select is((select proconfig::text from pg_proc where oid = 'public.card_installment_move(uuid, text)'::regprocedure), '{"search_path=\"\""}', 'F4 search_path vazio');
select ok(has_function_privilege('authenticated', 'public.card_installment_move(uuid, text)', 'execute')
          and not has_function_privilege('anon', 'public.card_installment_move(uuid, text)', 'execute')
          and not has_function_privilege('public', 'public.card_installment_move(uuid, text)', 'execute'),
          'F5 authenticated executa; anon e public não');
select ok(not has_table_privilege('authenticated', 'public.debt_installments', 'UPDATE'), 'F6 o app continua sem UPDATE em debt_installments');

-- ---- dados ----
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000106a1', 'parcela1@teste.com'),
  ('00000000-0000-0000-0000-0000000106a2', 'parcela2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000106a1');
insert into fixture select 'h', public.create_household('Casa das Parcelas');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 5000.00, '2026-01-01') returning id)
  insert into fixture select 'bank', id from i;
insert into fixture select 'cat', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';
-- cartão A: março 100, abril 80 e maio 60, todas fechadas e pagas (travadas), e as faturas de hoje em diante
insert into fixture select 'a', public.create_debt('Cartão A', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('a'), 17, 25);
select public.card_purchase(pg_temp.fx('a'), '2026-03-01', 100.00, 1, pg_temp.fx('cat'), 'Mercado');
select public.card_purchase(pg_temp.fx('a'), '2026-03-20', 80.00, 1, pg_temp.fx('cat'), 'Livro');
select public.card_purchase(pg_temp.fx('a'), '2026-04-20', 60.00, 1, pg_temp.fx('cat'), 'Fone');
select public.card_bill_due('2026-05-31');
select public.debt_pay(pg_temp.fx('a'), '2026-03-25', pg_temp.fx('bank'), 100.00, pg_temp.fat(pg_temp.fx('a'), '2026-03'));
select public.debt_pay(pg_temp.fx('a'), '2026-04-25', pg_temp.fx('bank'), 80.00, pg_temp.fat(pg_temp.fx('a'), '2026-04'));
select public.debt_pay(pg_temp.fx('a'), '2026-05-25', pg_temp.fx('bank'), 60.00, pg_temp.fat(pg_temp.fx('a'), '2026-05'));
-- a fatura de hoje (30 + 12), a segunda (30) e a terceira (30): uma compra de 90 em 3x e um café
select public.card_purchase(pg_temp.fx('a'), pg_temp.hoje(), 90.00, 3, pg_temp.fx('cat'), 'Parcelada');
select public.card_purchase(pg_temp.fx('a'), pg_temp.hoje(), 12.00, 1, pg_temp.fx('cat'), 'Café');
insert into nota select 'O', m.label from public.card_months(pg_temp.fx('a')) m where m.closing_date > pg_temp.hoje() order by m.label limit 1;
insert into fixture select 'mercado', id from public.debt_installments where debt_id = pg_temp.fx('a') and description = 'Mercado';
insert into fixture select 'par1', id from public.debt_installments where debt_id = pg_temp.fx('a') and description = 'Parcelada' and seq = 1;
insert into fixture select 'par2', id from public.debt_installments where debt_id = pg_temp.fx('a') and description = 'Parcelada' and seq = 2;
insert into fixture select 'par3', id from public.debt_installments where debt_id = pg_temp.fx('a') and description = 'Parcelada' and seq = 3;
insert into fixture select 'cafe', id from public.debt_installments where debt_id = pg_temp.fx('a') and description = 'Café';

select is(pg_temp.sit(pg_temp.fx('a'), '2026-03'), '100.00|100.00', 'T0 março fechada e paga (travada)');
select is(pg_temp.sit(pg_temp.fx('a'), '2026-04') || ' / ' || pg_temp.sit(pg_temp.fx('a'), '2026-05'), '80.00|80.00 / 60.00|60.00', 'T0 abril e maio fechadas e pagas');
select is(pg_temp.sit(pg_temp.fx('a'), pg_temp.mes(0)), '42.00|0.00', 'T0 fatura aberta: 30 da compra parcelada + 12 do café');
select is(pg_temp.sit(pg_temp.fx('a'), pg_temp.mes(1)), '30.00|0.00', 'T0 segunda fatura: 30');
select is(pg_temp.sit(pg_temp.fx('a'), pg_temp.mes(2)), '30.00|0.00', 'T0 terceira fatura: 30');
select is(pg_temp.inst('par1'), pg_temp.fecha(0) || '|17|25|30.00|1|' || pg_temp.hoje() || '|' || (select plan from public.debt_installments where id = pg_temp.fx('par1')),
          'T0 a parcela 1 está na fatura aberta (fecha dia 17, vence dia 25)');
insert into nota select 'inst0', pg_temp.inst('par1');
insert into nota select 'comprometido0', pg_temp.comprometido()::text;
insert into nota select 'eventos0', pg_temp.eventos(pg_temp.fx('a'))::text;
insert into nota select 'plan0', pg_temp.planejada(0)::text;
insert into nota select 'plan1', pg_temp.planejada(1)::text;

-- ---- N: próxima e anterior ----
insert into nota select 'ret', public.card_installment_move(pg_temp.fx('par1'), 'next')::text;
select is(pg_temp.nt('ret'), pg_temp.fecha(1), 'N1 "próxima" devolve o fechamento da segunda fatura');
select is(pg_temp.inst('par1'), pg_temp.fecha(1) || '|17|25|30.00|1|' || pg_temp.hoje() || '|' || (select plan from public.debt_installments where id = pg_temp.fx('par1')),
          'N2 só o fechamento mudou: valor, seq, data da compra e plano são os mesmos');
select is(pg_temp.sit(pg_temp.fx('a'), pg_temp.mes(0)), '12.00|0.00', 'N3 a fatura aberta perde os 30');
select is(pg_temp.sit(pg_temp.fx('a'), pg_temp.mes(1)), '60.00|0.00', 'N4 a segunda fatura ganha os 30 (a parcela 2 já estava nela)');
select is(pg_temp.sit(pg_temp.fx('a'), pg_temp.mes(2)), '30.00|0.00', 'N5 a terceira não muda');
select is(pg_temp.eventos(pg_temp.fx('a')), pg_temp.nt('eventos0')::bigint, 'N6 nenhum evento de dívida nasceu (nem cobrança, nem cancelamento)');
select is(pg_temp.comprometido()::text, pg_temp.nt('comprometido0'), 'N7 o limite comprometido não muda (a soma a cobrar é a mesma)');
select is(pg_temp.planejada(0), pg_temp.nt('plan0')::numeric - 30, 'N8 a despesa planejada do mês da fatura de origem cai 30 em period_summary');
select is(pg_temp.planejada(1), pg_temp.nt('plan1')::numeric + 30, 'N9 e a do mês de destino sobe 30');
select is(pg_temp.diferem(pg_temp.fx('a')), 0::bigint, 'N10 card_months e card_months_as_of dão os mesmos números em todas as faturas');
select is(current_setting('app.card_installment_move', true), 'off', 'N11 a marca de sessão fica desligada depois da mudança');
-- duas parcelas da mesma compra na mesma fatura (decisão do dono: parcela por parcela)
select is((select array_agg(c.seq order by c.seq) from public.card_items(pg_temp.fx('a'), pg_temp.mes(1)) c where c.description = 'Parcelada'),
          array[1, 2], 'N12 a fatura tem as parcelas 1 e 2 da mesma compra, na ordem de seq');
select is((select array_agg(c.plan_count) from public.card_items(pg_temp.fx('a'), pg_temp.mes(1)) c where c.description = 'Parcelada'),
          array[3, 3], 'N13 "n de N" continua 3 nas duas');

select is(pg_temp.mv('par1', 'previous'), null, 'N14 e a anterior traz de volta');
select is(pg_temp.inst('par1'), pg_temp.nt('inst0'), 'N15 a parcela volta exatamente ao que era');
select is(pg_temp.sit(pg_temp.fx('a'), pg_temp.mes(0)) || ' / ' || pg_temp.sit(pg_temp.fx('a'), pg_temp.mes(1)) || ' / ' || pg_temp.sit(pg_temp.fx('a'), pg_temp.mes(2)),
          '42.00|0.00 / 30.00|0.00 / 30.00|0.00', 'N16 as três faturas voltam ao que eram');
-- a anterior da fatura aberta já fechou
select is(pg_temp.mv('par1', 'previous'), '55000', 'N17 da fatura aberta não dá para ir para a anterior (já fechou)');
select alike(pg_temp.mvmsg('par1', 'previous'), '%anterior%já fechou%', 'N17.1 e a mensagem diz que a anterior já fechou');
select is(pg_temp.inst('par1'), pg_temp.nt('inst0'), 'N17.2 a parcela não mudou');
-- anterior que ainda está aberta: a parcela da segunda fatura vai para a aberta
select is(pg_temp.mv('par2', 'previous'), null, 'N18 a parcela 2 vai da segunda fatura para a aberta');
select is(pg_temp.sit(pg_temp.fx('a'), pg_temp.mes(0)) || ' / ' || coalesce(pg_temp.sit(pg_temp.fx('a'), pg_temp.mes(1)), 'sem fatura'),
          '72.00|0.00 / sem fatura', 'N19 a aberta fica com 72 e a segunda fatura deixa de existir (era só ela)');
select is(pg_temp.mv('par2', 'next'), null, 'N20 e volta');
select is(pg_temp.sit(pg_temp.fx('a'), pg_temp.mes(1)), '30.00|0.00', 'N21 a segunda fatura existe de novo');

-- ---- P: pagamento ligado à fatura ----
-- (1) o mês some e o pagamento ligado a ele é solto (vira adiantamento). A #306 só solta por evento de cancelamento ou
-- crédito; mover não cria evento, então a RPC chama private.card_payment_release
-- (o adiantamento de 20 é lançado sem fatura; como as faturas fechadas já estão pagas, ele abateria a aberta)
insert into fixture select 'p1', public.debt_pay(pg_temp.fx('a'), pg_temp.hoje(), pg_temp.fx('bank'), 20.00, null);
select is(pg_temp.sit(pg_temp.fx('a'), pg_temp.mes(0)), '42.00|20.00', 'P0 o adiantamento de 20 abate a fatura aberta');
select is(public.card_payment_move(pg_temp.fx('p1'), pg_temp.mes(2)), pg_temp.fat(pg_temp.fx('a'), pg_temp.mes(2)), 'P1 o pagamento de 20 vai para a terceira fatura');
select is(pg_temp.sit(pg_temp.fx('a'), pg_temp.mes(2)), '30.00|20.00', 'P1.1 a terceira fica com 20 pagos');
select is(pg_temp.sit(pg_temp.fx('a'), pg_temp.mes(0)), '42.00|0.00', 'P1.2 e a aberta deixa de ter o adiantamento');
select is(pg_temp.mv('par3', 'previous'), null, 'P2 a única parcela da terceira fatura vai para a segunda');
select is(pg_temp.sit(pg_temp.fx('a'), pg_temp.mes(2)), null, 'P2.1 a terceira fatura deixa de existir');
select is(pg_temp.pag('p1'), '20.00|sem fatura', 'P2.2 o pagamento foi solto da fatura que sumiu');
select is(pg_temp.sit(pg_temp.fx('a'), pg_temp.mes(0)), '42.00|20.00', 'P2.3 e vira adiantamento: abate a fatura mais antiga em aberto (a aberta)');
select is(pg_temp.diferem(pg_temp.fx('a')), 0::bigint, 'P2.4 card_months e card_months_as_of continuam iguais');
select is(pg_temp.mv('par3', 'next'), null, 'P3 a parcela volta para a terceira fatura');
select is(pg_temp.sit(pg_temp.fx('a'), pg_temp.mes(2)), '30.00|0.00', 'P3.1 a fatura que voltou não tem o pagamento (não volta sozinho)');
select is(pg_temp.sit(pg_temp.fx('a'), pg_temp.mes(0)), '42.00|20.00', 'P3.1.1 o adiantamento continua abatendo a aberta');
select is(pg_temp.pag('p1'), '20.00|sem fatura', 'P3.2 o pagamento continua sem fatura');

-- (2) o pago passa do total e a sobra vira adiantamento da fatura seguinte: o mesmo pagamento (20) liga-se à aberta (42)
select is(public.card_payment_move(pg_temp.fx('p1'), pg_temp.mes(0)), pg_temp.fat(pg_temp.fx('a'), pg_temp.mes(0)), 'P4 o pagamento de 20 vai para a fatura aberta (42)');
select is(pg_temp.sit(pg_temp.fx('a'), pg_temp.mes(0)), '42.00|20.00', 'P4.1 a aberta: 20 de 42');
select is(pg_temp.mv('par1', 'next'), null, 'P5 a parcela de 30 sai da fatura que tem o pagamento');
select is(pg_temp.sit(pg_temp.fx('a'), pg_temp.mes(0)), '12.00|12.00', 'P5.1 a aberta (12) fica paga: o pago não passa do total');
select is(pg_temp.sit(pg_temp.fx('a'), pg_temp.mes(1)), '60.00|8.00', 'P5.2 a sobra de 8 abate a fatura seguinte');
select is(pg_temp.pag('p1'), '20.00|' || pg_temp.mes(0), 'P5.3 o pagamento continua ligado à fatura aberta (ela ainda existe)');
select is(pg_temp.diferem(pg_temp.fx('a')), 0::bigint, 'P5.4 card_months e card_months_as_of continuam iguais');
select is(pg_temp.mv('par1', 'previous'), null, 'P6 a parcela volta para a fatura que já tem pagamento ligado (destino com pagamento)');
select is(pg_temp.sit(pg_temp.fx('a'), pg_temp.mes(0)) || ' / ' || pg_temp.sit(pg_temp.fx('a'), pg_temp.mes(1)), '42.00|20.00 / 30.00|0.00',
          'P6.1 a aberta volta a 20 de 42 e a seguinte ao que era');
select is(pg_temp.inst('par1'), pg_temp.nt('inst0'), 'P6.2 a parcela voltou ao que era');

-- ---- R: parcela cobrada, estornada ou de fatura fechada não muda ----
-- cobrada: antecipação (grava a cobrança da parcela e o pagamento com o mesmo op_id) de uma parcela da fatura aberta
select public.card_purchase(pg_temp.fx('a'), pg_temp.hoje(), 20.00, 1, pg_temp.fx('cat'), 'Antecipada');
insert into fixture select 'ant', id from public.debt_installments where debt_id = pg_temp.fx('a') and description = 'Antecipada';
select public.debt_anticipate(pg_temp.fx('a'), pg_temp.hoje(), pg_temp.fx('bank'), array[pg_temp.fx('ant')], array[20.00], array[0.00]);
insert into nota select 'ant0', pg_temp.inst('ant');
select is(pg_temp.mv('ant', 'next'), '55000', 'R1 parcela já cobrada (antecipação): recusada');
select alike(pg_temp.mvmsg('ant', 'next'), '%já cobrada%', 'R1.1 com a mensagem de parcela já cobrada');
select is(pg_temp.inst('ant'), pg_temp.nt('ant0'), 'R1.2 a parcela não mudou');
-- estornada em parte e inteira
select public.card_purchase(pg_temp.fx('a'), pg_temp.hoje(), 50.00, 1, pg_temp.fx('cat'), 'Estorno parcial');
insert into fixture select 'par_est', id from public.debt_installments where debt_id = pg_temp.fx('a') and description = 'Estorno parcial';
select public.debt_refund(pg_temp.fx('par_est'), pg_temp.hoje(), 10.00);
select is(pg_temp.mv('par_est', 'next'), '55000', 'R2 parcela com estorno em parte: recusada');
select alike(pg_temp.mvmsg('par_est', 'next'), '%cancelamento ou estorno%', 'R2.1 com a mensagem de cancelamento ou estorno');
select public.card_purchase(pg_temp.fx('a'), pg_temp.hoje(), 25.00, 1, pg_temp.fx('cat'), 'Estorno total');
insert into fixture select 'tot_est', id from public.debt_installments where debt_id = pg_temp.fx('a') and description = 'Estorno total';
select public.debt_refund(pg_temp.fx('tot_est'), pg_temp.hoje(), 25.00);
select is(pg_temp.mv('tot_est', 'next'), '55000', 'R3 parcela estornada inteira (cancelada): recusada');
-- fatura fechada: paga e travada, e a pagar
insert into nota select 'mercado0', pg_temp.inst('mercado');
select is(pg_temp.mv('mercado', 'next'), '55000', 'R4 parcela de fatura fechada e paga (março): recusada');
select alike(pg_temp.mvmsg('mercado', 'next'), '%paga e travada%', 'R4.1 com a mensagem de fatura paga e travada');
select is(pg_temp.mv('mercado', 'previous'), '55000', 'R4.2 também para a anterior');
select is(pg_temp.inst('mercado'), pg_temp.nt('mercado0'), 'R4.3 a parcela não mudou');
select is(pg_temp.sit(pg_temp.fx('a'), '2026-03'), '100.00|100.00', 'R4.4 março continua paga');
-- fatura fechada e ainda a pagar (cartão U: a cobrança do fechamento já foi lançada, sem pagamento)
insert into fixture select 'u', public.create_debt('Cartão U', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('u'), 17, 25);
select public.card_purchase(pg_temp.fx('u'), '2026-04-20', 60.00, 1, pg_temp.fx('cat'), 'Fone U');
select public.card_bill_due('2026-05-31');
insert into fixture select 'fone_u', id from public.debt_installments where debt_id = pg_temp.fx('u');
insert into nota select 'fone_u0', pg_temp.inst('fone_u');
select is(pg_temp.sit(pg_temp.fx('u'), '2026-05'), '60.00|0.00', 'R5 a fatura de maio do cartão U está fechada e a pagar');
select is(pg_temp.mv('fone_u', 'next'), '55000', 'R5.1 a parcela dela não muda de fatura');
select alike(pg_temp.mvmsg('fone_u', 'next'), '%já fechou%', 'R5.2 com a mensagem de fatura fechada');
select is(pg_temp.inst('fone_u'), pg_temp.nt('fone_u0'), 'R5.3 a parcela não mudou');

-- destino fechado e pago: cartão B fechou há 5 dias; a fatura que fechou está paga (travada) e a parcela da aberta
-- não pode ir para ela
insert into fixture select 'b', public.create_debt('Cartão B', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('b'), least(28, extract(day from pg_temp.hoje() - 5)::int),
  case when least(28, extract(day from pg_temp.hoje() - 5)::int) = 28 then 27 else 28 end);
select public.card_purchase(pg_temp.fx('b'), pg_temp.hoje() - 20, 70.00, 1, pg_temp.fx('cat'), 'Compra passada B');
select public.card_bill_due(pg_temp.hoje());
insert into nota select 'Bfech', m.label from public.card_months(pg_temp.fx('b')) m where m.closing_date <= pg_temp.hoje() order by m.label desc limit 1;
select public.debt_pay(pg_temp.fx('b'), pg_temp.hoje(), pg_temp.fx('bank'), 70.00, pg_temp.fat(pg_temp.fx('b'), pg_temp.nt('Bfech')));
select public.card_purchase(pg_temp.fx('b'), pg_temp.hoje(), 40.00, 1, pg_temp.fx('cat'), 'Compra de hoje B');
insert into fixture select 'b1', id from public.debt_installments where debt_id = pg_temp.fx('b') and description = 'Compra de hoje B';
insert into nota select 'b10', pg_temp.inst('b1');
select is(pg_temp.sit(pg_temp.fx('b'), pg_temp.nt('Bfech')), '70.00|70.00', 'R6 a fatura que fechou está paga (travada)');
select is(pg_temp.mv('b1', 'previous'), '55000', 'R6.1 a parcela da aberta não vai para a fatura anterior, fechada e paga');
select alike(pg_temp.mvmsg('b1', 'previous'), '%anterior%já fechou%', 'R6.2 com a mensagem de que a anterior já fechou');
select is(pg_temp.inst('b1'), pg_temp.nt('b10'), 'R6.3 a parcela não mudou');
select is(pg_temp.sit(pg_temp.fx('b'), pg_temp.nt('Bfech')), '70.00|70.00', 'R6.4 e a fatura paga continua com os mesmos números');

-- ---- M: mês curto (cartão que fecha dia 31; anos no fim do século, sempre no futuro) ----
insert into fixture select 'm', public.create_debt('Cartão curto', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('m'), 31, 10);
reset role;
insert into public.debt_installments (household_id, debt_id, plan, seq, due_date, face, category_id, description, purchase_date, closing_day, due_day)
select pg_temp.fx('h'), pg_temp.fx('m'), 'm' || n, 1, d::date, 10.00, pg_temp.fx('cat'), 'Mês curto ' || n, '2026-11-01', 31, 10
  from (values (1, '2098-01-31'), (2, '2098-03-31'), (3, '2096-01-31'), (4, '2096-02-29')) v(n, d);
insert into fixture select 'm' || (regexp_replace(i.description, '\D', '', 'g')), i.id from public.debt_installments i where i.debt_id = pg_temp.fx('m');
select pg_temp.login('00000000-0000-0000-0000-0000000106a1');
select is(public.card_installment_move(pg_temp.fx('m1'), 'next'), '2098-02-28'::date, 'M1 de 31/01 para a próxima: fevereiro fecha dia 28 (mês curto)');
select is(public.card_installment_move(pg_temp.fx('m2'), 'previous'), '2098-02-28'::date, 'M2 de 31/03 para a anterior: também 28/02');
select is(public.card_installment_move(pg_temp.fx('m3'), 'next'), '2096-02-29'::date, 'M3 ano bissexto: fevereiro fecha dia 29');
select is(public.card_installment_move(pg_temp.fx('m4'), 'next'), '2096-03-31'::date, 'M4 e de 29/02 para a próxima: março volta ao dia 31 (não 29)');
select is(pg_temp.inst('m4'), '2096-03-31|31|10|10.00|1|2026-11-01|m4', 'M5 a parcela leva os dias do ciclo (31 e 10)');
select is((select count(*) from public.card_months(pg_temp.fx('m')) where label = '2098-02' and total = 20.00), 1::bigint,
          'M6 as duas parcelas de 2098 ficam na mesma fatura, a de 2098-02 (20,00)');

-- ---- C: troca dos dias do cartão (a parcela leva os dias do mês de destino) ----
insert into fixture select 'c', public.create_debt('Cartão trocou', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('c'), 5, 15);
select public.set_card_cycle(pg_temp.fx('c'), 25, 5);
select public.card_purchase(pg_temp.fx('c'), pg_temp.hoje(), 30.00, 1, pg_temp.fx('cat'), 'Única C');
insert into fixture select 'c1', id from public.debt_installments where debt_id = pg_temp.fx('c') and description = 'Única C';
insert into nota select 'Cmes', to_char(due_date, 'YYYY-MM') from public.debt_installments where id = pg_temp.fx('c1');
select is((select closing_day || '|' || due_day from public.debt_installments where id = pg_temp.fx('c1')), '5|15', 'C1 a parcela nasce na fatura aberta, que ainda tem os dias antigos (5 e 15)');
select is(pg_temp.mv('c1', 'next'), null, 'C2 vai para a fatura seguinte, que já tem os dias novos');
select is((select closing_day || '|' || due_day from public.debt_installments where id = pg_temp.fx('c1')), '25|5', 'C3 a parcela passa a ter os dias do mês de destino (25 e 5)');
select is((select m.closing_date::text from public.card_months(pg_temp.fx('c')) m where m.label = to_char(to_date(pg_temp.nt('Cmes') || '-01', 'YYYY-MM-DD') + interval '1 month', 'YYYY-MM')),
          to_char(to_date(pg_temp.nt('Cmes') || '-01', 'YYYY-MM-DD') + interval '1 month', 'YYYY-MM') || '-25', 'C4 a fatura de destino fecha dia 25');
select is((select m.due_date::text from public.card_months(pg_temp.fx('c')) m where m.label = to_char(to_date(pg_temp.nt('Cmes') || '-01', 'YYYY-MM-DD') + interval '1 month', 'YYYY-MM')),
          to_char(to_date(pg_temp.nt('Cmes') || '-01', 'YYYY-MM-DD') + interval '2 months', 'YYYY-MM') || '-05',
          'C5 e vence dia 5 do mês seguinte (com os dias do mês de origem sairia o dia 15 do mesmo mês)');

-- ---- S: assinatura de cartão ----
insert into fixture select 's', public.create_debt('Cartão S', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('s'), 17, 25);
insert into fixture select 'r', public.recurrence_create('card', 'Streaming', 29.90, extract(day from pg_temp.hoje())::int, pg_temp.hoje(), null, null,
                                                         pg_temp.fx('s'), pg_temp.fx('cat'), null, 'month', 1);
select public.recurrence_materialize();
select public.card_scheduled_sync();
insert into fixture select 'sub', id from public.debt_installments where debt_id = pg_temp.fx('s') and recurrence_id = pg_temp.fx('r') and occurrence_date = pg_temp.hoje();
insert into nota select 'itens0', count(*)::text from public.card_scheduled_items where recurrence_id = pg_temp.fx('r');
insert into nota select 'Smes', to_char(due_date, 'YYYY-MM') from public.debt_installments where id = pg_temp.fx('sub');
select is((select count(*) from public.debt_installments where recurrence_id = pg_temp.fx('r')), 1::bigint, 'S0 a assinatura gerou a cobrança de hoje (uma parcela)');
select is(pg_temp.mv('sub', 'next'), null, 'S1 a cobrança de hoje da assinatura vai para a próxima fatura');
select is((select due_date::text from public.debt_installments where id = pg_temp.fx('sub')),
          to_char(to_date(pg_temp.nt('Smes') || '-01', 'YYYY-MM-DD') + interval '1 month', 'YYYY-MM') || '-17', 'S1.1 com o fechamento do mês seguinte');
select is((select recurrence_id::text || '|' || occurrence_date from public.debt_installments where id = pg_temp.fx('sub')),
          pg_temp.fx('r')::text || '|' || pg_temp.hoje(), 'S1.2 o vínculo com a assinatura (regra e data da ocorrência) continua o mesmo');
select is(public.recurrence_materialize(), 0, 'S2 a geração do dia não cria outra parcela para a ocorrência movida');
select is((select count(*) from public.debt_installments where recurrence_id = pg_temp.fx('r')), 1::bigint, 'S2.1 continua uma só parcela da assinatura');
select public.card_scheduled_sync();
select public.card_scheduled_convert();
select is((select count(*) from public.debt_installments where recurrence_id = pg_temp.fx('r') and occurrence_date = pg_temp.hoje()), 1::bigint,
          'S3 sincronizar e converter os agendados não duplica a ocorrência de hoje');
select is((select count(*)::text from public.card_scheduled_items where recurrence_id = pg_temp.fx('r')), pg_temp.nt('itens0'), 'S3.1 e não cria nem apaga item agendado');
select is((select count(*) from public.card_subscription_previews(pg_temp.fx('s'), pg_temp.nt('Smes')) p where p.occurrence_date = pg_temp.hoje()), 0::bigint,
          'S4 a ocorrência movida não volta como "assinatura prevista" na fatura de origem');
select is((select count(*) from public.card_subscription_previews(pg_temp.fx('s'),
            to_char(to_date(pg_temp.nt('Smes') || '-01', 'YYYY-MM-DD') + interval '1 month', 'YYYY-MM')) p where p.occurrence_date = pg_temp.hoje()), 0::bigint,
          'S4.1 nem na de destino');
select is(pg_temp.sit(pg_temp.fx('s'), to_char(to_date(pg_temp.nt('Smes') || '-01', 'YYYY-MM-DD') + interval '1 month', 'YYYY-MM')), '29.90|0.00',
          'S5 a fatura de destino tem a cobrança uma vez só (29,90)');
select is(pg_temp.mv('sub', 'previous'), null, 'S6 e volta para a fatura de origem');
select is((select count(*) from public.debt_installments where recurrence_id = pg_temp.fx('r')), 1::bigint, 'S6.1 uma só parcela da assinatura');

-- ---- X: o que não se move ----
-- cartão sem fechamento definido
insert into fixture select 'x', public.create_debt('Cartão sem ciclo', 'card', '2026-01-01', 0);
reset role;
insert into public.debt_installments (household_id, debt_id, plan, seq, due_date, face, category_id, description, purchase_date)
values (pg_temp.fx('h'), pg_temp.fx('x'), 'x1', 1, '2098-05-10', 10.00, pg_temp.fx('cat'), 'Sem ciclo', '2026-11-01');
insert into fixture select 'x1', id from public.debt_installments where debt_id = pg_temp.fx('x');
select pg_temp.login('00000000-0000-0000-0000-0000000106a1');
select is(pg_temp.mv('x1', 'next'), '55000', 'X1 cartão sem dia de fechamento: recusado');
select alike(pg_temp.mvmsg('x1', 'next'), '%dia de fechamento%', 'X1.1 com a mensagem certa');
-- dívida que não é cartão (o gatilho que impede parcela fora do cartão é desligado só para montar o caso)
insert into fixture select 'loan', public.create_debt('Empréstimo', 'loan', '2026-01-01', 0);
reset role;
alter table public.debt_installments disable trigger debt_installments_card_only;
insert into public.debt_installments (household_id, debt_id, plan, seq, due_date, face, category_id, description, purchase_date)
values (pg_temp.fx('h'), pg_temp.fx('loan'), 'l1', 1, '2098-05-10', 10.00, pg_temp.fx('cat'), 'Empréstimo', '2026-11-01');
alter table public.debt_installments enable trigger debt_installments_card_only;
insert into fixture select 'l1', id from public.debt_installments where debt_id = pg_temp.fx('loan');
select pg_temp.login('00000000-0000-0000-0000-0000000106a1');
select is(pg_temp.mv('l1', 'next'), '22023', 'X2 dívida que não é cartão: recusada');
select alike(pg_temp.mvmsg('l1', 'next'), '%só parcela de cartão%', 'X2.1 com a mensagem certa');
-- direção
select is(pg_temp.mv('par1', 'sideways'), '22023', 'X3 direção que não é previous nem next: recusada');
select is(pg_temp.mv('par1', null), '22023', 'X3.1 sem direção: recusada');
select is(pg_temp.mv('par1', 'NEXT'), '22023', 'X3.2 maiúsculas não valem (a tela manda previous/next)');
select is(pg_temp.inst('par1'), pg_temp.nt('inst0'), 'X3.3 a parcela não mudou');
-- parcela inexistente
select is(pg_temp.sqlstate_of(format($$select public.card_installment_move(%L, 'next')$$, gen_random_uuid())), '42501', 'X4 parcela que não existe: 42501');
select is(pg_temp.sqlstate_of($$select public.card_installment_move(null, 'next')$$), '42501', 'X4.1 sem parcela: 42501');

-- destino com outro fechamento gravado no mês (troca de dias antiga: dois fechamentos no mesmo mês)
insert into fixture select 'l', public.create_debt('Cartão L', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('l'), 17, 25);
reset role;
insert into public.debt_installments (household_id, debt_id, plan, seq, due_date, face, category_id, description, purchase_date, closing_day, due_day)
values (pg_temp.fx('h'), pg_temp.fx('l'), 'lx', 1, to_date(pg_temp.fecha(0), 'YYYY-MM-DD'), 10.00, pg_temp.fx('cat'), 'Origem L', pg_temp.hoje(), 17, 25),
       (pg_temp.fx('h'), pg_temp.fx('l'), 'ly', 1, to_date(pg_temp.mes(1) || '-20', 'YYYY-MM-DD'), 10.00, pg_temp.fx('cat'), 'Destino L (outro dia)', pg_temp.hoje(), 20, 28);
insert into fixture select 'lx', id from public.debt_installments where debt_id = pg_temp.fx('l') and description = 'Origem L';
select pg_temp.login('00000000-0000-0000-0000-0000000106a1');
select is(pg_temp.mv('lx', 'next'), '55000', 'X5 destino com parcela de outro dia de fechamento: recusado');
select alike(pg_temp.mvmsg('lx', 'next'), '%outro dia de fechamento%', 'X5.1 com a mensagem certa');
select is((select due_date::text from public.debt_installments where id = pg_temp.fx('lx')), pg_temp.fecha(0), 'X5.2 a parcela não mudou');
-- o mesmo com um crédito avulso no destino
insert into fixture select 'l2', public.create_debt('Cartão L2', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('l2'), 17, 25);
reset role;
insert into public.debt_installments (household_id, debt_id, plan, seq, due_date, face, category_id, description, purchase_date, closing_day, due_day)
values (pg_temp.fx('h'), pg_temp.fx('l2'), 'l2x', 1, to_date(pg_temp.fecha(0), 'YYYY-MM-DD'), 10.00, pg_temp.fx('cat'), 'Origem L2', pg_temp.hoje(), 17, 25);
insert into public.debt_events (household_id, debt_id, date, kind, amount, category_id, category_type, credit_date, note)
select pg_temp.fx('h'), pg_temp.fx('l2'), to_date(pg_temp.mes(1) || '-20', 'YYYY-MM-DD'), 'income_credit', 5.00, c.id, 'income', pg_temp.hoje(), 'crédito de outro dia'
  from public.categories c where c.household_id = pg_temp.fx('h') and c.type = 'income' limit 1;
insert into fixture select 'l2x', id from public.debt_installments where debt_id = pg_temp.fx('l2');
select pg_temp.login('00000000-0000-0000-0000-0000000106a1');
select is(pg_temp.mv('l2x', 'next'), '55000', 'X6 destino com crédito avulso de outro dia de fechamento: recusado');

-- destino que fecha até o início do cartão
insert into fixture select 'rf', public.create_debt('Cartão ref', 'card', to_date(pg_temp.fecha(0), 'YYYY-MM-DD'), 0);
select public.set_card_cycle(pg_temp.fx('rf'), 17, 25);
reset role;
insert into public.debt_installments (household_id, debt_id, plan, seq, due_date, face, category_id, description, purchase_date, closing_day, due_day)
values (pg_temp.fx('h'), pg_temp.fx('rf'), 'rfx', 1, to_date(pg_temp.fecha(1), 'YYYY-MM-DD'), 10.00, pg_temp.fx('cat'), 'Depois do início', pg_temp.hoje(), 17, 25);
insert into fixture select 'rfx', id from public.debt_installments where debt_id = pg_temp.fx('rf');
select pg_temp.login('00000000-0000-0000-0000-0000000106a1');
select is(pg_temp.mv('rfx', 'previous'), '23514', 'X7 destino que fecha até o início do cartão: recusado');

-- ---- I: isolamento, anônimo e a parcela continua imutável fora da RPC ----
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000106a2');
insert into fixture select 'h2', public.create_household('Casa Vizinha');
select is(pg_temp.mv('par1', 'next'), '42501', 'I1 outra família não move a parcela alheia');
select is(pg_temp.mv('par1', 'previous'), '42501', 'I1.1 nem para a anterior');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.sqlstate_of(format($$select public.card_installment_move(%L, 'next')$$, pg_temp.fx('par1'))), '42501', 'I2 sem login: recusado');
set role anon;
select is(pg_temp.sqlstate_of(format($$select public.card_installment_move(%L, 'next')$$, pg_temp.fx('par1'))), '42501', 'I3 anon não executa a função');
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000106a1');
select is(pg_temp.inst('par1'), pg_temp.nt('inst0'), 'I4 a parcela do outro lado continua intacta');
select is(pg_temp.sqlstate_of(format($$update public.debt_installments set due_date = due_date + 1 where id = %L$$, pg_temp.fx('par1'))), '42501',
          'I5 o app não muda a fatura da parcela direto na tabela');
reset role;
-- como dono do banco, sem a marca de sessão: imutável
select is(pg_temp.sqlstate_of(format($$update public.debt_installments set due_date = due_date + 1 where id = %L$$, pg_temp.fx('par1'))), '42501',
          'I6 sem a marca de sessão, trocar o fechamento direto na tabela é recusado (parcela imutável)');
select set_config('app.card_installment_move', 'on', true);
select is(pg_temp.sqlstate_of(format($$update public.debt_installments set face = face + 1 where id = %L$$, pg_temp.fx('par1'))), '42501',
          'I7 com a marca, o valor da parcela continua imutável');
select is(pg_temp.sqlstate_of(format($$update public.debt_installments set purchase_date = purchase_date + 1 where id = %L$$, pg_temp.fx('par1'))), '42501',
          'I8 com a marca, a data da compra continua imutável');
select is(pg_temp.sqlstate_of(format($$update public.debt_installments set seq = 9 where id = %L$$, pg_temp.fx('par1'))), '42501',
          'I9 com a marca, o número da parcela continua imutável');
select is(pg_temp.sqlstate_of(format($$update public.debt_installments set recurrence_id = null, occurrence_date = null where id = %L$$, pg_temp.fx('sub'))), '42501',
          'I10 com a marca, o vínculo com a assinatura continua imutável');
select is(pg_temp.sqlstate_of(format($$update public.debt_installments set debt_id = %L where id = %L$$, pg_temp.fx('b'), pg_temp.fx('par1'))), '42501',
          'I11 com a marca, a parcela não muda de cartão');
select set_config('app.card_installment_move', 'off', true);
select is(pg_temp.inst('par1'), pg_temp.nt('inst0'), 'I12 depois de todas as tentativas a parcela continua igual');

select * from finish();
rollback;
