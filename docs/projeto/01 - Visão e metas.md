---
tags: [tudo-azul, metas]
---
# Visão e metas

## Por que existe
Controle financeiro da família, feito sob medida, para sair do Organizze e (depois) da planilha de investimentos.

## Metas com data
| Meta | Data | Condição |
|---|---|---|
| Parar de usar o **Organizze** | **01/12/2026** | só se o app estiver bom (3 critérios abaixo) |
| Parar de usar a planilha de investimentos (Dlombello) | maio/2027 | depende do módulo de investimentos |

## Os 3 critérios para largar o Organizze
1. **Uso diário sem etapa de conferência ou trava de saldo no app** — a conferência manual foi descontinuada na PR #110; o saldo é calculado a partir dos lançamentos e movimentos registrados.
2. **Exportação CSV** para ter saída segura — *atendido em código* (PR #23 e #36); falta baixar e validar que os arquivos exportados abrem corretamente.
3. **Nenhum bug de valor em aberto** — a auditoria de 26/10 achou e corrigiu o único bloqueante (ver [[Auditorias/2026-10-26 Auditoria]]).

## Fora de escopo (decidido)
Open Finance · inteligência artificial · app nativo · cálculo de Imposto de Renda.

## Roadmap combinado
- **Fase 1 multimoeda:** catálogo, taxas e moeda de consolidação como fundação; não habilita contas estrangeiras.
- **Fase 2 multimoeda:** substituir agregações financeiras por moeda e conversão explícita antes de permitir saldos/contas em moeda estrangeira. Open Finance continua fora de escopo.
- **Fev–Abr/2027:** investimentos.
- **Quando você voltar ao Brasil:** importar do Organizze (precisa só de um CSV de exemplo com cabeçalho e linhas **inventadas**, nunca dados reais).
- **Depois:** domínio próprio.

## Regra de ouro
Nunca colar senha, chave ou `service_role` no chat. Nada de dados reais em testes. Mudança em produção só com o seu "pode".
