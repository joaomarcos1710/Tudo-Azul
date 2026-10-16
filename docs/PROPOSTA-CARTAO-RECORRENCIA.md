# Proposta: tela de cartão e recorrência (para aprovação)

*16/10/2026. Nada aqui foi implementado. Cada decisão tem uma recomendação; o responsável pelo produto aprova, troca ou adia.*

Os dois são requisitos do corte de 1/12/2026 (`PLANO.md`). O cartão já tem banco (modelo B, migrations 002 e 003), mas faltam regras de uso. A recorrência não existe no banco.

---

## Parte A — Cartão de crédito

### Como o banco funciona hoje (modelo B)
- **Compra** = parcelas (`debt_installments`): compromisso futuro, **fora** do patrimônio.
- **Cobrança** (`debt_bill`) = a parcela entra na fatura: **vira despesa e dívida na data da cobrança**.
- **Pagamento da fatura** (`debt_pay`): sai da conta e reduz a dívida. Não é despesa.
- **Estorno** (`debt_refund`), **antecipação** (`debt_anticipate`) e **anulação auditada** (`debt_void`) já existem.

### A1. Quando a compra vira despesa? ⚠️ conflito a resolver
O `PLANO.md` diz "na data da compra". O banco reconhece "na data da cobrança". As duas coisas só coincidem se a cobrança da 1ª parcela for registrada na data da compra.

| Opção | Como fica | Prós e contras |
|---|---|---|
| **A1-a (recomendada)** | 1ª parcela cobrada **na data da compra**; as demais, **no fechamento de cada fatura** | À vista = despesa no dia, como no plano. Parcelado = cada parcela é despesa no mês em que entra na fatura, como no Organizze. Não muda o banco |
| A1-b | Tudo cobrado no fechamento da fatura | Compra do dia 28 só aparece como despesa no mês seguinte. Confunde o orçamento |
| A1-c | Compra inteira como despesa na data da compra, mesmo parcelada | Uma TV de R$ 3.000 em 10× estoura o mês da compra. Distorce o orçamento |

### A2. Dia de fechamento e vencimento ⚠️ precisa de migration
O cartão hoje não guarda esses dias. Sem eles, o app não sabe em qual fatura cada compra cai.

**Recomendação:** migration pequena adicionando `closing_day` e `due_day` (1–31) aos cartões, com teste. A fatura passa a ter rótulo automático (ex.: "nov/2026") e vencimento calculado (mês curto: último dia do mês).

### A3. Quem cobra as parcelas futuras todo mês?
Alguém precisa transformar "compromisso" em "cobrado" quando a fatura fecha.

| Opção | Como |
|---|---|
| **A3-a (recomendada)** | Uma função nova no banco (`card_bill_due`) cobra **todas as parcelas vencidas até hoje**. O app chama ao abrir o painel ou a tela do cartão. Repetir não duplica nada, porque cobrar a mesma parcela duas vezes já é recusado |
| A3-b | Agendador no banco (`pg_cron`), toda madrugada | Funciona com o app fechado, mas é mais uma peça para monitorar |
| A3-c | Botão "fechar fatura" manual | Simples, mas depende de lembrar todo mês |

### A4. A tela (com A1-a, A2 e A3-a)
- **Cartões:** nome, fechamento, vencimento e **fatura atual** (cobrado até agora), com **próximas faturas** (compromissos).
- **Compra no cartão:** valor total, nº de parcelas, data, categoria e descrição. O app divide em parcelas, com o **resto dos centavos na 1ª** (regra do §5), e cobra a 1ª na data da compra.
- **Pagar fatura:** conta de origem e valor (total ou parcial).
- **Estornar compra:** usa `debt_refund`.
- **Painel:** a fatura em aberto entra na **Dívida**; as parcelas futuras ficam na faixa de **compromissos**, como já funciona.

---

## Parte B — Recorrência (precisa de migration)

### B1. Modelo
Tabela nova `recurrences`, com:
- família;
- tipo (receita, despesa, transferência ou **assinatura no cartão**);
- valor, descrição e categoria;
- conta (ou cartão; ou conta de destino, na transferência);
- frequência (**mensal**, semanal, anual) e dia;
- início, fim opcional e ativa.

Os lançamentos gerados ganham `recurrence_id` e a **data da ocorrência**. Um índice único (`recurrence_id` + data) garante que **a mesma ocorrência nunca é gerada duas vezes**.

### B2. Geração
**Recomendação:** gerar os lançamentos **Planejados** dos **próximos 2 meses**, sob demanda. Uma função no banco é chamada ao abrir o app (mesma ideia do A3-a, e repetir não duplica). Pagou? É só "Marcar pago", como já existe.

### B3. Editar e excluir
- **Só este:** altera aquele lançamento (ex.: a luz deste mês veio R$ 187,40). A regra não muda.
- **Este e os seguintes:** encerra a regra antiga na véspera, cria a regra nova a partir dessa data e troca os planejados futuros ainda não pagos.
- **Os já pagos nunca são alterados** pela recorrência.

### B4. Valor variável (luz, água, cartão de academia com reajuste)
O valor da regra é uma **estimativa**. Cada ocorrência planejada pode ser corrigida antes de marcar como paga.

### B5. Assinatura no cartão (Netflix, Spotify)
A ocorrência vira **parcela de cartão** do mês, cobrada na fatura pelo mesmo caminho do A3. Assim a assinatura não sai de conta nenhuma: entra na fatura.

---

## Ordem sugerida de implementação
1. Migration 004: `closing_day`/`due_day` + `card_bill_due` (A2 + A3-a), com testes pgTAP.
2. Tela de cartão (A4).
3. Migration 005: recorrência (B1–B5), com testes pgTAP.
4. Tela de recorrência dentro de Lançamentos.

Cada migration passa pelo mesmo processo das anteriores: PR, testes no CI e aplicação só depois de aprovada.

## Decisões pedidas
1. **A1:** a, b ou c? (recomendo **a**)
2. **A2:** aprova a migration com dia de fechamento e vencimento? (recomendo **sim**)
3. **A3:** a, b ou c? (recomendo **a**)
4. **B2:** gerar com quantos meses de antecedência? (recomendo **2**)
5. **B5:** assinatura no cartão entra na primeira versão? (recomendo **sim**, porque você usa)
