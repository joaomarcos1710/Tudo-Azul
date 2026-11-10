# Diagnóstico técnico preliminar de privacidade e adequação LGPD

**Repositório:** `joaomarcos1710/Tudo-Azul`  
**Base examinada:** `main` em `d318e4f7e8e44846575e3bf9cf54919cdd4473b3`  
**Branch deste documento:** `docs/lgpd-diagnostico-plano-2026`  
**Escopo desta entrega:** diagnóstico documental e plano de execução. Não implementa controles em produção, não altera banco hospedado e não declara conformidade jurídica.

## 1. Decisões de produto registradas

- **Natureza:** projeto pessoal agora, preparado para futura exploração comercial.
- **Público:** uso familiar por convite e cadastro autônomo de novos usuários.
- **Documentação:** modelo híbrido. Documentos e controles próprios do Tudo Azul, usando iubenda como referência funcional e avaliando contratação de módulos/serviços quando houver benefício concreto.
- **Governança:** mudanças por branch e PR; migrations apenas versionadas e testadas; nenhum deploy, alteração de segredo ou mudança no Supabase hospedado nesta etapa.

## 2. Resumo executivo

O repositório já contém controles técnicos úteis, especialmente autenticação Supabase, exclusão de conta via função server-side, minimização de dados no Sentry e separação entre dados financeiros da família e o acesso individual. Porém, os controles examinados ainda não formam um programa de privacidade completo e verificável.

**Bloqueadores antes de abrir cadastro público ou comercializar:**

1. Identificar formalmente quem será controlador, operador e encarregado/canal de privacidade em cada fluxo. O papel pode variar entre o serviço Tudo Azul e a família que insere dados de terceiros.
2. Inventariar todos os dados, finalidades, bases legais, destinatários, subprocessadores, locais de tratamento e prazos de retenção.
3. Publicar documentos coerentes com a operação real, incluindo política de privacidade, termos de uso, aviso de compartilhamento familiar e informações de transferências internacionais.
4. Implementar registro verificável das versões aceitas dos termos e avisos, sem transformar consentimento em base legal universal.
5. Criar fluxo autenticado e rastreável para solicitações de titulares, incluindo acesso, correção, exportação, oposição/revogação quando aplicável e exclusão.
6. Fechar a política de retenção, exclusão, backups, logs e dados compartilhados antes de prometer eliminação integral.
7. Fazer revisão de segurança e privacidade do painel ToolJet e de qualquer fluxo de IA antes de enviar dados reais.

## 3. Evidências técnicas examinadas

| Área | Evidência observada | Leitura preliminar |
|---|---|---|
| Cadastro | `src/pages/auth/Cadastro.tsx`, blob `c9892824897d44754176e7f84217a1d007eba068` | Coleta nome, e-mail e senha e chama Supabase Auth. Não há aceite de Termos/Política nem registro de versão no formulário examinado. |
| Rotas | `src/App.tsx`, blob `dedd5ce0ec2bba1078bbdc054f90218eb378229b` | Rotas de cadastro, login, convite, família, preferências e exportação existem. Não foi identificada rota pública de documentos legais ou central de privacidade neste arquivo. |
| Preferências e exclusão | `src/pages/Preferencias.tsx`, blob `613aeea3fbf5ac45248d6d82231a9e7d0caf7761` | Preferências pessoais e exclusão de conta existem. A interface informa que dados financeiros compartilhados permanecem após a remoção do acesso pessoal. Não é um fluxo completo de direitos LGPD. |
| Exclusão de conta | `supabase/functions/delete-account/index.ts` | Função server-side valida o usuário e executa exclusão Auth com lógica para proteger o histórico financeiro compartilhado. A preservação pode ser legítima em alguns contextos, mas exige política de retenção, justificativa, transparência e revisão jurídica. |
| Família e convites | `src/pages/Familia.tsx`, blob `a887734c2f5dd44b16c8ecdf57e86b55a8295f94`; `src/pages/Convite.tsx`, blob `fa69458864b179f4db6d6678a721f86d26badf83` | Convites por e-mail/link, com validade de sete dias e uso único; o aceite requer conta com o mesmo e-mail. O compartilhamento de dados financeiros entre membros precisa ser explicado antes do ingresso e permanecer visível depois. |
| Monitoramento | `src/lib/monitoramento.ts`, blob `e0c5c893461ed98307fc0d2d67cdba01cad33c61` | Sentry é inicializado em produção quando há DSN; há filtros de dados, remoção de usuário/extras, limpeza de URLs e amostragem de tracing de 20%. A filtragem é uma salvaguarda, não prova de ausência de dados pessoais. |
| PWA/cache | `public/sw.js`, blob `906f4901e5bf12cbc965788108226bffb291cf2b` | A estratégia declarada evita cache de dados Supabase e mantém recursos do app. Precisa validar também storage do navegador, cache HTTP, notificações e dados offline. |
| Fontes externas | `index.html`, blob `dbfeb8c475817412469bc6a2f3990ea16d738f79` | Carrega Google Fonts. Deve constar do inventário de terceiros e ser avaliado quanto a requisições, metadados e alternativa auto-hospedada. |
| Supabase no cliente | `src/lib/supabase.ts`, blob `804a5e83dd785cc3555dbfd844995ef72c94e560` | Usa publishable key e bloqueia prefixo de secret key no navegador. A proteção dos registros depende de RLS, privilégios e funções do banco. |
| Painel administrativo | PR #214, branch `feat/tooljet-admin-2026-214`, SHA `fee9fa15ab07e45b7986684701d4ef5c0460f5a4` | PR informa API administrativa somente leitura planejada, ainda sem implantação, conexão com dados reais, rate limit distribuído, trilha de auditoria e testes específicos. Deve continuar bloqueada para dados reais até fechar esses itens. |
| IA | PR #207, branch `feat/smart-transaction-ai-2026-207`, SHA `fc14bf3f76e49c5f31a6d52d5d2efd58c7e8bdac` | PR descreve envio de texto de lançamento para OpenRouter para extração. Antes de ativar, mapear conteúdo enviado, retenção/uso pelo fornecedor, região, contrato, base legal e aviso específico. |

**Limite da auditoria:** esta é uma leitura dirigida dos arquivos e PRs listados, não um inventário completo do repositório, banco, configurações de fornecedores ou ambiente hospedado. Nenhuma conclusão de ausência foi inferida apenas porque um termo não apareceu em busca de código. As migrations, políticas RLS, funções SQL, buckets/storage, triggers, secrets, logs e configurações dos fornecedores ainda precisam de inspeção sistemática.

## 4. Mapa de tratamento a completar

| Fluxo | Dados prováveis já visíveis no produto | Perguntas/evidências pendentes |
|---|---|---|
| Conta e autenticação | Nome, e-mail, credenciais geridas pelo Supabase, identificadores de usuário | Dados de Auth, logs, recuperação, confirmação, retenção e subprocessadores. |
| Família | Nome da família, membros, papéis, e-mails de convite, token/estado/expiração | Quem decide finalidade e acesso; dados de terceiros incluídos pelos membros; transparência e remoção de membro. |
| Finanças | Contas, saldos, transações, cartões, dívidas, investimentos, bens, categorias e anexos se houver | Inventário coluna a coluna, classificação, minimização, acesso, exportação e retenção. Dados financeiros não são automaticamente dados pessoais sensíveis na definição legal, mas são de alto impacto e exigem proteção reforçada pelo risco. |
| Preferências | Preferências de exibição e configuração | Separação entre preferências e consentimentos jurídicos; retenção após exclusão. |
| Monitoramento | Eventos de erro, breadcrumbs, traces e metadados de navegação | Payload real por SDK/versão, região, retenção, acesso, contrato e transferência internacional. |
| E-mail e convites | E-mail de conta e destinatário do convite | Provedor de envio, conteúdo, logs, retenção, opt-out e compartilhamento. |
| IA | Texto digitado e contexto encaminhado para extração | Campos exatos enviados, fornecedor/modelo, retenção, treinamento, região, suboperadores e mecanismo de transferência. |
| Administração | Dados agregados e possivelmente dados de usuários via API administrativa | Acesso humano, finalidade, logs, segregação, exportação, retenção e autenticação forte. |
| Web/PWA | IP e metadados de requisição, fontes externas, storage local, service worker | Cookies, localStorage/sessionStorage, IndexedDB, analytics, pixels, SDKs e headers reais. |

## 5. Arquitetura documental híbrida

1. **Documentos próprios:** Política de Privacidade, Termos de Uso, Aviso de Compartilhamento Familiar, Política de Cookies/tecnologias equivalentes (se aplicável), Política de Retenção e Exclusão e página de Segurança/Transparência.
2. **Iubenda como referência/serviço opcional:** avaliar gerador e gestão de documentos, consentimento e registro de preferências. Não copiar textos proprietários nem integrar scripts antes de inventariar os rastreadores reais e revisar contratos, subprocessadores, região e transferência.
3. **Fonte normativa:** textos e orientações oficiais da LGPD e ANPD prevalecem sobre modelos comerciais. Os documentos devem refletir o comportamento real do produto.
4. **Conteúdo versionado:** documentos no repositório com identificador de versão, data de vigência, changelog e revisão jurídica registrada. A versão publicada deve ser a mesma registrada no aceite.

## 6. Plano de implementação no GitHub

### Fase 0 — Inventário e decisões (pré-requisito)
- Mapear tabelas, colunas, views, RPCs, triggers, Edge Functions, storage, RLS, grants e dados de Auth.
- Mapear todos os SDKs, domínios externos, cookies, local/session storage, IndexedDB, service worker, logs e analytics.
- Inventariar fornecedores e subprocessadores: Supabase, Vercel, Sentry, Google Fonts, provedor de e-mail, OpenRouter e ToolJet, confirmando quais estão realmente ativos.
- Criar matriz de dados: categoria, titular, origem, finalidade, base legal candidata, necessidade, destinatários, país/região, retenção, controle e evidência.
- Definir o modelo de papéis por fluxo: não presumir que o fornecedor Tudo Azul é sempre operador ou que o usuário familiar é sempre controlador. Validar com assessoria jurídica.

### Fase 1 — Fundamentos e transparência
- Adicionar rotas públicas de documentos e links no cadastro, login, convite e rodapé.
- Implementar aviso claro de compartilhamento familiar antes do aceite do convite.
- Separar aceite dos Termos/ciência da Política de tratamentos necessários de consentimentos opcionais.
- Criar registro append-only de aceite: user_id, documento, versão, hash, timestamp, origem e evidência mínima. Não registrar senha, token de convite ou conteúdo financeiro.
- Tratar mudança material de finalidade/termos com nova comunicação e, quando necessário, novo aceite.

### Fase 2 — Central de Privacidade
- Criar área autenticada para consultar dados básicos e documentos vigentes.
- Solicitação de acesso/cópia e exportação legível dos dados pessoais.
- Correção de dados de perfil e canal de solicitação para dados não editáveis diretamente.
- Solicitação de exclusão, anonimização, bloqueio ou oposição, com avaliação de retenção legal/contratual e preservação legítima de registros compartilhados.
- Revogação de consentimentos opcionais e preferências de cookies, se houver tecnologias não essenciais.
- Protocolo, status, prazos, trilha de auditoria e resposta ao titular. A interface não deve prometer exclusão total quando backups ou obrigações de retenção impedirem isso.

### Fase 3 — Segurança e governança
- Revisar RLS, grants e todas as funções SECURITY DEFINER; confirmar menor privilégio e isolamento entre famílias.
- Fechar controles do ToolJet antes de qualquer acesso a dados reais: autenticação, rate limit, auditoria, testes de autorização, segregação, minimização e política de retenção.
- Revisar Sentry e demais SDKs com payloads reais de teste e política de retenção.
- Definir processo de incidentes, avaliação de risco, contenção, registro e comunicação conforme regras aplicáveis.
- Definir retenção por classe de dado, descarte seguro, cópias de segurança e prova de execução.

### Fase 4 — Fornecedores e transferências internacionais
- Obter DPA/termos de tratamento e lista de subprocessadores de cada fornecedor ativo.
- Confirmar localização de dados primários, backups, logs, suporte e telemetria.
- Identificar transferências internacionais e adotar mecanismo válido nos termos da LGPD e Resolução CD/ANPD nº 19/2024, com transparência em português.
- Registrar finalidade, categorias de dados, países, destinatários, salvaguardas e canal de direitos.

### Fase 5 — Validação e abertura pública
- Testes automatizados de aceite/versionamento, revogação, exportação, exclusão, retenção e isolamento familiar.
- Testes negativos de autorização e de acesso cruzado entre famílias.
- Verificação de cookies/storage e chamadas externas em navegador limpo e autenticado.
- Revisão jurídica dos documentos e dos papéis de tratamento.
- Checklist de lançamento público: documentos publicados, canal de privacidade funcional, fornecedores aprovados, controles de segurança e resposta a incidentes testados.

## 7. Critérios de aceite e governança

- Cada fase em PR independente, preferencialmente pequena e reversível.
- PR permanece Draft até revisão técnica e jurídica do escopo correspondente.
- Toda revisão de segurança vinculada ao SHA exato; novo commit invalida a aprovação anterior.
- CI obrigatório: typecheck, testes unitários, build, testes de integração de banco e auditorias de schema/RLS/grants.
- Migrations somente em branch, com testes locais e revisão da ordem; nunca aplicar diretamente no Supabase hospedado nesta iniciativa.
- Nenhuma chave, token, payload financeiro real ou dado pessoal de produção em fixtures, logs ou documentação.
- Feature flags e rollout gradual para funcionalidades que alterem coleta, consentimento ou exclusão.
- Não usar uma caixa de “aceito tudo” como solução universal. Cada finalidade deve ter base legal adequada e escolha livre quando consentimento for a base escolhida.

## 8. Pendências que exigem decisão do responsável e validação jurídica

1. Qual pessoa jurídica ou pessoa natural será responsável pelo serviço quando houver comercialização? País de estabelecimento e canal público de contato.
2. O Tudo Azul será destinado exclusivamente a maiores de 18 anos?
3. Haverá cobrança, publicidade, marketing, perfilamento ou compartilhamento com parceiros?
4. Quais fornecedores estarão efetivamente ativos no lançamento público, inclusive e-mail, analytics, IA, suporte e administração?
5. Qual será a política de retenção para dados financeiros compartilhados após saída/exclusão de membro, encerramento de família e encerramento de conta?
6. Qual canal oficial receberá solicitações de privacidade e incidentes?

## 9. Conclusão

O produto tem uma base de segurança útil, mas a adequação jurídica está **em diagnóstico**, não concluída. A prioridade é fechar o inventário técnico e a matriz de tratamento antes de escrever textos definitivos ou adicionar banners/checkboxes. A implementação deve seguir o fluxo real dos dados e preservar a integridade do histórico financeiro familiar.

**Nota:** este documento é um artefato técnico de engenharia e governança, não parecer jurídico. A classificação das bases legais, papéis de controlador/operador, retenção e transferências deve ser validada por profissional habilitado em proteção de dados antes do lançamento comercial.
