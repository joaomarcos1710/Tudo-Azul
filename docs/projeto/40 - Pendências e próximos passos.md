---
tags: [tudo-azul, pendencias]
atualizado: 2026-11-06
---
# Pendências e próximos passos

## Decisões suas
- [ ] **Produção: lançamentos bloqueados (42501).** Aplicar a 079 (grants de `person_id` e `is_shared_expense`) é urgente. Ela não pode ir sozinha: o workflow aplica as pendentes 020000 a 060000 junto. Decidir o caminho com o dono e aplicar só com "pode" e `APLICAR`.
- [x] Versão **2026.2** (feito).
- [x] Commit na versão: **só na tela Família** (#56).
- [ ] **Relatórios: usar o espaço** que a exportação liberou (#180): abas como no Organizze (Categorias, Contas) — decidir com o dono o que entra primeiro.
- [ ] **Saldo previsto por conta** (fim do mês): saiu do Início na #178. Decidir se volta em Contas (ex.: "previsto fim do mês" abaixo do saldo) ou fica só o total no Calendário.
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
### Cartões no celular (#201, 06/11/2026)
- [x] Página sem rolagem lateral em 360, 390, 820 e 1280px (harness com dados fictícios); valores das compras, do resumo da fatura e dos pagamentos visíveis; créditos e pagamentos recolhidos em 5 + "Ver todos (N)".
- [ ] **Conferir no seu iPhone** (você), com os seus cartões: fileira de meses deslizando dentro do cartão, valores à direita e "Ver todos".
- [ ] **"Pagamentos e devoluções" por fatura**: hoje a lista é do cartão (os 30 mais recentes, `listarMovimentosDoCartao`), por isso fica recolhida. Dá para filtrar pela fatura escolhida usando o `invoice_id` que já chega, mas o adiantamento (sem fatura) e a devolução em dinheiro precisam de lugar próprio; decidir e fazer numa PR à parte (sem migration).
- [ ] **Mais de 30 pagamentos**: atalho — a tela lê só os 30 mais recentes e diz "Mostrando os 30 mais recentes"; os antigos não aparecem nem para anular. Melhorar com paginação ou com o filtro por fatura acima.
- [x] **Abas de fatura**: na #203 a fileira virou links para a página da fatura, que tem as setas ‹ › de mês; a fileira continua rolando de lado no cartão.

### Cartões em três páginas (#203, 06/11/2026)
- [x] Lista, página do cartão e página da fatura, com os blocos Pagamentos → Entradas → Saídas; links do Início, de Lançamentos e do aviso apontando para a página certa; prints em 390, 820 e 1280px sem rolagem lateral (harness com dados fictícios).
- [ ] **Conferir no seu iPhone** (você): abrir um cartão, abrir a fatura, as setas ‹ ›, o voltar do navegador e o "‹ Cartões".
- [ ] **"Pagamentos e devoluções" por fatura** (pendência da #201): agora que a fatura tem o bloco Pagamentos (os ligados a ela), a lista do cartão poderia mostrar só o que não está em fatura (adiantamentos e devoluções). Decidir e fazer numa PR à parte.
- [ ] Atalho: a página da fatura lê `card_months` de novo ao abrir (a fileira do cartão já tinha lido); são páginas diferentes, então não há leitura dupla na mesma tela, mas trocar de fatura pelas setas relê itens, créditos e pagamentos daquela fatura (o esperado). Se ficar lento com muitas faturas, guardar a lista no `Cartoes` pai.
- [ ] Os prints do Início e de Lançamentos não foram refeitos nesta PR (só os links mudaram); conferir "Ver fatura" e "Ver em Cartões" no app.
### Categoria do crédito de cartão (#202, migration 077, 06/11/2026)
- [x] RPC `card_credit_set_category` (lote, tudo ou nada) + brecha no guard só para `category_id` de `income_credit` com a marca de sessão; "Trocar categoria" no ⋯ do crédito em Cartões (também em fatura paga).
- [ ] **Aplicar a migration 077 em produção** pelo workflow (simular → ler o log → aplicar), com o "pode" do dono.
- [ ] **Mover os 31 créditos "IOF"** de "Outras receitas" para "Estorno de IOF": pela tela, um a um (31 cliques), ou numa chamada só da RPC com os 31 ids (a tela ainda não tem seleção em lote de créditos; fazer se o dono quiser).
- [ ] Depois de mover, conferir no Início que a Taxa de poupança e o Comprometimento (último mês fechado) deixaram de contar esses créditos (categoria "não conta como consumo").
### Segurança dos GitHub Actions (#195, 06/11/2026)
- [x] Segredos de produção só nos passos que usam (workflow de migrations), checkout com `persist-credentials: false`, actions por SHA com a tag no comentário, `setup-cli@v1` (branch) + `latest` trocados por v3.2.0 + CLI 2.122.1 nos testes do banco, Dependabot semanal para as actions.
- [ ] **Rodar "simular" no workflow de produção depois do merge** (com o "pode" do dono): é a única prova real de que os segredos chegam aos passos certos e de que a setup-cli fixada por SHA funciona ali (o CI do PR não roda esse workflow).
- [ ] **Ligar Dependabot alerts / security updates** em Settings → Code security, se ainda não estiverem (o `dependabot.yml` só cobre as versões das actions).
- [ ] **Subir a CLI do Supabase para a 3.x** (testes e produção juntos), numa PR própria: conferir antes as mudanças de padrão de alvo da 3.0.0; enquanto isso, a 2.122.1 é a `v2.stable`.
- [ ] `concurrency` no `ci.yml` (sugestão do zizmor no modo pedante): PR com vários pushes roda o CI inteiro de cada um. Baixa prioridade.
### Falhas de Análises e Início (#193, 06/11/2026)
- [x] **`net_worth_with_assets` com HTTP 500 em rajada** (auditoria de falhas, logs de 05–06/11: 65 de 125 chamadas): a evolução de 12 meses agora vai em fila (máx. 2 por vez), depois das outras consultas; mês que falha fica de fora com aviso; falha de consulta opcional vai ao Sentry (nome da consulta e código do erro).
- [ ] **RPC `net_worth_series`** (migration nova): os 12 pontos da evolução numa chamada só, calculados no banco; tira o atalho de uma chamada por mês (`evolucaoPatrimonio`, `src/lib/painel.ts`).
- [ ] **Escalonar as cargas do Início**: o `Promise.all` do Início ainda dispara ~13 consultas juntas (e Análises ~25); separar o essencial do resto, como na evolução, se os logs mostrarem 500 de novo.
- [ ] **Início: trocar `card_months` por cartão por `card_overview`** em `resumoDosCartoes` (bloco Cartões): uma chamada por família em vez de uma por cartão (mesmos números).
- [ ] **Sentry**: depois do deploy, conferir no painel os eventos "Consulta opcional falhou" (agrupados por consulta e código). Só funciona com `VITE_SENTRY_DSN` configurado.
### Auditoria de dinheiro (#191, migration 073, 06/11/2026)
- [x] **C1 (crítico) Saldo de Entradas x Saídas** não contava o crédito de empréstimo na conta nem o saldo inicial de conta aberta no período (ex.: terminava setembro em 0,00 em vez de 7.000): `cash_flow_series` soma essas variações só no Saldo (migration 073). Entradas, saídas e resultado não mudam.
- [x] **I1 Recorrente em conta arquivada** contava no resumo dos recorrentes e na renda regular esperada do Início (073).
- [x] **I2 "Resultado do mês — Até hoje"** contava o pago com data futura (073).
- [x] **M1 Orçamento exatamente no limite**: "Chegou ao limite." em vez de "sobram R$ 0,00"; a barra do Início usa as faixas de `faixaOrcamento` (sem migration).
- [x] **Aplicar a migration 073** em produção: aplicada em 06/11/2026 (execução 42198308981, merge `5e3c8ce`). Entrou antes do "este e os próximos" (que passa a ser a 074). Antes, conferir numa transação desfeita: Entradas x Saídas de um período com crédito de empréstimo ou conta nova, o Saldo da última linha contra o Calendário no último dia.
- [ ] **Desempenho da 073 em produção**: `cash_flow_series` ganhou duas leituras pequenas (créditos de empréstimo do período e contas da família); não foi medida no volume de teste nesta PR. Medir no mês de novembro em produção (limite de 8 s).
- [ ] **Decisão do dono — crédito de empréstimo**: entra como **entrada** no Relatório › Contas (é extrato) mas **não** em Entradas x Saídas (decisão de 03/11: não é receita). Agora o Saldo das duas telas bate; as colunas Entradas diferem por esse valor. Manter assim ou mostrar uma linha "Movimentos que não são entrada/saída" em Entradas x Saídas?
- [x] **Decisão do dono — patrimônio com investimentos em dobro**: decidido em 06/11/2026 — o Patrimônio total do Início passa a ser o de Análises (`net_worth_with_assets`), sem somar a carteira (migration 075, #196).
- [x] **Decisão do dono — "Disponível"**: decidido em 06/11/2026 — o Disponível fica só com corrente, poupança/reserva, corretora (saldo a aplicar) e dinheiro; Renda fixa, Renda variável e Cripto saem dele e continuam no Patrimônio (migration 076, #200).
- [ ] **Decisão do dono — Relatório › Contas sem as contas arquivadas**: só contas ativas aparecem, então o total do relatório não fecha com o saldo total (que inclui as arquivadas com saldo). Mostrar as arquivadas com saldo ou movimento no período?
- [ ] **Desempenho de `account_flow_report`**: chama `account_movements` uma vez por conta (`cross join lateral`); com muitas contas e anos de histórico pode passar do limite de 8 s. Medir e, se preciso, ler os movimentos numa passada só.
- [ ] **Legado**: compra parcelada em dívida que não é cartão (`charge`/`credit` sem conta) entra no resultado de Entradas x Saídas sem mexer no saldo; desde a migration 008 parcelas só existem em cartão, então não deve haver nenhuma. Conferir em produção (`select count(*) from debt_events e join debts d on d.id = e.debt_id where d.kind <> 'card' and e.kind in ('charge','credit')`).

### Disponível só com o dinheiro de uso no mesmo dia (#200, migration 076)
- [x] `home_indicators.available` = contas ativas em reais dos tipos checking, savings, cash e brokerage − faturas fechadas; renda fixa, renda variável e cripto fora do Disponível e dentro do Patrimônio (#200).
- [ ] **Aplicar a migration 076** em produção (simular → ler o log → aplicar, com o "pode" do dono), junto da publicação do front: antes dela, o (i) novo diz que renda fixa/variável/cripto ficam fora, mas o número do banco ainda as soma.
- [ ] Conferir em produção (transação desfeita) que `available` caiu exatamente pelo saldo ativo das contas de renda fixa, renda variável e cripto em reais (`balance_totals_by_type`), e que `net_worth` não mudou.

### Um patrimônio só (#196, migration 075)
- [x] Patrimônio total do Início = `net_worth_with_assets` (Análises), sem somar a carteira de Investimentos; `investments` continua no retorno e o (i) diz que a carteira fica à parte (#196).
- [x] Apagar a tabela `public."Teste1"` criada à mão no painel (migration 075, `drop table if exists`).
- [x] **Aplicar a migration 075** em produção: aplicada em 06/11/2026 (execução 42213092166, merge `46802ec`).
- [ ] Conferir em produção (transação desfeita) que `home_indicators(...).net_worth = net_worth_with_assets(...).net_worth` para a família.
- [ ] **Quem tinha só a carteira** (ativo em Investimentos sem a conta de renda fixa/variável/cripto correspondente) vê o Patrimônio total cair pelo valor da carteira. Se for o caso, cadastrar a conta ou esperar a ligação conta ↔ ativo.

### Faixa de indicadores do Início (#188, migration 071)
- [ ] **Aplicar a migration 071** em produção (simular → ler o log → aplicar, com o "pode" do dono), depois da 070. Antes, conferir os números em produção numa transação desfeita (`begin; select * from public.home_indicators(<família>, current_date); rollback;`).
- [x] **Investimento contado duas vezes**: resolvido escolhendo uma fonte — o patrimônio conta as contas; a carteira aparece à parte (migration 075, #196). A ligação conta ↔ ativo (item da #186) continua pendente.
- [x] **Comprometimento e taxa de poupança no começo do mês** enganavam (73,7% e 71,6% em produção): passaram para o último mês fechado; o comprometimento usa a renda esperada (recorrentes) ou a recebida, a maior.
- [x] **Reserva 0,0** com a média inflada por empréstimo, quitação e repasses: agora é a mediana, sem as categorias "não conta como consumo".
- [x] **Marcar as categorias que não são consumo** (06/11/2026, a pedido do dono, depois da 071 aplicada): receita de empréstimo, os repasses de família (receita e despesa, subcategoria por subcategoria) e a subcategoria nova "Quitação de empréstimo" (em Financiamento e Empréstimos), para onde foram as liquidações de empréstimo. Quitações de anos anteriores ficaram onde estavam (fora da janela de 6 meses).
- [ ] **Aplicar a marcação também nos relatórios** (próximo passo): `period_summary`, Relatórios, Análises, orçamento e o Resultado do mês ainda contam as categorias "não conta como consumo". Decidir com o dono onde ela vale (ex.: Entradas x Saídas é caixa e talvez deva continuar contando).
- [ ] **Renda esperada só com recorrentes ativas**: recorrente encerrada é apagada (`recurrence_end`), então um mês fechado antigo perde a esperada; por isso vale a maior entre esperada e recebida.
- [ ] **Empréstimo sem contrato** (sem agenda de parcelas) não entra no comprometimento; só os com contrato cadastrado.
- [ ] **Previdência e FGTS** não existem no app (o (i) do patrimônio avisa).
- [ ] **Preferência antiga dos widgets** (`tudo-azul:dashboard-widgets:<usuário>`) fica sem uso no aparelho; inofensiva.
- [x] Personalização dos widgets do Início saiu (substituída pela faixa fixa de 7).
- [x] "Saldo hoje e previsto": o previsto do fim do mês ficou numa linha de Minhas contas.
### Recorrente: "Apenas este / Este e os próximos" (#194, migration 074)
- [x] Pergunta ao salvar a edição de um lançamento de recorrente que mudou valor, data, descrição ou categoria (Lançamentos, no celular e na tabela); "Este e os próximos" pela `recurrence_update_from` (#194).
- [x] **Aplicar a migration 074** em produção: aplicada em 06/11/2026 (execução 42203309171, merge `67fa25a`).
- [ ] Conferir no iPad/celular: editar a conta de luz de um mês (dia e valor), escolher "Este e os próximos" e ver os meses seguintes no Calendário e em Recorrentes; um mês já pago e um corrigido à mão ficam como estavam.
- [ ] **Marcar pago não pergunta** (decisão em [[30 - Decisões]]): confirmar com o dono.
- [ ] Assinatura de cartão: "este e os próximos" não existe (ocorrência é parcela da fatura). Se fizer falta, a edição em Recorrentes já muda valor/descrição/categoria; o dia continua sem mudar.
- [x] Situação, observação e conta dentro da RPC: "Este e os próximos" é uma chamada só, tudo ou nada (revisão de dinheiro, #194).
- [x] Revisão de dinheiro (#194): ocorrência antes do começo atual da série é recusada (evita ocorrências em dobro e datas mudadas sem pedido); nova data só entre a anterior e a seguinte e, no mensal, no mês da ocorrência; família conferida antes de qualquer outra recusa; recorrente encerrado, categoria desativada nova e despesa/receita sem categoria recusados.
- [ ] Depois de um "este e os próximos" com data nova, as ocorrências **anteriores** a ela não aceitam mais "este e os próximos" (só "Apenas este"). Se fizer falta mudar o valor de toda a série de uma vez, a edição em Recorrentes (`recurrence_update`) continua valendo para os planejados de hoje em diante.
- [ ] Mudar a **frequência** de um recorrente continua sendo excluir e cadastrar outro.
- [x] ~~Folha trata o Esc na captura~~: substituído no merge com a #192 pela pilha de diálogos de `useFocoPreso` (o Esc fecha só o de cima); o teste "Cancelar e Esc não gravam nada" confere que o Esc na pergunta fecha só ela e o formulário continua aberto (#194).
- [x] **B1 (revisão do #194)** renda regular **esperada** do mês fechado (Início) caía a 0 ou mudava de valor depois de um "este e os próximos" (lia a regra viva, que é reancorada): agora sai das ocorrências daquele mês (lançamentos gerados + as ainda não geradas), migration 074.
- [x] **I1 (revisão do #194)** `recurrence_end` deixava planejados vivos quando o começo da regra tinha ido para o futuro (`greatest(p_end, start_date)`): agora todo planejado depois da data pedida vai para a lixeira, migration 074.
- [ ] **Esperada passou a usar o valor do lançamento** (B1): mês pago a menor e corrigido à mão (ex.: salário de 5.000 pago 4.800) agora espera 4.800, não 5.000; ocorrência na lixeira não conta mais. Afeta só o comprometimento com dívidas (`greatest(esperada, recebida)`). Confirmar com o dono.
- [ ] **Recorrentes (tela) segue campo a campo, "este e os próximos" é tudo ou nada por ocorrência** (M1): uma ocorrência com só a descrição corrigida não recebe o valor novo aqui, mas recebe pela edição em Recorrentes. Atalho conhecido; uniformizar se o dono estranhar.

### Etiquetas nas contas (#189, migration 072)
- [x] Etiquetas livres por família: criar, renomear, apagar, marcar até 10 por conta; selos, filtro e seção "Etiquetas" em Contas; coluna na exportação completa (#189).
- [x] **Contas arquivadas escondidas por padrão** em Contas, atrás do botão "Arquivadas (N)" (pedido do dono, #189). A escolha não é lembrada entre visitas (sempre fechada ao abrir a tela).
- [ ] Arquivadas escondidas em outras telas (ex.: Dívidas/Cartões ainda mostram a seção "Arquivadas" sempre): avaliar com o dono se segue o mesmo padrão.
- [ ] **Aplicar a migration 072** em produção (simular → ler o log → aplicar, com o "pode" do dono). Não depende da 070 nem da 071 (só cria tabelas e funções novas), mas segue a ordem dos arquivos.
- [ ] **Filtrar relatórios por etiqueta** (Relatórios › Contas e Entradas x Saídas, Início): exige função no banco que receba a etiqueta (o front não soma). Nesta PR a etiqueta não entra em nenhum cálculo.
- [ ] **Cor na etiqueta** (se o dono quiser): hoje selo neutro; categorias já têm o padrão `#RRGGBB` + `CORES`.
- [ ] **Limites por contagem sem trava** (trigger da 072): duas inserções simultâneas podem passar 1 do limite de 50/10 (comentário `atalho:` na migration). Melhorar com lock só se aparecer abuso.
- [ ] Etiquetas fora da tela Contas (seletor de conta em Lançamentos, Início › Minhas contas): não pedido; avaliar com o dono.

### Tipos de conta (#186, migration 070)
- [x] **Aplicar a migration 070** em produção (aplicada em 05/11/2026, execução 42136165202) (simular → ler o log → aplicar, com o "pode" do dono). Depois da 069 (saldo projetado, outra PR).
- [ ] **Ajustar conta por conta** pelo app (Contas › Editar › Tipo): as que eram Investimento viraram Renda fixa e as Outra viraram Conta corrente; conferir cada uma (ex.: a conta da corretora que não rende → Corretora (saldo a aplicar)).
- [ ] **Vincular a corretora aos ativos de Investimentos** (custódia): a conta `brokerage` como a corretora dos ativos — ainda não existe ligação entre conta e ativo.
- [ ] **Início (Minhas contas)** não agrupa por tipo (é a lista de saldos de hoje); só ganhou os ícones por tipo, sem mexer em `VisaoGeral.tsx`. Se o dono quiser os tipos no Início (ex.: subtotal por tipo), é outra PR.
- [ ] **Patrimônio por tipo** (corrente × reserva × investido) em Análises: hoje só a tela Contas mostra o subtotal por tipo.
- [x] Formulário e lista de Contas com os 7 tipos; ícone por tipo; `balance_totals_by_type` na ordem nova (#186).

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
- [x] **Saldo em uma chamada só** (#179, migration 066): `cash_flow_series` devolve valores e saldo de cada linha numa chamada.

### Relatórios: período escolhido e regime de caixa (#179, migration 066)
- [x] **Só o período escolhido** (seletor com setas e atalhos, "Escolher período", anos), divisões Diário · Semanal · Mensal · Acumulado com as que não cabem apagadas.
- [x] **Fatura do cartão no pagamento** (paga) **ou no vencimento** (a pagar), nunca no fechamento, só em Entradas x Saídas.
- [x] **Azul para entrada/positivo, vermelho para saída/negativo, cinza para zero**; saldo como área ao fundo do gráfico.
- [ ] **Aplicar a migration 066** (você dá o "pode"): até lá, a tela de Relatórios mostra o aviso de erro no lugar do relatório (não há caminho antigo de reserva, porque o antigo era por competência).
- [ ] **Conferir com o Organizze** (você): um mês com fatura paga (ex.: 28/11 com a saída da fatura) e um com fatura em aberto, com "Pagos e não pagos".
- [x] **Decidir as cores no resto do app**: decidido pelo dono e feito na #183 (receitas azul em todo o app; despesa do Balanço vermelha).
- [ ] **Exportar a tabela de Entradas x Saídas** (CSV com as linhas e o saldo, do banco): hoje só o CSV de lançamentos acompanha o período.
- [ ] **Explicação com (i)** existe em três telas (Lançamentos, Recorrentes, Relatórios): unificar num `ui/` quando houver a quarta.
- [ ] **Unificar painéis**: `PainelLancamento` (Lançamentos) passar a usar `ui/Folha` (que prende o foco e devolve ao botão). O de **Marcar pago** já usa (#176); falta o do formulário.
- [ ] **Eixo do gráfico de linha com negativo** usa hífen ("R$ -20 mil", `brlCompacto`); trocar pelo "−" tipográfico em todos os gráficos.

### Relatórios › Contas e previstos (#184, migration 068)
- [x] **Aba Contas** (saldo inicial, entradas, saídas, saldo final por conta ativa em reais; total sem as transferências; aviso de outra moeda) e **abas** com um período só.
- [x] **Assinaturas de cartão previstas** no vencimento e **lançamentos fixos ainda não gerados** em Entradas x Saídas (e Contas) com "não pagos"; o saldo anda junto.
- [x] **Aplicar a migration 068** (aplicada em 05/11/2026, execução 42124746064).
- [ ] **Conferir com o Organizze** (você): novembro com "Pagos e não pagos" deve dar a diferença de R$ 1.120,69 a mais de saída em 28/11; e a aba Contas contra Relatório › Contas.
- [x] **Saldo previsto do Calendário/Contas/aviso diário** passa a contar as assinaturas previstas e os fixos não gerados (#185, migration 069; ver a seção abaixo).
- [ ] **atalho**: as condições de conta dos fixos previstos (`private.account_recurrence_pending`) repetem as de `recurrence_materialize`; quando a geração mudar, fazê-la chamar a função.
- [ ] **Filtros e divisão de Entradas x Saídas voltam ao padrão** ao trocar de aba (só o período é compartilhado). Guardar na página se o dono quiser.
- [ ] **Próximas abas** do Organizze (ex.: Categorias).

### Previsto alinhado com os Relatórios (#185, migration 069)
- [x] **Calendário, "Saldo hoje e previsto" do Início e aviso diário** com as assinaturas de cartão previstas e os lançamentos fixos ainda não gerados (`balance_totals_projected` e `account_balances_projected`); o previsto no fim do período = saldo final de Entradas x Saídas (total) e do Relatório › Contas (por conta). Relatórios com os mesmos números.
- [ ] **Aplicar a migration 069** (você dá o "pode"; depende da 068): simular → ler o log → aplicar. Antes, a conferência em produção numa transação desfeita: novembro com não pagos, o Calendário em 30/11 deve dar o mesmo saldo final dos Relatórios (−R$ 261,74, se nada mudou), e os Relatórios os mesmos números de antes.
- [ ] **Conferir no app** (você): Calendário em 30/11 com "Efetuados + planejados" e o "Previsto em 30/11" do Início, contra Relatórios › Entradas x Saídas de novembro com "Pagos e não pagos".
- [ ] **Desempenho em produção**: no volume de teste, o saldo previsto com planejados ficou ~0,1 s mais lento (mediana 0,61 → 0,71 s em 30/11; 0,57 → 0,83 s em 31/12/2027); os Relatórios ficaram mais rápidos. Medir na simulação; se apertar, `balance_totals_projected` pode ler as assinaturas uma vez só (hoje lê em `account_balances_projected` e de novo para o total).
- [ ] **Conta em outra moeda**: o fixo previsto dela não entra no previsto por conta (como nos Relatórios, só reais). Decidir junto da multimoeda F3/F4.
- [ ] **Só efetuados lê as faturas à toa**: `account_balances_projected` calcula `card_months` por cartão mesmo sem planejados (vem de antes, ~0,15 s no volume de teste). Melhorar numa migration de desempenho, se precisar.
- [ ] **Avisos do Início (`home_alerts`)**: a fatura dos próximos 7 dias mostra o que já está na fatura; assinatura prevista que ainda não virou compra e vence nesses 7 dias (fatura que fecha depois de hoje) não entra. Raro (fecha 7 dias ou menos antes do vencimento); decidir se entra.

### Fatura paga travada (#174, migration 064)
- [x] **Botão "Pagar fatura" diz qual fatura** (destaque) e a aba de fatura paga não tem ação de pagar nem de mudar; mostra "Paga em dd/mm" e "Fatura paga — travada".
- [x] **Detalhes da fatura** (referência do Organizze): cabeçalho com situação, "Fechou/Fecha em" e "Venceu/Vence em"; resumo Saldo anterior, Gasto do mês e Valor pago (do banco); lista "Pagamento recebido em dd/mm/aaaa"; lado a lado a partir de 768px, empilhados no celular.
- [x] **Aplicar a migration 064** em produção: merge `af82940`, **aplicada em 05/11/2026** (execução 41955144022, simulação 41955082904).
- [ ] **Estorno de compra de fatura já paga**: hoje só vira crédito avulso (receita) na fatura atual; o estorno da compra (abatendo a despesa da categoria) não é aceito porque `card_months` conta o estorno no mês da parcela, que está travado. Melhorar: estorno "na fatura atual" contado no mês da fatura onde entra (decisão do dono; mexe em `card_months`).
- [ ] **Pagamento errado descoberto depois de 24 h** (ou com pagamento posterior): sem caminho na tela; hoje só correção manual. Decidir com o dono (ex.: ajuste com motivo).
- [ ] **Compra lançada com deslocamento para uma fatura passada já paga** (Nova compra → Fatura −1…−3): o banco aceita e a fatura volta a "Fechada"; decidir se recusa também.
- [ ] **Saldo de referência e troca de dias** (`card_set_start`, `set_card_cycle`): não passam pela trava; conferir se podem mudar o pago de fatura antiga.
- [ ] **"Anular" de pagamento sem fatura (adiantamento)** continua na tela; se ele quitou uma fatura travada, o banco recusa com a mensagem (a tela não sabe qual fatura ele quitou).
- [ ] **Screenshot da fatura paga em 820px**: não feito nesta PR (o app precisa de login; sem harness de tela com dados de teste).

### Visual de Cartões (#181)
- [x] Cadeado por situação no resumo (aberta, fechada, paga, vencida), nome inteiro, mês dentro do bloco ("‹ Novembro de 2026 ›"), "Ver fatura" no cartão e no resumo, "Pagar fatura" dentro da fatura não paga.
- [ ] **Conferir no iPad em retrato** (você), com os seus cartões: cadeados, nome inteiro e o "Ver fatura" rolando até a fatura.
- [ ] **Abas da fatura ainda com selo de texto** (Aberta/Fechada/Vencida/Paga): decidir se ganham o cadeado também.
- [x] **Lista de compras da fatura entre 640 e 1024px**: feito na #183 (grade com valor em coluna própria, ações no ⋯, resumo empilha sem quebrar valor).
- [ ] **Sem "Pagar fatura" se a leitura das faturas falhar** (#181): antes o botão do cartão abria o pagamento mesmo assim (com dívida, o formulário já bloqueava). Avaliar se vale um caminho de pagar adiantado nesse caso.

### Cores do app (#183)
- [ ] **Favicon com hex fixo** (#211): `public/favicon.svg` repete o marinho e o celeste de `MARCA` (`src/lib/cores.ts`). Se a marca mudar, mudar nos dois lugares.
- [ ] **Paleta proposta por terceiros** (marinho `#0A1F44`, azul `#1E5EFF`, vermelho `#C1121F`, verde `#0B7A55`): não aplicada. Decidir com o dono se mantém a #183 ou troca tons; se trocar, passar pelo `cores.test.ts` e registrar no doc 30.
- [x] Tokens `lucro`, `prejuizo`, `atencao`, `agendado`, `neutro`, `transferencia` em `src/lib/cores.ts`, aplicados nas telas e nos gráficos; contraste medido em teste; laranja do Balanço → vermelho.
- [ ] **Conferir no aparelho** (você): o verde de "Planejado" lido como "agendado" e não como "entrou" (o oposto do Organizze). Se confundir, trocar só o tom de `agendado` em `src/lib/cores.ts`.
- [ ] **Relatórios ainda usam os nomes antigos** (`text-azul`, `text-negativo`, hex do gráfico pelos nomes `COR_RECEITA`/`COR_SAIDA`): mesmos tons, ficaram de fora porque outra PR mexia lá; trocar por `text-lucro`/`text-prejuizo`/`corDoValor` quando ela entrar.
- [ ] **"Próximos planejados" do Início** mostra o valor com a cor do tipo e sem selo "Planejado" (o título do card já diz); avaliar o selo verde por linha.
- [ ] **Fundo âmbar dos avisos** (`#FFFBEB`) é bem claro: o ícone passa no contraste, mas o círculo quase não aparece. Avaliar `#FEF3C7` (o texto âmbar sobre ele fica em 4,51:1, no limite).
- [ ] **Saldo/resultado positivo agora azul** em Contas, Início e Calendário (antes sem cor): conferir se não pesou visualmente.
- [ ] **Cabeçalho do Início no 820px**: "Receita mensal R$ 12.150,00" quebra o valor em duas linhas (já era assim antes; visto no screenshot da #183). Arrumar com `whitespace-nowrap` numa PR própria.
- [ ] **Screenshots sem o menu lateral**: os da #183 vieram do HTML dos testes com o CSS do app (o app precisa de login); com o menu lateral do md, a área útil em 820px é menor. Conferir no iPad.

### Resumo dos cartões (#175, migration 065)
- [x] **`card_overview`** (migration 065): uma chamada por família com fatura do mês, atual, fechada a pagar, limite, assinaturas previstas e os totais. Teste `65_card_overview` (31).
- [x] **Resumo de todos os cartões** no topo de Cartões: carrossel de mês, "Faturas de <mês>" (total do banco e a fatura de cada cartão), limite total, disponível total e barra do usado com texto.
- [ ] **Aplicar a migration 065** em produção (workflow; simular → ler o log → `APLICAR`), com o "pode" do dono.
- [ ] **Atalho: caminho antigo sem a 065** (`Cartoes.tsx`, `carregar`): com o banco sem `card_overview` (ou se ela falhar), a tela lê `card_months` por cartão e `card_invoices_month`. Remover depois que a 065 estiver aplicada.
- [ ] **Início ainda é N+1**: `resumoDosCartoes` (bloco Cartões do Início) chama `card_months` por cartão; passar a usar `card_overview` (mesmos números) numa PR própria.
- [ ] **Dois "meses" de fatura no app**: Cartões agrupa pelo mês do fechamento (como as abas); o Início ("Faturas que vencem em") e Lançamentos pelo do vencimento. Decidir com o dono se unifica.
- [x] **"Cartão Cartão Roxo"** no "Próxima fatura vence em": desde a #181 não repete "Cartão" quando o nome já começa com ele.
- [ ] **Conferir no celular e no iPad** (você): resumo no topo, carrossel e a linha das assinaturas previstas com os seus cartões.

### Achados da análise da aba Cartões (05/11/2026), ainda abertos
- [x] **Assinaturas previstas na fatura atual**: desde a #175 o destaque mostra "Prevista até o fechamento: R$ Y — inclui R$ X de assinaturas previstas" (`card_overview`). O valor grande continua o da fatura real (sem as previstas), de propósito.
- [ ] **Pagamento com data futura**: "Pagar fatura" aceita data futura; decidir se bloqueia, avisa ou agenda como planejado.
- [ ] **`card_items` líquido de estorno/cancelamento**: a linha da compra mostra o valor de face; estorno ou cancelamento parcial não aparece descontado nela.
- [x] **Painel abrir junto do cartão no celular** (#166): o painel abre dentro do cartão clicado, com foco no título; ao fechar, o foco volta ao botão (ou ao "⋯").
- [x] **Abas de fatura começarem na atual** (#166): abrem na fatura do ciclo de hoje, roladas até ela; mostram as 6 anteriores e as próximas ("Ver mais antigas" mostra o resto; fechada não paga nunca fica escondida); setas, Home e End.
- [x] **Total das faturas do mês no topo de Cartões** (#166): resumo com "Faturas que vencem em <mês>" (`card_invoices_month`, o mesmo componente do Início) e "Próxima fatura vence em <data>"; no computador, ao lado dos cartões em 2 colunas.
- [x] **Selo "Vencida"** (#166): no destaque (com o vencimento da mais antiga, "venceu dd/mm") e nas abas; mesma regra do Início.
- [x] **Renomear "Parcelas futuras"** (#166): "A cobrar (atual + futuras)", com a dica embaixo.
- [x] **Estorno parcial na linha da compra** (#166): botão "Estornar" (valor até o da parcela e data; `debt_refund`). Falta você: estornar uma compra de teste e conferir a fatura e o resultado do mês. Ver também o item do `card_items` líquido acima: a linha continua mostrando o valor de face até a migration 058.
- [x] **#166: limite disponível total e valor total no resumo de Cartões** (referência do Mobills): feito na #175 com `card_overview` (migration 065), somas do banco.
- [x] **#166: seletor de mês no resumo de Cartões** (feito na #175: carrossel "‹ Novembro de 2026 ›", mês da fatura) (referência do Mobills, "NOVEMBRO ▾").
- [ ] **#166: estorno sem chave de repetição**: `debt_refund` não tem `p_idem`; o botão fica travado enquanto envia, mas rede ruim com nova tentativa pode gravar duas vezes. O banco também não confere se a soma dos estornos passa do valor da parcela (a tela só limita cada estorno ao valor da parcela). Corrigir numa migration (idempotência e teto), se o dono quiser.
- [ ] **#166: os painéis de Editar/Excluir/Reabrir na fatura** continuam no topo da fatura escolhida (só o de Estornar abre na linha); levar para a linha se incomodar no celular.
- [x] **Desempenho**: uma chamada `card_overview` por família em vez de `card_months` por cartão ao abrir a tela (#175, migration 065). As abas de fatura ainda leem `card_months` do cartão ao abrir (de propósito).
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
- [x] **Mudar o dia** de um recorrente em conta: em Lançamentos, editar a ocorrência e escolher "Este e os próximos" (#194, migration 074).
- [x] **Recorrentes agrupados por frequência e totais por mês no cartão/na conta** (#173): migration 063 (`recurrence_summary`) **não aplicada** — aplicar pelo workflow (simular → log → `APLICAR`) com o seu "pode" **antes** de publicar o front (sem ela a tela Recorrentes mostra erro ao carregar).
- [ ] Conferir no iPad/celular: os cartões do topo, as abas Conta/Cartão e os totais de cada grupo com os seus recorrentes reais.
- [ ] Recorrentes em outra moeda ficam fora dos totais (só um aviso com a quantidade). Se quiser, um total por moeda depois.
- [x] **Recorrentes em cards por tipo** (#187, 06/11/2026): Assinaturas no cartão, Contas fixas, Receitas e Transferências, cada um com o total do banco (`medium`) no título e o total por frequência do tipo (`frequency`). Sem migration (usa a 063).
- [ ] Conferir no iPad/celular os cards por tipo com os seus recorrentes reais (espaçamento, títulos longos, total ao lado do título).
- [ ] Nos cards por tipo, a **contagem** do título inclui os recorrentes em outra moeda (estão na lista), mas o **total** do banco não (só reais); o aviso do topo já diz quantos ficam fora. Se confundir, mostrar "N (M em reais)" com o `qtde` do banco.
- [ ] O nível `frequency_all` de `recurrence_summary` deixou de ser usado pela tela (#187); continua no banco e no teste 63. Remover numa migration nova só se ninguém mais usar.
- [x] **Orçamento com cor por faixa** (#190, 06/11/2026): 50% azul claro, 70% amarelo, 90% vermelho claro, 100% vermelho, com o percentual ao lado.
- [ ] A faixa usa só o **gasto pago**; parcelas de cartão já previstas não pintam a barra (a projeção avisa no texto). Decidir com o dono se a barra deve considerar o projetado.
- [ ] O equivalente mensal de cada item (≈ R$ x/mês) não aparece na linha do item, só nos totais; dá para trazer do banco (nível `detail` por regra) se fizer falta.

## Auditoria de design e acessibilidade (#192, 06/11/2026)
- [x] Foco do painel de lançamento, menu "+ Lançamento" no celular, rolagem lateral da tabela a 1280px, selos cortados, vencido verde na lista e no Calendário, "próxima" cortada em Recorrentes, verde sem rótulo em Cartões, 4 achados sérios do axe, alvos de toque de 44px, Excluir/Remover em vermelho, subtotal de Contas sem cor, seletor de tipo em 2 linhas a 390px.
- [ ] **"R$" quebrando linha**: usar espaço não separável entre "R$" e o número (ou `whitespace-nowrap` nos valores) em todo o app; ficou para depois, numa PR própria.
- [ ] **Decisões de design (para o dono)**: faixa de 7 indicadores do Início (densa no celular); Categorias muito longa no celular; eixo do gráfico de Relatórios; Calendário no computador (grade pequena para a largura); faixas de cor na barra de limite do cartão (como no orçamento?); tokens soltos `blue-100`/`blue-700` (botão primário e dica do menu) ainda fora de `src/lib/cores.ts`.
- [ ] **Foco inicial do painel de editar** vai para o primeiro controle do formulário (a aba "Despesa"), não para a aba marcada; avaliar focar a aba do tipo do lançamento.
- [x] **Conflito previsto com a branch do recorrente "este e os próximos"** (Esc em captura na Folha; resolvido no merge do #194, ficou a versão do main): a lógica da Folha foi para `useFocoPreso`; ao juntar, não reaplicar o `addEventListener(..., true)` — a pilha de diálogos já faz o Esc fechar só a pergunta do recorrente.
- [ ] **Dica "tecla D/R/T/C"** some abaixo de 640px e com `pointer: coarse`; num iPad com teclado físico ela continua escondida se o navegador disser "coarse".

## Menu e formulário de lançamento
- [x] **Projeção errada depois de excluir recorrente** (#86, mesclado em 29/10; **migration 019 aplicada em produção em 29/10/2026**). Já pode excluir recorrente com lançamento pago no mês corrente.
- [ ] **Excluir recorrente + versão 2026.5** (#84, mesclado em 29/10; **migration 018 aplicada em produção em 29/10/2026**). Falta você: excluir o recorrente já finalizado em Recorrentes → Encerrados, conferir que os lançamentos pagos dele continuam, e testar a 2026.5 no iPhone.
- [ ] **Banco gravado e bandeira do cartão** (#80, mesclado em 29/10; **migration 017 aplicada em produção em 29/10/2026**). Falta você: escolher o banco das contas (Contas → Editar) e o emissor/bandeira dos cartões (Cartões → "Escolher banco e bandeira") e conferir os logos no iPhone. Next, Original e Will seguem com a sigla (sem logo).
- [ ] **Logos de banco** (#79, mesclado em 29/10; +Nomad, OKX, Binance e Funcef na #177, dos sites oficiais): 20 logos importados de `rzmt/logos-bancos-br` (origem em `src/assets/bancos/ORIGEM.md`); Next, Original e Will continuam com a sigla. Conferir no celular. Banco novo: subir o arquivo com o nome da chave (`LEIAME.md` da pasta).
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


## Gestão de pessoas da família (PR #205)

- [x] **Fase 1 na PR #205:** cadastro isolado de pessoas e pets em `household_people`, RLS por família, edição e inativação sem hard delete.
- [ ] **Fase 2:** classificar despesas de conta, compras/parcelas de cartão e recorrências. Distinguir `person`, `shared` ("Toda a família") e `unassigned` (ainda sem classificação). Preservar triggers de imutabilidade e os cálculos financeiros.
- [ ] **Fase 3:** filtros por pessoa e agregação mensal por pessoa/escopo, sem contar pagamento de fatura como uma segunda despesa.
- [ ] Upload privado de foto com política de Storage por família; nesta primeira tela a foto pode ser informada por URL HTTPS e o avatar usa iniciais por padrão.


## Minha Carteira — evolução faseada (PR em desenvolvimento)
- [x] **Fase 1:** título Minha Carteira, chips horizontais com âncoras locais, rolagem suave acessível e integração com a privacidade global existente. Pontos de entrada para investimentos e dívidas sem valores simulados.
- [ ] **Fase 2:** consolidar Patrimônio Total, Saldo Disponível e Patrimônio Líquido usando as RPCs atuais; resumo de contas agrupado por instituição e moeda, sem somas no navegador.
- [ ] **Fase 3:** cartões com limite, utilização, disponibilidade, próxima fatura e vencimento; dívidas com saldo devedor, parcelas e próximo vencimento, reutilizando os serviços existentes.
- [ ] **Fase 4:** distribuição do patrimônio e resumo da carteira de investimentos com dados agregados no banco, moedas segregadas e histórico disponível.
- [ ] **Fase 5:** integrar a projeção de compromissos da PR #210, sem duplicar a consulta ou o motor financeiro.
- [ ] **Fase 6:** revisão independente, testes de privacidade, âncoras, responsividade, estados vazios, moedas e isolamento familiar; conferir CI e preview antes de solicitar merge.


### Cartão de crédito: recursos avançados da fatura (pendentes após #204)
- [ ] **Categorias da fatura**: RPC agregada por categoria e gráfico/lista na página dedicada. O front não deve somar os valores.
- [ ] **Detalhes do lançamento**: painel lateral com categoria, valor, data e descrição editáveis; tag de despesa fixa mensal; ações de excluir e estornar/reembolsar. Exige trilha de auditoria e preservação da trava de fatura paga.
- [ ] **Mover parcela entre faturas**: ações no menu de contexto para fatura anterior/próxima; definir a regra para parcela já cobrada, fatura paga e sequência de parcelas, com operação atômica no banco.


## Auditoria de pessoas inativas (PR #209)
- [x] Bloqueio no banco de novas atribuições de pessoas inativas em lançamentos, parcelas de dívidas e recorrências; classificações históricas permanecem preservadas.
- [x] Índices compostos começam por `(household_id, person_id)`, cobrindo as FKs e as consultas por período.
- Migration 083: `20261108210000_people_active_and_fk_indexes.sql`. Ainda não aplicada no Supabase hospedado.
