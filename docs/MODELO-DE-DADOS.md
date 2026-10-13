# Modelo de dados e segurança — Etapa 3 (proposta para revisão)

> **Status:** proposta. Nada foi gravado no banco. Este documento existe para validar relações, permissões e regras de saldo **antes** da primeira migration.
> Os trechos de SQL são esboços para discutir o desenho, não migrations finais.

## 1. Princípios

1. **Saldos e totais são derivados, nunca gravados.** Editar ou excluir um lançamento recalcula tudo, sem risco de inconsistência.
2. **A regra de saldo existe em um único lugar:** funções SQL. O front-end só exibe o resultado e nunca recalcula.
3. **O isolamento entre famílias é garantido pelo banco** (RLS + chaves estrangeiras compostas), nunca pela interface.
4. **Núcleo agora; módulos depois.** Cartões, dívidas e investimentos terão migrations próprias nas Etapas 9–11.
   - *Mudança em relação ao plano anterior:* eu havia dito que essas tabelas viriam já na Etapa 3. Desenhar tabelas de módulos que ainda não entendemos gera retrabalho. O núcleo foi desenhado para aceitar os módulos depois (ver seção 8).

## 2. Tabelas do núcleo

Tipos: valores em `numeric(14,2)`; datas em `date`; identificadores `uuid`; textos controlados com `text` + `CHECK` (mais fácil de evoluir que `enum`).

| Tabela | Colunas principais | Restrições importantes |
|---|---|---|
| `profiles` | `id` (= `auth.users.id`), `name`, `created_at` | Criada por trigger no cadastro |
| `households` | `id`, `name`, `created_by`, `created_at` | — |
| `household_members` | `id`, `household_id`, `user_id`, `role` (`owner`/`member`), `joined_at` | `UNIQUE (household_id, user_id)`; deve existir sempre ao menos 1 `owner` |
| `invitations` | `id`, `household_id`, `email`, `token_hash`, `role`, `expires_at`, `accepted_at`, `invited_by` | Token guardado só como hash; uso único; validade de 7 dias |
| `accounts` | `id`, `household_id`, `name`, `type` (`checking`/`savings`/`cash`/`other`), `initial_balance`, `opening_date`, `active`, `created_at` | `UNIQUE (household_id, id)` |
| `categories` | `id`, `household_id`, `name`, `type` (`income`/`expense`), `parent_id`, `color`, `icon`, `active` | `UNIQUE (household_id, id, type)`; só 1 nível de subcategoria |
| `transactions` | `id`, `household_id`, `account_id`, `destination_account_id`, `category_id`, `type` (`income`/`expense`/`transfer`), `description`, `amount`, `date`, `status` (`paid`/`planned`), `notes`, `created_by`, `created_at`, `updated_at`, `deleted_at` | Ver seção 3 |
| `budgets` | `id`, `household_id`, `category_id`, `month`, `amount_limit`, `created_at` | `UNIQUE (household_id, category_id, month)`; `month` sempre dia 1 |

### Regras em `transactions`
```sql
amount numeric(14,2) not null check (amount > 0),
-- transferência exige destino diferente da origem e não tem categoria
check ( (type = 'transfer' and destination_account_id is not null
         and destination_account_id <> account_id and category_id is null)
     or (type <> 'transfer' and destination_account_id is null) )
```
Uma transferência é **uma única linha** (origem + destino). Assim as duas pontas nunca ficam inconsistentes, e as duas contas são ajustadas pela mesma regra de saldo.

## 3. Integridade entre famílias (chaves estrangeiras compostas)

Em vez de confiar só no RLS, o próprio banco **impede** referências entre famílias:

```sql
-- contas e categorias só podem ser referenciadas dentro da mesma família
foreign key (household_id, account_id)             references accounts (household_id, id),
foreign key (household_id, destination_account_id) references accounts (household_id, id),
-- a categoria precisa ter o mesmo tipo do lançamento (receita só com categoria de receita)
foreign key (household_id, category_id, type)      references categories (household_id, id, type),
-- orçamento só para categoria de despesa
-- (budgets.category_type fixo em 'expense', com FK composta equivalente)
```
Colunas nulas não disparam a verificação, então transferências (sem categoria) passam normalmente.

Exclusão: `ON DELETE RESTRICT` em contas e categorias. Quem tem histórico é **desativado** (`active = false`), nunca apagado.

## 4. Regra de saldo (única fonte de verdade)

**Saldo de uma conta na data D** = `initial_balance` + movimentações `paid` com `opening_date <= date <= D`:

| Lançamento | Efeito |
|---|---|
| Receita na conta | + valor |
| Despesa na conta | − valor |
| Transferência (conta de origem) | − valor |
| Transferência (conta de destino) | + valor |

```sql
create function public.account_balances(p_household uuid, p_as_of date)
returns table (account_id uuid, active boolean, balance numeric(14,2))
language sql stable security invoker set search_path = ''
as $$
  select a.id, a.active,
         a.initial_balance + coalesce(sum(case
           when t.type = 'income'   and t.account_id = a.id             then  t.amount
           when t.type = 'expense'  and t.account_id = a.id             then -t.amount
           when t.type = 'transfer' and t.account_id = a.id             then -t.amount
           when t.type = 'transfer' and t.destination_account_id = a.id then  t.amount
         end), 0)
  from public.accounts a
  left join public.transactions t
    on t.household_id = a.household_id
   and t.deleted_at is null
   and t.status = 'paid'
   and t.date >= a.opening_date
   and t.date <= p_as_of
   and (t.account_id = a.id or t.destination_account_id = a.id)
  where a.household_id = p_household and a.opening_date <= p_as_of
  group by a.id, a.active, a.initial_balance
$$;
```
`security invoker` faz a função respeitar o RLS de quem chama.

### Regras decorrentes (precisam estar claras na tela)
- **Saldo total do dashboard** = soma de `account_balances` apenas das contas `active`, na data selecionada.
- **Lançamento anterior ao `opening_date`** é permitido: entra em relatórios e orçamentos do seu mês, mas **não altera o saldo** (decisão sua). A tela avisa isso ao salvar. Para refletir no saldo, recua-se o `opening_date` e ajusta-se o `initial_balance`.
- **Transferência entre contas com `opening_date` diferentes:** cada ponta segue a regra da *própria* conta. Se a transferência é anterior à abertura da conta de destino, só a origem é afetada. É consistente, mas significa que, nesse caso, o total de saldos não se conserva. Vamos testar e avisar na tela.
- **Conta que ainda não existia na data D** (`opening_date > D`) não aparece no resultado.
- **Planejado (`planned`)** nunca entra em saldo, receita ou despesa realizados. Aparece em totais separados.

### Resumo do período e orçamento
- `period_summary(household, from, to)` retorna receitas e despesas **realizadas** (`paid`), o resultado, e os valores **planejados** ainda não pagos. **Transferências ficam de fora.**
- `budget_usage(household, month)` retorna, por categoria de despesa: limite, realizado (`paid`, **somando as subcategorias**), restante e percentual.

## 5. Segurança (RLS)

Base: práticas atuais da documentação do Supabase.

- RLS **ativado em todas** as tabelas; `REVOKE ALL` de `anon` e `authenticated`, e `GRANT` só do necessário a `authenticated`. `anon` não tem acesso a nada.
- **Uma policy por operação** (`select`, `insert`, `update`, `delete`), sempre com `TO authenticated`.
- Verificação de pertencimento por função auxiliar em schema privado, com cache por consulta:
  ```sql
  create function private.is_member(p_household uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
    select exists (select 1 from public.household_members
                   where household_id = p_household and user_id = (select auth.uid()))
  $$;
  -- policy típica:
  using ((select private.is_member(household_id)))
  ```
  O schema `private` **não é exposto pela API**, e `execute` é revogado de `public`/`anon`.
- `created_by` tem `default auth.uid()` e a policy de `insert` exige `created_by = auth.uid()`.
- **Índices** em todas as colunas usadas por policies (`household_id`, `user_id`).
- **Nada de `user_metadata`** em autorização (o usuário pode alterá-lo).
- **Cliente não escreve em `household_members`.** Só funções (RPC) validadas: `create_household(name)`, `create_invitation(email)`, `accept_invitation(token)`, `remove_member(user_id)`. Cada uma checa `auth.uid()` internamente. `create_household` cria a família, o vínculo `owner` e as categorias padrão **numa única transação**.
- Views, se houver, com `security_invoker = true`.

### Permissões
| Ação | Owner | Member |
|---|---|---|
| Ver, criar, editar e excluir lançamentos | sim | sim |
| Criar/editar/desativar contas e categorias; definir orçamentos | sim | sim |
| Convidar, remover membros; renomear ou excluir a família | sim | não |
| Sair da família | só se houver outro owner | sim |

### Testes de segurança (`supabase/tests`, pgTAP)
Para **cada tabela**: `anon` não lê nem escreve; membro da família A lê e escreve na A; membro da A **não** lê, altera nem apaga nada da B; tentativa de inserir lançamento da família A apontando para conta da B **falha** (FK composta).

## 6. Convites, cadastro e e-mail — ponto de atenção

**Achado:** o e-mail padrão do Supabase só entrega para endereços da **sua própria organização**, com limite de **2 por hora**, e não é feito para produção. Como a confirmação por e-mail está ativa, **a sua esposa não receberia o link de confirmação** nem e-mails de recuperação de senha.

**Correção a uma sugestão anterior:** eu disse para "fechar o cadastro". Isso só funciona **depois** que os dois usuários existirem (cadastro fechado também bloqueia o próprio cadastro dela).

**Opções:**
1. **Configurar SMTP próprio** (um serviço de e-mail) no painel do Supabase. É o caminho correto e permanente; custo e escolha do provedor a decidir.
2. **Criar o usuário dela manualmente** no painel (*Authentication → Users → Add user*, com confirmação automática). Funciona hoje, sem e-mail, mas a recuperação de senha dela continuaria sem funcionar até haver SMTP.
3. **Não** adicioná-la como membro da organização do Supabase só para receber e-mail: isso daria acesso ao painel do projeto.

**Convite dentro do app:** o dono gera um **link com token** (guardado só como hash, uso único, 7 dias) e **você o envia por WhatsApp**. O fluxo não depende de e-mail. O aceite vincula o usuário já cadastrado à família.

## 7. Decisões abertas (com recomendação)

| # | Decisão | Recomendação |
|---|---|---|
| 1 | Permissões iguais para dados financeiros; só o owner gerencia membros | Sim, conforme a tabela acima |
| 2 | Exclusão de lançamento: apagar de vez ou **lixeira** (`deleted_at`) | **Lixeira.** Com dois usuários, um apagar sem querer é plausível, e o saldo derivado não dá como recuperar. Custa um filtro nas funções |
| 3 | Subcategorias | **1 nível** (categoria → subcategoria), garantido por trigger |
| 4 | Categorias padrão | **Copiadas para cada família** na criação (editáveis e desativáveis), em vez de linhas globais |
| 5 | Limite de membros por família | Sem limite no esquema; limite de **2** na função de convite (constante fácil de mudar) |
| 6 | E-mail | Opção 1 (SMTP próprio) em médio prazo; opção 2 como solução imediata |
| 7 | Cadastro aberto ou fechado | Aberto até ambos terem conta, depois fechado |

## 8. Como o núcleo aceita os módulos futuros

- **Cartões (Etapa 9):** novas tabelas `credit_cards`, `invoices`; campos `invoice_id`, `installment_group_id`, `installment_number` em `transactions` (colunas nulas, adicionadas por migration). Pagar a fatura é uma transferência conta → fatura, **sem contar despesa duas vezes**.
- **Dívidas (Etapa 10):** tabelas próprias; o pagamento de parcela é uma despesa em conta, ligada ao contrato.
- **Investimentos (Etapa 11):** tabelas de ativos e posições; aporte é transferência, **não é despesa**.
- **Patrimônio líquido (Etapa 12):** consulta que une saldos, investimentos, dívidas e faturas em aberto.

`text` + `CHECK` permite acrescentar tipos de conta (cartão, investimento) com uma migration simples.

## 9. Ordem de implementação da Etapa 3

1. Migration de schema + constraints.
2. Migration de RLS + funções privadas + RPCs.
3. Funções de saldo, resumo e orçamento.
4. Testes pgTAP (isolamento, restrições, regra de saldo com os casos acima).
5. Só então conectar telas (Etapas 4–5).
