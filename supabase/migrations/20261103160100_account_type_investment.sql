-- Tudo Azul — migration 044: conta do tipo Investimento e saldo por tipo de conta.
-- Pedido do dono (03/11/2026): dividir as contas em corrente, poupança e investimento. Ele trata cada
-- investimento de liquidez (CDB, caixinha) como uma conta: aplicação e resgate são transferências entre
-- contas, o rendimento é receita, e o saldo entra no consolidado.
-- 1. accounts.type passa a aceitar 'investment'. 'cash' e 'other' continuam valendo (contas já existentes).
-- 2. balance_totals_by_type(p_household, p_as_of): saldo somado por tipo, calculado no banco (o front não soma).
--    Mesma base do balance_totals (account_balances); total inclui arquivadas, total_active só as ativas.

alter table public.accounts drop constraint accounts_type_check;
alter table public.accounts add constraint accounts_type_check
  check (type in ('checking', 'savings', 'investment', 'cash', 'other'));

create function public.balance_totals_by_type(p_household uuid, p_as_of date)
returns table (account_type text, total numeric, total_active numeric)
language sql stable security invoker set search_path = '' as $$
  select b.type,
         coalesce(sum(b.balance), 0),
         coalesce(sum(b.balance) filter (where b.active), 0)
    from public.account_balances(p_household, p_as_of) b
   where (select private.is_member(p_household))
   group by b.type
   order by case b.type when 'checking' then 1 when 'savings' then 2 when 'investment' then 3
                        when 'cash' then 4 else 5 end
$$;

revoke execute on function public.balance_totals_by_type(uuid, date) from public, anon;
grant execute on function public.balance_totals_by_type(uuid, date) to authenticated;
