# Regras automáticas de classificação — edição 2026.3

## Objetivo
Reduzir trabalho repetitivo ao classificar lançamentos, adaptando a ideia de regras de transação de gestores financeiros como Firefly III com implementação própria, sem copiar código do projeto externo.

## Como funciona
- Cada regra tem nome, trecho da descrição, tipo (receita ou despesa), categoria sugerida, prioridade e estado ativo/inativo.
- A correspondência ignora maiúsculas/minúsculas, acentos e espaços repetidos.
- Maior prioridade aparece primeiro; em empate, o trecho mais específico aparece primeiro.
- No formulário de novo lançamento, as regras correspondentes aparecem como sugestões. A pessoa escolhe explicitamente **Usar sugestão**.
- Transferências não recebem sugestões de categoria.
- Regras e categorias são armazenadas por família. O banco impõe isolamento com RLS e chave estrangeira composta para impedir categoria de outra família ou de tipo incompatível.
- A edição de uma regra não altera lançamentos antigos nem dispara reclassificação em lote.

## Segurança
- O motor de correspondência é uma função pura e testável, sem acesso ao Supabase.
- A sugestão não altera valor, conta, data, observações ou tipo do lançamento.
- Regras só sugerem categorias ativas disponíveis para o tipo atual do formulário.
- A tabela tem privilégios por coluna, RLS em todas as operações e políticas que exigem participação na família.
- A migration fica versionada no repositório. Não aplicar ao Supabase de produção sem autorização explícita.

## Validação
- Testes unitários para normalização, prioridade, especificidade, regra inativa, critério vazio, tipo incompatível e imutabilidade.
- Teste de banco para isolamento entre famílias.
- CI oficial valida typecheck, testes, build e testes de banco antes de a PR poder ser considerada pronta.

## Limites desta entrega
As regras não são aplicadas automaticamente a lançamentos existentes nem em lote. A categoria é apenas sugerida no formulário e depende de confirmação. Não há correspondência por regex, múltiplos critérios, tags ou ações automáticas sobre outras propriedades nesta primeira versão.
