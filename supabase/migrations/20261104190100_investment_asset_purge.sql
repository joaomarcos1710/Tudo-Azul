-- Tudo Azul — migration 050: excluir um ativo de investimento JUNTO com o histórico.
-- Pedido do dono (04/11/2026): o ativo duplicado da importação não saía, porque investment_asset_delete só exclui
-- ativo sem operações, avaliações ou proventos. Essa trava continua (é o botão comum). Esta função é a saída
-- consciente: só apaga se quem chama digitar o NOME exato do ativo.
--   * apaga operações e avaliações do ativo e o próprio ativo;
--   * proventos: apaga só o vínculo; a receita que caiu na conta FICA (o dinheiro entrou de verdade), então
--     saldo de conta, conciliação e relatórios de caixa não mudam;
--   * devolve quantas operações, avaliações e proventos saíram.

create function public.investment_asset_purge(p_asset uuid, p_confirm_name text)
returns table (operations integer, valuations integer, distributions integer)
language plpgsql security definer set search_path = '' as $$
declare v_asset public.investment_assets%rowtype; v_o integer; v_v integer; v_d integer;
begin
  if (select auth.uid()) is null then
    raise exception 'não autenticado' using errcode = '42501';
  end if;
  select * into v_asset from public.investment_assets where id = p_asset for update;
  if not found or not private.is_member(v_asset.household_id) then
    raise exception 'ativo não encontrado' using errcode = '42501';
  end if;
  if p_confirm_name is null or btrim(p_confirm_name) <> btrim(v_asset.name) then
    raise exception 'Digite o nome exato do ativo para confirmar a exclusão.' using errcode = '22023';
  end if;
  delete from public.investment_distributions where household_id = v_asset.household_id and asset_id = v_asset.id;
  get diagnostics v_d = row_count;
  delete from public.investment_valuations where household_id = v_asset.household_id and asset_id = v_asset.id;
  get diagnostics v_v = row_count;
  delete from public.investment_operations where household_id = v_asset.household_id and asset_id = v_asset.id;
  get diagnostics v_o = row_count;
  delete from public.investment_assets where id = v_asset.id and household_id = v_asset.household_id;
  return query select v_o, v_v, v_d;
end $$;

revoke execute on function public.investment_asset_purge(uuid, text) from public, anon;
grant execute on function public.investment_asset_purge(uuid, text) to authenticated;
