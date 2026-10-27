---
tags: [tudo-azul, regras, dinheiro]
---
# Regras do dinheiro (não podem quebrar)

1. **Centavos inteiros** no front (`Cents`). Nada de ponto flutuante com reais.
2. **O front não soma dinheiro de relatório.** Totais vêm de funções do banco (`period_summary`, `budget_usage`, `net_worth`, `debt_balances`, `card_limits`, `month_projection`…). Diferença linha a linha de dois valores é permitida.
3. **Entrada estrita:** `parseBRL` recusa formato ambíguo (`"1 2"`); nunca "adivinha" um valor.
4. **Banco** usa `numeric` com guarda de casas decimais (erro 22003 se passar de 2).

## Cartão de crédito
- A parcela é **cobrada no fechamento da fatura** (data de vencimento da parcela).
- Compra **no dia do fechamento ou depois** entra na fatura seguinte.
- Resto de centavos vai na **1ª parcela** (100,00 em 3x = 33,34 + 33,33 + 33,33).
- **Pagar fatura não é despesa** (a compra já contou no mês da fatura). **Juros e tarifa são despesa.**
- Pagamento **adiantado** (sem fatura) vira **crédito** no cartão.
- O **saldo de referência** do cartão (dívida que já existia) é "anterior em aberto" e é quitado primeiro (correção da migration 014).

## Conta
- Conta **desativada** só impede **novas** movimentações; o saldo continua no patrimônio.
- Período **conferido** com o extrato trava: não edita, não manda para a lixeira, não restaura.
- Transferência nunca é receita nem despesa.

## Receita
- **Regular × eventual** (categoria marcada como eventual): a renda regular é a base para a cobertura das despesas.

## Ocultar valores
Só apresentação. Campos de edição usam `formatBRLCampo` (nunca mascarado), com teste-guarda.
