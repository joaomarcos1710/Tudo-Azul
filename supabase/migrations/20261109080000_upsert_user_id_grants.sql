-- Preferências e aviso diário: o front salva com upsert (onConflict: 'user_id'). O PostgREST traduz isso em
-- INSERT ... ON CONFLICT (user_id) DO UPDATE SET <todas as colunas do payload> = EXCLUDED.<coluna>, inclusive
-- user_id. O Postgres exige UPDATE em toda coluna do SET (checa no planejamento, mesmo sem conflito), e o grant de
-- UPDATE das duas tabelas não incluía user_id: salvar devolvia 42501 (mesma classe do bug dos lançamentos, 079).
-- Em produção as duas tabelas estavam vazias (09/11/2026). A segurança continua nas policies: o WITH CHECK
-- (user_id = auth.uid()) impede mover a linha para outro usuário. Teste: pgTAP 85.

grant update (user_id) on public.user_preferences to authenticated;
grant update (user_id) on public.daily_digest_settings to authenticated;
