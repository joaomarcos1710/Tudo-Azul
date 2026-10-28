---
tags: [tudo-azul, ideias]
---
# Ideias e comparações

## Organizze e Mobills (páginas públicas, 26/10)
Só estrutura de funções; sem copiar marca, texto, tela ou código.

| Função | Organizze | Mobills | Tudo Azul |
|---|---|---|---|
| Contas, cartões, categorias, orçamento por categoria | sim | sim | **sim** |
| Relatórios e gráficos | sim | sim | **sim** |
| Projeção do mês | parcial | parcial | **sim** |
| Alertas de contas a pagar (push) | sim | sim | **parcial** (card "Vencidos") |
| Metas/objetivos | — | sim | não (junto com investimentos) |
| Exportar CSV | — | — | **sim** |
| Conexão bancária (Open Finance) | sim (planos pagos) | sim | **fora de escopo** |
| Renda regular × eventual, conferência de saldo | — | — | **sim** (diferencial) |

Preços vistos: Organizze Manual R$ 39/mês (Conectado R$ 49; Plus R$ 79); Mobills Premium R$ 99,90/ano (página com cache de 2022).

## DLPInvest (referência de organização)
Aproveitado: **menu por categorias** (Visão geral, Movimentações, Ferramentas…) e **ocultar valores**. Não aproveitado: variação diária do patrimônio (ruído num orçamento familiar). Próximo: separar **Início × Análises**, espelhando Portfólio × Dashboard.

## Livro de contas (prints do dono, 28/10/2026)
Só ideias de uso; sem copiar marca, texto, tela ou código. Ficam guardadas: **só se aplicam quando o dono pedir**. Em ordem de valor:

| # | Ideia | Situação no Tudo Azul | Esforço |
|---|---|---|---|
| 1 | **Valor do dia dentro da grade do Calendário** (o resultado do dia aparece no próprio quadrado) | Hoje a grade só tem marcas coloridas; o valor está na lista do dia. Proposta pronta. **Decidido pelo dono em 28/10/2026: opção A, resultado do dia (entrou − saiu).** Falta confirmar se o planejado entra no número (recomendado: sim, em âmbar, separado) e o "pode" para implementar. Precisa de função nova no banco (mesmo critério da lista do dia) com teste pgTAP, passa pelo workflow de produção. No celular o valor vai abreviado ("−1,2 mil") por causa da largura | Médio (migration + front) |
| 2 | **Grade de categorias com ícone no lançamento**: tocar no ícone em vez de abrir uma lista; valor grande no topo; data com ‹ › | Hoje a categoria é uma lista suspensa. Os ícones já existem (#72). Junta com "formulário em folha no celular" | Médio, só front |
| 3 | **Lançar em sequência**: salvar e já abrir outro em branco | Não existe. Útil para lançar vários gastos de uma vez | Baixo |
| 4 | **Dia inicial do mês** (o mês começa no dia do salário) | Já previsto em "Períodos financeiros" (etapa 1 mesclada no #58); falta a autorização das próximas etapas | Médio |
| 5 | **Tema escuro** | Não existe; as cores já estão centralizadas | Médio |
| 6 | **Relatório anual** (saldo e despesa por categoria no ano) | Temos Análises mês a mês e exportação; falta a visão do ano | Médio |

**Já temos (e mais completo):** calendário com lista do dia (#62), despesas fixas (recorrências com frequência), apagar tudo ("zerar"), família, conferência com extrato, cartão parcelado, números vindos do banco.

**Não copiar:**
- Anúncios e consentimento com centenas de "parceiros": erro de privacidade para um app de finanças da família.
- "Saldo do mês anterior" como opção: no Tudo Azul o saldo vem do banco e é contínuo; virar opção abre espaço para número errado.
- Bloqueio com senha no app: em app web exige WebAuthn; login e "ocultar valores" já cobrem. Fica para depois, se o dono pedir.
- Lembrete por notificação: já está nas decisões pendentes (alerta de vencimento por push).

## Minhas Economias (prints do dono, 28/10/2026)
Os prints mostram o **cadastro de conta** (e a tela de termos de uso); a página inicial do app não veio nos prints. Só ideias de uso; sem copiar marca, logo, texto, tela ou código. **Só se aplica quando o dono pedir.**

| # | Ideia | Situação no Tudo Azul | Esforço |
|---|---|---|---|
| 1 | **Conta principal**: o lançamento já abre na conta mais usada | Hoje o formulário abre na **primeira conta ativa** da lista. Duas formas: (a) lembrar a última conta usada no aparelho (só front, sem banco, por aparelho); (b) marcar uma conta como principal (coluna nova + migration, vale para a família toda). Recomendação: começar por (a) | Baixo (a) · Médio (b) |
| 2 | **Escolher o banco numa lista com busca** ("Buscar Banco ou Cartão"), com os mais comuns primeiro; o **apelido da conta vem preenchido** com o nome do banco | Hoje o nome é texto livre (placeholder "Ex.: Itaú João"). Lista fixa de instituições no front (sem banco), nome sugerido que a pessoa pode editar. **Sem logos de marca**: ícone neutro e cor do design system, para não usar marca de terceiros | Médio, só front |
| 3 | **Termos de Uso e Política de Privacidade** com aceite | Não achei no app. Vale ter antes de abrir para outras famílias (planos pagos) e por causa da LGPD: o app guarda dados financeiros. Pede texto revisado por quem entende de LGPD, não só código | Médio (texto + tela + registro do aceite) |

**Mais prints (Início, Patrimônio e Registrar transação)** — ideias novas, em ordem de valor:

| # | Ideia | Situação no Tudo Azul | Esforço |
|---|---|---|---|
| 4 | **Atribuir o lançamento a um membro** ("quem gastou") e ver os gastos de cada pessoa | O lançamento guarda quem **registrou** (`created_by`), não quem **gastou**; as duas coisas são diferentes. Para uma família é a ideia de mais valor desta rodada. Precisa de coluna nova, migration, e o relatório por pessoa tem de vir do banco (o front não soma). Decidir antes: lançamento antigo fica "sem membro"? qualquer membro pode atribuir a outro? | Alto (banco + telas) |
| 5 | **Botão "+" flutuante** sempre visível, abre o lançamento | Hoje as ações rápidas só existem no Início; nas outras telas é preciso voltar. Junta com o formulário novo (ideias 2 e 3 do Livro de contas) | Baixo, só front |
| 6 | **Formulário de lançamento enxuto**: abas Gasto/Ganho/Transferência no topo, nome primeiro, **valor grande**, data com "Hoje", conta já preenchida, um botão com o nome da ação ("Registrar ganho") | Já temos o tipo e todos os campos, mas num formulário comum. Entra no mesmo PR da grade de categorias e da conta principal | Médio, só front |
| 7 | **Aviso de confirmação** depois de registrar ("Ganho registrado") | O Lançamentos só avisa quando dá erro; quem registra não vê confirmação além da linha na lista | Baixo |
| 8 | **Composição do patrimônio** (rosca "Meus ativos" por instituição, com % e opção de barras) e **Ativos × Passivos** | Temos o patrimônio total e as contas com saldo do banco. A rosca pede o percentual de cada conta vindo do banco (como já é em despesas por categoria) | Médio |
| 9 | **Etiquetas (tags)** além da categoria (ex.: "Viagem Floripa") | Não existem. Cuidado: duplica o papel da categoria e da subcategoria; só vale se o dono sentir falta de um recorte que a categoria não dá | Médio (tabela + migration); baixa prioridade |
| 10 | **Personalizar página inicial** (escolher e ordenar os cartões) | O Início é fixo. Pode ser por aparelho (sem banco). Baixa prioridade | Médio |

**Observação sobre o Início do Minhas Economias:** é uma rolagem longa com um cartão para cada coisa, vários ainda vazios ("Objetivos", "Membros", "Cartões"). O Início do Tudo Azul é mais enxuto e orientado a ação ("o que pede atenção agora": vencidos, cartões, últimos lançamentos). Não vale copiar a quantidade de cartões; vale copiar o botão "+" e a composição do patrimônio.
**Tema escuro:** reaparece no topo do app deles (ícone de lua); confirma a ideia 5 do Livro de contas.
**Objetivos** e **Ver meus investimentos:** já estão nas ideias guardadas (metas com prazo junto com investimentos, previsto para fev–abr/2027).

**Já temos:** tipos de conta (corrente, poupança, carteira…), saldo inicial com data, conferência com o extrato.
**Fora de escopo:** o app mostra contas conectadas por Open Finance ("conta manual" × conectada); o Tudo Azul é 100% manual por decisão do projeto.

## Planos pagos (futuro)
Famílias com 1, 3 ou 5–10 pessoas já cabem na trava atual. Falta decidir o que acontece ao reduzir o plano com mais gente que o limite.
