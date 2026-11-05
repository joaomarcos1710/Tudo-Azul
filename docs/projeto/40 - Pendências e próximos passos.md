---
tags: [tudo-azul, pendencias]
atualizado: 2026-10-28
---
# Pendências e próximos passos

## Decisões suas
- [x] Versão **2026.2** (feito).
- [x] Commit na versão: **só na tela Família** (#56).
- [ ] Alerta de vencimento por **push**? (iPhone/Android? você usa iPad, celular e site; hoje o card "Vencidos" cobre)

## Conferências suas (no app)
- [ ] Cartão criado com saldo atual: a fatura nova **não** aparece como paga sem você pagar.
- [ ] Menu "Mais", olho de ocultar valores, editar valor com a máscara ligada.
- [ ] Início e Análises no celular e no iPad (#57).
- [ ] Remover o crédito de teste de R$ 100 por **Anular** no cartão.
- [ ] Configuração **Confirm email** no Supabase.
- [ ] Baixar a exportação completa e conferir com o extrato (critério 3).
- [ ] Recorrências já reajustadas antes da migration 015: conferir os planejados futuros (correções feitas à mão podem ter sido sobrescritas e não há como recuperar automaticamente).
- [x] Aplicar a migration 015 em produção pelo workflow após o merge do PR #59 (26/10/2026; execução 20).

## Próximos PRs sugeridos
- [x] **Cartões: destaque da fatura atual e menu "Mais opções"** (#163, 05/11/2026): pedido do dono (zero em destaque e botões demais).
- [ ] **Unificar os menus**: "+ Lançamento" (`MenuNovo` em `Lancamentos.tsx`) passar a usar `MenuAcoes` (hoje são dois menus com o mesmo comportamento; o de Lançamentos não anda com as setas).
- [ ] **Início, bloco Cartões**: avaliar o mesmo destaque "Fatura atual" de Cartões (#163 não mexeu no Início; só passou a mostrar a fatura do ciclo de hoje, com R$ 0,00 quando não há compra).
- [x] **Cartões: seletor de fatura com fechamento 29–31** (#163): usa o dia ajustado ao mês, como o banco (`card_day_in_month`).
- [x] **Cartões: "Fatura atual" do ciclo de hoje** (#163): antes era a primeira fatura aberta com linha em `card_months` (podia ser a de 1–2 meses à frente).
- [x] **Cartões: fatura fechada não cobrada não é "Paga"** (#163): `situacaoFatura` usa o `total`.

### Relatórios (#171, 05/11/2026)
- [x] **Relatórios e exportação redesenhados** (#171): filtros numa folha, contas arquivadas escondidas, gráfico, tabela compacta com Saldo, Acumulado opcional, exportação num card compacto.
- [ ] **Conferir no iPad em retrato** (você): folha de filtros, carrossel de mês, gráfico e tabela sem rolar para o lado.
- [ ] **Saldo com filtro de conta**: hoje a coluna some quando há conta (ou pessoa) escolhida, porque `balance_totals_projected` não filtra. Precisa de uma função do banco com `p_accounts` (migration nova), nunca soma na tela.
- [ ] **Saldo em uma chamada só**: hoje é uma chamada de `balance_totals_projected` por período (até 31 no diário). Uma função do banco que devolva a série de saldos (como a de patrimônio do PR de desempenho) evita as idas e vindas.
- [ ] **Unificar painéis**: `PainelLancamento` (Lançamentos) passar a usar `ui/Folha` (que prende o foco e devolve ao botão).
- [ ] **Eixo do gráfico de linha com negativo** usa hífen ("R$ -20 mil", `brlCompacto`); trocar pelo "−" tipográfico em todos os gráficos.

### Achados da análise da aba Cartões (05/11/2026), ainda abertos
- [ ] **Assinaturas previstas na fatura atual**: assinatura (recorrente no cartão) que ainda não foi gerada não entra no valor da fatura atual nem no da aberta.
- [ ] **Pagamento com data futura**: "Pagar fatura" aceita data futura; decidir se bloqueia, avisa ou agenda como planejado.
- [ ] **`card_items` líquido de estorno/cancelamento**: a linha da compra mostra o valor de face; estorno ou cancelamento parcial não aparece descontado nela.
- [x] **Painel abrir junto do cartão no celular** (#166): o painel abre dentro do cartão clicado, com foco no título; ao fechar, o foco volta ao botão (ou ao "⋯").
- [x] **Abas de fatura começarem na atual** (#166): abrem na fatura do ciclo de hoje, roladas até ela; mostram as 6 anteriores e as próximas ("Ver mais antigas" mostra o resto; fechada não paga nunca fica escondida); setas, Home e End.
- [x] **Total das faturas do mês no topo de Cartões** (#166): resumo com "Faturas que vencem em <mês>" (`card_invoices_month`, o mesmo componente do Início) e "Próxima fatura vence em <data>"; no computador, ao lado dos cartões em 2 colunas.
- [x] **Selo "Vencida"** (#166): no destaque (com o vencimento da mais antiga, "venceu dd/mm") e nas abas; mesma regra do Início.
- [x] **Renomear "Parcelas futuras"** (#166): "A cobrar (atual + futuras)", com a dica embaixo.
- [x] **Estorno parcial na linha da compra** (#166): botão "Estornar" (valor até o da parcela e data; `debt_refund`). Falta você: estornar uma compra de teste e conferir a fatura e o resultado do mês. Ver também o item do `card_items` líquido acima: a linha continua mostrando o valor de face até a migration 058.
- [ ] **#166: limite disponível total e valor total no resumo de Cartões** (referência do Mobills): são somas de dinheiro, ficam para a `card_overview` no banco (PR de desempenho), nunca somadas na tela.
- [ ] **#166: seletor de mês no resumo de Cartões** (referência do Mobills, "NOVEMBRO ▾"): o resumo mostra só o mês de hoje; o mês das abas é por cartão e não serve. Fazer junto da `card_overview`, se o dono quiser.
- [ ] **#166: estorno sem chave de repetição**: `debt_refund` não tem `p_idem`; o botão fica travado enquanto envia, mas rede ruim com nova tentativa pode gravar duas vezes. O banco também não confere se a soma dos estornos passa do valor da parcela (a tela só limita cada estorno ao valor da parcela). Corrigir numa migration (idempotência e teto), se o dono quiser.
- [ ] **#166: os painéis de Editar/Excluir/Reabrir na fatura** continuam no topo da fatura escolhida (só o de Estornar abre na linha); levar para a linha se incomodar no celular.
- [ ] **Desempenho**: uma chamada `card_overview` por família em vez de `card_months` por cartão ao abrir a tela (hoje N+1 consultas).
- [x] **Multimoeda F1 — moeda na conta e saldos por moeda** (migration 055, #160): merge `8e62600`; **aplicada em 04/11/2026** (execução 41912792280, simulação 41912680166).
- [x] **Multimoeda F2 — receita e despesa em moeda estrangeira e relatórios por moeda** (migration 056, #161): merge `5c70512`; **aplicada em 05/11/2026** (execução 41942726578, simulação 41942648839). Provento continua só em reais.
- [x] **Avisos no topo do Início** (migration 057, #162): a receber e a pagar em 7 dias, fatura que vence em 7 dias e vencidos, do banco (`home_alerts`); Minhas contas só com as contas com saldo. merge `404500a`; **aplicada em 05/11/2026** (execução 41944777617, simulação 41944718863).
- [x] **Lançamentos: fatura do cartão numa linha no vencimento** (#164, pedido do dono de 05/11/2026): merge `d9727eb`, sem migration. Falta você: abrir um mês com cartão e conferir o total da linha "Fatura" com a tela Cartões.
- [x] **Lançamentos: tabela no computador e edição em lote** (#167, 05/11/2026, "pode" do dono): feito, com a migration 060 (**não aplicada**). Falta você: dar o "pode" para o merge e para aplicar a 060 pelo workflow (simular → ler o log → aplicar); conferir no computador a seleção, as três ações e o Desfazer.
- [x] **Lançamentos: créditos do cartão dentro da fatura e lista em 2 linhas** (#172, 05/11/2026, pedido do dono): feito, sem migration. Falta você: abrir no iPad em retrato um mês com crédito no cartão e conferir que o crédito está em "Ver compras" da fatura, que nada se sobrepõe e que o ✓/⋯ funcionam.
- [ ] **#172: abrir a fatura com créditos faz 2 consultas** (compras e créditos, só quando o banco diz que há créditos). Junto da função por família da #164, se ficar lento.
- [ ] **#172: crédito com filtro de categoria × Receita**: com categoria, o crédito aparece no **vencimento** da fatura (como as compras); com Receita, no **fechamento**. Quando fechamento e vencimento caem em meses diferentes, o crédito muda de mês conforme o filtro (mesma questão da #164 com as compras).
- [ ] **#172: tabela (≥1024px)**: a linha da fatura ainda tem "Ver compras" e "Cartões" lado a lado; em 1024px a descrição quebra em 2 linhas. Trocar pelo mesmo ▸/▾ da lista se incomodar.
- [ ] **Atalho da #167: desfazer de categoria em várias chamadas** (`TabelaLancamentos` em `src/pages/LancamentosTabela.tsx`): uma chamada de `transactions_bulk_set_category` por categoria antiga; se a 2ª falhar, a 1ª já voltou. Melhorar com uma função de pares (id, categoria) no banco se acontecer.
- [ ] **#167: seleção de vários no celular** (fora do pedido): hoje só no computador.
- [ ] **#167: ordenação por valor mistura moedas** (só exibição): conta em dólar e em reais são ordenadas pelo número, sem conversão.
- [ ] **Atalho da #164: `card_months` por cartão** (`listarFaturasDoMes` em `src/lib/lancamentos.ts`): a lista chama a função uma vez por cartão, com o histórico inteiro, e escolhe o mês na tela. Melhorar com uma função do banco por família e período (como `card_invoices_due`, mas com fechamento e situação) se ficar lento.
- [x] **#164: valor da compra em "Ver compras"** — resolvido pela 058 (#165): `card_items.face` passa a ser o valor líquido. Era o valor da parcela (`card_items.face`), igual à tela Cartões: um desconto parcial (cancelamento de parte da parcela) não aparece descontado na linha da compra, só no total da fatura. Antes da #164 a lista mostrava o valor já descontado. Corrigir junto, em Cartões e Lançamentos, se o dono quiser.
- [ ] **#164: filtro de categoria × relatórios**: com o filtro, a lista mostra as compras das faturas que **vencem** no mês; os relatórios por categoria contam pelo **fechamento**. Quando os dois caem em meses diferentes, os números não batem. Decidir com o dono se o filtro de categoria deve seguir o mês do fechamento. **A #170 não resolve**: o seletor de base (fatura/compra/parcela) muda só o relatório, e nenhuma das três bases é o mês do **vencimento**, que é o que a lista usa; continua aberto (decidir se Lançamentos também ganha a base, ou se o filtro segue o fechamento).
- [x] **Base dos gastos de cartão no relatório por categoria** (migration 062, #170): seletor em Análises (fatura · compra · parcela), banco `expenses_by_category_basis`. **Falta aplicar a 062** em produção (workflow: simular → ler o log → aplicar, com o "pode"); até lá, as bases compra e parcela mostram "Gráfico indisponível agora" e a fatura funciona.
- [ ] **Base do cartão em outros relatórios por categoria**: se surgirem (exportação por categoria, comparação entre meses), usar `expenses_by_category_basis`. O gráfico de despesas por dia continua pela fatura.
- [ ] **Conferir no app (você):** em Análises, um mês com compra parcelada; trocar a base e ver a compra inteira no mês dela (compra) e a parcela no mês dela (parcela); os totais do topo não mudam.
- [x] **Consertos de valor da aba Cartões** (migration 058, #165): pagamento de cartão com data futura recusado (e `max` de hoje no campo da data); itens da fatura líquidos e "n de N" só com parcelas vivas; função das assinaturas previstas na fatura aberta. **Falta aplicar a 058** em produção (workflow: simular → ler o log → aplicar, com o "pode").
- [ ] **Cartões: mostrar "inclui R$ X de assinaturas previstas"** abaixo do valor da fatura atual, lendo `card_pending_subscriptions` (058). Ficou de fora da #165 porque o bloco do destaque da fatura estava sendo mudado em outra PR. Avaliar também no total de faturas do Início (`card_invoices_month` não soma a previsão).
- [x] **Cartão: troca de ciclo com dois fechamentos no mesmo mês** (migration 061, #169): a troca dos dias vale a partir do ciclo seguinte ao da fatura aberta; o banco recusa a que ainda deixaria dois fechamentos no mesmo mês; a tela Alterar dias diz "A mudança vale a partir da fatura que fecha em dd/mm/aaaa". **Falta aplicar a 061** em produção (workflow: simular → ler o log → aplicar, com o "pode").
- [ ] **Troca de dias, limites da 061**: (1) cartão com compra parcelada em andamento não troca os dias até a última parcela do ciclo atual estar na fatura aberta (decisão: recusar); (2) o cartão guarda só a última troca: compra **retroativa** de antes da penúltima troca usa os dias anteriores à última e pode cair num fechamento diferente do que o mês já tem (raro); (3) mês só com crédito avulso, sem parcela, mostra em `card_months` o vencimento pelos dias atuais do cartão, não pelos do mês; (4) cartão sem nenhum lançamento também espera o ciclo seguinte (corrigir um dia digitado errado num cartão novo não vale na hora); (5) o cabeçalho "Fecha dia X · vence dia Y" mostra os dias novos já durante a transição (a fatura atual e o melhor dia de compra usam os do mês). Melhorar se o dono pedir.
- [ ] **Atalho dos avisos do Início**: conta em outra moeda fica fora dos avisos (só reais); fatura **vencida** não vira aviso (continua no bloco Cartões, "venceu em"); o link de a receber/a pagar abre o mês do item mais próximo, filtrado pelo tipo, mas sem filtrar "só planejados" — se a janela de 7 dias cruzar o mês, os do mês seguinte ficam na outra página. Melhorar com bloco por moeda (F3+) e um filtro de situação em Lançamentos, se o dono pedir.
- [ ] **Multimoeda F3**: transferência entre moedas (`destination_amount`); libera transferência e pagamento de cartão/dívida a partir de conta estrangeira, se fizer sentido.
- [ ] **Multimoeda F4**: cotações PTAX (compra) e total convertido para BRL (nunca somar sem conversão).
- [ ] **Multimoeda F5**: relançar a Nomad a partir de 01/01/2026 pelo extrato (o passado fica em reais; "Nomad Real" continua BRL); contas da corretora numa segunda rodada.
- [ ] **Opcional (multimoeda)**: pares de câmbio de 2024–2025 (cotações históricas), se o dono quiser converter o passado.
- [ ] **Atalho da F2** (`aceitaLancamento` e `mesmaMoeda` em `src/lib/contas.ts`): transferência só entre contas da mesma moeda (F3 libera entre moedas, com a cotação); cartão, dívida e provento seguem só em reais, sem fase prevista. Calendário: o saldo total previsto é só em reais; a conta estrangeira aparece na lista com o saldo na moeda dela.
- [ ] **Atalho da F2: aviso diário** (`daily_digest`): planejado em conta estrangeira não entra no aviso (o aviso fala em reais); entra quando o aviso tiver bloco por moeda.
- [ ] **Atalho da F2: "Em outras moedas" do período** (`period_summary_by_currency`): só o **pago** (sem planejados) e sem filtros; em Entradas x Saídas some com filtro de conta ou de quem lançou. Se o dono quiser planejados por moeda, estender a função.
- [ ] **Atalho da F2: Calendário sem a lista de contas** — se `listarContas` falhar, os itens do dia caem para reais (não há a moeda da conta); raro, mas mostraria US$ como R$. Melhorar trazendo a moeda junto do lançamento.
- [x] **Índice de eventos por parcela** (migration 053, #156): aplicada em 04/11/2026.
- [x] **Importar o histórico do Organizze** (04/11/2026): feito; saldos das 21 contas batem. Falta você: abrir 2 ou 3 faturas recentes no app e comparar com o Organizze (a conferência automática olhou os saldos das contas e as contagens, não fatura a fatura).
- [x] **Empréstimo da Funcef em Dívidas** (04/11/2026). Falta você: no boleto de 20/11, comparar juros e amortização com o cronograma do app (taxa cadastrada a partir do extrato).
- [x] **Reset e exportação completa com investimentos e bens** (migration 054, #158): feito e **aplicada em 04/11/2026**. Antes, `reset_preview`, `reset_household` e a exportação completa deixavam de fora ativos, operações, avaliações e proventos de investimento e os bens da família (achado da revisão do Manus, 04/11/2026).
- [x] **Relatórios: número de arquivos** (#158) — com investimentos e bens a exportação completa tem **8** arquivos; a tela e o `csv.ts` dizem 8 e listam todos. `npm audit fix` feito (0 vulnerabilidades).
- [x] **Aplicar a migration 054** em produção: aplicada em 04/11/2026 (execução 41902641771, simulação 41902529963).
- [x] **Conferência com o extrato fora do app** (#159, decisão do dono de 04/11/2026): tela, botão, menu e textos removidos; coluna "Conferido" saiu da exportação. Banco intacto (sem migration).
- [ ] **Apagar a conferência do banco** numa migration futura, se a decisão se mantiver: tabela `account_reconciliations`, coluna `reconciliation_id` em `transactions`, `reconcile_account`, `reconciliation_undo`, as travas de período conciliado nos gatilhos e funções, o `reconciled` de `account_movements`, a contagem em `reset_preview`/`reset_household` e os testes pgTAP e o `00_audit` correspondentes. Antes, conferir em produção que continua com 0 conferências.
- [ ] **Exportação completa: preço e quantidade de investimento como texto** — vão como o banco grava (até 10 e 12 casas, vírgula decimal), não em centavos; a planilha pode ler como texto. Não restaura nada (o app não importa os arquivos).
- [ ] **Depois:** total de todos os cartões; % quitado das dívidas; ~~relatório por categoria com gráfico~~ (#168, barras em Análises).
- [x] **Crédito no cartão como receita** (migration 052, #153): aplicada em 04/11/2026. Falta você testar no app: lançar um crédito (ex.: estorno de IOF) e conferir a fatura, o limite e Lançamentos.
- [x] **Escolher a fatura da compra e recuar o início do cartão** (migration 051, #152): aplicada em 04/11/2026.
- [x] **Aplicar a migration 050** (excluir ativo com histórico, #151): aplicada em 04/11/2026.
- [ ] **Lista "Melhoria 1" do dono (02/11/2026)** — os arquivos Melhoria_2 ("Investimento") e Melhoria_3 ("Dívidas") vieram só com o título; os prints IMG_0373 a IMG_0377 não vieram. Itens: ~~(5) categoria do recorrente em todos os lugares~~ (#122; 036 aplicada em 02/11/2026); ~~(1) Início: transferências com logo dos bancos e "De → Para"~~ (#124); ~~(2) Extrato: só a categoria~~ e ~~valor truncado no planejado~~ (#124, causa provável: o par de valores não quebrava de linha no celular; confirmar no preview); ~~(3a) Investimentos: alinhar custo e resultado~~ (#124); ~~(3b) ativos cadastrados: editar, excluir e tratar o zerado~~ (#126, sobre a #125; falta aplicar a 040); (3c) gráfico de distribuição do patrimônio (contas, investimentos, tipos); ~~(4a) grafia de "Financiamento"~~: o "Financiamenyo" era o **nome digitado** na dívida, não texto do app; a tela de Dívidas não deixava renomear, agora deixa (#124); **ainda falta** arquivar/excluir dívida (loan/financing) na tela de Dívidas; ~~(4b) remover o simulador Snowball/Avalanche~~ (#124); (4c) gráfico de evolução de investimentos e dívidas no dashboard, sem confundir aporte com rentabilidade.
- [x] **Aplicar a migration 031 (`recurrence_end_delete`)** — aplicada em 02/11/2026 (execução 41542393688), junto com a 032, com o "pode" do dono.
- [ ] **Implementar no Tudo Azul as ideias do protótipo do AI Studio** (30/10/2026; só como especificação, o código dele não entra): ~~categorias na regra 50-30-20~~ (feito no #114; 032 aplicada em 02/11/2026); ~~relatório Entradas x Saídas~~ (feito no #116; 033 aplicada em 02/11/2026); ~~macroclasse e subclasse de investimento~~ (feito no #118; 034 aplicada em 02/11/2026); ~~proventos~~ (feito no #120; 035 aplicada em 02/11/2026); metas; importar extrato.
- [ ] **O futuro do dinheiro (pedido do dono em 30/10/2026, três pontos)**: (1) a fatura do cartão que vence dia 28 deve aparecer no **Calendário** no dia 28 como planejada (hoje o calendário só mostra lançamentos e movimentos de dívida pagos); (2) **saldo em meses futuros**, total e por conta, com a escolha "só efetuados" ou "efetuados + planejados" (hoje `account_balances` só conta `status = 'paid'` e o Calendário só mostra receitas e despesas do mês); (3) **[em aberto]** uma **aba Relatórios** no estilo do Organizze: Categorias (rosca + lista com %), Balanço (entradas x saídas, resultado por período), Tags, com filtros Pagos/Todos, periodicidade (diário, semanal, mensal, acumulado) e contas. A tela Relatórios de hoje só exporta CSV. Atenção: o saldo **por conta** com fatura planejada depende de saber qual conta paga cada cartão (conta de pagamento padrão, migration); no total, a fatura em aberto pode ser descontada sem isso.
- [ ] **Cartões, ideias da pesquisa pública (30/10/2026)**: (1) "Fatura atual (venc.)" separada de "A pagar" no Início e em Cartões; (2) limite opcional no cadastro e o campo de saldo explicado; (3) conta de pagamento padrão do cartão (migration); (4) documentar e testar a regra do dia do fechamento e dos dias 29 a 31. O total das faturas do mês no Início (migration 023) já está em PR. Mobills e Organizze pedem limite e conta de pagamento no cadastro.
- [x] **Recorrentes: horizonte de geração** (migration 022): feito. Sem data final, 12 meses; com data final, até ela (máx. 360). Aplicada em 30/10/2026; falta o dono conferir no app.
- [ ] **Tela de Empréstimos e Financiamentos** (decisão do dono em 30/10/2026: "vamos criar depois"): saldo devedor, parcelas pagas e quanto falta quitar. O banco já tem `debts`/`debt_installments`/`debt_pay`/`debt_balances`.
- [x] **Arquivar/excluir cartão e conta** (migrations 020 e 021, #88 e #89): feito e aplicado em 30/10/2026. Falta o dono conferir no app: o cartão de exemplo que não deixa excluir (ler a mensagem nova, que diz o que existe) e decidir se a exclusão deve valer quando só sobram registros anulados.
- [x] **Testes pgTAP que dependem da data de hoje** (A1 `12_card_correcoes`, A2 `22_recurrence_frequency`): corrigidos (como se fosse 02/01/2027 falhavam 4 testes). Para achar outros do mesmo tipo: `su postgres -c "scripts/local-db/simular-data.sh AAAA-MM-DD"` roda a suíte com outra data de hoje.
1. ~~**Início × Análises**~~ — feito (#57).
2. Front: atualizar faturas antes de abrir Relatórios e Orçamentos.
3. Front: mostrar conta desativada com saldo na Visão geral.
4. Docs: README/PLANO/MODELO desatualizados (ex.: "compra no cartão é despesa na data da compra"; vale a data de fechamento).
5. **Tailwind 4** (PR próprio, revisão visual).

## Períodos financeiros (aprovados por etapa, sem pular)
- **PR 1 (mesclado, #58):** só a função pura de intervalos e testes (`src/lib/periodos.ts`), sem efeito visível. Próximas etapas (preferência da família, seletor, Lançamentos, Início/Análises, exportação, personalizado) só com a sua autorização de cada uma.

## Recorrência com frequência
- [x] **Banco (migration 016)**: PR #65 mesclado e aplicado em produção em 28/10/2026 (execução 22).
- [x] **App**: PR #66 mesclado depois da 016 aplicada.
- [ ] Conferir no app, depois dos dois merges: cadastrar uma quinzenal e a PLR anual de teste e ver os planejados em Lançamentos e no Calendário.
- Depois (só com autorização): "mudar frequência" numa ação só (encerra a regra e cria outra).
- [x] **Recorrentes agrupados por frequência e totais por mês no cartão/na conta** (#173): migration 063 (`recurrence_summary`) **não aplicada** — aplicar pelo workflow (simular → log → `APLICAR`) com o seu "pode" **antes** de publicar o front (sem ela a tela Recorrentes mostra erro ao carregar).
- [ ] Conferir no iPad/celular: os cartões do topo, as abas Conta/Cartão e os totais de cada grupo com os seus recorrentes reais.
- [ ] Recorrentes em outra moeda ficam fora dos totais (só um aviso com a quantidade). Se quiser, um total por moeda depois.
- [ ] O equivalente mensal de cada item (≈ R$ x/mês) não aparece na linha do item, só nos totais; dá para trazer do banco (nível `detail` por regra) se fizer falta.

## Menu e formulário de lançamento
- [x] **Projeção errada depois de excluir recorrente** (#86, mesclado em 29/10; **migration 019 aplicada em produção em 29/10/2026**). Já pode excluir recorrente com lançamento pago no mês corrente.
- [ ] **Excluir recorrente + versão 2026.5** (#84, mesclado em 29/10; **migration 018 aplicada em produção em 29/10/2026**). Falta você: excluir o recorrente já finalizado em Recorrentes → Encerrados, conferir que os lançamentos pagos dele continuam, e testar a 2026.5 no iPhone.
- [ ] **Banco gravado e bandeira do cartão** (#80, mesclado em 29/10; **migration 017 aplicada em produção em 29/10/2026**). Falta você: escolher o banco das contas (Contas → Editar) e o emissor/bandeira dos cartões (Cartões → "Escolher banco e bandeira") e conferir os logos no iPhone. Next, Original e Will seguem com a sigla (sem logo).
- [ ] **Logos de banco** (#79, mesclado em 29/10): 20 logos importados de `rzmt/logos-bancos-br` (origem em `src/assets/bancos/ORIGEM.md`); Next, Original e Will continuam com a sigla. Conferir no celular. Banco novo: subir o arquivo com o nome da chave (`LEIAME.md` da pasta).
- [ ] **Subcategoria sob a principal + selo do banco** (#78, mesclado em 29/10, pedido do dono em 29/10/2026). Conferir no celular: Reembolso logo abaixo da categoria-mãe dele (Salário) e o selo da Caixa em Contas, Início e Lançamentos (a tela Conferir saiu na #159). Se quiser o **logo oficial** (arquivos licenciados seus) ou **escolher o banco** em vez de depender do nome, é PR à parte (coluna + migration, fluxo de produção).
- [ ] Menu "Mais" com cartões de atalho e frase em cada tela (#75, mesclado; opção A do dono). Conferir no iPhone. Sem mudança de versão: entra na próxima edição (2026.5) junto com o próximo lote visível.

- [ ] **Formulário de lançamento em visual de app** (#76, mesclado; pedido do dono): abas, valor grande, campos em linhas, "Registrar e lançar outro" e última conta/cartão lembrados (ideias 2, 3, 6 e 7 de [[50 - Ideias e comparações]]; conta principal na versão "lembrar a última usada", sem banco). Conferir no iPhone a linha da **data**: o iOS escreve a data por extenso e pode não caber.
- [ ] **Fatura do cartão como extrato** (PR de rascunho, pedido do dono: o nome da compra aparecia cortado em "Vi…" depois do ícone do #72): agrupada por dia, nome inteiro, categoria embaixo, botões compactos. Conferir no iPhone.
- Próximo do mesmo pacote (só com autorização): grade de categorias com ícone, botão "+" flutuante, pré-preencher pela URL (atalho do iPhone nível 1).

## Cartão: antecipar parcelas (pedido do dono em 28/10/2026, para depois)
- Hoje não dá para **antecipar** parcelas de uma compra parcelada (pagar antes ou pedir a antecipação ao banco). Alguns cartões dão **desconto** na antecipação.
- A pensar antes de implementar: as parcelas antecipadas entram em qual fatura; o desconto vira abatimento da despesa (a despesa da compra diminui) e em qual mês; o limite libera na hora; precisa de migration (função nova no banco, com teste pgTAP) e passa pelo workflow de produção.

## Banco (baixo risco, não bloqueiam)
Idempotência com conteúdo diferente · `debt_chk` quadrático · `card_months` com data futura · ~~"Conferido" de transferência~~ (sem sentido desde a #159: a conferência saiu do app) · estorno em mês diferente · trava de reclassificar categoria.

## Roadmap
Dez–Jan multimoeda · Fev–Abr/2027 investimentos · importar do Organizze (volta ao Brasil) · domínio · planos pagos (limite de membros 1/3/5–10).

## PRs abertos
Nenhum em 27/10/2026. As propostas de multimoeda (#10) e de importação do Organizze (#9) estão na `main` como histórico, com nota de status: revalidar antes de implementar.

## Ideias guardadas
Ideias do Livro de contas (valor do dia no Calendário, grade de categorias no lançamento, lançar em sequência, tema escuro, relatório anual): ver [[50 - Ideias e comparações]]. O dono vai mandar prints de outros apps; só se aplica o que ele pedir.
Lixeira completa · aviso de nova versão do PWA · atualizar ao voltar ao app · foco/rolagem nos formulários · contraste · taxa de poupança e meses de reserva · metas com prazo (junto com investimentos) · detector de recorrência (depois da importação).

## Redesenho visual (design system)
- [ ] **Parte 1** (#64, mesclada como versão 2026.3): padding dobrado nos painéis, mês com maiúscula certa, lista de Lançamentos compacta, ações rápidas com ícone, contorno de campos com contraste. Conferir no celular e no iPad depois do merge.
- [x] **Parte 2** (#69, versão 2026.4): cabeçalho padrão em todas as telas e Cartões com a fatura em destaque. Testada pelo dono no app em 28/10/2026.
- [ ] **Parte 3 — PR 1** (#72, mesclado; decidido: o app sugere pelo nome e você troca): ícone e cor em Categorias, Lançamentos, itens da fatura em Cartões e listas do Início. Conferir no celular e no iPad depois do merge.
- Parte 3 — PR 2 (depois do teste do PR 1): ícone em Orçamentos e no detalhe do dia do Calendário.
- Depois (só com a sua autorização): formulário de lançamento em folha no celular; seletor de mês em painel próprio.

## Do protótipo do Base44
- [ ] **Calendário do mês** (#62, mesclado em 28/10): conferir no celular e no iPad.
- Ainda não feitos (só com a sua autorização): destaques do mês e comparativo por categoria em Análises.
- [x] Testes que dependiam de `current_date` em UTC (pgTAP 34, 35, 36) e de `new Date()` UTC (Início): trocados pela data de São Paulo no #124. Ainda vale uma varredura nos demais testes por qualquer dependência de relógio.

## Em aberto (03/11/2026)
- [x] **041 aplicada** em 03/11/2026 (execução 41619293355): consignado com juros liberado.
- [x] **043 aplicada** em 03/11/2026 (execução 41663655015). A migration da #128 foi renumerada para 045 (depois da 044).
- [x] **Aportes no caixa:** decidido (03/11/2026): investimento de liquidez é conta do tipo Investimento (#131); aplicação e resgate são transferências. Pendente do dono: trocar as aplicações lançadas como despesa por transferências e arquivar o CDB da tela de Investimentos.
- [x] **FII entrando como renda fixa:** a classe passou a ser obrigatória no cadastro de ativo (#134).
- Gráfico de distribuição do patrimônio; PR 5 (importar extrato) e PR 6 (metas e fluxo mensal) do plano do protótipo.

## Desempenho (03/11/2026)
- [x] Cache do navegador para `/assets` e JS dividido por tela (#133).
- [ ] Hospedar a fonte Inter no próprio app (hoje vem do Google Fonts; 4 pesos).
- [ ] Skeletons no lugar de "Carregando…" nas telas principais.
- [ ] Conferir o relatório de desempenho do Supabase (índices) e a região do banco em relação ao Rio.
- [ ] Medir num celular com rede lenta (Lighthouse) depois do #133; com o Sentry ligado, a velocidade real aparece em Performance.

## Monitoramento (03/11/2026)
- [ ] **Dono:** criar o projeto no Sentry (React) e colar o DSN em `VITE_SENTRY_DSN` no Vercel (Production); depois, um novo deploy liga o monitoramento. Sem isso, nada é enviado.
- [x] **046 aplicada** em 03/11/2026 (execução 41740081652). **Dono:** escolher a categoria da parcela em cada dívida (Dívidas).
- **Atenção a lançamento duplicado:** quem já lançou a parcela à mão como despesa (além da baixa em Dívidas) vai ver a parcela contada duas vezes; excluir o lançamento manual.

## Revisão do painel (03/11/2026)
- [x] Consertos de valor e privacidade (#140).
- [x] "Saldo hoje e previsto" no Início, com o saldo projetado do Calendário (#141).
- [x] Início sem repetição, com previsto e Vencidos no topo (#141).
- [ ] Barra de limite usado nos cartões (precisa do limite total no resumo dos cartões).
- [ ] Subir também "Próximos planejados" (hoje está no fim, com contas e últimos lançamentos).
- [ ] Não bloquear a leitura do painel esperando `atualizarAutomaticos()`; rodar uma vez por sessão.
- [ ] Botão "tentar de novo" no erro do painel, mantendo o cabeçalho e os atalhos.
- [ ] Alvos de toque de 44 px nos links "Ver…" e no Personalizar painel; % com palavra ("aumentou/caiu"), não só cor.
- [ ] "Últimos lançamentos" sem filtro de mês (no dia 1 a lista fica vazia).
- [x] Gráfico de patrimônio e saldo mês a mês em Análises (#144).
- [ ] Aviso diário (vencimentos e saldo previsto), de preferência como notificação no celular — ideia do personal-financial-dashboard.
- [ ] Aviso diário: PR 1 banco (#145, migration 047 aplicada) · PR 2 tela na Família (#146) · PR 3 Edge Function + agendamento + "Enviar teste" (o dono cria a conta no serviço de e-mail e cola a chave nos Secrets).
- [x] Painel de lançamento com menu (D, R, T, C) e Lançamento fixo (#147).
- [x] Lançamento parcelado fora do cartão e recorrência em **dias** (#148, migration 048).
- [ ] Novo lançamento com só Despesa / Receita / Transferência; "Conta/Cartão" num seletor só (grupos Contas e Cartões); receita no cartão = estorno/reembolso/pagamento adiantado (pedido do dono, 04/11).
- [ ] Parcelado: editar ou excluir todas as parcelas de uma vez.

## Auditoria por agentes (04/11/2026)
- [x] Chave do servidor só lê (migration 049) · Orçamentos/Categorias sem conta de dinheiro na tela · faturas de Cartões sem erro preso · Dívidas com todas as parcelas por dívida e aviso de falha · Entradas × Saídas sem números velhos e em cartões no celular · CSV de qualquer período (#149).
- [x] **Relatório de gastos por categoria com gráfico** (#168: barras em Análises, 6 maiores + "Outros", do banco). Falta a **comparação entre meses** por categoria.
- [ ] **Lançamentos filtrado pela categoria via link** (`?categoria=`): a barra de categoria de Análises (#168) leva só a `?mes=&tipo=despesa`, porque Lançamentos ainda não lê a categoria da URL. Quando ler, a barra passa a abrir já na categoria.
- [ ] **Seletor de mês em Análises**: hoje a aba mostra só o mês atual (barras de categoria e o fim do balanço de 6 meses incluídos).
- [ ] **Total por dia no Calendário** (ideia do Livro de contas/Mobills): precisa de função nova no banco com a regra do calendário (movimento da conta; fatura no dia do pagamento), migration à parte.
- [ ] **Modo escuro dos gráficos**: o app não tem tema escuro; quando tiver, escolher e validar os passos escuros das cores dos gráficos (`src/components/graficos/cores.ts`).
- [ ] **Total de todos os cartões juntos** (do banco) (pedido do dono: "precisa ter").
- [ ] **Barra de "% quitado"** em cada dívida (pedido do dono: "precisa ter").
- [ ] Orçamento que se repete todo mês sozinho (o dono pediu explicação).
- [x] **Crédito avulso no cartão com categoria, contando como receita** (migration 052): Cartões → "Crédito / reembolso"; entra na fatura aberta pela data (ou numa posterior escolhida), aparece em verde com "+" e pode ser anulado. Falta aplicar a 052 em produção e o dono conferir no app.
- [ ] Novo lançamento com só 3 abas, "Conta/Cartão" num seletor só e categoria com ícone (a receita no cartão pode chamar `card_credit_income`).
- [x] Crédito avulso do cartão também na lista de **Lançamentos** (linha só de leitura no dia do fechamento, "Crédito no cartão", "Planejado" até fechar). Na exportação completa ele sai como "Crédito no cartão (receita)".
- [x] Decidido pelo dono (04/11): crédito numa fatura aberta é receita **planejada** até fechar; o **limite** volta na data do crédito. Feito na 052, junto com os achados da revisão (fatura até 3 depois, trava pelo fechamento, chave de repetição, arquivar com crédito aberto e a devolução em dinheiro que reaparecia como adiantamento em `card_months`).
- [ ] Cartões: abas de fatura com navegação por setas (`tabpanel`); Dívidas: menu "Mais" para Renomear/Arquivar/Excluir no celular.
- [ ] Orçamentos: `window.confirm` ao remover → confirmação do app; barra como `progressbar`.
- [ ] Testes que faltam: CSV mensal, cartão 50-30-20, Dívidas (`primeiroVencimento`, contrato, amortização extra).
- [x] **Excluir ativo com histórico** (migration 050, #151). Falta aplicar a 050 em produção.
- [ ] **Categoria: excluir e migrar** no lugar de desativar (escolher a categoria destino; lançamentos, recorrentes e orçamentos vão juntos).
- [ ] **Importar o histórico do Organizze** a partir do arquivo exportado (.xls).
