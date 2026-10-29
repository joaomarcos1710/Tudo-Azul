# Versões do Tudo Azul

Formato: **`AAAA.E`** — ano e edição (ex.: `2026.1`, `2026.2`, `2026.3`, `2026.4`, `2026.5`).

- **Edição (`E`)**: sobe 1 a cada lote de entregas que chega à produção e que o dono vai usar de verdade
  (várias PRs juntas contam como uma edição). Recomeça em 1 a cada ano.
- **Onde fica**: `package.json` → `"version": "AAAA.E.0"` (o 3º número fica sempre `0`, só existe porque o npm exige
  três). O app mostra `AAAA.E` na barra lateral, na tela de Família e nas telas de entrada; no deploy da Vercel
  aparece também o commit curto (`2026.1 · 98e83d0`).
- **Quando subir**: na mesma PR que fecha a edição (ou numa PR só com `package.json` + este arquivo), nunca no meio
  de uma PR de funcionalidade.
- **Migrations** têm numeração própria (001, 002…) e continuam sem ser editadas depois de aplicadas.

## Histórico

| Edição | O que entrou |
|---|---|
| 2026.1 | Primeira edição numerada: lançamentos, contas com conferência de extrato, cartões (limite, fatura, parcelas), recorrentes, categorias, orçamentos, projeção do mês, exportação CSV, painel e correções da auditoria (migration 014). |
| 2026.2 | Painel novo (ações rápidas, vencidos, cartões e conferência de saldo na Visão geral); robustez do front (respostas velhas, envio duplicado, pagar fatura, PWA v2); menu em grupos com "Mais" no celular; ocultar valores; dependências Vite 8 / Vitest 5 com auditoria de produção no CI; filtros de Lançamentos por tipo; diário do projeto em `docs/projeto/`. |
| 2026.3 | Redesenho visual pelo design system "Tudo Azul": painéis sem padding dobrado, títulos de mês com maiúscula certa, lista de Lançamentos compacta (valor na linha da descrição, Excluir discreto, totais em linhas no celular), ações rápidas do Início com ícone, contorno de campos com contraste; Calendário do mês (#62). |
| 2026.4 | Recorrências com frequência (semanal, quinzenal, mensal, bimestral, trimestral, semestral, anual e personalizada; migration 016, #65/#66); redesenho parte 2: cabeçalho padrão em todas as telas (título, descrição curta e ações à direita) e Cartões com a fatura a pagar em destaque e a ação principal que muda com ela. |
| 2026.5 | Finalizar recorrente exclui a regra em vez de arquivá-la; planejados futuros não pagos vão para a lixeira, enquanto lançamentos históricos, pagamentos e parcelas de cartão já geradas são preservados (migration 018). |
