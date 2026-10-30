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

## Ainda abertos
Só este registro do diário em 28/10/2026.
