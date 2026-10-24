# Pesquisa de ideias, rodada 2 (24/10/2026, de madrugada)

Quatro pesquisadores independentes rodaram em paralelo e um quinto agente (o revisor de dinheiro) atacou o consolidado. **Nada aqui é decisão**: são ideias com fonte, para o dono escolher. As decisões já tomadas (`docs/PLANO.md`) continuam valendo: corte do Organizze em 1/12/2026 sem escopo novo, Open Finance, IA e app nativo fora, multimoeda dez–jan, investimentos fev–abr/2027, IR fora do app, nada de copiar código AGPL/GPL.

## O que foi e o que NÃO foi possível

| Pedido do dono | Resultado |
|---|---|
| Ver as planilhas do OneDrive | **Não feito.** Não há acesso: o conector do Microsoft 365 existe, mas o dono precisa autorizá-lo nas configurações de conectores, e nenhum agente pode fazer isso por ele. Como substituto, um agente leu modelos **públicos** de planilha brasileira. |
| Perplexity | **Não feito.** Sem conexão. Os agentes usaram busca na web comum. |
| Pinterest | **Não feito.** Sem acesso (exige login). Um agente pesquisou páginas públicas de UX; **nenhuma galeria visual foi aberta**, só resultados de busca. |
| Repositórios do GitHub | **Feito pelas páginas públicas.** A ferramenta autenticada do GitHub da sessão só alcança o repositório do Tudo Azul, por segurança. |
| Sites e apps | Feito, com limites: a ajuda do Organizze e a do Monarch deram 403; Minhas Economias, Wallet e Spendee sem fonte oficial. |

Regra de leitura: **"não confirmado"** significa que o agente só viu trecho de busca, review de terceiro ou nada. Nenhuma estatística de blog de fornecedor foi tratada como fato.

## O que o Tudo Azul já tem (para não repetir)

Conciliação com trava de período (`reconcile_account`, `reconciliation_undo`); encerrar recorrência mantendo os pagos e mandando os planejados futuros para a lixeira (`recurrence_end`); recorrências geradas ao abrir o app (sem cron); parcelas "n/N" e prévia de exclusão no cartão; extrato com movimentos de cartão/dívida; exportação completa em 5 CSVs; painel com variação contra o mês anterior, rosca e acumulado; pagamento adiantado de cartão vira crédito (PR #39, aguardando decisão do dono); tipo de conta `cash` (carteira em dinheiro); limite de 72 parcelas no cartão; encerrar recorrência não apaga o histórico.

## Ideias, por prioridade proposta

Legenda: esforço P/M/G; **Mig.** = precisa de migration; fontes nas seções abaixo.

### A. Candidatas antes de 1/12 (ordem revista pelo crítico, ver "Parecer do crítico")

| # | Ideia | Estado hoje | Esforço real | Mig. | Risco |
|---|---|---|---|---|---|
| **A0** | **"Marcar pago" com valor e data reais** (nenhum pesquisador viu; o crítico achou e foi confirmado em `src/lib/lancamentos.ts:200`) | `marcarComoPago` só troca o status: a data fica a **planejada** e o valor, o **estimado**. Conta de luz paga dia 12 por R$ 143,20 continua no dia 10 por R$ 150,00 até alguém abrir "Editar". | P/M | Não | **Ameaça o critério 1**: saldo do dia diferente do extrato. Em período conciliado a ação falha com 55000. |
| **A0b** | **Mensagem clara quando o período está travado** ("conta conciliada até DD/MM") | O banco recusa com 55000; a tela repassa o texto do banco | P | Não | Baixo |
| **A0c** | **Tela "divergência" na conferência**: ao não bater, listar candidatos óbvios (planejado vencido e não pago, lançamento do dia do corte, pagamento de fatura) | `account_movements` já traz parte | M | Não | Baixo; é o que fecha o critério 1 |
| A1 | "n/N, falta R$ X" por compra parcelada (reduzido) | `card_months`/`card_items` já devolvem `pending`, `seq`, `plan_count`; a tela mostra o total de parcelas futuras do cartão | P (por compra, via banco); M (total por mês) | Não/talvez | Médio se somar "comprometido" ao saldo ou à dívida (`net_worth` deixa de propósito de fora). Nunca somar no front. Assinatura de cartão só vira parcela no dia. |
| A5 | Trocar `window.confirm` por "Desfazer" **só na exclusão de lançamento** (a lixeira já existe) | Metade pronta: já há "Desfazer" depois da lixeira, mas `Lancamentos.tsx` mantém o `confirm`. **Manter a confirmação** em desfazer conciliação e encerrar recorrência (destravam período / mandam planejados à lixeira). | P | Não | Baixo |
| A7 | Estados vazios com ação (ex.: "Cadastrar conta" no aviso) | Parcial: contas, cartões e recorrentes já convidam a cadastrar | P | Não | Baixo |
| A6 | Pago x planejado com texto e ícone, inclusive nos gráficos | Parcial: lançamentos já têm o selo "Planejado" com texto; gráficos não verificados | P | Não | Baixo |
| ~~A3~~ | ~~Conta "Carteira (dinheiro)"~~ | **Já existe**: tipo `cash` (`core_schema.sql`). É só cadastrar. Carteira não tem extrato, então não ajuda a conciliar. | 0 | Não | — |
| A4 | Lançamento valor-primeiro no celular | Não existe. Reescrever o formulário é o ponto mais sensível a regressão (`parseBRL`, status automático, data; "Ontem" tem de usar `hojeSP`, nunca `Date` direto). **Depois do corte.** | G com testes | Não | Acessibilidade: manter `<input>` real |
| A8 | Recorrência "a cada N meses" | Não existe (`recurrences.day` mensal). Exige migration nova, drop/create de `recurrence_create`, grants, `00_audit` e pgTAP; o horizonte de 3 meses faz o anual só aparecer 2 meses antes. **Só se o dono usa recorrência não mensal.** | **G** | Sim | Médio |

### B. Depois do corte (estabilização)

| # | Ideia | Fonte | Esforço | Mig. |
|---|---|---|---|---|
| B1 | Parcelado em conta (carnê/boleto): N planejados ligados por grupo, resto de centavos na 1ª parcela | sem fonte de concorrente; é demanda do dono | M | Sim |
| B2 | Calendário de vencimentos + provisões anuais (informativas, **nunca lançamento**) | planilhas públicas; modelo de 10 linhas na seção F | M | Sim |
| B3 | 13º e férias: **duas regras** (uma regra tem um único valor), depois de A8 | planilhas | M | Não |
| B4 | "Quanto sobra no mês" e saldo projetado, **estimativa** com planejados reais, nunca extrapolando o ritmo. **Perigoso:** mistura planejado, realizado, parcela futura e recorrência de cartão que só nasce no dia. Só RPC; definir horizonte, contas e fórmula e escrever os testes antes. | Simplifi (reclamação de projeção enganosa) | M/G | Sim (RPC) |
| B5 | ~~Casar pagamento com planejado por valor aproximado~~ **Não fazer:** é dedup fuzzy (a seção "não copiar" proíbe) e erra direto no saldo. A alternativa segura é A0: marcar o próprio planejado como pago com valor e data reais. | Actual | — | — |
| B6 | Sugerir vínculo lançamento↔recorrente pela descrição (só sugestão) | Lunch Money | M | Não |
| B7 | Dividir um lançamento em categorias (split). **Perigoso:** quebra `expense_items`, `period_summary`, orçamento e CSV, que consomem uma categoria por lançamento. | Lunch Money | G | Sim |
| B8 | Orçamento previsto × realizado; alerta de fatura aberta maior que o orçado | Mobills, YNAB | M | Provável |
| B9 | Metas com valor-alvo e prazo ("guardar R$ X por mês"), **reservado ≠ disponível**, nunca mexe em saldo | YNAB Targets, Minhas Economias | M/G | Sim |
| B10 | Bloco "vence nos próximos 7 dias" no painel (`painel.ts` já lê planejados; push é mais frágil) | Monarch | P | Não |
| B11 | Reserva de emergência como meta (6× despesa mensal, estimativa) e regra 50/30/20 opcional | planilhas | M | Sim |
| B12 | Regra de fim de semana na recorrência; conta variável com valor estimado e revisão. Mexe em `occurrence_date`, a chave única: risco de duplicar ao mudar a regra. | Actual, Firefly, Money Lover | M | Sim |
| B13 | Importador do Organizze: id externo único, prévia, dedup em duas camadas, ciente da lixeira, janela anterior ao último ponto conciliado, rejeição por linha com motivo, testes golden com amostra sintética | Actual, Firefly, YNAB, Ghostfolio | G | Sim |

### C. Depois (já previstos no plano)

Multimoeda gravando os **dois valores digitados** e derivando a taxa; investimentos; tolerância ligada à precisão do dado (só investimentos e exterior).

## Parecer do crítico (revisor de dinheiro)

Veredito: **a lista original dos pesquisadores priorizava cosmético e deixava de fora o que mais ameaça o critério 1** (saldos batendo com o extrato por 2 semanas). Por isso a seção A foi reordenada. Dois fatos que ele apontou foram **confirmados no código**:

1. `marcarComoPago` (`src/lib/lancamentos.ts:200`) só troca `status`; a data e o valor ficam os planejados.
2. `recurrence_update` (`20261017140100_recurrences.sql`) reescreve valor, descrição e categoria de **todos** os planejados futuros ainda não pagos, apagando uma correção manual feita num deles, sem aviso.

**Ordem proposta dos 5 primeiros (revista):**
1. A0, "Marcar pago" com valor e data reais (testes vitest e pgTAP).
2. A0b, mensagem clara de período travado.
3. A0c, tela "divergência" na conferência.
4. A1 reduzido (n/N, falta X por compra, via RPC).
5. A5 só para lançamento + A7 residual.
Todo o resto de A (A4, A8) depois do corte, salvo confirmação do dono.

**As 3 ideias mais perigosas:** B5 (casar por valor aproximado), B4/B2 (sobra e saldo projetado) e B7 (split). A8 vem logo atrás pelo esforço subestimado.

**O que faltou na pesquisa para o critério 1 (erros típicos de uso paralelo):**
- data de pagamento diferente da data planejada (A0);
- lançar a mesma coisa nos dois apps com data diferente: o Organizze pode contar por competência e o banco por caixa; falta um guia de como conferir por tipo de conta;
- débito na conta lançado como compra no cartão, e o contrário;
- saldo inicial e data de abertura errados (o dia da abertura conta; lançamentos anteriores à abertura não mexem no saldo): principal causa de "não bate" no primeiro dia;
- lançamento esquecido ou duplicado (sem importação, o único controle é a conciliação);
- pagamento de fatura que sai de uma conta e é lançado em outra;
- editar uma regra recorrente sobrescreve a correção manual dos planejados futuros (fato 2);
- reabrir fatura e tarifas de cartão contra o extrato.

## Armadilhas de dinheiro a testar (de projetos open source e reclamações de usuários)

1. **Transferência com moeda estrangeira** (não confirmado: só títulos de issues do Firefly #11378, #9784 e #11694, vistos em changelog de terceiros). Testar sinal e soma por moeda quando a multimoeda vier.
2. **Taxa conflitante deixa resíduo** (não confirmado: um relato numa lista de e-mail do GnuCash, causa só sugerida). Nenhuma taxa pré-existente pode alterar o valor gravado.
3. **Duplicata que parece nova** (`external_id` com dado volátil; arredondamento de float no fingerprint). Reimportar o mesmo arquivo dá zero novas; fingerprint em centavos inteiros; lixeira entra na comparação.
4. *(hipótese, não fato)* **Marca d'água só por data** pode perder ou duplicar o mesmo dia.
5. **Resto de divisão e agenda deslocada:** Σ parcelas = total para N de 1 a 72 (o limite do app); pagar o recorrente 3 dias depois não deixa planejado órfão; dia 29–31 e fevereiro.
6. **Ajuste de saldo que esconde o erro** (YNAB trata como último recurso). Nunca ajuste silencioso.
7. **Recorrente preso depois de vinculado** (Lunch Money): pagar um planejado continua permitindo editar valor, categoria e divisão.
8. **Projeção que extrapola o ritmo** com contas variáveis: mostrar qual valor foi usado (fixo ou estimado) e rotular "estimativa".
9. **Lançamento manual é o caminho principal** (Open Finance fora): o mais testado, o mais rápido.
10. **Login compartilhado e limite de aparelhos** (Goodbudget): não adotar; o RLS por família já resolve.

## O que NÃO copiar

Partidas dobradas e cron obrigatório (Firefly); arquivo de texto como fonte da verdade (Beancount/hledger, incompatível com RLS); dedup fuzzy sem janela documentada (Actual); provisão de imposto que vira lançamento (duplica despesa); percentuais fixos como regra (50/30/20 é só régua); detecção automática de recorrentes por sincronização bancária; **qualquer código AGPL/GPL** (Firefly, Sure/Maybe, Ghostfolio, Beancount, hledger, GnuCash, KMyMoney): só a ideia. Actual e ezbookkeeping são MIT.

**Conflito com decisão anterior:** a ideia "Meu DARF" de `docs/PESQUISA-IDEIAS.md` contraria "IR fora do app". Continua **não aprovada**.

## Licenças (conferidas nas páginas dos projetos)

Actual Budget: MIT. ezbookkeeping: MIT. Fava: MIT. Firefly III: AGPL-3.0. Sure/Maybe: AGPL-3.0. Ghostfolio: AGPL-3.0. Beancount: GPL-2. hledger: GPL-3 ou posterior. GnuCash e KMyMoney: GPL, **não confirmado na página**. Repositórios brasileiros que apareceram na busca (Full Finanças, Varo, Finbud, OpenMonetis): **nenhum foi aberto**; stack e recursos não confirmados; nenhum parece superar o modelo atual.

## F. Modelo proposto de calendário de vencimentos e provisões anuais (10 linhas)

1. Tabela por família com: nome, categoria, mês e dia do vencimento, valor estimado (centavos), forma de pagamento (conta ou cartão) e parcelas.
2. Cada item gera um **lançamento planejado** no vencimento (depende de A8: a recorrência anual **ainda não existe**).
3. Valor estimado = valor do ano anterior (editável).
4. **Provisão mensal** = valor ÷ meses restantes até o vencimento. É só um número informativo: **nunca é lançamento nem saldo**.
5. Tela "Calendário" com 12 meses: vencimento de fatura, recorrentes, parcelas e obrigações anuais.
6. Cada mês mostra "comprometido" e "sobra prevista" (receita prevista menos comprometido).
7. 13º e férias entram como recorrente anual com valores diferentes.
8. "Mês pesado" = comprometido acima da média mais X% (X configurável).
9. Ao pagar, o planejado vira realizado, sem duplicar.
10. Sem valor do ano anterior, o item fica "sem estimativa" e fora da soma, com aviso.

## Reclamações recorrentes de usuários (fontes públicas, algumas só por trecho)

Lançamento manual quebrado quando a sincronização falha (Mobills, Reclame Aqui, relato individual); projeção enganosa com conta variável (Simplifi); ajuste de saldo que esconde erro (YNAB); recorrente preso depois de vinculado (Lunch Money); limite de aparelhos em login compartilhado (Goodbudget).

## Fontes principais

- Apps: support.ynab.com (conciliação, ajuste de saldo, Targets, credit overspending); help.monarch.com e monarchmoney.com/features/recurring; help.copilot.money (arquivar recorrentes); support.lunchmoney.app (recorrentes, splits); note.moneylover.me; community.simplifimoney.com e quicken.com/blog; goodbudget.com.
- Open source: github.com/actualbudget/actual (docs de reconciliação, importação e schedules), github.com/firefly-iii/firefly-iii, github.com/we-promise/sure, github.com/ghostfolio/ghostfolio, github.com/mayswind/ezbookkeeping, github.com/beancount/fava, hledger.org, code.gnucash.org (manual de transações agendadas).
- Planilhas e finanças brasileiras: investnews.com.br, educacaofinanceirabrasil.com.br, planilhadefluxo.com.br, meubolsoemdia.com.br, idec.org.br, bancobmg.com.br, jornalcontabil.com.br, blog.mag.com.br, flashapp.com.br.
- UX: screensdesign.com, lazyweb.com, hedgehoglab.com, boia.org, system.automattic.design, saasui.design, uxdesign.cc, markswebb.com, userguiding.com (estas duas últimas com viés de fornecedor; estatísticas não verificadas).
