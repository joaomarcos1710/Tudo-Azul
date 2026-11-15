-- Tudo Azul — migration 125: próxima cobrança REAL de cada recorrente de conta (somente leitura).
--
-- Problema (dono, 15/11/2026): a tela de Recorrentes calcula "próxima" só pela regra (proximasOcorrencias, no front). Medido nos dados
-- do dono: 3 de 25 recorrentes de conta mostravam como próxima uma ocorrência que JÁ foi paga adiantada (Condomínio 15/11 pago em 13/11;
-- Light e Flora Energia 05/12 pagos em 14/11). Cartão: 0 de 19 divergem, então fica como está.
--
-- public.recurrence_next_dates(p_household) → uma linha por recorrente de conta (despesa, receita ou transferência) com a data da
-- próxima cobrança que ainda vale, a partir de hoje em São Paulo. É a menor das datas de:
--   (a) lançamento PLANEJADO da regra, fora da lixeira, com data de hoje em diante (a data real, que a pessoa pode ter mexido);
--   (b) ocorrência da regra de hoje em diante que ainda NÃO virou lançamento (nem na lixeira): a geração só cria o que não existe pela
--       chave (recurrence_id, occurrence_date), então ocorrência já gerada e paga, ou apagada, não é mais "próxima".
-- Regra encerrada ou desativada não aparece. Cartão fica de fora (a assinatura vira parcela, outra chave; ver o atalho abaixo).
--
-- SECURITY INVOKER: a RLS do chamador decide; quem não é da família recebe vazio. Dinheiro não entra aqui: só datas.
-- atalho: assinatura de cartão continua pela regra no front (0 divergências medidas em 15/11/2026), melhorar se aparecer caso real.
-- atalho: ocorrência planejada atrasada (data antes de hoje) não vira "próxima"; a tela de Recorrentes não destaca atraso.

create function public.recurrence_next_dates(p_household uuid)
returns table (recurrence_id uuid, next_date date)
language sql stable security invoker set search_path = '' as $$
  with hoje as (select (now() at time zone 'America/Sao_Paulo')::date as d)
  select r.id, min(c.dt)
    from public.recurrences r
   cross join hoje
   cross join lateral (
     select t.date as dt
       from public.transactions t
      where t.household_id = r.household_id and t.recurrence_id = r.id
        and t.deleted_at is null and t.status = 'planned' and t.date >= hoje.d
     union all
     select o.occ
       from private.recurrence_occurrences(r, hoje.d, hoje.d + 800) o(occ)
      where not exists (select 1 from public.transactions t
                         where t.household_id = r.household_id and t.recurrence_id = r.id and t.occurrence_date = o.occ)
   ) c
   where r.household_id = p_household
     and (select private.is_member(p_household))
     and r.active
     and r.kind <> 'card'
     and (r.end_date is null or r.end_date >= hoje.d)
   group by r.id
$$;

revoke execute on function public.recurrence_next_dates(uuid) from public, anon;
grant execute on function public.recurrence_next_dates(uuid) to authenticated;
