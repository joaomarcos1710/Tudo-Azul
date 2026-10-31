# Proposta: início operacional em 11/2026 e suporte a histórico retroativo

> **Status em 31/10/2026: proposta histórica de 13/10, não aprovada como especificação.** Partes já foram superadas
> pelo produto atual: a conferência com o extrato foi implementada na migration 007 e depois descontinuada na PR #110; os registros permanecem somente para leitura/exportação. Cartões e
> dívidas foram implementados com outro desenho (migrations 003 a 010). A meta atual de largar o Organizze é
> 01/12/2026 ([[01 - Visão e metas]] em `docs/projeto/`). Use este texto como histórico de raciocínio, não como plano.
>
> **Status original: proposta para aprovação. Nada implementado, nenhuma migration, nada no Supabase hospedado.**
> A mensagem que originou este documento chegou **cortada** (parou em "caso esse recebimento…", no item 4, Financiamentos). Os itens 1–4 foram tratados; se havia mais requisitos depois, preciso deles.
> Base: [`MODELO-DE-DADOS.md`](MODELO-DE-DADOS.md) v3 e as migrations do PR #7 (lidas, não alteradas).

## 1. Decisão de negócio e o que o núcleo já faz

Início operacional: **01/11/2026**, contas e cartões com saldo zero no app, **sem piso global de datas**.

| Requisito | Estado atual (PR #6/#7) | Lacuna |
|---|---|---|
| Sem validação global que proíba datas anteriores a 01/11/2026 | **Atendido.** O único limite é de sanidade: `date between 2000-01-01 and 2100-01-01` | Nenhuma. Não criar `CHECK` com a data de início |
| Receita/despesa retroativa | Permitida; **não altera o saldo** se `date < opening_date` da conta | A tela avisa, mas nada mostra o que ficou "de fora" do saldo |
| Transferência retroativa | **Rejeitada** se anterior à abertura de qualquer das contas (decisão 8) | Falta caminho explícito para "cadastrar histórico": é a operação de reabertura (seção 5) |
| Relatórios | `period_summary` soma **todas** as receitas/despesas pagas por data, **sem olhar `opening_date`**; `account_balances` só conta a partir da abertura | **Inconsistência a documentar:** o resultado do período pode incluir movimentos que o saldo ignora |
| Conciliação com banco real | Só prevista na importação (decisão 13) | Não existe conciliação fora da importação |
| Cartão, parcelas, dívidas | Módulos das etapas 9–10, sem tabelas | Este documento fixa as regras que o núcleo precisa respeitar (seções 8–9) |

Conclusão: **o núcleo já aceita histórico retroativo sem mudança estrutural**. O que falta são três coisas pequenas e aditivas: reabertura de conta, conciliação e auditoria.

## 2. Datas: cada uma com um papel

| Data | Onde vive | Papel |
|---|---|---|
| Início operacional da família | `households.operational_start` (nova, **só informativa**, pode ser nula) | Padrão de `opening_date` para contas novas e texto de tela. **Não participa de nenhum `CHECK`, trigger ou cálculo** |
| `opening_date` da conta | `accounts` (já existe) | Quando o controle **daquela conta** começa; `initial_balance` vale no início desse dia |
| Data da movimentação | `transactions.date` | Quando ocorreu de fato. Livre, exceto transferência (seção 4) |
| Data de compra original | `installment_plans.purchase_date` (módulo cartões) | Quando a compra foi feita |
| Competência da parcela | `installments.reference_date` | Mês em que a parcela pesa nos relatórios |
| Vencimento | `installments.due_date` | Quando deve ser paga |
| Pagamento | `installments.paid_date` / `transactions.date` do pagamento | Quando o dinheiro saiu |
| Registro no app | `created_at` (já existe) | Prova de **quando** foi cadastrado; "retroativo" = `date` muito anterior a `created_at` |

## 3. Saldo inicial zero: o que ele significa e o ponto fraco

Zero no app é **configuração**, não o saldo do banco. Consequências que a tela precisa tornar visíveis:

1. O "saldo" mostrado é, na prática, **variação desde 01/11**, não dinheiro disponível.
2. **O patrimônio líquido fica errado** enquanto a conta tiver saldo real ≠ 0: ativos subestimados, e cartões/financiamentos preexistentes ausentes do passivo.
3. Os relatórios de fluxo (receita, despesa, orçamento) **não** sofrem: dependem das movimentações, não do saldo.

**Crítica à decisão:** zero é o jeito mais rápido de começar, mas é o que mais cedo gera um número que parece verdadeiro e não é. Minha recomendação: aceitar o zero **com estado explícito** `não conciliada` por conta (seção 6), e mostrar o patrimônio com a faixa "contas sem saldo real informado: N". Informar o saldo real de 31/10 como `initial_balance` não é histórico retroativo e custa um campo; fica como opção, não como exigência.

## 4. Regras para movimentações retroativas

| Caso | Regra | Efeito no saldo |
|---|---|---|
| **A.** Receita/despesa com `date < opening_date` da conta | Permitida (decisão da v1). Marcada como "anterior à abertura" (derivado, não gravado) | Nenhum |
| **B.** Transferência com `date < opening_date` de qualquer conta | **Rejeitada** (decisão 8, preserva a conservação) | — |
| **C.** Retroativo com `opening_date <= date <= hoje` | Permitida | Saldo muda de `date` em diante; **conciliações anteriores a `date` ficam "desatualizadas"** (derivado) |
| **D.** Trazer o histórico para dentro do saldo | Só pela **reabertura** (seção 5) | Controlado e visível |

Por que B continua: sem a regra, a transferência debitaria a origem e não creditaria o destino (violou a conservação em 2.479 de 3.000 cenários no modelo de referência). Não é uma data proibida, é a mesma regra que protege o total. Para cadastrar uma transferência antiga, **recua-se a abertura das duas contas antes**.

**Onde nasce a dupla contagem** (e como se evita):

- Cada movimentação é contada **uma vez**, pela data (saldos são derivados). Não há dupla contagem entre movimentos.
- A dupla contagem real é **conceitual**: o `initial_balance` já inclui o passado (ex.: saldo real de 31/10) e o usuário cadastra o passado depois. A reabertura **não aceita** manter o `initial_balance` e recuar a data; ela força um dos dois modos abaixo.

## 5. Reabertura: reconstruir o histórico sem ajuste artificial

Operação `reopen_account(account, new_opening_date, mode, informed_balance)` — `security definer` com verificações internas (como as RPCs de família), uma transação, `FOR UPDATE` na conta.

Sejam `O` a abertura atual, `N < O` a nova, `I` o saldo inicial atual e `S` a soma dos efeitos das movimentações pagas em `[N, O-1]`.

| Modo | Novo `initial_balance` | Propriedade |
|---|---|---|
| **A. Preservar o saldo atual** | `I − S` | O saldo em qualquer data `≥ O` **não muda**. O `initial_balance` em `N` é consequência, não afirmação |
| **B. Informar o saldo real em `N`** | o valor informado | O saldo atual **muda** em `informado − (I − S)`. A diferença aparece na conciliação; **nada a esconde** |

**Exemplo.** Conta aberta em 01/11/2026 com saldo 0. O usuário cadastra de 01/01 a 31/10 receitas de 5.000,00 e despesas de 3.750,00 (`S = +1.250,00`).
- Modo A: abertura 01/01, `initial_balance = −1.250,00`. Saldo em 31/10 continua 0. O número negativo **avisa** que o zero original não era real ou que falta histórico.
- Modo B: o banco mostra 3.000,00 em 01/01. Abertura 01/01, `initial_balance = 3.000,00`; saldo em 31/10 passa a 4.250,00. Se o banco dizia 4.100,00, a diferença de 150,00 fica **visível**, não é absorvida.

Guardas: prévia obrigatória (saldo antes/depois por data), token de confirmação com o saldo atual esperado (recusa se mudou no meio), reabertura só para trás, transferências existentes continuam válidas, tudo registrado em auditoria (seção 11).

**Não haverá lançamento de "ajuste de conciliação"** na v1. Divergência se resolve cadastrando o que falta, corrigindo o que está errado ou reabrindo em modo B.

## 6. Conciliação com o saldo bancário real

```sql
-- ESBOÇO (não é migration)
balance_checkpoints(
  id, household_id, account_id, as_of date,
  informed_balance numeric,      -- digitado pelo usuário, regra de dinheiro N2
  computed_balance numeric,      -- calculado no servidor na hora do registro
  difference numeric,            -- informed - computed, calculado no servidor
  created_by, created_at,
  -- append-only: sem UPDATE e sem DELETE para o cliente
  foreign key (household_id, account_id) references accounts (household_id, id))
```

- O cliente **nunca** grava `computed_balance` nem `difference` (função no servidor, como `checked` na decisão 13).
- Estado da conta, **derivado**: `sem conciliação`; `conciliada` (último checkpoint com diferença 0 **e** nenhuma alteração retroativa depois dele); `divergente`; `desatualizada` (movimento retroativo mexeu em data ≤ `as_of` depois do checkpoint).
- Conciliação é por **conta e data**; várias ao longo do tempo formam a trilha de auditoria.

## 7. Relatórios: incluir ou excluir o período histórico

Duas bases, nomeadas na tela:

| Base | Definição | Usa `opening_date`? |
|---|---|---|
| **Saldo / patrimônio** | `account_balances` e derivados | Sim, a partir da abertura de cada conta |
| **Fluxo** (receita, despesa, orçamento, categorias) | Movimentações por `date` | Não: o ano de 2025 mostra 2025, mesmo com a conta aberta em 2026 |

Proposta: `period_summary` e `budget_usage` passam a devolver também `income_pre_opening` e `expense_pre_opening` (parte do total anterior à abertura da conta). Assim o usuário vê que **resultado do período − variação de saldo = movimentos pré-abertura**, em vez de descobrir sozinho. Evolução do patrimônio **começa na abertura mais antiga**; antes disso não há dado, e o gráfico não inventa zero.

## 8. Compras parceladas anteriores ao início (módulo de cartões, etapa 9)

```sql
-- ESBOÇO
installment_plans(id, household_id, card_id /*ou account_id*/, description, category_id,
  purchase_date, total_amount, n_installments, currency, created_by, created_at)
installments(id, household_id, plan_id, number, principal, interest, fees,
  amount /* = principal + interest + fees, por CHECK */,
  reference_date, due_date, paid_date null, status /* paid | open | planned */,
  invoice_id null, unique (plan_id, number))
```

- Juros e encargos ficam **separados** do principal (categoria "Juros e encargos"); a soma das parcelas fecha com o total mais encargos, restos de centavos na primeira parcela (regra já existente).
- **Unicidade**: `unique (plan_id, number)` impede a mesma parcela duas vezes; a chave do plano (cartão + data + total + descrição normalizada) alimenta a detecção de duplicidade na importação.
- **Sem despesa duplicada** — invariante de módulo: *despesa de uma compra parcelada = parcelas; pagamento de fatura nunca é despesa* (é transferência conta → cartão, como no `PLANO.md`).
- **Fatura histórica já paga** (antes da abertura da conta pagadora): cadastra-se a fatura como `paga` com `paid_date` e **sem conta pagadora**, e **sem** transferência. Assim não cai no bloqueio B e não mexe em saldo.
- **Parcelas pendentes** (vencimento após 01/11): entram como passivo do cartão e como despesa **na competência de cada parcela**. Sem cadastrá-las, o passivo some do patrimônio.

**Decisão necessária (D-H2):** reconhecer a despesa **por parcela** (recomendado: cada mês pesa o que será pago; é o que Organizze/Mobills mostram) ou **na data da compra** (a compra de junho pesa inteira em junho). Escolher um e usar em todo o módulo; trocar depois reescreve relatórios.

## 9. Financiamentos e dívidas preexistentes (etapa 10)

> Trecho final do requisito cortado. Abaixo, o que se deduz: o recebimento original **não vira receita**.

```sql
-- ESBOÇO
debts(id, household_id, description, contract_date, contracted_amount, currency,
  reference_date, balance_at_reference, rate_note, created_by, created_at)
debt_installments(id, household_id, debt_id, number, due_date, principal, interest, fees,
  paid_date null, status, transaction_id null)
debt_events(id, household_id, debt_id, date, kind /* extra_amortization | fee | refinance */,
  amount, effect /* reduce_term | reduce_installment */)
```

| Fato | Tratamento | Receita/despesa? |
|---|---|---|
| Dinheiro recebido **antes** de 01/11 | Metadado do contrato (`contract_date`, `contracted_amount`); nenhuma movimentação | Nenhuma |
| Dinheiro recebido **depois** | Entrada na conta contra o passivo (não é `income`) | Nenhuma; patrimônio inalterado |
| Parcela paga: principal | Reduz o saldo devedor | Não é despesa |
| Parcela paga: juros e encargos | Despesa (categoria "Juros e encargos") | Despesa |
| Amortização extraordinária | Reduz o principal na data; opção de reduzir prazo ou parcela | Não é despesa |

- A verdade na data de referência é `balance_at_reference`; o **cronograma anterior é opcional** (só histórico). `saldo_devedor(D) = balance_at_reference − Σ principal pago em (reference_date, D] + novos desembolsos`.
- **Decisão técnica (D-H3):** modelar o passivo como **conta do tipo `liability`** (saldo negativo; principal pago e desembolso viram transferências, reaproveitando a conservação) ou como saldo derivado só das tabelas da dívida. Recomendo `liability`, mas isso obriga `balance_totals` a separar **disponível** de **patrimônio** (ativos − passivos).
- Atenção: o `CHECK` global `date >= 2000-01-01` bloqueia financiamentos mais antigos que isso. Improvável aqui; registro para não surpreender.

## 10. Impactos

| Área | Impacto |
|---|---|
| **Organizze** | A importação histórica fica **adiada** (primeira etapa não importa). Quando vier, usa a reabertura (modo A ou B) por conta, nunca `initial_balance` fixo. O plano de preparação continua válido (`IMPORTACAO-ORGANIZZE.md`) |
| **Multimoeda** | Reabertura, conciliação e checkpoints são **por conta, na moeda da conta**. Ver [`PROPOSTA-MULTIMOEDA.md`](PROPOSTA-MULTIMOEDA.md) |
| **Investimentos** | Posição inicial = quantidade e custo na data de referência, mesma lógica da conta; aporte antigo não é despesa |
| **Patrimônio líquido** | Correto só com contas conciliadas + cartões e dívidas cadastrados; a tela mostra o que falta |
| **Orçamento** | Usa fluxo (data), não saldo; não muda |

## 11. Auditoria

`audit_events(id, household_id, actor, at, action, entity, entity_id, detail jsonb)`, append-only, RLS por família, escrito só por funções. Registra: reabertura (antes/depois), checkpoints, restauração da lixeira e lançamentos com `date` mais de **N** dias antes de `created_at` (limiar a definir). `created_at` e `deleted_at` já existem; "retroativo" é derivado, não gravado.

## 12. Testes (a escrever só após aprovação)

| ID | Cenário | Esperado |
|---|---|---|
| H1 | Despesa em 15/10/2026 numa conta aberta em 01/11 | Aceita; saldo inalterado; marcada "anterior à abertura" |
| H2 | Transferência em 15/10 | Rejeitada (23514) |
| H3 | Reabertura modo A | Saldo em todas as datas ≥ `O` idêntico ao anterior |
| H4 | Reabertura modo B | Saldo atual muda exatamente `informado − (I − S)`; checkpoint mostra a diferença |
| H5 | Reabertura para frente | Recusada |
| H6 | Reabertura com saldo esperado desatualizado | Recusada (concorrência) |
| H7 | Invariante de conservação após reabertura, 3.000 cenários aleatórios | Σ saldos = Σ iniciais + receitas − despesas |
| H8 | Cliente tenta gravar `computed_balance` | Recusado (privilégio de coluna) |
| H9 | Retroativo em data ≤ `as_of` de um checkpoint | Estado vira `desatualizada` |
| H10 | `period_summary` com receita pré-abertura | `income_pre_opening` correto; total por data inalterado |
| H11 | Não existe `CHECK`/trigger com a data 2026-11-01 | Inspeção do catálogo |
| H12 | Isolamento de `balance_checkpoints` e `audit_events` entre famílias, `anon` sem acesso | Padrão da seção 9.5 |
| H13 | Plano parcelado: Σ parcelas = total + encargos; resto na 1ª | Exato em `numeric` |
| H14 | Fatura histórica paga sem conta | Nenhuma transferência, nenhuma despesa extra |
| H15 | Cadastro duplicado da mesma parcela | Recusado por `unique` |
| H16 | Recebimento de financiamento | Não altera receita; patrimônio inalterado |

## 13. Decisões que preciso de você

| # | Decisão | Recomendação |
|---|---|---|
| D-H1 | Zero inicial com estado "não conciliada" visível, ou exigir saldo real de 31/10 | Zero + estado visível; saldo real opcional |
| D-H2 | Despesa parcelada por parcela ou na compra | Por parcela |
| D-H3 | Passivo como conta `liability` ou derivado | `liability` |
| D-H4 | Sem lançamento de "ajuste de conciliação" na v1 | Sim |
| D-H5 | Reabertura em modo A e B | Os dois, com prévia |
| D-H6 | Limiar de "retroativo" na auditoria (N dias) | 30 dias |
| D-H7 | `households.operational_start` informativa | Sim |
| D-H8 | Resto do requisito (mensagem cortada) | Reenviar |

## 14. Riscos

1. **Zero que parece verdadeiro:** patrimônio errado sem aviso. Mitigação: estado da conta e faixa no dashboard.
2. **Modo B mal usado** gera diferença grande de uma vez. Mitigação: prévia e checkpoint imediato.
3. **Resultado ≠ variação de saldo** se `period_summary` não separar pré-abertura (seção 7).
4. **Reconhecimento de despesa parcelada** muda relatórios se for trocado depois (D-H2).
5. **Reabertura concorrente:** exige `FOR UPDATE` e token de saldo esperado.
6. **Passivo como conta** muda `balance_totals` (disponível × patrimônio): alteração em função já escrita no PR #7, em migration aditiva própria.

## 15. Não verificado

Nenhum SQL deste documento foi executado. As propriedades da reabertura (H3, H4, H7) estão **deduzidas da regra de saldo**, não testadas. O comportamento atual de `period_summary` foi lido no código do PR #7, não executado.
