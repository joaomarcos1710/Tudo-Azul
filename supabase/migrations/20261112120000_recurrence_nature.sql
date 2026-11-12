-- Tudo Azul — natureza da recorrência (alicerce para agrupar a tela Recorrentes por natureza).
-- É só classificação analítica: não muda valor, data, geração das ocorrências nem nenhum relatório de dinheiro.
-- NULL = sem classificação. Valores: 'fixed' (custo fixo), 'subscription' (assinatura/app), 'variable' (gasto variável),
-- 'reimbursement' (ressarcimento/reembolso a receber).
-- Consistência com o tipo da regra: receita só aceita 'reimbursement'; despesa em conta e assinatura de cartão só aceitam
-- 'fixed', 'subscription' ou 'variable'; transferência não tem natureza.

alter table public.recurrences
  add column nature text,
  add constraint recurrences_nature_check check (
    nature is null
    or (kind = 'income' and nature = 'reimbursement')
    or (kind in ('expense', 'card') and nature in ('fixed', 'subscription', 'variable'))
  );

-- Preenchimento do que já existe: só o sinal inequívoco. Recorrente de tipo 'card' é, no app, a "Assinatura no cartão".
-- Despesa em conta e receita ficam NULL (o dono escolhe).
update public.recurrences set nature = 'subscription' where kind = 'card' and nature is null;

-- Define a natureza de uma regra (NULL limpa). Vale para regra ativa ou encerrada; não toca em ocorrência alguma.
-- Erros: 42501 sem login/família ou regra inexistente/de outra família; 22023 valor desconhecido; 55000 valor que o tipo da regra não aceita.
create function public.recurrence_set_nature(p_id uuid, p_nature text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_household uuid := private.current_household(); v_kind text;
begin
  if (select auth.uid()) is null or v_household is null then
    raise exception 'não autenticado ou sem família' using errcode = '42501';
  end if;
  if p_nature is not null and p_nature not in ('fixed', 'subscription', 'variable', 'reimbursement') then
    raise exception 'natureza inválida: %', p_nature using errcode = '22023';
  end if;
  select r.kind into v_kind from public.recurrences r where r.household_id = v_household and r.id = p_id;
  if not found then raise exception 'recorrente não encontrado' using errcode = '42501'; end if;
  if p_nature = 'reimbursement' and v_kind <> 'income' then
    raise exception 'ressarcimento só vale para receita' using errcode = '55000';
  end if;
  if p_nature in ('fixed', 'subscription', 'variable') and v_kind not in ('expense', 'card') then
    raise exception 'esta natureza só vale para despesa ou assinatura de cartão' using errcode = '55000';
  end if;
  update public.recurrences set nature = p_nature where household_id = v_household and id = p_id;
end $$;

-- Criar e atualizar com natureza, numa transação. Funções NOVAS: as classified existentes não mudam de assinatura
-- (um overload com a mesma lista de nomes deixaria a chamada por nome ambígua no PostgREST).
create function public.recurrence_create_with_nature(
  p_kind text, p_description text, p_amount numeric, p_day integer, p_start date,
  p_account uuid default null, p_destination uuid default null, p_debt uuid default null,
  p_category uuid default null, p_end date default null, p_freq_unit text default 'month',
  p_freq_every integer default 1, p_person_id uuid default null, p_is_shared_expense boolean default false,
  p_nature text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  v_id := public.recurrence_create_classified(
    p_kind, p_description, p_amount, p_day, p_start, p_account, p_destination, p_debt, p_category, p_end,
    p_freq_unit, p_freq_every, p_person_id, p_is_shared_expense
  );
  perform public.recurrence_set_nature(v_id, p_nature);
  return v_id;
end $$;

create function public.recurrence_update_with_nature(
  p_id uuid, p_description text, p_amount numeric, p_category uuid,
  p_person_id uuid default null, p_is_shared_expense boolean default false, p_nature text default null
) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.recurrence_update_classified(p_id, p_description, p_amount, p_category, p_person_id, p_is_shared_expense);
  perform public.recurrence_set_nature(p_id, p_nature);
end $$;

revoke execute on function public.recurrence_set_nature(uuid, text),
  public.recurrence_create_with_nature(text, text, numeric, integer, date, uuid, uuid, uuid, uuid, date, text, integer, uuid, boolean, text),
  public.recurrence_update_with_nature(uuid, text, numeric, uuid, uuid, boolean, text)
from public, anon;
grant execute on function public.recurrence_set_nature(uuid, text),
  public.recurrence_create_with_nature(text, text, numeric, integer, date, uuid, uuid, uuid, uuid, date, text, integer, uuid, boolean, text),
  public.recurrence_update_with_nature(uuid, text, numeric, uuid, uuid, boolean, text)
to authenticated;
