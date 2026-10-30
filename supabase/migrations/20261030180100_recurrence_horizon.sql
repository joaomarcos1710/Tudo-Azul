-- Tudo Azul — migration 022: horizonte da geração de recorrentes em conta
--
-- Pedido do dono (30/10/2026): "os lançamentos recorrentes só duram 2 meses". Era o desenho da migration 006:
-- recurrence_materialize gerava os planejados só até o fim do mês daqui a 2 meses, então parcelas de empréstimo e
-- financiamento (até 120 e 360 meses) não apareciam no Calendário nem nas projeções além disso.
--
-- O que esta migration muda (só a função recurrence_materialize; create or replace, mesmos parâmetros e privilégios):
--   * regra de conta SEM data final (salário, aluguel): gera até o fim do mês daqui a 12 meses (antes: 2);
--   * regra de conta COM data final (parcelas, financiamento): gera até a data final, no máximo até o fim do mês daqui a
--     360 meses; a regra semanal/quinzenal com data final vai no máximo até 24 meses, para não criar milhares de linhas;
--   * assinatura de cartão: igual a antes (a compra só nasce no dia da ocorrência; parcela de cartão é imutável).
-- O resto da função é o da migration 20261028140100. Continua idempotente: o par (regra, data) é único e a ocorrência
-- excluída (lixeira) não volta. Nenhum dado existente é alterado: a próxima chamada do app só cria os planejados que faltam.
--
-- Teste: 29_recurrence_horizon.

create or replace function public.recurrence_materialize()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_h uuid := private.current_household();
  v_today date := private.today_sp();
  -- sem data final: até o fim do mês daqui a 12 meses
  v_open date := (date_trunc('month', v_today) + interval '13 months - 1 day')::date;
  -- com data final: teto de 360 meses (mensal) e 24 meses (semanal)
  v_cap_mes date := (date_trunc('month', v_today) + interval '361 months - 1 day')::date;
  v_cap_sem date := (date_trunc('month', v_today) + interval '25 months - 1 day')::date;
  r public.recurrences%rowtype; v_d public.debts%rowtype;
  v_occ date; v_until date; v_n integer := 0; v_rows integer;
begin
  if (select auth.uid()) is null or v_h is null then
    raise exception 'não autenticado ou sem família' using errcode = '42501';
  end if;
  for r in select * from public.recurrences where household_id = v_h and active order by id for update loop
    v_until := case
      when r.kind = 'card' then least(v_today, coalesce(r.end_date, v_today))
      when r.end_date is null then v_open
      else least(r.end_date, case when r.freq_unit = 'week' then v_cap_sem else v_cap_mes end)
    end;
    if r.kind = 'card' then
      v_d := private.debt_lock(r.debt_id);
      -- cartão sem ciclo não recebe compra (card_purchase também recusa)
      continue when v_d.closing_day is null;
    end if;
    for v_occ in select * from private.recurrence_occurrences(r, r.start_date, v_until) loop
      if r.kind = 'card' then
        if v_occ > v_d.reference_date then
          -- ciclo gravado na parcela, como em card_purchase (migration 20261017135000)
          insert into public.debt_installments (household_id, debt_id, plan, seq, due_date, face, category_id,
                                                description, purchase_date, closing_day, due_day,
                                                recurrence_id, occurrence_date)
          values (r.household_id, r.debt_id, gen_random_uuid()::text, 1,
                  private.card_first_closing(v_occ, v_d.closing_day), r.amount, r.category_id,
                  r.description, v_occ, v_d.closing_day, v_d.due_day, r.id, v_occ)
          on conflict (recurrence_id, occurrence_date) where recurrence_id is not null do nothing;
          get diagnostics v_rows = row_count;
          v_n := v_n + v_rows;
        end if;
      elsif exists (select 1 from public.accounts a
                     where a.household_id = r.household_id and a.active and a.opening_date <= v_occ
                       and a.id = r.account_id)
            and (r.destination_account_id is null or exists (
                   select 1 from public.accounts a
                    where a.household_id = r.household_id and a.active and a.opening_date <= v_occ
                      and a.id = r.destination_account_id)) then
        -- conta desativada ou ainda não aberta: pula a ocorrência (o guard recusaria)
        insert into public.transactions (household_id, account_id, destination_account_id, category_id, type,
                                         description, amount, date, status, created_by, recurrence_id, occurrence_date)
        values (r.household_id, r.account_id, r.destination_account_id, r.category_id, r.kind,
                r.description, r.amount, v_occ, 'planned', r.created_by, r.id, v_occ)
        on conflict (recurrence_id, occurrence_date) where recurrence_id is not null do nothing;
        get diagnostics v_rows = row_count;
        v_n := v_n + v_rows;
      end if;
    end loop;
    if r.kind = 'card' then perform private.debt_chk(r.debt_id); end if;
  end loop;
  return v_n;
end $$;
