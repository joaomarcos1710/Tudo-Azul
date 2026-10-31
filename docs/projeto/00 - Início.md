---
tags: [tudo-azul, indice]
atualizado: 2026-10-31
---
# Tudo Azul — mapa do projeto

App web de finanças da família (React + Vite + TypeScript + Tailwind + Supabase). Produção: https://tudo-azul.vercel.app · versão preparada nesta PR: **2026.110** (ver [[03 - Edições e versões]]).

## Como ler (em ordem)
1. [[01 - Visão e metas]] — para que o app existe e quando ele substitui o Organizze.
2. [[02 - Linha do tempo]] — **o passo a passo** do que foi feito, dia a dia, PR por PR.
3. [[10 - Telas do app]] — o que cada tela faz hoje.
4. [[20 - Regras do dinheiro]] — as regras que não podem quebrar.
5. [[21 - Banco de dados]] — as migrations, uma a uma (main até 030; esta PR prepara 031, sem aplicar em produção).
6. [[22 - Segurança]] · [[23 - Qualidade e testes]] · [[24 - Deploy e operação]]
7. [[Auditorias/2026-10-26 Auditoria]] — o que os agentes acharam e o que foi corrigido.
8. [[30 - Decisões]] — por que foi feito de cada jeito.
9. [[40 - Pendências e próximos passos]] — o que falta.
10. [[50 - Ideias e comparações]] · [[25 - Guia GitHub passo a passo]] · [[90 - Glossário]]

## Como esta documentação é mantida
Fica no repositório, em `docs/projeto/`, e é atualizada **na mesma PR** de cada mudança (regra no `CLAUDE.md`): linha do tempo, pendências, banco (quando há migration) e versão (quando muda a edição). Os links `[[assim]]` funcionam no Obsidian (abra esta pasta como cofre); no GitHub aparecem como texto.

## Em uma linha
O app inclui contas, cartões, recorrentes, dívidas, investimentos manuais, relatórios, projeção e exportação. A conferência manual foi retirada na PR #110; registros antigos ficam somente para leitura/exportação. A fase 1 multimoeda é fundação, sem habilitar contas estrangeiras.
