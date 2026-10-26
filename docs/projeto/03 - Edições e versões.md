---
tags: [tudo-azul, versao]
---
# Edições e versões

Formato: **`AAAA.E`** — ano e edição (hoje: **2026.1**).

- A **edição** sobe quando um lote visível para você chega à produção e você o testa no app. Recomeça em 1 a cada ano. Correção pequena não sobe edição.
- Fica em `package.json` como `2026.1.0` (o 3º número é sempre `0`; o npm exige três).
- O app mostra a versão na barra lateral, na tela Família e nas telas de entrada. No deploy aparece também o **commit** (ex.: `2026.1 · 3c68010`), útil para saber qual build está rodando.
- Regra e histórico no repositório: `docs/VERSOES.md`.

## Próxima
**2026.2** — candidato natural: painel novo (#48) + robustez (#50) + menu (#54). *Aguardando seu aval.*
