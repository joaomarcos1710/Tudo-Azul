# Ideia 07 — Categorias: hierarquia, ícones e ações em hover

**Status:** em parte já implementado. **Origem:** pedido do dono, com comparação com Minhas Economias e Mobills. O texto aparece duas vezes: uma análise e um prompt para desenvolvedor. Esta nota junta as duas.

## Já existe (não reinventar)
- **Abas Despesas e Receitas** no topo da tela (`src/pages/Categorias.tsx`, `abas`).
- **Ícones temáticos** por categoria (`IconeCategoria`, `ICONES`, `visualDaCategoria`), com cor escolhida ou sugerida. O texto diz "só pontos coloridos"; isso já não é verdade.
- **Subcategorias** indentadas abaixo da categoria principal (`paiId`), com ícone menor.
- **Grupos de orçamento** (Necessidades, Desejos, Investir e poupar) com sugestão pelo nome (`sugerirGrupo`).
- **Ações por linha**: editar, ativar/desativar, eventual, não consumo e grupo, todas no componente `Linha`.

## O que ainda não existe
1. **Acordeão.** A tela lista todas as subcategorias abertas. Recolher por padrão reduz o scroll, mas precisa de estado por categoria e de teste de teclado (Enter e Espaço, `aria-expanded`).
2. **Ações que só aparecem no hover.** Hoje os botões ficam sempre visíveis. Ocultar no hover **esconde a ação no celular**, onde não há hover. Sugestão: no desktop, mostrar no hover e manter ao focar com teclado; no celular, manter visível ou em um menu "⋯" (`MenuAcoes`).
3. **Layout em cartão centralizado** no fundo cinza: verificar o layout atual antes de mexer.

## Pontos a decidir
1. **Acordeão recolhido por padrão** esconde subcategorias que o dono pode querer ver de relance. Decidir se recolhe tudo ou só as categorias sem movimento no mês.
2. **Minhas Economias usa painel lateral; Mobills usa tabela densa.** O app já é uma lista clara. Não copiar o modo escuro do Mobills: o Tudo Azul é claro, como já decidido.
3. **Tamanho da mudança.** Separar em PRs: (a) acordeão; (b) ações no hover com alternativa para celular; (c) layout em cartão.
4. **"Mais usados" como aba.** O texto cita a aba dos concorrentes. Precisaria de contagem de uso por categoria, vinda do banco. Só vale se o dono quiser.

## Critério de pronto (quando virar PR)
- Testes de teclado para o acordeão e para as ações.
- Ações acessíveis no celular, sem depender de hover.
- `cores.test.ts` passando, sem hex solto.
- Doc 10 (telas) atualizado.
