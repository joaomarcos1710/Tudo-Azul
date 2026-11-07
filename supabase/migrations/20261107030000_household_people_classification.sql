-- Tudo Azul — classificação de despesas por pessoa (Fases 2 e 3 da Gestão de Pessoas)
-- Não altera lançamentos de caixa, valores, eventos de cartão, saldos ou pagamentos de fatura.

alter table public.transactions
  add column person_id uuid,
  add column is_shared_expense boolean not null default false,
  add constraint transactions_person_fk
    foreign key (household_id, person_id)
    references public.household_people (household_id, id)
    on delete set null (person_id),
  add constraint transactions_person_scope_check
    check (not is_shared_expense or person_id is null);

alter table public.debt_installments
  add column person_id uuid,
  add column is_shared_expense boolean not null default false,
  add constraint debt_installments_person_fk
    foreign key (household_id, person_id)
    references public.household_people (household_id, id)
    on delete set null (person_id),
  add constraint debt_installments_person_scope_check
    check (not is_shared_expense or person_id is null);

alter table public.recurrences
  add column person_id uuid,
  add column is_shared_expense boolean not null default false,
  add constraint recurrences_person_fk
    foreign key (household_id, person_id)
    references public.household_people (household_id, id)
    on delete set null (person_id),
  add constraint recurrences_person_scope_check
    check (not is_shared_expense or person_id is null);

create index transactions_person_period_idx
  on public.transactions (household_id, date, person_id)
  where type = 'expense' and deleted_at is null;
create index debt_installments_person_period_idx
  on public.debt_installments (household_id, due_date, person_id);
create index recurrences_person_idx
  on public.recurrences (household_id, person_id) where active;

-- Toda a família é person_id NULL + is_shared_expense TRUE.
-- Não classificada é person_id NULL + is_shared_expense FALSE.
create function private.validate_person_scope(p_household uuid, p_person uuid, p_shared boolean)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if coalesce(p_shared, false) and p_person is not null then
    raise exception 'despesa compartilhada não pode ter pessoa individual' using errcode = '23514';
  end if;
  if p_person is not null and not exists (
    select 1 from public.household_people hp
     where hp.household_id = p_household and hp.id = p_person and hp.status
  ) then
    raise exception 'pessoa não encontrada, inativa ou de outra família' using errcode = '23514';
  end if;
end $$;
revoke execute on function private.validate_person_scope(uuid, uuid, boolean) from public, anon, authenticated;

-- Recorrências geram lançamentos e parcelas de cartão. A classificação é herdada no INSERT,
-- sem duplicar dados de cobrança nem modificar os eventos financeiros.
create function private.inherit_person_classification()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_person uuid; v_shared boolean;
begin
  if new.recurrence_id is not null then
    select r.person_id, r.is_shared_expense into v_person, v_shared
      from public.recurrences r
     where r.household_id = new.household_id and r.id = new.recurrence_id;
    if found then
      new.person_id := v_person;
      new.is_shared_expense := v_shared;
    end if;
  end if;
  return new;
end $$;
revoke execute on function private.inherit_person_classification() from public, anon, authenticated;

create trigger transactions_inherit_person_classification
  before insert on public.transactions
  for each row execute function private.inherit_person_classification();
create trigger debt_installments_inherit_person_classification
  before insert on public.debt_installments
  for each row execute function private.inherit_person_classification();

-- As parcelas de cartão permanecem imutáveis nos dados financeiros. A única exceção nova
-- permite alterar exclusivamente os dois campos analíticos por RPC controlada.
create or replace function private.debt_installments_immutable()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_setting('app.person_classification', true) = 'on'
     and (new.id, new.household_id, new.debt_id, new.plan, new.seq, new.due_date, new.face,
          new.category_id, new.category_type, new.created_at, new.description, new.purchase_date,
          new.closing_day, new.due_day, new.recurrence_id, new.occurrence_date)
         is not distinct from
         (old.id, old.household_id, old.debt_id, old.plan, old.seq, old.due_date, old.face,
          old.category_id, old.category_type, old.created_at, old.description, old.purchase_date,
          old.closing_day, old.due_day, old.recurrence_id, old.occurrence_date) then
    return new;
  end if;
  if current_setting('app.card_edit', true) = 'on'
     and (new.id, new.household_id, new.debt_id, new.plan, new.seq, new.due_date, new.category_id,
          new.category_type, new.created_at, new.description, new.purchase_date, new.closing_day,
          new.due_day, new.recurrence_id, new.occurrence_date, new.person_id, new.is_shared_expense)
         is not distinct from
         (old.id, old.household_id, old.debt_id, old.plan, old.seq, old.due_date, old.category_id,
          old.category_type, old.created_at, old.description, old.purchase_date, old.closing_day,
          old.due_day, old.recurrence_id, old.occurrence_date, old.person_id, old.is_shared_expense) then
    return new;
  end if;
  raise exception 'parcela é imutável: use o cancelamento' using errcode = '42501';
end $$;

-- Cria a compra no cartão e grava a classificação na mesma transação do banco.
create function public.card_purchase_at_classified(
  p_debt uuid, p_date date, p_total numeric, p_count integer, p_category uuid, p_description text,
  p_invoice_offset integer default 0, p_idem uuid default null,
  p_person_id uuid default null, p_is_shared_expense boolean default false
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_household uuid; v_plan uuid;
begin
  v_household := private.current_household();
  if (select auth.uid()) is null or v_household is null then
    raise exception 'não autenticado ou sem família' using errcode = '42501';
  end if;
  perform private.validate_person_scope(v_household, p_person_id, p_is_shared_expense);
  v_plan := public.card_purchase_at(p_debt, p_date, p_total, p_count, p_category, p_description, p_invoice_offset, p_idem);
  perform set_config('app.person_classification', 'on', true);
  update public.debt_installments
     set person_id = p_person_id, is_shared_expense = coalesce(p_is_shared_expense, false)
   where household_id = v_household and debt_id = p_debt and plan = v_plan::text;
  perform set_config('app.person_classification', 'off', true);
  return v_plan;
end $$;

-- Parcelamento em conta: usa a RPC financeira existente e atribui a mesma classificação a todas as parcelas,
-- mantendo a criação de valores/datas e a transação atômica no banco.
create function public.transaction_installments_create_classified(
  p_kind text, p_description text, p_total numeric, p_count integer, p_unit text, p_every integer, p_first date,
  p_account uuid, p_destination uuid default null, p_category uuid default null, p_first_paid boolean default false,
  p_person_id uuid default null, p_is_shared_expense boolean default false
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_household uuid; v_group uuid;
begin
  v_household := private.current_household();
  if (select auth.uid()) is null or v_household is null then
    raise exception 'não autenticado ou sem família' using errcode = '42501';
  end if;
  perform private.validate_person_scope(v_household, p_person_id, p_is_shared_expense);
  v_group := public.transaction_installments_create(
    p_kind, p_description, p_total, p_count, p_unit, p_every, p_first,
    p_account, p_destination, p_category, p_first_paid
  );
  update public.transactions
     set person_id = p_person_id, is_shared_expense = coalesce(p_is_shared_expense, false)
   where household_id = v_household and installment_group = v_group;
  return v_group;
end $$;

-- Mantém a assinatura antiga de recurrence_create para clientes antigos.
create function public.recurrence_create_classified(
  p_kind text, p_description text, p_amount numeric, p_day integer, p_start date,
  p_account uuid default null, p_destination uuid default null, p_debt uuid default null,
  p_category uuid default null, p_end date default null, p_freq_unit text default 'month',
  p_freq_every integer default 1, p_person_id uuid default null, p_is_shared_expense boolean default false
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_household uuid; v_id uuid;
begin
  v_household := private.current_household();
  if (select auth.uid()) is null or v_household is null then
    raise exception 'não autenticado ou sem família' using errcode = '42501';
  end if;
  perform private.validate_person_scope(v_household, p_person_id, p_is_shared_expense);
  v_id := public.recurrence_create(
    p_kind, p_description, p_amount, p_day, p_start, p_account, p_destination,
    p_debt, p_category, p_end, p_freq_unit, p_freq_every
  );
  update public.recurrences
     set person_id = p_person_id, is_shared_expense = coalesce(p_is_shared_expense, false)
   where household_id = v_household and id = v_id;
  return v_id;
end $$;

-- Edição da classificação de uma regra: atualiza ocorrências de conta ainda planejadas e parcelas de cartão
-- ainda não cobradas. Histórico já cobrado mantém a classificação que tinha quando foi lançado.
create function public.recurrence_set_person(
  p_id uuid, p_person_id uuid default null, p_is_shared_expense boolean default false
) returns void language plpgsql security definer set search_path = '' as $$
declare v_household uuid := private.current_household();
begin
  if (select auth.uid()) is null or v_household is null then
    raise exception 'não autenticado ou sem família' using errcode = '42501';
  end if;
  perform private.validate_person_scope(v_household, p_person_id, p_is_shared_expense);
  update public.recurrences
     set person_id = p_person_id, is_shared_expense = coalesce(p_is_shared_expense, false)
   where household_id = v_household and id = p_id;
  if not found then raise exception 'recorrente não encontrado' using errcode = '42501'; end if;
  update public.transactions
     set person_id = p_person_id, is_shared_expense = coalesce(p_is_shared_expense, false)
   where household_id = v_household and recurrence_id = p_id
     and status = 'planned' and deleted_at is null and date >= private.today_sp();
  perform set_config('app.person_classification', 'on', true);
  update public.debt_installments i
     set person_id = p_person_id, is_shared_expense = coalesce(p_is_shared_expense, false)
   where i.household_id = v_household and i.recurrence_id = p_id and i.due_date >= private.today_sp()
     and not exists (
       select 1 from public.debt_events e
        where e.household_id = i.household_id and e.installment_id = i.id
          and e.kind in ('charge', 'credit') and e.voided_at is null
     );
  perform set_config('app.person_classification', 'off', true);
end $$;

-- Atualização de regra e classificação numa única transação.
create function public.recurrence_update_classified(
  p_id uuid, p_description text, p_amount numeric, p_category uuid,
  p_person_id uuid default null, p_is_shared_expense boolean default false
) returns void language plpgsql security definer set search_path = '' as $
begin
  perform public.recurrence_update(p_id, p_description, p_amount, p_category);
  perform public.recurrence_set_person(p_id, p_person_id, p_is_shared_expense);
end $;

-- Relatório por competência: despesas à vista pela data do lançamento; cartão pelas cobranças/estornos
-- vinculados a uma fatura. Eventos payment/extra_principal não entram: são baixa de caixa, não despesa.
create function public.monthly_expenses_by_person(p_household uuid, p_from date, p_to date)
returns table (person_id uuid, person_name text, is_shared_expense boolean, total_spent numeric)
language sql stable security invoker set search_path = '' as $$
  with itens as (
    select t.person_id, t.is_shared_expense, t.amount as amount
      from public.transactions t
     where t.household_id = p_household and t.type = 'expense'
       and t.deleted_at is null and t.date between p_from and p_to
    union all
    select i.person_id, i.is_shared_expense,
           case when e.kind = 'credit' then -e.amount else e.amount end as amount
      from public.debt_events e
      join public.debt_installments i
        on i.household_id = e.household_id and i.id = e.installment_id
      join public.debt_invoices inv
        on inv.household_id = e.household_id and inv.id = e.invoice_id and inv.debt_id = e.debt_id
     where e.household_id = p_household and e.kind in ('charge', 'credit')
       and e.voided_at is null and e.date between p_from and p_to
  )
  select x.person_id, hp.name, x.is_shared_expense, sum(x.amount)
    from itens x
    left join public.household_people hp
      on hp.household_id = p_household and hp.id = x.person_id
   where (select private.is_member(p_household))
   group by x.person_id, hp.name, x.is_shared_expense
   order by sum(x.amount) desc, hp.name nulls last
$$;

revoke execute on function public.card_purchase_at_classified(uuid, date, numeric, integer, uuid, text, integer, uuid, uuid, boolean),
  public.transaction_installments_create_classified(text, text, numeric, integer, text, integer, date, uuid, uuid, uuid, boolean, uuid, boolean),
  public.recurrence_create_classified(text, text, numeric, integer, date, uuid, uuid, uuid, uuid, date, text, integer, uuid, boolean),
  public.recurrence_set_person(uuid, uuid, boolean),
  public.recurrence_update_classified(uuid, text, numeric, uuid, uuid, boolean),
  public.monthly_expenses_by_person(uuid, date, date)
from public, anon;
grant execute on function public.card_purchase_at_classified(uuid, date, numeric, integer, uuid, text, integer, uuid, uuid, boolean),
  public.transaction_installments_create_classified(text, text, numeric, integer, text, integer, date, uuid, uuid, uuid, boolean, uuid, boolean),
  public.recurrence_create_classified(text, text, numeric, integer, date, uuid, uuid, uuid, uuid, date, text, integer, uuid, boolean),
  public.recurrence_set_person(uuid, uuid, boolean),
  public.recurrence_update_classified(uuid, text, numeric, uuid, uuid, boolean),
  public.monthly_expenses_by_person(uuid, date, date)
to authenticated;
