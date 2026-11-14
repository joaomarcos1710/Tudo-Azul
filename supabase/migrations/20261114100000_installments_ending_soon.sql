-- Tudo Azul — migration 118: parcelamentos que terminam em breve ("liberando R$ X por mês") — somente leitura
--
-- Pedido do dono (14/11/2026), a partir da análise da tela de Parcelas ativas: um aviso no topo — "3 parcelamentos terminam nos
-- próximos 60 dias, liberando R$ 661,54 por mês". É soma de dinheiro, então vem do banco (o front não soma).
--
-- Mesma definição de parcelamento ATIVO e de parcela PAGA de public.active_installment_plans (migration 20261112130000): cartão
-- (compra parcelada; fatura fechada e paga) e conta (despesa parcelada fora da lixeira); parcela viva = valor líquido > 0;
-- ativo = 2 ou mais parcelas vivas e ao menos uma não paga. O corpo daquela função é repetido aqui só até a lista de planos ativos
-- (migration aplicada não se edita, e um ajudante comum exigiria mexer nela); o teste 114 confere as duas funções entre si.
--
-- "TERMINA EM BREVE": a ÚLTIMA parcela viva vence entre a data de referência e a data de referência + p_days (os dois dias
-- entram). Vencimento do cartão = o da fatura da parcela (quando o dinheiro sai); conta = a data do lançamento. Plano cuja última
-- parcela já venceu e não foi paga (atraso) NÃO conta: o dinheiro ainda não foi liberado.
-- "LIBERA POR MÊS": o valor líquido da última parcela viva de cada plano (a sobra de centavos de uma divisão cai na primeira
-- parcela, então a última é o valor-base). Soma por moeda; moedas nunca se misturam (cartão é sempre BRL).
--
-- Duas espécies de linha, como em active_installment_plans: row_kind = 'plan' (um parcelamento que termina em breve) e 'total'
-- (um por moeda: quantidade e valor liberado por mês, somados aqui). Sem nenhum plano: nenhuma linha.
-- SECURITY INVOKER: a RLS de quem chama decide; quem não é da família recebe vazio. p_days de 1 a 366 (22023 fora disso).

create function public.installments_ending_soon(p_household uuid, p_days integer default 60, p_as_of date default null)
returns table (
  row_kind text,
  currency_code text,
  source_type text,
  plan_key text,
  description text,
  source_name text,
  last_due date,
  freed_monthly numeric,
  plan_count integer
)
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_as_of date;
begin
  if p_household is null or p_days is null or p_days < 1 or p_days > 366 then
    raise exception 'parâmetros inválidos: informe a família e de 1 a 366 dias' using errcode = '22023';
  end if;
  if not (select private.is_member(p_household)) then
    return;
  end if;

  v_as_of := coalesce(p_as_of, (now() at time zone 'America/Sao_Paulo')::date);

  return query
  with
  cartoes as (
    select d.id, d.name
      from public.debts d
     where d.household_id = p_household and d.kind = 'card'
       and exists (select 1 from public.debt_installments i where i.household_id = d.household_id and i.debt_id = d.id)
  ),
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
           c.name as origem_nome,
           i.seq::integer as num, i.due_date as ordem_data,
           i.face - coalesce(a.valor, 0) as liquido,
           coalesce(f.vencimento, i.due_date) as vencimento,
           (i.due_date <= v_as_of and coalesce(f.fatura_paga, false)) as paga
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
           ac.name,
           t.installment_number::integer, t.date,
           t.amount,
           t.date,
           (t.status = 'paid')
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
           count(*) over (partition by t.chave) as n,
           bool_or(not t.paga) over (partition by t.chave) as tem_nao_paga
      from todas t
  ),
  planos as (
    select * from marcadas m where m.n >= 2 and m.tem_nao_paga
  ),
  fim as (
    select p.chave,
           (array_agg(p.origem))[1] as origem,
           (array_agg(p.moeda))[1] as moeda,
           max(p.descricao) as descricao,
           (array_agg(p.origem_nome order by p.num))[1] as origem_nome,
           max(p.vencimento) as ultimo_vencimento,
           (array_agg(p.liquido order by p.num desc, p.ordem_data desc))[1] as valor_ultima
      from planos p
     group by p.chave
  ),
  acabando as (
    select * from fim f
     where f.ultimo_vencimento >= v_as_of and f.ultimo_vencimento <= v_as_of + p_days
  ),
  linhas as (
    select 'plan'::text as tipo_linha, a.moeda, a.origem, a.chave, a.descricao, a.origem_nome,
           a.ultimo_vencimento, a.valor_ultima, null::integer as qtde
      from acabando a
    union all
    select 'total'::text, a.moeda, null, null, null, null, null, sum(a.valor_ultima), count(*)::integer
      from acabando a
     group by a.moeda
  )
  select l.tipo_linha, l.moeda, l.origem, l.chave, l.descricao, l.origem_nome, l.ultimo_vencimento, l.valor_ultima, l.qtde
    from linhas l
   order by l.moeda, case when l.tipo_linha = 'total' then 1 else 0 end, l.ultimo_vencimento nulls last, l.descricao, l.chave;
end
$function$;

revoke execute on function public.installments_ending_soon(uuid, integer, date) from public, anon;
grant execute on function public.installments_ending_soon(uuid, integer, date) to authenticated;
