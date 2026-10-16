-- Tudo Azul — migration 001 (1/5): schema do núcleo financeiro
-- Desenho: docs/MODELO-DE-DADOS.md (v3) e docs/MIGRATION-001-PLANO.md.
-- Esta migration só cria estruturas e constraints. Triggers, segurança (RLS e
-- privilégios), RPCs e relatórios vêm nas migrations seguintes.

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- Chaves estrangeiras entre tabelas filhas: ON DELETE NO ACTION (padrão) e
-- DEFERRABLE INITIALLY IMMEDIATE. Em uso normal são verificadas ao fim de cada
-- instrução; delete_household() as adia até o commit para que a exclusão em
-- cascata da família inteira não dependa da ordem em que o PostgreSQL apaga as
-- tabelas filhas.
--
-- Regra de dinheiro (N2): numeric SEM modificador, para que um valor com mais
-- de 2 casas seja RECUSADO (e não arredondado em silêncio, como faria
-- numeric(14,2)). Em cada coluna monetária:
--     check (x = round(x, 2) and abs(x) < 1e12)
-- 1.2300 é aceito (igual a 1.23); 1.005 é recusado. NaN e Infinity falham em
-- abs(x) < 1e12. A normalização para escala 2 é feita pelos triggers de guarda,
-- que rodam antes dos CHECK.
-- ---------------------------------------------------------------------------

create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now()
);

create table public.households (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(name) between 1 and 80),
  member_limit smallint not null default 2 check (member_limit between 1 and 10),
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);

create table public.household_members (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  role         text not null check (role in ('owner', 'member')),
  joined_at    timestamptz not null default now(),
  unique (household_id, user_id),
  unique (user_id) -- N1: um usuário, uma família (relaxável por migration futura)
);

create table public.invitations (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  email        text not null check (email = lower(email) and char_length(email) between 3 and 254),
  token_hash   text not null unique,
  role         text not null default 'member' check (role = 'member'),
  invited_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  accepted_at  timestamptz,
  accepted_by  uuid references public.profiles (id) on delete set null,
  check (expires_at > created_at)
);
create index invitations_household_idx on public.invitations (household_id);

create table public.accounts (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references public.households (id) on delete cascade,
  name            text not null check (char_length(btrim(name)) between 1 and 60),
  type            text not null check (type in ('checking', 'savings', 'cash', 'other')),
  initial_balance numeric not null default 0
                  check (initial_balance = round(initial_balance, 2) and abs(initial_balance) < 1e12),
  opening_date    date not null check (opening_date between date '2000-01-01' and date '2100-01-01'),
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (household_id, id)
);
create unique index accounts_name_uq on public.accounts (household_id, lower(btrim(name)));

create table public.categories (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name         text not null check (char_length(btrim(name)) between 1 and 60),
  type         text not null check (type in ('income', 'expense')),
  parent_id    uuid,
  system_key   text check (system_key in ('uncategorized')),
  color        text check (color ~ '^#[0-9a-fA-F]{6}$'),
  icon         text check (char_length(icon) <= 40),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (household_id, id, type),
  -- a subcategoria tem o mesmo tipo da categoria mãe e é da mesma família
  constraint categories_parent_fk foreign key (household_id, parent_id, type)
    references public.categories (household_id, id, type) deferrable initially immediate,
  check (system_key is null or parent_id is null)
);
create index categories_parent_idx on public.categories (household_id, parent_id);
create unique index categories_name_uq on public.categories (
  household_id, type, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name))
);
-- no máximo uma "Sem categoria" por (família, tipo)
create unique index categories_uncategorized_uq on public.categories (household_id, type)
  where system_key = 'uncategorized';

create table public.transactions (
  id                     uuid primary key default gen_random_uuid(),
  household_id           uuid not null references public.households (id) on delete cascade,
  account_id             uuid not null,
  destination_account_id uuid,
  category_id            uuid,
  type                   text not null check (type in ('income', 'expense', 'transfer')),
  description            text not null default '' check (char_length(description) <= 200),
  amount                 numeric not null
                         check (amount > 0 and amount = round(amount, 2) and abs(amount) < 1e12),
  date                   date not null check (date between date '2000-01-01' and date '2100-01-01'),
  status                 text not null default 'paid' check (status in ('paid', 'planned')),
  notes                  text check (char_length(notes) <= 1000),
  created_by             uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz,
  -- Forma do lançamento (decisão 10: categoria obrigatória em receita/despesa,
  -- garantida por CHECK explícito e não só pela FK, que ignora colunas nulas).
  constraint transactions_shape check (
       (type = 'transfer'
          and destination_account_id is not null
          and destination_account_id <> account_id
          and category_id is null)
    or (type in ('income', 'expense')
          and destination_account_id is null
          and category_id is not null)
  ),
  -- Integridade entre famílias: conta, destino e categoria só da mesma família;
  -- a categoria precisa ter o mesmo tipo do lançamento.
  constraint transactions_account_fk foreign key (household_id, account_id)
    references public.accounts (household_id, id) deferrable initially immediate,
  constraint transactions_destination_fk foreign key (household_id, destination_account_id)
    references public.accounts (household_id, id) deferrable initially immediate,
  constraint transactions_category_fk foreign key (household_id, category_id, type)
    references public.categories (household_id, id, type) deferrable initially immediate
);
create index transactions_hh_date_idx on public.transactions (household_id, date) where deleted_at is null;
create index transactions_account_idx on public.transactions (household_id, account_id, date) where deleted_at is null;
create index transactions_destination_idx on public.transactions (household_id, destination_account_id, date)
  where destination_account_id is not null and deleted_at is null;
create index transactions_category_idx on public.transactions (household_id, category_id, date) where deleted_at is null;

create table public.budgets (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  category_id   uuid not null,
  -- fixo em 'expense': a FK composta abaixo só aceita categoria de despesa
  category_type text not null default 'expense' check (category_type = 'expense'),
  month         date not null check (extract(day from month) = 1
                                     and month between date '2000-01-01' and date '2100-01-01'),
  amount_limit  numeric not null
                check (amount_limit > 0 and amount_limit = round(amount_limit, 2) and abs(amount_limit) < 1e12),
  created_at    timestamptz not null default now(),
  unique (household_id, category_id, month),
  constraint budgets_category_fk foreign key (household_id, category_id, category_type)
    references public.categories (household_id, id, type) deferrable initially immediate
);
create index budgets_month_idx on public.budgets (household_id, month);
