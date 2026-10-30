# Tudo Azul — Plano técnico

## Escopo (revisado em 13/10/2026: "barco todo")
**Núcleo:** autenticação, espaço familiar compartilhado, dashboard, contas, categorias, lançamentos, orçamentos, relatórios, exportação CSV, RLS.
**Módulos (entram no produto, depois do núcleo estável):** cartões de crédito e parcelamentos, dívidas e empréstimos, investimentos, visão de patrimônio líquido.
**Ainda fora:** Open Finance, IA, app nativo. Importação de CSV de extratos entra como módulo.

## Metas e prazos (definidos em 16/10/2026)
| Meta | Prazo | Condição |
|---|---|---|
| **Parar de usar o Organizze** | **1/12/2026** (meta, não obrigação) | Só corta se os 4 critérios abaixo forem atendidos; se não, adia por qualidade, nunca por escopo novo |
| **Parar de usar a planilha de investimentos (Dlombello)** | **Maio de 2027**, depois de entregar o IRPF 2027 | Os dados de 2026 ficam na planilha até a declaração |

**Escopo para 1/12/2026** (o que é usado hoje no Organizze: entradas e saídas, cartão de crédito e pagamentos):
- login, família e convite da segunda pessoa;
- contas, categorias e lançamentos (receita, despesa, transferência; Pago/Planejado);
- **lançamentos recorrentes** (requisito novo; não existe no banco hoje, ver "Regras dos módulos novos");
- cartão de crédito: compra, compra parcelada, fatura e pagamento;
- painel com saldos e patrimônio (contas e dívidas);
- exportação CSV, que também serve de backup.

**Fica para depois de 1/12:** telas de empréstimo, investimentos, orçamento, metas, análise, importação do histórico do Organizze e multimoeda. O histórico não é importado no corte: o app começa com os saldos iniciais, e o Organizze é exportado e arquivado antes de ser cancelado.

**Critérios para o corte** (todos obrigatórios):
1. Saldos batendo com o extrato do banco por 2 semanas seguidas, em uso paralelo com o Organizze.
2. ~~A segunda pessoa da família lança pelo celular sem ajuda.~~ **Retirado em 24/10/2026** (decisão do dono: a segunda pessoa não é prioridade agora). O convite continua existindo; e-mail próprio (SMTP) só quando ela entrar.
3. Exportação CSV funcionando.
4. Nenhum bug de valor em aberto.

**Fora do escopo** (decisão de 24/10/2026): **Open Finance** (conexão automática com bancos). Os dados entram por lançamento manual, recorrentes e, no futuro, importação de arquivo/API do Organizze.

**Cronograma de referência:**
| Período | Entrega |
|---|---|
| 15–19/10 | Revisão e merge da pilha de PRs até o `main`; PR de centavos (`format.ts`); criação do projeto Supabase hospedado (aplicar migrations lá exige autorização explícita) |
| 20–26/10 | Login, família, convite |
| 27/10–2/11 | Contas, categorias, lançamentos |
| 3–9/11 | Recorrência; cartão, fatura e parcelas |
| 10–19/11 | Painel e exportação CSV |
| 20–30/11 | Uso em paralelo com o Organizze e conferência semanal dos saldos |
| 1/12 | Corte (se os critérios forem atendidos) |
| dez–jan | Estabilização e **desenho da multimoeda** |
| fev–abr | Investimentos (Brasil e exterior; valor atualizado à mão primeiro) |
| maio/2027 | Uso em paralelo com a planilha; corte depois do IRPF |

Princípio: **o núcleo é desenhado e migrado na etapa 3; cada módulo ganha migrations próprias na sua etapa (9–12)** e só é liberado quando seus cálculos têm testes. O núcleo é desenhado para aceitá-los (ver `docs/MODELO-DE-DADOS.md`, seção 11). *(Revisado em 13/10/2026: a versão anterior previa as tabelas de cartões, dívidas e investimentos já na etapa 3.)*

## Decisões técnicas
| Tema | Decisão | Motivo |
|---|---|---|
| Front | React 18 + TypeScript + Vite 5 | Build rápido, deploy estático na Vercel |
| Estilo | Tailwind 3.4 | Versão estável; tokens de cor no `tailwind.config.js` |
| Rotas | React Router 7 | SPA; `vercel.json` reescreve tudo para `index.html` |
| Backend | Supabase (Postgres + Auth + RLS) | Pedido na especificação |
| Dinheiro | `numeric(14,2)` no banco; **centavos inteiros (`Cents`) no front**; totais e qualquer conta com fração calculados no SQL | Evita erro de ponto flutuante (`0,1 + 0,2`). Detalhes em `MODELO-DE-DADOS.md`, seção 5 |
| Datas | `date` no banco, string `YYYY-MM-DD` no front | Evita deslocamento de fuso; fuso fixo America/Sao_Paulo |
| Chaves públicas | Só `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` no navegador | A publishable key pode estar no cliente; a proteção real é o RLS. Nunca expor `secret`/`service_role` |

## Regras financeiras (valem do banco ao dashboard)
- `valor` sempre positivo; o `tipo` define o efeito.
- **Saldo da conta** = saldo inicial + receitas pagas − despesas pagas ± transferências pagas, com `data do saldo inicial <= data <= data de referência`. O saldo inicial é o saldo **no início do dia** da data de abertura; o dia da abertura conta.
- **Saldo total** soma todas as contas abertas até a data de referência, ativas ou não.
- **Receita e despesa exigem categoria** (existe "Sem categoria" por tipo); transferência não tem categoria — garantido por `CHECK` no banco.
- **Receitas/despesas do período** contam só `status = paid` e **excluem transferências**.
- **Planejado** (`planned`) aparece à parte e nunca entra em saldo, receita ou despesa realizados.
- **Orçamento** vale só para categoria de despesa de nível raiz e consome apenas despesas `paid` dela e de suas subcategorias no mês. A restrição é garantida pelo banco (ver `MODELO-DE-DADOS.md`, seção 3).
- **Retroativos/edições:** saldos e relatórios são sempre **derivados** das movimentações (nunca gravados), então editar ou excluir recalcula tudo de forma consistente. **Receitas e despesas anteriores à data do saldo inicial são permitidas** (histórico legítimo; transferências, não — ver abaixo): entram em relatórios e orçamentos do seu período, mas **não alteram o saldo da conta**, que parte do saldo inicial na data informada. A tela avisa isso ao salvar. Para que o histórico também reflita no saldo, o usuário recua a data do saldo inicial e ajusta o valor.
- Contas com histórico são desativadas, nunca apagadas. Categorias idem. **`active = false` só impede novas movimentações:** a conta desativada continua nos saldos, nos totais e nas consultas históricas (ver `MODELO-DE-DADOS.md`, seção 4.4).
- Transferência: origem ≠ destino; ambas da mesma família e ativas ao criar (conta desativada não recebe novas movimentações); **data não anterior à abertura de nenhuma das duas contas** (validado por constraint/trigger). Assim uma transferência nunca altera o total de saldos. *(Aprovado: decisão 8 em `MODELO-DE-DADOS.md`.)*
- **Importação:** hashes indicam *possíveis* duplicidades e nunca descartam lançamentos automaticamente; há prévia, relatório de conflitos e confirmação antes de gravar (`MODELO-DE-DADOS.md`, seção 8). O formato do Organizze ainda é **pendente de amostra**.

## Regras dos módulos novos
- **Cartão:** compra no cartão é despesa na data da compra (competência), mas **não mexe no saldo de nenhuma conta**; o saldo só cai quando a **fatura é paga** (no modelo B, `debt_pay`: sai da conta e reduz a dívida, sem contar despesa de novo). Cada cartão tem dia de fechamento e vencimento.
- **Recorrência** *(implementada na migration 006, mensal; frequências semanal a anual na migration 016, 28/10/2026 — ver `docs/projeto/21 - Banco de dados.md`. O texto abaixo é o requisito original)* (requisito de 16/10/2026): uma regra (valor, conta ou cartão, categoria, frequência mensal/semanal/anual, dia, início e fim opcional) gera os lançamentos **Planejado** dos próximos meses, ligados à regra; pagar = marcar como Pago. Editar oferece "só este" ou "este e os seguintes". **Precisa cobrir assinatura recorrente no cartão** (entra na fatura, não sai de conta). O desenho será proposto e aprovado antes de qualquer migration.
- **Parcelamento:** compra gera N parcelas ligadas por um `installment_group_id`; cada parcela cai na fatura do seu mês. Editar/excluir oferece "só esta" ou "esta e as seguintes".
- **Dívida/empréstimo:** saldo devedor, taxa, parcelas e vencimentos. Pagamento de parcela é uma saída de conta que reduz o saldo devedor; juros são separados da amortização.
  - *Atualização de 15/10/2026 (modelo B, migration 003):* no banco, **parcela (`debt_installments`) existe só em cartão**: é compromisso futuro que vira dívida quando cobrado. Em empréstimo e financiamento o principal já entra inteiro na dívida no desembolso, e parcelas por cima disso contariam o principal duas vezes. O empréstimo é pago com `debt_pay` (juros e tarifas com `debt_loan_event`). **"Parcelas e vencimentos" de empréstimo** (ex.: cronograma SAC/Price) ficam para um **conceito próprio, ainda não desenhado, que não reutiliza a estrutura de parcelas de cartão**. *(Decisão confirmada pelo responsável pelo produto em 15/10/2026.)*
  - **Controle futuro de empréstimos e financiamentos** (continua no planejamento) deverá contemplar:
    - vencimentos e cronograma de prestações;
    - amortização do principal;
    - juros e tarifas;
    - pagamentos parciais e antecipados;
    - descontos por antecipação, que reduzem a dívida **sem serem confundidos com saída de caixa**;
    - simulações de quitação e comparação de cenários.
  - **Regras desde já:** o cronograma **não duplica o saldo da dívida** (o saldo devedor continua sendo o da dívida; o cronograma só detalha como ele será pago) e **a amortização do principal nunca vira despesa**. O tratamento contábil de juros, tarifas e descontos será definido e testado quando o módulo for implementado.
- **Investimento:** posições por ativo (quantidade, custo médio) e aportes/resgates como movimentações. Valor de mercado informado manualmente no início; rentabilidade = valor atual − custo aportado. Aporte é transferência para patrimônio, **não é despesa**.
- **Patrimônio líquido** = saldos de contas + investimentos − dívidas − faturas em aberto.
  - *Situação em 16/10/2026:* `net_worth()` (migration 002) já calcula **disponível + crédito a receber − dívida** (faturas em aberto estão dentro da dívida); compromissos futuros aparecem à parte e não entram. Investimentos entram quando o módulo existir.
- **Multimoeda** (prioridade logo depois do corte de 1/12): a família tem contas em dólar (corretoras e contas globais). Hoje o banco **não tem moeda** e soma tudo como real, então **nenhuma conta em moeda estrangeira pode ser cadastrada antes da multimoeda**. O desenho precisa cobrir moeda por conta e por ativo, câmbio (PTAX do Banco Central), transferência entre moedas e patrimônio convertido para real.
- **Envios ao exterior antes da multimoeda** (regra de transição): o envio de reais para fora **nunca é despesa**. É uma transferência para uma conta em reais "Exterior (em trânsito)", pelo valor pago em reais. É uma aproximação (não acompanha o câmbio) e será substituída pelas contas reais em dólar quando a multimoeda existir.
- **IR de investimentos** fica **fora do app** no início (planilha ou ferramenta especializada). Só entra se o risco de um cálculo errado valer a pena, com testes e conferência contra a declaração real.

## Plano por etapas
*Situação em 16/10/2026: etapa 1 no `main`; etapa 3 e as migrations dos módulos de cartão e dívida (002 e 003) prontas e testadas, em PRs ainda não mergeados no `main` e não aplicadas ao Supabase hospedado. As telas dos módulos seguem a ordem das metas acima, não a numeração.*

1. **Estrutura e design system** — *feito*
2. Conexão com Supabase (cliente + variáveis; projeto a ser criado por você)
3. Migrations versionadas do **núcleo** (`supabase/migrations`: famílias, contas, categorias, lançamentos, orçamentos) + RLS + testes de isolamento e de saldo. Módulos têm migrations próprias nas etapas 9–12. Desenho aprovado em 13/10/2026; o plano da primeira migration está em `docs/MIGRATION-001-PLANO.md` e **só é implementado após sua autorização**.
4. Autenticação e espaço familiar (criar família, convidar membro)
5. Contas, categorias e lançamentos (CRUD, filtros, confirmação de exclusão)
6. Cálculos financeiros (SQL) e dashboard
7. Orçamentos, relatórios, CSV
8. Testes ponta a ponta e revisão de segurança  → **fim do núcleo**
9. Cartões, faturas e parcelamentos
10. Dívidas e empréstimos
11. Investimentos
12. Patrimônio líquido e importação (Organizze e extratos; formato a confirmar com amostra real). *Decisão 14 (aprovada): a importação do Organizze é antecipada para depois de o núcleo estar estável (etapas 5 e 6 concluídas e testadas), e só depois de analisarmos a amostra real.*

Antes da etapa 5, um PR próprio converte `src/lib/format.ts` para centavos inteiros, com testes.

## Estrutura de pastas
```
src/
  components/ui/       Button, Card, Field, EmptyState, Aviso
  components/layout/   AppShell (lateral no desktop, barra inferior no celular)
  lib/                 format.ts (BRL, datas), supabase.ts
  pages/               uma por área do menu
supabase/migrations/   (etapa 3)
docs/                  este plano
```


## Evolução patrimonial (decisão de 31/10/2026)

A nova direção de produto está especificada em [`ARQUITETURA-PATRIMONIO.md`](ARQUITETURA-PATRIMONIO.md): investimentos híbridos, módulo de gestão de dívidas sobre o motor `debts`/`debt_events` existente, bens e consolidação multimoeda. A sequência começa pela auditoria/fundação cambial, depois investimentos manuais, bens, experiência de dívidas, consolidação e cotações automáticas. Cada fase terá PR e migration próprias. A proposta anterior de multimoeda ainda precisa ser corrigida e validada antes de virar SQL. As migrations 025 e 026 seguem no fluxo de produção separado.


## Fundação multimoeda, fase 1

A migration 027 adiciona o catálogo BRL/USD/EUR, a moeda de consolidação da família e o histórico/consulta de câmbio. Ela não habilita contas ou lançamentos em moeda estrangeira, pois as RPCs atuais ainda retornam totais únicos. Ver MULTIMOEDA-FASE-1.md.


## Segurança da moeda de consolidação

A migration 028 mantém households.report_currency bloqueada para o cliente enquanto as RPCs e a interface ainda apresentam valores em BRL. A alteração será liberada junto da implementação completa de conversão e relatórios multimoeda.


## Módulo de dívidas e empréstimos

A PR #103 entrega uma primeira experiência funcional para empréstimos e financiamentos, reaproveitando `debts`/`debt_events`. Permite cadastrar saldo devedor de referência, registrar taxa mensal e pagamento mínimo, registrar pagamentos com principal/juros/tarifas na mesma transação e comparar Snowball/Avalanche sem alterar o saldo real. Cartões continuam na tela própria. Esta entrega permanece em BRL até a integração multimoeda dos relatórios e saldos.
