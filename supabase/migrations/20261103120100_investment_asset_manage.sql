-- Tudo Azul — migration 040: editar, arquivar e reativar ativo de investimento
--
-- Pedido do dono (02/11/2026, arquivo "Melhoria 1"): "criamos o ativo, mas não vi o botão excluir e editar" e
-- "quando zerei um ativo ele sumiu de Ativos e posições, mas continuou como ativos cadastrados".
-- Regra combinada (a mesma dos cartões e contas, migration 020):
--   * EXCLUIR: só o que nunca teve movimento (criado por engano). Já existe: investment_asset_delete é da migration 039
--     (#125, `investment_dashboard_and_delete`). Esta migration NÃO o recria; recriar derrubaria o `db push` ("function
--     already exists"). Com qualquer operação, avaliação ou provento ligado, aquela função recusa (55000).
--   * ARQUIVAR: some das escolhas e das posições, o histórico fica. Só sem posição aberta (vender antes).
--     É o destino do ativo zerado: ele deixa de ficar "cadastrado" sem aparecer em lugar nenhum.
--   * REATIVAR: volta ao normal.
--
-- O que esta migration acrescenta (nada é alterado nem apagado nas migrations anteriores):
--   investment_asset_update(p_asset, p_name, p_ticker, p_class)  corrige nome, código e classe. A MOEDA não muda: as
--                          operações, avaliações e proventos já estão nela. Mudar a classe só muda o agrupamento
--                          (macroclasse), nunca um valor.
--   investment_asset_archive(p_asset)    desliga investment_assets.active. Recusa com posição aberta (23514).
--                          Já arquivado: não faz nada.
--   investment_asset_unarchive(p_asset)  liga de novo.
-- Mesmo padrão de autorização das outras RPCs de investimento: o ativo é travado (for update), o que também as serializa
-- com investment_operation_record (que trava o mesmo ativo): não dá para arquivar no meio de uma compra.
-- Códigos de erro: 42501 não autenticado ou ativo de outra família/inexistente; 22023 dados inválidos;
-- 23505 já existe ativo com esse nome nesta moeda; 23514 posição aberta.
-- Dependência: precisa vir DEPOIS da 039 (timestamp posterior, 20261103... > 20261102190300) e só faz sentido com ela aplicada.

create function public.investment_asset_update(p_asset uuid, p_name text, p_ticker text, p_class text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_asset public.investment_assets%rowtype;
  v_name text := btrim(p_name);
  v_ticker text := nullif(btrim(p_ticker), '');
begin
  if auth.uid() is null then raise exception 'não autenticado' using errcode = '42501'; end if;
  select * into v_asset from public.investment_assets where id = p_asset for update;
  if not found or not private.is_member(v_asset.household_id) then
    raise exception 'ativo não encontrado' using errcode = '42501';
  end if;
  if v_name is null or char_length(v_name) not between 1 and 100
     or (v_ticker is not null and char_length(v_ticker) > 20)
     or p_class is null or p_class not in ('fixed_income','equity','fund','reit','etf','crypto','other') then
    raise exception 'dados do ativo inválidos' using errcode = '22023';
  end if;
  update public.investment_assets set name = v_name, ticker = v_ticker, asset_class = p_class where id = v_asset.id;
end $$;

create function public.investment_asset_archive(p_asset uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_asset public.investment_assets%rowtype;
  v_held numeric;
begin
  if auth.uid() is null then raise exception 'não autenticado' using errcode = '42501'; end if;
  select * into v_asset from public.investment_assets where id = p_asset for update;
  if not found or not private.is_member(v_asset.household_id) then
    raise exception 'ativo não encontrado' using errcode = '42501';
  end if;
  if not v_asset.active then return; end if;
  select coalesce(sum(case when o.kind = 'buy' then o.quantity else -o.quantity end), 0) into v_held
    from public.investment_operations o
   where o.asset_id = v_asset.id and o.household_id = v_asset.household_id;
  if v_held > 0 then
    raise exception 'ainda há posição aberta: venda tudo antes de arquivar' using errcode = '23514';
  end if;
  update public.investment_assets set active = false where id = v_asset.id;
end $$;

create function public.investment_asset_unarchive(p_asset uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_asset public.investment_assets%rowtype;
begin
  if auth.uid() is null then raise exception 'não autenticado' using errcode = '42501'; end if;
  select * into v_asset from public.investment_assets where id = p_asset for update;
  if not found or not private.is_member(v_asset.household_id) then
    raise exception 'ativo não encontrado' using errcode = '42501';
  end if;
  update public.investment_assets set active = true where id = v_asset.id;
end $$;

revoke execute on function public.investment_asset_update(uuid, text, text, text), public.investment_asset_archive(uuid),
  public.investment_asset_unarchive(uuid) from public, anon;
grant execute on function public.investment_asset_update(uuid, text, text, text), public.investment_asset_archive(uuid),
  public.investment_asset_unarchive(uuid) to authenticated;
