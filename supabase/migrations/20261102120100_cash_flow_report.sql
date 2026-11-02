-- Tudo Azul — migration 033: relatório Entradas x Saídas (somente leitura)
--
-- Pedido do dono (02/11/2026), a partir do protótipo de tela: entradas, saídas e saldo do período, agrupados por
-- dia, semana ou mês, com o acumulado, filtrando por conta e por membro e escolhendo se os não pagos entram.
--
-- Nenhuma tabela é alterada. SECURITY INVOKER: a RLS do chamador decide; quem não é membro recebe zero linhas.
-- Mesma definição de receita/despesa do period_summary (migration 002/003):
--   transações de receita e despesa fora da lixeira (transferência não entra)
--   + cobranças de parcela de cartão, − estornos, + juros e tarifas de dívida (debt_events não anulados).
-- total_income/total_expense repetem, em toda linha, a soma do período inteiro (o front não soma dinheiro).
-- Invariante (testada em pgTAP): sem filtro e sem planejados, a soma bate com period_summary.
--
-- Filtros, e o que cada um alcança (a tela repete isto):
--   p_accounts  só o que tem conta: transações e juros/tarifas. Cobrança e estorno de cartão e parcelas a vencer NÃO têm
--               conta e ficam de fora quando se filtra por conta.
--   p_member    quem lançou (created_by). Parcelas a vencer não têm autor e ficam de fora quando se filtra por membro.
--   p_include_planned  inclui lançamentos planejados e o que falta cobrar das parcelas de cartão que vencem no período
--               (mesma regra do planejado do period_summary), no dia do vencimento.
-- Códigos de erro: 22023 passo inválido, período invertido ou grande demais.

create function public.cash_flow_report(
  p_household uuid, p_from date, p_to date, p_step text default 'day',
  p_accounts uuid[] default null, p_member uuid default null, p_include_planned boolean default false)
returns table (period_start date, income numeric, expense numeric, balance numeric, cumulative numeric,
               total_income numeric, total_expense numeric)
language plpgsql stable security invoker set search_path = '' as $$
begin
  if p_step not in ('day', 'week', 'month') then
    raise exception 'passo inválido: use day, week ou month' using errcode = '22023';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 3660 or (p_step = 'day' and p_to - p_from > 366) then
    raise exception 'período inválido (dia: até 366 dias; semana e mês: até 10 anos)' using errcode = '22023';
  end if;
  return query
  with itens as (
    select t.date as dia, t.type as tipo, t.amount as valor
      from public.transactions t
     where t.household_id = p_household and t.deleted_at is null and t.type in ('income', 'expense')
       and t.date between p_from and p_to
       and (t.status = 'paid' or (p_include_planned and t.status = 'planned'))
       and (p_accounts is null or t.account_id = any(p_accounts))
       and (p_member is null or t.created_by = p_member)
    union all
    select e.date, 'expense', case when e.kind = 'credit' then -e.amount else e.amount end
      from public.debt_events e
     where e.household_id = p_household and e.voided_at is null
       and e.kind in ('charge', 'credit', 'interest', 'fee') and e.date between p_from and p_to
       and (p_accounts is null or e.account_id = any(p_accounts))
       and (p_member is null or e.created_by = p_member)
    union all
    select i.due_date, 'expense',
           i.face - coalesce((select sum(e.amount) from public.debt_events e
                               where e.installment_id = i.id and e.kind in ('charge', 'cancel') and e.voided_at is null), 0)
      from public.debt_installments i
     where p_include_planned and p_accounts is null and p_member is null
       and i.household_id = p_household and i.due_date between p_from and p_to
  ), baldes as (
    select (case p_step when 'day' then g::date when 'week' then date_trunc('week', g)::date
                        else date_trunc('month', g)::date end) as inicio
      from generate_series(p_from::timestamp, p_to::timestamp,
                           case p_step when 'day' then interval '1 day' when 'week' then interval '1 week'
                                       else interval '1 month' end) g
  ), unicos as (
    select distinct b.inicio from baldes b
    union
    select (case p_step when 'day' then p_to when 'week' then date_trunc('week', p_to)::date
                        else date_trunc('month', p_to)::date end)
  ), somas as (
    select u.inicio,
           coalesce(sum(x.valor) filter (where x.tipo = 'income'), 0) as entrada,
           coalesce(sum(x.valor) filter (where x.tipo = 'expense'), 0) as saida
      from unicos u
      left join itens x on (case p_step when 'day' then x.dia when 'week' then date_trunc('week', x.dia)::date
                                        else date_trunc('month', x.dia)::date end) = u.inicio
     group by u.inicio
  )
  select s.inicio, s.entrada, s.saida, s.entrada - s.saida,
         sum(s.entrada - s.saida) over (order by s.inicio),
         sum(s.entrada) over (), sum(s.saida) over ()
    from somas s
   where (select private.is_member(p_household))
   order by s.inicio;
end $$;

revoke execute on function public.cash_flow_report(uuid, date, date, text, uuid[], uuid, boolean) from public, anon;
grant execute on function public.cash_flow_report(uuid, date, date, text, uuid[], uuid, boolean) to authenticated;
