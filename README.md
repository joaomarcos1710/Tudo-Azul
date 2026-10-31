# Tudo Azul

Controle financeiro familiar (React + TypeScript + Tailwind + Supabase). Plano completo em [`docs/PLANO.md`](docs/PLANO.md).

## Rodar localmente
```bash
npm install
cp .env.example .env.local   # preencher quando o Supabase estiver criado (etapa 2)
npm run dev
```

## Scripts
- `npm run dev` — servidor de desenvolvimento
- `npm run typecheck` — checagem de tipos
- `npm test` — testes (Vitest)
- `npm run build` — build de produção

## Status
Em uso: contas, cartões, recorrentes, dívidas, investimentos manuais, orçamentos, relatórios, projeção e exportação CSV. A conferência manual com extrato foi descontinuada; os registros antigos continuam preservados para leitura e exportação. Versão `AAAA.PR` (ver [`docs/VERSOES.md`](docs/VERSOES.md)).

O **diário do projeto** (linha do tempo, telas, banco, decisões e pendências) está em [`docs/projeto/`](docs/projeto/00%20-%20In%C3%ADcio.md) e é atualizado a cada PR.
