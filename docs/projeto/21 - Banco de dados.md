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
| **017** | `bank_and_card_brand` (29/10, **aplicada em produção em 29/10/2026**) | Banco da conta (`accounts.bank`), emissor e bandeira do cartão (`debts.issuer`, `debts.brand`) e `set_card_identity`. Só aparência: nenhum valor muda. |
| **018** | `recurrence_delete` (29/10, **aplicada em produção em 29/10/2026**) | `recurrence_delete(p_id)`: exclui o recorrente (ativo ou encerrado); planejados de hoje em diante vão para a lixeira; pagos, vencidos e compras de cartão já geradas ficam, só perdem o vínculo com a regra. |
| **019** | `projection_deleted_recurrence` (29/10, **aplicada em produção em 29/10/2026**) | Corrige `month_projection` e `budget_projection`: o que um recorrente excluído já gerou (e foi pago) não vira "gasto variável" no ritmo. Critério passa a ser `occurrence_date is null`. |
| **020** | `archive_delete` (30/10, **aplicada em produção em 30/10/2026**, execução 30 do workflow, simulação antes na 29) | `debt_archive`, `debt_unarchive`, `debt_delete` (cartão/dívida) e `account_delete` (conta). Arquivar recusa dívida com saldo, parcelas a vencer ou recorrente ativo (23514); excluir só o que nunca teve movimento (23503: o banco manda arquivar). Conta arquivada continua sendo `accounts.active`. Teste `27_archive_delete` (33), `00_audit` atualizado. |
| **021** | `card_rename` (30/10, **aplicada em produção em 30/10/2026**, execução 32 do workflow, simulação antes na 31) | `debt_rename(p_id, p_name)`: corrige o nome do cartão (1 a 60 caracteres; repetido na família = 23505; não mexe em dívida nem histórico). `debt_delete` e `account_delete` (create or replace, mesmas regras da 020) passam a dizer o que impede a exclusão, ex.: "tem histórico (3 parcelas): só é possível arquivar". Teste `28_card_rename` (17), `00_audit` atualizado. |
| **022** | `recurrence_horizon` (30/10, **aplicada em produção em 30/10/2026**, execução 34 do workflow, simulação antes na 33) | `recurrence_materialize` (create or replace): regra de conta sem data final gera até o fim do mês +12 (antes +2); com data final gera até ela, no máximo 360 meses (semanal: 24). Cartão igual. Idempotente. Testes `29_recurrence_horizon` (19); `11` e `22` ajustados ao horizonte novo. |
| **023** | `card_invoices_month` (30/10, **ainda não aplicada em produção**) | `card_invoices_month(p_household, p_month)`: das faturas de todos os cartões (mesma fonte `card_months`), as que **vencem** no mês: quantas, total, pago e falta (por fatura, nunca negativo). SECURITY INVOKER, só leitura. Teste `30_card_invoices_month` (10); `00_audit` atualizado. |

Total: **24 arquivos**, sincronizados entre o repositório e a produção em 29/10/2026. A migration 019 foi aplicada pelo workflow de produção após o merge do PR #86 (simulação: [execução 27](https://github.com/joaomarcos1710/Tudo-Azul/actions/runs/40957090290); aplicação: [execução 28](https://github.com/joaomarcos1710/Tudo-Azul/actions/runs/40957180996)), a partir do commit `c82ee04`. A migration 018 foi aplicada pelo workflow de produção após o merge do PR #84 (simulação: [execução 25](https://github.com/joaomarcos1710/Tudo-Azul/actions/runs/40952737024); aplicação: [execução 26](https://github.com/joaomarcos1710/Tudo-Azul/actions/runs/40952813187)), a partir do commit `80685b2`. A migration 017 foi aplicada pelo workflow de produção após o merge do PR #80 (simulação: [execução 23](https://github.com/joaomarcos1710/Tudo-Azul/actions/runs/40950891144); aplicação: [execução 24](https://github.com/joaomarcos1710/Tudo-Azul/actions/runs/40950980065)), a partir do commit `9a057b2`. A migration 016 foi aplicada pelo workflow de produção após o merge do PR #65; ver execução 22 na [Actions do GitHub](https://github.com/joaomarcos1710/Tudo-Azul/actions/runs/40690330495). A migration 015 foi aplicada pelo workflow de produção após o merge do PR #59; ver execução 20 na [Actions do GitHub](https://github.com/joaomarcos1710/Tudo-Azul/actions/runs/40397169580).

## Detalhes da 019
- **Bug (achado pela revisão de 29/10/2026, regressão da 018):** a projeção do mês e a do orçamento calculam o ritmo (gasto por dia × dias que faltam) com o gasto pago "fora de recorrência", decidido por `recurrence_id is null`. Excluir a regra zera o vínculo (`ON DELETE SET NULL`) e o aluguel já pago passava a contar como gasto variável. Reproduzido: aluguel de 2.000,00 pago + 100,00 de mercado no dia 20 → projetado 2.155,00 antes de excluir a regra e **3.255,00** depois (no dia 8: 8.137,50). O erro só existe no mês corrente e some na virada.
- **Correção:** o critério vira `occurrence_date is null`; a coluna só é preenchida pela geração da regra e **não** é zerada pelo `SET NULL`. Nenhum dado é alterado; só as duas funções são recriadas.
- Teste: `26_projection_deleted_recurrence.test.sql` (7 verificações; **falha sem a migration**: 3 não-ok com os números acima).
- Lição: o que usa `recurrence_id is null` para dizer "não é recorrente" quebra com a exclusão da regra; use `occurrence_date`.

## Detalhes da 018
- `recurrence_delete(p_id) returns integer` (SECURITY DEFINER, `search_path` fixo, só `authenticated`): trava a regra da própria família (`recurrence_lock`; de outra família ou inexistente = 42501), manda para a lixeira (`deleted_at`) os planejados não pagos com data de hoje em diante, apaga a regra e devolve quantos foram para a lixeira.
- O vínculo `transactions.recurrence_id` e `debt_installments.recurrence_id` vira `null` pelo `ON DELETE SET NULL` (migration 006). **Armadilha**: a parcela de cartão é imutável (`debt_installments_immutable`) e o `SET NULL` é um UPDATE; sem o sinal `app.card_edit` ligado só durante o DELETE, a exclusão de qualquer regra com compra de cartão já gerada falha com "parcela é imutável". O teste `25_recurrence_delete` pega isso (confirmado removendo o sinal).
- Planejados **vencidos** não pagos ficam (compromissos que existiram): a pessoa paga ou exclui. Pagos em período conciliado ficam intactos (o guarda de período só olha valor, data e conta).
- `recurrence_end` continua no banco (nenhuma tela usa mais); o cliente não apaga direto em `recurrences` (sem `grant delete`).
- Teste: `25_recurrence_delete.test.sql` (22 verificações); `00_audit` ganhou `recurrence_delete`.
- **Ordem de entrega**: a tela nova chama `recurrence_delete`; foi mesclada e a 018 aplicada logo em seguida (execuções 25 e 26).

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
