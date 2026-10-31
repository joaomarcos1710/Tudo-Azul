# AGENTS.md — Governança de agentes do Tudo Azul

Este arquivo define as regras comuns para qualquer agente de IA ou pessoa que trabalhe neste repositório. Leia-o antes de inspecionar ou alterar o projeto. As instruções específicas de ferramentas (por exemplo, `CLAUDE.md`) são complementares: quando houver sobreposição, cumpra a regra mais restritiva e preserve as decisões explícitas do responsável pelo produto.

## 1. Contexto do produto

O Tudo Azul é um aplicativo web de finanças familiares, construído com React, TypeScript, Vite, Tailwind CSS e Supabase (PostgreSQL, Auth e RLS). O produto acompanha contas, movimentações, cartões, recorrências, dívidas, investimentos, bens e patrimônio familiar.

- Idioma da interface, documentação e comunicação do projeto: português do Brasil.
- Consulte `README.md`, `docs/PLANO.md`, `docs/ARQUITETURA-PATRIMONIO.md` e o diário em `docs/projeto/` antes de propor mudanças.
- A documentação e o código podem evoluir em ritmos diferentes. O estado real do código, das migrations e dos testes prevalece sobre descrições antigas. Ao encontrar divergência, investigue e registre a correção; não presuma que um plano antigo descreve a produção atual.
- Não amplie o escopo por iniciativa própria. Priorize a solicitação explícita e a menor mudança completa que a resolva.

## 2. Protocolo de trabalho

Para toda tarefa:

1. **Entender:** identifique a solicitação, o comportamento atual, as regras de produto relacionadas e os arquivos envolvidos.
2. **Inspecionar antes de editar:** leia os componentes, serviços, RPCs, migrations, testes e documentação pertinentes. Verifique o estado da branch e das PRs quando isso afetar a mudança.
3. **Planejar:** apresente ou registre um plano curto para mudanças que atravessem camadas, alterem dados ou tenham risco relevante. Não peça aprovação para cada detalhe de implementação de baixo risco já autorizado.
4. **Implementar:** faça alterações pequenas, coesas e localizadas. Não reformate arquivos nem refatore áreas sem relação com a tarefa.
5. **Provar:** escreva ou atualize testes que reproduzam o comportamento e executem as validações aplicáveis. Uma correção deve ter um teste que falharia sem ela.
6. **Documentar:** atualize, na mesma PR, os documentos afetados e o diário do projeto.
7. **Revisar:** examine o diff completo, procure regressões, segredos, mudanças acidentais e inconsistências entre código, testes e documentação. Informe claramente o que foi e o que não foi validado.

Não declare que algo foi testado, aplicado, implantado, mesclado ou corrigido sem evidência do resultado correspondente.

## 3. Limites de autorização e operações protegidas

A autorização para implementar uma tarefa não equivale à autorização para executar operações adicionais.

- **Merge:** somente com autorização explícita do responsável pelo produto para aquela PR. Não mescle automaticamente após CI verde.
- **Supabase de produção:** nunca aplicar migrations, alterar dados, políticas, funções, configurações ou usuários de produção sem autorização explícita. Quando autorizado, use o workflow oficial do repositório, com simulação, leitura do log e confirmação exigida pelo workflow.
- **Deploy, publicação, release e promoção de ambiente:** não executar sem autorização explícita.
- **Operações destrutivas:** não apagar tabelas, colunas, registros, arquivos, branches, históricos, contas ou recursos externos sem autorização explícita e análise de reversibilidade.
- **Dados financeiros:** não corrigir ou preencher valores reais por suposição. Não fazer backfill, conversão ou recálculo persistente sem plano, validação e autorização.
- **Segredos:** nunca solicitar, imprimir, registrar, versionar ou copiar senhas, tokens, chaves secretas, credenciais ou dados financeiros pessoais. Nunca expor `service_role` ou outra chave privilegiada no navegador, em logs ou em testes.

Se uma tarefa exigir uma ação protegida não autorizada, pare antes dessa ação e explique o bloqueio, o impacto e o próximo passo seguro. Continue com as partes não destrutivas que estiverem autorizadas.

## 4. Regras financeiras inegociáveis

As regras completas estão em `docs/projeto/20 - Regras do dinheiro.md`, `docs/MODELO-DE-DADOS.md` e `docs/ARQUITETURA-PATRIMONIO.md`. Antes de alterar cálculos, leia as seções aplicáveis.

- PostgreSQL é a fonte de verdade para saldos, totais, projeções e consolidações. O front-end não deve recalcular totais financeiros que pertencem ao banco.
- Não use ponto flutuante (`float`/JavaScript `number`) para aritmética monetária. Siga o padrão existente de centavos inteiros no front e `numeric` no banco.
- Nunca some moedas diferentes sem conversão explícita, cotação identificada e regra de data definida. Até lá, mantenha os valores segregados por moeda.
- Saldo disponível, patrimônio líquido, investimentos, bens, dívidas e compromissos futuros são conceitos distintos. Não apresente um subtotal como patrimônio consolidado.
- Aporte não é despesa; resgate não é receita integral; amortização do principal não é despesa; juros, tarifas e impostos devem permanecer identificáveis.
- Evite dupla contagem entre caixa, investimentos, bens, dívidas, faturas e parcelas futuras. Reaproveite os motores e fontes de saldo existentes; não crie uma segunda fonte independente para a mesma obrigação.
- Respeite datas de abertura, saldos iniciais, status pago/planejado, titularidade e participação familiar.
- Histórico financeiro deve ser preservado e auditável. Prefira eventos, estornos e anulações previstos no modelo a sobrescrever ou apagar fatos históricos.
- Não altere uma regra financeira apenas para facilitar a interface. Atualize modelo, RPC, testes e documentação em conjunto.

## 5. Supabase, banco e migrations

- RLS é obrigatória para dados familiares. Toda leitura e escrita deve respeitar o isolamento por `household_id`; não confie apenas em filtros da interface.
- Preserve chaves estrangeiras compostas, constraints, triggers, grants e políticas que garantem integridade entre famílias.
- Escritas privilegiadas devem seguir o padrão existente de RPCs controladas, autenticação/autorização explícita, `search_path` fixo e privilégios mínimos.
- Nunca edite uma migration que já foi aplicada em qualquer ambiente compartilhado. Crie uma migration nova, aditiva e ordenada.
- Antes de criar migration, inspecione a sequência completa em `supabase/migrations/`, as migrations abertas em PRs e o estado documentado. Evite timestamps duplicados, ordenação ambígua, colisões de nomes e dependências entre PRs.
- Atualize os testes pgTAP e a auditoria de funções/privilégios (incluindo `supabase/tests/database/00_audit.test.sql`, quando aplicável) ao adicionar ou alterar funções, grants, RLS ou estruturas.
- Testes locais ou em banco descartável não provam que a migration foi aplicada em produção. Informe os ambientes efetivamente validados.

## 6. Front-end, API e arquitetura

- Siga os padrões existentes de componentes, hooks, serviços, validação, rotas e design system antes de introduzir abstrações.
- Mantenha TypeScript estrito; não contorne tipos com `any`, casts inseguros ou supressões sem justificativa documentada.
- Trate estados de carregamento, erro, vazio, sucesso, concorrência e respostas assíncronas antigas. Evite envios duplicados e operações não idempotentes.
- Não exponha regras de autorização apenas na interface. A validação crítica deve existir no banco/servidor.
- Preserve acessibilidade, responsividade e uso em telas móveis.
- Não adicione dependências sem necessidade demonstrável; avalie manutenção, licença, segurança e impacto no bundle.
- Não copie código, textos, identidade visual ou componentes de projetos externos. Referências servem para aprender conceitos; confira licenças antes de reutilizar código.

## 7. Testes e critérios de conclusão

Execute o conjunto mínimo pertinente e amplie conforme o risco:

- `npm run typecheck`
- `npm test`
- `npm run build`
- Testes de banco/integração do repositório, incluindo pgTAP, quando houver mudança em SQL, RLS, RPC, migration ou comportamento dependente do banco.
- Auditoria de dependências quando houver alteração de dependências.

Para bugs, primeiro crie um teste que reproduza a falha; confirme que ele falha antes da correção quando viável; depois implemente e confirme que passa. Para regras financeiras e segurança, cubra também casos negativos, limites, isolamento entre famílias, repetição/concorrência e histórico.

Se algum teste não puder ser executado, diga qual, por quê e qual risco permanece. Não substitua evidência por uma afirmação genérica de que o código parece correto.

## 8. Git, branches, PRs e versões

- Nunca trabalhe diretamente em `main` para uma mudança de produto. Use branch específica e PR.
- Não force push, reescreva histórico, descarte alterações alheias ou sobrescreva trabalho de outro agente sem autorização.
- Antes de criar uma branch ou PR, verifique se já existe trabalho equivalente ou uma PR relacionada.
- PRs devem ser pequenas, com objetivo, escopo, regras afetadas, testes executados, riscos e operações não realizadas claramente descritos.
- Siga `CLAUDE.md` e `docs/VERSOES.md` para a regra de versão: cada PR atualiza `package.json`, `package-lock.json` e documentação de versões com o número real da PR, sem diminuir uma versão já integrada.
- Por padrão, abra PR como rascunho. Não faça merge sem autorização explícita.
- Não atualize a versão com um número presumido. Depois de abrir a PR, confirme o número atribuído pelo GitHub e alinhe os arquivos da versão.

## 9. Documentação e continuidade

Na mesma PR, atualize somente os documentos afetados:

- `docs/projeto/02 - Linha do tempo.md`: registrar a entrega quando a PR for integrada, seguindo a convenção existente.
- `docs/projeto/40 - Pendências e próximos passos.md`: atualizar itens concluídos ou novas pendências.
- `docs/projeto/21 - Banco de dados.md`: registrar migrations e mudanças de banco.
- `docs/projeto/10 - Telas do app.md`: atualizar quando telas ou fluxos mudarem.
- `docs/projeto/30 - Decisões.md`: registrar decisões de produto/arquitetura e seus motivos.
- `docs/VERSOES.md`, `package.json` e `package-lock.json`: manter a versão sincronizada conforme a regra do projeto.

Não registre segredos, credenciais, dados financeiros reais ou informações pessoais desnecessárias. Diferencie claramente decisão aprovada, proposta, implementação em PR, merge e aplicação em produção.

## 10. Colaboração entre agentes

- Todo agente deve ler este arquivo e as instruções específicas aplicáveis antes de agir.
- Divida tarefas por responsabilidade quando isso reduzir risco: implementação, revisão independente, testes de banco, segurança e conferência financeira.
- Um agente revisor deve avaliar o diff e as regras de forma independente, sem presumir que a implementação está correta por ter sido produzida por outro agente.
- Não permita que dois agentes alterem simultaneamente os mesmos arquivos ou a mesma branch sem coordenação.
- Compartilhe com outros agentes apenas contexto necessário e não sensível. Registre decisões e resultados verificáveis no repositório/PR, não apenas na conversa.
- Em caso de conflito entre instruções, prevalecem nesta ordem: segurança e autorização explícita do responsável; integridade financeira e do banco; decisões documentadas mais recentes; instruções gerais deste arquivo; convenções locais.

## 11. Checklist antes de concluir

- [ ] A mudança atende exatamente ao pedido e não inclui escopo não autorizado.
- [ ] As regras financeiras, de segurança e de isolamento foram verificadas.
- [ ] Há testes relevantes, incluindo casos negativos quando necessário.
- [ ] Typecheck, testes, build e validações de banco aplicáveis foram executados ou suas limitações foram declaradas.
- [ ] Documentação e versão estão sincronizadas.
- [ ] O diff foi revisado e não contém segredos nem alterações acidentais.
- [ ] A PR descreve o que mudou, evidências, riscos e o que não foi feito.
- [ ] Nenhum merge, deploy ou ação de produção ocorreu sem autorização explícita.
