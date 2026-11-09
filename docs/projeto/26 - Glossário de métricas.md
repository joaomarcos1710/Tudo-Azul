---
tags: [tudo-azul, glossario, dinheiro, arquitetura]
---
# Glossário de métricas (Arquiteto financeiro)

Este documento diz **o que cada número da tela significa** e **onde ele é calculado**. Ele complementa "20 - Regras do
dinheiro" (as regras que não podem quebrar). Quando uma definição mudar, muda aqui na mesma PR.

Regra de leitura: o front só mostra. Somas de dinheiro vêm do banco (ver regra 2 em "20 - Regras do dinheiro").

## Conta e saldo

- **Saldo da conta (efetuado)**: soma dos lançamentos já pagos/recebidos na conta. Fonte: `src/lib/saldoProjetado.ts`
  (`SaldoDaConta.efetuado`).
- **Saldo planejado**: o que está previsto para a conta (lançamentos planejados, assinaturas de cartão previstas e
  lançamentos fixos ainda não gerados), desde a migration 069. Fonte: mesmo arquivo (`planejado`).
- **Faturas**: parte do saldo que é cartão de crédito a pagar na conta (`faturas`).
- **Saldo** = efetuado + planejado − faturas, conforme o campo `saldo` retornado pelo banco. A tela não recalcula.
  - Atenção: confirmei a presença dos campos, não a fórmula exata dentro do SQL. Antes de citar a fórmula como regra,
    conferir a função no banco.
- **Parcela com débito automático** reduz a conta contratual. **Boleto ou lançamento manual sem conta** reduz só o
  total. **Consignado** aparece como compromisso, sem duplicar a saída de um salário já registrado líquido
  (comentário em `saldoProjetado.ts`).

## Saldo projetado (fim do mês)

- É o saldo esperado na data, somando o que já aconteceu com o que está planejado.
- Tela: Calendário mostra "Saldo previsto …" quando o filtro inclui planejados, e "Saldo … (só efetuados)" quando não
  inclui (`src/pages/Calendario.tsx`, linha ~316).
- Não entra no patrimônio de hoje. Patrimônio usa só o que já é efetivo.

## Disponível e patrimônio líquido

- **Patrimônio líquido** (Início, `src/pages/VisaoGeral.tsx`), fórmula escrita na própria tela:
  `disponível + crédito a receber + bens em BRL − dívida`.
- **Disponível**: dinheiro em contas BRL hoje, segundo o banco (`p.disponivel`). A definição SQL não foi lida nesta
  revisão.
- **Bens em USD/EUR** e **contas em outras moedas** não entram no consolidado. Aparecem à parte (`EmOutrasMoedas`).
- **Investimentos** aparecem separados até a integração com o caixa, segundo a própria tela.

## Dinheiro Livre (Início)

- Valor do que sobra para gastar no mês, já descontando o comprometido. Vem do banco em
  `get_home_decision_month` (campo `moneyFree`, lido em `src/lib/homeDecisao.ts`).
- **Reservas em BRL** são descontadas do Dinheiro Livre. Envelopes em USD e EUR ficam separados (texto de
  `src/pages/Reservas.tsx`).
- Quando a visão está indisponível, a tela diz isso sem esconder o resto (`VisaoGeral.tsx`, linha ~162).
- **Pendente de confirmação:** a fórmula exata de `moneyFree` (quais compromissos entram e como o cartão aparece). Não
  está documentada aqui ainda. Antes de mudar essa conta, ler a função no banco.

## Compromissos futuros

- Parcelas de cartão ainda não cobradas. Tela: "Compromissos futuros (parcelas de cartão ainda não cobradas)".
- **Não entram no patrimônio de hoje.** Entram na projeção (ver "20 - Regras do dinheiro", seção de projeção).

## Cartão de crédito

- **Fatura**: definida pela data de fechamento. Totais de mês, orçamento, saldo, resultado e fluxo de caixa seguem a
  **data da fatura**, não a data da compra (decisão de 05/11/2026, em "20 - Regras do dinheiro").
- **Limite do cartão**: `disponível = limite − comprometido`. Quando passa do limite, o valor aparece negativo e a
  tela diz "Passou do limite em …" (`src/pages/Cartoes.tsx`, componente `Limite`).
- **Parcelamento**: o resto dos centavos vai na primeira parcela (100,00 em 3x = 33,34 + 33,33 + 33,33).

## Dívidas

- Saldo das dívidas vem de `debt_balances` no banco. Parcelas planejadas de empréstimo entram na projeção.
- Não confirmei nesta revisão a regra de pagamento antecipado nem a de encerramento de contrato. Quando for mexer,
  ler `supabase/migrations` das dívidas e os testes pgTAP antes.

## Investimentos

- **Patrimônio em investimentos** é mostrado por moeda (`src/pages/Investimentos.tsx`).
- Aporte e resgate **não** são despesa nem receita. Se um aporte reduzir o Dinheiro Livre, isso é um erro a corrigir.
  Esta regra ainda precisa de teste automatizado explícito, que não confirmei existir.

## Moedas

- Cada moeda tem seu total. **Nunca somar BRL, USD e EUR sem cotação explícita** (regra em "20 - Regras do dinheiro").
- Lançamento em moeda estrangeira guarda o valor na moeda original. Conversão não altera o histórico.

## O que este glossário NÃO confirma ainda

- A fórmula SQL de `disponível`, `saldo` e `moneyFree`.
- Se existe teste automatizado para "aporte não reduz Dinheiro Livre" e "resgate não cria receita".
- Uma divergência de rótulos entre "Disponível do Início" e "Disponível em Análises", apontada numa conversa anterior.
  Não reconferi nesta revisão. Antes de unificar, verificar as duas telas no código.
