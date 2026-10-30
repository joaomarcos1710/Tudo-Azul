-- 11_recurrences: migration 006. Regras recorrentes em conta (planejados até 2 meses à frente) e
-- assinatura no cartão (compra no dia da ocorrência), idempotência, edição, encerramento e isolamento.
-- As datas são relativas a hoje (São Paulo): a geração depende do relógio.
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
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return null; exception when others then return sqlstate; end $f$;
-- hoje em SP e início do mês, deslocado em n meses
create function pg_temp.hoje() returns date language sql as $f$ select (now() at time zone 'America/Sao_Paulo')::date $f$;
create function pg_temp.mes(n integer) returns date language sql as $f$
  select (date_trunc('month', pg_temp.hoje()) + make_interval(months => n))::date $f$;
create function pg_temp.datas(p_rec uuid) returns date[] language sql as $f$
  select coalesce(array_agg(date order by date), '{}') from public.transactions
   where recurrence_id = p_rec and deleted_at is null $f$;
grant execute on function pg_temp.fx(text), pg_temp.sqlstate_of(text), pg_temp.hoje(), pg_temp.mes(integer),
  pg_temp.datas(uuid) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000011a1', 'rc1@teste.com'),
  ('00000000-0000-0000-0000-0000000011a2', 'rc2@teste.com');

select pg_temp.login('00000000-0000-0000-0000-0000000011a1');
insert into fixture select 'h', public.create_household('Casa Recorrente');
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Banco', 'checking', 1000, pg_temp.mes(-6)) returning id)
  insert into fixture select 'bank', id from i;
with i as (insert into public.accounts (household_id, name, type, initial_balance, opening_date)
           values (pg_temp.fx('h'), 'Poupança', 'savings', 0, pg_temp.mes(-6)) returning id)
  insert into fixture select 'poup', id from i;
insert into fixture select 'cexp', id from public.categories where household_id = pg_temp.fx('h') and name = 'Compras pessoais';
insert into fixture select 'cinc', id from public.categories where household_id = pg_temp.fx('h') and type = 'income' and system_key is null limit 1;
insert into fixture select 'card', public.create_debt('Nubank', 'card', pg_temp.mes(-6), 0);
select public.set_card_cycle(pg_temp.fx('card'), 17, 25);

-- RC1: validações e forma
select is(pg_temp.sqlstate_of($$select public.recurrence_create('expense', 'Luz', 0, 10, pg_temp.mes(0), pg_temp.fx('bank'), null, null, pg_temp.fx('cexp'))$$),
          '22023', 'RC1 valor zero: recusado');
select is(pg_temp.sqlstate_of($$select public.recurrence_create('expense', 'Luz', 10, 32, pg_temp.mes(0), pg_temp.fx('bank'), null, null, pg_temp.fx('cexp'))$$),
          '22023', 'RC1 dia 32: recusado');
select is(pg_temp.sqlstate_of($$select public.recurrence_create('expense', 'Luz', 10, 10, pg_temp.mes(0), pg_temp.fx('bank'), null, null, null)$$),
          '23514', 'RC1 despesa sem categoria: recusada');
select is(pg_temp.sqlstate_of($$select public.recurrence_create('income', 'Salário', 10, 5, pg_temp.mes(0), pg_temp.fx('bank'), null, null, pg_temp.fx('cexp'))$$),
          '23503', 'RC1 receita com categoria de despesa: recusada pela FK');
select is(pg_temp.sqlstate_of($$select public.recurrence_create('card', 'Netflix', 55.90, 5, pg_temp.mes(0), null, null, pg_temp.fx('bank'), pg_temp.fx('cexp'))$$),
          '23514', 'RC1 assinatura fora de cartão: recusada');
select is(pg_temp.sqlstate_of($$select public.recurrence_create('expense', 'Luz', 10.001, 10, pg_temp.mes(0), pg_temp.fx('bank'), null, null, pg_temp.fx('cexp'))$$),
          '22003', 'RC1 mais de 2 casas: recusado');

-- RC2: despesa mensal em conta desde 2 meses atrás, dia 10, sem data final: gera de mês −2 até mês +12 (15 planejados; migration 022)
insert into fixture select 'luz', public.recurrence_create('expense', 'Luz', 180.00, 10, pg_temp.mes(-2), pg_temp.fx('bank'), null, null, pg_temp.fx('cexp'));
select is(public.recurrence_materialize(), 15, 'RC2 primeira geração: 15 lançamentos (mês −2 a +12)');
select is(pg_temp.datas(pg_temp.fx('luz')),
          array(select pg_temp.mes(k) + 9 from generate_series(-2, 12) k order by k),
          'RC2 todo dia 10');
select is((select array_agg(distinct status || '|' || amount || '|' || type) from public.transactions where recurrence_id = pg_temp.fx('luz')),
          array['planned|180.00|expense'], 'RC2 planejados de despesa, valor da regra');

-- RC3: idempotente
select is(public.recurrence_materialize(), 0, 'RC3 segunda geração: nada novo');

-- RC4: corrigir o valor de um mês e pagar (fluxo normal de Lançamentos)
select lives_ok($$update public.transactions set amount = 187.40, status = 'paid'
                   where recurrence_id = pg_temp.fx('luz') and date = pg_temp.mes(-1) + 9$$,
                'RC4 conta chegou: valor corrigido e pago');

-- RC5: ocorrência excluída não volta
select lives_ok($$update public.transactions set deleted_at = now()
                   where recurrence_id = pg_temp.fx('luz') and date = pg_temp.mes(1) + 9$$, 'RC5 exclui o mês +1');
select is(public.recurrence_materialize(), 0, 'RC5 geração não recria o excluído');

-- RC6: mudar a regra vale para planejados de hoje em diante; pagos e passados ficam
select lives_ok($$select public.recurrence_update(pg_temp.fx('luz'), 'Conta de luz', 200.00)$$, 'RC6 reajuste para 200');
select is((select amount from public.transactions where recurrence_id = pg_temp.fx('luz') and date = pg_temp.mes(-1) + 9),
          187.40, 'RC6 mês pago não muda');
select is((select amount from public.transactions where recurrence_id = pg_temp.fx('luz') and date = pg_temp.mes(2) + 9),
          200.00, 'RC6 planejado futuro passa a 200');
select is((select description from public.transactions where recurrence_id = pg_temp.fx('luz') and date = pg_temp.mes(2) + 9),
          'Conta de luz', 'RC6 descrição atualizada');

-- RC6b (migration 015): o reajuste não desfaz o que foi corrigido à mão, campo a campo.
-- Regras a partir do mês que vem (dia 10): os planejados (+1 a +12) são sempre futuros, qualquer que seja hoje.
insert into fixture select 'cexp2', id from public.categories
 where household_id = pg_temp.fx('h') and type = 'expense' and system_key is null and id <> pg_temp.fx('cexp') order by name limit 1;
insert into fixture select 'e_luz',  public.recurrence_create('expense', 'Luz', 180.00, 10, pg_temp.mes(1), pg_temp.fx('bank'), null, null, pg_temp.fx('cexp'));
insert into fixture select 'e_agua', public.recurrence_create('expense', 'Água', 90.00, 10, pg_temp.mes(1), pg_temp.fx('bank'), null, null, pg_temp.fx('cexp'));
insert into fixture select 'e_gas',  public.recurrence_create('expense', 'Gás', 60.00, 10, pg_temp.mes(1), pg_temp.fx('bank'), null, null, pg_temp.fx('cexp'));
insert into fixture select 'e_guar', public.recurrence_create('transfer', 'Reserva', 500.00, 10, pg_temp.mes(1), pg_temp.fx('bank'), pg_temp.fx('poup'));
insert into fixture select 'e_net',  public.recurrence_create('expense', 'Internet', 100.00, 10, pg_temp.mes(1), pg_temp.fx('bank'), null, null, pg_temp.fx('cexp'));
select is(public.recurrence_materialize(), 60, 'RC6b 5 regras x 12 meses futuros');
-- valor|descrição|categoria do planejado do mês n de uma regra
create function pg_temp.occ(p_rec uuid, p_n integer) returns text language sql as $f$
  select amount || '|' || description || '|' || coalesce(category_id::text, 'null') from public.transactions
   where recurrence_id = p_rec and date = pg_temp.mes(p_n) + 9 $f$;
-- planejados futuros dessas regras que diferem da regra em algum dos três campos
create function pg_temp.divergentes() returns bigint language sql as $f$
  select count(*) from public.transactions t join public.recurrences r on r.id = t.recurrence_id
   where r.description in ('Luz', 'Água', 'Água e esgoto', 'Gás', 'Gás encanado', 'Reserva', 'Internet')
     and t.status = 'planned' and t.deleted_at is null and t.date >= pg_temp.hoje()
     and (t.amount <> r.amount or t.description <> r.description or t.category_id is distinct from r.category_id) $f$;
grant execute on function pg_temp.occ(uuid, integer), pg_temp.divergentes() to public;
select is(pg_temp.divergentes(), 0::bigint, 'RC6b premissa: sem edição manual, todo planejado futuro é igual à regra');

-- correções à mão no mês +1, pelo mesmo caminho do app (UPDATE do cliente)
update public.transactions set amount = 213.40 where recurrence_id = pg_temp.fx('e_luz') and date = pg_temp.mes(1) + 9;
update public.transactions set description = 'Água (conta chegou)' where recurrence_id = pg_temp.fx('e_agua') and date = pg_temp.mes(1) + 9;
update public.transactions set category_id = pg_temp.fx('cexp2') where recurrence_id = pg_temp.fx('e_gas') and date = pg_temp.mes(1) + 9;
update public.transactions set amount = 100.00 where recurrence_id = pg_temp.fx('e_net') and date = pg_temp.mes(1) + 9; -- igual à regra
select is(pg_temp.divergentes(), 3::bigint, 'RC6b só as 3 correções reais divergem da regra');

select lives_ok($$select public.recurrence_update(pg_temp.fx('e_luz'), 'Luz', 200.00)$$, 'RC6b reajusta a luz para 200');
select lives_ok($$select public.recurrence_update(pg_temp.fx('e_agua'), 'Água e esgoto', 95.00)$$, 'RC6b reajusta a água (valor e descrição)');
select lives_ok($$select public.recurrence_update(pg_temp.fx('e_gas'), 'Gás encanado', 65.00)$$, 'RC6b reajusta o gás (valor e descrição)');
select lives_ok($$select public.recurrence_update(pg_temp.fx('e_guar'), 'Reserva', 600.00)$$, 'RC6b reajusta a transferência');
select lives_ok($$select public.recurrence_update(pg_temp.fx('e_net'), 'Internet', 120.00)$$, 'RC6b reajusta a internet');

select is(pg_temp.occ(pg_temp.fx('e_luz'), 1), '213.40|Luz|' || pg_temp.fx('cexp'),
          'RC6b valor corrigido à mão (213,40) fica');
select is(pg_temp.occ(pg_temp.fx('e_luz'), 2), '200.00|Luz|' || pg_temp.fx('cexp'),
          'RC6b o mês não corrigido segue a regra (200)');
select is(pg_temp.occ(pg_temp.fx('e_agua'), 1), '95.00|Água (conta chegou)|' || pg_temp.fx('cexp'),
          'RC6b descrição corrigida fica; o valor segue a regra');
select is(pg_temp.occ(pg_temp.fx('e_agua'), 2), '95.00|Água e esgoto|' || pg_temp.fx('cexp'),
          'RC6b sem correção: valor e descrição da regra');
select is(pg_temp.occ(pg_temp.fx('e_gas'), 1), '65.00|Gás encanado|' || pg_temp.fx('cexp2'),
          'RC6b categoria corrigida fica; valor e descrição seguem a regra');
select is(pg_temp.occ(pg_temp.fx('e_guar'), 1), '600.00|Reserva|null', 'RC6b transferência (sem categoria) segue a regra');
select is(pg_temp.occ(pg_temp.fx('e_net'), 1), '120.00|Internet|' || pg_temp.fx('cexp'),
          'RC6b limite conhecido: "corrigir" para o mesmo valor da regra não deixa rastro e segue a regra');
-- segundo reajuste: quem foi corrigido continua; quem não foi continua acompanhando
select lives_ok($$select public.recurrence_update(pg_temp.fx('e_luz'), 'Luz', 210.00)$$, 'RC6b 2º reajuste da luz');
select is(pg_temp.occ(pg_temp.fx('e_luz'), 1), '213.40|Luz|' || pg_temp.fx('cexp'), 'RC6b 2º reajuste: a correção continua');
select is(pg_temp.occ(pg_temp.fx('e_luz'), 2), '210.00|Luz|' || pg_temp.fx('cexp'), 'RC6b 2º reajuste: o mês não corrigido acompanha (210)');
select is(pg_temp.divergentes(), 3::bigint, 'RC6b depois dos reajustes, só as 3 correções reais divergem');
-- trocar a categoria da regra leva os não corrigidos e preserva quem teve a categoria corrigida
select lives_ok($$select public.recurrence_update(pg_temp.fx('e_gas'), 'Gás encanado', 65.00, pg_temp.fx('cexp2'))$$,
                'RC6b muda a categoria da regra do gás');
select is(pg_temp.occ(pg_temp.fx('e_gas'), 2), '65.00|Gás encanado|' || pg_temp.fx('cexp2'), 'RC6b categoria nova chega ao mês não corrigido');
-- o reajuste não toca planejado na LIXEIRA nem planejado com data PASSADA.
-- Regra todo dia 1 desde o mês passado: o dia 1 do mês passado é sempre passado (qualquer que seja hoje);
-- o do mês que vem vai para a lixeira; o de daqui a 2 meses é o controle (sem edição, deve seguir a regra).
insert into fixture select 'e_alug', public.recurrence_create('expense', 'Aluguel', 1000.00, 1, pg_temp.mes(-1), pg_temp.fx('bank'), null, null, pg_temp.fx('cexp'));
select is(public.recurrence_materialize(), 14, 'RC6b aluguel: mês −1 a +12');
create function pg_temp.alug(p_n integer) returns text language sql as $f$
  select amount || '|' || description || '|' || category_id || '|' || status || '|' || (deleted_at is not null)
    from public.transactions where recurrence_id = pg_temp.fx('e_alug') and date = pg_temp.mes(p_n) $f$;
grant execute on function pg_temp.alug(integer) to public;
update public.transactions set deleted_at = now() where recurrence_id = pg_temp.fx('e_alug') and date = pg_temp.mes(1);
select ok(pg_temp.mes(-1) < pg_temp.hoje(), 'RC6b o planejado do mês −1 está no passado');
select lives_ok($$select public.recurrence_update(pg_temp.fx('e_alug'), 'Aluguel novo', 1100.00, pg_temp.fx('cexp2'))$$,
                'RC6b reajusta o aluguel (valor, descrição e categoria)');
select is(pg_temp.alug(-1), '1000.00|Aluguel|' || pg_temp.fx('cexp') || '|planned|false',
          'RC6b planejado com data passada não muda (valor, descrição e categoria)');
select is(pg_temp.alug(1), '1000.00|Aluguel|' || pg_temp.fx('cexp') || '|planned|true',
          'RC6b planejado na lixeira não muda e continua na lixeira');
select is(pg_temp.alug(2), '1100.00|Aluguel novo|' || pg_temp.fx('cexp2') || '|planned|false',
          'RC6b controle: planejado futuro sem edição segue a regra');

-- encerra as regras de teste (planejados futuros para a lixeira), para não interferir nos casos seguintes
select public.recurrence_end(pg_temp.fx(k)) from unnest(array['e_luz','e_agua','e_gas','e_guar','e_net','e_alug']) k;

-- RC7: dia 31 vira o último dia do mês; transferência e receita também geram
insert into fixture select 'poupar', public.recurrence_create('transfer', 'Guardar', 500.00, 31, pg_temp.mes(0), pg_temp.fx('bank'), pg_temp.fx('poup'));
insert into fixture select 'sal', public.recurrence_create('income', 'Salário', 8000.00, 5, pg_temp.mes(0), pg_temp.fx('bank'), null, null, pg_temp.fx('cinc'));
select is(public.recurrence_materialize(), 26, 'RC7 transferência e salário: 13 meses cada (mês 0 a +12)');
select is(pg_temp.datas(pg_temp.fx('poupar')),
          array(select pg_temp.mes(k) - 1 from generate_series(1, 13) k order by k),
          'RC7 dia 31 = último dia de cada mês');

-- RC8: assinatura no cartão — só até hoje, compra à vista que entra na fatura pelo fechamento
insert into fixture select 'netflix', public.recurrence_create('card', 'Netflix', 55.90, 1, pg_temp.mes(-1), null, null, pg_temp.fx('card'), pg_temp.fx('cexp'));
select is(public.recurrence_materialize(), 2, 'RC8 assinatura dia 1: mês −1 e este mês (nunca futuro)');
select is((select array_agg(purchase_date || '|' || due_date || '|' || face || '|' || description order by purchase_date)
             from public.debt_installments where recurrence_id = pg_temp.fx('netflix')),
          array[pg_temp.mes(-1) || '|' || (pg_temp.mes(-1) + 16) || '|55.90|Netflix',
                pg_temp.mes(0)  || '|' || (pg_temp.mes(0)  + 16) || '|55.90|Netflix'],
          'RC8 compra no dia 1 cai na fatura que fecha dia 17 do mesmo mês');
select is(public.recurrence_materialize(), 0, 'RC8 idempotente no cartão');
select is((select array_agg(distinct closing_day || '/' || due_day) from public.debt_installments where recurrence_id = pg_temp.fx('netflix')),
          array['17/25'], 'RC8 ciclo do cartão gravado na parcela da assinatura');
-- excluir a compra de um mês (card_purchase_delete) não faz a geração recriá-la
select lives_ok($$select public.card_purchase_delete(pg_temp.fx('card'),
                   (select plan from public.debt_installments where recurrence_id = pg_temp.fx('netflix') and occurrence_date = pg_temp.mes(-1)))$$,
                'RC8 exclui a assinatura do mês −1');
select is(public.recurrence_materialize(), 0, 'RC8 compra excluída não volta');

-- RC9: encerrar para de gerar e manda planejados futuros para a lixeira; a conta pode ser desativada
select lives_ok($$select public.recurrence_end(pg_temp.fx('luz'))$$, 'RC9 encerra a luz hoje');
select is((select count(*) from public.transactions
            where recurrence_id = pg_temp.fx('luz') and deleted_at is null and date > pg_temp.hoje()), 0::bigint,
          'RC9 nenhum planejado futuro da luz');
select is((select count(*) from public.transactions where recurrence_id is null and date = pg_temp.mes(-1) + 9
            and description = 'Luz' and status = 'paid' and deleted_at is null), 1::bigint,
          'RC9 o lançamento pago continua no histórico, sem vínculo com a regra excluída');
select is(public.recurrence_materialize(), 0, 'RC9 regra encerrada não gera mais');

-- RC10: cliente não grava nem altera regra nem forja o vínculo direto
select is(pg_temp.sqlstate_of($$insert into public.recurrences (household_id, kind, description, amount, day, start_date, account_id, category_id)
          values (pg_temp.fx('h'), 'expense', 'x', 1, 1, pg_temp.mes(0), pg_temp.fx('bank'), pg_temp.fx('cexp'))$$),
          '42501', 'RC10 INSERT direto em recurrences: sem privilégio');
select is(pg_temp.sqlstate_of($$update public.transactions set recurrence_id = null where recurrence_id = pg_temp.fx('sal')$$),
          '42501', 'RC10 cliente não altera recurrence_id');

-- RC11: isolamento
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000011a2');
select public.create_household('Outra Casa');
select is((select count(*) from public.recurrences), 0::bigint, 'RC11 outra família não vê as regras');
select is(pg_temp.sqlstate_of($$select public.recurrence_update(pg_temp.fx('sal'), 'x', 1)$$), '42501', 'RC11 não edita regra alheia');
select is(pg_temp.sqlstate_of($$select public.recurrence_end(pg_temp.fx('sal'))$$), '42501', 'RC11 não encerra regra alheia');
select is(public.recurrence_materialize(), 0, 'RC11 geração da outra família não toca nas regras alheias');

select * from finish();
rollback;
