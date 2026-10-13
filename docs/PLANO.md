# Tudo Azul — Plano técnico

## Escopo (revisado em 13/10/2026: "barco todo")
**Núcleo:** autenticação, espaço familiar compartilhado, dashboard, contas, categorias, lançamentos, orçamentos, relatórios, exportação CSV, RLS.
**Módulos (entram no produto, depois do núcleo estável):** cartões de crédito e parcelamentos, dívidas e empréstimos, investimentos, visão de patrimônio líquido.
**Ainda fora:** Open Finance, IA, app nativo. Importação de CSV de extratos entra como módulo.

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
- **Cartão:** compra no cartão é despesa na data da compra (competência), mas **não mexe no saldo de nenhuma conta**; o saldo só cai quando a **fatura é paga** (transferência conta → cartão, que não conta como despesa de novo). Cada cartão tem dia de fechamento e vencimento.
- **Parcelamento:** compra gera N parcelas ligadas por um `installment_group_id`; cada parcela cai na fatura do seu mês. Editar/excluir oferece "só esta" ou "esta e as seguintes".
- **Dívida/empréstimo:** saldo devedor, taxa, parcelas e vencimentos. Pagamento de parcela é uma saída de conta que reduz o saldo devedor; juros são separados da amortização.
- **Investimento:** posições por ativo (quantidade, custo médio) e aportes/resgates como movimentações. Valor de mercado informado manualmente no início; rentabilidade = valor atual − custo aportado. Aporte é transferência para patrimônio, **não é despesa**.
- **Patrimônio líquido** = saldos de contas + investimentos − dívidas − faturas em aberto.

## Plano por etapas
1. **Estrutura e design system** — *feito nesta entrega*
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
