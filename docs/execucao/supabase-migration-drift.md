# Reconciliação do histórico de migrations do Supabase

**Projeto consultado:** Tudo Azul (`vbhzilsqzzevaodqsenr`)  
**Consulta:** 2026-11-09, somente leitura  
**Banco:** PostgreSQL 17.11.0.003  
**Branch de implementação:** `fix/financial-integrity-followup-2026-229`

## Estado confirmado

A tabela remota `supabase_migrations.schema_migrations` contém 83 versões. O repositório tinha 89 arquivos de migration na base `main`; a branch desta entrega acrescenta as migrations 090400 e 090500.

Há nove versões locais sem timestamp correspondente no histórico remoto:

| Versão local | Nome | Evidência no banco remoto | Tratamento |
|---|---|---|---|
| 20261106160100 | household_people | A versão remota 20261107141328 tem SQL idêntico, byte a byte após trim. Tabela e coluna user_id existem. | Alinhar somente o histórico, sem reaplicar SQL. |
| 20261107030000 | household_people_classification | A versão remota 20261107141359 tem SQL idêntico. Colunas analíticas e triggers herdadas já existem. | Alinhar somente o histórico, sem reaplicar SQL. |
| 20261107150000 | household_people_login_members | A versão remota 20261108233942 tem SQL idêntico. | Alinhar somente o histórico, sem reaplicar SQL. |
| 20261107170000 | dashboard_commitment_matrix | RPC `dashboard_commitment_matrix(uuid,date,integer)` ausente. | Migration real pendente. |
| 20261107190000 | user_preferences_account_exit | Tabela `public.user_preferences` ausente. | Migration real pendente. |
| 20261108210000 | people_active_and_fk_indexes | Função `private.guard_person_active`, triggers associados e índices finais consultados estão ausentes. | Migration real pendente. |
| 20261109010000 | home_decision_month | RPC `get_home_decision_month` ausente. | Migration real pendente. |
| 20261109020000 | reserve_envelopes_ledger | Tabelas `reserves` e `reserve_allocations` ausentes. | Migration real pendente. |
| 20261109030000 | home_decision_orchestration | RPC final `get_home_decision_month` ausente. | Migration real pendente. |

As três versões remotas antigas permanecem no histórico. Não devem ser marcadas como reverted: o conteúdo SQL foi comparado com os três arquivos locais e é idêntico. A divergência é de timestamp, não de definição.

As migrations 090400 (integridade/idempotência do ledger) e 090500 (reconciliação do Dinheiro Livre e consulta de reservas) existem somente nesta branch e ainda não aparecem no histórico remoto.

## Sequência segura proposta

1. Executar `supabase migration list` com o alvo remoto explicitamente selecionado e guardar a saída como evidência.
2. Após aprovação explícita para reparar apenas o histórico, marcar as três versões locais equivalentes como aplicadas. Isso insere registros de controle; não executa as migrations e não altera lançamentos.
3. Executar novamente `supabase migration list` e confirmar que as três versões locais deixam de aparecer como pendentes.
4. Em uma base de staging isolada, aplicar e validar em ordem as migrations reais pendentes: 071700, 071900, 082100, 090100, 090200, 090300, 090400 e 090500.
5. Comparar o catálogo de staging com as definições e constraints esperadas, executar pgTAP e os testes de integração.
6. Só depois de revisão separada e autorização de produção planejar qualquer rollout. Não usar `db push` no projeto hospedado durante esta etapa.

### Comando de alinhamento de histórico, não executado

O GitHub Actions desta branch registrou Supabase CLI v2.122.1. Para CLI v2, a forma é:

```sh
supabase migration repair 20261106160100 20261107030000 20261107150000 --status applied --linked
```

No Supabase CLI v3, a opção de destino remoto passou a ser `--remote`:

```sh
supabase migration repair 20261106160100 20261107030000 20261107150000 --status applied --remote
```

**Nenhum desses comandos foi executado.** A execução altera somente `supabase_migrations.schema_migrations`; não aplica SQL. A documentação do Supabase descreve esse comportamento em [migration repair](https://supabase.com/docs/reference/cli/supabase-migration-repair) e a mudança de flags em [CLI v3](https://supabase.com/docs/guides/local-development/cli/migrating-to-v3).

## `private.daily_digest_log`: isolamento confirmado por privilégios

A tabela está com RLS desabilitado e sem policies. A consulta direta ao catálogo confirmou que `anon`, `authenticated` e `service_role` não têm SELECT, INSERT, UPDATE ou DELETE na tabela. A tabela está no schema `private`.

As funções `daily_digest_mark` e `daily_digest_recipients` são SECURITY DEFINER, pertencem a `postgres` e têm EXECUTE concedido somente a `service_role`, não a `authenticated` ou `anon`. A função `daily_digest` é SECURITY INVOKER e consulta somente transações, parcelas, faturas e projeções; não acessa `private.daily_digest_log`. A função `daily_digest_service` exige `auth.role() = service_role`. O schema `private` concede USAGE a `authenticated` e `service_role`, mas isso não concede acesso à tabela: os privilégios de tabela permanecem negados para os três papéis.

**Decisão nesta entrega:** não ativar RLS nem criar policy sem necessidade demonstrada. O isolamento por ausência de privilégios diretos foi confirmado; o alerta genérico de RLS desabilitado permanece como defesa em profundidade a discutir separadamente. Nenhum privilégio foi concedido ou revogado.

## Alertas de segurança fora deste ajuste

O Security Advisor retornou 69 avisos `authenticated_security_definer_function_executable` (funções SECURITY DEFINER executáveis por usuários autenticados) e um aviso de proteção contra senhas vazadas desabilitada. A orientação oficial do linter está em [Supabase Database Linter 0029](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable). São achados mais amplos do projeto; não serão corrigidos em massa nesta entrega. Cada RPC precisa ser revisada quanto a autenticação, escopo familiar, validação de parâmetros, search_path e grants, sem trocar SECURITY DEFINER por INVOKER indiscriminadamente.

## Contenção

- Nenhuma migration foi aplicada ao Supabase hospedado.
- Nenhuma linha financeira, evento, saldo, reserva ou histórico foi alterado.
- Nenhum comando de repair foi executado.
- Nenhum deploy ou merge foi feito.
