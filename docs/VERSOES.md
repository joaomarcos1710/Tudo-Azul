# Versões do Tudo Azul

Formato: **`AAAA.PR`** — o **ano** em que estamos e o **número da PR** (do GitHub) que trouxe a mudança.
Exemplo: a PR #98, aberta em 2026, vira `2026.98`. Quando o ano mudar, o ano muda e o número da PR continua a sequência
do GitHub (ex.: `2027.130`).

- **A cada PR** (de funcionalidade, correção, teste ou diário), na própria PR: `package.json` e `package-lock.json` →
  `"version": "AAAA.PR.0"`, com `PR` = número da PR. O 3º número fica sempre `0` (só existe porque o npm exige três).
  Como o número da PR só existe depois que ela é aberta, confira o número antes de abrir (o próximo da lista do
  GitHub) e corrija com um commit se errar.
- **Onde aparece**: o app mostra `AAAA.PR` na barra lateral, na tela de Família e nas telas de entrada; no deploy da
  Vercel aparece também o commit curto (`2026.98 · 98e83d0`).
- **Merge fora de ordem:** a versão nunca diminui. Ao mesclar a PR #N, use o maior valor entre N e a versão já integrada
  na `main`. Uma PR mais antiga que a versão atual mantém a versão atual; uma PR mais nova avança para seu próprio número.
  Exemplo: se a PR #98 já entrou, a PR #97 mantém `2026.98.0`; a PR #99 usa `2026.99.0`.
- **Migrations** têm numeração própria (001, 002…) e continuam sem ser editadas depois de aplicadas.

## Antes (até 2026.5): edições

Até a PR #93 o formato era `AAAA.E` (ano e edição, 1 a cada lote de entregas ao dono: `2026.1` a `2026.5`). Em 30/10/2026
o dono trocou a regra para o número da PR (decisão registrada em `docs/projeto/30 - Decisões.md`). As edições antigas
continuam abaixo como histórico.

## Histórico das edições (2026.1 a 2026.5)

| Edição | O que entrou |
|---|---|
| 2026.1 | Primeira edição numerada: lançamentos, contas com conferência de extrato, cartões (limite, fatura, parcelas), recorrentes, categorias, orçamentos, projeção do mês, exportação CSV, painel e correções da auditoria (migration 014). |
| 2026.2 | Painel novo (ações rápidas, vencidos, cartões e conferência de saldo na Visão geral); robustez do front (respostas velhas, envio duplicado, pagar fatura, PWA v2); menu em grupos com "Mais" no celular; ocultar valores; dependências Vite 8 / Vitest 5 com auditoria de produção no CI; filtros de Lançamentos por tipo; diário do projeto em `docs/projeto/`. |
| 2026.3 | Redesenho visual pelo design system "Tudo Azul": painéis sem padding dobrado, títulos de mês com maiúscula certa, lista de Lançamentos compacta (valor na linha da descrição, Excluir discreto, totais em linhas no celular), ações rápidas do Início com ícone, contorno de campos com contraste; Calendário do mês (#62). |
| 2026.4 | Recorrências com frequência (semanal, quinzenal, mensal, bimestral, trimestral, semestral, anual e personalizada; migration 016, #65/#66); redesenho parte 2: cabeçalho padrão em todas as telas (título, descrição curta e ações à direita) e Cartões com a fatura a pagar em destaque e a ação principal que muda com ela. |
| 2026.5 | Menu "Mais" com atalhos e uma frase em cada tela; formulário de lançamento em visual de app (abas, valor grande, "Registrar e lançar outro", última conta lembrada); fatura do cartão como extrato (compras por dia, nome inteiro); ícone e cor de categoria; subcategoria logo abaixo da principal; banco da conta, emissor e bandeira do cartão gravados, com logos (migration 017); excluir recorrente em vez de encerrar (migration 018). |

## Versão atual

| Versão | O que entrou |
|---|---|
| 2026.100 | Arquitetura patrimonial: investimentos híbridos, módulo de dívidas sobre o motor existente, bens, multimoeda e consolidação patrimonial. Documento `docs/ARQUITETURA-PATRIMONIO.md`; nenhuma funcionalidade financeira ou migration foi aplicada nesta PR. |

| 2026.101 | Fundação multimoeda fase 1: catálogo BRL/USD/EUR, moeda de consolidação da família e consulta auditável de câmbio direto/inverso. Contas e lançamentos estrangeiros continuam bloqueados até a próxima fase substituir as agregações financeiras. |

| 2026.102 | Segurança da fase 1 multimoeda: bloqueia a alteração da moeda de consolidação até que saldos, relatórios e interface convertam os valores corretamente. |

| 2026.103 | Módulo de dívidas e empréstimos sobre o motor debts/debt_events: parâmetros contratuais, pagamentos atômicos com principal/juros/tarifas e simulador Snowball/Avalanche. |

| 2026.104 | Carteira manual de investimentos: ativos BRL/USD/EUR, livro de compras/vendas, custo médio, avaliações manuais e totais segregados por moeda. Sem integração de caixa ou cotação automática nesta fase. |
| 2026.107 | Recorrentes: remove a área de arquivo "Encerrados" e elimina regras já encerradas do banco, preservando lançamentos pagos, compras de cartão e compromissos históricos. |
| 2026.111 | Governança de agentes: adiciona `AGENTS.md` com regras comuns de segurança, integridade financeira, Supabase, migrations, testes, Git, documentação e colaboração entre agentes. |
| 2026.112 | Desbloqueio de produção: a migration `recurrence_end_delete` é renomeada (20261030230100 → 20261031175000, ainda não aplicada) para não travar o `db push`; diário atualizado com as migrations 026–031 e as PRs #96–#111. |
| 2026.113 | Workflow de migrations de produção: CLI do Supabase fixada na linha 2.x e alvo explícito `--linked` (a CLI `latest` passou a recusar `migration list --password` e derrubava o workflow antes de simular). |
| 2026.114 | Categorias na regra 50-30-20: cada categoria de despesa pode ser classificada em Necessidades, Desejos ou Investir e poupar (migration 032); Categorias mostra o cartão do mês com a parte da renda em cada grupo. Nada é classificado sem a pessoa escolher. |
| 2026.115 | Diário: registra a aplicação das migrations 031 e 032 em produção (02/11/2026). Sem mudança de código. |
| 2026.116 | Relatório Entradas x Saídas em Relatórios: por dia, semana ou mês, com acumulado, filtro por conta e por quem lançou e a chave "Considerar não pagos" (migration 033, `cash_flow_report`). Valores e totais vêm do banco. |
| 2026.117 | Diário: registra a aplicação da migration 033 (Entradas x Saídas) em produção (02/11/2026). Sem mudança de código. |
| 2026.118 | Investimentos: subclasse do ativo (texto livre, ex.: Tesouro Direto, CDB, FIIs) e seção Alocação da carteira por macroclasse e subclasse, por moeda, com filtros nas posições (migration 034). A macroclasse é derivada da classe do ativo. |
| 2026.119 | Diário: registra a aplicação da migration 034 (subclasse e alocação de investimentos) em produção (02/11/2026). Sem mudança de código. |
| 2026.120 | Proventos de investimento (dividendo, JCP, rendimento): o provento entra como receita na conta, pelo valor líquido, ligado ao ativo; Investimentos mostra o recebido e o planejado por ativo (migration 035). Só ativos em reais. |
| 2026.121 | Diário: registra a aplicação da migration 035 (proventos de investimento) em produção (02/11/2026). Sem mudança de código. |
| 2026.122 | Recorrentes: trocar a categoria do recorrente passa a valer para todas as ocorrências (pagas, passadas, na lixeira e parcelas de assinatura de cartão), preservando o que foi mudado à mão (migration 036). |
| 2026.123 | Diário: registra a aplicação da migration 036 (categoria do recorrente em todas as ocorrências) em produção (02/11/2026). Sem mudança de código. |
| 2026.124 | Ajustes de interface da lista do dono: transferências do Início com "De → Para" e logo dos bancos; Extrato só com a categoria; valor do planejado sem cortar no celular; totais de Investimentos alinhados; simulador de quitação (Snowball/Avalanche) removido de Dívidas; Dívidas ganha "Renomear" (o erro de grafia era um nome digitado, não do app). Também corrige testes que erravam o dia entre 21h e 24h em São Paulo (dois do Início e os pgTAP 34, 35 e 36, que usavam `current_date` em UTC). Sem migration. |
| 2026.125 | Reconciliação de patrimônio e investimentos, cadastro/exclusão segura de bens e ativos, contratos e agenda de parcelas de dívidas, projeção e calendário integrados. |
| 2026.126 | Investimentos: editar, arquivar, reativar e excluir ativo cadastrado; o ativo zerado passa a mostrar "Sem posição" e pode ser arquivado (migration 037). Excluir só sem operação, avaliação nem provento. |
| 2026.127 | Consignado aceita juros e tarifa na parcela (só o principal abate o saldo) e o histórico de investimentos passa a contar ativo arquivado (migration 041). Diário: 037 a 040 aplicadas em produção. |
| 2026.129 | Investimentos: botão "Extrato" em cada ativo (compras, vendas, avaliações e proventos) e "Excluir" operação errada, que anula com motivo e deixa de contar na posição, custo, histórico e alocação (migration 043). Corrige o "Editar" do ativo, que abria longe do botão e podia gravar os dados de um ativo no outro. |
| 2026.130 | Investimentos: os formulários do topo (novo ativo, compra/venda, provento, avaliação) rolam a tela até eles ao abrir; no celular, "Registrar compra" lá embaixo parecia não fazer nada. Diário: migration 043 aplicada. |
| 2026.131 | Contas: tipo **Investimento** (além de corrente e poupança) e tela de Contas agrupada por tipo, com o subtotal de cada grupo vindo do banco (migration 044). Para quem trata o CDB/caixinha como conta: aplicação e resgate viram transferências e aparecem no extrato e no saldo consolidado. |
| 2026.132 | Início: o card Contas deixa de mostrar "Conferir" e "Nunca conferida com o extrato" (pedido do dono). A conferência continua na tela de Contas. Sem migration. |
| 2026.133 | Desempenho: arquivos do app ficam no cache do navegador por 1 ano (antes eram baixados a cada abertura) e o JavaScript é dividido por tela (arquivo principal de 532 kB para 263 kB; 153 → 85 kB comprimido). Arquivo antigo depois de deploy recarrega a página uma vez. Diário: migration 044 aplicada. |
| 2026.133 (#128) | Dívidas: arquivar e excluir empréstimo/financiamento e seção Arquivadas com Reativar (migration 045). Mesclada depois da #133, então mantém a versão 2026.133 (a versão nunca diminui). |
| 2026.134 | Investimentos: o cadastro de ativo deixa de vir com "Renda fixa" pré-escolhida; é preciso escolher a classe (um FII tinha sido gravado como renda fixa por isso). Sem migration. |
| 2026.135 | Monitoramento de erros (Sentry), só em produção e só com `VITE_SENTRY_DSN` no Vercel; sem dado pessoal nem valores (coleta toda desligada, valores e e-mails trocados por marcadores). Carregado depois da página, num arquivo à parte. Diário: migration 045 aplicada. |
| 2026.136 | Lançamentos: parcelas planejadas de empréstimo/financiamento aparecem no mês, marcadas "Planejado · contrato", com "Baixar parcela" (abre a baixa em Dívidas); não entram em total nenhum até a baixa. Dívidas: a agenda passa a mostrar as parcelas vencidas e ainda não baixadas, marcadas como "Vencida". Sem migration. |
| 2026.137 | Parcela de empréstimo/financiamento passa a ser **despesa do mês** em que é paga (resumo, Entradas x Saídas, despesas por categoria, orçamento e 50-30-20), com o principal na categoria escolhida em cada dívida (aba Categorias); a exportação de lançamentos inclui as parcelas (pagas e planejadas). Consignado fica de fora. Migration 046. |
| 2026.138 | Início: o card **Patrimônio líquido** mostra Disponível, Bens e Dívida um por linha (antes, texto corrido); o card **Saldo disponível** deixa de repetir a dívida. Sem migration. Diário: migration 046 aplicada. |
| 2026.139 | Início: cabeçalho no estilo do Organizze (saudação com o nome, receita e despesa do mês vindas do banco, atalho para Análises e os botões Despesa, Receita, Transferência e Compra no cartão). O bloco antigo de ações rápidas sai para não repetir. Sem migration. |
| 2026.140 | Painel: consertos achados na revisão. A % dos indicadores compara até o mesmo dia do mês anterior; "ocultar valores" esconde dólar e euro; carga antiga não sobrescreve a nova; card de vencidos ou cartões que falha avisa em vez de sumir; parcela de dívida vencida entra em "Vencidos". Sem migration. |
| 2026.141 | Início novo: sem números repetidos (receita e despesa só no cabeçalho, com "a receber"/"a pagar"; Patrimônio só com Bens e Dívida); card **Saldo hoje e previsto** no fim do mês (do banco, o mesmo do Calendário); **Vencidos** antes dos indicadores; **Orçamentos do mês** (até 4, os mais perto de estourar). Sem migration. |
| 2026.142 | Início: o card **Saldo hoje e previsto** mostra um item por linha (rótulo à esquerda, valor à direita); em duas colunas o "Previsto em 30/11" quebrava e o valor saía do card. **Minhas contas** com o **Saldo geral** (do banco) no topo; cada cartão mostra **Limite disponível** ao lado da **Fatura atual**, como no Organizze; contas arquivadas seguem escondidas. Sem migration. |
| 2026.143 | Início: transferência nas listas mostra **"De Mercado Pago → Para Caixa"** (cada palavra junto da sua conta); conta arquivada aparece com o nome dela em vez de "outra conta". O valor do **previsto** não sai mais do card estreito (desce para baixo do rótulo) e os indicadores ficam em 3 colunas. Sem migration. |
| 2026.144 | Análises: **Patrimônio líquido** e **Saldo das contas** mês a mês (últimos 12 meses), em dois gráficos com tabela. Cada ponto é o `net_worth_with_assets` do banco no fim do mês (no mês atual, hoje). Ideia aproveitada do projeto personal-financial-dashboard, sem copiar código. Sem migration. |
| 2026.145 | Aviso diário, parte 1 (banco): migration 047 com preferências do aviso, registro de envios, `daily_digest` (resumo do dia com as mesmas fontes do Início) e `private.is_member` aceitando a service_role (a rotina do servidor). Sem mudança de tela. |
| 2026.146 | Aviso diário, parte 2 (tela): card **Aviso diário por e-mail** na tela Família — ligar, horário (5h–22h), esconder valores (ligado por padrão) e a prévia de hoje com o mesmo texto do e-mail. Funciona depois da migration 047 aplicada; o envio vem na parte 3. |
| 2026.147 | Lançamentos como no Organizze: **+ Lançamento** abre um menu (Nova despesa, Nova receita, Nova transferência, Compra no cartão, com as teclas D, R, T, C); o formulário abre num **painel** por cima da lista (fecha no ×, no Esc ou clicando fora); **Repetir → Lançamento fixo** cria o recorrente ali mesmo (semanal a anual, com "até" opcional). Sem migration. |
| 2026.148 | **Lançamento parcelado** fora do cartão (Repetir → Lançamento parcelado: 2 a 360 parcelas, períodos de Anos a Dias, sobra dos centavos na primeira, todas gravadas de uma vez no banco) e recorrência **Diária / a cada N dias**. Migration 048. |
| 2026.149 | Consertos da auditoria: a chave do servidor só lê no aviso diário (migration 049); Orçamentos e Categorias sem conta de dinheiro na tela; faturas de Cartões não ficam presas no erro; Dívidas mostra todas as parcelas, por dívida, e avisa se a agenda falhar; Entradas × Saídas não mostra números do filtro anterior e vira cartões no celular; CSV de qualquer período, "desde o primeiro lançamento"; Lançamentos sem o botão Recorrentes no topo. |
| 2026.150 | Diário: engenharia reversa do Organizze (`51`), só estrutura, sem dados; migration 049 aplicada. Sem mudança no app. |
| 2026.151 | **Excluir ativo com histórico**: pede o nome exato do ativo e apaga operações e avaliações; a receita dos proventos fica na conta. Migration 050. |
| 2026.152 | **Escolher a fatura** da compra no cartão (até 3 antes e 3 depois) e recuar o início do cartão para lançar o passado. Migration 051. |
| 2026.154 (#153, mesclada depois da #154) | **Crédito / reembolso no cartão** que conta como receita (estorno de IOF, ajuste, cashback, reembolso): abate a fatura, aparece em verde na fatura e pode ser anulado. Migration 052. |
| 2026.154 | `CLAUDE.md`: regras de como mexer no código (adaptadas do Ponytail); sem preview da Vercel nos branches do Claude. Sem mudança no app. |
| 2026.155 | Diário: migration 052 aplicada. Sem mudança no app. |
| 2026.156 | Índice no banco para o cartão com muito histórico (compra e fechamento da fatura rápidos). Migration 053. Sem mudança na tela. |
| 2026.157 | Diário: histórico do Organizze importado, empréstimo da Funcef cadastrado, migration 053 aplicada. Sem mudança no app. |
| 2026.158 | **Zerar tudo** apaga também investimentos (com operações, avaliações e proventos), bens (com avaliações) e a agenda dos contratos, e a prévia mostra quantos; a **exportação completa** ganha os arquivos de investimentos e de bens (8 arquivos). Migration 054. |
| 2026.159 | A **conferência com o extrato** saiu do app (tela Conferir, botão em Contas e o "e conferência" do menu, que vira **Contas**); a exportação completa não tem mais a coluna "Conferido". Sem migration. |
| 2026.160 | **Multimoeda, fase 1**: cada conta tem uma **moeda** (Real, Dólar ou Euro), escolhida no cadastro; o saldo aparece na moeda da conta, e os totais em reais ficam só com as contas em reais, com "Em outras moedas" à parte, sem conversão. Conta em outra moeda ainda não recebe lançamentos (em breve). Exportação com a coluna Moeda. Migration 055. |
| 2026.161 | **Multimoeda, fase 2**: conta em dólar ou euro aceita **receita e despesa** (avulsa, parcelada e recorrente) e transferência para outra conta da mesma moeda; o valor aparece na moeda da conta. Os totais e relatórios em reais continuam só em reais; o que entrou e saiu em cada outra moeda aparece à parte, em "Em outras moedas", sem conversão. Orçamento só em reais; cartão, dívida e provento seguem só em reais. Exportação de lançamentos com a coluna Moeda. Migration 056. |
| 2026.162 | **Avisos no topo do Início**: quando há algo a dizer, aparecem cartões com o que entra e o que sai nos próximos 7 dias, a fatura de cartão que vence em até 7 dias e o que já venceu, cada um com o total e um atalho (Lançamentos já filtrado, a fatura do cartão ou a lista de vencidos). No celular, deslize para o lado; os pontinhos mostram onde você está. Respeita "ocultar valores". **Minhas contas** no Início mostra só as contas com saldo, com o link "Ver todas as contas". Migration 057. |
| 2026.163 | **Cartões mais limpos**: o destaque de cada cartão passa a ser a **fatura atual** (a aberta, "vence dd/mm", com "aberta — fecha dia N"), como no Organizze; com fatura fechada e não paga, ela vem em destaque e a atual fica embaixo. Sem nada a pagar: "Sem fatura em aberto" (acabou o "R$ 0,00" em destaque). No cartão ficam só **Nova compra**, **Pagar fatura** e **Ver faturas**; o resto vai para o menu **⋯ Mais opções**. Correções: a fatura escolhida para a compra respeita o fechamento no último dia em mês curto (fecha 30 ou 31); a "Fatura atual" é sempre a do ciclo de hoje (antes podia mostrar a do mês seguinte); fatura fechada ainda não cobrada não aparece como "Paga". Sem migration. |
| 2026.164 | **Lançamentos: fatura do cartão numa linha só.** Em vez de cada compra do cartão aparecer solta no extrato do mês, aparece **uma linha "Fatura <cartão>" no dia do vencimento**, com o total da fatura, a situação (aberta, fechada, vencida ou paga), **"Ver compras"** para abrir as compras e o atalho para o cartão. Filtrando por categoria, as compras daquela categoria aparecem uma a uma. Os totais do mês e os relatórios não mudam (a compra conta como despesa no fechamento da fatura). Sem migration. |
| 2026.166 | **Cartões mais fáceis de usar.** Os formulários (Pagar fatura, Nova compra, Renomear…) abrem **dentro do próprio cartão**, com o foco neles, e o foco volta ao botão ao fechar. As abas de fatura abrem **na fatura atual**, com as 6 anteriores e as próximas ("Ver mais antigas" mostra o resto) e setas do teclado. **Resumo** no topo (ao lado no computador, com os cartões em 2 colunas): "Próxima fatura vence em dd/mm/aaaa" e "Faturas que vencem em <mês>" (total do banco, o mesmo do Início). Selo **Vencida** no destaque e nas abas. "Parcelas futuras" virou **"A cobrar (atual + futuras)"**. **Estornar** (total ou parcial) na linha da compra. **Melhor dia de compra** no cabeçalho do cartão. Cartões em ordem do **próximo vencimento**. Sem migration. |
