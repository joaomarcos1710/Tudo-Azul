---
tags: [tudo-azul, plano, cartao, recorrencia]
---
# Recorrência no cartão estilo Organizze (plano)

**Status:** plano, sem código. Pedido do dono em 10/11/2026. Duas das quatro perguntas já têm resposta (seção "Decisões do dono"); falta a do limite.

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

## Decisões do dono (10/11/2026)
- **Até quando aparece:** "enquanto eu não cancelar". Sem data final fixa para o dono. Na prática o banco não gera infinito:
  a regra de conta já gera uma janela móvel (12 meses, estendida toda vez que o app abre). O cartão faria igual, e o
  dono nunca vê o corte. Isso vira o caminho B (ocorrências de verdade), não A.
- **Cancelar:** o mesmo diálogo do Organizze, com as duas saídas: "só esta ocorrência" ou "esta e as próximas" (encerrar a
  regra a partir dali). Vale para mudar o dia e para cancelar.
- Isso confirma a opção **B** como destino. A opção A fica só como passo intermediário, se o dono quiser ver algo antes.

## Perguntas ao dono (abertas)
1. ~~A, B ou C?~~ Respondida: destino é B. Falta saber se quer A antes, como passo rápido, ou ir direto para B.
2. ~~Quantos meses à frente?~~ Respondida: enquanto não cancelar (janela móvel).
3. **Aberta:** item futuro de cartão ocupa o limite do cartão antes da data? (Hoje não ocupa.)
4. ~~Cancelar~~ Respondida: as duas, no diálogo.

## Riscos e o que não foi verificado
- Não li `card_months`, `card_limits` nem `card_pending_subscriptions` por inteiro; o efeito exato em limite, Dinheiro
  Livre e projeção precisa dessa leitura antes de qualquer migration.
- Não vi a tela de fatura rodando; a descrição acima vem do código e da consulta ao banco.
- Em B, ocorrência editada à mão e regra podem divergir (já acontece na conta, resolvido pela chave
  `(recurrence_id, occurrence_date)`); no cartão isso precisa de teste próprio.

## Divisão proposta do trabalho (cada item = uma PR; B só começa depois da resposta da pergunta 3)
1. Leitura de `card_months`, `card_limits`, `card_pending_subscriptions` e `card_installment_edit` e desenho fechado do item
   planejado de cartão (documento, sem código).
2. Migration: ocorrências futuras de cartão como itens editáveis da fatura, com janela móvel, sem duplicar o previsto;
   testes pgTAP que falham sem ela. Produção só pelo workflow, com o "pode" do dono.
3. RPC "este e as próximas" / "só esta" / "excluir" para cartão (análoga à `recurrence_update_from`, migration 074).
4. Front: linhas na fatura e o diálogo de escolha.
