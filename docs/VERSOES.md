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
| 2026.131 | Contas: tipo **Investimento** (além de corrente e poupança) e tela de Contas agrupada por tipo, com o subtotal de cada grupo vindo do banco (migration 044). Para quem trata o CDB/caixinha como conta: aplicação e resgate viram transferências e aparecem no extrato e no saldo consolidado. |
