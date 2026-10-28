---
tags: [tudo-azul, pendencias]
atualizado: 2026-10-27
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
1. ~~**Início × Análises**~~ — feito (#57).
2. Front: atualizar faturas antes de abrir Relatórios e Orçamentos.
3. Front: mostrar conta desativada com saldo na Visão geral.
4. Docs: README/PLANO/MODELO desatualizados (ex.: "compra no cartão é despesa na data da compra"; vale a data de fechamento).
5. **Tailwind 4** (PR próprio, revisão visual).

## Períodos financeiros (aprovados por etapa, sem pular)
- **PR 1 (mesclado, #58):** só a função pura de intervalos e testes (`src/lib/periodos.ts`), sem efeito visível. Próximas etapas (preferência da família, seletor, Lançamentos, Início/Análises, exportação, personalizado) só com a sua autorização de cada uma.

## Recorrência com frequência
- [ ] **PR do banco (migration 016)**: revisar, mesclar e aplicar em produção pelo workflow (simular → ler o log → aplicar).
- [ ] **PR do app** (aberto em rascunho): escolher a frequência no cadastro, data final opcional, prévia das próximas datas. Só mesclar **depois** da 016 aplicada em produção.
- [ ] Conferir no app, depois dos dois merges: cadastrar uma quinzenal e a PLR anual de teste e ver os planejados em Lançamentos e no Calendário.
- Depois (só com autorização): "mudar frequência" numa ação só (encerra a regra e cria outra).

## Banco (baixo risco, não bloqueiam)
Idempotência com conteúdo diferente · `debt_chk` quadrático · `card_months` com data futura · "Conferido" de transferência · estorno em mês diferente · trava de reclassificar categoria.

## Roadmap
Dez–Jan multimoeda · Fev–Abr/2027 investimentos · importar do Organizze (volta ao Brasil) · domínio · planos pagos (limite de membros 1/3/5–10).

## PRs abertos
Nenhum em 27/10/2026. As propostas de multimoeda (#10) e de importação do Organizze (#9) estão na `main` como histórico, com nota de status: revalidar antes de implementar.

## Ideias guardadas
Lixeira completa · aviso de nova versão do PWA · atualizar ao voltar ao app · foco/rolagem nos formulários · contraste · taxa de poupança e meses de reserva · metas com prazo (junto com investimentos) · detector de recorrência (depois da importação).

## Redesenho visual (design system)
- [ ] **Parte 1** (PR em rascunho): padding dobrado nos painéis, mês com maiúscula certa, lista de Lançamentos compacta, ações rápidas com ícone, contorno de campos com contraste. Conferir no celular e no iPad depois do merge.
- Próximas partes (só com a sua autorização): cabeçalho padrão de tela com ações à direita; ícone de categoria nas listas; seletor de mês em painel próprio; Cartões com a fatura em destaque; formulário de lançamento em folha no celular.

## Do protótipo do Base44
- [ ] **Calendário do mês** (#62, mesclado em 28/10): conferir no celular e no iPad.
- Ainda não feitos (só com a sua autorização): destaques do mês e comparativo por categoria em Análises.
