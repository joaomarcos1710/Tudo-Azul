# Fundação multimoeda, fase 1

Esta entrega cria a base de referência de moedas e câmbio, mas **não habilita ainda contas ou lançamentos em moeda estrangeira**. Essa separação é intencional: as RPCs atuais de saldo, projeção, orçamento e relatórios retornam totais únicos em BRL. Permitir USD/EUR nas contas antes de substituir essas funções faria o app somar moedas incompatíveis.

## O que entra nesta fase

- Catálogo inicial BRL, USD e EUR, com casas decimais (minor_unit).
- households.report_currency, padrão BRL, alterável pelo owner.
- fx_rates, com taxa em direção explícita: unidades de quote por 1 unidade de base.
- Histórico de cotação imutável e auditável, com data efetiva e fonte.
- RPC fx_rate_at(base, quote, date): tenta par direto e inverso, aceita somente cotação com até sete dias de idade e devolve a data usada.
- Conversão da moeda para ela mesma retorna taxa 1, sem exigir linha em fx_rates.

## O que fica deliberadamente fora

- Não adiciona currency a accounts, transactions, debts ou cartões.
- Não altera as RPCs de saldo e relatórios existentes.
- Não cria rotina automática nem inventa cotações.
- Não converte valores históricos.
- Não cria telas de investimentos, bens ou dívidas.

## Próxima fase técnica

Antes de habilitar contas estrangeiras, uma migration posterior deve adicionar moeda original a contas e operações, proteger transferências para que só ocorram entre contas da mesma moeda, e substituir as agregações atuais por retornos separados por moeda. A conversão consolidada será calculada no PostgreSQL, com aviso explícito para taxa ausente ou desatualizada. A interface só será liberada quando esse contrato estiver implementado e testado de ponta a ponta.
