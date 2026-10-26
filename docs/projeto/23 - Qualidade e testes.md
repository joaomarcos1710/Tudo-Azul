---
tags: [tudo-azul, testes]
---
# Qualidade e testes

- **Front:** 240 testes (Vitest) · typecheck · build.
- **Banco:** 22 arquivos pgTAP (`supabase/tests/database/`), incluindo `00_audit` (lista exata de funções e privilégios) e testes de isolamento, integridade, saldos, orçamento, cartão, conciliação, recorrência, reset, limite, projeção e auditoria.
- **CI (GitHub Actions):** job "Typecheck, tests e build" (+ `npm audit` de produção) e job "Migrations, pgTAP e integração" (Postgres + Supabase local).
- **Vercel:** um preview por PR — dá para testar no celular antes do merge.

## Como se prova um conserto
1. Escrever o teste que **reproduz** o erro.
2. Ver o teste **falhar** sem a correção.
3. Aplicar a correção e ver **passar**.
(Foi assim no bug do saldo de referência, na corrida que abria em Família e nos filtros de Lançamentos.)

## Agentes do projeto (`.claude/agents`)
- `conferente-saldos` — confere saldos contra extrato/fatura.
- `revisor-dinheiro` — revisa PRs atrás de bugs de valor e quebras de regra do banco.
- `testador-banco` — escreve e roda pgTAP e reproduz bugs.
- `pesquisador-produto` — pesquisa apps e projetos open source para ideias.
