-- Tudo Azul — migration 106: instituição do ativo e totais para a tela de posições
--
-- Pedido do dono (10/11/2026): ver os investimentos separados por instituição (a corretora tem ações e fundos; o
-- banco digital tem cofrinhos com taxas diferentes) e uma tabela de posições com aportado, valor atual, rendimento e
-- proventos do mês, com o nome da instituição embaixo de cada investimento.
--
-- O que entra:
--   1. investment_assets.institution: texto livre, até 40 caracteres (como a subclasse), sempre sem espaço nas pontas.
--      Nulo = sem instituição.
--   2. public.investment_asset_set_institution(p_asset, p_institution): define ou limpa (texto vazio limpa). Qualquer
--      espaço em branco (tabulação, quebra de linha, espaço que não quebra, espaço fino, vários seguidos) vira um espaço só,
--      caractere de largura zero some e as pontas são aparadas: o mesmo nome colado de outro lugar não vira outra instituição na tela. Maiúscula e minúscula NÃO são
--      unificadas ("XP" e "xp" são duas linhas): a tela oferece as já usadas para repetir a grafia.
--   3. public.investment_institution_totals(p_household, p_as_of): valor de mercado por moeda e instituição, das mesmas
--      posições de investment_portfolio (a soma de uma moeda = investment_totals.market_value). Para a aba "Instituição".
--   4. public.investment_income_totals(p_household, p_from, p_to): proventos recebidos e previstos por moeda no período,
--      com a mesma regra de investment_income_by_asset (a soma dos ativos de uma moeda = a linha da moeda). Para o
--      cartão "Proventos no mês": o front não soma dinheiro.
-- Nenhuma função existente muda e nenhum dado é alterado (a coluna nasce nula).
--
-- Códigos de erro: 42501 não autenticado ou ativo de outra família/inexistente; 22023 instituição inválida.
-- Teste: 100_investment_institution (falha sem esta migration).

alter table public.investment_assets
  add column institution text check (institution is null or (institution = btrim(institution) and char_length(institution) between 1 and 40));

create function public.investment_asset_set_institution(p_asset uuid, p_institution text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_asset public.investment_assets%rowtype;
  -- Primeiro saem os caracteres de largura zero (invisíveis no meio do nome); depois todo espaço em branco vira um
  -- espaço só. Os espaços Unicode vão escritos um a um porque o que \s alcança depende do idioma do banco.
  v_inst text := nullif(btrim(regexp_replace(
    regexp_replace(p_institution, '[\u200B-\u200D\uFEFF]', '', 'g'),
    '[\s\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]+', ' ', 'g')), '');
begin
  if auth.uid() is null then raise exception 'não autenticado' using errcode = '42501'; end if;
  select * into v_asset from public.investment_assets where id = p_asset for update;
  if not found or not private.is_member(v_asset.household_id) then
    raise exception 'ativo não encontrado' using errcode = '42501';
  end if;
  if v_inst is not null and char_length(v_inst) > 40 then
    raise exception 'instituição inválida (até 40 caracteres)' using errcode = '22023';
  end if;
  update public.investment_assets set institution = v_inst where id = v_asset.id;
end $$;

create function public.investment_institution_totals(p_household uuid, p_as_of date)
returns table (currency_code text, institution text, market_value numeric)
language sql stable security invoker set search_path = '' as $$
  select p.currency_code, a.institution, sum(p.market_value)
    from public.investment_portfolio(p_household, p_as_of) p
    join public.investment_assets a on a.id = p.asset_id and a.household_id = p_household
   where (select private.is_member(p_household))
   group by p.currency_code, a.institution
   order by p.currency_code, sum(p.market_value) desc, a.institution nulls last
$$;

create function public.investment_income_totals(p_household uuid, p_from date, p_to date)
returns table (currency_code text, received numeric, planned numeric)
language sql stable security invoker set search_path = '' as $$
  select a.currency_code,
         coalesce(sum(t.amount) filter (where t.status = 'paid'), 0),
         coalesce(sum(t.amount) filter (where t.status = 'planned'), 0)
    from public.investment_distributions d
    join public.transactions t on t.id = d.transaction_id and t.household_id = d.household_id and t.deleted_at is null
    join public.investment_assets a on a.id = d.asset_id and a.household_id = d.household_id
   where d.household_id = p_household and t.date between p_from and p_to
     and (select private.is_member(p_household))
   group by a.currency_code
   order by a.currency_code
$$;

revoke execute on function public.investment_asset_set_institution(uuid, text),
  public.investment_institution_totals(uuid, date), public.investment_income_totals(uuid, date, date) from public, anon;
grant execute on function public.investment_asset_set_institution(uuid, text),
  public.investment_institution_totals(uuid, date), public.investment_income_totals(uuid, date, date) to authenticated;
