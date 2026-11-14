-- Linha do tempo das parcelas (Recorrentes › Parcelas): cada parcela viva de cada parcelamento ATIVO, mês a mês,
-- com a situação dela (paga, em atraso ou a vencer) e, no cartão, o rótulo da fatura onde ela está (para o link).
--
-- Leitura pura (STABLE, SECURITY INVOKER), no padrão de active_installment_plans (20261112130000): confere a família com
-- private.is_member e a RLS decide o resto. As definições de "parcelamento ativo", "parcela viva" e "parcela paga" são
-- AS MESMAS daquela função (o corpo é repetido até a lista de planos ativos: migration aplicada não se edita; o teste 115
-- confere as duas funções entre si). Só planos ativos aparecem; parcela cancelada ou estornada inteira não aparece.
--
-- Colunas:
--   plan_key       a mesma chave de active_installment_plans (liga a linha ao card do parcelamento)
--   installment_number posição entre as parcelas vivas (1 a N), a mesma numeração do "Parcela n de N"
--   due_date       cartão: o VENCIMENTO da fatura; conta: a data do lançamento (pode ser nulo se o cartão não tiver essa fatura)
--   amount         valor líquido da parcela (numeric de 2 casas; a tela converte para centavos e não soma)
--   invoice_label  cartão: o rótulo da fatura (AAAA-MM) que a tela de Cartões abre; conta: nulo
--   state          'paid' (paga), 'overdue' (não paga e vencida antes de p_as_of) ou 'open' (não paga, ainda a vencer)
--   in_month       true quando vence no mês de p_as_of (a "parcela do mês")
-- Moedas nunca se misturam: cartão é sempre BRL; parcela em conta usa a moeda da conta.

create function public.installment_plan_schedule(p_household uuid, p_as_of date default null)
returns table (
  plan_key text,
  currency_code text,
  source_type text,
  source_id uuid,
  installment_number integer,
  due_date date,
  amount numeric,
  invoice_label text,
  state text,
  in_month boolean
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
  select p.chave, p.moeda, p.origem, p.origem_id, p.pos::integer, p.vencimento, p.liquido, p.rotulo_fatura,
         case when p.paga then 'paid' when p.vencimento < v_as_of then 'overdue' else 'open' end,
         p.no_mes
    from planos p
   order by p.chave, p.pos;
end
$function$;

revoke execute on function public.installment_plan_schedule(uuid, date) from public, anon;
grant execute on function public.installment_plan_schedule(uuid, date) to authenticated;
