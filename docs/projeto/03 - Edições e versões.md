---
tags: [tudo-azul, versao]
---
# Edições e versões

Formato: **`AAAA.N`** — o **ano** e o **número da PR** que trouxe a mudança (hoje: **2026.99**).

- **Desde 30/10/2026** a versão acompanha o maior número de PR já integrado. Em cada PR, use `AAAA.N.0` com `N` = maior valor entre o número da PR atual e a versão que já está na `main` (o 3º número é sempre `0`; o npm exige três). Assim, mesclar PRs fora de ordem nunca reduz a versão. Quando o ano mudar, o ano muda e a sequência de PRs continua.
- O app mostra a versão na barra lateral, na tela Família e nas telas de entrada. No deploy aparece também o **commit** (ex.: `2026.99 · …`), útil para saber qual build está rodando.
- Regra completa no repositório: `docs/VERSOES.md`.

## Histórico das edições antigas (até 2026.5)
- **2026.1** — primeira edição numerada (lançamentos, contas, cartões, recorrentes, orçamentos, projeção, CSV, correções da auditoria).
- **2026.2** — painel novo, robustez do front, menu em grupos, ocultar valores, dependências atualizadas, diário do projeto.
- **2026.3** — redesenho visual pelo design system (painéis, Lançamentos compacto, ações rápidas com ícone, contraste dos campos) e Calendário do mês.
- **2026.4** — recorrências com frequência (semanal a anual) e redesenho parte 2: cabeçalho padrão nas telas e Cartões com a fatura em destaque.
- **2026.5** — menu "Mais" com atalhos, formulário de lançamento em visual de app, fatura como extrato, ícone e cor de categoria, subcategoria sob a principal, banco/emissor/bandeira gravados com logos (migration 017) e excluir recorrente (migration 018).
