# Arquitetura patrimonial — investimentos, dívidas e bens

> **Status:** arquitetura aprovada pelo dono em 31/10/2026 para implementação incremental. Este documento descreve decisões de produto e restrições técnicas; não significa que os módulos ou migrations já existam.

## Objetivo

Evoluir o Tudo Azul de um controle de fluxo financeiro para uma visão de gestão patrimonial familiar. O aplicativo deve responder, em uma data de referência:

- Quanto a família possui?
- Quanto desse patrimônio está disponível em contas?
- Quanto está investido?
- Quanto está imobilizado em bens?
- Quanto a família deve?
- Como o patrimônio e as dívidas evoluíram?

A consolidação deve ser auditável, multimoeda e calculada no PostgreSQL. O front-end apresenta os resultados, mas não soma valores financeiros de fontes diferentes.

## Decisões de produto

1. **Investimentos híbridos:** cadastro e operações manuais como caminho obrigatório; cotações e avaliações automáticas podem complementar os dados quando houver fonte confiável. A falta de cotação nunca pode apagar ou inventar valor.
2. **Dívidas como módulo funcional novo:** haverá navegação, telas e planejamento próprios. O motor financeiro existente `debts` / `debt_events` será auditado e evoluído; não criar uma segunda fonte de saldo devedor.
3. **Bens incluídos:** imóveis, veículos e outros bens duráveis ou de valor relevante integram os ativos.
4. **Titularidade:** registrar se o item pertence à família ou a um membro. Quando houver copropriedade, registrar participação percentual. A visão familiar consolida a participação pertencente ao household, sem duplicar 100% do bem.
5. **Moeda:** preservar valor e moeda de origem. A moeda de consolidação da família será configurável, inicialmente BRL. A primeira entrega deve contemplar BRL, USD e EUR; novas moedas exigem cadastro e fonte de câmbio validada.
6. **Histórico:** operações financeiras e avaliações são eventos históricos. Corrigir não significa apagar o rastro.
7. **Sem Open Finance nesta fase:** integrações bancárias automáticas continuam fora do escopo. Atualizações automáticas de preços de mercado são um recurso diferente e podem ser adicionadas com fontes públicas/contratadas.

## Conceitos e regras financeiras

### Ativos

- **Contas:** saldos efetivos por conta, respeitando saldo inicial, data de abertura e movimentações pagas.
- **Investimentos:** posição derivada das operações e valorizada pela última cotação/avaliação válida na data consultada.
- **Bens:** valor de aquisição e avaliações históricas. O valor patrimonial atual usa a avaliação válida mais recente até a data de referência.
- **Titularidade:** somente a fração econômica da família entra no consolidado.

### Passivos

- Dívidas de cartão, empréstimos e financiamentos são passivos.
- A dívida atual é o saldo devedor derivado dos eventos, não a soma das parcelas futuras.
- Fatura de cartão já cobrada entra no passivo conforme as regras atuais do motor de cartões.
- Parcelas de cartão ainda não cobradas são compromissos futuros e não podem ser somadas novamente ao passivo atual.
- Uma dívida não pode aparecer simultaneamente no motor atual e em um novo cadastro independente.

### Patrimônio líquido

`patrimônio líquido = ativos consolidados - passivos consolidados`

A consulta recebe uma data de referência. Cada componente deve informar valor original, moeda, valor convertido, cotação aplicada e data da última avaliação, quando aplicável.

### Saldo disponível

Saldo disponível não é patrimônio líquido. Ele considera apenas os saldos das contas de dinheiro incluídas na regra de disponibilidade. Não inclui imóveis, veículos nem investimentos sem liquidez imediata. A definição de liquidez por produto deve ser explícita, não inferida apenas pelo tipo do investimento.

### Transferências e dupla contagem

- Aporte é transferência de uma conta para investimento, não despesa.
- Resgate é transferência de investimento para conta, não receita integral.
- Compra e venda de ativo alteram composição e custo da carteira; não são automaticamente despesa/receita de consumo.
- Dividendos, juros recebidos e rendimentos aumentam o resultado patrimonial e podem ter reflexo no fluxo conforme a natureza.
- Pagamento de principal reduz caixa e passivo; não é despesa.
- Juros, tarifas e impostos são custos e devem ser registrados separadamente.
- Empréstimo recebido aumenta caixa e passivo na mesma operação.
- Venda de bem encerra ou reduz o ativo na data da venda e registra a contrapartida financeira sem duplicar o valor.

## Referências externas

| Projeto | Uso no Tudo Azul | Restrição |
|---|---|---|
| Ghostfolio | Conceitos de conta de investimento, ativo, operações, carteira, rentabilidade e composição | AGPLv3. Usar como referência; não incorporar código sem análise de compatibilidade |
| Debt Calc | Estratégias Snowball/Avalanche, pagamentos extras, comparação e cronograma | MIT. Validar fórmulas e adaptar regras brasileiras |
| Finance.js | Catálogo de fórmulas e casos de comparação | MIT declarada; repositório sem push recente. Não adotar como dependência sem auditoria |
| CFPB Amortize | Separação entre principal, juros, prestação e saldo | CC0-1.0. Escopo de amortização específico; validar contratos brasileiros |
| Maybe | Organização de experiência e navegação | AGPLv3 e projeto arquivado; referência visual/conceitual apenas |

Não copiar interface, marca, textos ou código protegido. Toda fórmula incorporada terá implementação ou adaptação própria, documentação da convenção e testes independentes.

## Modelo de dados: direção proposta

O modelo final deve ser confirmado contra as migrations e RPCs atuais antes de escrever SQL. Nomes abaixo são conceituais e não autorizam criar tabelas duplicadas.

### Investimentos

- **Contas de investimento:** instituição/custodiante, titular, nome, status.
- **Ativos:** tipo, identificador/ticker quando existir, classe, moeda de negociação, emissor e metadados.
- **Eventos:** aporte, compra, venda, resgate, dividendo, juros, rendimento, taxa, imposto e ajuste auditado.
- **Avaliações/cotações:** valor unitário, quantidade ou valor total, moeda, fonte, instante/data de referência e estado de atualização.
- **Posição:** derivada dos eventos e avaliações; não manter saldo editável em paralelo.

Ativos sem cotação externa devem permitir avaliação manual datada. Criptoativos não devem ser tratados como códigos ISO 4217; são ativos com unidade e mercado próprios.

### Dívidas

O módulo de produto deve cobrir credor, modalidade, contrato, indexador, taxa, sistema de amortização, vencimentos, parcelas, pagamentos, amortizações extraordinárias e simulações. A modelagem deve reaproveitar `debts`, `debt_installments` e `debt_events` sempre que compatível.

O cronograma contratual é projeção. O saldo devedor efetivo vem dos eventos registrados e de ajustes contratuais auditáveis. As simulações nunca alteram o saldo real.

### Bens

- Cadastro do bem, tipo, descrição, titularidade, moeda e data de aquisição.
- Avaliações datadas com fonte (manual, laudo, tabela pública ou outra fonte identificada).
- Eventos de aquisição, melhoria relevante, venda e baixa, quando necessários para explicar a evolução.
- Associação opcional com financiamento, sem fundir ativo e passivo.

### Câmbio

A proposta existente em `docs/PROPOSTA-MULTIMOEDA.md` é ponto de partida, não especificação pronta. Antes de implementá-la, corrigir e testar:
- Conversão identidade: moeda de origem igual à de destino resulta em taxa 1, sem consulta externa.
- Direção inequívoca da cotação (unidades da moeda de destino por 1 unidade da moeda de origem).
- Política de data, cotação futura e limite de defasagem coerentes.
- Fonte, horário, data efetiva, par e precisão preservados.
- Conversões reais entre contas registradas como operação própria, com os dois valores e tarifas; não como transferência simples.
- Valores originais nunca reescritos por mudança de câmbio.
- Sem misturar moedas em totais, orçamentos ou saldos. Cada consulta retorna moeda ou converte explicitamente para a moeda da família.

A fonte de câmbio será selecionada após comparação de cobertura, disponibilidade, termos, histórico e confiabilidade. Não assumir que uma única fonte cobre todos os pares.

## Segurança e integridade

- Todas as tabelas por família têm `household_id`, RLS e chaves estrangeiras compostas que impedem referências cruzadas.
- Titularidade e participação são validadas no banco, nunca apenas no front.
- Escritas financeiras passam por RPCs controladas, com autenticação, autorização e `search_path` fixo em funções `SECURITY DEFINER`.
- Eventos financeiros são append-only; correções usam anulação/estorno auditado.
- Cotações externas registram fonte e data. Falha de provedor não altera posições já registradas.
- Não usar `float` para dinheiro. Manter precisão decimal no PostgreSQL e centavos/unidades inteiras adequadas no front.
- Todas as operações precisam ser idempotentes ou protegidas contra repetição.
- Nenhuma migration aplicada será editada. Mudanças serão aditivas e versionadas.

## Estratégia de implementação

### Fase 0 — auditoria e especificação (esta etapa)
Mapear o schema real, RPCs, políticas, rotas, dependências e testes; fechar os contratos de dados e as regras de cálculo. Confirmar o estado de produção das migrations pendentes 025 e 026 separadamente, sem executá-las neste trabalho.

### Fase 1 — fundação multimoeda
Implementar moedas e cotações, moeda de referência da família, regras de conversão e proteção contra soma de moedas incompatíveis. Migrar contas e movimentações de modo compatível, sem reescrever valores históricos. Cobrir BRL, USD e EUR.

### Fase 2 — investimentos manuais
Cadastrar contas e ativos, registrar eventos, calcular posição e permitir avaliação manual. Entregar primeiro a carteira funcional; cotações automáticas entram depois da validação de provedores.

### Fase 3 — bens
Cadastro, titularidade, participação, avaliação histórica, venda/baixa e integração ao consolidado.

### Fase 4 — dívidas
Nova experiência de gestão sobre o motor existente: contratos, cronogramas, pagamentos, amortização extraordinária e simulações Snowball/Avalanche. Simulações isoladas dos dados reais.

### Fase 5 — consolidação patrimonial
RPC de patrimônio por data, detalhamento de ativos/passivos, evolução histórica e widgets do dashboard. Corrigir o widget atual para não apresentar patrimônio parcial como total sem aviso.

### Fase 6 — cotações automáticas e refinamentos
Atualização agendada e observável de preços/câmbio, política de defasagem, falhas de provedor e rentabilidade por moeda de origem versus efeito cambial.

Cada fase terá PR própria, migrations aditivas, testes unitários, pgTAP e integração. Nenhuma PR será mesclada ou migration aplicada em produção sem a validação correspondente e autorização específica.

## Critérios de aceite

1. Uma família nunca lê nem altera dados patrimoniais de outra.
2. Aporte/resgate não duplica receita/despesa.
3. Pagamento de principal não vira despesa.
4. Cartões não são contados duas vezes.
5. Parcelas futuras não são somadas ao saldo devedor atual.
6. Patrimônio histórico pode ser consultado em uma data passada.
7. Conversão cambial preserva moeda/valor de origem e identifica a taxa.
8. Cotação ausente ou antiga é sinalizada; nunca substituída silenciosamente por zero ou por uma cotação inventada.
9. A soma consolidada é calculada no banco e traz a composição auditável.
10. O saldo disponível continua separado do patrimônio líquido.
