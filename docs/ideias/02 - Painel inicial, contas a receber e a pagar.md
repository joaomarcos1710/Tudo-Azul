# Ideia 02 — Painel inicial: "Contas a receber" e "Contas a pagar"

**Status:** em andamento, em etapas aprovadas pelo dono em 10/11/2026: (1) layout em duas colunas, só reposicionando — feita; (2) separar "Próximos planejados" em "Receitas a receber" e "Despesas a pagar"; (3) "Maiores gastos" com rosca no Início; (4) botões rápidos no topo. **Origem:** pedido do dono, colado com duas partes. A primeira descreve os dois painéis. A segunda é um prompt para refatorar o painel inicial inteiro em cards e grades. Esta nota junta as duas.

## O que já existe (não reinventar)
A tela `src/pages/VisaoGeral.tsx` já tem:
- **avisos no topo** (a receber, a pagar, fatura e vencidos), que só aparecem quando há algo a dizer;
- **cards de resumo do mês** ("Despesas do mês" e "Receitas do mês") em grade de 2 colunas, 4 no desktop;
- **grade de gráficos** em 2 colunas no desktop;
- lista de **próximos lançamentos** (`proximos`);
- ícones de categoria (`visualCategoria`) e cores de valor pelo tipo (`corDoTipo`: receita azul, despesa vermelha).

A ideia adiciona os dois painéis de lista lado a lado com os cards que já existem.

## Como a ideia imagina os painéis
**Cartões**
- Dois cards separados, "Contas a receber" e "Contas a pagar", fundo branco, `rounded-card`, sombra leve (`shadow-card`), sobre `bg-fundo`.
- Título no canto superior esquerdo, em negrito, cor de texto principal.
- Abaixo do título, uma faixa de largura total em cinza ultra-claro com o texto "Próximas" centrado, em fonte pequena e cor secundária.

**Linha de lançamento** (flexbox, da esquerda para a direita)
- **Ícone da categoria** num círculo, com a cor de fundo vinda da categoria já cadastrada (não cor nova).
- **Centro**: título (nome da transação) e, por baixo, a data em cor secundária. Em fatura de cartão, a fonte de pagamento (ex.: "CAIXA INFINITE") entra ao lado ou abaixo da data.
- **Direita**: valor em moeda, alinhado à direita, com as cores do sistema (receber em azul `lucro`, pagar em vermelho `prejuizo`).
- Hover: fundo cinza ultra-claro na linha inteira, indicando que abre o detalhe.

**Ações**
- Rodapé de cada card: "ver mais ▾" centrado, que carrega mais itens ou expande o card de forma suave. Ao passar o mouse, muda de cor ou ganha sublinhado.

**Refatoração da página inteira (prompt da segunda parte)**
- Sidebar com o item "Visão geral" bem destacado, e pensar numa opção de recolher a barra para dar mais espaço.
- Fundo da área de conteúdo em cinza muito claro, com os blocos em grid (lado a lado no desktop).
- Resumo no topo: "Saldo atual", "Receitas do mês" e "Despesas do mês" como summary cards.
- Listas em 2 colunas (50/50 ou 60/40).
- Menos linhas de tabela e de borda; mais espaço em branco.

## Pontos a decidir antes de implementar
1. **Os painéis já existem em outra forma.** Os avisos do topo já mostram "a receber" e "a pagar", e "próximos" já é uma lista. Decidir se os painéis substituem esses avisos ou se ficam ao lado deles (e não repetem a mesma informação).
2. **"Contas a receber" é um conceito novo no app?** No Tudo Azul, receita é lançamento já feito ou planejado. Antes de criar um painel de "a receber", confirmar com o dono o que entra nele (recorrências futuras, créditos, reembolsos) e se o total é calculado no banco, nunca somado no front.
3. **Regra de dinheiro.** Os valores vêm do banco e não são somados no navegador (regra do projeto). Cada "ver mais" carrega do banco, não recalcula a lista inteira.
4. **Cor do valor pelo sinal ou pelo tipo?** Hoje o app usa a cor do tipo para lançamentos e a do sinal para saldo. Escolher uma regra para os painéis e manter em todo o dashboard.
5. **Sidebar recolhível.** Verificar primeiro o que a sidebar já faz (há uma versão nova no `main`, #215). Não criar uma segunda forma de recolher.
6. **Muita mudança de uma vez.** A segunda parte pede a refatoração da página inteira. Sugestão: fazer em etapas, primeiro os dois painéis, depois o resto, para cada PR caber numa revisão.
7. **Mobile.** Duas colunas não cabem no celular. Definir a versão de uma coluna antes de desenhar.

## Fora do escopo desta ideia
Mudar regra de saldo, de projeção ou de cálculo de mês. A tela só muda a apresentação.

## Critério de pronto (quando virar PR)
- Testes dos dois painéis (lista, "ver mais", hover por teclado e mouse).
- Nenhum valor somado no navegador.
- `cores.test.ts` passando, sem hex solto.
- Conferência no celular e no desktop.
- Doc 10 (telas) atualizado, porque a tela muda.
