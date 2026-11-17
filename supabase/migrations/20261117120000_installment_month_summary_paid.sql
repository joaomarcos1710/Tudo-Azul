-- Tudo Azul — migration 142: o resumo do mês dos parcelamentos passa a contar o parcelamento QUITADO que tem parcela no mês.
--
-- Achado do revisor de dinheiro na #427 (17/11/2026): em installment_month_summary (migrations 120/121) o plano inteiro era descartado
-- quando todas as parcelas estavam pagas (`planos` exigia `tem_nao_paga`), inclusive a parcela que vence no mês. O efeito: no mês em
-- que a ÚLTIMA parcela de uma compra parcelada ou carnê é paga, o valor dela sumia do "parcelas do mês" (o total caía de repente
-- ao marcar como paga) e, se era o único parcelamento, a linha da moeda deixava de existir. Isso afetava o card "Parcelas e carnês"
-- e, com a migration 141, a "sobra deste mês depois das parcelas".
--
-- O que muda (mesma assinatura, mesmas colunas; migration aplicada não se edita, então esta recria a função):
--   * month_total, paid_total, pending_total e month_count (parcelas que vencem no mês) vêm de TODOS os parcelamentos de 2 ou mais
--     parcelas (`marcadas`), pagos ou não: parcela paga continua sendo parcela do mês;
--   * active_count e examples continuam sendo só dos planos ativos (com parcela por pagar), como antes;
--   * uma moeda que só tem parcelamento quitado neste mês ganha a linha (active_count 0), em vez de não ter linha nenhuma.
-- Nada mais muda: SECURITY INVOKER, só leitura, mesmas permissões da 120. As funções-base (active_installment_plans e
-- installment_plan_schedule) não mudam: o teste 116, que conferia este resumo contra elas, acompanha (ver o teste 134).
-- Teste: 134_installment_month_paid (falha sem esta migration).

create or replace function public.installment_month_summary(p_household uuid, p_as_of date default null)
returns table (
  currency_code text,
  active_count integer,
  month_count integer,
  month_total numeric,
  paid_total numeric,
  pending_total numeric,
  examples text[]
)
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_as_of date;
  v_month date;
begin
  if p_household is null then
    raise exception 'parâmetros inválidos: informe a família' using errcode = '22023';
  end if;
  if not (select private.is_member(p_household)) then
    return;
  end if;

  v_as_of := coalesce(p_as_of, (now() at time zone 'America/Sao_Paulo')::date);
  v_month := date_trunc('month', v_as_of::timestamp)::date;

  return query
  with
  cartoes as (
    select d.id, d.name
      from public.debts d
     where d.household_id = p_household and d.kind = 'card'
       and exists (select 1 from public.debt_installments i where i.household_id = d.household_id and i.debt_id = d.id)
  ),
  -- a conta oficial das faturas (a mesma da tela Cartões), uma vez por cartão
  faturas as materialized (
    select c.id as cartao_id, m.label, m.due_date as vencimento, (m.paid >= m.total) as fatura_paga
      from cartoes c
      cross join lateral private.card_months_as_of(c.id, v_as_of) m
  ),
  abatido as (
    select e.installment_id, sum(e.amount) as valor
      from public.debt_events e
     where e.household_id = p_household and e.voided_at is null and e.date <= v_as_of
       and e.kind in ('cancel', 'credit') and e.installment_id is not null
     group by e.installment_id
  ),
  parcelas_cartao as (
    select 'card'::text as origem, 'BRL'::text as moeda,
           'card:' || i.debt_id::text || ':' || i.plan as chave,
           coalesce(nullif(btrim(i.description), ''), 'Compra parcelada') as descricao,
           i.debt_id as origem_id, c.name as origem_nome,
           i.seq::integer as num, i.due_date as ordem_data,
           i.face - coalesce(a.valor, 0) as liquido,
           f.vencimento,
           (i.due_date <= v_as_of and coalesce(f.fatura_paga, false)) as paga,
           (i.due_date > v_as_of) as ainda_nao_fechou,
           f.label as rotulo_fatura
      from public.debt_installments i
      join cartoes c on c.id = i.debt_id
      left join abatido a on a.installment_id = i.id
      left join faturas f on f.cartao_id = i.debt_id and f.label = to_char(i.due_date, 'YYYY-MM')
     where i.household_id = p_household
       and i.face - coalesce(a.valor, 0) > 0
  ),
  parcelas_conta as (
    select 'account'::text, ac.currency_code,
           'account:' || t.installment_group::text,
           coalesce(nullif(btrim(regexp_replace(t.description, '\s+[0-9]+/[0-9]+$', '')), ''), 'Parcelamento'),
           t.account_id, ac.name,
           t.installment_number::integer, t.date,
           t.amount,
           t.date,
           (t.status = 'paid'),
           (t.date > v_as_of),
           null::text
      from public.transactions t
      join public.accounts ac on ac.household_id = t.household_id and ac.id = t.account_id
     where t.household_id = p_household and t.installment_group is not null
       and t.type = 'expense' and t.deleted_at is null
  ),
  todas as (
    select * from parcelas_cartao union all select * from parcelas_conta
  ),
  marcadas as (
    select t.*,
           row_number() over (partition by t.chave order by t.num, t.ordem_data) as pos,
           count(*) over (partition by t.chave) as n,
           bool_or(not t.paga) over (partition by t.chave) as tem_nao_paga,
           coalesce(t.vencimento >= v_month and t.vencimento < (v_month + interval '1 month')::date, false) as no_mes
      from todas t
  ),
  planos as (
    select * from marcadas m where m.n >= 2 and m.tem_nao_paga
  )
  ,
  -- a parcela ATUAL de cada plano (a que vence no mês; senão a primeira não paga): o "valor da parcela" que ordena os exemplos
  atual as (
    select distinct on (p.chave) p.chave, p.liquido
      from planos p
     order by p.chave, case when p.no_mes then 0 when not p.paga then 1 else 2 end, p.vencimento nulls last, p.num
  ),
  por_plano as (
    select p.chave, p.moeda, max(p.descricao) as descricao, max(a.liquido) as parcela
      from planos p join atual a on a.chave = p.chave
     group by p.chave, p.moeda
  ),
  -- parcela do mês de TODO parcelamento de 2+ parcelas, pago ou não (a quitada continua sendo do mês; achado da #427)
  no_mes as (
    select m.chave, m.moeda, m.liquido, m.paga from marcadas m where m.n >= 2 and m.no_mes
  ),
  mes_por_moeda as (
    select m.moeda,
           count(distinct m.chave)::integer as qtde,
           coalesce(sum(m.liquido), 0) as total,
           coalesce(sum(m.liquido) filter (where m.paga), 0) as pago,
           coalesce(sum(m.liquido) filter (where not m.paga), 0) as falta
      from no_mes m
     group by m.moeda
  )
  , ativos as (
    select g.moeda,
           count(*)::integer as qtde,
           (array_agg(g.descricao order by g.parcela desc nulls last, g.descricao))[1:3] as exemplos
      from por_plano g
     group by g.moeda
  )
  select coalesce(a.moeda, mm.moeda),
         coalesce(a.qtde, 0),
         coalesce(mm.qtde, 0),
         coalesce(mm.total, 0),
         coalesce(mm.pago, 0),
         coalesce(mm.falta, 0),
         coalesce(a.exemplos, array[]::text[])
    from ativos a
    full join mes_por_moeda mm on mm.moeda = a.moeda
   order by 1;
end
$function$;

revoke execute on function public.installment_month_summary(uuid, date) from public, anon;
grant execute on function public.installment_month_summary(uuid, date) to authenticated;
