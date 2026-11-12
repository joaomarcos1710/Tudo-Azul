-- Parcelas ativas (Recorrentes): cada parcelamento em andamento, no cartão ou em conta, numa linha só.
--
-- Leitura pura (STABLE, SECURITY INVOKER, sem escrever nada), no padrão de dashboard_commitment_matrix: confere a
-- família com private.is_member e a RLS decide o resto. O que já existia (card_items/card_months, transactions com
-- installment_group) não entrega "parcela n de N", "% pago", "saldo restante" nem "a parcela do mês está paga?" por
-- parcelamento; esta função junta tudo no banco, para a tela não somar dinheiro.
--
-- PARCELAMENTO ATIVO
--   * cartão: compra parcelada de um cartão (debt_installments agrupadas por plan). Assinatura de cartão NÃO é parcelamento:
--     cada cobrança dela nasce com um plan próprio e seq 1, então cai na regra "2 ou mais parcelas" abaixo;
--   * conta: despesa parcelada em conta (transactions type = 'expense' com installment_group, fora da lixeira).
--     Receita e transferência parceladas ficam fora (não são dívida); contratos de empréstimo/financiamento/consignado
--     também (têm a tela Dívidas e cronograma próprio).
--   Parcela VIVA = valor líquido > 0. Cartão: face - cancelado - estornado (a mesma conta de card_items/card_months,
--   com os eventos até p_as_of); conta: o lançamento fora da lixeira. Parcela cancelada ou estornada inteira não conta
--   em "n de N". O parcelamento é ATIVO quando tem 2 ou mais parcelas vivas e ao menos uma ainda não paga
--   (compra à vista, plano concluído e plano encurtado até sobrar uma parcela ficam de fora).
--
-- PARCELA PAGA
--   * cartão: a fatura dela está FECHADA (fechamento <= p_as_of) e PAGA (pago >= total, os números de card_months_as_of,
--     a mesma regra da fatura travada da 064). Não há pagamento por parcela: quem paga é a fatura.
--   * conta: o lançamento está com status 'paid'.
--
-- PARCELA DO MÊS: a que vence no mês de p_as_of. Cartão: pelo VENCIMENTO da fatura (quando o dinheiro sai; mesma
-- escolha do Entradas x Saídas, 066); conta: pela data do lançamento. month_status = 'paid' (todas as parcelas do
-- mês pagas), 'pending' (alguma não paga) ou 'none' (nenhuma vence no mês).
--
-- Valores, tudo em numeric de 2 casas (a tela converte para centavos e não soma):
--   total_amount     soma do valor líquido das parcelas vivas
--   paid_amount      o das parcelas pagas
--   remaining_amount o das não pagas (saldo restante: inclui fatura fechada a pagar e parcela em atraso)
--   future_amount    o das não pagas que ainda NÃO fecharam (cartão: fechamento > p_as_of) ou ainda não venceram (conta:
--                    data > p_as_of): é o "total das faturas futuras"; sempre <= remaining_amount
--   percent_paid     floor(100 * pago / total), em inteiro: só chega a 100 quando tudo foi pago (e aí o plano nem aparece)
-- current_number / installment_amount: a parcela atual (a que vence no mês; senão a primeira não paga) e seu valor líquido.
-- A numeração é a posição entre as parcelas vivas (por seq / installment_number).
--
-- Duas espécies de linha: row_kind = 'plan' (um parcelamento) e 'total' (um por moeda: remaining, future, total, paid e
-- plan_count somados aqui no banco). Moedas nunca se misturam: cartão é sempre BRL; parcela em conta usa a moeda da conta.

create function public.active_installment_plans(p_household uuid, p_as_of date default null)
returns table (
  row_kind text,
  currency_code text,
  source_type text,
  plan_key text,
  description text,
  source_id uuid,
  source_name text,
  installment_amount numeric,
  current_number integer,
  total_count integer,
  paid_count integer,
  percent_paid integer,
  total_amount numeric,
  paid_amount numeric,
  remaining_amount numeric,
  future_amount numeric,
  month_status text,
  next_due date,
  overdue_count integer,
  plan_count integer
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
           (i.due_date > v_as_of) as ainda_nao_fechou
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
           (t.date > v_as_of)
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
  ),
  atual as (
    select distinct on (p.chave) p.chave, p.pos, p.liquido
      from planos p
     order by p.chave, case when p.no_mes then 0 when not p.paga then 1 else 2 end, p.vencimento nulls last, p.num
  ),
  agregado as (
    select p.chave,
           (array_agg(p.origem))[1] as origem,
           (array_agg(p.moeda))[1] as moeda,
           max(p.descricao) as descricao,
           (array_agg(p.origem_id order by p.num))[1] as origem_id,
           (array_agg(p.origem_nome order by p.num))[1] as origem_nome,
           count(*)::integer as total_parcelas,
           (count(*) filter (where p.paga))::integer as parcelas_pagas,
           sum(p.liquido) as total,
           coalesce(sum(p.liquido) filter (where p.paga), 0) as pago,
           coalesce(sum(p.liquido) filter (where not p.paga), 0) as restante,
           coalesce(sum(p.liquido) filter (where not p.paga and p.ainda_nao_fechou), 0) as futuro,
           case when count(*) filter (where p.no_mes) = 0 then 'none'
                when bool_and(p.paga) filter (where p.no_mes) then 'paid'
                else 'pending' end as situacao_mes,
           min(p.vencimento) filter (where not p.paga) as proximo_vencimento,
           (count(*) filter (where not p.paga and p.vencimento < v_as_of))::integer as em_atraso
      from planos p
     group by p.chave
  ),
  linhas as (
    select 'plan'::text as tipo_linha, g.moeda, g.origem, g.chave, g.descricao, g.origem_id, g.origem_nome,
           a.liquido as valor_parcela, a.pos::integer as numero_atual, g.total_parcelas, g.parcelas_pagas,
           floor(100 * g.pago / g.total)::integer as percentual,
           g.total, g.pago, g.restante, g.futuro, g.situacao_mes, g.proximo_vencimento, g.em_atraso,
           null::integer as qtde_planos
      from agregado g
      join atual a on a.chave = g.chave
    union all
    select 'total'::text, g.moeda, null, null, null, null, null,
           null, null, null, null,
           null,
           sum(g.total), sum(g.pago), sum(g.restante), sum(g.futuro), null, null, null,
           count(*)::integer
      from agregado g
     group by g.moeda
  )
  select l.*
    from linhas l
   order by l.moeda, case when l.tipo_linha = 'total' then 1 else 0 end, l.proximo_vencimento nulls last, l.descricao, l.chave;
end
$function$;

revoke execute on function public.active_installment_plans(uuid, date) from public, anon;
grant execute on function public.active_installment_plans(uuid, date) to authenticated;
