-- Resumo do mês dos parcelamentos (card "Parcelas & carnês"): a MESMA função da 120, agora numa passada só.
--
-- A versão da 120 (20261114140000) juntava public.active_installment_plans e public.installment_plan_schedule, e cada uma
-- recalcula as faturas de todos os cartões (private.card_months_as_of): medido em produção em 14/11/2026, ~0,4 s cada, ~0,8 s no
-- resumo (e a matriz e as abas de Parcelas pagam o mesmo custo por conta própria). Esta versão calcula as parcelas UMA vez e
-- tira dali os dois recortes: os parcelamentos ativos (descrição, valor da parcela atual) e as parcelas que vencem no mês.
--
-- Nada muda no resultado: mesma assinatura (create or replace), mesmas colunas, mesmas regras (o corpo repete a base de
-- installment_plan_schedule até a lista de planos ativos: migration aplicada não se edita; o teste 116, que já existia, confere
-- esta função contra as duas funções-base, M7 e M8). Só leitura, SECURITY INVOKER; as permissões da 120 ficam como estão.
-- atalho: o corpo repete a base de installment_plan_schedule e active_installment_plans; se a regra de "ativo", "viva" ou "paga"
-- mudar, as três precisam mudar juntas (o teste 116 acusa a divergência).
--
-- Colunas (as mesmas da 120), uma linha por moeda: active_count, month_count, month_total, paid_total, pending_total, examples.
-- Erros: 22023 sem família. Sem parcelamento ativo não há linha.

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
  no_mes as (
    select p.chave, p.moeda, p.liquido, p.paga from planos p where p.no_mes
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
  select g.moeda,
         count(*)::integer,
         coalesce(max(mm.qtde), 0),
         coalesce(max(mm.total), 0),
         coalesce(max(mm.pago), 0),
         coalesce(max(mm.falta), 0),
         (array_agg(g.descricao order by g.parcela desc nulls last, g.descricao))[1:3]
    from por_plano g
    left join mes_por_moeda mm on mm.moeda = g.moeda
   group by g.moeda
   order by g.moeda;
end
$function$;

revoke execute on function public.installment_month_summary(uuid, date) from public, anon;
grant execute on function public.installment_month_summary(uuid, date) to authenticated;
