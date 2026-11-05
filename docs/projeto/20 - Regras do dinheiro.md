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
- **Troca dos dias do cartão** (migration 061, decisão de 05/11/2026): os dias novos valem a partir da fatura do **mês seguinte ao da fatura aberta hoje**; a aberta termina com os dias antigos. Ex.: hoje 01/12, fechava 5/vencia 15 e passa a 25/5 → a aberta fecha 05/12 e vence 15/12; a seguinte fecha 25/01 e vence 05/02 (compra de 05/12 a 24/01 cai nela). Assim **cada mês tem um só fechamento** (a fatura é identificada pelo mês). Se o cartão já tem parcelas (ou crédito, ou fatura) do ciclo atual num mês em que os dias novos valeriam — uma compra parcelada, por exemplo —, a troca é **recusada** com a data a partir da qual pode ser feita. Voltar aos dias da fatura aberta desfaz uma troca que ainda não começou. A primeira definição dos dias vale na hora. Nada já lançado muda de fatura.
- Resto de centavos vai na **1ª parcela** (100,00 em 3x = 33,34 + 33,33 + 33,33).
- **Pagar fatura não é despesa** (a compra já contou no mês da fatura). **Juros e tarifa são despesa.**
- **Parcela de empréstimo/financiamento é despesa do mês em que é paga** (migration 046, decisão do dono em 03/11/2026): o principal pago entra na categoria escolhida na dívida (ou "Sem categoria"), juros e tarifa nas deles; somados = parcela inteira. Parcela do contrato ainda não baixada entra em despesas **planejadas**. **Consignado não conta** (o salário já entra líquido). O dinheiro recebido ao pegar o empréstimo **não é receita**. Consequência: em mês com amortização, "resultado do mês" fica abaixo da variação do patrimônio pelo principal pago (o patrimônio continua certo).
- Pagamento **adiantado** (sem fatura) vira **crédito** no cartão.
- **Pagamento de cartão não pode ter data futura** (migration 058): o banco recusa pagamento (e amortização ou antecipação) de cartão com data depois de hoje em São Paulo; registre no dia em que o dinheiro sai da conta. Antes, a fatura aparecia "Paga" na lista enquanto o destaque ainda cobrava. Empréstimo e financiamento continuam aceitando data futura.
- **Itens da fatura são líquidos** (migration 058): cada item mostra o valor da parcela menos o cancelado e o estornado, e a soma dos itens bate com o total da fatura (o crédito avulso não é item). O "n de N" conta só as parcelas vivas (compra encurtada não mostra parcelas canceladas).
- **Assinatura de cartão prevista** (migration 058): a assinatura só vira parcela no dia da cobrança, então a fatura aberta mostra só o que já foi cobrado/parcelado. O que as assinaturas ainda vão somar nela vem de `card_pending_subscriptions` (à parte; a fatura "real" não muda).
- **Estorno de uma compra** (`debt_refund`) abate a despesa da compra. **Crédito avulso** (estorno de IOF, cashback, reembolso da empresa ou do plano; migration 052, decisão do dono de 04/11/2026) é **receita** na categoria de receita escolhida, no **mês do fechamento da fatura** em que entra (a aberta pela data, mesma regra da compra, ou uma posterior escolhida): é o mesmo mês em que as compras daquela fatura viram despesa. Abate a fatura; se passar dela, vira crédito no cartão. Nunca entra como despesa negativa. Sem conta de dinheiro (fica de fora do fluxo filtrado por conta). **Planejada até a fatura fechar, recebida no fechamento** (como a compra, que é compromisso até fechar; decisão do dono de 04/11/2026): até lá só aparece em "receitas previstas" e no fluxo com planejados; renda regular × eventual e a base da regra 50-30-20 só contam depois do fechamento. O **limite do cartão volta na data do crédito**, sem esperar o fechamento. A fatura escolhida vai da aberta pela data até 3 depois. Cartão com crédito numa fatura ainda aberta não arquiva. **No dia do fechamento**, até `card_bill_due` rodar, o crédito já conta (receita recebida e abatendo a dívida) e as compras daquela fatura ainda não (continuam planejadas): o app roda `card_bill_due` ao abrir, então a diferença dura até a primeira abertura do dia. A devolução em dinheiro sai do crédito na ordem das datas (leva o que existia no dia dela). O limite disponível nunca passa do limite, mesmo com crédito a receber.
- O **saldo de referência** do cartão (dívida que já existia) é "anterior em aberto" e é quitado primeiro (correção da migration 014).

## Conta
- Conta **desativada** só impede **novas** movimentações; o saldo continua no patrimônio.
- **Moeda da conta** (multimoeda F1, migration 055): cada conta tem uma moeda (BRL, USD, EUR), escolhida **só na criação**; o banco só deixa trocar enquanto a conta não tem nenhum movimento (nem na lixeira). O saldo da conta fica **na moeda dela**.
- **Nunca somar moedas diferentes sem conversão.** Saldo total, por tipo, previsto, disponível e patrimônio somam **só contas em reais**; as outras aparecem à parte, por moeda ("Em outras moedas", `balance_totals_by_currency`), sem converter. A conversão (PTAX de compra) chega na F4.
- **O que a conta em outra moeda aceita** (multimoeda F2, migration 056): **receita e despesa** (avulsa, parcelada e recorrente), no valor da moeda dela, e **transferência para outra conta da mesma moeda** (USD → USD). **Continuam recusados** pelo banco (e os formulários nem oferecem): transferência entre moedas diferentes (fica para a F3, com a cotação), evento de dívida ou cartão, ser a conta de pagamento de cartão/dívida e provento de investimento. Cartão, dívida e provento seguem só em reais.
- **Relatórios em reais ignoram as outras moedas**: resumo do mês, despesas por categoria e por dia, Entradas x Saídas, regra 50-30-20, renda regular × eventual, projeção do mês e aviso diário só contam lançamentos de contas em reais. O resultado **pago** de cada outra moeda (receitas, despesas e resultado) aparece à parte, em "Em outras moedas" (`period_summary_by_currency`), sem converter e sem somar ao total em reais.
- **Orçamento só em reais**: despesa em conta estrangeira não consome limite de categoria (`budget_usage` e `budget_projection` filtram).
- Período **conferido** com o extrato trava: não edita, não manda para a lixeira, não restaura. *Dormente desde 04/11/2026 (#159): a conferência saiu do app; a trava continua no banco, mas sem conferência nova nunca dispara.*
- Transferência nunca é receita nem despesa.

## Edição em lote (Lançamentos no computador, migration 060)
- **Uma operação só no banco, tudo ou nada**: mudar categoria, marcar como pago e lixeira em vários lançamentos são uma chamada (`transactions_bulk_*`); se um item é recusado, nenhum muda.
- **As mesmas guardas do lançamento de um só**: é o mesmo UPDATE, então valem os gatilhos de sempre (período conferido, conta desativada ao restaurar, abertura da conta, moeda da transferência) e a categoria do tipo certo (receita só com categoria de receita; transferência não tem categoria). SECURITY INVOKER: a RLS decide; todos os ids da mesma família e visíveis para quem chama; no máximo 500 por vez.
- **Marcar pago em lote não muda o valor**: só a situação e a data escolhida. Se o valor real foi outro, use o "Marcar pago" do lançamento (que pede data e valor).
- **A tela não soma o que está selecionado**: a confirmação mostra a quantidade; os totais do mês continuam vindo do banco depois de recarregar.
- Só lançamentos (`transactions`): fatura, compra de cartão, contrato e crédito no cartão não entram na seleção.

## Receita
- **Regular × eventual** (categoria marcada como eventual): a renda regular é a base para a cobertura das despesas.

## Ocultar valores
Só apresentação. Campos de edição usam `formatBRLCampo` (nunca mascarado), com teste-guarda.
