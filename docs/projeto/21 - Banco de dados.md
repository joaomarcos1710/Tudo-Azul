---
tags: [tudo-azul, banco, supabase]
---
# Banco de dados — as migrations

Supabase (Postgres), projeto `vbhzilsqzzevaodqsenr`. **Regra:** migration aplicada nunca é editada; mudança = migration nova. Produção só pelo workflow manual ([[24 - Deploy e operação]]).

| # | Arquivo (data) | O que faz |
|---|---|---|
| 001 | `core_schema`, `integrity_triggers`, `security`, `household_rpcs` (13/10) | Tabelas base (família, membros, convites, contas, categorias, lançamentos, orçamentos), gatilhos de integridade, RLS/privilégios e RPCs de família (criar, convidar, aceitar, remover, sair, excluir). Categorias padrão. |
| 002 | `reports` (13/10) | Relatórios do período e saldos. |
| 003 | `liabilities` (13/10) | Dívidas e cartões: eventos, saldos, pagar e anular. |
| — | `installments_card_only` (15/10) | Parcelamento só no cartão. |
| 004 | `card_cycle` (17/10) | Ciclo do cartão (fechamento/vencimento), compra parcelada, cobrança automática. |
| 005 | `card_reports` (17/10) | Relatórios da fatura (`card_months`, itens). |
| — | `card_corrections` (17/10) | Excluir compra, reabrir fatura, editar parcela, saldo anterior/adiantamento. |
| 006 | `recurrences` (17/10) | Lançamentos recorrentes (conta e cartão). |
| 007 | `reconciliation` (24/10) | Conciliação com o extrato; trava de período. |
| 008 | `dashboard_reports` (24/10) | Despesas por categoria e por dia (gráficos). |
| 009 | `reset_household` (24/10) | "Zerar tudo" (só o dono, frase conferida no banco). |
| 010 | `card_prepayment` (24/10) | Pagamento adiantado vira crédito no cartão. |
| 011 | `card_limit` (25/10) | Limite do cartão e limite disponível. |
| 012 | `income_kind` (25/10) | Renda regular × eventual. |
| 013 | `projection` (25/10) | Projeção do mês e do orçamento. |
| **014** | `audit_fixes` (25/10, aplicada 26/10) | Correções da auditoria (ver [[Auditorias/2026-10-26 Auditoria]]). |

Total: **19 arquivos**. Todas aplicadas em produção; local e remoto em sincronia.

## Detalhes da 014
- `card_months` passa a contar o saldo de referência do cartão.
- `debt_void` só anula eventos da própria dívida e relê o evento depois do lock.
- `debt_pay` recusa chave de idempotência usada em outra dívida.
- Evento de dívida não entra por conta desativada.
- Categoria não pode ser mãe de si mesma; nome com limite de 120 caracteres.
- `DELETE` em contas revogado para usuários (só desativar).

## Limite de membros
`households.member_limit` (1 a 10, padrão 2), checado ao convidar, ao aceitar e por gatilho. Alterável só por quem administra o banco. Base para planos futuros ([[30 - Decisões]]).
