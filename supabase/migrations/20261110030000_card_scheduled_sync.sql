-- Tudo Azul — recorrência no cartão estilo Organizze, etapa 2: gerar os itens agendados e ler por fatura
--
-- Decisões do dono (10/11/2026, docs/projeto/28): as recorrências de cartão ficam lançadas nas faturas futuras, com
-- horizonte de 12 meses que se renova sozinho.
--
-- 1. public.card_scheduled_sync() → integer
--    Preenche public.card_scheduled_items a partir das regras de cartão ativas da família de quem chama, de amanhã até o
--    fim do mês daqui a 12 meses (o mesmo horizonte das recorrências de conta). Mesma regra de recurrence_materialize:
--    fatura aberta na data da ocorrência, com o ciclo do mês (private.card_cycle_first), só depois da data de referência
--    do cartão e só em cartão com ciclo. O app chama ao abrir, depois de recurrence_materialize.
--      * item agendado e não editado acompanha a regra (valor, descrição, categoria, fatura);
--      * item agendado e não editado some se a ocorrência saiu da série (regra desativada, encerrada antes, cartão sem
--        ciclo), se ficou fora do horizonte ou se a ocorrência já virou parcela (recurrence_materialize, no dia);
--      * item editado ("só esta", etapa 4), cancelado ou convertido não é tocado.
--    Devolve quantas linhas foram criadas, atualizadas ou removidas.
--
-- 2. public.card_scheduled_invoices(p_debt) → uma linha por fatura futura com itens agendados: rótulo AAAA-MM do
--    fechamento, fechamento, vencimento, total (somado no banco) e quantidade. SECURITY INVOKER (RLS da tabela vale).
--
-- O que NÃO muda nesta etapa: limite, saldo da dívida, card_months, projeção, Dinheiro Livre e Orçamentos. Os itens ainda
-- não são somados em lugar nenhum além desta leitura; os "previstos" (private.card_recurrence_pending) continuam sendo a
-- fonte desses cálculos, então nada é contado duas vezes. A conversão em parcela no fechamento da fatura anterior (que
-- muda o limite) é a etapa 3.

create function public.card_scheduled_sync() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_h uuid := private.current_household();
  v_today date := private.today_sp();
  v_until date := (date_trunc('month', v_today) + interval '13 months - 1 day')::date;
  v_n integer := 0; v_rows integer;
begin
  if (select auth.uid()) is null or v_h is null then
    raise exception 'não autenticado ou sem família' using errcode = '42501';
  end if;

  -- o que a regra pede hoje: cada ocorrência futura ainda não lançada no cartão
  create temporary table if not exists pg_temp.card_scheduled_wanted (
    recurrence_id uuid, occurrence_date date, debt_id uuid, closing_date date,
    amount numeric, description text, category_id uuid
  ) on commit drop;
  truncate pg_temp.card_scheduled_wanted;
  insert into pg_temp.card_scheduled_wanted
  select r.id, o.occ, r.debt_id, private.card_cycle_first(d, o.occ), r.amount, r.description, r.category_id
    from public.recurrences r
    join public.debts d on d.household_id = r.household_id and d.id = r.debt_id
   cross join lateral private.recurrence_occurrences(r, v_today + 1, v_until) o(occ)
   where r.household_id = v_h and r.kind = 'card' and r.active and d.closing_day is not null
     and o.occ > d.reference_date
     and not exists (select 1 from public.debt_installments i
                      where i.recurrence_id = r.id and i.occurrence_date = o.occ);

  delete from public.card_scheduled_items s
   where s.household_id = v_h and s.status = 'scheduled' and not s.edited
     and not exists (select 1 from pg_temp.card_scheduled_wanted w
                      where w.recurrence_id = s.recurrence_id and w.occurrence_date = s.occurrence_date);
  get diagnostics v_rows = row_count;
  v_n := v_n + v_rows;

  update public.card_scheduled_items s
     set amount = w.amount, description = w.description, category_id = w.category_id,
         closing_date = w.closing_date, charge_date = w.occurrence_date, updated_at = now()
    from pg_temp.card_scheduled_wanted w
   where s.household_id = v_h and s.recurrence_id = w.recurrence_id and s.occurrence_date = w.occurrence_date
     and s.status = 'scheduled' and not s.edited
     and (s.amount, s.description, s.category_id, s.closing_date, s.charge_date)
         is distinct from (w.amount, w.description, w.category_id, w.closing_date, w.occurrence_date);
  get diagnostics v_rows = row_count;
  v_n := v_n + v_rows;

  insert into public.card_scheduled_items (household_id, debt_id, recurrence_id, occurrence_date, charge_date,
                                           closing_date, amount, description, category_id)
  select v_h, w.debt_id, w.recurrence_id, w.occurrence_date, w.occurrence_date, w.closing_date,
         w.amount, w.description, w.category_id
    from pg_temp.card_scheduled_wanted w
  on conflict (recurrence_id, occurrence_date) do nothing;
  get diagnostics v_rows = row_count;
  v_n := v_n + v_rows;

  drop table pg_temp.card_scheduled_wanted;
  return v_n;
end $$;

revoke execute on function public.card_scheduled_sync() from public, anon;
grant execute on function public.card_scheduled_sync() to authenticated;

create function public.card_scheduled_invoices(p_debt uuid)
returns table (label text, closing_date date, due_date date, total numeric, items integer)
language sql stable security invoker set search_path = '' as $$
  select to_char(s.closing_date, 'YYYY-MM'), s.closing_date,
         coalesce(max(inv.due_date), private.card_cycle_due(d, s.closing_date)),
         sum(s.amount), count(*)::integer
    from public.card_scheduled_items s
    join public.debts d on d.household_id = s.household_id and d.id = s.debt_id
    left join public.debt_invoices inv
      on inv.household_id = d.household_id and inv.debt_id = d.id and inv.label = to_char(s.closing_date, 'YYYY-MM')
   where s.debt_id = p_debt and s.status = 'scheduled' and d.kind = 'card'
     and (select private.is_member(s.household_id))
   group by s.closing_date, d.id
   order by s.closing_date
$$;

revoke execute on function public.card_scheduled_invoices(uuid) from public, anon;
grant execute on function public.card_scheduled_invoices(uuid) to authenticated;
