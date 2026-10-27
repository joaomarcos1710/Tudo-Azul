-- Tudo Azul — migration 015: reajustar uma recorrência não desfaz o que foi corrigido à mão
--
-- Defeito (auditoria de 26/10/2026): recurrence_update regravava descrição, valor e categoria de TODOS os
-- planejados futuros da regra, inclusive os que o usuário já tinha corrigido em Lançamentos (ex.: a conta de
-- luz de novembro chegou e foi ajustada para 213,40; reajustar a regra para 200 voltava novembro para 200).
--
-- Regra nova, campo a campo: cada campo do planejado só acompanha a regra se ainda estiver IGUAL ao valor que
-- a regra tinha antes do reajuste. Campo diferente = corrigido à mão = fica como está.
--
-- Por que o valor anterior da regra é referência confiável: só duas funções escrevem descrição, valor e
-- categoria de um lançamento ligado a recorrência — recurrence_materialize (copia a regra ao criar) e esta
-- (sincroniza de hoje em diante). O cliente não pode mexer em recurrence_id. Assim, todo planejado futuro que
-- ninguém editou é igual à regra nos três campos; a regra é lida sob lock (recurrence_lock) antes de mudar.
--
-- Limite conhecido: "editar" um campo para exatamente o valor da regra não deixa rastro e continua
-- acompanhando a regra. Edições sobrescritas antes desta migration não podem ser recuperadas (não há histórico).
--
-- Mesma assinatura e mesmo escopo de antes: só planejados não excluídos de hoje (São Paulo) em diante; pagos,
-- passados e excluídos nunca são tocados. A migration 006 não é editada (create or replace aqui).

create or replace function public.recurrence_update(p_id uuid, p_description text, p_amount numeric, p_category uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.recurrences%rowtype;  -- a regra ANTES do reajuste (lida sob lock)
begin
  v := private.recurrence_lock(p_id);
  if p_amount is null or p_amount <= 0 then
    raise exception 'parâmetros inválidos' using errcode = '22023';
  end if;
  update public.recurrences
     set description = btrim(p_description), amount = p_amount,
         category_id = case when v.kind = 'transfer' then null else coalesce(p_category, v.category_id) end
   where id = v.id;
  update public.transactions t
     set amount      = case when t.amount = v.amount then p_amount else t.amount end,
         description = case when t.description = v.description then btrim(p_description) else t.description end,
         category_id = case when v.kind = 'transfer' then null
                            when t.category_id is not distinct from v.category_id then coalesce(p_category, v.category_id)
                            else t.category_id end
   where t.recurrence_id = v.id and t.status = 'planned' and t.deleted_at is null and t.date >= private.today_sp();
end $$;
