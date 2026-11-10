---
tags: [tudo-azul, glossario, dinheiro, arquitetura]
---
# Glossário de métricas (Arquiteto financeiro)

Este documento diz **o que cada número da tela significa** e **onde ele é calculado**. Ele complementa "20 - Regras do
dinheiro" (as regras que não podem quebrar). Quando uma definição mudar, muda aqui na mesma PR.

Regra de leitura: o front só mostra. Somas de dinheiro vêm do banco (ver regra 2 em "20 - Regras do dinheiro").

Os itens marcados **[verificado]** foram lidos no corpo das funções em produção (somente leitura). Os demais ainda não
foram lidos e estão marcados como pendentes.

## Conta e saldo

- **Saldo da conta (efetuado)**: soma dos lançamentos já pagos/recebidos na conta. Fonte: `src/lib/saldoProjetado.ts`
  (`SaldoDaConta.efetuado`).
- **Saldo planejado**: o previsto para a conta (lançamentos planejados, assinaturas de cartão previstas e lançamentos
  fixos ainda não gerados), desde a migration 069. Fonte: mesmo arquivo (`planejado`).
- **Faturas**: parte do saldo que é cartão de crédito a pagar na conta (`faturas`).
- **Saldo** = efetuado + planejado − faturas, conforme o campo `saldo` retornado pelo banco. A tela não recalcula.
  - **Pendente:** a fórmula exata do campo `saldo` dentro do SQL ainda não foi lida. Não citar como regra até ler.
- **Parcela com débito automático** reduz a conta contratual. **Boleto ou lançamento manual sem conta** reduz só o
  total. **Consignado** aparece como compromisso, sem duplicar a saída de um salário já registrado líquido
  (comentário em `saldoProjetado.ts`).

## Disponível (Início) [verificado]

- **Disponível** (`availableMoney` em `get_home_decision_month`) = saldo das contas BRL **ativas** dos tipos
  checking, savings, cash e brokerage − **faturas de cartão fechadas** (`cartao_fechadas`).
  - Fonte: `home_indicators`, coluna `ativas − cartao_fechadas`. O alias da coluna foi inferido pela ordem dos campos
    no retorno, não por um nome literal no SQL.
- Contas do tipo **brokerage** entram no disponível. Dinheiro parado em corretora de conta corrente conta como livre.

## Patrimônio líquido (Início)

- O cartão de patrimônio (`src/pages/VisaoGeral.tsx`) vem de `net_worth_with_assets` (`src/lib/painel.ts`, com
  `net_worth` como fallback). **[verificado]** A fórmula no banco é `available + cr + bens BRL − debt`, e a frase da
  tela (`disponível + crédito a receber + bens em BRL − dívida`) bate com ela.
- **`available` aqui é a soma de todos os saldos BRL** (`account_balances`, sem filtrar tipo nem faturas de cartão).
  Não é o mesmo "Disponível" do Dinheiro Livre (ver abaixo). Os dois aparecem na mesma tela de Início com nomes iguais.
- `home_indicators` (faixa de indicadores do topo) calcula o patrimônio com a mesma base, `todas + cr + bens − debt`.
  Numericamente bate com o cartão, mas é outra RPC: se uma mudar, a outra precisa mudar junto.
- **Pendente:** o campo `available` de `net_worth_with_assets` inclui contas inativas? A função `account_balances` não
  foi lida.
- Bens em USD/EUR e contas em outras moedas não entram no consolidado. Aparecem à parte (`EmOutrasMoedas`).
- Investimentos aparecem separados, fora do disponível e do patrimônio consolidado (`inv` existe em `home_indicators`
  mas não entra em `todas + cr + bens − debt`).

## Dinheiro Livre (Início) [verificado]

Equação lida em `get_home_decision_month`:

```
circulatingBalance = disponível − reservas BRL comprometidas
moneyFree          = circulatingBalance − compromissos pendentes do mês
```

- **Reservas BRL comprometidas**: soma das alocações de reservas BRL com status `active` ou `completed`.
- **Compromissos pendentes do mês**: matriz de compromissos do mês em BRL, sem o que já foi pago. Cartão entra só pela
  parte **ainda não cobrada e não paga** (`card_months`): o que já está cobrado e não pago já saiu do disponível.
- **É um saldo, não um fluxo.** Não é "receitas − despesas do mês". Por isso, o que muda o disponível muda o Dinheiro
  Livre na mesma hora.
- **Diária segura** = `moneyFree / dias restantes` (não negativo).

### Consequência para aportes [verificado]

- `investment_operation_record` (compra e aporte) **não grava lançamento** (checado no corpo da função em produção).
  Grava só em `investment_operations`, sem ligação com conta.
- Logo, **um aporte registrado no módulo de investimentos não reduz o disponível nem o Dinheiro Livre.** O dinheiro sai
  do banco na vida real, mas o app continua mostrando como livre.
- O único lançamento de investimento é o **provento** (`investment_distribution_record` grava em `transactions`).
- Para o aporte reduzir o Dinheiro Livre hoje, é preciso registrar à mão uma transferência ou despesa. Isso é uma decisão
  de produto e contabilidade pendente do dono. Não há teste automatizado que cubra esse caso.

## Compromissos futuros

- Parcelas de cartão ainda não cobradas. Tela: "Compromissos futuros (parcelas de cartão ainda não cobradas)".
- **Não entram no patrimônio de hoje.** Entram na projeção (ver "20 - Regras do dinheiro", seção de projeção).

## Cartão de crédito

- **Fatura**: definida pela data de fechamento. Totais de mês, orçamento, saldo, resultado e fluxo de caixa seguem a
  **data da fatura**, não a data da compra (decisão de 05/11/2026, em "20 - Regras do dinheiro").
- **Limite do cartão**: `disponível = limite − comprometido`. Quando passa do limite, o valor aparece negativo e a
  tela diz "Passou do limite em …" (`src/pages/Cartoes.tsx`, componente `Limite`).
- **Parcelamento**: o resto dos centavos vai na primeira parcela (100,00 em 3x = 33,34 + 33,33 + 33,33).
- **Pendente:** a afirmação de que o pagamento da fatura não entra em resultado nem fluxo quando a fatura é liquidada
  ainda não foi verificada no SQL.

## Dívidas

- Saldo das dívidas vem de `debt_balances` no banco. Parcelas planejadas de empréstimo entram na projeção.
- **Pendente:** regra de pagamento antecipado e de encerramento de contrato.

## Investimentos

- **Valor de mercado da carteira** é mostrado por moeda (`src/pages/Investimentos.tsx`; até a #279 o card dizia "Patrimônio em <moeda>", nome que confundia com o Patrimônio total).
- Aporte e resgate **não** são despesa nem receita. Hoje não geram lançamento (ver "Dinheiro Livre").
- **Pendente:** teste automatizado para "aporte não reduz indevidamente o Dinheiro Livre" e "resgate não cria receita".

## Moedas

- Cada moeda tem seu total. **Nunca somar BRL, USD e EUR sem cotação explícita** (regra em "20 - Regras do dinheiro").
- Lançamento em moeda estrangeira guarda o valor na moeda original. Conversão não altera o histórico.

## O que ainda NÃO está confirmado

1. Fórmula do campo `saldo` (`saldoProjetado`) dentro do SQL.
2. Qual RPC alimenta o patrimônio mostrado em `VisaoGeral.tsx`, e se o texto da fórmula da tela bate com ela.
3. Se assinaturas de cartão previstas entram em `planejado` e em `faturas` ao mesmo tempo (risco de abatimento duplo).
4. Regras de dívidas: pagamento antecipado, encerramento e lançamento na conta.
5. Testes automatizados de aporte e resgate.
6. Duas definições de "Disponível" no Início: a do cartão de patrimônio (soma de todos os saldos BRL) e a do Dinheiro Livre (contas ativas menos faturas fechadas). Confirmar se é intencional e rotular de forma diferente.

## Decisão pendente do dono

- **Aporte deve reduzir o Dinheiro Livre?** Hoje não reduz. Se a resposta for sim, a regra é gerar uma saída de conta
  (transferência para conta de investimento ou lançamento) no ato do aporte. Isso mexe no fluxo de investimentos e
  precisa de migration e testes antes de implementar.
