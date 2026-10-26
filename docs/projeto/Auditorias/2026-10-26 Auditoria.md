---
tags: [tudo-azul, auditoria]
data: 2026-10-26
---
# Auditoria de 26/10/2026

Dois agentes independentes, sem alterar nada em produção: **testador-banco** (testes adversariais) e **revisor-dinheiro** (consistência de valores).

## Resultado geral
- **Isolamento entre famílias e escalada de privilégio:** nenhuma falha (fuzz de todas as funções com dados de outra família).
- **1 bug de valor bloqueante** e vários furos de integridade de baixo risco.

## Corrigido (PR #51, migration 014 — em produção)
| Achado | Efeito | Correção |
|---|---|---|
| **B1** `card_months` ignorava o saldo de referência | Fatura nova aparecia "paga" sem ter sido paga | Saldo de referência vira "anterior em aberto" |
| `debt_void` anulava por `op_id` sem filtrar a dívida | Anular um pagamento podia anular o de outra dívida | Filtra dívida e família; `debt_pay` recusa chave de outra dívida |
| Evento de dívida aceitava conta desativada | Regra de "só novas movimentações" furada | Gatilho recusa |
| Categoria podia ser mãe de si mesma | Categoria sumia das listas | `CHECK` |
| Nome sem limite bruto | Texto gigante em conta/categoria | Limite de 120 |
| Conta apagável pela API | Levava a conferência junto | `DELETE` revogado |
| Anulação concorrente devolvia 0 | Sem erro claro | Relê depois do lock (erro 55000) |

## Conferido e corrigido no front
- Abrir direto em Família (corrida de carregamento) — PR #52.
- Filtros de Lançamentos fora de ordem e sem dependência de tipo — PR #53.

## Ainda aberto → [[40 - Pendências e próximos passos]]
Convite sem e-mail confirmado (configuração) · Relatórios/Orçamentos sem atualizar faturas antes de ler · conta desativada com saldo escondida na Visão geral · idempotência com conteúdo diferente · `debt_chk` quadrático · `card_months` com pagamento de data futura · "Conferido" de transferência entre contas · estorno em mês diferente gera despesa negativa.
