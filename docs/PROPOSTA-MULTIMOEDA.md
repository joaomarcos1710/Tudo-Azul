# Proposta técnica: múltiplas moedas no Tudo Azul

> **Status em 27/10/2026: proposta de 13/10, não aprovada como especificação e não implementada** (multimoeda está no
> roadmap para dez–jan). Revalidar contra o esquema atual antes de virar migration. Pontos já confirmados na auditoria de
> 26/10, que precisam ser corrigidos na proposta:
> 1. **Mesma moeda.** `fx_rate_at` "nunca devolve 1,0" e a ordem de busca (5.4) não tem o caso `base = quote`, que a
>    ingestão também recusa. Do jeito que está, BRL→BRL com moeda de referência BRL vira "sem cotação" e as contas em BRL
>    saem do total (5.5). Falta a regra de identidade: mesma moeda = 1, sem consulta.
> 2. **Custo do câmbio** (seção 7): `from_amount × cotação − to_amount` dá o resultado na moeda de **destino**, não na
>    de referência, e a direção da cotação não está definida.
> 3. **Data futura** (5.2): "usa a última disponível" contradiz o limite de arrasto de 7 dias da mesma seção.

> **Status: proposta para aprovação. Nada implementado, nenhuma migration, nada no Supabase hospedado.**
> Base: [`MODELO-DE-DADOS.md`](MODELO-DE-DADOS.md) v3 e as migrations do PR #7 (lidas, não alteradas).
> Relacionada: [`PROPOSTA-INICIO-OPERACIONAL-E-HISTORICO.md`](PROPOSTA-INICIO-OPERACIONAL-E-HISTORICO.md).

## 1. Resumo e recomendação

1. **Cada conta tem uma moeda ISO 4217**; lançamentos herdam a moeda da conta e **nunca são reescritos** quando a cotação muda.
2. **Cotações são dados globais, imutáveis e com procedência** (`fx_rates`), lidas por todas as famílias e escritas só pela rotina de ingestão.
3. **Conversão é sempre calculada na leitura**, no SQL, a partir do valor original e da cotação da data. Nenhum valor convertido é gravado em lançamento.
4. **Troca de moeda real é um tipo próprio** (`fx_conversions`), com os dois valores movimentados, a taxa efetiva e as tarifas. **Não é transferência.**
5. **Fonte inicial:** Frankfurter, **com provedor fixado por moeda** (BCB para BRL, BCRA para ARS, BCCH para CLP, BANXICO para MXN) em vez da taxa combinada. **BCB (PTAX)** entra como fonte complementar para BRL, mas **cobre só 10 moedas e não cobre ARS, CLP nem MXN**.
6. **Rotina:** `pg_cron` + `pg_net` dentro do próprio Postgres, sem segredo. Alternativas na seção 6.4.
7. **Três funções do PR #7 passam a somar moedas diferentes** e precisam ser substituídas antes de existir qualquer conta que não seja BRL (seção 2).

## 2. Estado atual e o que quebra

O núcleo do PR #7 assume uma moeda. Hoje:

| Função / regra | Problema com mais de uma moeda |
|---|---|
| `account_balances` | Correta por conta, mas **não informa a moeda** |
| `balance_totals` | Soma `balance` de todas as contas: **R$ + US$ + CLP somados como se fossem iguais** |
| `period_summary` | Soma `amount` de todas as contas: mesmo erro |
| `budget_usage` | Soma despesas de todas as contas contra um limite em reais |
| Regra de dinheiro N2 (`x = round(x, 2)`) | CLP e JPY têm **0** casa decimal (ISO 4217); aceitar `1,50 CLP` é aceitar valor impossível |
| `abs(x) < 1e12` | Em ARS (≈ 1.516 por US$ em 10/10/2026, medido), 1e12 ≈ US$ 660 mil; em CLP ≈ US$ 1 milhão |
| Transferência | Hoje pode, por engano, ligar contas de moedas diferentes |
| Front (`Cents`) | "Centavos" assume 2 casas; CLP não tem centavos |

Como o PR #7 não está aplicado em lugar nenhum e nenhuma tela consome essas funções, corrigir **agora** custa uma migration aditiva; depois de haver dados, custa uma migração de dados.

## 3. Proposta de schema

Todos os trechos são **esboços**, não migrations.

### 3.1 Moedas

```sql
currencies(
  code char(3) primary key check (code ~ '^[A-Z]{3}$'),   -- ISO 4217
  name text not null,
  minor_unit smallint not null check (minor_unit between 0 and 3),
  enabled boolean not null default false)                   -- v1: só minor_unit <= 2
-- habilitadas na v1 (a aprovar): BRL 2, USD 2, EUR 2, ARS 2, CLP 0, MXN 2
```

- Tabela **global**, só leitura para `authenticated`; quem escreve é migration.
- **Cripto não é ISO 4217** (OKX, por exemplo). Fica fora desta tabela e entra no módulo de investimentos como ativo.
- Moedas com 3 casas (KWD, BHD) ficam `enabled = false`: exigiriam trocar o `CHECK` de 2 casas.

### 3.2 Moeda na conta e no lançamento

```sql
alter table accounts add column currency char(3) not null default 'BRL' references currencies(code);
alter table accounts add unique (household_id, id, currency);

alter table transactions add column currency char(3) not null;   -- preenchida por trigger a partir da conta
alter table transactions add foreign key (household_id, account_id, currency)
  references accounts (household_id, id, currency);
alter table transactions add foreign key (household_id, destination_account_id, currency)
  references accounts (household_id, id, currency);   -- transferência só entre contas da MESMA moeda
```

- A FK composta faz o banco **recusar** transferência entre moedas diferentes e **impede mudar a moeda** de uma conta que já tem lançamentos (violação de FK, 23503), sem trigger extra.
- Trigger de guarda por moeda: recusa mais casas decimais que `minor_unit` da moeda da conta (generaliza a regra N2; erro 22003 antes do `CHECK`, como hoje). `1,5 CLP` e `1,005 USD` são recusados; `1.000 CLP` é aceito.
- O cliente **não envia** `currency` no lançamento; o trigger a copia da conta.

### 3.3 Cotações (global, imutável)

```sql
fx_fetch_runs(id, source text, started_at, finished_at, status /* ok|partial|failed */,
  requested_from date, requested_to date, http_status int,
  rows_inserted int, rows_skipped int, rows_conflict int, error text)

fx_rates(
  id bigint generated always as identity primary key,
  base  char(3) not null references currencies(code),
  quote char(3) not null references currencies(code),
  rate  numeric not null check (rate > 0 and rate < 1e12),   -- unidades de `quote` por 1 `base`; sem arredondar
  rate_date date not null,          -- data da cotação, como a fonte informou
  requested_date date,              -- data pedida à fonte (pode diferir)
  source text not null check (source in ('frankfurter','bcb_ptax')),
  provider text not null default 'blend',   -- 'bcb','bcra','bcch','banxico','ecb' ou 'blend'
  rate_kind text not null check (rate_kind in ('mid','ptax_buy','ptax_sell')),
  suspect boolean not null default false,   -- salto atípico em relação ao dia anterior
  fetched_at timestamptz not null,
  fetch_run_id bigint references fx_fetch_runs(id),
  check (base <> quote),
  unique (source, provider, rate_kind, base, quote, rate_date))

fx_rate_conflicts(id, fx_rate_id, new_rate, fetched_at, fetch_run_id)   -- mesmo dia, valor diferente
fx_source_config(base, quote, source, provider, rate_kind, priority, enabled)
```

- **Imutável:** sem `UPDATE` e sem `DELETE` para ninguém, exceto migration. Se a fonte republicar o mesmo dia com valor diferente, o valor original **permanece** e a divergência vai para `fx_rate_conflicts` para revisão manual. Isso garante que relatórios antigos não mudem sozinhos.
- **Duplicatas:** a chave `unique` + `ON CONFLICT DO NOTHING` torna a ingestão idempotente.
- A taxa chega da API como número JSON. Em `jsonb` o Postgres guarda `numeric` exato; em JavaScript `JSON.parse` viraria `double`. Esta é uma razão para a ingestão ser em SQL.
- `fx_source_config` fixa, por par, qual fonte/provedor/tipo vale e em que prioridade. Evita que a composição da taxa combinada mude em silêncio.

### 3.4 Cotação manual da família (opcional)

```sql
household_fx_rates(id, household_id, base, quote, rate, rate_date, note, created_by, created_at,
  unique (household_id, base, quote, rate_date))   -- RLS por família
```

Só para moedas sem cotação pública. **Fica fora da v1** se você não aprovar (D-M6).

### 3.5 Conversão real entre moedas

```sql
fx_conversions(
  id, household_id, date, status /* paid|planned */,
  from_account_id, from_currency, from_amount numeric,     -- saiu
  to_account_id,   to_currency,   to_amount   numeric,     -- entrou
  quoted_rate numeric null,        -- o que o banco/corretora anunciou, se informado
  effective_rate numeric,          -- to_amount / from_amount, calculado por trigger (informativo)
  notes, created_by, created_at, updated_at, deleted_at,
  foreign key (household_id, from_account_id, from_currency) references accounts (household_id, id, currency),
  foreign key (household_id, to_account_id,   to_currency)   references accounts (household_id, id, currency),
  check (from_currency <> to_currency and from_amount > 0 and to_amount > 0))

transactions add column conversion_id uuid null;   -- tarifa/IOF ligados à conversão
-- FK composta (household_id, conversion_id) -> fx_conversions
```

- **Preserva o que importa:** os dois valores realmente movimentados. A taxa efetiva é consequência deles; os saldos usam **só os valores**, nunca a taxa.
- **Tarifas e IOF** são lançamentos `expense` comuns (na moeda e na conta em que foram cobrados), ligados por `conversion_id`. Não ficam embutidos no valor.
- **Diferente de transferência:** transferência exige mesma moeda e conserva o total; conversão troca uma moeda por outra. Trigger replica as regras da seção 4.2 do modelo (data não anterior à abertura de **nenhuma** das duas contas; contas ativas; mesma família).
- `account_balances` ganha as duas pernas: `− from_amount` na origem, `+ to_amount` no destino, com a mesma regra de `status`, `deleted_at` e `opening_date`.
- **Invariante por moeda** (substitui a conservação global): para cada moeda `c`, `Σ saldos_c = Σ iniciais_c + (receitas − despesas)_c + conversões_entrada_c − conversões_saída_c`.

### 3.6 Moeda de referência

`households.report_currency char(3) not null default 'BRL'`. É onde dashboard e relatórios convertem. Alterável pelo owner.

## 4. Fontes de cotação: avaliação

O que foi **verificado em 13/10/2026** (consulta direta às páginas e à API):

| Item | Frankfurter | BCB PTAX |
|---|---|---|
| Acesso | `https://api.frankfurter.dev/v2/...`, **sem chave** | `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/` (Moedas, CotacaoDolarDia, CotacaoDolarPeriodo, CotacaoMoedaDia, CotacaoMoedaPeriodo) |
| Moedas pedidas | BRL, USD, EUR, ARS, CLP e MXN **presentes** em `/v2/currencies` | **10 moedas:** DKK, NOK, SEK, USD, AUD, CAD, EUR, CHF, JPY, GBP. **Sem ARS, CLP, MXN** |
| Natureza do dado | Ponto médio. Por padrão **combinada entre provedores** (a página cita 104 bancos centrais; `/v2/providers` lista 100; outra página cita 98): números divergem entre páginas | Oficial. PTAX = média de 4 consultas diárias a dealers desde 01/07/2011; boletins: abertura, intermediários, fechamento |
| Campos | `date`, `base`, `quote`, `rate` | `paridadeCompra/Venda`, `cotacaoCompra/Venda`, `dataHoraCotacao`, `tipoBoletim` |
| Histórico | USD desde 1948; BRL desde 1994; ARS 1998; CLP 1982; MXN 1991 | Euro desde 02/01/2002; demais desde 28/11/1984 |
| Limites | "Sem cotas"; há limitação de taxa não numérica; recomenda cache local | Não documentado na página consultada |
| Licença/termos | Código aberto; **cada provedor tem termos próprios** (vários listados); nome da licença não obtido | **ODbL** (atribuição; compartilhamento de bases derivadas) e aviso de que o BCB não garante disponibilidade nem ausência de erros (exceto paridade USD/BRL) |
| Formato de data | `YYYY-MM-DD` | `'MM-DD-AAAA'` entre aspas simples |

**Achados que mudam o desenho:**

1. **A taxa combinada do Frankfurter não é a PTAX.** Para USD→BRL em 10/10/2026 a API devolveu 5,0079 com **40 provedores**, variando de 4,9815 a 5,0232 (um provedor, FRED, estava com dado de 02/10). Para ARS, 11 provedores variam de 1.514,49 a 1.544,57 (um, LB, com dado de 29/09). Usar a combinada como "cotação oficial" mistura fontes e datas. **Por isso a proposta fixa o provedor por par.**
2. A própria API lista provedores de referência para as moedas pedidas: **BCB** (BRL, PTAX), **BCRA** (ARS), **BCCH** (CLP) e **BANXICO** (MXN). Dá para usar uma API só, com procedência explícita.
3. **Fim de semana:** pedindo sábado 10/10/2026, a API devolveu `date = 2026-10-10` para USD→ARS/BRL/EUR/MXN e `2026-10-09` para CLP. Ou seja, **a data devolvida pode ser de dia não útil e pode diferir por moeda**. O desenho guarda `requested_date` e `rate_date` separados e não presume dia útil.
4. As contagens da documentação divergem entre páginas (223 moedas numa, 206 em outra). **Não depender de contagens**; consultar `/v2/currencies` e `/v2/providers` na rotina.

**Recomendação:**
- **BRL ↔ moedas do BCB:** fonte primária `bcb_ptax` (oficial, em reais), tipo definido em D-M3; Frankfurter com provedor `bcb` como contingência e conferência cruzada.
- **ARS, CLP, MXN → BRL:** o BCB **não tem** cotação direta. Usa-se o provedor oficial local via Frankfurter (BCRA, BCCH, BANXICO) para a perna contra USD, e a PTAX para USD/BRL. O resultado é **derivado, marcado como tal** (seção 5.4).
- Frankfurter como "fonte inicial" é adequado **para uso familiar e pessoal**; para uso comercial a licença/termos dos provedores precisam de revisão (D-M13).

**Não consegui verificar:** os endpoints `Moedas` e `CotacaoMoedaDia` do BCB ao vivo (a consulta foi bloqueada por `robots.txt` na ferramenta que usei; **isso não é restrição do app**, mas a resposta real, inclusive para feriados, fica por testar); o horário em que o Frankfurter publica o dia; o valor numérico do limite de requisições; a licença exata do Frankfurter; se `providers=bcb` é aceito como filtro nas consultas de taxa.

## 5. Regras de cotação

### 5.1 Função de consulta

```sql
fx_rate_at(p_base char(3), p_quote char(3), p_date date)
  returns (rate numeric, rate_date date, derived boolean, legs smallint, age_days int)
```
`stable`, `security invoker`; lê `fx_rates` (leitura liberada a `authenticated`). Nunca devolve 1,0 por omissão.

### 5.2 Datas sem cotação (fim de semana, feriado)
- Usa a **última cotação com `rate_date <= p_date`** (arrasto para frente), devolvendo `rate_date` e `age_days`. A tela mostra "cotação de 09/10".
- **Limite de arrasto:** 7 dias corridos (D-M5). Acima disso: **sem cotação**.
- Data futura (lançamento planejado): usa a última disponível, marcada como estimativa.
- Feriado brasileiro sem boletim do BCB: mesmo arrasto; a contingência Frankfurter pode ter dado do dia.

### 5.3 Cotações históricas
- A carga inicial busca o intervalo desde a menor `opening_date`/data de lançamento por moeda em uso, usando o endpoint de série (Frankfurter) ou `CotacaoMoedaPeriodo` (BCB).
- Lançamento antigo converte pela cotação **da sua data**, não pela de hoje. Saldo converte pela cotação **da data de consulta**.
- Como `fx_rates` é imutável (seção 3.3), um relatório de 2025 refeito em 2027 dá o mesmo número.

### 5.4 Pares sem cotação direta
Ordem de tentativa (para na primeira que existir, nunca mais de 2 pernas):
1. Direta `base→quote`.
2. Inversa `1 / quote→base`.
3. Via **BRL** quando uma das pontas é BRL e a outra tem PTAX.
4. Via **USD** (pivô).
5. Via **EUR**.
6. `NULL` = **sem cotação**.

A conta é feita em `numeric` sem arredondar as pernas; só o resultado final arredonda para o `minor_unit` da moeda de destino (meio para longe do zero, padrão do `round` do Postgres). O resultado devolve `derived = true`, `legs` e a **data mais antiga entre as pernas**.

### 5.5 Moeda sem cotação
O total convertido **exclui** a conta, mostra o total **parcial** e uma faixa "N contas sem cotação". Nunca zero, nunca 1:1. Moedas de câmbio distorcido (ex.: VES) ficam desabilitadas por padrão.

## 6. Rotina automática de atualização

### 6.1 Fluxo
1. `pg_cron` agenda `fx_plan` **duas vezes por dia** (horário a ajustar depois de medir quando o Frankfurter muda de data; hoje não documentado).
2. `fx_plan` consulta `fx_source_config` e as moedas em uso (`accounts.currency` ∪ `report_currency`), calcula para cada par o intervalo `[última rate_date + 1 dia, hoje]` (ou a carga inicial) e abre um `fx_fetch_runs`.
3. `pg_net` faz as chamadas `GET` de forma assíncrona.
4. Alguns minutos depois, `fx_ingest` lê as respostas e, **por resposta, em uma transação**:
   - valida estrutura e tipos (lista, `date`, `base`, `quote`, `rate` numérico, `rate > 0`);
   - marca `suspect` quando o salto sobre o dia anterior passa de um limiar (D-M12; ARS já teve desvalorizações de mais de 100% num dia, então **sinaliza, não bloqueia**);
   - `INSERT … ON CONFLICT DO NOTHING`; se o conflito tiver valor diferente, grava em `fx_rate_conflicts`;
   - fecha o `fx_fetch_runs` com contagens.

### 6.2 Falhas
- Erro HTTP, timeout ou JSON inválido: a execução fica `failed`/`partial` com o motivo, **nada parcial de uma resposta é gravado**.
- A próxima execução recalcula o intervalo a partir da última data boa, então lacunas se **corrigem sozinhas**.
- Contingência: se a fonte primária do par falhar, tenta a de menor prioridade; o `source` fica registrado.

### 6.3 Dados desatualizados
View `fx_rate_status` por par: última `rate_date`, idade, última execução ok e `nivel`: `ok` (até 1 dia útil de atraso), `atenção` (2 a 4), `crítico` (5 ou mais ou execução falhando). O dashboard exibe a data da cotação usada ao lado de todo total convertido e uma faixa se houver `atenção` ou `crítico`.

### 6.4 Onde roda
| Opção | Segredo? | Observação |
|---|---|---|
| **A. `pg_cron` + `pg_net`** (recomendada) | Nenhum | Tudo no Postgres, parse exato em `jsonb`. **A verificar:** disponibilidade e retenção de respostas do `pg_net` no plano hospedado e no stack local |
| B. Edge Function agendada | Exige a chave de serviço do Supabase na função | **Não será usada por mim**: está na lista de chaves que não solicito. Só se você configurar |
| C. GitHub Actions + RPC | Exige credencial para a RPC | Mais peças, pior para auditoria |

Nesta fase **nada é agendado**: a migration cria funções e deixa o job desligado. Ligar no projeto hospedado depende de você.

## 7. Operações de câmbio e histórico (regra 7 e 8)

- **Imutabilidade do original:** `transactions.amount` e `fx_conversions.*_amount` ficam na moeda de origem e **não têm coluna convertida**. Mudar uma cotação não toca nenhuma linha de lançamento.
- **Mesma moeda × câmbio:** transferência = mesma moeda (FK composta); câmbio = tabela própria. Um não vira o outro.
- **Custo do câmbio** (relatório, não lançamento): `from_amount × cotação de referência do dia − to_amount`, em moeda de referência, rotulado "diferença para a referência de mercado (inclui spread)". As tarifas aparecem à parte.
- **Variação cambial** do patrimônio = `Δ valor convertido − Σ fluxos convertidos na data − efeito das conversões`. Aparece como linha própria, **fora de receita e despesa**.

## 8. Dashboard e patrimônio

Funções novas (migration aditiva; as do PR #7 são substituídas, ver seção 11):

| Função | Resultado |
|---|---|
| `account_balances` | + `currency` |
| `balance_totals_by_currency` | uma linha por moeda, valores nativos |
| `balance_totals_converted(household, as_of)` | total na moeda de referência, `missing_rate_count`, `oldest_rate_date` |
| `period_summary` / `budget_usage` | por moeda **e** convertidos (cada lançamento na cotação da sua data) |

O front **não converte**. Recebe número já convertido e a data da cotação.

## 9. Segurança e isolamento

- `fx_rates`, `fx_rate_conflicts`, `fx_fetch_runs`, `fx_source_config`, `currencies`: RLS **ligado**, `select` para `authenticated` (dado público, sem família), **nenhum** `insert/update/delete` para `authenticated`, `anon` sem nada. Escrita só pelas funções da rotina (`private.*`, `security definer`, `search_path` vazio, `EXECUTE` revogado de todos, como no PR #7).
- `fx_conversions` e `household_fx_rates`: `household_id`, FKs compostas, policy por operação com `private.is_member`, privilégios de coluna (cliente não altera `household_id`, `created_by`, `effective_rate`), exclusão lógica. Mesmo padrão de `transactions`.
- Resposta da API tratada como **dado não confiável**: validada, nunca interpolada em SQL; a lista de pares vem de `fx_source_config`, não da resposta.
- Reuso do teste de isolamento da seção 9.5 do modelo para cada tabela nova.

## 10. Impactos nos demais módulos

| Área | Impacto |
|---|---|
| **Importação do Organizze** | A moeda de cada aba é **confirmada por você** (nunca deduzida do nome). Linhas "Câmbio" viram `fx_conversions` (par BRL + moeda estrangeira), o que resolve o grupo hoje "pendente por falta de modelo". Abas de investimento/exterior ficam importáveis depois do módulo. Hash de idempotência inclui a moeda |
| **Cartões** | Cartão tem moeda. Compra em moeda estrangeira numa fatura em BRL guarda o valor em BRL cobrado e, opcionalmente, `original_amount`/`original_currency`. IOF/tarifa como despesa separada |
| **Investimentos** | Posição na moeda do ativo; cotação do **ativo** é outra fonte (esta proposta cobre só câmbio) |
| **Dívidas** | Contrato com moeda; saldo devedor convertido só na leitura |
| **Patrimônio líquido** | Σ ativos convertidos − passivos convertidos, com faixa de sem-cotação e data da cotação; variação cambial à parte |
| **Orçamento** | Limite na moeda de referência; gasto estrangeiro convertido na data; sem cotação = excluído + aviso |
| **Exportação CSV** | Coluna `moeda`; valor sempre na moeda da conta |
| **Front** | O PR de "centavos" planejado antes da etapa 5 deve já ser **por moeda**: tipo `Money {minor: bigint, currency}`, casas decimais vindas de `currencies.minor_unit`, `Intl.NumberFormat` por moeda. Fazer em BRL e adaptar depois é retrabalho |
| **Histórico retroativo** | Reabertura e conciliação passam a ser por conta **na moeda dela** |

## 11. Plano de migração

Tudo **local e CI**, nada no hospedado, sem tocar no PR #7. Migrations aditivas, cada uma com seus testes escritos junto:

1. **002 moedas:** `currencies`, `accounts.currency`, `transactions.currency` + FKs, trigger de escala por moeda; substitui `balance_totals`, `period_summary`, `budget_usage` por versões que **não somam moedas** (como ainda não há dados, `DEFAULT 'BRL'` preenche tudo).
2. **003 cotações:** tabelas `fx_*`, `fx_rate_at`, `fx_rate_status`, funções de ingestão com payload injetável (testável sem rede). Job criado **desligado**.
3. **004 conversões:** `fx_conversions`, integração em `account_balances`.
4. **005 relatórios convertidos.**
5. Ativação do job no projeto hospedado: **fora do meu escopo**, depende de você e do plano do Supabase.

Ordem em relação à proposta de histórico: moedas **antes** de reabertura/conciliação, porque ambas alteram `account_balances`.

## 12. Testes

| ID | Cenário | Esperado |
|---|---|---|
| **F1** | `1,005 USD` | Recusado (22003) |
| **F2** | `1,5 CLP` | Recusado; `1500 CLP` aceito |
| **F3** | `1.2300 USD` | Aceito como `1,23` |
| **F4** | Conversão `1000,00 USD × 5,0079` | `5.007,90 BRL` exato |
| **F5** | Arredondamento meio para longe do zero | `0,125 → 0,13`; `-0,125 → -0,13` |
| **F6** | Ida e volta USD→BRL→USD | Diferença ≤ 1 unidade menor |
| **F7** | Taxa `1516.7` via `jsonb` | Preservada sem erro binário |
| **F8** | `abs(x)` no limite por moeda | Aceita `999.999.999.999,99`; recusa `1e12` |
| **Q1** | Ingestão do mesmo payload duas vezes | Segunda execução: 0 inseridas, N ignoradas |
| **Q2** | Mesmo dia, valor diferente | Original preservado; linha em `fx_rate_conflicts` |
| **Q3** | Payload inválido (taxa 0, negativa, texto, base = quote) | Rejeitado; execução `failed`; nada gravado |
| **Q4** | Falha seguida de execução boa | Lacuna preenchida a partir da última data boa |
| **Q5** | Sem execução por 6 dias úteis | `fx_rate_status` = `crítico` |
| **Q6** | Salto de 100 % | Gravado com `suspect = true` |
| **Q7** | `authenticated` tenta inserir/alterar/apagar `fx_rates` | Negado (42501) |
| **V1** | Câmbio USD→BRL com tarifa | Saldo origem −`from`, destino +`to`, tarifa como despesa |
| **V2** | Conversão com mesma moeda nas duas pontas | Recusada |
| **V3** | Transferência entre contas de moedas diferentes | Recusada (FK composta, 23503) |
| **V4** | Conversão anterior à abertura de qualquer conta | Recusada (23514) |
| **V5** | Invariante por moeda, 3.000 cenários aleatórios | Vale em todos |
| **V6** | Taxa efetiva | `to/from`, calculada no servidor; cliente não grava |
| **H1** | Mudar/inserir cotação nova | Nenhum `transactions` ou `fx_conversions` alterado |
| **H2** | Lançamento de 2025 convertido em 2027 | Usa a cotação de 2025 |
| **H3** | Sábado e feriado | Arrasto da última cotação; `age_days` correto |
| **H4** | Além de 7 dias sem cotação | `NULL`, total marcado parcial |
| **H5** | ARS→BRL | `derived = true`, 2 pernas, data da perna mais antiga |
| **H6** | Moeda sem nenhuma cotação | Excluída do total, contada em `missing_rate_count` |
| **R1** | Família B lê `fx_conversions` da A | Zero linhas |
| **R2** | Conversão da A apontando para conta da B | Falha (FK composta) |
| **R3** | `anon` em qualquer tabela nova | Negado |
| **R4** | `household_fx_rates` da A invisível para B | Zero linhas |
| **N1** | `balance_totals_by_currency` nunca soma moedas | Uma linha por moeda |
| **N2** | Patrimônio convertido com 1 conta sem cotação | Total parcial + contagem |
| **N3** | Variação cambial | Fora de receita e despesa |
| **P1** | PostgREST devolve `numeric` | Taxas não são usadas em conta no front |

## 13. Decisões que preciso de você

| # | Decisão | Recomendação |
|---|---|---|
| D-M1 | Moedas habilitadas na v1 | BRL, USD, EUR, ARS, CLP, MXN |
| D-M2 | Frankfurter com provedor fixado por par, ou taxa combinada | Provedor fixado |
| D-M3 | PTAX: compra, venda ou média; só fechamento | Fechamento; **venda** como padrão (a confirmar contra a documentação do BCB) |
| D-M4 | Onde roda a rotina | `pg_cron` + `pg_net` |
| D-M5 | Limite de arrasto sem cotação | 7 dias corridos |
| D-M6 | Cotação manual por família na v1 | Fora da v1 |
| D-M7 | Pivôs de triangulação | BRL, USD, EUR; no máximo 2 pernas |
| D-M8 | Exibir "custo do câmbio" em relatório | Sim, rotulado |
| D-M9 | Cripto fora de `currencies` | Sim |
| D-M10 | Moeda de referência por família | Sim, padrão BRL |
| D-M11 | PR de centavos já por moeda (`Money`) | Sim |
| D-M12 | Limiar de `suspect` | 30 % por dia, só sinaliza |
| D-M13 | Aceitar termos/licença de Frankfurter e BCB para uso familiar | Revisar antes de qualquer uso comercial |
| D-M14 | Limite de magnitude `1e12` por moeda | Manter na v1 |

## 14. Riscos

1. **Taxa combinada ≠ oficial:** divergência de até ~0,8 % entre provedores no mesmo dia (medido). Mitigação: provedor fixado e `provider` gravado.
2. **Dependência de terceiro gratuito**, sem SLA, com documentação inconsistente. Mitigação: duas fontes, cache local, status de desatualização.
3. **`pg_net`/`pg_cron` no plano hospedado** não verificados. Mitigação: payload injetável permite testar tudo sem rede; plano B nas opções.
4. **Derivadas por USD** acumulam diferença de datas entre pernas. Mitigação: marcar `derived` e mostrar a data mais antiga.
5. **Hiperinflação/desvalorização brusca (ARS):** conversões muito sensíveis ao dia. Mitigação: `suspect` e data sempre visível.
6. **Funções do PR #7 mudam de contrato:** consumidores futuros precisam das novas. Mitigação: nenhuma tela as usa hoje.
7. **Licença ODbL do BCB** pode exigir atribuição/compartilhamento se a base de cotações for redistribuída.
8. **Escopo crescente do patrimônio:** cotação de ativos (ações, cripto) é outro problema e **não** está resolvido aqui.

## 15. Não verificado

Nenhum SQL deste documento foi executado. Não testei o BCB ao vivo, o horário de publicação do Frankfurter, o filtro por provedor nas consultas de taxa, `pg_cron`/`pg_net` no Supabase, nem a licença do Frankfurter. Os números de cotação citados são observações de 13/10/2026 e servem só como exemplo.
