---
tags: [tudo-azul, plano, cartao, recorrencia]
---
# Recorrência no cartão estilo Organizze (plano)

**Status:** plano, sem código. Pedido do dono em 10/11/2026. Todas as perguntas respondidas em 10/11/2026 (seção "Decisões do dono"). Desenho fechado abaixo; a implementação segue em PRs separadas.

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

- **Limite (corrigido em 10/11/2026, depois do print do Organizze):** o item recorrente futuro já está na fatura e no total dela, mas **só ocupa o limite quando a fatura anterior fecha**. A versão anterior desta linha ("não ocupa antes da data") estava errada. Vale **só para recorrência**; compra parcelada continua ocupando o limite desde a compra, como hoje (`card_limits` soma toda parcela não cobrada em `planned_remaining`).
- **Caminho:** "ir direto para a B" (resposta de 10/11/2026), com o desenho abaixo.

## Desenho escolhido (leitura de `recurrence_materialize` e `card_recurrence_pending`, 10/11/2026)
Em vez de gravar parcelas futuras (imutáveis e que contariam no limite e no saldo da dívida), as ocorrências futuras
continuam **derivadas da regra**, como já são hoje para o total "Assinaturas previstas". O que muda:
1. **Mostrar:** `private.card_recurrence_pending(household, primeiro, último)` já devolve, para qualquer intervalo de
   faturas, cada ocorrência ainda não materializada (valor, categoria, data, fechamento). Uma função pública nova lista
   essas linhas por cartão e fatura (com descrição e id da regra), e a fatura passa a mostrá-las como "prevista". O total
   já vem da mesma conta, então não duplica. Não ocupam limite (continuam fora das parcelas).
2. **Exceções:** tabela `recurrence_exceptions (recurrence_id, occurrence_date, ação, nova data/valor/descrição/categoria)`.
   "Só esta" = grava uma exceção (excluir ou editar). `card_recurrence_pending` e `recurrence_materialize` passam a
   respeitar a exceção, e o par único `(recurrence_id, occurrence_date)` continua impedindo duplicar.
3. **Esta e as próximas:** como a migration 074 faz para conta, a MESMA regra é reancorada na ocorrência (mudar o dia
   ou o valor, ou encerrar com `end_date`). Só vale para ocorrências ainda não materializadas (as já cobradas são parcelas
   imutáveis, e o valor delas só muda por `card_installment_edit`).
4. **Janela móvel:** o cartão gera a compra no dia, como hoje; o que o dono vê para frente vem da regra, sem limite
   enquanto a regra existir. Não há corte para o dono perceber.

## Perguntas ao dono (respondidas)
1. ~~A, B ou C?~~ Respondida: direto para a B (sem passo A isolado); a fatia "Ver" é a primeira PR da B.
2. ~~Quantos meses à frente?~~ Respondida: enquanto não cancelar (janela móvel).
3. ~~Item futuro~~ Respondida: não ocupa o limite. (Era: item futuro de cartão ocupa o limite do cartão antes da data? (Hoje não ocupa.))
4. ~~Cancelar~~ Respondida: as duas, no diálogo.

## Riscos e o que não foi verificado
- Não li `card_months`, `card_limits` nem `card_pending_subscriptions` por inteiro; o efeito exato em limite, Dinheiro
  Livre e projeção precisa dessa leitura antes de qualquer migration.
- Não vi a tela de fatura rodando; a descrição acima vem do código e da consulta ao banco.
- Em B, ocorrência editada à mão e regra podem divergir (já acontece na conta, resolvido pela chave
  `(recurrence_id, occurrence_date)`); no cartão isso precisa de teste próprio.

## Divisão do trabalho (cada item = uma PR; migration só vai a produção pelo workflow, com o "pode" do dono)
1. (esta PR) Plano e decisões.
2. **Ver:** função de leitura das ocorrências previstas por fatura + linhas "previstas" na fatura (resolve "não aparece").
   Teste pgTAP que falha sem ela.
3. **Mudar:** tabela de exceções, `card_recurrence_pending` e `recurrence_materialize` respeitando-as, RPC "só esta"
   (excluir/editar) e "esta e as próximas" (reancorar/encerrar), com testes.
4. **Diálogo** no app: "Atualizar só esta · Esta e as próximas · Cancelar", em Recorrentes e na linha da fatura.

## Revisão do desenho (10/11/2026, depois do print do Organizze)
O dono mostrou a fatura de dezembro do Organizze: as recorrências já estão lançadas nas faturas futuras, com o ícone de
repetição, somando no total da fatura. O desenho "só derivado da regra" acima (fatia "Ver", #252) mostra as previstas,
mas não as coloca no total da fatura. Um agente de planejamento comparou três caminhos; o escolhido é a **tabela de itens
agendados** (`card_scheduled_items`), que vira parcela no fechamento da fatura anterior.

**Respostas do dono às perguntas (10/11/2026):**
1. A regra do limite vale só para recorrência ("duas coisas diferentes, parcelado come o limite").
2. Horizonte: 12 meses, renovando sozinho ("perfeito").
3. **Em aberto ("talvez").** Proposta: depois de virar parcela, mudar o dia é recusado e o valor continua editável (`card_installment_edit`). Decidir antes da etapa 3.
4. Sem botão "Lançar": tudo automático ("ok").
5. **Provisório ("vamos testar").** Item que cairia numa fatura paga e travada vai para a fatura seguinte; validar com o dono quando a etapa 3 estiver de pé.
6. Cancelar "esta e as próximas": o que já virou parcela fica; o resto é cancelado ("sim").

**Etapas (cada uma uma PR, migration só vai a produção pelo workflow com o "pode" do dono):**
1. Tabela `card_scheduled_items`, leitura pela família, sem escrita pelo app (migration 20261110020000, teste 87).
2. Gerar os itens a partir da regra e mostrar nas faturas futuras, com total em SQL. O limite ainda fica como hoje.
3. Converter em parcela no fechamento da fatura anterior (é aqui que o limite passa a seguir a regra do dono);
   `recurrence_materialize` deixa de criar a parcela no dia.
4. Diálogo "só esta" / "esta e as próximas".

**Ainda não verificado (antes da etapa 2):** o corpo atual de `card_months` (fatura futura sem parcela não tem linha);
onde a cobrança das faturas roda no app; efeito em projeção, Dinheiro Livre e Orçamentos.
