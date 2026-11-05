-- Tudo Azul — migration 058: valores da aba Cartões (três achados da análise de 05/11/2026).
--
-- 1. Assinatura de cartão fora da fatura aberta. A recorrência de cartão só vira parcela no dia da cobrança
--    (recurrence_materialize, migration 022: least(v_today, …)), então a fatura aberta mostrada (card_months, e por ela
--    card_invoices_month no Início) fica menor do que vai fechar. A projeção do mês já somava isso por
--    private.card_recurrence_pending (migrations 015/017). Correção sem mexer na fatura "real" (card_months continua
--    sendo só o que foi parcelado/cobrado):
--      * private.card_recurrence_pending ganha as colunas debt_id, occurrence_date e closing_date no FIM do retorno
--        (drop + create: muda o tipo de retorno; quem a chama — month_projection e budget_projection — lê por nome
--        category_id e amount e não muda). A regra é a mesma da migration 017, que já trata frequência mensal, semanal
--        e em dias (private.recurrence_occurrences, migration 048) e o mesmo fechamento de recurrence_materialize
--        (private.card_first_closing com o dia de fechamento atual do cartão);
--      * public.card_pending_subscriptions(p_household, p_as_of): por cartão, a fatura ABERTA em p_as_of (a que fecha
--        no próximo fechamento; no dia do fechamento já é a seguinte, mesma regra da compra), o vencimento dela e o
--        total das assinaturas previstas que ainda não viraram parcela e caem nela. Só aparece cartão com valor > 0.
--        A tela usa para "inclui R$ X de assinaturas previstas"; o front não soma.
-- 2. Pagamento de cartão com data futura. debt_pay aceitava data futura: debt_balances conta só até a data pedida
--    (hoje) e card_months conta todos os pagamentos, então a fatura aparecia "Paga" na lista enquanto o destaque ainda
--    cobrava. Regra nova: pagamento de CARTÃO (payment ou extra_principal) não pode ter data depois de hoje em São Paulo.
--    Vale para toda gravação (trigger BEFORE INSERT em debt_events): debt_pay e debt_anticipate. Evento é imutável
--    (debt_events_guard), então não há edição a cobrir. Empréstimo e financiamento continuam aceitando data futura.
--    Eventos já gravados não são tocados (o trigger só olha INSERT).
-- 3. card_items não descontava estorno nem cancelamento parcial: mostrava i.face, enquanto card_months desconta
--    'credit' e 'cancel'; e plan_count contava parcelas canceladas (compra encurtada mostrava "3/10"). Agora a coluna
--    face devolve o valor LÍQUIDO da parcela (face − cancelado − estornado) — a soma dos itens bate com o total da
--    fatura (sem os créditos avulsos, que não são item) — e plan_count conta só as parcelas vivas (cancelado < face).
--    create or replace a partir da migration 20261017135000 (última versão; 051/052 não a redefiniram), mesmas colunas.
--
-- Teste: 58_card_value_fixes (falha sem esta migration).

-- ---------------------------------------------------------------------------
-- 1. Assinaturas previstas
-- ---------------------------------------------------------------------------
drop function private.card_recurrence_pending(uuid, date, date);

-- Ocorrências de recorrência de CARTÃO ainda sem parcela cuja fatura fecha dentro de [p_first, p_last].
-- Candidatas: do 1º dia do mês anterior a p_first até p_last (a fatura de um mês pega compras do mês anterior).
-- Corpo igual ao da migration 20261028140100; só acrescenta as colunas debt_id, occurrence_date e closing_date.
create function private.card_recurrence_pending(p_household uuid, p_first date, p_last date)
returns table (category_id uuid, amount numeric, debt_id uuid, occurrence_date date, closing_date date)
language sql stable security invoker set search_path = '' as $$
  select r.category_id, r.amount, r.debt_id, o.occ, c.fecha
    from public.recurrences r
    join public.debts d on d.household_id = r.household_id and d.id = r.debt_id
   cross join lateral private.recurrence_occurrences(r, (date_trunc('month', p_first) - interval '1 month')::date, p_last) o(occ)
   cross join lateral (
     select make_date(extract(year from o.occ)::int, extract(month from o.occ)::int,
                      least(d.closing_day, extract(day from (date_trunc('month', o.occ) + interval '1 month - 1 day'))::int)) as fecha_mes,
            (date_trunc('month', o.occ) + interval '1 month')::date as prox
   ) f
   cross join lateral (
     select case when o.occ < f.fecha_mes then f.fecha_mes
                 else make_date(extract(year from f.prox)::int, extract(month from f.prox)::int,
                                least(d.closing_day, extract(day from (f.prox + interval '1 month - 1 day'))::int)) end as fecha
   ) c
   where r.household_id = p_household and r.kind = 'card' and r.active and d.closing_day is not null
     and o.occ > d.reference_date
     and c.fecha between p_first and p_last
     and not exists (select 1 from public.debt_installments i
                      where i.recurrence_id = r.id and i.occurrence_date = o.occ)
$$;

revoke execute on function private.card_recurrence_pending(uuid, date, date) from public, anon;
grant execute on function private.card_recurrence_pending(uuid, date, date) to authenticated;

-- Por cartão: fatura aberta em p_as_of e o que as assinaturas previstas (ainda sem parcela) vão somar nela.
-- Fechamento e vencimento escritos aqui (como em card_months) porque a função roda como o chamador e as funções puras
-- do calendário (private.card_first_closing, private.card_due_date) não são executáveis por authenticated.
-- Vencimento: o da fatura, se já existe (debt_invoices); senão o calculado pelo ciclo atual do cartão.
create function public.card_pending_subscriptions(p_household uuid, p_as_of date)
returns table (debt_id uuid, closing_date date, due_date date, total numeric)
language sql stable security invoker set search_path = '' as $$
  select d.id, a.fecha, coalesce(inv.due_date, v.vence), s.total
    from public.debts d
   cross join lateral (
     select make_date(extract(year from p_as_of)::int, extract(month from p_as_of)::int,
                      least(d.closing_day, extract(day from (date_trunc('month', p_as_of) + interval '1 month - 1 day'))::int)) as fecha_mes,
            (date_trunc('month', p_as_of) + interval '1 month')::date as prox
   ) f
   cross join lateral (
     -- no dia do fechamento ou depois, a aberta é a seguinte (private.card_first_closing)
     select case when p_as_of < f.fecha_mes then f.fecha_mes
                 else make_date(extract(year from f.prox)::int, extract(month from f.prox)::int,
                                least(d.closing_day, extract(day from (f.prox + interval '1 month - 1 day'))::int)) end as fecha
   ) a
   cross join lateral (
     -- vence depois do fechamento no calendário (fecha 17, vence 25): mesmo mês; senão, mês seguinte (private.card_due_date)
     select (date_trunc('month', a.fecha) + case when d.due_day > d.closing_day then interval '0' else interval '1 month' end)::date as b
   ) vb
   cross join lateral (
     select make_date(extract(year from vb.b)::int, extract(month from vb.b)::int,
                      least(d.due_day, extract(day from (vb.b + interval '1 month - 1 day'))::int)) as vence
   ) v
   cross join lateral (
     select sum(x.amount) as total
       from private.card_recurrence_pending(p_household, a.fecha, a.fecha) x
      where x.debt_id = d.id
   ) s
    left join public.debt_invoices inv
      on inv.household_id = d.household_id and inv.debt_id = d.id and inv.label = to_char(a.fecha, 'YYYY-MM')
   where d.household_id = p_household and d.kind = 'card' and d.closing_day is not null and d.due_day is not null
     and p_as_of is not null and s.total > 0
     and (select private.is_member(p_household))
   order by d.name, d.id
$$;

revoke execute on function public.card_pending_subscriptions(uuid, date) from public, anon;
grant execute on function public.card_pending_subscriptions(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Pagamento de cartão sem data futura
-- ---------------------------------------------------------------------------
create function private.debt_events_card_payment_date() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare v_hoje date := private.today_sp();
begin
  if new.kind in ('payment', 'extra_principal') and new.date > v_hoje
     and exists (select 1 from public.debts d
                  where d.household_id = new.household_id and d.id = new.debt_id and d.kind = 'card') then
    raise exception 'o pagamento do cartão não pode ter data futura (%): registre no dia em que o dinheiro sair da conta (hoje é %)',
      new.date, v_hoje using errcode = '22023';
  end if;
  return new;
end $$;

revoke execute on function private.debt_events_card_payment_date() from public, anon, authenticated;

create trigger debt_events_card_payment_date before insert on public.debt_events
  for each row execute function private.debt_events_card_payment_date();

-- ---------------------------------------------------------------------------
-- 3. Itens da fatura líquidos e só parcelas vivas no "n de N"
-- ---------------------------------------------------------------------------
-- Parcela totalmente cancelada (compra excluída) não aparece (como antes). face = valor líquido da parcela
-- (face − cancelado − estornado), o mesmo que card_months soma; remaining = o que falta cobrar (sem mudança).
create or replace function public.card_items(p_debt uuid, p_label text)
returns table (installment_id uuid, plan text, seq integer, plan_count integer, description text,
               purchase_date date, closing_date date, face numeric, remaining numeric, category_id uuid)
language sql stable security invoker set search_path = '' as $$
  select i.id, i.plan, i.seq,
         (select count(*)::int from public.debt_installments x
           where x.debt_id = i.debt_id and x.plan = i.plan
             and coalesce((select sum(e.amount) from public.debt_events e
                            where e.installment_id = x.id and e.voided_at is null and e.kind = 'cancel'), 0) < x.face),
         i.description, i.purchase_date, i.due_date,
         i.face - coalesce((select sum(e.amount) from public.debt_events e
                             where e.installment_id = i.id and e.voided_at is null
                               and e.kind in ('cancel', 'credit')), 0),
         i.face - coalesce((select sum(e.amount) from public.debt_events e
                             where e.installment_id = i.id and e.voided_at is null
                               and e.kind in ('charge', 'cancel')), 0),
         i.category_id
    from public.debt_installments i
   where i.debt_id = p_debt and to_char(i.due_date, 'YYYY-MM') = p_label
     and (select private.is_member(i.household_id))
     and coalesce((select sum(e.amount) from public.debt_events e
                    where e.installment_id = i.id and e.voided_at is null and e.kind = 'cancel'), 0) < i.face
   order by i.purchase_date nulls first, i.description, i.seq
$$;
