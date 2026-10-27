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
| **015** | `recurrence_keep_edits` (26/10, **aplicada em produção em 26/10/2026**) | Reajustar uma recorrência não desfaz o que foi corrigido à mão nos planejados futuros. |

Total: **20 arquivos**, sincronizados entre o repositório e a produção em 26/10/2026. A migration 015 foi aplicada pelo workflow de produção após o merge do PR #59; ver execução 20 na [Actions do GitHub](https://github.com/joaomarcos1710/Tudo-Azul/actions/runs/40397169580).

## Detalhes da 015
- `recurrence_update` (mesma assinatura) atualiza cada campo do planejado — valor, descrição, categoria — **só se ainda estiver igual ao que a regra tinha antes do reajuste**. Campo diferente = corrigido à mão = fica.
- Referência confiável porque só `recurrence_materialize` (copia a regra) e `recurrence_update` escrevem esses campos num lançamento de recorrência; o cliente não altera `recurrence_id`.
- Mesmo escopo: só planejados não excluídos de hoje em diante; pagos, passados e excluídos nunca mudam.
- Limite: "corrigir" para exatamente o valor da regra não deixa rastro. Correções sobrescritas antes da 015 não voltam (não há histórico).
- Testes: `11_recurrences.test.sql`, bloco RC6b (5 casos falham sem a migration).

## Detalhes da 014
- `card_months` passa a contar o saldo de referência do cartão.
- `debt_void` só anula eventos da própria dívida e relê o evento depois do lock.
- `debt_pay` recusa chave de idempotência usada em outra dívida.
- Evento de dívida não entra por conta desativada.
- Categoria não pode ser mãe de si mesma; nome com limite de 120 caracteres.
- `DELETE` em contas revogado para usuários (só desativar).

## Limite de membros
`households.member_limit` (1 a 10, padrão 2), checado ao convidar, ao aceitar e por gatilho. Alterável só por quem administra o banco. Base para planos futuros ([[30 - Decisões]]).
