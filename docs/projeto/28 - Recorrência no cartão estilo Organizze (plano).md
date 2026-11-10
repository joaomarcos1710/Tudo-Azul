---
tags: [tudo-azul, plano, cartao, recorrencia]
---
# Recorrência no cartão estilo Organizze (plano)

**Status:** plano, sem código. Pedido do dono em 10/11/2026. Aguarda as decisões da seção "Perguntas".

## O pedido (nas palavras do dono)
"Nas faturas do cartão o que é recorrente não está aparecendo, deveria ser automático, já está lá lançado no dia certo e eu
vou alterando se cancelar ou se for um dia diferente." E: "no Organizze, se eu mudo o dia da recorrência, ele me pergunta
se é só aquela ou se vou para as outras também."

## Como é hoje (verificado no código e, só leitura, no banco em 10/11/2026)
- Recorrência **em conta** é lançada como *planejada* até 12 meses à frente (migration 022). O dono edita cada uma, e desde a
  #194 (migration 074, `recurrence_update_from`) o app já pergunta "Apenas este · Este e os próximos".
- Recorrência **no cartão** só vira compra **no dia da ocorrência** (`recorrencias.ts`, comentário do topo). Antes disso a
  fatura mostra uma linha só, "Assinaturas previstas", com o total (`card_pending_subscriptions`).
- No banco havia 19 recorrências de cartão ativas e só 1 já virou item de fatura (a cujo dia já passou). Nada falhou: é o
  desenho.
- A ocorrência de cartão é uma **parcela de fatura** (`debt_installments`), imutável, exceto o valor e só pela RPC
  `card_installment_edit` (migration 004b). Dia e cancelamento de uma ocorrência isolada não são editáveis hoje.

## O que o dono quer, em uma frase
Que o cartão se comporte como a conta: as ocorrências já aparecem na fatura certa (no dia certo), e ao mudar uma o app
pergunta "só esta" ou "esta e as próximas"; e cancelar uma ocorrência é possível.

## Por que não é simples
1. **Imutabilidade.** Lançar parcelas futuras exigiria permitir mudar data e cancelar parcela, hoje proibido de propósito.
2. **Dupla contagem.** A fatura já soma "assinaturas previstas". Se as ocorrências futuras virarem itens, o previsto
   precisa sair da soma, senão o mesmo valor entra duas vezes (fatura, limite, Dinheiro Livre, Orçamentos, projeção).
3. **Limite e faturas.** Item futuro de cartão ocupa limite? Entra na fatura aberta ou na do mês de vencimento? Hoje o
   previsto não ocupa limite.
4. **Produção.** Migration nova, testes que falham sem ela, aplicação só pelo workflow com `APLICAR` e o "pode" do dono.

## Caminhos
- **A. Só mostrar (leitura).** A fatura lista cada assinatura prevista como linha "prevista", sem lançar nada; o total
  continua do banco, sem duplicar. Mudar o dia ou cancelar = editar a regra inteira. Pequena, sem mexer em parcela
  imutável. **Não** dá "só esta ocorrência".
- **B. Lançar de verdade (como a conta).** Ocorrências futuras viram itens editáveis da fatura (novo tipo de item
  planejado de cartão, separado da parcela imutável), com "Apenas este · Este e os próximos" e "excluir só esta". É o
  comportamento do Organizze. Grande: migration, mudanças em `card_months`, limite, previstos, projeção e telas.
- **C. Meio-termo.** Fazer A agora (resolve "não aparece") e planejar B em PRs separadas, sem pressa.

Recomendação: **C**. A resolve a queixa visível em uma PR pequena e segura; B é a funcionalidade completa, mas muda
dinheiro em vários lugares e merece desenho e testes próprios.

## Perguntas ao dono
1. A, B ou C? (O dono já disse que quer o diálogo "só esta / esta e as próximas", que só existe em B.)
2. Quantos meses à frente as ocorrências de cartão aparecem? (Conta usa 12.)
3. Item futuro de cartão ocupa o limite do cartão antes da data? (Hoje não ocupa.)
4. Cancelar uma ocorrência (ex.: assinatura cancelada em dezembro) = "excluir só esta" ou "encerrar a regra a partir daqui"?

## Riscos e o que não foi verificado
- Não li `card_months`, `card_limits` nem `card_pending_subscriptions` por inteiro; o efeito exato em limite, Dinheiro
  Livre e projeção precisa dessa leitura antes de qualquer migration.
- Não vi a tela de fatura rodando; a descrição acima vem do código e da consulta ao banco.
- Em B, ocorrência editada à mão e regra podem divergir (já acontece na conta, resolvido pela chave
  `(recurrence_id, occurrence_date)`); no cartão isso precisa de teste próprio.
