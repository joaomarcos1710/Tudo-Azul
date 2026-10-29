-- Tudo Azul — migration 017: banco da conta, emissor e bandeira do cartão
--
-- Pedido do dono (29/10/2026): o app adivinhava o banco pelo NOME da conta ("Conta corrente Caixa"), o que
-- falha em "Cartão principal" ou "Poupança da família". Agora a escolha é gravada.
--
-- O que esta migration acrescenta (nada é alterado nem apagado nas migrations anteriores):
--   1. accounts.bank: chave do banco ('caixa', 'nubank'...), opcional; a lista de bancos e de logos vive no
--      front (src/lib/bancos.ts), então banco novo não precisa de migration. Carteira em dinheiro não tem banco.
--   2. debts.issuer: chave do banco emissor do cartão, opcional, só em cartão.
--   3. debts.brand: bandeira do cartão (visa, mastercard, elo, amex, hipercard, diners), opcional, só em cartão.
--   4. set_card_identity: define, muda ou limpa (null) emissor e bandeira de um cartão (debts não aceita escrita direta).
--
-- Nenhuma coluna é obrigatória: contas e cartões existentes ficam sem banco (null) e o app continua
-- sugerindo pelo nome na tela até a pessoa escolher. Nada de dinheiro muda.
--
-- Códigos de erro: 22023 parâmetro inválido; 23514 só cartão.

alter table public.accounts
  add column bank text
    check (bank is null or bank ~ '^[a-z0-9]{2,30}$'),
  add constraint accounts_bank_not_cash check (bank is null or type <> 'cash');

alter table public.debts
  add column issuer text
    check (issuer is null or issuer ~ '^[a-z0-9]{2,30}$'),
  add column brand text
    check (brand is null or brand in ('visa', 'mastercard', 'elo', 'amex', 'hipercard', 'diners')),
  add constraint debts_identity_card_only check ((issuer is null and brand is null) or kind = 'card');

grant insert (bank) on public.accounts to authenticated;
grant update (bank) on public.accounts to authenticated;

create function public.set_card_identity(p_debt uuid, p_issuer text, p_brand text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_d public.debts%rowtype;
begin
  v_d := private.debt_lock(p_debt);
  if v_d.kind <> 'card' then
    raise exception 'emissor e bandeira só existem em cartão' using errcode = '23514';
  end if;
  if p_issuer is not null and p_issuer !~ '^[a-z0-9]{2,30}$' then
    raise exception 'emissor inválido' using errcode = '22023';
  end if;
  if p_brand is not null and p_brand not in ('visa', 'mastercard', 'elo', 'amex', 'hipercard', 'diners') then
    raise exception 'bandeira inválida' using errcode = '22023';
  end if;
  update public.debts set issuer = p_issuer, brand = p_brand where id = v_d.id;
end $$;

revoke execute on function public.set_card_identity(uuid, text, text) from public, anon;
grant execute on function public.set_card_identity(uuid, text, text) to authenticated;
