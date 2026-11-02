-- Tudo Azul — migration 035: proventos de investimento (dividendo, JCP, rendimento)
--
-- Pedido do dono (02/11/2026), a partir do protótipo de tela, e decisões dele para esta etapa:
--   1. O provento entra como RECEITA NA CONTA (lançamento de receita, pago ou planejado), ligado ao ativo.
--   2. O valor informado é o LÍQUIDO, o que caiu na conta (o app não calcula nem registra imposto).
--
-- Por que não há dupla contagem: o dinheiro vive em UM lugar, a linha de transactions. A tabela nova
-- (investment_distributions) é só o vínculo "este lançamento é provento deste ativo" e não tem valor próprio. Por isso:
--   * period_summary, saldos, calendário, extrato e relatórios enxergam o provento como qualquer receita;
--   * o total por ativo (investment_income_by_asset) soma as próprias linhas de transactions, ignorando a lixeira;
--   * excluir o lançamento (lixeira) tira o provento do total do ativo; apagar de vez apaga o vínculo (cascade).
--
-- O que esta migration acrescenta (nada é alterado nem apagado nas migrations anteriores):
--   1. investment_distributions: vínculo ativo × lançamento + tipo (dividend, jcp, income). Sem escrita direta do cliente.
--   2. investment_distribution_record(...): cria o lançamento de receita e o vínculo numa transação só (atômico).
--      Os gatilhos de integridade de transactions continuam valendo (conta aberta na data, período já conciliado...).
--   3. investment_income_by_asset(p_household, p_from, p_to): recebido (pago) e previsto (planejado) por ativo.
--
-- Limites desta fase:
--   * Só ativos em BRL: as contas ainda são só em BRL (fase 1 do multimoeda). Provento de ativo em USD/EUR é recusado (22023)
--     em vez de ser lançado numa conta com a moeda errada.
--   * Categoria: a "Rendimentos" da família (a padrão); se ela não existir, "Sem categoria". Quem quiser outra, edita o lançamento.
--   * A "Rendimentos" padrão não é marcada como receita eventual: isso é escolha da pessoa (Categorias).
-- Códigos de erro: 42501 não autenticado ou ativo/conta de outra família ou inexistente; 22023 dados inválidos;
-- 55000 ativo arquivado.

create table public.investment_distributions (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references public.households(id) on delete cascade,
  asset_id       uuid not null,
  transaction_id uuid not null unique references public.transactions(id) on delete cascade,
  kind           text not null check (kind in ('dividend', 'jcp', 'income')),
  created_by     uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at     timestamptz not null default now(),
  constraint investment_distributions_asset_fk foreign key (household_id, asset_id)
    references public.investment_assets(household_id, id) deferrable initially immediate
);
create index investment_distributions_asset_idx on public.investment_distributions(household_id, asset_id);

alter table public.investment_distributions enable row level security;
create policy investment_distributions_select on public.investment_distributions
  for select to authenticated using ((select private.is_member(household_id)));
revoke all on public.investment_distributions from public, anon, authenticated;
grant select on public.investment_distributions to authenticated;

create function public.investment_distribution_record(
  p_asset uuid, p_kind text, p_date date, p_amount numeric, p_account uuid,
  p_status text default 'paid', p_notes text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_asset public.investment_assets%rowtype;
  v_category uuid;
  v_tx uuid;
  v_label text;
begin
  if auth.uid() is null then raise exception 'não autenticado' using errcode = '42501'; end if;
  select * into v_asset from public.investment_assets where id = p_asset for share;
  if not found or not private.is_member(v_asset.household_id) then
    raise exception 'ativo não encontrado' using errcode = '42501';
  end if;
  if not v_asset.active then raise exception 'ativo arquivado' using errcode = '55000'; end if;
  if v_asset.currency_code <> 'BRL' then
    raise exception 'provento em conta só para ativos em BRL nesta fase (as contas ainda são só em reais)' using errcode = '22023';
  end if;
  if p_kind not in ('dividend', 'jcp', 'income') or p_status not in ('paid', 'planned')
     or p_date is null or p_date < date '2000-01-01' or p_date > date '2100-01-01'
     or p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) or abs(p_amount) >= 1e12
     or (p_notes is not null and char_length(p_notes) > 500) then
    raise exception 'dados do provento inválidos' using errcode = '22023';
  end if;
  if p_status = 'paid' and p_date > private.today_sp() then
    raise exception 'provento pago não pode ter data futura: use planejado' using errcode = '22023';
  end if;
  if p_account is null or not exists (
       select 1 from public.accounts a where a.id = p_account and a.household_id = v_asset.household_id and a.active) then
    raise exception 'conta não encontrada' using errcode = '42501';
  end if;

  select c.id into v_category from public.categories c
   where c.household_id = v_asset.household_id and c.type = 'income' and c.active
     and c.parent_id is null and c.system_key is null and lower(btrim(c.name)) = 'rendimentos'
   limit 1;
  if v_category is null then
    select c.id into v_category from public.categories c
     where c.household_id = v_asset.household_id and c.type = 'income' and c.system_key = 'uncategorized';
  end if;

  v_label := case p_kind when 'dividend' then 'Dividendos' when 'jcp' then 'JCP' else 'Rendimentos' end;
  insert into public.transactions (household_id, account_id, category_id, type, description, amount, date, status, notes)
  values (v_asset.household_id, p_account, v_category, 'income', left(v_label || ' · ' || v_asset.name, 200),
          p_amount, p_date, p_status, p_notes)
  returning id into v_tx;

  insert into public.investment_distributions (household_id, asset_id, transaction_id, kind)
  values (v_asset.household_id, v_asset.id, v_tx, p_kind);
  return v_tx;
end $$;

-- Recebido (pago) e previsto (planejado) por ativo no período. Lançamento na lixeira não conta.
create function public.investment_income_by_asset(p_household uuid, p_from date, p_to date)
returns table (asset_id uuid, name text, currency_code text, received numeric, planned numeric, last_received date)
language sql stable security invoker set search_path = '' as $$
  select a.id, a.name, a.currency_code,
         coalesce(sum(t.amount) filter (where t.status = 'paid'), 0),
         coalesce(sum(t.amount) filter (where t.status = 'planned'), 0),
         max(t.date) filter (where t.status = 'paid')
    from public.investment_distributions d
    join public.transactions t on t.id = d.transaction_id and t.household_id = d.household_id and t.deleted_at is null
    join public.investment_assets a on a.id = d.asset_id and a.household_id = d.household_id
   where d.household_id = p_household and t.date between p_from and p_to
     and (select private.is_member(p_household))
   group by a.id, a.name, a.currency_code
   order by 4 desc, a.name
$$;

revoke execute on function public.investment_distribution_record(uuid, text, date, numeric, uuid, text, text),
  public.investment_income_by_asset(uuid, date, date) from public, anon;
grant execute on function public.investment_distribution_record(uuid, text, date, numeric, uuid, text, text),
  public.investment_income_by_asset(uuid, date, date) to authenticated;
