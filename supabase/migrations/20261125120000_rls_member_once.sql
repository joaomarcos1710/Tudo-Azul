-- Migration 149: a regra de acesso (RLS) confere a família UMA vez por consulta, não uma vez por linha.
--
-- Medição em produção (25/11/2026, uma família, 24 MB): as policies eram
--     using ((select private.is_member(household_id)))
-- e, como o argumento é a coluna da linha, o PostgreSQL chamava a função (uma consulta em household_members) para CADA
-- linha lida. Ler 5.339 linhas de debt_events custava 112 ms com a policy e 1 ms sem ela. Como toda função de saldo lê as
-- mesmas tabelas várias vezes, o custo se multiplicava: debt_balances 592 ms (20 ms sem a policy), net_worth 1.859 ms
-- (111 ms), cash_flow_series 1.394 ms (244 ms). Com dezenas de consultas por tela, o banco saturava.
--
-- O que muda:
--   * private.my_households(): as famílias de quem está perguntando, num array. Mesma regra de private.is_member (inclusive a
--     leitura de serviço da 098: service_role com app.service_read = 'on' enxerga todas).
--   * Toda policy cuja condição é exatamente "is_member(household_id)" passa a ser
--         household_id = any ((select private.my_households())::uuid[])
--     O subselect não depende da linha: roda uma vez por consulta e o resultado vale para todas as linhas.
--   * households_select (a coluna é id, não household_id) muda do mesmo jeito.
-- O que NÃO muda: quem enxerga o quê. Uma linha passa na condição nova se, e só se, passava na antiga. As policies de
-- inserção que também conferem created_by/user_id ficam como estão (uma linha por vez: não pesam). private.is_member
-- continua existindo e sendo usado dentro das funções (lá o argumento é fixo e já roda uma vez só).

create function private.my_households() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select case
    when coalesce((select auth.role()) = 'service_role', false)
         and coalesce(current_setting('app.service_read', true), '') = 'on'
      then coalesce((select array_agg(h.id) from public.households h), '{}'::uuid[])
    else coalesce((select array_agg(m.household_id) from public.household_members m
                    where m.user_id = (select auth.uid())), '{}'::uuid[])
  end
$$;
revoke execute on function private.my_households() from public, anon;
grant execute on function private.my_households() to authenticated;

-- Troca em todas as policies do padrão exato. Feito por laço para não esquecer nenhuma tabela; o que foi trocado é
-- conferido logo abaixo e no teste 143.
do $$
declare
  r record;
  v_padrao constant text := '^\( SELECT private\.is_member\([a-z_]+\.household_id\) AS is_member\)$';
  v_nova constant text := 'household_id = any ((select private.my_households())::uuid[])';
  v_sql text;
begin
  for r in
    select p.schemaname, p.tablename, p.policyname,
           coalesce(p.qual ~ v_padrao, false) as troca_using,
           coalesce(p.with_check ~ v_padrao, false) as troca_check
      from pg_catalog.pg_policies p
     where p.schemaname = 'public'
       and (coalesce(p.qual ~ v_padrao, false) or coalesce(p.with_check ~ v_padrao, false))
     order by p.tablename, p.policyname
  loop
    v_sql := format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    if r.troca_using then v_sql := v_sql || format(' using (%s)', v_nova); end if;
    if r.troca_check then v_sql := v_sql || format(' with check (%s)', v_nova); end if;
    execute v_sql;
  end loop;

  if exists (select 1 from pg_catalog.pg_policies p
              where p.schemaname = 'public' and (p.qual ~ v_padrao or p.with_check ~ v_padrao)) then
    raise exception 'sobrou policy conferindo a família linha por linha';
  end if;
end $$;

alter policy households_select on public.households
  using (id = any ((select private.my_households())::uuid[]));
