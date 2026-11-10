---
tags: [tudo-azul, plano, investimentos, dinheiro, decisao]
---
# Investimentos vinculados a conta (desenho aprovado em 10/11/2026)

**Pedido do dono (09/11/2026):** aporte e resgate precisam ficar vinculados a uma conta, sem receita nem despesa
fictícia. **Desenho aprovado pelo dono em 10/11/2026** (substitui a "opção A" de 09/11, abaixo, que ficou inviável).

## Por que a opção A de 09/11 caiu
Ela previa a compra como transferência da conta corrente para uma conta de corretora comum. Desde a migration 099
(10/11/2026), o Patrimônio soma a carteira em reais: o mesmo dinheiro contaria duas vezes, no saldo da corretora e no
valor do ativo.

## O desenho (migration 100)
1. **Conta interna "Carteira de investimentos"**, uma por família, criada pelo banco quando precisa. Não aparece na lista
   de contas e **não entra em soma nenhuma** (Disponível, Patrimônio, saldo geral, previsão).
2. **Compra com conta:** a operação cria, na mesma hora, uma transferência "<conta> → Carteira de investimentos" pelo
   valor da compra mais as tarifas. A conta cai, o ativo entra; o Patrimônio não muda no dia.
3. **Venda com conta:** transferência "Carteira → <conta>" pelo valor líquido (quantidade × preço − tarifas).
4. **Anular a operação** leva a transferência para a lixeira junto.
5. **Trava no banco:** a transferência da Carteira não é criada, editada nem apagada à mão; só pela operação em
   Investimentos. A conta interna também não é editada, arquivada nem excluída.
6. **Mover para a carteira:** botão na conta (renda fixa, renda variável, cripto e, depois, as Nomad) que, numa só
   operação do banco, cria o ativo com o saldo atual da conta ("Só o valor"), transfere esse saldo para a Carteira
   (a conta zera sem despesa) e arquiva a conta. O Patrimônio não muda no momento.

## Decisões do dono (10/11/2026)
1. **Conta na compra é opcional**: "Não saiu de conta do app" (ex.: previdência) grava só a operação, como antes.
2. **Operações antigas** ficam como estão, sem mexer em saldo.
3. **Corretora continua no Disponível**: dinheiro parado na corretora é disponível; só o que virou ativo sai.
4. **Moeda:** só compra e venda em reais mexem em conta na primeira versão. Dólar e euro (contas Nomad) entram depois,
   com a cotação do Banco Central.

## Riscos
- Mexe em `account_balances`, de onde saem todos os saldos: o teste prova que nenhuma família sem a conta interna muda.
- A transferência para a Carteira aparece em Lançamentos e na exportação; não pode ser editada à mão (trava no banco).
- O valor da compra é arredondado a 2 casas no banco (quantidade × preço pode ter mais casas).
