-- 15_export: o que a "Exportação completa" (src/lib/csv.ts) lê, sem migration nova.
-- Garante que o arquivo "movimentos por conta" (account_movements) reconstrói o saldo com cartão no meio:
-- compra e cobrança de parcela NÃO saem da conta; o pagamento da fatura sai UMA vez; a soma = account_balances.
-- E que as leituras diretas de parcelas e eventos respeitam o RLS (outra família não vê nada).
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
create function pg_temp.saldo(p_acc uuid, p_d date) returns numeric language sql as $f$
  select balance from public.account_balances(pg_temp.fx('h'), p_d) where account_id = p_acc $f$;
create function pg_temp.soma_mov(p_acc uuid, p_d date) returns numeric language sql as $f$
  select sum(amount) from public.account_movements(p_acc, p_d) $f$;
grant execute on function pg_temp.fx(text), pg_temp.login(uuid), pg_temp.saldo(uuid, date), pg_temp.soma_mov(uuid, date) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000015a1', 'ex1@teste.com'),
  ('00000000-0000-0000-0000-0000000015a2', 'ex2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000015a1');
insert into fixture select 'h', public.create_household('Casa Exportada');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 2000.00, '2026-10-01') returning id)
  insert into fixture select 'banco', id from i;
insert into fixture select 'cat', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';
insert into fixture select 'card', public.create_debt('Cartão', 'card', '2026-09-30', 0);
select public.set_card_cycle(pg_temp.fx('card'), 17, 25);

-- compra de 300,00 em 3x no dia 2 (fecha 17/10, 17/11, 17/12); cobrança da 1ª e pagamento da fatura de outubro
insert into fixture select 'plano', public.card_purchase(pg_temp.fx('card'), '2026-10-02', 300.00, 3, pg_temp.fx('cat'), 'Fone');
select public.card_bill_due('2026-10-31');
select public.debt_pay(pg_temp.fx('card'), '2026-10-25', pg_temp.fx('banco'), 100.00,
                       (select id from public.debt_invoices where debt_id = pg_temp.fx('card') and label = '2026-10'));
insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status)
values (pg_temp.fx('h'), pg_temp.fx('banco'), pg_temp.fx('cat'), 'expense', 'Mercado', 50.25, '2026-10-20', 'paid');

select is((select array_agg(description || '|' || amount order by date, source)
             from public.account_movements(pg_temp.fx('banco'), '2026-10-31')),
          array['Saldo inicial|2000.00', 'Mercado|-50.25', 'Pagamento de Cartão|-100.00'],
          'EX1 movimentos da conta: compra e cobrança no cartão não aparecem; pagamento da fatura aparece uma vez');
select is(pg_temp.soma_mov(pg_temp.fx('banco'), '2026-10-31'), pg_temp.saldo(pg_temp.fx('banco'), '2026-10-31'),
          'EX2 soma dos movimentos = saldo do app (1849,75)');
select is(pg_temp.saldo(pg_temp.fx('banco'), '2026-10-31'), 1849.75::numeric, 'EX3 saldo esperado');
select is((select count(*) from public.debt_installments where debt_id = pg_temp.fx('card')), 3::bigint,
          'EX4 parcelas: as 3 aparecem na leitura direta (arquivo parcelas-cartao)');
select is((select array_agg(kind || '|' || amount order by date, kind) from public.debt_events
            where debt_id = pg_temp.fx('card') and voided_at is null),
          array['charge|100.00', 'payment|100.00'],
          'EX5 eventos: uma cobrança e um pagamento (arquivo eventos-cartao-e-dividas)');
select is((select debt from public.debt_balances(pg_temp.fx('h'), '2026-10-31') where debt_id = pg_temp.fx('card')),
          0.00::numeric, 'EX6 dívida do cartão zerada depois do pagamento (arquivo cadastros)');

-- EX10–EX12: a coluna "Efeito na dívida" do arquivo 5 usa a tabela efeitoNaDivida (src/lib/csv.ts).
-- A MESMA tabela aqui: valor de referência + soma dos efeitos (até a data, sem anulados) = debt_balances.balance.
create function pg_temp.efeito(p_kind text) returns integer language sql immutable as $f$
  select case when p_kind in ('disbursement', 'charge', 'refund_cash') then 1
              when p_kind in ('payment', 'extra_principal', 'credit') then -1 else 0 end $f$;
grant execute on function pg_temp.efeito(text) to public;
create function pg_temp.pela_exportacao(p_debt uuid, p_d date) returns numeric language sql as $f$
  select d.reference_balance + coalesce((select sum(pg_temp.efeito(e.kind) * e.amount) from public.debt_events e
                                          where e.debt_id = d.id and e.voided_at is null and e.date <= p_d), 0)
    from public.debts d where d.id = p_debt $f$;
grant execute on function pg_temp.pela_exportacao(uuid, date) to public;

-- empréstimo: liberação, juros e tarifa pagos da conta, pagamento
insert into fixture select 'loan', public.create_debt('Empréstimo', 'loan', '2026-10-01', 0);
select public.debt_loan_event(pg_temp.fx('loan'), '2026-10-03', 'disbursement', pg_temp.fx('banco'), 1000.00);
select public.debt_loan_event(pg_temp.fx('loan'), '2026-10-10', 'interest', pg_temp.fx('banco'), 10.00, pg_temp.fx('cat'));
select public.debt_loan_event(pg_temp.fx('loan'), '2026-10-11', 'fee', pg_temp.fx('banco'), 5.00, pg_temp.fx('cat'));
select public.debt_pay(pg_temp.fx('loan'), '2026-10-15', pg_temp.fx('banco'), 200.00);
-- cartão: segunda compra, cobrada, e depois excluída (cancelamento/estorno/anulação)
insert into fixture select 'plano2', public.card_purchase(pg_temp.fx('card'), '2026-10-04', 90.00, 3, pg_temp.fx('cat'), 'Cadeira');
select public.card_bill_due('2026-10-31');
select public.card_purchase_delete(pg_temp.fx('card'), pg_temp.fx('plano2')::text);

select is(pg_temp.pela_exportacao(pg_temp.fx('loan'), '2026-10-31'),
          (select balance from public.debt_balances(pg_temp.fx('h'), '2026-10-31') where debt_id = pg_temp.fx('loan')),
          'EX10 empréstimo: referência + efeitos = dívida do app (juros e tarifa não mexem na dívida)');
select is(pg_temp.pela_exportacao(pg_temp.fx('card'), '2026-10-31'),
          (select balance from public.debt_balances(pg_temp.fx('h'), '2026-10-31') where debt_id = pg_temp.fx('card')),
          'EX11 cartão com compra excluída: referência + efeitos = dívida do app');
select is(pg_temp.soma_mov(pg_temp.fx('banco'), '2026-10-31'), pg_temp.saldo(pg_temp.fx('banco'), '2026-10-31'),
          'EX12 conta continua batendo com empréstimo, juros e tarifa nos movimentos');

-- isolamento: outra família não lê nada do que a exportação lê
select pg_temp.login('00000000-0000-0000-0000-0000000015a2');
select is((select count(*) from public.debt_installments), 0::bigint, 'EX7 outra família não vê parcelas');
select is((select count(*) from public.debt_events), 0::bigint, 'EX8 outra família não vê eventos');
select is((select count(*) from public.account_movements(pg_temp.fx('banco'), '2026-10-31')), 0::bigint,
          'EX9 outra família não vê movimentos');

select * from finish();
rollback;
