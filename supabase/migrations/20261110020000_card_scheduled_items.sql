-- Tudo Azul — recorrência no cartão estilo Organizze, etapa 1: a tabela dos itens agendados
--
-- Decisões do dono (10/11/2026, docs/projeto/28): as recorrências de cartão aparecem já lançadas nas faturas futuras
-- (como no Organizze), entram no total da fatura, e só ocupam o limite quando a fatura ANTERIOR fecha. Mudar ou cancelar
-- pergunta "só esta" / "esta e as próximas". Parcela (debt_installments) é imutável, então a ocorrência futura vive aqui
-- e só vira parcela no fechamento da fatura anterior (etapa 3).
--
-- Esta migration só cria a tabela. Nada a preenche ainda (etapa 2) e nenhuma função a lê: não muda fatura, limite,
-- projeção, Dinheiro Livre nem Orçamentos.
--
-- Escrita só por funções (etapas seguintes); o cliente só lê, pela RLS da família.
-- status: scheduled (aguardando o fechamento da fatura anterior), cancelled ("só esta" cancelada), converted (virou a
-- parcela installment_id).

create table public.card_scheduled_items (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references public.households (id) on delete cascade,
  debt_id         uuid not null,
  recurrence_id   uuid not null references public.recurrences (id) on delete cascade,
  -- a data da ocorrência na série da regra (chave contra duplicar, como em debt_installments)
  occurrence_date date not null,
  -- dia da cobrança (pode diferir de occurrence_date quando a pessoa muda "só esta")
  charge_date     date not null,
  -- fechamento da fatura em que o item entra
  closing_date    date not null,
  amount          numeric not null check (amount > 0 and amount = round(amount, 2) and amount < 1e12),
  description     text not null check (char_length(btrim(description)) between 1 and 80),
  category_id     uuid not null,
  category_type   text not null default 'expense' check (category_type = 'expense'),
  status          text not null default 'scheduled' check (status in ('scheduled', 'cancelled', 'converted')),
  -- true quando a pessoa editou só esta ocorrência: a geração a partir da regra não sobrescreve
  edited          boolean not null default false,
  installment_id  uuid references public.debt_installments (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint card_scheduled_items_occurrence_uq unique (recurrence_id, occurrence_date),
  constraint card_scheduled_items_debt_fk foreign key (household_id, debt_id)
    references public.debts (household_id, id) on delete cascade deferrable initially immediate,
  constraint card_scheduled_items_category_fk foreign key (household_id, category_id, category_type)
    references public.categories (household_id, id, type) deferrable initially immediate
);
create index card_scheduled_items_invoice_idx on public.card_scheduled_items (debt_id, closing_date) where status = 'scheduled';
create index card_scheduled_items_hh_idx on public.card_scheduled_items (household_id);
create index card_scheduled_items_installment_idx on public.card_scheduled_items (installment_id) where installment_id is not null;

alter table public.card_scheduled_items enable row level security;
grant select on public.card_scheduled_items to authenticated;
create policy card_scheduled_items_select on public.card_scheduled_items for select to authenticated
  using ((select private.is_member(household_id)));
