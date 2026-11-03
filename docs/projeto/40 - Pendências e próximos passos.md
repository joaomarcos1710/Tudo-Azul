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

## Menu e formulário de lançamento
- [x] **Projeção errada depois de excluir recorrente** (#86, mesclado em 29/10; **migration 019 aplicada em produção em 29/10/2026**). Já pode excluir recorrente com lançamento pago no mês corrente.
- [ ] **Excluir recorrente + versão 2026.5** (#84, mesclado em 29/10; **migration 018 aplicada em produção em 29/10/2026**). Falta você: excluir o recorrente já finalizado em Recorrentes → Encerrados, conferir que os lançamentos pagos dele continuam, e testar a 2026.5 no iPhone.
- [ ] **Banco gravado e bandeira do cartão** (#80, mesclado em 29/10; **migration 017 aplicada em produção em 29/10/2026**). Falta você: escolher o banco das contas (Contas → Editar) e o emissor/bandeira dos cartões (Cartões → "Escolher banco e bandeira") e conferir os logos no iPhone. Next, Original e Will seguem com a sigla (sem logo).
- [ ] **Logos de banco** (#79, mesclado em 29/10): 20 logos importados de `rzmt/logos-bancos-br` (origem em `src/assets/bancos/ORIGEM.md`); Next, Original e Will continuam com a sigla. Conferir no celular. Banco novo: subir o arquivo com o nome da chave (`LEIAME.md` da pasta).
- [ ] **Subcategoria sob a principal + selo do banco** (#78, mesclado em 29/10, pedido do dono em 29/10/2026). Conferir no celular: Reembolso logo abaixo da categoria-mãe dele (Salário) e o selo da Caixa em Contas, Conferir, Início e Lançamentos. Se quiser o **logo oficial** (arquivos licenciados seus) ou **escolher o banco** em vez de depender do nome, é PR à parte (coluna + migration, fluxo de produção).
- [ ] Menu "Mais" com cartões de atalho e frase em cada tela (#75, mesclado; opção A do dono). Conferir no iPhone. Sem mudança de versão: entra na próxima edição (2026.5) junto com o próximo lote visível.

- [ ] **Formulário de lançamento em visual de app** (#76, mesclado; pedido do dono): abas, valor grande, campos em linhas, "Registrar e lançar outro" e última conta/cartão lembrados (ideias 2, 3, 6 e 7 de [[50 - Ideias e comparações]]; conta principal na versão "lembrar a última usada", sem banco). Conferir no iPhone a linha da **data**: o iOS escreve a data por extenso e pode não caber.
- [ ] **Fatura do cartão como extrato** (PR de rascunho, pedido do dono: o nome da compra aparecia cortado em "Vi…" depois do ícone do #72): agrupada por dia, nome inteiro, categoria embaixo, botões compactos. Conferir no iPhone.
- Próximo do mesmo pacote (só com autorização): grade de categorias com ícone, botão "+" flutuante, pré-preencher pela URL (atalho do iPhone nível 1).

## Cartão: antecipar parcelas (pedido do dono em 28/10/2026, para depois)
- Hoje não dá para **antecipar** parcelas de uma compra parcelada (pagar antes ou pedir a antecipação ao banco). Alguns cartões dão **desconto** na antecipação.
- A pensar antes de implementar: as parcelas antecipadas entram em qual fatura; o desconto vira abatimento da despesa (a despesa da compra diminui) e em qual mês; o limite libera na hora; precisa de migration (função nova no banco, com teste pgTAP) e passa pelo workflow de produção.

## Banco (baixo risco, não bloqueiam)
Idempotência com conteúdo diferente · `debt_chk` quadrático · `card_months` com data futura · "Conferido" de transferência · estorno em mês diferente · trava de reclassificar categoria.

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
- **Aplicar a 046** (parcela de dívida como despesa do mês, #137) depois do merge, com simulação, log e o "pode" do dono. Depois: escolher a categoria da parcela em cada dívida (Dívidas).
- **Atenção a lançamento duplicado:** quem já lançou a parcela à mão como despesa (além da baixa em Dívidas) vai ver a parcela contada duas vezes; excluir o lançamento manual.
