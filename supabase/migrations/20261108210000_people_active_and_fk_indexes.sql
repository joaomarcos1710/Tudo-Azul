-- Tudo Azul — migration 083: endurece a classificação por pessoa e corrige índices de FK.
-- Pessoas inativas continuam preservadas no histórico, mas não podem ser atribuídas
-- a novos lançamentos, parcelas ou regras recorrentes.
-- Não altera valores, datas, saldos, faturas ou eventos financeiros.

create or replace function private.validate_person_scope(
  p_household uuid,
  p_person uuid,
  p_shared boolean
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(p_shared, false) and p_person is not null then
    raise exception 'despesa compartilhada não pode ter pessoa individual'
      using errcode = '23514';
  end if;

  if p_person is not null and not exists (
    select 1
      from public.household_people hp
     where hp.household_id = p_household
       and hp.id = p_person
       and hp.status = true
  ) then
    raise exception 'pessoa inativa, não encontrada ou de outra família'
      using errcode = '23514';
  end if;
end
$$;

-- Defesa no próprio banco, inclusive para INSERT/UPDATE direto via PostgREST.
-- Uma pessoa inativa já vinculada pode permanecer no histórico; a regra impede
-- apenas novas atribuições ou trocas para uma pessoa inativa.
create or replace function private.guard_person_active()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.person_id is not null
     and (
       tg_op = 'INSERT'
       or new.person_id is distinct from old.person_id
       or new.household_id is distinct from old.household_id
     )
     and not exists (
       select 1
         from public.household_people hp
        where hp.household_id = new.household_id
          and hp.id = new.person_id
          and hp.status = true
     ) then
    raise exception 'pessoa inativa, não encontrada ou de outra família'
      using errcode = '23514';
  end if;

  return new;
end
$$;

revoke execute on function private.guard_person_active() from public, anon, authenticated;

create trigger transactions_guard_person_active
  before insert or update of person_id, household_id on public.transactions
  for each row execute function private.guard_person_active();

create trigger debt_installments_guard_person_active
  before insert or update of person_id, household_id on public.debt_installments
  for each row execute function private.guard_person_active();

create trigger recurrences_guard_person_active
  before insert or update of person_id, household_id on public.recurrences
  for each row execute function private.guard_person_active();

-- Prefixo (household_id, person_id) cobre a FK composta e ainda permite
-- filtrar por período sem deixar a coluna de data no meio da chave.
drop index if exists public.transactions_person_period_idx;
create index transactions_person_period_idx
  on public.transactions (household_id, person_id, date)
  where type = 'expense' and deleted_at is null;

drop index if exists public.debt_installments_person_period_idx;
create index debt_installments_person_period_idx
  on public.debt_installments (household_id, person_id, due_date);
