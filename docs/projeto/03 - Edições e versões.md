---
tags: [tudo-azul, versao]
---
# Edições e versões

Formato: **`AAAA.E`** — ano e edição (hoje: **2026.3**).

- A **edição** sobe quando um lote visível para você chega à produção e você o testa no app. Recomeça em 1 a cada ano. Correção pequena não sobe edição.
- Fica em `package.json` como `2026.3.0` (o 3º número é sempre `0`; o npm exige três).
- O app mostra a versão na barra lateral, na tela Família e nas telas de entrada. No deploy aparece também o **commit** (ex.: `2026.3 · …`), útil para saber qual build está rodando.
- Regra e histórico no repositório: `docs/VERSOES.md`.

## Histórico
- **2026.1** — primeira edição numerada (lançamentos, contas, cartões, recorrentes, orçamentos, projeção, CSV, correções da auditoria).
- **2026.2** — painel novo, robustez do front, menu em grupos, ocultar valores, dependências atualizadas, diário do projeto.
- **2026.3** — redesenho visual pelo design system (painéis, Lançamentos compacto, ações rápidas com ícone, contraste dos campos) e Calendário do mês.

## Próxima
Sem data. Sobe quando o próximo lote visível chegar à produção e você testar.
