-- Tudo Azul — migration 147: saldo diário de Lançamentos numa passada só.
--
-- Problema (dono, 21/11/2026, no iPhone: "Não foi possível carregar: saldo diário"): public.account_balances_daily
-- (migration 20261107190000) chamava public.account_balances uma vez por dia do período. Cada chamada relê todos os
-- lançamentos pagos e eventos de dívida da família desde a abertura de cada conta: 30 dias = 30 leituras completas.
-- Medido em produção em 21/11/2026: 3,6 s para 20/11–19/12 e 3,2 s para novembro; junto com as outras consultas que
-- Lançamentos faz ao abrir, passava do tempo limite e o bloco aparecia como erro.
--
-- Correção: mesma assinatura, mesmo resultado, SECURITY INVOKER e mesmos grants (00_audit não muda). Os movimentos
-- (lançamentos pagos e eventos de dívida com conta) são lidos UMA vez até p_to; o saldo de cada conta em cada dia é o
-- saldo inicial + tudo até o dia anterior ao período + o acumulado dentro do período. As regras são as de
-- public.account_balances (corpo em vigor: 20261110090000_investment_portfolio_account.sql), escritas aqui de novo:
--   * conta da família, sem system_role (a Carteira interna fica de fora), com abertura até o dia;
--   * lançamento pago, fora da lixeira, com data a partir da abertura da conta: receita soma, despesa e transferência de
--     saída subtraem, transferência de entrada soma (a transferência nunca tem origem = destino: check do core_schema);
--   * evento de dívida não anulado, com data a partir da abertura: disbursement e refund_cash somam, os outros subtraem.
-- Teste: 141_account_balances_daily_one_pass (compara, dia a dia, com public.account_balances).

create or replace function public.account_balances_daily(p_household uuid, p_from date, p_to date)
returns table(balance_date date, currency_code text, balance numeric)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_household is null or p_from is null or p_to is null or p_to < p_from or (p_to - p_from) > 366 then
    raise exception 'Informe um intervalo válido de até 367 dias.' using errcode = '22023';
  end if;
  if not private.is_member(p_household) then
    raise exception 'Você não participa desta família.' using errcode = '42501';
  end if;
  return query
  with contas as (
    select a.id, a.currency_code as moeda, a.opening_date, a.initial_balance
      from public.accounts a
     where a.household_id = p_household and a.system_role is null and a.opening_date <= p_to
  ), mov as (
    select t.account_id as conta, t.date as dia,
           case when t.type = 'income' then t.amount else -t.amount end as valor
      from public.transactions t
      join contas c on c.id = t.account_id
     where t.household_id = p_household and t.deleted_at is null and t.status = 'paid'
       and t.type in ('income', 'expense', 'transfer') and t.date >= c.opening_date and t.date <= p_to
    union all
    select t.destination_account_id, t.date, t.amount
      from public.transactions t
      join contas c on c.id = t.destination_account_id
     where t.household_id = p_household and t.deleted_at is null and t.status = 'paid'
       and t.type = 'transfer' and t.date >= c.opening_date and t.date <= p_to
    union all
    select e.account_id, e.date,
           case when e.kind in ('disbursement', 'refund_cash') then e.amount else -e.amount end
      from public.debt_events e
      join contas c on c.id = e.account_id
     where e.household_id = p_household and e.voided_at is null and e.date >= c.opening_date and e.date <= p_to
  ), antes as (
    select m.conta, sum(m.valor) as v from mov m where m.dia < p_from group by m.conta
  ), no_periodo as (
    select m.conta, m.dia, sum(m.valor) as v from mov m where m.dia >= p_from group by m.conta, m.dia
  ), dias as (
    select g::date as dia from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g
  ), grade as (
    select d.dia, c.moeda,
           c.initial_balance + coalesce(a.v, 0)
             + coalesce((select sum(n.v) from no_periodo n where n.conta = c.id and n.dia <= d.dia), 0) as saldo
      from dias d
      join contas c on c.opening_date <= d.dia
      left join antes a on a.conta = c.id
  )
  select g.dia, g.moeda, sum(g.saldo)::numeric
    from grade g
   group by g.dia, g.moeda
   order by g.dia, g.moeda;
end;
$$;
revoke all on function public.account_balances_daily(uuid, date, date) from public, anon;
grant execute on function public.account_balances_daily(uuid, date, date) to authenticated;
