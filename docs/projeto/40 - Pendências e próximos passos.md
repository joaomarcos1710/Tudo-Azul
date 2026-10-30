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
- [ ] **Recorrentes: horizonte de geração** (30/10/2026, o dono notou que só duram 2 meses): hoje `recurrence_materialize` gera até o fim do mês daqui a 2 meses. Proposta aguardando decisão: regra com data final gera até o fim (máx. 360 meses), sem data final 12 meses. Pode virar a tela de Empréstimos/Financiamentos no futuro.
- [x] **Arquivar/excluir cartão e conta** (migrations 020 e 021, #88 e #89): feito e aplicado em 30/10/2026. Falta o dono conferir no app: o cartão de exemplo que não deixa excluir (ler a mensagem nova, que diz o que existe) e decidir se a exclusão deve valer quando só sobram registros anulados.
- [ ] **Testes pgTAP que dependem da data de hoje** (A1 `12_card_correcoes` linhas 89-92 e demais `'2026-12-31'`; A2 `22_recurrence_frequency` RF3-RF9c): quebram a partir de 01-02/01/2027.
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
