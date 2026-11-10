---
tags: [tudo-azul, plano, investimentos, dinheiro, decisao]
---
# Investimentos vinculados a conta (plano, aguarda decisões do dono)

**Pedido do dono (09/11/2026):** aporte e resgate precisam ficar vinculados a uma conta. Escolhida a **opção A**: o
aporte é uma transferência da conta corrente para uma conta de corretora; o resgate, a transferência de volta. Não gera
receita nem despesa, então não há receita fictícia.

Este documento é o plano. Nenhum código foi alterado. Antes de implementar, o dono precisa responder as três decisões
abaixo, porque mudam o resultado do saldo.

## Estado atual [verificado no banco de produção, somente leitura]

- `investment_operation_record(p_asset, p_date, p_kind, p_quantity, p_unit_price, p_fees, p_notes)` grava só em
  `investment_operations`. Não há conta na operação e nenhum lançamento é criado.
- `investment_operations` não tem `account_id` nem vínculo com `transactions`.
- `investment_assets` não tem conta padrão.
- `home_indicators` soma no disponível as contas BRL ativas dos tipos `checking`, `savings`, `cash` e `brokerage`
  (`ativas`), menos as faturas fechadas.
- `accounts.type` aceita `checking`, `savings`, `brokerage`, `fixed_income`, `variable_income`, `crypto`, `cash`.
- Transferência já existe em `transactions` (`type = 'transfer'`, com `account_id` e `destination_account_id`).

## Como ficaria (opção A)

1. **Operação com conta.** `investment_operation_record` ganha `p_account uuid` (conta corrente de origem na compra,
   ou de destino na venda) e `p_brokerage uuid` (conta de corretora, tipo `brokerage`).
2. **Compra (`buy`)**: cria uma transferência de `p_account` para `p_brokerage` no valor `quantidade × preço + taxas`,
   com a data da operação, e guarda o id em `investment_operations.transaction_id`.
3. **Venda (`sell`)**: transferência de `p_brokerage` para `p_account` pelo líquido da venda.
4. **Estorno (`investment_operation_void`)**: marca a transferência como excluída (`deleted_at`), pela lixeira que já
   existe. Não apaga nada.
5. **Disponível** (`home_indicators.ativas`): passa a excluir `brokerage`, para o aporte reduzir o Dinheiro Livre.
   Fica a dúvida da decisão 2.
6. **Front** (`src/pages/Investimentos.tsx`, `src/lib/investimentos.ts`): o formulário de compra e venda pede a conta
   corrente e a de corretora.
7. **Testes**: pgTAP para compra, venda, estorno, disponível e Dinheiro Livre (casos do Auditor: aporte reduz uma vez,
   resgate não cria receita). Vitest para o formulário.

## Decisões que o dono precisa tomar

1. **Operações antigas.** As operações já registradas não têm conta, então não geram transferência. Opções:
   (a) ficam como estão, sem efeito no saldo (o saldo das contas já reflete o que foi realmente movimentado, se o dono
   tiver feito a transferência à mão);
   (b) o dono associa cada operação antiga a uma conta, e a transferência é criada depois.
   **Recomendo (a)** e, se quiser, uma tela para associar depois.
2. **Corretora fora do disponível.** Hoje a conta de corretora entra no disponível. Se ela sair, quem deixa dinheiro
   parado na corretora (sem comprar ativo) perde esse saldo do Dinheiro Livre. **Recomendo** que o saldo de corretora
   apareça à parte, como "a investir", e fique fora do disponível.
3. **Patrimônio.** O patrimônio soma as contas BRL, mas não o valor de mercado dos investimentos. Depois da compra, o
   dinheiro sai do disponível e vai para a corretora, mas o ativo não entra no patrimônio. Isso faz o patrimônio cair no
   aporte. **Recomendo** incluir o valor de mercado dos investimentos BRL no patrimônio (`investment_totals`) no mesmo
   passo, ou o aporte vai parecer uma perda.

## Riscos

- Muda o disponível e o patrimônio, que são números que o dono já usa. Precisa de migration, testes e revisão antes do
  workflow de produção.
- O resgate passa a depender de a conta de corretora ter saldo suficiente. Hoje não há essa verificação.
- Moeda: operação em moeda estrangeira não deve gerar transferência em BRL. Primeira versão: só BRL, e o restante fica
  bloqueado com mensagem clara.

## Próximo passo

Com as três decisões, escrevo a migration, os testes pgTAP e a mudança de front em uma PR em rascunho. Nada vai para
produção sem o seu "pode" e o `APLICAR`.
