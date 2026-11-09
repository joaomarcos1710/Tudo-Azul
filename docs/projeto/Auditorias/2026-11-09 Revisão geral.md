---
tags: [tudo-azul, auditoria, revisao]
data: 2026-11-09
---
# Revisão geral de 09/11/2026

Pedido do dono: "revise o projeto inteiro, verifique falhas e possíveis melhorias". Base: `main` em `1bea378` (versão
2026.242). Quatro leituras independentes, somente leitura, sem tocar em produção: **dinheiro** (front e libs), **banco**
(grants, RLS, definers, guards, índices), **front** (celular, erros, acessibilidade, código morto, PWA) e **segurança e
operação** (segredos, env, auth, Sentry, workflows, headers, dependências). Mais as checagens mecânicas: suíte Vitest
(965 testes verdes), build de produção ok, `npm audit` sem vulnerabilidade, typecheck limpo.

Números do projeto: ~19,7 mil linhas de front em 111 arquivos (75 de teste), 93 migrations, 89 arquivos pgTAP.
Ritmo dos últimos 7 dias: 110 PRs e 59 migrations mergeadas. Doc 40 com 198 pendências abertas (126 só em
"Próximos PRs sugeridos").

## O que foi corrigido nesta revisão (PRs em rascunho, merge com o "pode")

| PR | O quê | Gravidade |
|---|---|---|
| #244 | **Preferências e aviso diário nunca salvaram em produção** (42501 no `upsert`: faltava `UPDATE (user_id)`). Migration 080 + pgTAP 85, que falha sem ela (9 de 11). As duas tabelas estavam vazias em produção. Falta aplicar pelo workflow. | Alta |
| #245 | Headers de segurança no Vercel (nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy, HSTS, **CSP em modo relatório**); **open redirect** depois do login fechado (`destinoSeguro`); workflow `supabase-local-validation` pinado por SHA. Testes nos três. | Média |
| #243 | Ideia 03 (aviso de autoria), primeira da pasta `docs/ideias` colocada em prática. | — |

## Achados por área

### Dinheiro (front e libs)
1. **ALTA, latente** — `net_worth_with_assets` e `private.family_assets_brl` não arredondam (`sum(total_value × household_share / 100)`). Um bem de R$ 1.000,01 com 50% devolve 500,005; `centsFromDb` recusa mais de 2 casas e **lança**: o cartão de patrimônio some e a evolução de 12 meses falha inteira. Hoje não dispara (1 bem em produção, participação com 2 casas), mas é um contrato quebrado. **Correção:** migration com `round(…, 2)` nas duas funções + pgTAP com 1.000,01 × 50%. Nenhum teste atual pega (todos usam 10.000 × 50%).
2. **MÉDIA** — `Orcamentos.tsx:136-138` soma Orçado/Gasto/Saldo no navegador (`reduce`), contra a regra 2; categoria presente em `budget_projection` e ausente em `budget_usage` entra com `restante = 0`, e o "Saldo" deixa de ser Orçado − Gasto. O teste atual consagra a soma. **Correção:** total vindo de `budget_usage`/`budget_projection` (como `cash_flow_report.total_income`).
3. **MÉDIA** — `Bens.tsx:29` calcula "Parte familiar" em ponto flutuante (`Math.round(valor × participação / 100)`), fórmula diferente da do banco; sem teste. **Correção:** o banco devolver `household_value` por bem.
4. **MÉDIA/BAIXA** — `contas.ts:277` soma saldo diário no front; hoje é código morto (a RPC já agrupa por dia), mas é um `+` de dinheiro escondido. **Correção:** remover e lançar erro se vier chave repetida.
5. **BAIXA** — `Cartoes.tsx:1826` soma três agregados só para um aviso; `format.ts:50`, `Investimentos.tsx:37-41`, `Bens.tsx:19` usam `cents / 100` só para exibição e duplicam `formatMoeda`; `Bens.tsx:29`, `Investimentos.tsx:405,652` formatam data via `Date` local em vez de `formatDate`.
6. **Conferido e sem achado:** `centsToDecimal` em toda escrita e `centsFromDb` em toda leitura; resto do parcelamento na 1ª parcela (testado); pagamento de fatura não duplica compra; `hojeSP`/`Date.UTC` nas datas; moedas separadas em todas as telas.

### Banco
1. **ALTA (corrigida na #244)** — grant de coluna × `upsert` do front em `user_preferences` e `daily_digest_settings`.
2. **OK** — as outras 7 tabelas em que o front grava direto (`transactions`, `accounts`, `categories`, `budgets`, `account_tags`, `household_people`, `reserves`) têm todas as colunas cobertas pelo grant mais recente. Funções `SECURITY INVOKER` que gravam (`record_reserve_*`, `account_tags_set`, `transactions_bulk_*`) também.
3. **OK** — RLS ligada nas 31 tabelas, todas com policy de select filtrando por `is_member`/`auth.uid()`; `currencies` e `fx_rates` abertas de propósito (referência global).
4. **OK** — 94 funções `SECURITY DEFINER`, todas com `set search_path = ''`; as que recebem `household_id` checam `is_member`/`is_owner`; as sem checagem são só para `service_role`.
5. **OK** — 7 marcas `app.*` de bypass, todas ligadas só dentro de função definer (a única em invoker, `app.service_read`, exige `service_role`). `00_audit` cobre todas as funções criadas desde 07/11.
6. **MÉDIA (desempenho)** — FKs sem índice: `reserve_allocations.linked_transaction_id` (a trigger de `transactions` faz seq scan a cada UPDATE/DELETE), `debt_events.invoice_id`, `category_id` em `debt_events`/`debt_installments`/`recurrences`; front filtra `debt_events` só por `debt_id` sem `household_id` (`cartoes.ts:442,615,633`), desperdiçando os índices que começam por `household_id`. **Correção barata:** acrescentar `.eq('household_id', …)` no front; índices em migration nova.
7. **BAIXA** — `reserves_update` exige `created_by = auth.uid()` (só quem criou edita); confirmar se é intenção e registrar em "30 - Decisões".

### Front
1. **MÉDIA** — erros engolidos: `auth.tsx:22-24` (`getSession` sem catch: app pode ficar em "Carregando…" para sempre), `Lancamentos.tsx:181,207-216` (cartões, parcelas de dívida e créditos somem da lista sem aviso), `Calendario.tsx:72-78,309-314` (faturas e saldo previsto somem em silêncio), `Lancamentos.tsx:65-72` e `Relatorios.tsx:31-39` (`error` da preferência descartado). Padrão certo já existe: `opcional()` + `registrarFalhaConsulta` em `VisaoGeral`.
2. **MÉDIA** — modais sem Esc, sem foco inicial e sem prender Tab: `PessoasFamilia.tsx:167`, `Preferencias.tsx:155,171` (os dois destrutivos). `useFocoPreso` já existe e é usado em `Folha` e no lançamento.
3. **MÉDIA** — código morto: `src/lib/periodos.ts` (298 linhas, módulo inteiro sem uso fora do teste, com 3 correções recentes), `components/ZerarTudo.tsx` (125), `ui/SeletorMes.tsx`, `pages/PaginaBase.tsx`, `listarPessoasAtivas`. Duplicados: nome curto do mês em 5 lugares (com capitalização divergente entre dois gráficos), `somarDias`/`diasEntre`/`diasNoMes` repetidos, "hoje em SP" em 3 Intl diferentes.
4. **MÉDIA** — `public/sw.js`: `VERSAO` fixa + cache-first de `/assets/*` → bundles antigos nunca saem do cache do celular; navegação com corrida de 4 s pode entregar `index.html` velho apontando para chunk apagado (mitigado por `importarComRecarga`); `skipWaiting` sem aviso de "nova versão".
5. **BAIXA** — celular: nenhum outro `min-w` fixo estourando; tabelas de Relatórios em 11px com rolagem interna; alvos de toque menores que 44px em `PessoasFamilia.tsx:146` e no checkbox de `Dividas.tsx:572`.
6. **Tamanho** — `Cartoes.tsx` (2022 linhas) e `Lancamentos.tsx` (1262): blocos extraíveis sem mudar comportamento listados no relatório do agente (formulários do cartão ~430 linhas, painéis da fatura ~165, `PaginaFatura` ~450; `FormLancamento` ~500, lista por dia ~105).
7. **Positivo** — acessibilidade geral boa: `alt` em todas as imagens, sem `onClick` em div, inputs com label, sinal "−" além da cor.

### Segurança e operação
1. **Sem segredo nem dado real** no repositório; `.env*` ignorados; só URL do Supabase, publishable key e DSN do Sentry vão ao cliente.
2. **MÉDIA (corrigidas na #245)** — ausência total de headers de segurança no Vercel; open redirect via `state.de`; workflow sem pin de SHA e CLI `latest`.
3. **MÉDIA-BAIXA, decisão do dono** — `delete-account` cai em CORS `*` sem `APP_ORIGIN` (confirmar a variável no painel); `supabase.ts` recusa `sb_secret_` mas não JWT legado `service_role`; `supabase-local-validation.yml` duplica `db-tests.yml` e tem gatilho em branch morta (remover?).
4. **OK** — Sentry sem PII, sem Replay, sem console breadcrumbs, URLs sem query, `tracePropagationTargets: []`; falta só `beforeSendTransaction` para spans (baixa). Workflows principais com permissões mínimas, SHA pinado, segredos por passo. Service worker não cacheia o Supabase.
5. **BAIXA** — Dependabot só cobre GitHub Actions, não `npm` (dev-deps como vite/vitest nunca recebem PR automática); 3 PRs do Dependabot abertas desde o início (#197, #198, #199) sem decisão.

## Processo e manutenção
- **59 migrations em 7 dias** e a regra "nunca editar migration aplicada" explicam o histórico divergente que travou a produção hoje (reparado pelo modo `reparar`). Sugestão: antes de abrir PR com migration, rodar `simular` numa branch e colar o log na PR.
- **Doc 40 com 198 pendências**: a seção "Próximos PRs sugeridos" (126 itens) virou lista de desejos. Sugestão: mover para `docs/ideias` ou arquivar o que tem mais de 30 dias sem dono.
- **Sem medição de cobertura** de testes. A suíte é grande (965 testes), mas não há como saber o que não está coberto. Sugestão: `vitest --coverage` no CI, só para leitura, sem barrar PR.
- **PRs abertas do dono sem movimento**: #207 (IA), #214 (ToolJet), #228 (LGPD), #229 (landing). Decidir: fechar, retomar ou marcar como ideia.

## Decisões que ficam com o dono
1. Aplicar a migration 080 (#244) em produção: `simular` → log → `APLICAR`.
2. Trocar a CSP de relatório para bloqueio depois de uma semana sem violação.
3. Remover ou manter `supabase-local-validation.yml`.
4. `APP_ORIGIN` da Edge Function `delete-account` no painel do Supabase.
5. Migration de arredondamento do patrimônio (achado Dinheiro 1) e total de orçamento no banco (Dinheiro 2): autorizar as PRs.
6. Ideias 01, 02, 04 e 06 têm perguntas abertas nas próprias notas; sem resposta, não foram implementadas.

## O que ficou de fora
- Leitura foi estática nos quatro eixos; só o achado do `upsert` foi reproduzido com teste real. O achado do patrimônio foi
  confirmado por leitura das funções em produção (não arredondam), não por um caso de dado.
- Não conferi o painel do Supabase (Redirect URLs, `APP_ORIGIN`, proteção de senha vazada) nem o do Vercel.
- Não avaliei a prosa dos ~40 docs, só padrões (segredo, e-mail, CPF).
- Não testei visualmente em celular as telas apontadas.
