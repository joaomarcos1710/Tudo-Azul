-- Tudo Azul — migration 011: limite do cartão e limite disponível
--
-- Pedido do dono (25/10/2026), vindo das planilhas antigas (abas "Cartões de Crédito": "Limite para
-- compras", "Limite atual disponível" e "Total parcelado").
--
-- O que esta migration acrescenta (nada é alterado nem apagado nas migrations anteriores):
--   1. debts.credit_limit: limite do cartão, opcional, só em cartão. É informação para a tela; nenhuma
--      compra é recusada por causa dele (o banco do cartão é quem recusa; aqui o dono só acompanha).
--   2. set_card_limit: define, muda ou limpa (null) o limite.
--   3. card_limits: por cartão com limite, quanto está comprometido e quanto sobra.
--        comprometido = dívida (faturas cobradas e não pagas) + parcelas futuras ainda não cobradas
--                       − crédito no cartão (pagamento adiantado ou estorno maior que a dívida)
--        disponível   = limite − comprometido (pode ficar negativo: passou do limite)
--      Tudo vem de debt_balances, a mesma fonte da tela de Cartões; a tela não soma dinheiro.
--
-- Códigos de erro: 22023 parâmetro inválido; 22003 mais de 2 casas decimais; 23514 só cartão.

alter table public.debts
  add column credit_limit numeric
    check (credit_limit is null or (credit_limit > 0 and credit_limit = round(credit_limit, 2) and credit_limit < 1e12)),
  add constraint debts_limit_card_only check (credit_limit is null or kind = 'card');

create function public.set_card_limit(p_debt uuid, p_limit numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare v_d public.debts%rowtype;
begin
  v_d := private.debt_lock(p_debt);
  if v_d.kind <> 'card' then
    raise exception 'limite só existe em cartão' using errcode = '23514';
  end if;
  if p_limit is not null then
    if p_limit <= 0 or p_limit >= 1e12 then
      raise exception 'limite inválido' using errcode = '22023';
    end if;
    if p_limit <> round(p_limit, 2) then
      raise exception 'valor com mais de 2 casas decimais: %', p_limit using errcode = '22003';
    end if;
  end if;
  update public.debts set credit_limit = p_limit where id = v_d.id;
end $$;

create function public.card_limits(p_household uuid, p_as_of date)
returns table (debt_id uuid, credit_limit numeric, committed numeric, available numeric)
language sql stable security invoker set search_path = '' as $$
  select d.id, d.credit_limit,
         b.debt + b.planned_remaining - b.credit_receivable,
         d.credit_limit - (b.debt + b.planned_remaining - b.credit_receivable)
    from public.debts d
    join public.debt_balances(p_household, p_as_of) b on b.debt_id = d.id
   where d.household_id = p_household and d.kind = 'card' and d.credit_limit is not null
     and (select private.is_member(p_household))
   order by d.name
$$;

revoke execute on function public.set_card_limit(uuid, numeric), public.card_limits(uuid, date) from public, anon;
grant execute on function public.set_card_limit(uuid, numeric), public.card_limits(uuid, date) to authenticated;
