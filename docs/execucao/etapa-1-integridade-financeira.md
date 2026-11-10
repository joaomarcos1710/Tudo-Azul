# Etapa 1: integridade financeira e operacional

## Governança

- Repositório: `joaomarcos1710/Tudo-Azul`.
- Branch: `fix/financial-integrity-followup-2026-229`.
- Base inicial: merge da PR #226, commit `6308b580047f162fbd9eba77cb52c104182e9ce2`.
- PR #227 incorporada à main pelo merge `d318e4f7e8e44846575e3bf9cf54919cdd4473b3`.
- Esta execução é restrita a branch e PR draft.
- Não aplicar migrations no Supabase hospedado.
- Não alterar dados, segredos ou configurações de produção.
- Não fazer merge nem iniciar a Etapa 2.

## Escopo e evidências exigidas

| Frente | Trabalho | Evidência de aceite |
|---|---|---|
| Projeções | Corrigir testes 13 e 14 e validar datas de corte | pgTAP e logs do job |
| Manifesto de auditoria | Consolidar `supabase/tests/database/00_audit.test.sql` e corrigir assinaturas de privilégios | pgTAP, catálogo e revisão SQL |
| Migrations | Verificar histórico, ordem e dependência de `dashboard_commitment_matrix` | migrations ordenadas e stack local completo |
| Digest | Revisar `private.daily_digest_log` e privilégios/RLS | testes de acesso por papel e isolamento |
| Envelopes | Impedir edição/exclusão de despesa vinculada que desalinhe o ledger | testes de mutação, exclusão, estorno e atomicidade |
| Idempotência | Garantir chave idempotente em aportes e resgates manuais | reenvio retorna mesmo registro; conflito de payload rejeitado |
| Dinheiro Livre | Deduplicar apenas valores efetivamente refletidos/reconciliados | matriz de valores e testes de faturas, pagamentos parciais, créditos e estornos |

## Regras financeiras que não podem regredir

1. Reservas ativas e concluídas permanecem comprometidas no Dinheiro Livre.
2. Concluir reserva não libera saldo; somente resgate explícito.
3. Ledger de alocações permanece append-only.
4. Despesa vinculada a reserva deve reduzir o envelope e o caixa uma única vez.
5. Fatura ou pagamento parcial só pode ser excluído da matriz pelo valor efetivamente já refletido na tesouraria.
6. Créditos, estornos e ajustes devem reduzir a dedução somente quando houver contrapartida financeira confirmada.
7. Não inferir operações históricas nem lançar débitos retroativos sem evidência.
8. Toda gravação composta deve ser atômica, idempotente e isolada por `household_id`.

## Registro de execução

Os itens acima começam como pendentes. Nenhum será declarado concluído sem diff, teste reproduzível e resultado de CI associados ao SHA exato.
