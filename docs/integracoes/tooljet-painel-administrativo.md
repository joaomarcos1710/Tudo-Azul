# Painel administrativo Tudo Azul com ToolJet

## Objetivo

Criar um painel administrativo interno, separado do aplicativo financeiro familiar. O Tudo Azul continua sendo a aplicação principal em React, TypeScript e Supabase. O ToolJet será usado somente para operações internas de suporte, diagnóstico e acompanhamento.

Documentação oficial:
- ToolJet: https://docs.tooljet.ai/
- Integrações ToolJet: https://tooljet.com/integrations?tab=Database
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security

## Decisão de arquitetura

**Não conectar o ToolJet diretamente às tabelas financeiras de produção com uma credencial privilegiada.**

A integração inicial deve usar o conector REST do ToolJet apontando para endpoints administrativos explícitos no Supabase (Edge Functions). Cada chamada deve apresentar um JWT de um usuário administrativo autenticado. A Edge Function valida o JWT e a autorização administrativa no servidor, consulta somente os campos necessários e devolve dados minimizados.

Regras obrigatórias:
- Nunca colocar `service_role`, senha do banco ou segredo JWT em consultas, variáveis públicas, navegador ou configuração compartilhada do ToolJet.
- Não confiar em variáveis/estados enviados pelo cliente para determinar se alguém é administrador.
- O papel administrativo deve ser concedido exclusivamente no servidor, em `app_metadata` ou mecanismo equivalente não editável pelo próprio usuário.
- Negar por padrão: sem papel administrativo válido, responder 403.
- Manter RLS habilitado nas tabelas. Endpoints com acesso elevado devem validar o papel antes de qualquer consulta e limitar rigorosamente as operações.
- Não disponibilizar CRUD genérico, SQL arbitrário, exclusão de famílias, alteração de saldos ou operações financeiras no painel.
- Registrar ator, ação, alvo, horário, resultado e identificador de correlação em trilha de auditoria, sem registrar tokens, senhas ou dados financeiros sensíveis desnecessários.
- Usar dados sintéticos no desenvolvimento. Não copiar dados de produção para o ToolJet.
- Exigir MFA na conta administrativa e restringir o acesso ao workspace do ToolJet aos operadores autorizados.

## Escopo da primeira versão (somente leitura)

### 1. Visão geral
- Quantidade de famílias e usuários ativos, em métricas agregadas.
- Estado dos serviços e funções administrativas.
- Erros recentes agregados, sem conteúdo financeiro ou tokens.

### 2. Famílias
- Pesquisar por identificador interno ou e-mail parcialmente mascarado.
- Consultar status, quantidade de membros e datas relevantes.
- Não exibir lançamentos, saldos, cartões, investimentos ou documentos financeiros.

### 3. Usuários
- Consultar status de autenticação, confirmação de e-mail e vínculo com família.
- Exibir identificadores internos somente quando necessários para suporte.
- Não permitir alteração de e-mail, senha, titularidade ou exclusão nesta versão.

### 4. Diagnóstico
- Consultar eventos técnicos permitidos, códigos de erro e identificadores de correlação.
- Não exibir payloads brutos que possam conter dados pessoais ou financeiros.

## Contrato inicial de API

Implementar endpoints separados, sem endpoint genérico de SQL:

- `GET /functions/v1/admin-overview`: métricas agregadas e status operacional.
- `GET /functions/v1/admin-families?query=...`: busca restrita de famílias, com paginação e campos minimizados.
- `GET /functions/v1/admin-users?query=...`: busca restrita de usuários, com e-mail mascarado e paginação.
- `GET /functions/v1/admin-events?from=...&to=...`: eventos técnicos permitidos, com janela máxima e redação de dados sensíveis.

Contrato de resposta deve ser versionado, paginado e validado. Limitar tamanho de consulta, frequência, janela de datas e quantidade máxima de resultados. Não aceitar nomes de tabela, colunas, filtros SQL ou comandos arbitrários fornecidos pelo ToolJet.

Antes de implementar cada endpoint, confirmar o esquema real do banco e os campos existentes. Não presumir nomes de tabelas nem criar acesso a dados financeiros para preencher lacunas.

## Estrutura de telas ToolJet

1. **Visão geral**: cartões agregados de famílias, usuários e erros técnicos.
2. **Famílias**: pesquisa, listagem paginada e detalhe operacional minimizado.
3. **Usuários**: pesquisa e estado de autenticação.
4. **Diagnóstico**: eventos técnicos filtráveis e correlação de erros.
5. **Auditoria**: histórico de consultas e ações administrativas.

A primeira versão não terá botões de alteração ou exclusão.

## Prompt para criar o app no ToolJet

> Crie uma aplicação interna chamada “Tudo Azul | Administração”, com navegação lateral e páginas Visão geral, Famílias, Usuários, Diagnóstico e Auditoria. Use somente um datasource REST chamado Tudo Azul Admin API. Todas as consultas devem chamar endpoints explícitos da API, com paginação, estados de carregamento, tratamento de 401/403/429 e mensagens de erro sem dados sensíveis. Não crie conexão PostgreSQL direta, consultas SQL, CRUD genérico, ações de exclusão ou alteração de dados financeiros. A interface deve ser limpa, responsiva e em português do Brasil. Na Visão geral, exiba apenas métricas agregadas. Nas páginas de Famílias e Usuários, use tabelas paginadas e campos minimizados. Na página Diagnóstico, permita filtros de data e código de erro, respeitando o limite de janela retornado pela API. Na Auditoria, exiba ator, ação, alvo, horário e resultado. Se um endpoint ainda não estiver disponível, mostre estado “Integração pendente” em vez de simular dados reais.

## Etapas de entrega

1. Criar o workspace ToolJet e restringir os administradores autorizados.
2. Configurar autenticação e datasource REST sem credenciais privilegiadas no cliente.
3. Implementar e testar as Edge Functions administrativas com autorização negativa por padrão.
4. Criar o app usando o prompt acima e conectar somente os endpoints disponíveis.
5. Revisar RLS, permissões, logs e exposição de dados antes de liberar acesso.
6. Publicar o painel em endereço separado do app financeiro.

## Estado desta entrega

Este documento define a integração segura e o escopo da primeira versão. A criação do workspace, a configuração de credenciais no ToolJet e a publicação do painel dependem de acesso ao workspace ToolJet do proprietário. Nenhum acesso foi concedido ao banco de produção e nenhuma alteração foi feita no Supabase hospedado.
