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

Conciliação com trava de período (`reconcile_account`, `reconciliation_undo`); encerrar recorrência mantendo os pagos e mandando os planejados futuros para a lixeira (`recurrence_end`); recorrências geradas ao abrir o app (sem cron); parcelas "n/N" e prévia de exclusão no cartão; extrato com movimentos de cartão/dívida; exportação completa em 5 CSVs; painel com variação contra o mês anterior, rosca e acumulado; pagamento adiantado de cartão vira crédito (PR em revisão).

## Ideias, por prioridade proposta

Legenda: esforço P/M/G; **Mig.** = precisa de migration; fontes nas seções abaixo.

### A. Candidatas a entrar antes de 1/12 (pequenas, sem ameaçar os 4 critérios do corte)

| # | Ideia | Por que | Esforço | Mig. | Risco |
|---|---|---|---|---|---|
| A1 | **"Quanto falta" da compra parcelada** e parcelas futuras por mês de fatura ("já comprometido") | Planilhas e apps mostram; hoje só há o total de parcelas futuras do cartão | P | Não (RPC de leitura) ou talvez | Baixo, se vier do banco e não somar parcela em dobro |
| A2 | **Aviso ao marcar Pago com valor diferente do planejado** (conta de luz, água) | "Marcar pago" só troca o status; o valor se corrige em Editar. Monarch usa destaque para isso (só trecho de busca) | P | Não | Baixo (só aviso) |
| A3 | **Conta "Carteira (dinheiro)"** | Planilhas registram o meio de pagamento; é só cadastrar uma conta | P | Não | Nenhum |
| A4 | **Lançamento valor-primeiro no celular** (valor grande, teclado numérico, "Hoje/Ontem", "Mais opções" recolhido) | Padrão dominante nos apps de despesa vistos; o abandono de planilha vem de esquecer de lançar | M | Não | Acessibilidade: manter `<input>` real, nada de teclado só de botões |
| A5 | **Trocar `window.confirm` por "Desfazer"** na exclusão (a lixeira já existe) | Menos atrito, mais acessível | P | Não | Baixo |
| A6 | **Pago x planejado sempre com texto e ícone** (também nos gráficos) | WCAG 1.4.1; reforça a regra do produto | P | Não | Baixo |
| A7 | **Estados vazios com uma ação** (ex.: "Cadastrar conta" no aviso) | Primeiro uso mais claro | P | Não | Baixo |
| A8 | **Recorrência "a cada N meses"** (bimestral, trimestral, semestral, anual) | IPVA/IPTU/seguro anuais; **só entra se o dono usa recorrência não mensal hoje** | M | Sim | Médio: regra do dia 29–31 e testes |

### B. Depois do corte (estabilização)

| # | Ideia | Fonte | Esforço | Mig. |
|---|---|---|---|---|
| B1 | Parcelado em conta (carnê/boleto): N planejados ligados por grupo, resto de centavos na 1ª parcela | sem fonte de concorrente; é demanda do dono | M | Sim |
| B2 | Calendário de vencimentos + provisões anuais (informativas, **nunca lançamento**) | planilhas públicas; modelo de 10 linhas na seção F | M | Sim |
| B3 | 13º e férias como recorrência anual com valores diferentes | planilhas | P (usa A8) | Não |
| B4 | "Quanto sobra no mês" e saldo projetado, **estimativa** usando planejados reais, nunca extrapolando o ritmo | Simplifi (reclamação de projeção enganosa) | M | Sim (RPC) |
| B5 | Casar pagamento com o planejado do mesmo recorrente por janela de data e valor aproximado, sem duplicar | Actual | M | Talvez |
| B6 | Sugerir vínculo lançamento↔recorrente pela descrição (só sugestão) | Lunch Money | M | Não |
| B7 | Dividir um lançamento em categorias (split) com soma validada no banco | Lunch Money | M | Sim |
| B8 | Orçamento previsto × realizado; alerta de fatura aberta maior que o orçado | Mobills, YNAB | M | Provável |
| B9 | Metas com valor-alvo e prazo ("guardar R$ X por mês"), **reservado ≠ disponível**, nunca mexe em saldo | YNAB Targets, Minhas Economias | M/G | Sim |
| B10 | Bloco "vence nos próximos 7 dias" no painel (push é mais frágil) | Monarch | P | Não |
| B11 | Reserva de emergência como meta (6× despesa mensal, estimativa) e regra 50/30/20 opcional | planilhas | M | Sim |
| B12 | Regra de fim de semana na recorrência (pular, antecipar, adiar); conta variável com valor estimado e revisão | Actual, Firefly, Money Lover | P/M | Sim |
| B13 | Importador do Organizze: id externo único, prévia, dedup em duas camadas, ciente da lixeira, janela anterior ao último ponto conciliado, rejeição por linha com motivo, testes golden com amostra sintética | Actual, Firefly, YNAB, Ghostfolio | G | Sim |

### C. Depois (já previstos no plano)

Multimoeda gravando os **dois valores digitados** e derivando a taxa; investimentos; tolerância ligada à precisão do dado (só investimentos e exterior).

## Debate: o que o crítico atacou

(Preenchido pela rodada do crítico, ver a seção "Parecer do crítico" abaixo.)

## Armadilhas de dinheiro a testar (de projetos open source e reclamações de usuários)

1. **Transferência com moeda estrangeira** quebrou saldo no Firefly (issues #11378, #9784, #11694; só títulos vistos em changelog de terceiros). Testar sinal e soma por moeda quando a multimoeda vier.
2. **Taxa conflitante deixa resíduo** (`Imbalance-USD` no GnuCash). Nenhuma taxa pré-existente pode alterar o valor gravado.
3. **Duplicata que parece nova** (`external_id` com dado volátil; arredondamento de float no fingerprint). Reimportar o mesmo arquivo dá zero novas; fingerprint em centavos inteiros; lixeira entra na comparação.
4. **Marca d'água só por data** pode perder ou duplicar o mesmo dia (inferência dos agentes, não confirmada).
5. **Resto de divisão e agenda deslocada:** Σ parcelas = total para N de 1 a 36; pagar o recorrente 3 dias depois não deixa planejado órfão; dia 29–31 e fevereiro.
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
2. Cada item gera um **lançamento planejado** no vencimento (reaproveita a recorrência anual).
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
