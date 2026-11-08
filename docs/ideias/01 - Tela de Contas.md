# Ideia 01 — Tela de Contas (lista limpa, com arquivadas)

**Status:** ideia, não implementada. **Origem:** pedido do dono, colado em duas versões quase iguais. Esta nota junta as duas: a segunda é a base (tem contas arquivadas e reordenação), e a primeira acrescenta as ações rápidas no hover.

## O que já existe (não reinventar)
Hoje a tela `src/pages/Contas.tsx` já tem:
- botão **"Nova conta"** no cabeçalho;
- **ícone por banco** (`IconeConta`);
- contas **agrupadas por tipo** (7 tipos, na ordem de `TIPOS_CONTA`), com subtotal vindo do banco;
- contas **arquivadas** escondidas atrás do botão "Arquivadas (N)";
- filtro por etiqueta e linha "tipo · desde data".

Ou seja, a ideia muda a **forma** da lista, não a função.

## Como a ideia imagina a tela
**Layout**
- Sidebar: o item "Contas" ativo com a cor primária do sistema (`azul`, que é o token de `lucro`), não a cor da referência.
- Conteúdo num card branco (`rounded-card`), sobre o fundo `bg-fundo`.
- Cabeçalho: título "Contas" em negrito à esquerda; botão "Nova conta" com ícone de "+" à direita, na variante `primario` do `Button`.

**Linha da conta**
- Ícone de arrastar (alça) à esquerda, discreto.
- Avatar circular: logo do banco ou inicial sobre cor de fundo.
- Nome em negrito; por baixo, o tipo ("Conta corrente", "Poupança", "Investimento") em texto secundário.
- Chevron ">" à direita, indicando que a linha abre o detalhe.
- Separador horizontal fino e cinza claro entre as linhas.
- Hover: fundo cinza ultra-claro (`bg-slate-50`) na linha inteira.

**Seções**
- **Ativas**: reordenáveis pela alça.
- **Arquivadas**: título "Contas arquivadas" com ícone de caixa de arquivo, no mesmo layout das ativas, com aparência de inativa.

**Ações rápidas (só na primeira versão)**: no hover, lápis (editar) e lixeira (excluir) à direita.

## Pontos a decidir antes de implementar
1. **Lista plana ou agrupada por tipo?** A ideia pede lista plana. O app agrupa por tipo porque é onde o dinheiro está (e o subtotal vem do banco). Se a lista ficar plana, o subtotal por tipo some da tela. Sugestão: manter os grupos e aplicar só o visual da linha.
2. **Ações no hover não existem no celular.** Hover não dispara no toque. Sugestão: manter as ações no menu "⋯" que o app já usa (`MenuAcoes`), e no desktop mostrar os ícones só no hover, sem depender deles.
3. **Reordenação precisa de dados.** Não há campo de ordem nas contas. Isso é uma migration nova (campo de posição por família), com teste que falha sem a correção, e o doc 21 atualizado.
4. **Arrastar sem biblioteca.** Para poucas linhas, a regra do projeto é não adicionar dependência. Dá para usar a API de arrastar do navegador. Mas reordenar **também precisa funcionar só pelo teclado** (acessibilidade), senão a alça não serve a quem não usa mouse.
5. **Arquivadas "mais apagadas" pede cuidado com contraste.** Reduzir a opacidade do texto pode deixar o nome abaixo de 4,5:1 e reprovar o `cores.test.ts`. Sugestão: usar o token de texto `neutro` em vez de opacidade.
6. **Logo do banco.** Começar com inicial colorida (sem dependência). Logo de verdade é uma decisão à parte (Brandfetch: cota, licença e chave `?c=` nas URLs, como já anotado no doc 40).
7. **Subtítulo.** O tipo já aparece na linha ("tipo · desde data"). Decidir se o subtítulo substitui essa linha ou se fica só o tipo.

## Fora do escopo desta ideia
Mudar a regra de saldo, de subtotal ou de arquivar. A tela só muda a apresentação e a ordem.

## Critério de pronto (quando virar PR)
- Testes da lista (ativas, arquivadas, reordenação por teclado e pelo mouse).
- `cores.test.ts` passando, sem hex solto na tela.
- Conferência em celular e em desktop.
- Doc 10 (telas) atualizado, porque a tela muda.
