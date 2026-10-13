# Importação do Organizze — plano de preparação

> **Status: análise e documentação. Nada foi implementado, aplicado ou gravado.**
> Não há importador, migration nem dados neste repositório. Os relatórios com dados reais
> (contas, categorias, pessoas, valores) ficam fora do Git, com o dono dos dados.

## 1. Decisões de trabalho (do dono do projeto)

1. **Escopo inicial:** só contas e carteiras em BRL, depois de uma lista exata de abas incluídas e excluídas. A moeda nunca é deduzida só pelo nome da conta; é presumida e **confirmada pelo usuário** por conta.
2. **Cartões:** compras e pagamentos de fatura ficam fora da importação ativa até existir um modelo que os relacione sem duplicar despesa. Os dados são preservados na preparação.
3. **Moeda estrangeira e investimentos:** adiados até os módulos existirem.
4. **Categorias:** mapeamento origem → categoria de receita/despesa, **separado por tipo** quando a origem aparece com os dois sinais. Nenhum mapeamento é definitivo sem aprovação.
5. **Nomes de pessoas usados como categoria:** não são classificados automaticamente.
6. **Tags:** estrutura normalizada com isolamento por família; texto original preservado.
7. **Transferências:** só pares provados viram transferência; ambíguos e aproximados ficam em lista separada.
8. **Parcelas:** descrição original preservada; sem agrupamento automático sem evidência suficiente.
9. **Possíveis duplicados:** nunca descartados automaticamente; relatório de candidatos.
10. **Valor zero e registros inválidos:** relatório de rejeição com motivo e dado de origem preservado.
11. **Saldo inicial:** nunca inventado; planilha por conta para o usuário preencher.
12. **Histórico incompleto:** descreve-se o período coberto por conta, sem concluir que anos anteriores não existem.

## 2. O que o arquivo do Organizze tem (e não tem)

- Uma aba por conta ou cartão. Abas de cartão trazem a coluna de fatura em vez de situação.
- **Não tem:** coluna de tipo (só o sinal do valor), saldo inicial, moeda nem identificador de lançamento.
- Consequências: a deduplicação precisa de chave derivada; a moeda é presumida; o saldo inicial vem do usuário.

## 3. Classificação de cada linha

Cada linha recebe um destino, com motivo registrado:

| Destino | Regra |
|---|---|
| `rejeitado` | valor zero (o banco exige valor > 0) ou linha inválida |
| `adiado` | aba fora do escopo (cartão, investimento, moeda estrangeira) ou pagamento/fatura de cartão em conta incluída |
| `pendente` | câmbio, investimento, dívida, categoria que é nome de pessoa, transferência ambígua, transferência cuja outra ponta está fora do escopo |
| `entra` | demais linhas e pares de transferência provados com as duas pontas em contas incluídas |

Um par de transferência provado vira **uma** transação do tipo `transfer`.

## 4. Transferências

- **Provado:** mesma data e mesmo valor absoluto, sinais opostos, abas diferentes, e sem outra combinação possível (1 saída × 1 entrada, ou k pares equivalentes entre uma única origem e um único destino).
- **Ambíguo:** várias contas possíveis, só um dos lados, ou quantidades diferentes de saídas e entradas.
- **Aproximado:** mesmo valor com até 3 dias de diferença; apenas candidato, nunca confirmado.
- A regra é heurística e **não foi revisada linha a linha**.

## 5. Tags (proposta, sem migration)

```sql
tags(id, household_id, name, name_key, unique (household_id, name_key))
transaction_tags(transaction_id, tag_id, household_id,
  primary key (transaction_id, tag_id),
  -- FKs compostas por (household_id, id) nas duas pontas; RLS por família)
```

- `name_key` é o nome em minúsculas e sem acento. A ordem das tags num lançamento não importa.
- O texto original das tags fica na staging (`raw_tags`); `notes` não substitui a estrutura.
- Unificações (erros de digitação, plural) são **sugeridas** e aprovadas pelo usuário, nunca aplicadas sozinhas.

## 6. Idempotência (reimportar sem duplicar)

- Chave por linha: `sha256(aba | data | centavos | descrição normalizada | categoria normalizada | ocorrência)`, em que *ocorrência* é a posição entre linhas idênticas.
- Staging por lote (`import_batches`, `import_rows`) com `household_id`, hash do arquivo, status e motivo; `unique (household_id, source, hash)`.
- Arquivo novo e mais longo: linhas já vistas são ignoradas; só as novas entram.
- Limite conhecido: linha **editada** no Organizze muda de hash e aparece como nova, no relatório de candidatas.
- Cada lote pode ser desfeito por `batch_id`.

## 7. Saldo inicial

`saldo_inicial = saldo_real_na_data_X − Σ(movimentações pagas até X)`. O modelo exige `initial_balance` no início do dia de `opening_date`, e transferências não podem ser anteriores à abertura de nenhuma das contas. O usuário informa saldo real e data por conta.

## 8. Decisões abertas

| # | Decisão | Recomendação |
|---|---|---|
| D1 | Linhas pendentes/adiadas **dentro** de contas incluídas: importar numa categoria provisória, ou deixar fora com ajuste | Importar com marcação, para o saldo fechar. Para pagamentos de cartão: saída de conta com tag, **sem categoria de despesa** |
| D2 | Lista padrão de categorias (PR #6 / anexo maior / seed atual) | Raízes + subcategorias; seed só muda após escolha |
| D3 | Tratamento de categorias que são nomes de pessoas | Manter pendentes até decidir por pessoa |
| D4 | Moeda de cada conta | Usuário confirma |
| D5 | Estrutura de tags | Aprovar o esquema da seção 5 |

## 9. O que não está validado

Moeda das contas; mapeamento de categorias; pares de transferência; saldos reais; estabilidade do hash entre exports diferentes. Nada foi executado contra Supabase.
