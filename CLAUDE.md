# Tudo Azul — instruções para quem trabalha neste repositório

App de finanças da família: React + Vite + TypeScript + Tailwind + Supabase. Responda sempre em **português do Brasil**, direto e crítico (sem concordar por concordar).

## Mantenha o diário do projeto atualizado
A documentação viva está em `docs/projeto/` (comece por `00 - Início.md`). **Na mesma PR de cada mudança**, atualize o que ela tocou:
- `02 - Linha do tempo.md` — uma linha por PR mergeado, com número e data, na fase atual (use o histórico do `main`, nunca a memória).
- `40 - Pendências e próximos passos.md` — marque o que foi feito, acrescente o que surgiu.
- `21 - Banco de dados.md` — quando houver migration (número, arquivo, o que faz).
- `10 - Telas do app.md` — quando uma tela mudar.
- `30 - Decisões.md` — quando algo for decidido (com o motivo).
- `package.json` e `package-lock.json` — **a cada PR**: versão `AAAA.PR.0` (ano atual e `PR` = número da PR; ex.: PR #110 em 2026 = `2026.110.0`; ver `docs/VERSOES.md` e `03 - Edições e versões.md`).
Sem segredos, senhas, chaves nem dados reais nas notas.

## Regras que não podem quebrar (detalhes em `docs/projeto/20 - Regras do dinheiro.md`)
- Dinheiro em **centavos inteiros** no front; o front **não soma** dinheiro de relatório (vem do banco).
- **Nunca edite migration já aplicada**: mudança = migration nova (e atualize `supabase/tests/database/00_audit.test.sql` quando criar função).
- Produção do banco **só** pelo workflow "Supabase — aplicar migrations (produção)": simular → ler o log → aplicar (confirmação `APLICAR`), e só com o "pode" do dono.
- A conferência manual com extrato está descontinuada: não reintroduzir tela, ações, RPCs de escrita ou travas. `account_reconciliations` e `transactions.reconciliation_id` permanecem somente para histórico/exportação.
- **Merge só com o "pode" do dono**, com a trava do commit exato; PR nasce rascunho e confirma o CI verde e a ausência de conflito antes.
- Todo conserto vem com teste que **falha sem a correção**.
- Nunca colar nem aceitar senha, chave secreta ou `service_role`; nada de dado real em teste.
