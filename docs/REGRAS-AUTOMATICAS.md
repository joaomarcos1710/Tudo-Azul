# Regras automáticas de classificação — proposta 2026.3

## Objetivo
Reduzir trabalho repetitivo ao classificar lançamentos, aproveitando a ideia de regras de transação vista em gestores financeiros como Firefly III, com implementação própria e compatível com o Tudo Azul.

## Contrato da primeira etapa
- Uma regra identifica um trecho da descrição e o tipo de lançamento.
- A correspondência ignora diferenças entre maiúsculas/minúsculas, acentos e espaços repetidos.
- Regras com maior prioridade aparecem primeiro; em empate, a regra mais específica aparece primeiro.
- A regra produz uma **sugestão de categoria**. A classificação não deve alterar valor, conta, data, notas ou tipo.
- Transferências não recebem categoria, seguindo as invariantes atuais do banco.
- Regras inativas e critérios vazios não correspondem.
- A lógica de correspondência é pura e testável, sem acesso ao Supabase.

## Segurança e etapas antes de liberar na interface
1. Persistir regras por família com RLS e testes de isolamento entre famílias.
2. Permitir criar, editar, desativar e excluir regras.
3. Exibir uma sugestão explícita no formulário de lançamento; a pessoa confirma antes de aplicá-la.
4. Não executar regras em lote sobre histórico nem reclassificar lançamentos existentes.
5. Testar com os testes unitários, typecheck, build e CI oficial antes de merge.
6. Não aplicar migrations no Supabase de produção sem autorização explícita.

## Limite desta etapa
Este documento e o motor de correspondência são a fundação da funcionalidade; a persistência e a interface ainda precisam ser implementadas antes de considerar as regras automáticas prontas para uso.
