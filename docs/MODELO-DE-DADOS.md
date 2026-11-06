# Modelo de dados e segurança — Etapa 3 (v3, decisões aprovadas)

> **Status:** desenho aprovado em 13/10/2026 (decisões 1–14, seção 10). Nada foi gravado no banco e **nenhuma migration existe**. O plano da primeira migration está em [`MIGRATION-001-PLANO.md`](MIGRATION-001-PLANO.md) e **aguarda sua autorização** para ser implementado.
> Os trechos de SQL são esboços para discutir o desenho, não migrations finais.
>
> **v2 (13/10/2026):** plano e documento alinhados; semântica de `initial_balance`/`opening_date`; transferências; `budgets`; precisão monetária; duplicidades na importação; casos de teste.
>
> **v3 (13/10/2026):** (1) **`active` passou a controlar só novas movimentações**; contas desativadas continuam nos saldos e nas consultas históricas, e a regra de conservação soma todas as contas abertas até a data (seção 4.4); (2) categoria obrigatória em receita/despesa por `CHECK` explícito e categoria de sistema "Sem categoria"; (3) decisões 1–14 registradas com as definições aprovadas; (4) `ON DELETE NO ACTION` em vez de `RESTRICT` (ver seção 3); (5) testes de contas desativadas, categoria obrigatória e ciclo PostgREST.

## 1. Princípios

1. **Saldos e totais são derivados, nunca gravados.** Editar ou excluir um lançamento recalcula tudo, sem risco de inconsistência.
2. **A regra de saldo existe em um único lugar:** funções SQL. O front-end só exibe o resultado e nunca recalcula.
3. **O isolamento entre famílias é garantido pelo banco** (RLS + chaves estrangeiras compostas), nunca pela interface.
4. **Núcleo agora; módulos depois.** Cartões, dívidas e investimentos terão migrations próprias nas Etapas 9–11 (patrimônio na 12). O `docs/PLANO.md` diz a mesma coisa (era a divergência apontada na revisão: o plano antigo previa essas tabelas já na Etapa 3).
   - Desenhar tabelas de módulos que ainda não entendemos gera retrabalho. O núcleo foi desenhado para aceitá-los (seção 11).
5. **Dinheiro nunca é calculado em ponto flutuante.** Totais vêm do Postgres; o front usa centavos inteiros (seção 5).
6. **Nada que possa divergir em silêncio.** Quando uma regra aceita uma situação que faria saldos não fecharem, ela é rejeitada ou avisada explicitamente.

## 2. Tabelas do núcleo

Tipos: valores em `numeric(14,2)`; datas em `date`; identificadores `uuid`; textos controlados com `text` + `CHECK` (mais fácil de evoluir que `enum`).

| Tabela | Colunas principais | Restrições importantes |
|---|---|---|
| `profiles` | `id` (= `auth.users.id`), `name`, `created_at` | Criada por trigger no cadastro |
| `households` | `id`, `name`, `member_limit` (padrão 2), `created_by`, `created_at` | `member_limit` só é alterável por quem administra o banco (cliente não escreve) |
| `household_members` | `id`, `household_id`, `user_id`, `role` (`owner`/`member`), `joined_at` | `UNIQUE (household_id, user_id)`; `UNIQUE (user_id)` na v1 (um usuário, uma família — ponto N1); deve existir sempre ao menos 1 `owner` |
| `invitations` | `id`, `household_id`, `email`, `token_hash`, `role`, `expires_at`, `accepted_at`, `invited_by` | Token guardado só como hash; uso único; validade de 7 dias; só convida `member` |
| `accounts` | `id`, `household_id`, `name`, `type` (desde a migration 070: `checking`/`savings`/`brokerage`/`fixed_income`/`variable_income`/`crypto`/`cash`), `initial_balance`, `opening_date`, `active`, `created_at` | `UNIQUE (household_id, id)`; **`active` só controla novas movimentações** (seção 4.4); semântica de saldo na seção 4 |
| `account_tags` (migration 072) | `id`, `household_id`, `name`, `created_at` | Etiqueta livre da família (só organização, **fora de qualquer cálculo**); `name` aparado, 1 a 30 caracteres; `UNIQUE (household_id, lower(name))`; `UNIQUE (household_id, id)`; até 50 por família (trigger) |
| `account_tag_links` (migration 072) | `household_id`, `account_id`, `tag_id`, `created_at` | PK `(account_id, tag_id)`; FKs compostas `(household_id, account_id)` → `accounts` e `(household_id, tag_id)` → `account_tags`, `ON DELETE CASCADE` (não cruza famílias); até 10 por conta (trigger); troca por `account_tags_set` (INVOKER) |
| `categories` | `id`, `household_id`, `name`, `type` (`income`/`expense`), `parent_id`, `system_key`, `color`, `icon`, `active` | `UNIQUE (household_id, id, type)`; só 1 nível; filha tem o **mesmo tipo** da mãe; `system_key = 'uncategorized'` marca "Sem categoria" (seção 3) |
| `transactions` | `id`, `household_id`, `account_id`, `destination_account_id`, `category_id`, `type` (`income`/`expense`/`transfer`), `description`, `amount`, `date`, `status` (`paid`/`planned`), `notes`, `created_by`, `created_at`, `updated_at`, `deleted_at` | Seções 3 e 4 |
| `budgets` | `id`, `household_id`, `category_id`, **`category_type`**, `month`, `amount_limit`, `created_at` | `UNIQUE (household_id, category_id, month)`; `month` sempre dia 1; **só categoria de despesa e de nível raiz** (seção 3) |

### Regras em `transactions`
```sql
amount numeric(14,2) not null check (amount > 0),
-- transferência: destino diferente da origem e SEM categoria.
-- receita/despesa: SEM destino e COM categoria (decisão 10: restrição explícita)
constraint transactions_shape check (
     (type = 'transfer' and destination_account_id is not null
        and destination_account_id <> account_id and category_id is null)
  or (type in ('income','expense') and destination_account_id is null
        and category_id is not null) )
```
Uma transferência é **uma única linha** (origem + destino). Assim as duas pontas nunca ficam inconsistentes, e as duas contas são ajustadas pela mesma regra de saldo.

**Precisão exata na entrada (N2, aprovado).** `numeric(14,2)` **arredonda em silêncio** um valor com mais de duas casas enviado direto à API (`1.005` vira `1.01`). Por isso `amount`, `initial_balance` e `amount_limit` são `numeric` **sem** modificador de tipo, com a regra de dinheiro:

```sql
check (x = round(x, 2) and abs(x) < 1e12)
```

- **Escala:** o valor é aceito se for **numericamente igual** ao seu arredondamento a 2 casas. `1.2300` é aceito (e gravado como `1.23`); `1.005`, `0.001` e `1.2301` são **rejeitados**. Não se usa `scale(x) <= 2`, que recusaria `1.2300` por ter 4 casas declaradas.
- **Magnitude:** `abs(x) < 10¹²`, ou seja, de −999.999.999.999,99 a 999.999.999.999,99. `NaN` e `Infinity` falham no `CHECK`.
- **Normalização:** como o `CHECK` é avaliado **depois** dos triggers `BEFORE`, a validação que rejeita fica no trigger de guarda de cada tabela (que roda antes de normalizar com `round(x, 2)`); o `CHECK` fica como defesa adicional. Assim `1.2300` é gravado como `1.23`, com escala 2.
- **Mesma regra** para `transactions.amount`, `accounts.initial_balance` (pode ser negativo) e `budgets.amount_limit`.
- Os totais continuam exatos (soma de `numeric`). Os testes M8, M9, M12 e M13 cobrem os casos.

## 3. Integridade (chaves estrangeiras compostas e triggers)

Em vez de confiar só no RLS, o próprio banco **impede** referências entre famílias e combinações inválidas.

```sql
-- transactions: contas e categorias só dentro da mesma família
foreign key (household_id, account_id)             references accounts (household_id, id),
foreign key (household_id, destination_account_id) references accounts (household_id, id),
-- a categoria precisa ter o mesmo tipo do lançamento (receita só com categoria de receita)
foreign key (household_id, category_id, type)      references categories (household_id, id, type),

-- categories: a subcategoria tem o mesmo tipo da categoria mãe
foreign key (household_id, parent_id, type)        references categories (household_id, id, type),

-- budgets: coluna fixa em 'expense' + FK composta => só categoria de despesa
category_type text not null default 'expense' check (category_type = 'expense'),
foreign key (household_id, category_id, category_type)
                                                   references categories (household_id, id, type),
```

**Como a restrição de orçamento é garantida (ponto levantado na revisão).** `budgets.category_type` existe como coluna real, com `DEFAULT 'expense'` e `CHECK (category_type = 'expense')`. A FK composta aponta para `categories (household_id, id, type)`. Resultado: orçamento em categoria de receita é recusado pelo banco (a FK não encontra a linha `(…, 'expense')`), e a aplicação não precisa informar a coluna. Isso será coberto por teste (B1).

**Detalhes que as FKs compostas não cobrem** (todos viram trigger, com teste):

| Regra | Mecanismo |
|---|---|
| Subcategoria só até 1 nível (a mãe não pode ter mãe) | trigger em `categories` |
| Orçamento só em categoria **raiz** (`parent_id is null`); a subcategoria entra na soma da mãe | trigger em `budgets` |
| O `type` de uma categoria não muda enquanto houver referência | já garantido pela própria FK (chave referenciada `NO ACTION`) |
| Transferência: data não anterior ao `opening_date` de **nenhuma** das contas | trigger em `transactions` (seção 4.2) |
| Nova movimentação (inserir, restaurar da lixeira, trocar a conta) só em conta **ativa** | trigger em `transactions` (seção 4.4) |
| Mudar `opening_date` de uma conta não pode deixar transferência anterior à nova data | trigger em `accounts` (seção 4.2) |
| Desativar conta com lançamento **planejado** em aberto | trigger em `accounts` recusa (seção 4.4) |
| Categoria "Sem categoria": uma por tipo e por família; não pode ser renomeada, desativada, movida, excluída nem ter filhas | índice único parcial + trigger em `categories` |

Os triggers leem as contas com `FOR SHARE`; as atualizações em `accounts` tomam o bloqueio exclusivo da linha. Assim, duas transações simultâneas não furam a regra (uma espera a outra).

**Categoria obrigatória (decisão 10).** Colunas nulas não disparam a verificação da FK (`MATCH SIMPLE`), então a FK sozinha aceitaria receita sem categoria. Por isso a obrigatoriedade é o `CHECK transactions_shape` (seção 2), que não depende da FK. A importação usa "Sem categoria" como destino padrão do tipo correspondente.

**Exclusão.** `ON DELETE NO ACTION` (o padrão) em contas e categorias, **não** `RESTRICT`: o `RESTRICT` é verificado na hora e impediria excluir uma família inteira, em que lançamentos e contas saem na mesma instrução. `NO ACTION` é verificado ao fim da instrução e continua barrando a exclusão isolada de quem tem histórico. Quem tem histórico é **desativado** (`active = false`), nunca apagado. Lançamentos nunca são apagados pelo cliente: vão para a lixeira (`deleted_at`); não há limpeza automática na v1 (ponto N4).

## 4. Regra de saldo (única fonte de verdade)

### 4.1 Definições formais
- **`opening_date`**: o dia em que o controle da conta começa **neste app**. É a data de corte do histórico que conta para o saldo.
- **`initial_balance`**: o saldo da conta **no início do dia `opening_date`**, isto é, antes de qualquer movimentação datada nesse dia. Pode ser negativo (cheque especial).
- **Movimentação que conta para o saldo**: lançamento `paid`, não excluído (`deleted_at is null`), com `opening_date <= date <= D`, em que `D` é a data de consulta. O dia `opening_date` **conta**.

**Saldo da conta na data D** = `initial_balance` + Σ efeitos das movimentações que contam:

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
`security invoker` faz a função respeitar o RLS de quem chama. A função **não filtra por `active`**: devolve todas as contas abertas até `p_as_of`, com a coluna `active` para a tela separar.

### 4.2 Transferências entre contas com `opening_date` diferentes (revisão)

**Problema da v1.** Cada ponta seguia a regra da própria conta. Uma transferência anterior à abertura da conta de destino debitava a origem e **não creditava** o destino: o dinheiro sumia do total. A v1 aceitava isso e só prometia "avisar na tela". Medido em um modelo de referência com 3 contas e 10 transferências aleatórias, essa regra violou a conservação em **2.479 de 3.000** cenários. Não é um caso de canto.

**Regra (aprovada — decisão 8):**
> Uma transferência exige `date >= opening_date` das **duas** contas. Caso contrário o banco **rejeita** com mensagem clara.

Aplica-se a lançamentos não excluídos, em qualquer `status`, na criação, na edição e na **restauração da lixeira**. A condição de contas ativas é tratada separadamente, na seção 4.4. Em contrapartida:
- **Receita e despesa anteriores à abertura continuam permitidas** (decisão sua, v1): entram em relatórios e orçamentos do mês, mas não alteram o saldo; a tela avisa ao salvar.
- **Mudar `opening_date` de uma conta** é uma operação explícita: a tela mostra o efeito sobre o saldo antes de confirmar, e o banco recusa se algum lançamento de transferência ficaria anterior à nova data.

**Propriedade que a regra garante (invariante testável).** Para qualquer data D, considerando **todas** as contas com `opening_date <= D`, **ativas ou não**:
```
Σ saldos(D) = Σ initial_balance das contas abertas até D
            + Σ (receitas pagas − despesas pagas) com opening_date_da_conta <= date <= D
```
Ou seja, **só receita e despesa mudam o total; transferência nunca muda**. Validado em modelo de referência (centavos inteiros) em 3.000 cenários aleatórios com contas, aberturas, lançamentos excluídos e planejados. Isso é **prova no modelo, não prova no banco**: o teste pgTAP T-INV repete a propriedade contra a função SQL real.

### 4.3 Regras decorrentes (precisam estar claras na tela)
- **Saldo total** = soma de `account_balances` de **todas** as contas com `opening_date <= D`, **inclusive as desativadas** (correção da v3; ver 4.4). O dashboard mostra o total e, abaixo dele, o detalhe "contas ativas" e "contas desativadas com saldo". A soma é feita pela função `balance_totals`, não no front.
- **Conta que ainda não existia na data D** (`opening_date > D`) não aparece no resultado. O total histórico antes da abertura, portanto, não inclui o `initial_balance` dela.
- **Planejado (`planned`)** nunca entra em saldo, receita ou despesa realizados. Aparece em totais separados.
- **Recuar o `opening_date`** para que o histórico entre no saldo exige ajustar o `initial_balance` junto (a tela guia isso e mostra o saldo antes/depois).

### 4.4 Contas desativadas (correção da v3)

**Inconsistência da v2.** A regra de conservação somava todas as contas, mas o dashboard somava só as `active`. Uma conta desativada com saldo ≠ 0 fazia o total "perder" dinheiro. No modelo de referência, somar só as ativas divergiu da fórmula em **2.203 de 3.000** cenários; somar todas as contas abertas até D conservou em **3.000 de 3.000**.

**Definição.** `active` controla **apenas a possibilidade de novas movimentações**. Não tira a conta de nenhum cálculo, histórico ou relatório.

| Operação | Conta ativa | Conta desativada |
|---|---|---|
| Aparecer em `account_balances` e nos totais | sim | **sim** (a coluna `active` vem no resultado) |
| Consulta histórica (data passada) | sim | **sim** |
| Inserir lançamento (qualquer tipo/status), em qualquer ponta de transferência | sim | **não** |
| Restaurar da lixeira lançamento dessa conta | sim | **não** |
| Trocar o lançamento *para* essa conta | sim | **não** |
| Editar lançamento já existente (descrição, categoria, valor, data) | sim | **sim** (corrigir histórico é legítimo) |
| Mover para a lixeira | sim | sim |
| Desativar | sim, **se não houver lançamento planejado em aberto** | — |
| Reativar | — | sim |

Pontos de atenção:
- **Desativar conta com saldo ≠ 0** é permitido, mas a tela avisa ("esta conta ainda tem R$ X") e o saldo continua no total. Isso é intencional: o dinheiro existe.
- **Desativar com lançamento planejado em aberto é recusado**, para não sobrar um planejado que nunca poderá virar pago. O usuário exclui ou reatribui antes (ponto N3).
- Editar o valor/data de um lançamento antigo de conta desativada **altera o saldo histórico**, como em qualquer conta. A regra de transferência (4.2) continua valendo na edição.

```sql
-- dashboard: totais calculados no banco, nunca somados no navegador
create function public.balance_totals(p_household uuid, p_as_of date)
returns table (total numeric, total_active numeric, total_inactive numeric)
language sql stable security invoker set search_path = ''
as $$
  select coalesce(sum(balance), 0),
         coalesce(sum(balance) filter (where active), 0),
         coalesce(sum(balance) filter (where not active), 0)
  from public.account_balances(p_household, p_as_of)
$$;
-- invariante: total = total_active + total_inactive, sempre.
```

### Resumo do período e orçamento
- `period_summary(household, from, to)` retorna receitas e despesas **realizadas** (`paid`), o resultado, e os valores **planejados** ainda não pagos. **Transferências ficam de fora.**
- `budget_usage(household, month)` retorna, por categoria raiz de despesa: limite, realizado (`paid`, **somando as subcategorias**), restante e percentual (`numeric`, calculado no SQL).

## 5. Precisão monetária

**Banco.** `numeric(14,2)` é exato: somas, subtrações e `round(x, 2)` não têm erro binário. Máximo: 999.999.999.999,99.

**Onde existe risco: qualquer conta com reais em `number` do JavaScript.** Ex.: `0.1 + 0.2 = 0.30000000000000004`. Mapeamento dos pontos do front:

| Ponto | Risco | Regra |
|---|---|---|
| Total de saldo, receitas, despesas, orçamento, relatórios | Somar no navegador | **Proibido.** Só valores vindos de função SQL (`account_balances`, `period_summary`, `budget_usage`) |
| Campo de valor do formulário | `parseBRL` hoje devolve reais em `number` (float) | Converter para **centavos inteiros** na entrada (`"1.250,50"` → `125050`) |
| Envio ao banco | Serializar float | Enviar **string decimal** montada a partir dos centavos (`"1250.50"`), nunca `cents / 100` |
| Leitura do banco | `numeric` pode chegar como número JSON | Converter com `Math.round(n * 100)`. É exato dentro de `numeric(14,2)`: 10¹⁴ − 1 centavos é menor que 2⁵³. **A confirmar no primeiro teste de integração com o PostgREST** (não verificado ainda) |
| Exibição | Só formata | `formatBRL` recebe centavos; sem aritmética |
| Parcelamento (Etapa 9) | Dividir `total / n` | Feito **no SQL**; o resto dos centavos vai para a primeira parcela |
| Juros, rentabilidade, taxas (Etapas 10–11) | Multiplicar por fração | Feito **no SQL** em `numeric` |
| Percentual de orçamento | Não é dinheiro | Calculado no SQL; o front só exibe (float é aceitável para barra de progresso) |
| Gráficos | Valores convertidos para `number` | Aceitável: só desenho; o valor mostrado vem formatado de centavos |
| Importação | Somar linhas para conferência | Soma em **centavos inteiros** no navegador só para pré-visualização; a conferência oficial é a do SQL |

**Regras de código.** (1) Dinheiro no front é um tipo `Cents` (inteiro). (2) Sem `+ - * /` em reais; só em `Cents` inteiros e só para exibição transitória. (3) Qualquer cálculo com fração fica no SQL. (4) Testes unitários: `0,10 + 0,20 = 0,30`; 1.000 × `0,10` = `100,00`; ida e volta de `999.999.999.999,99`; entradas inválidas continuam recusadas.

**Impacto no que já existe.** `src/lib/format.ts` (`parseBRL`/`formatBRL`) trabalha hoje em reais. A migração para centavos é um PR próprio, com testes, antes das telas de lançamentos (Etapa 5). Nada muda agora.

## 6. Segurança (RLS)

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
- **Funções `SECURITY DEFINER` rodam como o dono das tabelas e podem ignorar a RLS.** A segurança delas **não** vem da RLS: vem de verificações internas explícitas (`auth.uid()`, papel, vínculo, limite), listadas e auditadas em [`MIGRATION-001-PLANO.md`](MIGRATION-001-PLANO.md) (seção 6.1) e cobertas por teste.
- **Cliente não escreve em `household_members` nem em `invitations`.** Só funções (RPC) validadas: `create_household(name)`, `create_invitation(email)`, `accept_invitation(token)`, `remove_member(user_id)`, `leave_household()`, `delete_household()`. Cada uma checa `auth.uid()` internamente. `create_household` cria a família, o vínculo `owner` e as categorias padrão (incluindo as duas "Sem categoria") **numa única transação**.
- Views e funções de relatório com `security invoker` (`security_invoker = true` nas views).
- **Privilégios de execução** (nada de `EXECUTE` para `PUBLIC` ou `anon`; só uma lista explícita para `authenticated`), **privilégios de coluna** (o cliente não altera `household_id`, `created_by`, `member_limit`, `token_hash`) e a matriz completa de policies estão em [`MIGRATION-001-PLANO.md`](MIGRATION-001-PLANO.md).

### Permissões
| Ação | Owner | Member |
|---|---|---|
| Ver, criar, editar e excluir lançamentos | sim | sim |
| Criar/editar/desativar contas e categorias; definir orçamentos | sim | sim |
| Convidar, remover membros; renomear ou excluir a família | sim | não |
| Sair da família | só se houver outro owner | sim |

## 7. Convites, cadastro e e-mail — ponto de atenção

**Achado:** o e-mail padrão do Supabase só entrega para endereços da **sua própria organização**, com limite de **2 por hora**, e não é feito para produção. Como a confirmação por e-mail está ativa, **a sua esposa não receberia o link de confirmação** nem e-mails de recuperação de senha.

**Correção a uma sugestão anterior:** eu disse para "fechar o cadastro". Isso só funciona **depois** que os dois usuários existirem (cadastro fechado também bloqueia o próprio cadastro dela).

**Opções:**
1. **Configurar SMTP próprio** (um serviço de e-mail) no painel do Supabase. É o caminho correto e permanente; custo e escolha do provedor a decidir.
2. **Criar o usuário dela manualmente** no painel (*Authentication → Users → Add user*, com confirmação automática). Funciona hoje, sem e-mail, mas a recuperação de senha dela continuaria sem funcionar até haver SMTP.
3. **Não** adicioná-la como membro da organização do Supabase só para receber e-mail: isso daria acesso ao painel do projeto.

**Convite dentro do app:** o dono gera um **link com token** (guardado só como hash, uso único, 7 dias) e **você o envia por WhatsApp**. O fluxo não depende de e-mail. O aceite vincula o usuário já cadastrado à família, e só funciona se o e-mail da conta que aceita for o e-mail do convite (assim um link vazado não serve a outra pessoa — ponto N5).

**Decisões 6 e 7 (aprovadas):**
1. A segunda conta é criada **de forma controlada** (painel, *Authentication → Users → Add user*, com confirmação automática) como solução **transitória**.
2. **SMTP próprio** deve estar configurado **antes** de qualquer fluxo depender de recuperação de senha por e-mail.
3. O cadastro público é **fechado depois** que as duas contas existirem; não fica aberto indefinidamente. Criar usuário pelo painel continua funcionando com o cadastro fechado.

## 8. Importação e prevenção de duplicidades

> **Formato pendente.** O Organizze documenta a exportação de lançamentos apenas como uma "planilha" enviada por e-mail e a fatura de cartão como CSV; **não documenta colunas**. Até analisarmos uma amostra real, o formato de arquivo e o mapeamento de campos são **desconhecidos** e este desenho não presume CSV nem identificador estável. As colunas abaixo entram numa migration **própria**, depois do núcleo.

### Princípio
Um *fingerprint* (hash) **sinaliza possível duplicidade; nunca descarta lançamento**. Duas despesas legítimas com mesma conta, data, valor e descrição (dois cafés iguais no mesmo dia) são comuns. Quem decide é você, na prévia.

### Estruturas (proposta)
- `import_batches`: `id`, `household_id`, `source`, `file_name`, `file_sha256`, `status` (`previewed`/`committed`/`reverted`), contagens (total, novas, possíveis duplicatas, rejeitadas), `expected_balance` + data (opcionais), `checked` (boolean), `created_by`, `created_at`, `reverted_at`.
- Em `transactions` (nulas fora de importação): `import_batch_id`, `source`, `external_id`, `fingerprint`.
- `fingerprint = hash(conta, data, valor em centavos, descrição normalizada)`. **Índice comum, sem `UNIQUE`.**
- `UNIQUE (household_id, source, external_id) WHERE external_id IS NOT NULL` **somente se** a amostra mostrar um identificador estável do Organizze. Se não houver, não existe.

### Fluxo
1. **Ler e validar no navegador**, sem gravar: data válida, valor via `parseBRL` estrito (em centavos), conta e categoria mapeáveis. Linhas inválidas vão para o **relatório de rejeições** (baixável).
2. **Mapear** contas e categorias do arquivo para as do app (você escolhe).
3. **Classificar cada linha** comparando com o banco e com o próprio arquivo:
   - **Nova**: nenhum lançamento com o mesmo fingerprint.
   - **Possível duplicata**: já existe lançamento (importado ou manual) com o mesmo fingerprint.
   - **Repetida no arquivo**: o fingerprint aparece mais de uma vez dentro do mesmo arquivo — **é tratada como legítima** (ver contagem abaixo).
   - **Arquivo já importado**: `file_sha256` igual ao de um lote anterior gera um aviso no topo, pedindo confirmação explícita.
4. **Contagem por fingerprint** (evita descartar a repetida legítima): se o arquivo tem `n` linhas com o fingerprint F e o banco já tem `m`, as primeiras `min(n, m)` (na ordem do arquivo) aparecem como *possíveis duplicatas* e as `n − m` restantes como *novas*.
5. **Prévia e confirmação**: contagens por classe, lista filtrável, efeito projetado sobre o saldo de cada conta. *Possíveis duplicatas* chegam **desmarcadas**, mas você pode marcá-las. Nada é gravado antes do botão de confirmar.
6. **Gravação**: uma RPC (`security invoker`, RLS ativo) recebe **somente as linhas confirmadas**, **revalida tudo no servidor** (tipos, limites, contas da própria família, limite de linhas por lote) e grava **em uma única transação**: uma linha inválida cancela o lote inteiro.
7. **Conferência de saldo** (decisão 13): você informa o saldo que o Organizze mostra por conta numa data; o app compara com `account_balances`. Se bater, o lote fica `checked`. Se **não** bater, o app avisa, mostra a **diferença** claramente, permite seguir e mantém o lote *não conferido*, com o botão **desfazer lote** (exclusão lógica por `import_batch_id`). **Um lote divergente nunca é marcado como reconciliado:** `checked` não é gravável pelo cliente; só a função de conferência no servidor o define, e apenas quando a diferença é exatamente zero.
8. **`opening_date` e `initial_balance` na importação**: o app **propõe** `opening_date` = primeira data importada da conta e `initial_balance` = saldo informado menos o efeito líquido das linhas importadas, e **você confirma**. Assim o histórico importado entra no saldo e as transferências importadas respeitam a regra 4.2.
9. **Transferências importadas**: como aparecem no arquivo (uma ou duas linhas) está **pendente da amostra**. Nunca se grava metade de uma transferência.

## 9. Casos de teste

Valores em reais. Contas do cenário-base: **A** (`opening_date` 01/01/2026, `initial_balance` 1.000,00) e **B** (`opening_date` 01/03/2026, `initial_balance` 500,00). Os números de saldo abaixo foram **calculados em um modelo de referência em Python** (centavos inteiros) que implementa a regra da seção 4; ainda **não** foram executados contra o SQL real, porque a função não existe. Quando existir, estes casos viram testes pgTAP.

### 9.1 Saldo e transferências (S)
| ID | Cenário | Resultado esperado |
|---|---|---|
| S1 | Sem lançamentos, saldo de A em 28/02 | A = 1.000,00 |
| S2 | Receita paga de 200,00 em A em 10/02 | A em 28/02 = 1.200,00 |
| S3 | S2 + transferência paga A→B de 300,00 em 15/03; saldo em 31/03 | A = 900,00; B = 800,00 |
| S4 | S3 + despesa paga de 50,00 em B em 15/02 (**anterior** à abertura de B) | Aceita; saldo de B em 31/03 continua 800,00; aparece no relatório de fevereiro |
| S5 | S4 + despesa **planejada** de 99,99 em A | Saldos inalterados (A = 900,00; B = 800,00); valor aparece só no total planejado |
| S6 | Transferência A→B de 300,00 em **20/02** (anterior à abertura de B) | **Rejeitada** pelo banco. *(Na regra v1 era aceita e o total de saldos perdia 300,00: 1.400,00 em vez de 1.700,00.)* |
| S7 | Transferência na própria data de abertura de B (01/03) | Aceita; conta no saldo (o dia da abertura conta) |
| S8 | Saldo com `as_of` = 28/02 | Só A aparece; B ausente |
| S9 | Mudar `opening_date` de B para 01/02 com S3 e S4 existentes | Operação aceita; saldo de B em 31/03 passa de 800,00 para **750,00** (a despesa de 50,00 passa a contar); a tela mostra o efeito antes de confirmar |
| S10 | Mudar `opening_date` de B para 20/03 com a transferência de 15/03 | **Rejeitada** (deixaria transferência anterior à abertura) |
| S11 | Excluir (lixeira) a transferência de S3 | Saldos recalculados: A = 1.200,00; B = 500,00 |
| S12 | Restaurar a transferência da lixeira depois de S10 ter sido tentado | Aceita, pois a regra continua satisfeita |
| S13 | Restaurar da lixeira uma transferência cuja data ficou anterior à abertura | **Rejeitada** na restauração |
| S14 | Editar o valor de uma receita já existente | Saldo muda na hora; nada armazenado precisa ser corrigido |
| S15 | Transferência para conta desativada | Rejeitada (ver A3) |
| S16 | Transferência com origem = destino | Rejeitada (CHECK) |
| S17 | Receita com `amount` ≤ 0 | Rejeitada (CHECK) |
| **T-INV** | Propriedade de conservação (seção 4.2) em cenários aleatórios, incluindo excluídos, planejados **e contas desativadas depois de terem movimento** | `Σ saldos(D)` de **todas** as contas abertas até D igual à fórmula em todos |

### 9.1b Contas desativadas (A)
Base: S3 já registrado (A = 900,00; B = 800,00 em 31/03).

| ID | Cenário | Resultado esperado |
|---|---|---|
| A1 | Desativar B (sem planejados em aberto) e consultar o saldo em 31/03 | B continua em `account_balances` com 800,00 e `active = false` |
| A2 | `balance_totals` em 31/03 após A1 | `total` = 1.700,00; `total_active` = 900,00; `total_inactive` = 800,00; `total = total_active + total_inactive` |
| A3 | Inserir receita, despesa ou transferência (origem **ou** destino) em B desativada | Rejeitado em todos os casos |
| A4 | Restaurar da lixeira um lançamento de B desativada | Rejeitado |
| A5 | Trocar o lançamento de A para B desativada | Rejeitado |
| A6 | Editar o valor de um lançamento já existente em B desativada | Aceito; saldo histórico de B muda |
| A7 | Desativar uma conta com lançamento planejado em aberto | Rejeitado, com mensagem pedindo para excluir ou reatribuir |
| A8 | Reativar B e inserir um lançamento | Aceito |
| A9 | Consulta histórica (28/02) depois de desativar B | B ausente por ainda não existir (`opening_date` 01/03); A presente |
| A10 | Desativar conta com saldo ≠ 0 | Aceito; a tela avisa; saldo permanece no total |
| A11 | Dois usuários simultâneos: um insere lançamento em B, outro desativa B | Um espera o outro; nunca resulta em lançamento novo numa conta desativada (teste com duas sessões) |

### 9.1c Categoria obrigatória e "Sem categoria" (C)
| ID | Cenário | Resultado esperado |
|---|---|---|
| C1 | Receita ou despesa com `category_id` nulo | Rejeitada pelo `CHECK transactions_shape` (independente da FK) |
| C2 | Transferência com categoria | Rejeitada pelo `CHECK` |
| C3 | `create_household` | Cria exatamente uma "Sem categoria" de receita e uma de despesa |
| C4 | Criar uma segunda "Sem categoria" do mesmo tipo e família | Rejeitada (índice único parcial) |
| C5 | Renomear, desativar, mover, excluir "Sem categoria" ou criar filha dela | Rejeitado |
| C6 | Lançamento de despesa usando "Sem categoria" de **receita** | Rejeitado pela FK composta (tipo diferente) |
| D1 | `delete_household` de uma família com contas desativadas, lançamentos na lixeira e as duas "Sem categoria" | Exclui tudo em cascata, sem ser barrado pelas guardas de "Sem categoria" nem pelas FKs |
| F1 | Segundo vínculo do mesmo usuário em outra família (`create_household` ou aceitar convite) | Rejeitado (`UNIQUE (user_id)`) |

### 9.2 Orçamentos e categorias (B)
| ID | Cenário | Resultado esperado |
|---|---|---|
| B1 | Inserir orçamento em categoria de **receita** | Rejeitado pela FK composta |
| B2 | Inserir orçamento informando `category_type = 'income'` | Rejeitado pelo `CHECK` |
| B3 | Inserir orçamento sem informar `category_type` em categoria de despesa raiz | Aceito (`DEFAULT 'expense'`) |
| B4 | Orçamento em **subcategoria** | Rejeitado pelo trigger |
| B5 | Orçamento com `month` fora do dia 1 | Rejeitado (CHECK) |
| B6 | Categoria mãe com orçamento 500,00; subcategoria com gasto 120,00 e mãe com 80,00 (pagos) | `budget_usage`: realizado = 200,00; restante 300,00; 40% |
| B7 | Despesa planejada e transferência na mesma categoria/mês | Não entram no realizado |
| B8 | Subcategoria cujo `type` difere do da mãe | Rejeitada pela FK composta |
| B9 | Subcategoria de subcategoria | Rejeitada pelo trigger |
| B10 | Alterar `type` de categoria que já tem lançamento ou orçamento | Rejeitado pela FK |
| B11 | Lançamento de despesa com categoria de receita | Rejeitado pela FK composta |
| B12 | Lançamento da família A com categoria ou conta da família B | Rejeitado pela FK composta |

### 9.3 Dinheiro (M) — testes unitários do front e de integração
| ID | Cenário | Resultado esperado |
|---|---|---|
| M1 | `0,10 + 0,20` somados em centavos | `30` centavos (`0,30`) |
| M2 | 1.000 lançamentos de `0,10` somados em centavos | `10000` (`100,00`) |
| M3 | Ida e volta de `"999.999.999.999,99"` (texto → centavos → string decimal → texto) | Idêntico ao original |
| M4 | `"1.2.3"`, `"1250.5.0"`, `""`, `"abc"` | Recusados (continua como hoje) |
| M5 | Envio ao banco de `125050` centavos | Corpo contém `"1250.50"` (string), nunca `1250.5` calculado por divisão |
| M6 | **Ciclo completo pelo PostgREST** (decisão 11): gravar `"1250.50"` (string), ler de volta e checar o tipo JSON recebido | Valor lido → centavos `125050` exatos; o teste **registra** se o PostgREST devolve número ou string |
| M7 | Soma SQL de 100.000 linhas de `0,10` | `10.000,00` exato |
| M8 | Gravar `"1.005"`, `"0.001"` e `"1.2301"` em `amount` direto pela API | **Rejeitados** (com `numeric(14,2)` seriam arredondados em silêncio: o teste prova que a regra N2 evita isso) |
| M9 | Gravar `"1000000000000.00"` (10¹²), `"-5"` e `"0"` em `amount`; `NaN` e `Infinity` | Rejeitados |
| M10 | Ida e volta de `"999999999999.99"` pelo PostgREST | Idêntico; sem notação científica |
| M11 | Ciclo gravar → editar → ler → lixeira → restaurar → ler | Valores idênticos em todas as leituras |
| M12 | Gravar `"1.2300"`, `"1.20"`, `"1.2"` e `"1"` em `amount` | **Aceitos** e lidos de volta como `1.23`, `1.20`, `1.20` e `1.00` (escala 2) |
| M13 | A mesma regra (M8, M9, M12 e o limite `999999999999.99`) em `accounts.initial_balance` (aceitando negativos, inclusive `-999999999999.99`, e zero) e em `budgets.amount_limit` (positivo) | Mesmo comportamento; `initial_balance` aceita zero e negativo, `amount_limit` não aceita zero |

### 9.4 Importação (I) — dependem da amostra do Organizze para fixar o formato
| ID | Cenário | Resultado esperado |
|---|---|---|
| I1 | Reimportar o mesmo arquivo | Aviso de arquivo já importado; todas as linhas como *possíveis duplicatas*; nada gravado sem confirmação |
| I2 | Duas despesas idênticas **dentro do arquivo**, nenhuma no banco | Ambas *novas*; ambas gravadas |
| I3 | Uma idêntica já no banco e duas no arquivo | 1 *possível duplicata* + 1 *nova* |
| I4 | Possível duplicata marcada manualmente pelo usuário | Gravada, e o lote registra isso |
| I5 | Uma linha inválida entre mil | Vai para o relatório de rejeições; as demais seguem para a prévia |
| I6 | Falha no servidor ao gravar o lote | Nada gravado (transação única) |
| I7 | Linha apontando para conta de outra família | RPC rejeita |
| I8 | Lote acima do limite de linhas | RPC rejeita |
| I9 | Saldo informado diverge do calculado | Lote *não conferido*, diferença exibida, importação permitida, botão desfazer lote. **`checked` continua falso**, e tentar gravá-lo pelo cliente é recusado |
| I10 | Desfazer lote | Lançamentos do lote vão para a lixeira; saldos voltam ao anterior; lançamentos manuais intactos |
| I11 | Lote de A visto por membro de B | Invisível (RLS) |
| I12 | Linha importada anterior ao `opening_date` da conta | Prévia propõe novo `opening_date`/`initial_balance` para confirmação; sem confirmar, receita/despesa não altera saldo e transferência é rejeitada |

### 9.5 Isolamento (R)
`anon` não lê nem escreve em nenhuma tabela; membro da família A lê e escreve na A; não lê, altera nem apaga nada da B; inserir lançamento da A apontando para conta da B falha (FK composta). Repetido **para cada tabela**, incluindo `import_batches`.

## 10. Decisões

### 10.1 Aprovadas em 13/10/2026 (1–14)

| # | Decisão aprovada | Onde está refletida |
|---|---|---|
| 1 | Permissões iguais para dados financeiros; **somente o owner** gerencia membros e configurações da família | Seção 6 |
| 2 | **Lixeira** com exclusão lógica (`deleted_at`) | Seções 2, 3, 4 |
| 3 | **Um** nível de subcategoria | Seção 3 |
| 4 | Categorias padrão **copiadas para cada família** | `create_household` (seção 6) |
| 5 | Limite inicial de **2 membros**, aplicado pela função de convite e fácil de alterar (`households.member_limit`) | Seção 2 |
| 6 | Segunda conta criada **de forma controlada**, como solução transitória; **SMTP próprio antes** de depender de recuperação de senha por e-mail | Seção 7 |
| 7 | Cadastro público **fechado depois** das duas contas; não fica aberto indefinidamente | Seção 7 |
| 8 | **Rejeitar** transferência anterior à abertura de qualquer das contas | Seção 4.2 |
| 9 | Orçamento **só em categoria raiz**, somando as subcategorias | Seção 3 |
| 10 | **Categoria obrigatória** em receita e despesa; "Sem categoria" distinta por tipo; garantido por **`CHECK` explícito**, não só pela FK | Seções 2 e 3 |
| 11 | **Centavos inteiros** no front e decimal exato no banco, com testes de leitura e escrita pelo PostgREST | Seção 5; testes M6–M11 |
| 12 | Possíveis duplicidades **desmarcadas por padrão**; a decisão de importá-las é sua | Seção 8 |
| 13 | Seguir após aviso de divergência, mas lote **não conferido**, diferença visível, reversão disponível e **nunca marcado como reconciliado** | Seção 8, passo 7 |
| 14 | Importação do Organizze **depois de o núcleo estar estável** e **somente após analisarmos a amostra real** | `PLANO.md` etapa 12 |

Correção desta revisão, **registrada como alteração de regra**: `active` controla só novas movimentações; as contas desativadas continuam nos totais e nas consultas históricas (seção 4.4).

**Sobre a decisão 14.** Defini "núcleo estável" como: etapas 5 e 6 concluídas (contas, categorias, lançamentos, saldos e dashboard) e todos os testes das seções 9.1–9.3 passando. Se você preferir esperar também orçamentos e relatórios (etapa 7), diga e eu ajusto o plano.

### 10.2 Pontos N1–N5 — **aprovados em 13/10/2026**

Surgiram ao detalhar a migration. N1, N3, N4 e N5 foram aprovados como recomendados; N2 foi aprovado com o ajuste da regra de escala (1.2300 aceito, 1.005 rejeitado).

| # | Ponto | Recomendação |
|---|---|---|
| N1 | Um usuário pertence a **uma** família (`UNIQUE (user_id)` em `household_members`) | Sim na v1: simplifica a tela e as policies. Relaxar depois é uma migration pequena |
| N2 | `numeric` com `CHECK (x = round(x, 2) and abs(x) < 1e12)` em vez de `numeric(14,2)`, para **recusar** em vez de arredondar em silêncio; aceita `1.2300` como `1.23` | **Aprovado com ajuste** (seção 2). Testes M8, M9, M12, M13 |
| N3 | Conta com lançamento planejado em aberto **não pode ser desativada**; edição de lançamento antigo de conta desativada é permitida | Sim (seção 4.4) |
| N4 | Sem limpeza automática da lixeira na v1; o cliente nunca apaga lançamento de vez | Sim. Política de retenção fica para depois |
| N5 | Aceitar convite exige que o e-mail da conta seja o do convite | Sim |

**Lista de categorias padrão** (decisão 4) — **aprovada**, com `Compras pessoais` e `Viagens` acrescentadas em despesas. Todas editáveis e desativáveis; o usuário pode criar outras:
- Receita: Salário, Rendimentos, Outras receitas, *Sem categoria*.
- Despesa: Moradia, Mercado, Restaurantes, Transporte, Saúde, Educação, Lazer, Assinaturas, Compras pessoais, Viagens, Impostos e taxas, Outras despesas, *Sem categoria*.

## 11. Como o núcleo aceita os módulos futuros

> *Atualizado em 16/10/2026.* Cartões e dívidas foram implementados de outro jeito (**modelo B**, migrations 002 e 003), e não como estava previsto na primeira versão desta seção. O texto anterior dizia que "o pagamento de parcela é uma despesa em conta", o que **contradiz o modelo B** e não vale mais.

- **Cartões e dívidas (modelo B, migrations 002 e 003):** tabelas próprias `debts` (tipo `card`, `loan` ou `financing`), `debt_invoices`, `debt_installments` e `debt_events` (registro só de inclusão; correções por anulação auditada). Nada disso cria colunas em `transactions`.
  - **Compra no cartão** é despesa na competência e aumenta a dívida; não mexe em conta.
  - **Pagamento** (`debt_pay`) sai da conta e **reduz a dívida**: não é despesa, então nada é contado duas vezes.
  - **Empréstimo e financiamento:** o principal entra inteiro na dívida no desembolso; **amortização nunca é despesa**; só **juros e tarifas** são despesa (`debt_loan_event`).
  - **Parcelas** (`debt_installments`) existem **só em cartão** (migration 003): são compromisso futuro que vira dívida quando cobrado. Cronograma de empréstimo é um conceito futuro e separado (ver `PLANO.md`).
- **Investimentos (Etapa 11):** tabelas de ativos e posições; aporte é transferência, **não é despesa**.
- **Patrimônio líquido (Etapa 12):** consulta que une saldos, investimentos, dívidas e faturas em aberto. Já existe em parte: `net_worth()` (migration 002) = disponível + crédito a receber − dívida, com compromissos futuros à parte; investimentos entram quando o módulo existir.
- **Recorrência e multimoeda:** requisitos registrados no `PLANO.md` em 16/10/2026, **ainda sem desenho**. A multimoeda mexe no núcleo (moeda por conta, câmbio, saldos e patrimônio), então será proposta aqui antes de qualquer migration.

`text` + `CHECK` permite acrescentar tipos de conta (cartão, investimento) com uma migration simples.

## 12. Ordem de implementação da Etapa 3

Implementação **autorizada em 13/10/2026 somente em banco local descartável e CI** (nada no Supabase hospedado). Plano em [`MIGRATION-001-PLANO.md`](MIGRATION-001-PLANO.md).

1. Migration de schema + constraints + triggers de integridade (seções 2–3, 4.2 e 4.4).
2. Migration de RLS, privilégios e funções privadas.
3. Migration das RPCs de família e convite.
4. Migration das funções de saldo, resumo e orçamento.
5. Testes pgTAP e de PostgREST (seção 9) — escritos junto de cada migration, não depois.
6. Só então conectar telas (Etapas 4–5), precedido do PR de centavos (decisão 11).
7. A migration de importação (seção 8) vem depois do núcleo estável e **depende da amostra do Organizze**; nada específico do formato é implementado antes disso.
