---
tags: [tudo-azul, seguranca]
---
# Segurança

- **Isolamento por família**: RLS em todas as tabelas + chaves compostas (nunca referencia dado de outra família). Testado com dados de duas famílias (auditoria: nenhum vazamento).
- **Chaves**: o front só aceita a *publishable key*; chave secreta é recusada, com teste. `service_role` e senhas nunca entram em chat nem no repositório.
- **Convites**: o token aparece uma vez; no banco só o hash (SHA-256). Convite expira em 7 dias, é por e-mail e respeita o limite de membros.
- **Funções SECURITY DEFINER**: `search_path` fixo, checagem explícita de dono/membro, EXECUTE só para usuários logados (anon sem acesso a nada).
- **Bypass controlado por RPC** (padrão desde a 017): quando uma coluna protegida por gatilho precisa mudar por um caminho só, a RPC (SECURITY DEFINER) liga uma marca de sessão com `set_config('app.<marca>', 'on', true)` em volta do UPDATE e desliga ao sair; o gatilho lê `current_setting('app.<marca>', true)` e aceita **só aquela coluna, naquele tipo de linha**. O cliente não alcança `set_config` (PostgREST só expõe funções do schema `public`). Marcas: `app.card_edit` (valor da parcela, 017), `app.recurrence_category` (044), `app.service_read` (050), `app.debt_anchor_edit` (051) e `app.card_credit_category` (categoria do crédito avulso, 077, #202). O teste de cada uma prova que, com a marca ligada, as outras colunas continuam recusadas.
- **Ações destrutivas**: "Zerar tudo" só o dono; conta não é apagada (só desativada).
- **Dependências**: `npm audit --omit=dev` em zero; o CI barra qualquer vulnerabilidade de produção.
- **GitHub Actions** (#195): os segredos de produção (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`) ficam só no `env:` dos passos que falam com o Supabase, nunca no `env:` do job; checkout com `persist-credentials: false`; toda action fixada por SHA de commit com a tag no comentário, atualizada pelo Dependabot (semanal, 7 dias de espera); a CLI do Supabase com versão fixa nos testes (nunca `latest`). Workflows com `permissions: contents: read`. Para conferir: `actionlint` e `zizmor` rodados fora do projeto (sem dependência nova).
- **Diagnóstico em produção sem valores**: toda mensagem que sai do banco de produção para um log — `raise exception` numa simulação (transação desfeita), `raise notice`, saída de workflow — leva só **tempos, contagens e booleanos**; nunca valor em dinheiro, descrição, nome, e-mail, data de lançamento nem id. O mesmo vale para o Sentry (#193: só o nome da consulta e o código do erro).

## Ponto em aberto
Aceitar convite **sem e-mail confirmado** depende da configuração do Supabase de produção. Conferir em *Authentication → Providers → Email → Confirm email* ([[40 - Pendências e próximos passos]]).

## Revisão do Security Advisor (09/11/2026)
- **69 funções `SECURITY DEFINER` executáveis por `authenticated`:** avisos conhecidos e aceitos. Decisão e motivo em `30 - Decisões` (mesma data). Não há revogação em massa.
- **Proteção contra senhas vazadas:** desativada. Depende do plano Pro; no plano atual, a alternativa é exigir senha mais longa e caracteres variados em *Authentication*.
- **Ponto em aberto:** conferir as configurações de *Authentication* em produção (troca de senha segura, exigir senha atual e troca de e-mail segura).

## Revisão geral (09/11/2026)
- **Headers de segurança no Vercel** (`vercel.json`, toda resposta): `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Permissions-Policy`, HSTS e uma **CSP em modo relatório** (`Content-Security-Policy-Report-Only`).
  Em relatório nada é bloqueado; serve para ver no console do navegador o que a CSP real barraria. Trocar para
  `Content-Security-Policy` só depois de uma semana sem violação legítima (decisão do dono). Teste: `vercelConfig.test.ts`.
- **Volta depois do login** (`src/lib/destinoSeguro.ts`): o destino guardado pela rota protegida só é aceito se for caminho
  interno (`/…`, nunca `//…` nem `https://…`). Fecha um open redirect possível via `state.de`.
- **Workflow `supabase-local-validation.yml`** passou a pinar as actions por SHA e a CLI em `2.122.1`, como os outros.
- Sem segredo nem dado real no repositório; só a publishable key, a URL do Supabase e o DSN do Sentry vão ao cliente;
  Sentry sem PII, sem Replay, URLs sem query; service worker não cacheia o Supabase.
