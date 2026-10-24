# Pesquisa de ideias: apps e projetos open source (24/10/2026)

Duas pesquisas feitas com WebSearch/WebFetch: produtos comerciais (Brasil e exterior) e projetos open source no GitHub. Estrelas e detalhes são de 24/10/2026. O que não foi visto numa página está marcado como **não confirmado**. Nada aqui é decisão: as ideias precisam de aprovação e respeitam o `docs/PLANO.md` (o corte de 1/12 não ganha escopo novo). Decisões de 24/10/2026: Open Finance fora do escopo; segunda pessoa da família não é prioridade agora.

## Achado principal: o Organizze tem API pública

- **Documentação:** https://github.com/organizze/api-doc (a própria empresa marca como beta).
- **Acesso:** a URL base é `https://api.organizze.com.br/rest/v2`. A autenticação é HTTP Basic, com o e-mail como usuário e, como senha, um token gerado em `app.organizze.com.br/configuracoes/api-keys`. O cabeçalho `User-Agent` é obrigatório.
- **O que dá para ler:**
  - contas, categorias (com `parent_id`) e cartões (`closing_day`, `due_day`);
  - faturas (`closing_date`, `amount_cents`, `payment_amount_cents`, `previous_balance_cents`);
  - transferências e budgets mensais por categoria;
  - lançamentos com `amount_cents`, `paid`, `installment`/`total_installments`, `recurring`, `tags`, `credit_card_invoice_id`, `paid_credit_card_invoice_id` (marca o pagamento de fatura) e `oposite_transaction_id` (marca a transferência).
- **Limitações:**
  - os lançamentos são consultados por mês (`start_date`/`end_date`);
  - nos exemplos da documentação, o sinal de `amount_cents` aparece de forma inconsistente, então isso precisa ser verificado com dados reais.
- **Exportação por arquivo:** existe só na web e chega como planilha por e-mail, com até 24 meses por vez. Desde 09/2025 o formato é CSV. Colunas, separador e formato não foram confirmados.
- **Consequência para o plano:** a importação do histórico, hoje prevista para depois de 1/12, fica mais barata e mais confiável pela API do que pelo CSV. Também dá para usar a API **durante o uso em paralelo**, para comparar os saldos dos dois apps automaticamente (critério 1 do corte).
- **Segurança:** o token da API do Organizze é uma credencial. Ele nunca vai para o repositório, o chat ou o front, e deve ser revogado depois da importação.

## Top ideias (valor ÷ esforço)

| # | Ideia | Esforço | Quando | Fonte |
|---|---|---|---|---|
| 1 | **Comparador de saldos via API do Organizze** durante o uso em paralelo (só leitura, roda localmente pelo dono) | P/M | Antes de 1/12 (ajuda o critério 1) | organizze/api-doc |
| 2 | **Conciliação**: marcar lançamento como conferido, informar o saldo do extrato e ver a diferença até zerar | P | Antes de 1/12 (critério 1) | Actual Budget (actualbudget.org/docs/accounts/reconciliation) |
| 3 | **Importador do histórico pela API do Organizze**, com `organizze_id` como chave externa para poder repetir a importação sem duplicar | M | Logo depois de 1/12 | organizze/api-doc |
| 4 | **Orçamento por categoria**: realizado e previsto lado a lado, calculado numa RPC (sem cron); estouro opcional desconta do mês seguinte | M | Depois de 1/12 | Organizze budgets, Firefly III, Simplifi |
| 5 | **Regras de categorização** sobre a descrição original (imutável), em tabela simples, com "categorizou, vira regra" e "aplicar às antigas" | M | Depois de 1/12 (junto da importação) | Actual Budget, Tiller AutoCat |
| 6 | **Saldo projetado e "quanto sobra no mês"** (renda − recorrentes − parcelas) | M | Depois de 1/12 | Simplifi Spending Plan |
| 7 | **Calendário de vencimentos e lembrete** (fatura, boleto, assinatura) via PWA | M | Depois de 1/12 | Monarch, Mobills |
| 8 | **Multimoeda com moeda principal BRL**: tabela `exchange_rates` (de, para, data) única com CHECK de taxa > 0, PTAX do BCB e cotação real digitável (Nomad/Remessa) | M | dez–jan (já previsto) | Sure (exchange_rate.rb), Lunch Money |

**Para família brasileira (YNAB "true expenses"):** IPVA, IPTU, matrícula e seguro anuais viram provisão mensal, e o 13º vira a receita que paga essas despesas. Cabe junto com o orçamento (#4).

**Investimentos e IR (fev–maio/2027):**
- movimentações no formato do Ghostfolio (BUY, SELL, DIVIDEND, FEE, INTEREST), cada uma com sua moeda;
- uma tela "Meu DARF" (lucro do mês, base, imposto, compensação de prejuízo, isenção de R$ 20 mil/mês em ações) e uma ficha "Bens e Direitos", como no Investidor10;
- preço médio com PTAX do dia para o exterior, como na Dlombello;
- conferir os números com o ReVar oficial (B3/Receita).

Os calculadores TWR/MWR do Ghostfolio **não estão implementados** (lançam "Method not implemented"), então não servem de referência.

## O que NÃO copiar (e por quê)
- **Orçamento por envelope puro** (Actual/YNAB): mudança de mentalidade grande para quem vem do Organizze.
- **Partidas dobradas completas** (Firefly III): pesado para uso familiar.
- **Cotações via Yahoo e Redis** (Ghostfolio): fonte instável e infraestrutura desnecessária para o porte do Tudo Azul.
- **Open Finance — descartado pelo dono em 24/10/2026.** Para registro: agregadores comerciais (Pluggy, Belvo): exigem contrato com vendas. Um relato de terceiro, não confirmado, fala em R$ 2,5–6 mil/mês. O "Meu Pluggy" (gratuito, para as próprias contas) pode ser testado depois, mas a gratuidade da API e os termos de uso não foram confirmados.
- **Criptografia de ponta a ponta** (Budget Zen): impede as regras no banco (RLS e RPCs).
- **Código de projetos AGPL/GPL** (Firefly, Ghostfolio, Sure, parser de notas): copiar o código obrigaria a mudar a licença do Tudo Azul. Ideias e modelagem podem ser usadas livremente. Actual e ezbookkeeping são MIT.

## Contexto de mercado
GuiaBolso (PicPay, desligado em 11/2022) e Olivia (Nubank) foram comprados e encerrados. É um argumento a favor de ter os próprios dados num app próprio, com exportação CSV sempre disponível.

## Fontes principais
- **Importação e Organizze:** github.com/organizze/api-doc, ajuda.organizze.com.br
- **Projetos open source:** github.com/actualbudget/actual, github.com/firefly-iii/firefly-iii, github.com/we-promise/sure, github.com/ghostfolio/ghostfolio, github.com/mayswind/ezbookkeeping
- **Apps internacionais:** help.monarch.com, support.simplifi.quicken.com, support.lunchmoney.app, help.tiller.com, ynab.com
- **Investimentos e IR:** investidor10.com.br, b3.com.br (ReVar), sites.google.com/view/dlombelloplanilhas
