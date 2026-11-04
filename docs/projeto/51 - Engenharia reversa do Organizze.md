# Engenharia reversa do Organizze

Leitura feita em 04/11/2026 pelo conector oficial do Organizze (MCP), **só leitura**, na conta do dono. Este documento descreve **estrutura e regras**, nunca dados: nenhum valor, nome de conta, categoria pessoal ou lançamento real aparece aqui. Não copiamos marca, código nem visual, só a ideia de cada função.

## Como o Organizze organiza as coisas

| Conceito | Como o Organizze faz | Tudo Azul hoje | O que fazer |
|---|---|---|---|
| **Categorias** | Dois níveis (categoria e subcategoria), para despesa e para receita. Cada categoria tem **cor** e um **grupo fixo** (alimentação, casa, saúde, transporte, assinaturas, investimentos…); a subcategoria herda a cor. Há categorias "Outros" padrão. | Dois níveis, com ícone e cor por categoria, e grupo 50-30-20 (essencial, estilo de vida, investimento). | Mapear os grupos do Organizze para os nossos ícones na importação. **Seletor de categoria com ícone na principal e as filhas embaixo** (já pedido). |
| **Contas** | Saldo por conta; contas manuais ou conectadas (Open Finance). Saldo "base caixa". | Contas com saldo inicial, conferência e tipo (inclui investimento). | Importar contas com o saldo de abertura do dia escolhido. |
| **Cartões** | Fechamento, vencimento, limite e conta de pagamento. **Faturas por mês** com situação: futura, atual, paga ou vencida; saldo anterior que passa para a próxima; quantos pagamentos teve. | Fechamento, vencimento, limite, conta de pagamento, faturas por mês, reabrir fatura. | Mostrar "saldo anterior" e "pagamentos" na fatura. **Total de todos os cartões** (já pedido). |
| **Recorrentes ("contas fixas")** | Lançamento recorrente infinito, mensal ou anual, em conta **ou cartão**; cada ocorrência é um lançamento com "pago" sim/não. | Recorrente semanal a anual e diário (migration 048), em conta ou cartão (assinatura). | Já equivalente. Importar cada conta fixa como regra recorrente. |
| **Parcelados** | "Lançamento parcelado" em N vezes, com sobra na primeira; ferramenta para achar parcelas restantes. | Parcelado em conta (migration 048) e compra parcelada no cartão. | Já equivalente. Falta "parcelas restantes" num lugar só. |
| **Orçamentos** | Limite por categoria **de despesa e de receita** (meta de receita); "copiar do mês anterior". | Limite por categoria de despesa, com projeção; copiar do mês anterior. | **Meta de receita** e **orçamento que se repete** (pendência). |
| **Duas lentes de relatório** | **Base caixa** (o que saiu da conta: pagamento da fatura conta no dia do pagamento) e **base por lançamento** (compra no cartão conta na data da compra). Os relatórios por categoria podem usar a data da compra **ou** o vencimento da fatura. | Uma lente: compra no cartão conta no mês em que a fatura fecha; pagamento de fatura não é despesa. | Avaliar a opção "por data da compra" no relatório por categoria (decisão do dono). |
| **Previsão** | Saldo previsto do mês e previsão de caixa de 30 dias com o **ponto mais baixo**. **Não desconta as faturas do cartão** nem ocorrências futuras ainda não lançadas. | Saldo previsto no fim do mês **com as faturas descontadas** (mais conservador). | Explica por que o previsto do Organizze é mais alto que o nosso. Ideia boa: mostrar o **ponto mais baixo do mês** ("dia 18 o saldo chega a R$ X"). |
| **Contas a pagar** | Lista do que vence, com a fatura do cartão como uma linha só. | Vencidos e Próximos no Início, Calendário. | Já equivalente. |
| **Tags** | Etiquetas livres em cada lançamento e relatório por tag. | Não existe. | Avaliar (ex.: "viagem", "obra"). |
| **Assinaturas** | Detecta assinaturas pela repetição do mesmo estabelecimento em vários meses. | Recorrentes cadastrados. | Ideia futura: sugerir "isto parece uma assinatura". |
| **Duplicados** | Ferramenta que acha lançamentos repetidos. | Não existe. | Útil na importação. |
| **Open Finance** | Conecta bancos e importa lançamentos. | Não existe (decisão: projeto à parte). | Fora do escopo por enquanto. |

## O que já fazemos melhor

- **Previsto honesto:** desconta as faturas do cartão; o do Organizze não desconta.
- **Regras do dinheiro no banco:** centavos inteiros, nada somado na tela, travas de período conciliado e testes automáticos de cada regra.
- **Dívidas com contrato:** agenda de parcelas, juros e tarifa separados, consignado.
- **Patrimônio** com bens e evolução mês a mês.

## Ordem sugerida (a decidir com o dono)

1. Importação do Organizze com prévia e conferência (contas, cartões, categorias, recorrentes; depois o histórico).
2. Seletor de categoria com ícone e as filhas embaixo; novo lançamento com três abas e "Conta/Cartão".
3. Relatório por categoria com gráfico (com a opção "por data da compra" se o dono quiser).
4. Total dos cartões, % quitado das dívidas, ponto mais baixo do mês.
5. Meta de receita e orçamento que se repete; tags.
