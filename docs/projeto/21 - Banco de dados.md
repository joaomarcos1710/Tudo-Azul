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
| **016** | `recurrence_frequency` (28/10, **aplicada em produção em 28/10/2026**) | Frequências de recorrência: semanal, quinzenal, mensal, bimestral, trimestral, semestral, anual e personalizada. |
| **017** | `bank_and_card_brand` (29/10, **ainda não aplicada em produção**) | Banco da conta (`accounts.bank`), emissor e bandeira do cartão (`debts.issuer`, `debts.brand`) e `set_card_identity`. Só aparência: nenhum valor muda. |

Total: **22 arquivos** (a 017 ainda só no repositório); os 21 anteriores estão sincronizados entre o repositório e a produção em 28/10/2026. A migration 016 foi aplicada pelo workflow de produção após o merge do PR #65; ver execução 22 na [Actions do GitHub](https://github.com/joaomarcos1710/Tudo-Azul/actions/runs/40690330495). A migration 015 foi aplicada pelo workflow de produção após o merge do PR #59; ver execução 20 na [Actions do GitHub](https://github.com/joaomarcos1710/Tudo-Azul/actions/runs/40397169580).

## Detalhes da 017
- `accounts.bank text`: chave do banco (`caixa`, `nubank`...), opcional; formato `^[a-z0-9]{2,30}$`. Carteira em dinheiro não pode ter banco (`accounts_bank_not_cash`). O cliente grava direto (coluna liberada no `grant`); trocar o banco numa conta já conciliada é permitido (só saldo inicial e abertura travam).
- `debts.issuer text` (banco emissor, mesmo formato) e `debts.brand text` (`visa`, `mastercard`, `elo`, `amex`, `hipercard`, `diners`), só em cartão (`debts_identity_card_only`). `debts` não aceita escrita direta, então a gravação é pela função `set_card_identity(p_debt, p_issuer, p_brand)` (SECURITY DEFINER, `null` apaga; 22023 valor inválido, 23514 não é cartão).
- Lista de bancos e de logos vive no front (`src/lib/bancos.ts`): banco novo não precisa de migration. Bandeira nova precisa (o `check` fixa a lista).
- Teste: `24_bank_card_identity.test.sql` (19 verificações); `00_audit` ganhou `set_card_identity`.
- **Ordem de entrega**: o workflow de produção só roda a partir da `main`, então a 017 **entra na `main` junto com o front e é aplicada logo depois**. Para esse intervalo não quebrar nada, o front é tolerante: se as colunas ainda não existem (erro `42703`), Contas e Cartões leem sem elas e funcionam como antes (teste `bancoGravado.test.ts`); ao aplicar a 017, o banco, o emissor e a bandeira passam a aparecer.

## Detalhes da 016
- `recurrences` ganha `freq_unit` (`month` | `week`) e `freq_every` (meses 1–12, semanas 1–4), com padrão `month`/1: as regras existentes continuam mensais e geram **as mesmas datas** (teste RF1: 93 regras × 5 anos contra a fórmula antiga). `day` passa a ser nulo na unidade semana (constraint `recurrences_frequency`).
- Fonte única da série de datas: `private.recurrence_occurrences(regra, de, até)`, usada por `recurrence_materialize` **e** por `private.card_recurrence_pending` (projeção/orçamento do cartão). Antes, a projeção recalculava "mês a mês" por conta própria: uma assinatura anual no cartão apareceria projetada todo mês (provado: com a função antiga, RF13 dá `{1,1,1,1,1}` em vez de `{1,0,0,0,1}`).
- `recurrence_create` ganha `p_freq_unit` e `p_freq_every` (opcionais, padrão mensal). A versão antiga foi removida com `DROP FUNCTION` (sem dado envolvido): com as duas, o PostgREST não saberia qual chamar. O app atual, que não manda os parâmetros novos, continua criando regra mensal.
- Calendário: mês com âncora no dia fixo (dia que o mês não tem = último dia; 29/02 anual vira 28/02 no ano comum); semana com âncora na data inicial (`início + k×7×N`). Frequência, dia e início não mudam depois de criados (a proteção contra duplicação depende disso).
- Início no passado: a mensal gera desde o início, como sempre; as frequências novas, só do dia do cadastro em diante.
- Testes: `22_recurrence_frequency.test.sql` (36 casos); `00_audit.test.sql` lista a função nova.

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
