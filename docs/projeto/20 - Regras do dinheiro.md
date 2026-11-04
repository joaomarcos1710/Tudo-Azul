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
- **Parcela de empréstimo/financiamento é despesa do mês em que é paga** (migration 046, decisão do dono em 03/11/2026): o principal pago entra na categoria escolhida na dívida (ou "Sem categoria"), juros e tarifa nas deles; somados = parcela inteira. Parcela do contrato ainda não baixada entra em despesas **planejadas**. **Consignado não conta** (o salário já entra líquido). O dinheiro recebido ao pegar o empréstimo **não é receita**. Consequência: em mês com amortização, "resultado do mês" fica abaixo da variação do patrimônio pelo principal pago (o patrimônio continua certo).
- Pagamento **adiantado** (sem fatura) vira **crédito** no cartão.
- **Estorno de uma compra** (`debt_refund`) abate a despesa da compra. **Crédito avulso** (estorno de IOF, cashback, reembolso da empresa ou do plano; migration 052, decisão do dono de 04/11/2026) é **receita** na categoria de receita escolhida, no **mês do fechamento da fatura** em que entra (a aberta pela data, mesma regra da compra, ou uma posterior escolhida): é o mesmo mês em que as compras daquela fatura viram despesa. Abate a fatura; se passar dela, vira crédito no cartão. Nunca entra como despesa negativa. Sem conta de dinheiro (fica de fora do fluxo filtrado por conta). **Planejada até a fatura fechar, recebida no fechamento** (como a compra, que é compromisso até fechar; decisão do dono de 04/11/2026): até lá só aparece em "receitas previstas" e no fluxo com planejados; renda regular × eventual e a base da regra 50-30-20 só contam depois do fechamento. O **limite do cartão volta na data do crédito**, sem esperar o fechamento. A fatura escolhida vai da aberta pela data até 3 depois. Cartão com crédito numa fatura ainda aberta não arquiva. **No dia do fechamento**, até `card_bill_due` rodar, o crédito já conta (receita recebida e abatendo a dívida) e as compras daquela fatura ainda não (continuam planejadas): o app roda `card_bill_due` ao abrir, então a diferença dura até a primeira abertura do dia. A devolução em dinheiro sai do crédito na ordem das datas (leva o que existia no dia dela). O limite disponível nunca passa do limite, mesmo com crédito a receber.
- O **saldo de referência** do cartão (dívida que já existia) é "anterior em aberto" e é quitado primeiro (correção da migration 014).

## Conta
- Conta **desativada** só impede **novas** movimentações; o saldo continua no patrimônio.
- **Moeda da conta** (multimoeda F1, migration 055): cada conta tem uma moeda (BRL, USD, EUR), escolhida **só na criação**; o banco só deixa trocar enquanto a conta não tem nenhum movimento (nem na lixeira). O saldo da conta fica **na moeda dela**.
- **Nunca somar moedas diferentes sem conversão.** Saldo total, por tipo, previsto, disponível e patrimônio somam **só contas em reais**; as outras aparecem à parte, por moeda ("Em outras moedas", `balance_totals_by_currency`), sem converter. A conversão (PTAX de compra) chega na F4.
- **Bloqueio provisório** (até a F2/F3): conta que não é BRL ainda não aceita lançamento (receita, despesa, transferência, origem ou destino), recorrente, evento de dívida, ser conta de pagamento de cartão/dívida nem provento. O banco recusa e os formulários nem oferecem essas contas; por enquanto o saldo delas é só o saldo inicial.
- Período **conferido** com o extrato trava: não edita, não manda para a lixeira, não restaura. *Dormente desde 04/11/2026 (#159): a conferência saiu do app; a trava continua no banco, mas sem conferência nova nunca dispara.*
- Transferência nunca é receita nem despesa.

## Receita
- **Regular × eventual** (categoria marcada como eventual): a renda regular é a base para a cobertura das despesas.

## Ocultar valores
Só apresentação. Campos de edição usam `formatBRLCampo` (nunca mascarado), com teste-guarda.
