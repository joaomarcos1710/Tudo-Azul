# Modelo de dados e segurança — Etapa 3 (proposta para revisão, v2)

> **Status:** proposta. Nada foi gravado no banco e **nenhuma migration existe**. Este documento valida relações, permissões e regras de saldo **antes** da primeira migration.
> Os trechos de SQL são esboços para discutir o desenho, não migrations finais.
>
> **v2 (13/10/2026):** revisão após a análise do ChatGPT. Mudanças: (1) plano e este documento alinhados; (2) semântica formal de `initial_balance`/`opening_date` e nova regra para transferências; (3) integridade completa de `budgets` e `categories`; (4) seção de precisão monetária; (5) importação com detecção de *possíveis* duplicidades, nunca descarte automático; (6) casos de teste explícitos; (7) novas decisões abertas.

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
| `households` | `id`, `name`, `created_by`, `created_at` | — |
| `household_members` | `id`, `household_id`, `user_id`, `role` (`owner`/`member`), `joined_at` | `UNIQUE (household_id, user_id)`; deve existir sempre ao menos 1 `owner` |
| `invitations` | `id`, `household_id`, `email`, `token_hash`, `role`, `expires_at`, `accepted_at`, `invited_by` | Token guardado só como hash; uso único; validade de 7 dias |
| `accounts` | `id`, `household_id`, `name`, `type` (`checking`/`savings`/`cash`/`other`), `initial_balance`, `opening_date`, `active`, `created_at` | `UNIQUE (household_id, id)`; semântica de saldo na seção 4 |
| `categories` | `id`, `household_id`, `name`, `type` (`income`/`expense`), `parent_id`, `color`, `icon`, `active` | `UNIQUE (household_id, id, type)`; só 1 nível; filha tem o **mesmo tipo** da mãe (seção 3) |
| `transactions` | `id`, `household_id`, `account_id`, `destination_account_id`, `category_id`, `type` (`income`/`expense`/`transfer`), `description`, `amount`, `date`, `status` (`paid`/`planned`), `notes`, `created_by`, `created_at`, `updated_at`, `deleted_at` | Seções 3 e 4 |
| `budgets` | `id`, `household_id`, `category_id`, **`category_type`**, `month`, `amount_limit`, `created_at` | `UNIQUE (household_id, category_id, month)`; `month` sempre dia 1; **só categoria de despesa e de nível raiz** (seção 3) |

### Regras em `transactions`
```sql
amount numeric(14,2) not null check (amount > 0),
-- transferência exige destino diferente da origem e não tem categoria
check ( (type = 'transfer' and destination_account_id is not null
         and destination_account_id <> account_id and category_id is null)
     or (type <> 'transfer' and destination_account_id is null) )
```
Uma transferência é **uma única linha** (origem + destino). Assim as duas pontas nunca ficam inconsistentes, e as duas contas são ajustadas pela mesma regra de saldo.

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
| Transferência: data não anterior ao `opening_date` de **nenhuma** das contas; ambas ativas | trigger em `transactions` (seção 4) |
| Mudar `opening_date` de uma conta não pode deixar transferência anterior à nova data | trigger em `accounts` (seção 4) |

Os triggers leem as contas com `FOR SHARE` (e o de `accounts` bloqueia a linha) para que duas transações simultâneas não furem a regra.

Colunas nulas não disparam a verificação da FK (`MATCH SIMPLE`), então transferências (sem categoria) passam normalmente. Consequência: a FK sozinha **não obriga** receita/despesa a ter categoria — ver decisão 10.

Exclusão: `ON DELETE RESTRICT` em contas e categorias. Quem tem histórico é **desativado** (`active = false`), nunca apagado.

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
`security invoker` faz a função respeitar o RLS de quem chama.

### 4.2 Transferências entre contas com `opening_date` diferentes (revisão)

**Problema da v1.** Cada ponta seguia a regra da própria conta. Uma transferência anterior à abertura da conta de destino debitava a origem e **não creditava** o destino: o dinheiro sumia do total. A v1 aceitava isso e só prometia "avisar na tela". Medido em um modelo de referência com 3 contas e 10 transferências aleatórias, essa regra violou a conservação em **2.479 de 3.000** cenários. Não é um caso de canto.

**Regra da v2 (recomendada, aguarda sua aprovação — decisão 8):**
> Uma transferência exige `date >= opening_date` das **duas** contas e as duas ativas. Caso contrário o banco **rejeita** com mensagem clara.

Aplica-se a lançamentos não excluídos, em qualquer `status`, na criação, na edição e na **restauração da lixeira**. Em contrapartida:
- **Receita e despesa anteriores à abertura continuam permitidas** (decisão sua, v1): entram em relatórios e orçamentos do mês, mas não alteram o saldo; a tela avisa ao salvar.
- **Mudar `opening_date` de uma conta** é uma operação explícita: a tela mostra o efeito sobre o saldo antes de confirmar, e o banco recusa se algum lançamento de transferência ficaria anterior à nova data.

**Propriedade que a regra garante (invariante testável).** Para qualquer data D:
```
Σ saldos(D) = Σ initial_balance das contas abertas até D
            + Σ (receitas pagas − despesas pagas) com opening_date_da_conta <= date <= D
```
Ou seja, **só receita e despesa mudam o total; transferência nunca muda**. Validado em modelo de referência (centavos inteiros) em 3.000 cenários aleatórios com contas, aberturas, lançamentos excluídos e planejados. Isso é **prova no modelo, não prova no banco**: o teste pgTAP T-INV repete a propriedade contra a função SQL real.

### 4.3 Regras decorrentes (precisam estar claras na tela)
- **Saldo total do dashboard** = soma de `account_balances` apenas das contas `active`, na data selecionada.
- **Conta que ainda não existia na data D** (`opening_date > D`) não aparece no resultado. O total histórico antes da abertura, portanto, não inclui o `initial_balance` dela.
- **Planejado (`planned`)** nunca entra em saldo, receita ou despesa realizados. Aparece em totais separados.
- **Recuar o `opening_date`** para que o histórico entre no saldo exige ajustar o `initial_balance` junto (a tela guia isso e mostra o saldo antes/depois).

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
- **Cliente não escreve em `household_members`.** Só funções (RPC) validadas: `create_household(name)`, `create_invitation(email)`, `accept_invitation(token)`, `remove_member(user_id)`. Cada uma checa `auth.uid()` internamente. `create_household` cria a família, o vínculo `owner` e as categorias padrão **numa única transação**.
- Views e funções de relatório com `security invoker` (`security_invoker = true` nas views).

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

**Convite dentro do app:** o dono gera um **link com token** (guardado só como hash, uso único, 7 dias) e **você o envia por WhatsApp**. O fluxo não depende de e-mail. O aceite vincula o usuário já cadastrado à família.

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
7. **Conferência de saldo**: você informa o saldo que o Organizze mostra por conta numa data; o app compara com `account_balances`. Se bater, o lote fica `checked`. Se não bater, mostra a **diferença** e o lote continua *não conferido*, com o botão **desfazer lote** (exclusão lógica por `import_batch_id`).
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
| S15 | Transferência para conta inativa | Rejeitada |
| S16 | Transferência com origem = destino | Rejeitada (CHECK) |
| S17 | Receita com `amount` ≤ 0 | Rejeitada (CHECK) |
| **T-INV** | Propriedade de conservação (seção 4.2) em cenários aleatórios, incluindo excluídos e planejados | `Σ saldos(D)` igual à fórmula em todos |

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
| M6 | Valor `numeric` retornado pelo PostgREST | Convertido sem perda para centavos (**confirmar o formato real no primeiro teste**) |
| M7 | Soma SQL de `numeric(14,2)` com 100.000 linhas de `0,10` | `10.000,00` exato |

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
| I9 | Saldo informado diverge do calculado | Lote *não conferido*, diferença exibida; botão desfazer lote |
| I10 | Desfazer lote | Lançamentos do lote vão para a lixeira; saldos voltam ao anterior; lançamentos manuais intactos |
| I11 | Lote de A visto por membro de B | Invisível (RLS) |
| I12 | Linha importada anterior ao `opening_date` da conta | Prévia propõe novo `opening_date`/`initial_balance` para confirmação; sem confirmar, receita/despesa não altera saldo e transferência é rejeitada |

### 9.5 Isolamento (R) — já previstos
`anon` não lê nem escreve em nenhuma tabela; membro da família A lê e escreve na A; não lê, altera nem apaga nada da B; inserir lançamento da A apontando para conta da B falha (FK composta). Repetido **para cada tabela**, incluindo `import_batches`.

## 10. Decisões abertas (com recomendação)

**Herdadas (1–7)**

| # | Decisão | Recomendação |
|---|---|---|
| 1 | Permissões iguais para dados financeiros; só o owner gerencia membros | Sim, conforme a tabela da seção 6 |
| 2 | Exclusão de lançamento: apagar de vez ou **lixeira** (`deleted_at`) | **Lixeira.** Com dois usuários, um apagar sem querer é plausível, e o saldo derivado não dá como recuperar. Custa um filtro nas funções |
| 3 | Subcategorias | **1 nível** (categoria → subcategoria), garantido por trigger |
| 4 | Categorias padrão | **Copiadas para cada família** na criação (editáveis e desativáveis), em vez de linhas globais |
| 5 | Limite de membros por família | Sem limite no esquema; limite de **2** na função de convite (constante fácil de mudar) |
| 6 | E-mail | Opção 1 (SMTP próprio) em médio prazo; opção 2 como solução imediata |
| 7 | Cadastro aberto ou fechado | Aberto até ambos terem conta, depois fechado |

**Novas desta revisão (8–14)**

| # | Decisão | Recomendação |
|---|---|---|
| 8 | Transferência anterior à abertura de uma das contas | **Rejeitar** (seção 4.2). Alternativa: aceitar e exibir um aviso de que o total de saldos não conserva — **não recomendo**, pois cria divergência silenciosa |
| 9 | Orçamento em subcategoria | **Só em categoria raiz**; subcategoria soma na mãe. Alternativa (orçamento por subcategoria) exige regra para não contar duas vezes |
| 10 | Categoria obrigatória em receita/despesa | **Sim**, com "Sem categoria" (uma por tipo) criada junto com as categorias padrão — serve também de destino na importação. Sem isso, a FK composta aceita categoria nula |
| 11 | Dinheiro no front como centavos inteiros (`Cents`), PR próprio antes da Etapa 5 | Sim (seção 5) |
| 12 | Possíveis duplicatas na importação chegam **desmarcadas**, com confirmação | Sim. Alternativa: marcadas por padrão — mais rápido, porém arrisca duplicar |
| 13 | Divergência de saldo após importar: bloqueia ou só avisa | **Só avisa** e deixa o lote *não conferido* com "desfazer lote", pois os dados já estão no banco e o desfazer é seguro |
| 14 | Antecipar a importação do Organizze para logo depois da Etapa 6 (antes dos módulos) | **Sim, se a amostra chegar.** Dados reais são o melhor teste das regras de saldo, e você passa a usar o app sem manter dois sistemas. Custo: adia cartões e dívidas |

## 11. Como o núcleo aceita os módulos futuros

- **Cartões (Etapa 9):** novas tabelas `credit_cards`, `invoices`; campos `invoice_id`, `installment_group_id`, `installment_number` em `transactions` (colunas nulas, adicionadas por migration). Pagar a fatura é uma transferência conta → fatura, **sem contar despesa duas vezes**. A regra 4.2 (transferência não anterior à abertura) vale também aqui.
- **Dívidas (Etapa 10):** tabelas próprias; o pagamento de parcela é uma despesa em conta, ligada ao contrato.
- **Investimentos (Etapa 11):** tabelas de ativos e posições; aporte é transferência, **não é despesa**.
- **Patrimônio líquido (Etapa 12):** consulta que une saldos, investimentos, dívidas e faturas em aberto.

`text` + `CHECK` permite acrescentar tipos de conta (cartão, investimento) com uma migration simples.

## 12. Ordem de implementação da Etapa 3

Só começa após você fechar as decisões da seção 10 e aprovar este documento.

1. Migration de schema + constraints + triggers de integridade (seções 2–3 e 4.2).
2. Migration de RLS + funções privadas + RPCs.
3. Funções de saldo, resumo e orçamento.
4. Testes pgTAP (isolamento, restrições, saldo e conservação, orçamentos — seção 9).
5. Só então conectar telas (Etapas 4–5), precedido do PR de centavos (decisão 11).
6. A migration de importação (seção 8) vem depois do núcleo estável e depende da amostra do Organizze.
