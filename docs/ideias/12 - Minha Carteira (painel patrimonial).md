# Ideia 12 — "Minha Carteira": painel patrimonial familiar

**Status:** ideia, não implementada. **Origem:** pedido do dono, com um PRD em quatro fases. Esta é a última ideia da lista.

## O que já existe (e muda o escopo)
- **Ocultar valores**: já existe em `src/lib/privacidade.ts` (troca os valores por "R$ ••••" e guarda a preferência no aparelho). Veio do commit `b1e3b2e`, com ajustes em #140. **O texto diz "integrar com a PR #210", mas a #210 não é isso.** Usar `privacidade.ts` como fonte.
- **Visão geral**: `src/pages/VisaoGeral.tsx` já mostra patrimônio, evolução, saldos, próximos planejados e projeção. "Minha Carteira" é mais uma **reorganização** dessa tela do que um painel novo.
- **Patrimônio** já existe com fórmula própria (`carregarPatrimonio`, documentada em `docs/projeto/20`).
- **Disponível** já tem regra no doc 20 (ver abaixo).
- **Investimentos, Dívidas e Cartões** já têm resumos e telas próprias.

## Conflitos entre o PRD e as regras atuais (decidir antes)
1. **"Saldo disponível" (PRD) × "Disponível" (doc 20).** O PRD pede só dinheiro em contas bancárias. O doc 20 inclui **Corretora** (saldo parado) e exclui renda fixa e variável (decisão #200, de 06/11). Escolher uma: o app não pode ter dois "disponíveis".
2. **Duas fórmulas de patrimônio.** O PRD: Total = Contas + Investimentos + Bens; Líquido = Total − Dívidas. O app: disponível + crédito a receber + bens − dívida. São números diferentes para a mesma palavra. Escolher uma e renomear a outra.
3. **Logos.** O PRD pede logos do cadastro dinâmico, sem arquivos fixos. Hoje as logos vêm de `src/lib/bancos.ts` (lista fixa). Trocar exige uma tabela de instituições no banco com upload controlado, o que é uma migration e uma decisão de custo.
4. **Moedas.** O PRD pede BRL, USD e EUR separados. Já é a regra do app (saldo total só em reais; outras moedas à parte). Manter, sem conversão automática sem cotação registrada.
5. **Pagamento de fatura.** O PRD está certo: não é despesa duplicada. O app já trata assim (ver doc 20).

## Pontos a decidir
- **Substituir ou criar?** Reorganizar a Visão geral, ou criar a rota "Minha Carteira" ao lado? Criar ao lado duplica números: cada um tende a divergir.
- **Gráficos.** Rosca de distribuição e sparkline de evolução precisam de consulta no banco, não de soma no navegador. Uma função nova por gráfico, com teste.
- **Chips e âncoras.** Rolar até a seção é simples. A dúvida é só a ordem, que o PRD já fixa.
- **Contexto familiar.** "Quem realizou cada movimentação" já existe (atribuição por pessoa, #205). Conferir antes de duplicar.

## Ordem sugerida (as 4 fases do PRD)
1. **Esqueleto**: cabeçalho, chips e ocultar valores (já existente, só reutilizar `privacidade.ts`).
2. **Saldos e Contas**: com dados reais e as duas definições resolvidas (ponto 1 e 2 acima).
3. **Cartões e Dívidas**: carrossel de cartões, limite e próxima fatura (já existe em Cartões).
4. **Gráficos**: distribuição e sparkline, cada um com consulta e teste.

Cada fase é uma PR, com número na versão, como no resto do projeto.

## Fora do escopo desta ideia
Mudar o cálculo de patrimônio, disponível ou fatura sem decisão registrada no doc 30.

## Critério de pronto (quando virar PR)
- Decisão sobre "disponível" e "patrimônio" registrada no doc 30, e doc 20 atualizado.
- Nenhum total somado no navegador.
- Empty state sem números falsos.
- Doc 10 (telas) atualizado.
