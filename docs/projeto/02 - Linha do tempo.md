---
tags: [tudo-azul, historico]
---
# Linha do tempo — passo a passo

> Fonte: histórico do `main` no GitHub (cada item é um PR mergeado). Datas em que entrou no `main`.

## Fase 0 · 13/10 — a base
- Estrutura da aplicação e **design system** (layout responsivo, componentes, formatadores pt-BR).
- **CI** no GitHub (Node 22, typecheck, testes e build).
- Referências visuais (telas de exemplo com dados fictícios).
- **Supabase**: o app só aceita a *publishable key*; chave secreta (`sb_secret_`) é recusada no navegador, com teste.

## Fase 1 · 16/10 — telas básicas e o modelo de dados
- Proposta de **modelo de dados e segurança** (PR #6) · dinheiro em **centavos inteiros** (PR #15).
- Telas: **acesso** (entrar, criar conta, recuperar senha — #16) · **Família** (criar, convidar por link, aceitar — #18) · **Contas** (#19) · **Categorias** (#20) · **Lançamentos** (#21) · **Visão geral** (#22) · **exportação CSV** do mês e backup (#23).
- CI roda em todo PR (#13) · botão manual para aplicar migrations no Supabase (#17).
- **Cartão**: ciclo, compra parcelada e cobrança automática (#26, migration 004) · tela de Cartões e relatórios da fatura (#27, migration 005).

## Fase 2 · 23–24/10 — cartão completo, recorrentes, conferência
- Excluir compra, reabrir fatura, editar parcela (#29 banco, #30 front).
- **Recorrentes**: contas mensais e assinaturas no cartão (#28, migration 006).
- **Conciliação** com o extrato (#33, migration 007) — trava o período conferido.
- **Logo** (#32) · **PWA**, app instalável no celular (#34).
- **Exportação completa** em 5 arquivos para conferir saldos fora do app (#36).
- **Visão geral v2**: gráficos por categoria e acumulado, KPIs com comparação (#35, migration 008).
- Extrato mostra pagamento de fatura (#37) · agentes do projeto e pesquisa de ideias (#31).

## Fase 3 · 25/10 — testes de uso e refinamentos
- **Zerar tudo** para começar do zero, só o dono, frase conferida no banco (#38, migration 009).
- **Pagamento adiantado** de fatura vira crédito no cartão (#39, migration 010).
- **Marcar pago** pede a data e o valor reais, para o saldo bater com o extrato (#41).
- **Tela única de lançamento**: escolhe conta ou cartão; compras no cartão entram na lista do mês (#42).
- **Anular** pagamento ou devolução na tela do cartão (#43).
- **Limite disponível do cartão** e **renda regular × eventual** (#44, migrations 011 e 012).
- Parcelas do cartão **uma por mês** na lista + comparação com o ano passado (#45).
- **Orçamentos** (tela de verdade) e **projeção do mês** (#46, migration 013).

## Fase 4 · 26/10 — auditoria, dependências, painel, menu
- **Dois agentes** auditaram o banco e os valores ([[Auditorias/2026-10-26 Auditoria]]).
- **Migration 014** corrige o bug de valor e furos de integridade (#51) — aplicada em produção.
- **Recorrências preservam correções manuais**: PR #59, migration 015; merge na `main` no commit `5ad36f1`.
- **Migration 015 aplicada em produção** em 26/10/2026, comprovada pela [execução 20 do workflow](https://github.com/joaomarcos1710/Tudo-Azul/actions/runs/40397169580), a partir do commit de merge `5ad36f1`; registro no diário (#60).
- **Abrir no Início**, não na Família + **versão 2026.1** (#52) · **filtros de Lançamentos** (#53).
- Dependências: **Vite 8, Vitest 5, plugin React 6** (#47) · política de dependências e exceção do Tailwind 3 (#49).
- **Painel**: ações rápidas, vencidos, resumo dos cartões e conferência de saldo (#48).
- **Robustez do front**: respostas velhas, envio duplicado, pagar fatura e PWA (#50).
- **Menu em grupos**, "Mais" no celular e **ocultar valores** (#54).
- **Diário do projeto** (`docs/projeto/`) e regra de mantê-lo atualizado (`CLAUDE.md`) — PR #55.
- **Versão 2026.2** — este lote (painel, robustez, menu, ocultar valores, dependências, diário); commit do build só na tela Família (#56, mesclado em 27/10).

## Fase 5 · 27/10 — revisão independente, períodos e Início × Análises
- **Auditoria independente** de 27/10: achados confirmados e corrigidos antes dos merges.
- **Períodos financeiros, etapa 1**: cálculo puro de mês, ciclo (dia 1–31) e período personalizado, faixa igual à do banco (#58). Sem efeito visível ainda.
- **Início × Análises**: a Visão geral virou duas telas; cada uma carrega só o que mostra e um bloco que falha some sozinho (#57).
- **Pesquisa de ideias, rodada 2**, com os achados já resolvidos marcados (#40).
- **Propostas antigas guardadas como histórico**, com nota de status e os pontos a corrigir: importação do Organizze (#9), multimoeda e início operacional (#10).

## Fase 6 · 28/10 — calendário, redesenho (2026.3 e 2026.4) e frequências de recorrência
- **Linha do tempo e pendências** de 27/10 no diário (#61).
- **Calendário do mês**: grade com marcas de entrada, saída e planejado; detalhe do dia; totais do mês vindos do banco (#62).
- **Versão 2026.3 — redesenho visual** pelo design system "Tudo Azul": padding dobrado dos painéis corrigido em 5 telas, títulos de mês com maiúscula certa, Lançamentos compacto, ações rápidas com ícone, contraste dos campos, Início sem rolagem lateral no celular; verificado em 320–1280px (#64, merge `2f178e1`).
- **Recorrências com frequência** — banco: migration 016 (semanal, quinzenal, mensal, bimestral, trimestral, semestral, anual, personalizada), série de datas numa função só, projeção do cartão corrigida (#65, merge `5c4cea5`).
- **Migration 016 aplicada em produção** em 28/10/2026, pela [execução 22 do workflow](https://github.com/joaomarcos1710/Tudo-Azul/actions/runs/40690330495) (simulação antes: execução 21), a partir do commit `5c4cea5`; 21 migrations iguais no repositório e na produção.
- **Recorrências com frequência** — tela: escolher a frequência, data final e prévia das próximas datas (#66, merge `b4b059f`, depois da 016 aplicada).
- **Diário** em dia até o #66 (#67, merge `7681906`).
- **Versão 2026.4 — redesenho parte 2**: cabeçalho padrão em todas as telas (título, descrição curta, ações à direita) e Cartões com a fatura a pagar em destaque e a ação principal que muda com ela; a edição junta as frequências de recorrência (#69, merge `629bce0`).
- **Diário** com #67 e #69 (#70, merge `1567e15`). Versão 2026.4 testada pelo dono no app e mantida.
- **Diário**: 2026.4 testada (#71, merge `ca49147`).
- **Ícone e cor de categoria** (redesenho parte 3, PR 1): o app sugere pelo nome e a pessoa troca em Categorias; ícone em Lançamentos, faturas de Cartões e Início; paleta de 5 cores sem vermelho/verde/âmbar; sem migration (#72, merge `9160ee5`).
- **Diário**: ideias de antecipar parcelas (#73, merge `ab5d9ef`).
- **Menu "Mais" do celular**: 4 cartões de atalho e uma frase em cada tela, formato escolhido pelo dono (#75, merge `6f09dbb`).
- **Diário**: ideias de outros apps (Livro de contas e Minhas Economias) e a decisão do valor do dia no Calendário (#74, merge `735a66d`).
- **Formulário de lançamento em visual de app**: abas, valor grande, campos em linhas com seletor nativo, "Registrar e lançar outro" e última conta/cartão lembrados (#76, merge `a04364b`).
- **Subcategoria sob a principal e selo do banco** nas contas: seletores com a filha logo abaixo da principal e "Principal › Filha" nas listas; selo reconhecido pelo nome da conta (#78, merge `55f5e74`).
- **Fatura do cartão como extrato**: compras agrupadas por dia, nome inteiro, parcela em selo, botões compactos (#77, merge `5b554be`).
- **Logos de 20 bancos** nas contas, com a sigla colorida onde não há arquivo (#79, merge `95c33ce`).
- **Teste RF13 corrigido**: a janela da fatura esperava 18 em vez de 17 (a compra no dia do fechamento vai para a fatura seguinte); só falhava quando uma ocorrência semanal caía no dia 17 (#81, merge `8d813d1`).
- **Banco da conta, emissor e bandeira do cartão gravados** (migration 017): seletores em Contas e Cartões, logos de banco e ícones de bandeira nas telas; o front lê sem as colunas se a migration ainda não entrou (#80, merge `9a057b2`).
- **Migration 017 aplicada em produção** em 29/10/2026, pela [execução 24 do workflow](https://github.com/joaomarcos1710/Tudo-Azul/actions/runs/40950980065) (simulação antes: execução 23), a partir do commit `9a057b2`; 22 migrations em sincronia.
- **Excluir recorrente e versão 2026.5**: o botão "Encerrar" virou "Excluir" (também nos "Encerrados" antigos); a regra some, os planejados de hoje em diante vão para a lixeira e o histórico fica (migration 018); `package.json` na 2026.5 (#84, merge `80685b2`).
- **Migration 018 aplicada em produção** em 29/10/2026, pela [execução 26 do workflow](https://github.com/joaomarcos1710/Tudo-Azul/actions/runs/40952813187) (simulação antes: execução 25), a partir do commit `80685b2`; 23 migrations em sincronia.
- **Projeção não infla mais depois de excluir um recorrente** (migration 019): achado pelo agente revisor de dinheiro como regressão da 018; a projeção do mês e a dos orçamentos passam a tratar o que a regra gerou por `occurrence_date` (#86, merge `c82ee04`).
- **Migration 019 aplicada em produção** em 29/10/2026, pela [execução 28 do workflow](https://github.com/joaomarcos1710/Tudo-Azul/actions/runs/40957180996) (simulação antes: execução 27), a partir do commit `c82ee04`; 24 migrations em sincronia.
- **Arquivar e excluir cartão e conta** (migration 020, #88, merge `85d634e`, 30/10/2026): cartão e conta ganham Arquivar (reversível, seção "Arquivados") e Excluir (só o que nunca teve movimento). Migration 020 aplicada em produção em 30/10/2026.
- **Renomear cartão e mensagem de exclusão que conta o que existe** (migration 021, #89, merge `4936a78`, 30/10/2026): `debt_rename` e botão "Renomear"; a recusa de exclusão diz quantas parcelas, movimentos ou faturas existem. Migration 021 aplicada em produção em 30/10/2026.
- **Testes pgTAP sem dependência da data de hoje** (#90, merge `3869204`, 30/10/2026): 4 testes falhavam simulando 02/01/2027; novo `scripts/local-db/simular-data.sh`. Sem migration.
- **Recorrentes: horizonte de 12 meses e até a data final** (migration 022, #91, merge `af6e1e1`, 30/10/2026): sem data final gera 12 meses; com data final, até ela (máx. 360; semanal 24). Migration 022 aplicada em produção em 30/10/2026 (execução 34).
- **Total das faturas do mês no Início** (migration 023, #92, merge `56e17d7`, 30/10/2026): `card_invoices_month` soma no banco as faturas que vencem no mês. Migration 023 aplicada em produção em 30/10/2026 (execução 36).
- **Próxima fatura no cartão e no Início** (#93, merge `6c45d99`, 30/10/2026): "Próxima fatura (vence dd/mm)" com a fatura aberta que fecha primeiro, mesmo com "Fatura a pagar" zerada. Sem migration.
- **Conta de pagamento padrão do cartão** (migration 024, #94, merge `49efc53`, 30/10/2026): `debts.pay_account_id` e `set_card_pay_account`; "paga com", sugestão em "Pagar fatura" e base do saldo projetado. Migration 024 aplicada em produção em 30/10/2026 (execução 38).
- **Fatura no Calendário e saldo projetado em qualquer data** (migration 025, #96, merge `8c1693e`, 30/10/2026): `card_invoices_due`, `account_balances_projected`, `balance_totals_projected`; bloco "Saldo até a data" com "só efetuados / efetuados + planejados". Migration 025 aplicada em produção em 30/10/2026 (execução 40).
- **Versão = ano + número da PR** (#98, merge `476239c`, 30/10/2026): regra em `docs/VERSOES.md` e `CLAUDE.md`.
- **Cadastro de cartão atômico** (migration 026, #97, merge `0344594`, 30/10/2026): `create_card` numa única transação.
- **Painel financeiro personalizável** (#99, merge `f985546`, 30/10/2026).
- **Arquitetura de investimentos, dívidas e patrimônio** (#100, merge `8055263`, 30/10/2026): documento `docs/ARQUITETURA-PATRIMONIO.md`.
- **Fundação multimoeda** (migration 027, #101, merge `ac2a8a8`) e **bloqueio da moeda de consolidação** (migration 028, #102, merge `b7bcb68`), 30/10/2026.
- **Gestão de empréstimos e simulador de quitação** (migration 029, #103, merge `1f5ce25`, 30/10/2026).
- **Carteira manual de investimentos** (migration 030, #104, merge `00cd977`, 30/10/2026).
- **Recorrentes: excluir regras finalizadas em vez de arquivar** (migration 031, #107, merge `d2f0f27`, 30/10/2026; testes alinhados no #108, merge `02e0591`). A migration 031 foi aplicada em 02/11/2026 (ver `21 - Banco de dados.md`).
- **Governança de agentes** (`AGENTS.md`, #111, merge `42593ae`, 31/10/2026).
- **Desbloqueio de produção** (#112, merge `7db6887`, 02/11/2026): a migration `recurrence_end_delete` foi renomeada (20261030230100 → 20261031175000, migration 031, ainda não aplicada) por travar o `supabase db push`; diário atualizado com as migrations 025–031 e as PRs #96–#111.
- **Workflow de produção com CLI 2.x** (#113, merge `999ca10`, 02/11/2026): a simulação passou a funcionar; só a 031 aparece como pendente.
- **Categorias na regra 50-30-20** (migration 032, #114, merge `f095f36`, 02/11/2026): `categories.budget_group` + `budget_rule_report`; seletor de grupo e cartão do mês em Categorias. Primeira etapa da implementação do protótipo do AI Studio.
- **Migrations 031 e 032 aplicadas em produção** (02/11/2026, execução 41542393688 do workflow, #115 registra no diário): simulação antes, `APLICAR` com o "pode" do dono; as duas foram juntas porque o `db push` não aplica uma só.
- **Relatório Entradas x Saídas** (migration 033, #116, 02/11/2026): `cash_flow_report` + bloco no topo de Relatórios (merge `66febf7`; migration aplicada em 02/11/2026, execução 41544131647). Segunda etapa da implementação do protótipo do AI Studio.
- **Macroclasse e subclasse de investimento** (migration 034, #118, 02/11/2026): `investment_assets.subclass`, `investment_asset_set_subclass`, `investment_allocation` + seção de alocação e filtros em Investimentos (merge `f1f36cc`; migration aplicada em 02/11/2026, execução 41545867679). Terceira etapa da implementação do protótipo do AI Studio.
- **Proventos de investimento** (migration 035, #120, 02/11/2026): `investment_distributions`, `investment_distribution_record` e `investment_income_by_asset` + formulário e seção em Investimentos (merge `d93b152`; migration aplicada em 02/11/2026, execução 41547324721). Quarta etapa da implementação do protótipo do AI Studio.
- **Recorrentes: categoria vale para todas as ocorrências** (migration 036, #122, 02/11/2026): `recurrence_update` agora propaga a categoria também para pagas, passadas, lixeira e parcelas de cartão, preservando edições manuais. Primeira correção da lista "Melhoria 1" do dono (merge `18962e9`; migration aplicada em 02/11/2026, execução 41549255886).
- **Ajustes de interface da lista "Melhoria 1"** (#124, 03/11/2026): De → Para com logos no Início, Extrato só com a categoria, planejado sem cortar, totais de Investimentos alinhados, simulador de quitação removido; testes de relógio corrigidos (Início e pgTAP 34 a 36). Sem migration.
- **Gerir ativos de investimento** (migration 040, #126, 03/11/2026, merge `80e185b`): `investment_asset_update`, `_archive` e `_unarchive` + Editar, Arquivar e Reativar em Ativos cadastrados. A exclusão (`investment_asset_delete`) é da migration 039, da #125. **037, 038, 039 e 040 aplicadas em produção em 03/11/2026** (execuções 41617320956 e 41617985117).
- **Consignado com juros e histórico com ativo arquivado** (migration 041, #127, 03/11/2026): consertos de defeitos achados na revisão da #125. Consignado aceita principal + juros + tarifa = parcela (só o principal abate o saldo); `investment_history` conta o ativo arquivado nos meses em que tinha posição. Merge `7078d95`; **migration 041 aplicada em 03/11/2026** (execução 41619293355).
- **Extrato do ativo e exclusão de operação errada** (migration 043, #129, 03/11/2026): botão "Extrato" em cada ativo e "Excluir" operação, que anula com motivo (não apaga). Corrige o "Editar" do ativo, que abria no topo da página e podia gravar os dados de um ativo no outro. Pedido do dono: não havia onde ver nem desfazer uma compra errada. Merge `f6b6b13`; **migration 043 aplicada em 03/11/2026** (execução 41663655015).
- **Formulários de Investimentos visíveis ao abrir** (#130, 03/11/2026): novo ativo, compra/venda, provento e avaliação rolam a tela até o formulário. O dono relatou que "Registrar compra" não funcionava: o formulário abria no topo, longe do botão.
- **Conta do tipo Investimento e Contas por tipo** (migration 044, #131, 03/11/2026): decisão do dono de dividir as contas em corrente, poupança e investimento e tratar o CDB/caixinha como conta (aplicação = transferência). Tela de Contas agrupada por tipo, com subtotal do banco. Merge `1a0f285`; **migration 044 aplicada em 03/11/2026** (execução 41667500601).
- **Início sem conferência no card Contas** (#132, 03/11/2026): pedido do dono; a conferência com o extrato fica só na tela de Contas. Merge `777d9fa`.
- **Desempenho: cache do navegador e JS por tela** (#133, 03/11/2026): `vercel.json` passa a mandar `immutable` (1 ano) para `/assets` e a não devolver o index.html para arquivo inexistente; cada tela vira um arquivo próprio (`React.lazy`), com recarga única quando o arquivo antigo sumiu depois de um deploy. Arquivo principal de 532 kB para 263 kB. Merge `21753f6`.
- **Arquivar e excluir dívida** (migration 045, #128, 03/11/2026): Dívidas ganha Arquivar e Excluir em cada empréstimo/financiamento (confirmação dentro do próprio card) e a seção Arquivadas com Reativar. Arquivar a dívida quitada cancela as parcelas planejadas que sobraram do contrato. Merge `7777103`; **migration 045 aplicada em 03/11/2026** (execução 41728809397).
- **Classe obrigatória no cadastro de ativo** (#134, 03/11/2026): sem "Renda fixa" pré-escolhida; o dono tinha cadastrado um FII sem trocar o campo e ele entrou como renda fixa. Merge `53c27d4`.
- **Monitoramento de erros com Sentry** (#135, 03/11/2026): `@sentry/react` 11.8.0 carregado depois da página e só com `VITE_SENTRY_DSN`; coleta de dados toda desligada e textos limpos antes do envio; 20% das visitas medem a velocidade real. Merge `0c7bb79`; DSN do projeto `bomfim/tudo-azul` em `VITE_SENTRY_DSN` (Vercel, produção) e erro de teste recebido já limpo (TUDO-AZUL-1, resolvido).
- **Parcelas do contrato em Lançamentos** (#136, 03/11/2026): relato do dono, "criei as parcelas da dívida do imóvel, mas não entrou no extrato, apesar de ter entrado no calendário". Parcelas planejadas aparecem no mês com "Baixar parcela"; fora dos totais até a baixa. A agenda de Dívidas passa a incluir as vencidas. Merge `8fbc056`.
- **Parcela de dívida como despesa do mês** (migration 046, #137, 03/11/2026): relato do dono, "no Relatórios e exportação não aparece a parcela". Decisão: despesa do mês, com o principal na categoria escolhida em cada dívida. Relatórios, orçamento, 50-30-20 e exportação passam a contar a parcela; Lançamentos marca o pagamento do empréstimo como "já em despesas". Merge `f75f180`; **migration 046 aplicada em 03/11/2026** (execução 41740081652).
- **Início: card de patrimônio em linhas** (#138, 03/11/2026): pedido do dono; Disponível, Bens e Dívida um por linha, e o card Saldo disponível sem a dívida repetida.
- **Início: cabeçalho com atalhos** (#139, 03/11/2026): ideia do dono a partir do Organizze; saudação, receita e despesa do mês e ações rápidas no topo.
- **Painel: consertos da revisão** (#140, 03/11/2026): comparação até o mesmo dia, ocultar valores em moeda estrangeira, carga atrasada descartada, aviso quando vencidos/cartões falham, parcela de dívida vencida em Vencidos.
- **Início novo** (#141, 04/11/2026): pedido do dono (números duplicados) e ideias do Google AI Studio filtradas; saldo previsto, a receber/a pagar, vencidos no topo e orçamentos.
- **Início: card do previsto em linhas** (#142, 04/11/2026): pedido do dono pelo print; o valor do previsto saía do card. Também: saldo geral em Minhas contas e limite disponível + fatura atual em cada cartão.
- **Início: "De … → Para …" nas transferências** (#143, 04/11/2026): pedido do dono; conta arquivada aparece com o nome.
- **Análises: patrimônio e saldo mês a mês** (#144, 04/11/2026): pedido do dono após analisar o personal-financial-dashboard; dois gráficos de 12 meses com tabela.
- **Aviso diário — banco** (migration 047, #145, 04/11/2026): decisão do dono (e-mail, esconder valores ligado, opção 1 de acesso). Merge `49fb434`; **migration 047 aplicada em 04/11/2026** (execução 41751150847, simulação 41751084406).
- **Aviso diário — tela** (#146, 04/11/2026): card na tela Família com a prévia de hoje.
- **Lançamentos: painel, menu e lançamento fixo** (#147, 04/11/2026): pedido do dono a partir do Organizze.
- **Parcelado fora do cartão e recorrência em dias** (migration 048, #148, 04/11/2026): pedido do dono a partir do Organizze. Merge `1efa1f0`; **migration 048 aplicada em 04/11/2026** (execução 41753252297, simulação 41753191906).
- **Consertos da auditoria** (migration 049, #149, 04/11/2026): três agentes revisaram o app; o dono mandou corrigir os itens graves. Merge `c4e14f0`; **migration 049 aplicada em 04/11/2026** (execução 41755314777, simulação 41755254149).
- **Engenharia reversa do Organizze** (#150, 04/11/2026): leitura pelo conector oficial, só estrutura (doc `51`).
- **Importação do cadastro do Organizze** (04/11/2026, sem PR, pelo SQL de administrador com o "pode" do dono, identificado como o usuário e com simulação antes): contas com o saldo do dia, cartões, categorias e recorrentes. Categorias de teste desativadas e depois excluídas.
- **Excluir ativo com histórico** (migration 050, #151, 04/11/2026): botão Excluir pede o nome do ativo quando ele tem histórico. Merge `3124e34`; **migration 050 aplicada em 04/11/2026** (execução 41760547266, simulação 41760479629).
- **Escolher a fatura e recuar o início do cartão** (migration 051, #152, 04/11/2026): seletor de fatura (3 antes a 3 depois) na compra; o início do cartão pode recuar para lançar o passado. Merge `d0a2df4`; **migration 051 aplicada em 04/11/2026** (execução 41761250133, simulação 41761186576).
- **Crédito no cartão como receita** (migration 052, #153, 04/11/2026): estorno, ajuste, cashback ou reembolso sem compra abatem a fatura e contam como receita; planejado até a fatura fechar, limite volta na hora. Merge `3fefb7c`; **migration 052 aplicada em 04/11/2026** (execução 41800682054, simulação 41800598005).
- **CLAUDE.md: jeito de mexer no código** (#154, 04/11/2026): quatro regras adaptadas do Ponytail; e `vercel.json` sem preview nos branches `claude/**` (limite de 100 deploys por dia do plano gratuito).
- **Diário: migration 052 aplicada** (#155, 04/11/2026). Sem mudança no app.
- **Índice de eventos por parcela** (migration 053, #156, 04/11/2026): o cartão com muito histórico deixava a compra e o fechamento da fatura lentos (o fechamento passaria do limite de 8 s). Pré-requisito da importação do histórico do Organizze. Merge `48835f0`; **migration 053 aplicada em 04/11/2026** (execução 41814329909).
- **Ajustes das recorrentes** (04/11/2026, sem PR, pelo SQL de administrador com o "pode" do dono, identificado como o usuário, simulado antes): dia e início de algumas regras corrigidos (excluir e recriar, ou encerrar e criar outra); os planejados das regras antigas foram para a lixeira e a regeneração criou os novos.
- **Importação do histórico do Organizze** (04/11/2026, sem PR, mesmo caminho, com o "pode importar" do dono): lançamentos das contas, transferências e todas as faturas dos cartões, em 120 lotes com conferência de integridade em cada um. Conferência final: os saldos das 21 contas batem com o Organizze no dia; nenhuma despesa ou receita sem categoria.
- **Empréstimo da Funcef** (04/11/2026, sem PR, mesmo caminho, com o "pode" do dono): cadastrado em Dívidas com contrato e cronograma; sem CPF nem matrícula.
- **Diário: importação, Funcef e 053 aplicada** (#157, 04/11/2026). Sem mudança no app.
- **Zerar tudo e exportação completa com investimentos e bens** (migration 054, #158, 04/11/2026): o zerar passa a apagar e contar investimentos (ativos, operações, avaliações, proventos), bens com avaliações e a agenda dos contratos (antes deixava investimentos e bens para trás, sem erro); a exportação completa ganha os arquivos 7 (investimentos) e 8 (bens) e a tela diz 8 arquivos; `npm audit fix` (postcss-selector-parser 6.1.5, só desenvolvimento). Merge `a749099`; **migration 054 aplicada em 04/11/2026** (execução 41902641771, simulação 41902529963).
- **Conferência com o extrato sai do app** (#159, 04/11/2026): decisão do dono (não usa; 0 conferências em produção). Saem a tela Conferir, o botão em Contas, o "e conferência" do menu e a coluna "Conferido" da exportação; o banco fica dormente, sem migration.

## Ainda abertos
Só este registro do diário em 28/10/2026.
