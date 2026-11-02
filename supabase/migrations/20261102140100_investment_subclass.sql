-- Tudo Azul — migration 034: subclasse do ativo e alocação da carteira
--
-- Pedido do dono (02/11/2026), a partir do protótipo de tela: ver a carteira por macroclasse (renda fixa × renda variável)
-- e por subclasse (Tesouro Direto, CDB, Ações, FIIs, Exterior, Cripto…).
--
-- Decisão: a MACROCLASSE não ganha coluna. Ela é derivada de investment_assets.asset_class (migration 030), para existir
-- uma só fonte da verdade e nunca divergir:
--   fixed_income                  -> fixed_income  (renda fixa)
--   equity, reit, etf, crypto     -> variable      (renda variável)
--   fund, other                   -> other         (fundos e outros: pode ser fixa ou variável, o banco não adivinha)
-- A SUBCLASSE é texto livre (1 a 40 caracteres), opcional, escolhido pela pessoa. Nenhum ativo existente é classificado
-- por esta migration (sem preenchimento por suposição).
--
-- O que esta migration acrescenta (nada é alterado nem apagado nas migrations anteriores):
--   1. investment_assets.subclass
--   2. investment_asset_set_subclass(p_asset, p_subclass): define ou limpa (nulo ou vazio) a subclasse. Mesmo padrão de
--      autorização das outras RPCs de investimento (a tabela continua sem escrita direta do cliente).
--   3. investment_allocation(p_household, p_as_of): valor de mercado por moeda, em dois níveis ('macro' e 'subclass'),
--      com o % de cada linha sobre o total DA MOEDA. Moedas nunca são somadas entre si. Só entram posições abertas de
--      ativos ativos (as mesmas do investment_portfolio): a soma dos 'macro' de uma moeda = investment_totals.market_value.
-- Códigos de erro: 42501 não autenticado ou ativo de outra família/inexistente; 22023 subclasse inválida.

alter table public.investment_assets
  add column subclass text check (subclass is null or char_length(btrim(subclass)) between 1 and 40);

create function public.investment_asset_set_subclass(p_asset uuid, p_subclass text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_asset public.investment_assets%rowtype;
  v_sub text := nullif(btrim(p_subclass), '');
begin
  if auth.uid() is null then raise exception 'não autenticado' using errcode = '42501'; end if;
  select * into v_asset from public.investment_assets where id = p_asset for update;
  if not found or not private.is_member(v_asset.household_id) then
    raise exception 'ativo não encontrado' using errcode = '42501';
  end if;
  if v_sub is not null and char_length(v_sub) > 40 then
    raise exception 'subclasse inválida (até 40 caracteres)' using errcode = '22023';
  end if;
  update public.investment_assets set subclass = v_sub where id = v_asset.id;
end $$;

create function public.investment_allocation(p_household uuid, p_as_of date)
returns table (currency_code text, level text, macro text, subclass text, market_value numeric, share numeric)
language sql stable security invoker set search_path = '' as $$
  with pos as (
    select p.currency_code as cur,
           case p.asset_class
             when 'fixed_income' then 'fixed_income'
             when 'equity' then 'variable' when 'reit' then 'variable' when 'etf' then 'variable' when 'crypto' then 'variable'
             else 'other' end as macro,
           a.subclass as sub, p.market_value as v
      from public.investment_portfolio(p_household, p_as_of) p
      join public.investment_assets a on a.id = p.asset_id and a.household_id = p_household
  ), tot as (
    select cur, sum(v) as t from pos group by cur
  ), linhas as (
    select cur, 'macro'::text as lvl, macro, null::text as sub, sum(v) as v from pos group by cur, macro
    union all
    select cur, 'subclass'::text, macro, sub, sum(v) from pos group by cur, macro, sub
  )
  select l.cur, l.lvl, l.macro, l.sub, l.v,
         case when t.t = 0 then 0 else round(100 * l.v / t.t, 1) end
    from linhas l join tot t on t.cur = l.cur
   where (select private.is_member(p_household))
   order by l.cur, (l.lvl = 'macro') desc, l.macro, l.v desc, l.sub
$$;

revoke execute on function public.investment_asset_set_subclass(uuid, text), public.investment_allocation(uuid, date) from public, anon;
grant execute on function public.investment_asset_set_subclass(uuid, text), public.investment_allocation(uuid, date) to authenticated;
