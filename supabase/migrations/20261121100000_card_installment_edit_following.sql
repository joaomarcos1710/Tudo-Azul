-- 145. Editar o valor de uma parcela do cartão "desta em diante" (pedido do dono, 21/11/2026: corrigiu a parcela 2 de 10 do
-- seguro viagem e as outras 8 continuaram com o valor antigo; só dava para corrigir uma por vez).
--
-- public.card_installment_edit_following(p_installment, p_face, p_reason) aplica o MESMO valor à parcela informada e a todas
-- as seguintes da mesma compra (mesmo cartão e mesmo plano, seq maior). Não tem regra nova: chama public.card_installment_edit
-- para cada uma, então valem as mesmas travas (fatura fechada e paga, fatura com pagamento, estorno, antecipação) e a mesma
-- trilha em debt_installment_edits. É uma transação só: se uma parcela for recusada, nenhuma muda.
-- Parcela que já está no valor novo é pulada (o dono costuma corrigir uma e só depois pedir as próximas). Se nenhuma mudar,
-- recusa como a edição de uma só. Devolve quantas parcelas mudaram.

create function public.card_installment_edit_following(p_installment uuid, p_face numeric, p_reason text default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_i public.debt_installments%rowtype; v_id uuid; v_n integer := 0;
begin
  select * into v_i from public.debt_installments where id = p_installment;
  if not found then raise exception 'registro não encontrado' using errcode = '42501'; end if;
  perform private.debt_lock(v_i.debt_id);  -- confere o acesso de quem chama e trava o cartão
  if p_face is null or p_face <= 0 or p_face >= 1e12 then
    raise exception 'valor da parcela inválido' using errcode = '22023';
  end if;
  for v_id in
    select i.id from public.debt_installments i
     where i.debt_id = v_i.debt_id and i.plan = v_i.plan and i.seq >= v_i.seq and i.face <> p_face
     order by i.seq
  loop
    perform public.card_installment_edit(v_id, p_face, p_reason);
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then
    raise exception 'o valor informado é igual ao atual' using errcode = '22023';
  end if;
  return v_n;
end $$;

revoke execute on function public.card_installment_edit_following(uuid, numeric, text) from public, anon;
grant execute on function public.card_installment_edit_following(uuid, numeric, text) to authenticated;
