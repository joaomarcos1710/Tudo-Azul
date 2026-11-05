-- Tudo Azul — migration 065: resumo dos cartões numa chamada só (public.card_overview)
--
-- Pedido do dono (05/11/2026, "pode seguir com os cartões"; pendências #166 e "Desempenho"): a tela de Cartões chamava
-- card_months uma vez por cartão (N+1) só para montar o destaque e o resumo, e o resumo não podia mostrar o limite total,
-- o disponível total nem o valor total das faturas do mês, porque são somas de dinheiro e o front não soma (regra 2).
--
-- public.card_overview(p_household, p_month default null) devolve, por cartão ATIVO da família (arquivado fica fora),
-- uma linha row_kind = 'card' e, no fim, UMA linha row_kind = 'total' com as somas da família.
--
-- Nada de regra nova: tudo é lido das funções que já existem, por dentro, com os mesmos números que a tela via antes.
--   * fatura de um mês e fatura fechada a pagar → public.card_months(cartão) (ciclo de cada mês: cada parcela guarda o
--     próprio ciclo; migration 061). Mês sem linha em card_months (nenhuma parcela nem crédito) = fatura de R$ 0,00, com
--     o fechamento e o vencimento do ciclo daquele mês (private.card_cycle_closing / card_cycle_due, migration 061).
--   * limite, usado e disponível → public.card_limits(família, hoje) (só cartão com limite informado).
--   * assinaturas previstas da fatura atual → public.card_pending_subscriptions(família, hoje) (migrations 058/061, que
--     lê private.card_recurrence_pending): a fatura "real" não muda; current_with_subscriptions = atual + previstas.
--   * "hoje" = data de hoje em São Paulo, calculada inline (private.today_sp não é executável por authenticated).
--   * situação da fatura: mesma regra da tela (situacaoFatura): fechamento depois de hoje = 'aberta'; senão total ≤ 0 ou
--     pago ≥ total = 'paga'; senão 'fechada'. A trava da 064 não muda leitura nenhuma.
--
-- Mês escolhido (p_month): a fatura é identificada pelo mês do FECHAMENTO (o rótulo AAAA-MM, como nas abas da tela).
--   p_month nulo = a fatura atual de cada cartão (a do ciclo em que cai uma compra feita hoje); p_month = qualquer dia do
--   mês → a fatura que fecha naquele mês. As colunas current_* são sempre a fatura atual (o destaque do cartão), qualquer
--   que seja p_month.
--
-- Linha 'total' (as somas saem daqui, nunca da tela): month_total/month_paid = soma das faturas do mês escolhido;
-- current_total, pending_subscriptions e current_with_subscriptions = soma das atuais; oldest_open_remaining = soma do
-- que falta pagar nas fechadas mais antigas; credit_limit/limit_used/limit_available = soma dos cartões COM limite
-- (nulo se nenhum tem). O disponível total pode ser negativo (cartão que passou do limite entra com o negativo dele).
--
-- SECURITY INVOKER + is_member (a RLS do chamador decide), como as irmãs; só authenticated executa.
-- Nenhuma migration anterior é editada. Teste: 65_card_overview.

create function public.card_overview(p_household uuid, p_month date default null)
returns table (row_kind text, debt_id uuid, name text,
               month_label text, month_closing date, month_due date, month_total numeric, month_paid numeric, month_status text,
               current_label text, current_closing date, current_due date, current_total numeric,
               pending_subscriptions numeric, current_with_subscriptions numeric,
               oldest_open_label text, oldest_open_due date, oldest_open_remaining numeric,
               credit_limit numeric, limit_used numeric, limit_available numeric)
language sql stable security invoker set search_path = '' as $$
  with hoje as (
    select (now() at time zone 'America/Sao_Paulo')::date as dia
  ),
  linhas as (
    select d.id, d.name,
           -- fatura do mês escolhido: a linha de card_months, ou R$ 0,00 com as datas do ciclo daquele mês
           x.mes_label,
           coalesce(f.mes_fecha, case when d.closing_day is not null and d.due_day is not null and x.mes_label is not null
                                      then private.card_cycle_closing(d, to_date(x.mes_label || '-01', 'YYYY-MM-DD')) end) as mes_fecha,
           f.mes_venc, coalesce(f.mes_total, 0) as mes_total, coalesce(f.mes_pago, 0) as mes_pago,
           a.atual_label, a.atual_fecha, coalesce(f.atual_venc, case when a.atual_fecha is not null then private.card_cycle_due(d, a.atual_fecha) end) as atual_venc,
           coalesce(f.atual_total, 0) as atual_total,
           coalesce(s.total, 0) as previstas,
           f.velha_label, f.velha_venc, f.velha_falta,
           l.credit_limit, l.committed, l.available,
           d
      from public.debts d
      cross join hoje h
      -- fatura atual: a do ciclo em que cai uma compra feita hoje (mesma regra da compra, private.card_cycle_first)
      cross join lateral (
        select to_char(z.fecha, 'YYYY-MM') as atual_label, z.fecha as atual_fecha
          from (select case when d.closing_day is not null and d.due_day is not null
                            then private.card_cycle_first(d, h.dia) end as fecha) z
      ) a
      cross join lateral (
        select case when p_month is null then a.atual_label else to_char(p_month, 'YYYY-MM') end as mes_label
      ) x
      -- uma leitura de card_months por cartão, dentro desta chamada (antes era uma chamada da tela por cartão)
      cross join lateral (
        select max(m.closing_date) filter (where m.label = x.mes_label) as mes_fecha,
               max(m.due_date)     filter (where m.label = x.mes_label) as mes_venc,
               max(m.total)        filter (where m.label = x.mes_label) as mes_total,
               max(m.paid)         filter (where m.label = x.mes_label) as mes_pago,
               max(m.due_date)     filter (where m.label = a.atual_label) as atual_venc,
               max(m.total)        filter (where m.label = a.atual_label) as atual_total,
               -- fechada a pagar mais antiga: fechamento até hoje e pago < total (situação 'fechada')
               (array_agg(m.label order by m.label)    filter (where m.closing_date <= h.dia and m.total > 0 and m.paid < m.total))[1] as velha_label,
               (array_agg(m.due_date order by m.label) filter (where m.closing_date <= h.dia and m.total > 0 and m.paid < m.total))[1] as velha_venc,
               (array_agg(m.total - m.paid order by m.label) filter (where m.closing_date <= h.dia and m.total > 0 and m.paid < m.total))[1] as velha_falta
          from public.card_months(d.id) m
      ) f
      left join public.card_limits(p_household, (select hoje.dia from hoje)) l on l.debt_id = d.id
      left join public.card_pending_subscriptions(p_household, (select hoje.dia from hoje)) s on s.debt_id = d.id
     where d.household_id = p_household and d.kind = 'card' and d.active
       and (select private.is_member(p_household))
  ),
  cartoes as (
    select 'card'::text as row_kind, l.id as debt_id, l.name,
           l.mes_label as month_label, l.mes_fecha as month_closing,
           coalesce(l.mes_venc, case when l.mes_fecha is not null then private.card_cycle_due(l.d, l.mes_fecha) end) as month_due,
           l.mes_total as month_total, l.mes_pago as month_paid,
           case when l.mes_fecha is null then null
                when l.mes_fecha > (select hoje.dia from hoje) then 'aberta'
                when l.mes_total <= 0 or l.mes_pago >= l.mes_total then 'paga'
                else 'fechada' end as month_status,
           l.atual_label as current_label, l.atual_fecha as current_closing, l.atual_venc as current_due,
           l.atual_total as current_total, l.previstas as pending_subscriptions,
           l.atual_total + l.previstas as current_with_subscriptions,
           l.velha_label as oldest_open_label, l.velha_venc as oldest_open_due, coalesce(l.velha_falta, 0) as oldest_open_remaining,
           l.credit_limit, l.committed as limit_used, l.available as limit_available
      from linhas l
  )
  select * from (
    select c.* from cartoes c
    union all
    -- totais da família: somas das linhas acima (aparece mesmo sem cartão, com zeros, para quem é da família;
    -- HAVING e não WHERE: agregado sem GROUP BY devolve uma linha mesmo sem nenhuma, e quem não é da família não pode vê-la)
    select 'total', null, null,
           case when p_month is null then null else to_char(p_month, 'YYYY-MM') end, null, null,
           coalesce(sum(c.month_total), 0), coalesce(sum(c.month_paid), 0), null,
           null, null, null, coalesce(sum(c.current_total), 0),
           coalesce(sum(c.pending_subscriptions), 0), coalesce(sum(c.current_with_subscriptions), 0),
           null, null, coalesce(sum(c.oldest_open_remaining), 0),
           sum(c.credit_limit), sum(c.limit_used), sum(c.limit_available)
      from cartoes c
    having (select private.is_member(p_household))
  ) t
  order by (t.row_kind = 'total'), t.name, t.debt_id
$$;

revoke execute on function public.card_overview(uuid, date) from public, anon;
grant execute on function public.card_overview(uuid, date) to authenticated;
