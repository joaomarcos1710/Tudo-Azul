# Plano da migration 001 — núcleo financeiro

> **Status:** plano para revisão. **Nada foi implementado, executado ou aplicado.** Não existe a pasta `supabase/`, nenhum arquivo `.sql` e nenhuma alteração no banco.
> Base: [`MODELO-DE-DADOS.md`](MODELO-DE-DADOS.md) (v3, decisões 1–14 aprovadas). Tudo aqui é desenho; os trechos de SQL são esboços.
>
> **Como ler as afirmações:** o que vem da documentação do Supabase/PostgreSQL está marcado como *(doc)*; o que eu **ainda não executei** e vou confirmar nos testes está marcado como *(a confirmar)*. Nada foi testado contra um banco real nesta sessão.

## 1. Escopo

**Entra:** `profiles`, `households`, `household_members`, `invitations`, `accounts`, `categories`, `transactions`, `budgets`; constraints; triggers de integridade; RLS e privilégios; RPCs de família e convite; funções `account_balances`, `balance_totals`, `period_summary`, `budget_usage`; testes pgTAP e de PostgREST.

**Não entra:** cartões, dívidas, investimentos, patrimônio (etapas 9–12); **importação** (`import_batches` e colunas de fingerprint — dependem da amostra do Organizze); qualquer tela.

## 2. Ambiente e fluxo seguro

1. **Banco local descartável** com a CLI do Supabase (`supabase start`, usa Docker) para desenvolver e testar. *(a confirmar: se Docker está disponível na sua máquina; se não estiver, os testes rodam só no CI, que tem Docker nos runners do GitHub.)*
2. **PR separado** com migrations + testes. CI novo (`db-tests`): sobe o stack local, roda `supabase test db` (pgTAP) e os testes de integração do PostgREST. O CI atual (typecheck, test, build) não muda.
3. **Revisão** (você e ChatGPT) antes de qualquer aplicação em produção.
4. **Aplicação no projeto Supabase real** só com sua autorização explícita, depois do CI verde. O projeto ainda não tem dados financeiros, o que reduz o risco, mas migrations são **só para frente**: erro depois de haver dados se corrige com nova migration, não com "desfazer". Antes de existirem dados reais, posso reescrever a 001.
5. **Credenciais:** eu não uso nem peço `service_role`, senha do banco ou token de acesso. A aplicação em produção é feita por você pela CLI, ou me autoriza por outro caminho que você escolher. Nada disso entra no repositório.

**Estrutura de arquivos prevista**
```
supabase/config.toml
supabase/migrations/
  20261014000100_core_schema.sql        -- tabelas, constraints, índices
  20261014000200_integrity_triggers.sql -- triggers de integridade
  20261014000300_security.sql           -- funções privadas, RLS, privilégios
  20261014000400_household_rpcs.sql     -- create_household, convites, membros
  20261014000500_reports.sql            -- saldo, totais, resumo, orçamento
supabase/tests/database/
  00_audit, 01_isolation, 02_integrity, 03_balance, 04_budget, 05_rpc  (.test.sql)
tests/integration/                      -- vitest contra o stack local (PostgREST)
```
Cinco arquivos pequenos em vez de um grande: cada um é revisável e testável sozinho.

## 3. Constraints

| Tabela | Constraints |
|---|---|
| `profiles` | PK = `auth.users.id` (`ON DELETE CASCADE`); `name` 1–80 caracteres |
| `households` | `name` 1–80; `member_limit` entre 1 e 10, padrão 2 |
| `household_members` | `UNIQUE (household_id, user_id)`; `UNIQUE (user_id)` (N1); `role` ∈ {owner, member} |
| `invitations` | `token_hash` `UNIQUE`; `role = 'member'`; `expires_at > created_at`; `email` em minúsculas |
| `accounts` | `UNIQUE (household_id, id)`; `UNIQUE (household_id, lower(name))`; `type` ∈ {checking, savings, cash, other}; `initial_balance` com a regra de escala (N2); `opening_date` entre 2000-01-01 e 2100-01-01 |
| `categories` | `UNIQUE (household_id, id, type)`; nome único por (família, tipo, mãe), sem diferenciar maiúsculas; FK composta da mãe com o mesmo tipo; `system_key` ∈ {uncategorized}; **índice único parcial** (família, tipo) onde `system_key = 'uncategorized'` |
| `transactions` | `CHECK transactions_shape` (seção 2 do modelo, inclui categoria obrigatória); `amount > 0` com escala (N2); `date` entre 2000-01-01 e 2100-01-01; FKs compostas de conta, destino e categoria+tipo; `created_by` `NOT NULL`, padrão `auth.uid()` |
| `budgets` | `UNIQUE (household_id, category_id, month)`; `month` no dia 1; `amount_limit > 0` com escala (N2); `category_type` com `DEFAULT 'expense'` + `CHECK = 'expense'` + FK composta |

**Chaves estrangeiras de `household_id`:** `ON DELETE CASCADE`. **Referências entre tabelas** (conta, categoria): `NO ACTION` — verificado ao fim da instrução, o que permite excluir a família inteira e continua barrando a exclusão isolada de quem tem histórico.

**Índices:** `household_members (user_id)`; `accounts (household_id)`; `categories (household_id, parent_id)`; `transactions (household_id, date)`, `(household_id, account_id, date)`, `(household_id, destination_account_id, date) WHERE destination_account_id IS NOT NULL`, `(household_id, category_id, date)`; `budgets (household_id, month)`; `invitations (household_id)`. Parciais com `deleted_at IS NULL` onde ajudarem as funções de saldo.

## 4. Triggers

Todos `SECURITY INVOKER`, `set search_path = ''`, nomes totalmente qualificados.

| Trigger | Tabela / evento | Regra | Concorrência |
|---|---|---|---|
| `on_auth_user_created` | `auth.users` AFTER INSERT | Cria `profiles` (nome vindo do cadastro; só para exibição, nunca para autorização). `SECURITY DEFINER`, dono `postgres` | — |
| `transactions_guard` | `transactions` BEFORE INSERT/UPDATE | Se `deleted_at is null`: (1) **transferência** exige `date >=` `opening_date` das duas contas; (2) **conta ativa** nas pontas quando é inserção, restauração da lixeira, ou a conta mudou | `SELECT … FOR SHARE` nas contas envolvidas |
| `transactions_touch` | `transactions` BEFORE UPDATE | Atualiza `updated_at` | — |
| `accounts_guard` | `accounts` BEFORE UPDATE | (1) `opening_date` nova não pode ficar depois de transferência não excluída da conta (qualquer ponta); (2) desativar recusado se houver lançamento `planned` não excluído na conta (qualquer ponta) | O `UPDATE` já toma o bloqueio exclusivo da linha, que espera o `FOR SHARE` acima |
| `categories_guard` | `categories` BEFORE INSERT/UPDATE/DELETE | 1 nível (a mãe não tem mãe; quem tem filhas não vira filha); categoria com orçamento não vira filha; "Sem categoria" imutável (nome, tipo, mãe, `active`), sem filhas e sem exclusão | A exclusão é permitida se a família já foi removida (cascata) *(a confirmar: teste D1)* |
| `budgets_guard` | `budgets` BEFORE INSERT/UPDATE | Categoria precisa ser raiz (`parent_id is null`) | — |
| `members_owner_guard` | `household_members` AFTER DELETE/UPDATE, `CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED` | Sempre ao menos 1 `owner`, salvo se a família foi excluída | — |
| `members_limit_guard` | `household_members` BEFORE INSERT | Número de membros < `member_limit` (defesa em profundidade; a regra principal está no convite) | Trava a linha de `households` |

## 5. Funções e privilégios de execução

**Armadilhas conhecidas** *(doc, a confirmar no banco local)*: (a) o Supabase concede por padrão privilégios em tabelas novas do schema `public` a `anon` e `authenticated`; (b) o PostgreSQL concede `EXECUTE` a `PUBLIC` em toda função nova. Por isso a migration faz **revogação explícita** e o teste `00_audit` falha se algo escapar.

Padrão em cada função: `revoke execute on function … from public, anon;` e depois `grant execute … to authenticated` **somente** nas da lista abaixo. Além disso, `alter default privileges` para tabelas e funções futuras.

| Função | Schema | Tipo | `EXECUTE` | Verificações internas |
|---|---|---|---|---|
| `is_member(household)` | `private` | `SECURITY DEFINER`, `STABLE` | `authenticated` | Existe vínculo para `auth.uid()` |
| `is_owner(household)` | `private` | idem | `authenticated` | Vínculo com `role = 'owner'` |
| `shares_household(user)` | `private` | idem | `authenticated` | Usuário compartilha família com `auth.uid()` |
| funções de trigger (seção 4) | `private` | — | **ninguém** | Não precisam de `EXECUTE` do chamador *(doc)* |
| `create_household(name)` | `public` | `SECURITY DEFINER` | `authenticated` | `auth.uid()` não nulo; usuário sem família (N1); cria família, `owner` e categorias padrão numa transação |
| `create_invitation(email)` | `public` | `SECURITY DEFINER` | `authenticated` | Caller é owner; membros + convites válidos < `member_limit`; gera token com `pgcrypto`, grava só o hash, devolve o token **uma vez** |
| `accept_invitation(token)` | `public` | `SECURITY DEFINER` | `authenticated` | Hash existe, não usado, não expirado; e-mail do caller = e-mail do convite (N5); sem família; limite de membros; trava `households` |
| `remove_member(user)` | `public` | `SECURITY DEFINER` | `authenticated` | Caller é owner; alvo é membro da mesma família; não remove o último owner |
| `leave_household()` | `public` | `SECURITY DEFINER` | `authenticated` | Último owner não sai se houver outros membros |
| `delete_household(id)` | `public` | `SECURITY DEFINER` | `authenticated` | Caller é owner; cascata |
| `account_balances`, `balance_totals`, `period_summary`, `budget_usage` | `public` | `SECURITY INVOKER`, `STABLE` | `authenticated` | RLS do chamador decide o que aparece; não-membro recebe vazio |

`SECURITY DEFINER` sempre com `set search_path = ''`. O e-mail do caller vem de `auth.users` dentro da função definer, não de `user_metadata`. O schema `private` **não é exposto** pela API *(doc; conferir em Settings → API → Exposed schemas)*.

**Categorias padrão** (aprovar ou ajustar — ver seção 10.2 do modelo): Receita — Salário, Rendimentos, Outras receitas, *Sem categoria*. Despesa — Moradia, Mercado, Restaurantes, Transporte, Saúde, Educação, Lazer, Assinaturas, Impostos e taxas, Outras despesas, *Sem categoria*.

## 6. RLS e privilégios de tabela

RLS **ligado em todas** as tabelas do `public`. **Sem `FORCE`**: as funções `SECURITY DEFINER` rodam como dono e precisam passar pela RLS por desenho; o controle está nas verificações internas de cada uma.

`anon`: **nenhum** privilégio em nenhuma tabela ou função. `authenticated`: apenas o abaixo, com **privilégios por coluna** onde importa.

| Tabela | `SELECT` | `INSERT` | `UPDATE` | `DELETE` |
|---|---|---|---|---|
| `profiles` | próprio ou `shares_household` | — (trigger) | só o próprio, coluna `name` | — |
| `households` | `is_member(id)` | — (RPC) | `is_owner(id)`, só coluna `name` | — (RPC) |
| `household_members` | `is_member(household_id)` | — (RPC) | — | — (RPC) |
| `invitations` | `is_owner(household_id)`, **sem a coluna `token_hash`** | — (RPC) | — | — |
| `accounts` | `is_member` | `is_member` | `is_member`; sem `household_id`, `id` | `is_member` (FK barra se houver histórico) |
| `categories` | `is_member` | `is_member` | `is_member`; sem `household_id`, `id`, `system_key` | `is_member` (FK e trigger barram) |
| `transactions` | `is_member` | `is_member` e `created_by = auth.uid()` | `is_member`; sem `household_id`, `id`, `created_by` | **ninguém** (lixeira = `UPDATE deleted_at`) |
| `budgets` | `is_member` | `is_member` | `is_member`; sem `household_id`, `id` | `is_member` |

- Uma policy por operação, sempre `TO authenticated`, usando `(select private.is_member(household_id))` para cache por consulta *(doc)*.
- Todas as policies de `UPDATE` têm `USING` **e** `WITH CHECK`.
- As FKs compostas são a defesa de verdade contra referência entre famílias: as verificações de FK ignoram a RLS *(doc)*, então a integridade não depende das policies.
- Funções auxiliares `SECURITY DEFINER` evitam recursão de policy em `household_members`.

## 7. Testes

**Como simular usuários nos testes pgTAP:** os testes rodam como superusuário, que ignora a RLS. Cada bloco muda para `set local role authenticated` (ou `anon`) e define `request.jwt.claims` com `sub` e `role`. Um teste que não troca de papel não prova nada, e o `00_audit` confere isso.

| Arquivo | Conteúdo |
|---|---|
| `00_audit` | RLS ligada em toda tabela do `public`; `anon` sem privilégio em tabela ou função; `PUBLIC` sem `EXECUTE` em nenhuma função de `public`/`private`; lista de funções executáveis por `authenticated` **igual** à da seção 5; toda `SECURITY DEFINER` com `search_path` fixo; `authenticated` sem `DELETE` em `transactions`, `household_members`, `invitations`, `households`; sem `INSERT` em `households`, `household_members`, `invitations`, `profiles`; `private` fora dos schemas expostos |
| `01_isolation` | Usuários U1 e U2 na família H1, U3 na H2, e `anon`. Por tabela: `anon` negado; U3 lê 0 linhas da H1; U3 não insere/atualiza/apaga na H1; lançamento da H1 apontando para conta/categoria da H2 → violação de FK; mover linha para outra família → negado (coluna); falsificar `created_by` → negado; `token_hash` ilegível; membro comum não vê convites; U3 não vê perfil de U1; funções de relatório chamadas por U3 com id da H1 → vazio; RPCs de owner chamadas por U3 e por membro comum → erro |
| `02_integrity` | S6, S7, S10, S12, S13, S15–S17; C1–C6; B8–B12; M8, M9 |
| `03_balance` | S1–S5, S8, S9, S11, S14; A1, A2, A6, A9, A10; **T-INV** (fixture determinística + aleatória com semente fixa, incluindo excluídos, planejados e contas desativadas) com `total = total_active + total_inactive` |
| `04_budget` | B1–B7 |
| `05_rpc` | Ciclo de convite: gerar, aceitar, reaproveitar (falha), expirado, e-mail diferente, limite de 2, último owner, `leave`, `remove`; `create_household` atômico (C3); `delete_household` com contas desativadas e "Sem categoria" (**D1**); F1 |
| Integração (Vitest, stack local) | **Ciclo PostgREST com JWTs reais**: M6, M10, M11; **A11** (duas sessões: inserir em conta × desativar); isolamento ponta a ponta com dois usuários reais. Marcado como opcional por variável de ambiente, nunca roda contra produção |

Os valores esperados de saldo vêm do modelo de referência em Python usado na revisão (centavos inteiros). Ele serve para conferir números, não substitui o teste no SQL.

## 8. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Tabela ou função nova ficar exposta por privilégio padrão (Supabase e `PUBLIC`) | Revogação explícita + `alter default privileges` + teste `00_audit` que falha se escapar |
| Função `SECURITY DEFINER` sequestrável por `search_path` | `search_path = ''`, nomes qualificados, teste de auditoria |
| Corrida entre inserir lançamento e desativar/mudar abertura da conta | `FOR SHARE` × bloqueio de linha do `UPDATE`; teste A11 com duas sessões |
| Guarda de "Sem categoria" bloquear a exclusão em cascata da família | Exceção quando a família já não existe; teste D1 *(a confirmar)* |
| Arredondamento silencioso de valores com 3+ casas | N2 + testes M8–M9 |
| Formato de `numeric` no JSON do PostgREST | Teste M6 registra o tipo recebido; o front só converte depois de confirmado |
| Migration errada aplicada com dados reais | Só para frente; local → CI → revisão → produção; reescrita livre enquanto não houver dados |
| Conflito entre os três assistentes | Só uma pessoa escreve migrations (eu); ChatGPT revisa; tudo via PR e CI |
| Comportamento que presumo da doc e não vi rodar | Marcado *(a confirmar)* neste plano; a lista vira checklist de revisão do PR |
| Docker indisponível na sua máquina | Os testes rodam no CI; localmente só se houver Docker |

## 9. Critérios de aceite do PR da migration

1. CI `db-tests` verde: todos os testes das seções 9.1–9.4 do modelo marcados como pertencentes à migration (S, A, C, B, M, R, F, T-INV, D1).
2. `00_audit` verde (nenhum privilégio ou `EXECUTE` fora da lista).
3. Nenhum teste de segurança que rode sem trocar de papel.
4. Cada item *(a confirmar)* deste plano resolvido por teste ou registrado como diferença no PR.
5. Nenhuma credencial, `.env` ou chave secreta no diff.
6. Sua revisão e a do ChatGPT registradas no PR.

## 10. O que preciso de você para começar

- Responder **N1–N5** (seção 10.2 do modelo) e a **lista de categorias padrão**.
- Dizer se **autoriza a implementação em banco local e CI** (não produção).
- Informar se há **Docker** na sua máquina.
- A **amostra do Organizze** continua pendente e **não bloqueia** esta migration: o mapeamento de importação só será desenhado depois de eu ler o arquivo real.
