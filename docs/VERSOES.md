# Versões do Tudo Azul

Formato: **`AAAA.N`** — o **ano** em que estamos e o **número da PR** (do GitHub) que trouxe a mudança.
Exemplo: a PR #98, aberta em 2026, vira `2026.98`. Quando o ano mudar, o ano muda e o número da PR continua a sequência
do GitHub (ex.: `2027.130`).

- **A cada PR** (de funcionalidade, correção, teste ou diário), na própria PR: `package.json` e `package-lock.json` →
  `"version": "AAAA.N.0"`, com `N` = número da PR. O 3º número fica sempre `0` (só existe porque o npm exige três).
  Como o número da PR só existe depois que ela é aberta, confira o número antes de abrir (o próximo da lista do
  GitHub) e corrija com um commit se errar.
- **Onde aparece**: o app mostra `AAAA.N` na barra lateral, na tela de Família e nas telas de entrada; no deploy da
  Vercel aparece também o commit curto (`2026.98 · 98e83d0`).
- **Merge fora de ordem:** a versão nunca diminui. Ao mesclar a PR #N, use o maior valor entre N e a versão já integrada
  na `main`. Uma PR mais antiga que a versão atual mantém a versão atual; uma PR mais nova avança para seu próprio número.
  Exemplo: se a PR #98 já entrou, a PR #97 mantém `2026.98.0`; a PR #99 usa `2026.99.0`.
- **Migrations** têm numeração própria (001, 002…) e continuam sem ser editadas depois de aplicadas.

## Antes (até 2026.5): edições

Até a PR #93 o formato era `AAAA.E` (ano e edição, 1 a cada lote de entregas ao dono: `2026.1` a `2026.5`). Em 30/10/2026
o dono trocou a regra para o número da PR (decisão registrada em `docs/projeto/30 - Decisões.md`). As edições antigas
continuam abaixo como histórico.

## Histórico das edições (2026.1 a 2026.5)

| Edição | O que entrou |
|---|---|
| 2026.1 | Primeira edição numerada: lançamentos, contas com conferência de extrato, cartões (limite, fatura, parcelas), recorrentes, categorias, orçamentos, projeção do mês, exportação CSV, painel e correções da auditoria (migration 014). |
| 2026.2 | Painel novo (ações rápidas, vencidos, cartões e conferência de saldo na Visão geral); robustez do front (respostas velhas, envio duplicado, pagar fatura, PWA v2); menu em grupos com "Mais" no celular; ocultar valores; dependências Vite 8 / Vitest 5 com auditoria de produção no CI; filtros de Lançamentos por tipo; diário do projeto em `docs/projeto/`. |
| 2026.3 | Redesenho visual pelo design system "Tudo Azul": painéis sem padding dobrado, títulos de mês com maiúscula certa, lista de Lançamentos compacta (valor na linha da descrição, Excluir discreto, totais em linhas no celular), ações rápidas do Início com ícone, contorno de campos com contraste; Calendário do mês (#62). |
| 2026.4 | Recorrências com frequência (semanal, quinzenal, mensal, bimestral, trimestral, semestral, anual e personalizada; migration 016, #65/#66); redesenho parte 2: cabeçalho padrão em todas as telas (título, descrição curta e ações à direita) e Cartões com a fatura a pagar em destaque e a ação principal que muda com ela. |
| 2026.5 | Menu "Mais" com atalhos e uma frase em cada tela; formulário de lançamento em visual de app (abas, valor grande, "Registrar e lançar outro", última conta lembrada); fatura do cartão como extrato (compras por dia, nome inteiro); ícone e cor de categoria; subcategoria logo abaixo da principal; banco da conta, emissor e bandeira do cartão gravados, com logos (migration 017); excluir recorrente em vez de encerrar (migration 018). |

## Versão atual

| Versão | O que entrou |
|---|---|
| 2026.100 | Arquitetura patrimonial: investimentos híbridos, módulo de dívidas sobre o motor existente, bens, multimoeda e consolidação patrimonial. Documento `docs/ARQUITETURA-PATRIMONIO.md`; nenhuma funcionalidade financeira ou migration foi aplicada nesta PR. |

| 2026.101 | Fundação multimoeda fase 1: catálogo BRL/USD/EUR, moeda de consolidação da família e consulta auditável de câmbio direto/inverso. Contas e lançamentos estrangeiros continuam bloqueados até a próxima fase substituir as agregações financeiras. |
