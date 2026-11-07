# Painel administrativo Tudo Azul com ToolJet

## Objetivo

Criar um painel administrativo interno, separado do aplicativo financeiro familiar. O Tudo Azul continua sendo a aplicação principal em React, TypeScript e Supabase. O ToolJet será usado para suporte, diagnóstico e acompanhamento operacional, começando em modo somente leitura.

Documentação técnica consultada:
- [ToolJet REST API datasource](https://docs.tooljet.ai/docs/beta/data-sources/restapi/)
- [ToolJet REST API authentication](https://docs.tooljet.ai/docs/beta/data-sources/restapi/authentication/)
- [ToolJet authentication and access control](https://docs.tooljet.ai/docs/user-management/authentication/self-hosted/overview/)
- [Supabase Edge Function authorization headers](https://supabase.com/docs/guides/functions/auth-headers)
- [Supabase Edge Functions and Auth](https://supabase.com/docs/guides/functions/auth-legacy-jwt)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)

## Diagnóstico do Supabase Tudo Azul (07/11/2026)

Projeto identificado: `Tudo Azul`, região `us-west-2`, PostgreSQL 17, status `ACTIVE_HEALTHY`.

Verificações realizadas em modo de leitura:
- As 29 tabelas do schema `public` estão com RLS habilitado.
- A tabela `private.daily_digest_log` está sem RLS, mas está no schema `private`; manter esse schema fora dos schemas expostos e não conceder acesso ao ToolJet.
- Não há Edge Functions implantadas neste projeto.
- O advisor de segurança sinalizou 69 funções `SECURITY DEFINER` executáveis por `authenticated`, e nenhuma executável por `anon`. Isso não prova vulnerabilidade: várias são RPCs usadas pelo próprio aplicativo. Porém, o ToolJet não deve receber acesso genérico a RPCs nem a essas funções.
- O advisor também sinalizou a proteção de senhas vazadas do Auth desativada. É uma melhoria recomendada, independente do painel.
- O advisor de performance listou 44 FKs sem índice de cobertura e quatro índices não utilizados. São achados de performance, não autorização para alterações automáticas.

Nenhuma migration, configuração, dado ou função foi alterada no projeto Supabase hospedado durante esta avaliação.

## Decisão de arquitetura

**Não conectar o ToolJet diretamente ao PostgreSQL, às tabelas públicas, ao Supabase Table Editor ou a RPCs financeiras.**

O ToolJet possui datasource REST com autenticação Bearer e OAuth 2.0. Entretanto, não devemos presumir que o login SSO do workspace encaminhe automaticamente um JWT Supabase individual em cada consulta REST. A integração deve usar uma camada de API administrativa explícita.

### Arquitetura inicial recomendada

ToolJet (workspace privado e acesso restrito)
→ datasource REST (HTTPS)
→ Supabase Edge Functions administrativas
→ consultas fixas e allowlisted ao banco/Auth
→ respostas minimizadas e trilha de auditoria.

Para a primeira versão, usar uma credencial de integração exclusiva, de escopo somente leitura, armazenada como segredo no datasource REST do ToolJet e como secret da Edge Function. A função deve validar essa credencial no servidor, aplicar rate limit e aceitar somente as rotas/operações predefinidas. A credencial não é a chave `service_role`, não é uma chave do banco e nunca deve ser exposta em componentes, queries client-side, variáveis públicas ou código do app.

As Edge Functions administrativas poderão usar credencial privilegiada exclusivamente no ambiente server-side quando uma consulta administrativa realmente exigir bypass de RLS (por exemplo, métricas globais ou Auth Admin). Esse acesso deve ficar encapsulado em operações fixas, com seleção explícita de colunas, sem SQL ou nomes de tabela fornecidos pelo ToolJet. Nunca retornar a credencial privilegiada.

A credencial compartilhada é aceitável apenas enquanto o workspace tiver operadores estritamente limitados. Antes de adicionar outros operadores, evoluir para identidade individual com OIDC/JWT validado no backend, autorização por grupo/claim e auditoria por pessoa. Não tratar RBAC visual do ToolJet como substituto da autorização da API.

### Regras obrigatórias

- Nunca colocar `service_role`, senha do banco ou segredo JWT em navegador, código client-side, queries ou variáveis públicas.
- Não usar `user_metadata` para autorização. Se forem usados claims Supabase, o papel deve estar em `app_metadata` e ser validado no servidor.
- Não confiar em variáveis/estados enviados pelo cliente para determinar se alguém é administrador.
- Negar por padrão: credencial ausente/inválida retorna 401; credencial válida sem permissão para uma operação retorna 403.
- Manter RLS habilitado nas tabelas públicas. O ToolJet não recebe credenciais que permitam acesso direto às tabelas.
- Não disponibilizar CRUD genérico, SQL arbitrário, execução de RPCs arbitrárias, exclusão de famílias, alteração de saldos ou operações financeiras.
- Registrar ator/identidade da integração, ação, alvo, horário, resultado e identificador de correlação. Nunca registrar tokens, senhas ou payloads financeiros desnecessários.
- Usar dados sintéticos no desenvolvimento. Não copiar dados de produção para o ToolJet.
- Restringir o workspace a operadores autorizados, exigir MFA/SSO quando disponível no plano e revisar permissões de apps, datasources e queries.
- Limitar paginação, tamanho de busca, frequência, janela de datas e campos retornados. Aplicar mascaramento de e-mails e dados pessoais.
- Não armazenar respostas sensíveis em cache persistente do app. Desabilitar exportações desnecessárias e evitar logs com conteúdo de registros.
- Usar HTTPS com verificação TLS habilitada.

## Escopo da primeira versão (somente leitura)

### 1. Visão geral
- Quantidade de famílias e usuários ativos, em métricas agregadas.
- Estado operacional das integrações e funções administrativas.
- Erros recentes agregados, sem conteúdo financeiro ou tokens.

### 2. Famílias
- Pesquisar por identificador interno ou e-mail parcialmente mascarado.
- Consultar status, quantidade de membros e datas relevantes.
- Não exibir lançamentos, saldos, cartões, investimentos, dívidas ou documentos financeiros.

### 3. Usuários
- Consultar status de autenticação, confirmação de e-mail e vínculo com família.
- Exibir identificadores internos somente quando necessários para suporte.
- Não permitir alteração de e-mail, senha, titularidade ou exclusão nesta versão.

### 4. Diagnóstico
- Consultar eventos técnicos permitidos, códigos de erro e identificadores de correlação.
- Não exibir payloads brutos que possam conter dados pessoais ou financeiros.

### 5. Auditoria
- Exibir consultas e ações administrativas, identidade da integração/operador, alvo, horário e resultado.
- A trilha de auditoria deve ser gravada no servidor e não pode ser alterada pelo ToolJet.

## Primeira implementação da API (PR #214)

Foi criada a Edge Function `admin-api` no repositório, com gateway JWT desativado apenas para esta função porque ela valida uma credencial de integração própria no código.

Rotas implementadas no código:
- `GET /functions/v1/admin-api/overview`: contagens agregadas de famílias, vínculos e perfis.
- `GET /functions/v1/admin-api/families?page=1&per_page=25&query=...`: famílias paginadas, nome, data de criação e quantidade de membros.
- `GET /functions/v1/admin-api/users?page=1&per_page=25`: usuários paginados com e-mail mascarado e estado de confirmação/banimento.

Rotas reservadas, ainda não habilitadas:
- `GET /functions/v1/admin-api/events`
- `GET /functions/v1/admin-api/audit`

As duas últimas respondem `501 integration_pending`; a interface não deve apresentar dados fictícios. A trilha de auditoria persistente, retenção de eventos, limitação de taxa distribuída e testes automatizados específicos da função ainda precisam ser implementados antes de qualquer liberação real. Não publicar esta função em produção nesta etapa.

### Segredos e cabeçalhos

Configurar no Supabase Functions Secrets:
- `TOOLJET_ADMIN_API_KEY`: segredo aleatório forte e exclusivo para a integração ToolJet.
- `SUPABASE_SERVICE_ROLE_KEY`: chave privilegiada somente server-side, necessária para as consultas administrativas.
- `TOOLJET_ALLOWED_ORIGIN`: origem exata do workspace, somente se chamadas diretas do navegador exigirem CORS.

No datasource REST do ToolJet Cloud:
- Base URL: `https://<PROJECT_REF>.supabase.co/functions/v1/admin-api`
- Cabeçalho `apikey`: publishable key do projeto (chave pública, usada pelo gateway).
- Cabeçalho `Authorization`: `Bearer <TOOLJET_ADMIN_API_KEY>`.

A função tem `verify_jwt = false` somente para permitir a credencial não-JWT do datasource. A validação obrigatória é feita no código da função. A publishable key não autoriza acesso aos dados por si só; a função usa a chave privilegiada apenas no ambiente server-side após validar o segredo da integração.

Nunca colocar o `TOOLJET_ADMIN_API_KEY` em query, componente, JavaScript ou estado client-side. Armazená-lo como segredo do datasource. Nunca colocar `SUPABASE_SERVICE_ROLE_KEY` no ToolJet.

**Importante:** o código ainda não está implantado no Supabase hospedado. Não configure o datasource apontando para produção até a revisão da PR, testes, rate limit e auditoria persistente estarem concluídos.

## Contrato inicial de API

Implementar endpoints separados, sem endpoint genérico de SQL:

- `GET /functions/v1/admin-overview`: métricas agregadas e status operacional.
- `GET /functions/v1/admin-families?query=...`: busca restrita de famílias, com paginação e campos minimizados.
- `GET /functions/v1/admin-users?query=...`: busca restrita de usuários, com e-mail mascarado e paginação.
- `GET /functions/v1/admin-events?from=...&to=...`: eventos técnicos permitidos, com janela máxima e redação de dados sensíveis.
- `GET /functions/v1/admin-audit?from=...&to=...`: trilha de auditoria paginada.

As funções devem ter contrato versionado, validação de parâmetros, limite máximo de resultados e respostas sem dados além do necessário. Não aceitar nomes de tabela, colunas, filtros SQL, nomes de RPC ou comandos arbitrários fornecidos pelo ToolJet.

A implementação deve conferir os nomes e tipos reais das colunas necessárias nas migrations e no banco. A primeira função já usa os nomes confirmados no banco (`households`, `household_members`, `profiles`) e campos minimizados. Antes de produção, criar testes para credencial ausente/inválida, acesso não autorizado, paginação fora dos limites, tentativa de injeção, vazamento de campos, rate limit e auditoria.

## Estrutura de telas ToolJet

1. **Visão geral**: cartões agregados de famílias, usuários e erros técnicos.
2. **Famílias**: pesquisa, listagem paginada e detalhe operacional minimizado.
3. **Usuários**: pesquisa e estado de autenticação.
4. **Diagnóstico**: eventos técnicos filtráveis e correlação de erros.
5. **Auditoria**: histórico de consultas e ações administrativas.

A primeira versão não terá botões de alteração ou exclusão.

## Prompt para criar o app no ToolJet

> Crie uma aplicação interna chamada “Tudo Azul | Administração”, com navegação lateral e páginas Visão geral, Famílias, Usuários, Diagnóstico e Auditoria. Use somente um datasource REST chamado Tudo Azul Admin API, com HTTPS e autenticação Bearer configurada como segredo do datasource, nunca em valores de componentes ou queries. Todas as consultas devem chamar endpoints explícitos da API, com paginação, estados de carregamento, tratamento de 401/403/429 e mensagens de erro sem dados sensíveis. Não crie conexão PostgreSQL direta, consultas SQL, CRUD genérico, chamadas RPC arbitrárias, ações de exclusão ou alteração de dados financeiros. A interface deve ser limpa, responsiva e em português do Brasil. Na Visão geral, exiba apenas métricas agregadas. Nas páginas de Famílias e Usuários, use tabelas paginadas e campos minimizados. Na página Diagnóstico, permita filtros de data e código de erro, respeitando o limite de janela retornado pela API. Na Auditoria, exiba ator/identidade, ação, alvo, horário e resultado. Se um endpoint ainda não estiver disponível, mostre estado “Integração pendente” em vez de simular dados reais.

## Workspace ToolJet Cloud confirmado

Workspace informado pelo usuário: `https://app.tooljet.ai/joao-1794089187966`.

Origem web observada para eventual configuração CORS: `https://app.tooljet.ai`. Como o domínio é compartilhado pela plataforma, CORS não deve ser tratado como controle de autenticação; a autorização real continua sendo a credencial validada no backend. Configurar `TOOLJET_ALLOWED_ORIGIN=https://app.tooljet.ai` somente se as chamadas forem feitas diretamente do navegador e após confirmar o comportamento do datasource. Não adicionar o identificador do workspace como mecanismo de autorização.

Acesso ao workspace ainda precisa ser feito pelo próprio usuário no ToolJet Cloud. Não temos uma conexão administrativa ToolJet nesta sessão para criar apps ou datasources diretamente.

## Etapas de entrega

1. Confirmar se o usuário já possui workspace ToolJet e qual modalidade/plano será usada (Cloud ou self-hosted).
2. Restringir o workspace e o app ao proprietário/operadores autorizados; ativar MFA/SSO conforme disponibilidade.
3. Revisar a Edge Function `admin-api` da PR #214; completar testes, rate limit distribuído e auditoria persistente antes de produção.
4. Testar segurança e isolamento com casos positivos e negativos em ambiente de desenvolvimento.
5. Criar o app usando o prompt acima e conectar somente os endpoints aprovados.
6. Revisar RLS, permissões, logs e exposição de dados antes de liberar acesso.
7. Publicar o painel em endereço separado do app financeiro.

## Estado desta entrega

A avaliação do Supabase foi feita em modo somente leitura. O código inicial da Edge Function está versionado na PR #214, mas não foi implantado. Nenhuma migration, segredo ou configuração foi aplicada ao Supabase hospedado. O datasource do ToolJet Cloud ainda não foi criado porque depende do workspace do usuário. A função não deve ser publicada até que testes, rate limit e auditoria persistente estejam prontos.
