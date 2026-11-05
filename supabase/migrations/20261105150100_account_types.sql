-- Tudo Azul — migration 070: o tipo da conta diz onde o dinheiro está (decisão do dono de 05/11/2026).
-- "Para podermos entender onde está o dinheiro… no futuro fazer a vinculação correta." A moeda continua separada
-- (currency_code) e não vira tipo.
--
-- 1. accounts.type passa a aceitar exatamente 7 tipos:
--      checking        Conta corrente                (dia a dia)
--      savings         Poupança / reserva            (chave mantida: menos mudança; só o rótulo muda)
--      brokerage       Corretora (saldo a aplicar)   (dinheiro parado na corretora, sem render)
--      fixed_income    Renda fixa                    (Tesouro, CDB etc.)
--      variable_income Renda variável                (ações, FII, stocks)
--      crypto          Cripto
--      cash            Dinheiro (carteira)           (continua sem banco: accounts_bank_not_cash não muda)
--    'investment' e 'other' deixam de ser aceitos.
-- 2. Conversão GENÉRICA das contas existentes, só pelo tipo (nunca pelo nome da conta):
--      investment -> fixed_income (a 044 criou o tipo para "investimento de liquidez (CDB, caixinha)", que é renda fixa)
--      other      -> checking     (o tipo padrão do formulário)
--    O dono ajusta conta por conta depois, pela tela de Contas. Nenhum saldo muda: só a etiqueta.
--    A regra fica em private.account_type_from_legacy para o pgTAP conferir a conversão.
-- 3. balance_totals_by_type: create or replace da versão da 055 (só BRL), com a ordem dos 7 tipos.
--    Nenhuma outra função filtra por accounts.type (procurado no prosrc de public/private em 05/11/2026): as de saldo
--    só repassam a coluna. accounts_guard e accounts_period_guard não olham o tipo.

create function private.account_type_from_legacy(p_type text)
returns text
language sql immutable set search_path = '' as $$
  select case p_type when 'investment' then 'fixed_income' when 'other' then 'checking' else p_type end
$$;
revoke execute on function private.account_type_from_legacy(text) from public, anon, authenticated;

alter table public.accounts drop constraint accounts_type_check;

update public.accounts
   set type = private.account_type_from_legacy(type)
 where type in ('investment', 'other');

alter table public.accounts add constraint accounts_type_check
  check (type in ('checking', 'savings', 'brokerage', 'fixed_income', 'variable_income', 'crypto', 'cash'));

create or replace function public.balance_totals_by_type(p_household uuid, p_as_of date)
returns table (account_type text, total numeric, total_active numeric)
language sql stable security invoker set search_path = '' as $$
  select b.type,
         coalesce(sum(b.balance), 0),
         coalesce(sum(b.balance) filter (where b.active), 0)
    from public.account_balances(p_household, p_as_of) b
   where (select private.is_member(p_household)) and b.currency_code = 'BRL'
   group by b.type
   order by case b.type when 'checking' then 1 when 'savings' then 2 when 'brokerage' then 3
                        when 'fixed_income' then 4 when 'variable_income' then 5 when 'crypto' then 6
                        when 'cash' then 7 else 8 end
$$;
