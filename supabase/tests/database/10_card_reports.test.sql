-- 10_card_reports: migration 005. Totais por fatura (card_months) e itens da fatura (card_items),
-- calculados no banco; isolamento entre famílias.
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
grant execute on function pg_temp.fx(text) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000010a1', 'r1@teste.com'),
  ('00000000-0000-0000-0000-0000000010a2', 'r2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000010a1');
insert into fixture select 'h', public.create_household('Casa Fatura');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 5000, '2026-01-01') returning id)
  insert into fixture select 'bank', id from i;
insert into fixture select 'cat', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';
insert into fixture select 'card', public.create_debt('Nubank', 'card', '2026-01-01', 0);
select public.set_card_cycle(pg_temp.fx('card'), 17, 25);
select public.card_purchase(pg_temp.fx('card'), '2026-03-15', 300.00, 3, pg_temp.fx('cat'), 'TV');
select public.card_purchase(pg_temp.fx('card'), '2026-03-20', 80.00, 1, pg_temp.fx('cat'), 'Farmácia');

-- R1: antes da cobrança, tudo "a cobrar"; vencimento calculado pelo ciclo
select is((select array_agg(label || '|' || closing_date || '|' || due_date || '|' || charged || '|' || pending || '|' || total || '|' || paid || '|' || items order by label)
             from public.card_months(pg_temp.fx('card'))),
          array['2026-03|2026-03-17|2026-03-25|0|100.00|100.00|0|1',
                '2026-04|2026-04-17|2026-04-25|0|180.00|180.00|0|2',
                '2026-05|2026-05-17|2026-05-25|0|100.00|100.00|0|1'],
          'R1 três faturas, tudo a cobrar, vencimento dia 25');

-- R2: depois da cobrança e do pagamento de março
select public.card_bill_due('2026-03-31');
select public.debt_pay(pg_temp.fx('card'), '2026-03-25', pg_temp.fx('bank'), 100.00,
       (select id from public.debt_invoices where debt_id = pg_temp.fx('card') and label = '2026-03'));
select is((select charged || '|' || pending || '|' || total || '|' || paid from public.card_months(pg_temp.fx('card')) where label = '2026-03'),
          '100.00|0.00|100.00|100.00', 'R2 março: cobrado 100, pago 100');

-- R3: itens da fatura de abril com "n de N" e o que falta cobrar
select is((select array_agg(description || '|' || seq || '/' || plan_count || '|' || face || '|' || remaining order by description)
             from public.card_items(pg_temp.fx('card'), '2026-04')),
          array['Farmácia|1/1|80.00|80.00', 'TV|2/3|100.00|100.00'],
          'R3 abril: Farmácia 1/1 e TV 2/3, nada cobrado ainda');

-- R4: estorno parcial já cobrado abate o cobrado da fatura
select public.card_bill_due('2026-04-30');
select public.debt_refund((select installment_id from public.card_items(pg_temp.fx('card'), '2026-04') where description = 'Farmácia'),
                          '2026-04-20', 30.00);
select is((select charged || '|' || pending from public.card_months(pg_temp.fx('card')) where label = '2026-04'),
          '150.00|0.00', 'R4 abril: 180 cobrado − 30 de estorno = 150');

-- R5: outra família não vê nada
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000010a2');
select public.create_household('Outra');
select is((select count(*) from public.card_months(pg_temp.fx('card'))), 0::bigint, 'R5 outra família: nenhuma fatura');
select is((select count(*) from public.card_items(pg_temp.fx('card'), '2026-04')), 0::bigint, 'R5 outra família: nenhum item');

select * from finish();
rollback;
