---
tags: [tudo-azul, pendencias]
atualizado: 2026-10-31
---
# Pendências e próximos passos

## Estado atual

- A conferência manual com extrato foi descontinuada nesta PR #110. A tela, os botões, os RPCs de gravação/desfazer e as travas de período saem. Checkpoints existentes ficam preservados no banco; não há tela/arquivo próprio para consultar data e saldo do checkpoint, embora a marca histórica dos movimentos continue na exportação completa.
- O schema numerado da `main` chega à migration 030. A migration 031 está apenas nesta branch/PR; **não foi aplicada ao Supabase hospedado**.
- A fundação multimoeda está na fase 1. Contas em moedas estrangeiras continuam bloqueadas até a fase 2 substituir saldos, relatórios, projeções e conversões. Open Finance está fora de escopo.
- Esta PR não faz merge, deploy ou alteração em produção.

## Prioridades

1. **PR própria: completar reset e exportação de investimentos.** A auditoria identificou que o fluxo atual de "Zerar tudo" e a exportação completa ainda não cobrem integralmente os registros das tabelas de investimentos presentes na `main`. Corrigir em escopo separado, com teste de isolamento por família e sem misturar com a retirada da conferência.
2. **Lançamentos (pedido do dono):** "Novo lançamento" não deve abrir os filtros; no filtro, Tipo (Receita/Despesa) vem antes de Categoria, que deve mostrar somente categorias compatíveis. O prompt de implementação está em `CLAUDE-CODE-PROMPT-LANCAMENTOS.md`.
3. **PRs patrimoniais abertas:** revisar CI, migrations e testes antes de mergear #105, #106 e #109. Há timestamps e escopos de migration sobrepostos entre elas; resolver essa ordem primeiro. A migration 031 desta PR deve ser aplicada somente depois dessa reconciliação da sequência, via workflow autorizado.
4. **Teste de uso:** conferir no iPhone o Calendário (saldo por data, opção de incluir planejados, fatura no vencimento), além das telas de Lançamentos, Cartões, Relatórios e investimentos quando os PRs correspondentes estiverem aprovados.
5. **Dependências de desenvolvimento:** reavaliar o `npm audit` na base atual e tratar vulnerabilidades remanescentes em PR separada.
6. **Acesso ao legado:** decidir separadamente se os checkpoints antigos precisam de uma exportação somente-leitura com data e saldo informado; não reativar o fluxo de conferência.

## Roadmap

- **Fase 2 multimoeda:** moeda original por conta/operação, saldos segregados por moeda, conversão de consolidação em BRL, cotações históricas e tratamento explícito de taxa ausente/desatualizada; nunca reescrever o valor original de lançamento. Só liberar moedas estrangeiras depois de cobrir as RPCs e telas financeiras.
- **Patrimônio:** integrar bens e investimentos aos relatórios familiares sem dupla contagem; manter operações e avaliações históricas.
- **Importação do Organizze:** revalidar o desenho antigo antes de implementar; usar somente arquivo de exemplo com dados inventados.
- **Open Finance:** fora de escopo por decisão do dono.

## Regras de operação

- Nenhuma migration, consulta de escrita, deploy ou alteração no Supabase hospedado sem autorização explícita do dono.
- Nenhum merge sem autorização explícita; aprovação de PR não significa permissão para aplicar migration em produção.
- Mudança de versão segue `AAAA.PR` e `docs/VERSOES.md`.

## Ideias não priorizadas

Push de vencimentos, Tailwind 4, antecipação de parcelas e novas telas de empréstimos/bens só entram em PR própria após revisar dependências e obter autorização quando exigirem mudança de comportamento financeiro.
