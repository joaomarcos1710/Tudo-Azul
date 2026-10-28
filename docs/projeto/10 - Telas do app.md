---
tags: [tudo-azul, telas]
---
# Telas do app

Menu em **grupos** (barra lateral no iPad/computador; no celular, 4 atalhos + "Mais"). Botão de **olho** oculta os valores (só apresentação).

## Visão geral
- **Início** (`/`) — o que fazer agora: ações rápidas (+ Despesa, + Receita, Transferência, Compra no cartão), **Vencidos**, **Cartões** (fatura, vencimento, limite disponível), últimos lançamentos, próximos planejados e contas com **conferência de saldo**.
- **Análises** (`/analises`) — como estou indo: patrimônio e resumo do mês (com variação contra o mês anterior), projeção do mês, comparação com o ano passado, renda regular × despesas e gráficos por categoria e por dia.
- Cada tela carrega só o que mostra. Em Análises, cada bloco é independente: se a consulta dele falhar, só ele some (com aviso), e o resto segue. No Início, contas, lançamentos e planejados são essenciais; vencidos, cartões e conferência são opcionais.
- **Relatórios e exportação** — CSV do mês e **exportação completa** (5 arquivos: lançamentos, movimentos por conta, cadastros, parcelas de cartão, eventos de cartão/dívidas).

## Movimentações
- **Lançamentos** — receitas, despesas e transferências do mês; filtros conta → tipo → categoria (categoria só do tipo escolhido); formulário único em **visual de app** (28/10/2026): uma linha de abas Despesa · Receita · Transferência · Cartão; descrição como título e **valor grande** com sinal e cor; campos em linhas (Data com "Hoje", Conta, Categoria; no cartão: Cartão e Parcelas) que abrem o seletor nativo do celular; Pago/Recebido · Planejado em pílulas; observações em "Mais detalhes"; botão com o nome da ação ("Registrar despesa"…) e **"Registrar e lançar outro"** (grava, avisa e deixa o formulário aberto e limpo, na mesma conta); o lançamento novo abre na **última conta e no último cartão usados** neste aparelho; marcar como pago pede data e valor reais; lixeira (desfazer a última exclusão).
- **Calendário** (`/calendario?mes=AAAA-MM`) — o mês em grade (semana começa na segunda); cada dia mostra marcas de entrada paga (verde), saída paga (vermelha) e planejado (âmbar); tocar no dia lista os lançamentos com valor e "Pago"/"Planejado" (inclui pagamento de fatura e de dívida saindo da conta). **Não soma por dia**: os totais do mês (receitas pagas, despesas pagas, resultado) vêm do banco. Compra no cartão aparece no fechamento da fatura, não no dia da compra. Ideia trazida do protótipo do Base44.
- **Recorrentes** — contas, salários e assinaturas no cartão que se repetem: semanal, quinzenal (14 dias), mensal, bimestral, trimestral, semestral, anual ou personalizada (a cada 1–4 semanas ou 1–12 meses). No cadastro: dia do mês (unidade mês) ou primeira data (unidade semana), data final opcional e prévia das próximas 3 datas. A lista mostra a frequência, a próxima data e a data final. Frequência e dia não mudam na edição (encerrar e cadastrar outro).
- **Cartões** — fatura a pagar em destaque (vermelha se houver, com "Pagar fatura" como ação principal; sem fatura, a principal é "Nova compra"), fatura por mês, parcelas, pagar fatura, reabrir fatura, excluir compra, editar parcela, anular pagamento/devolução, **limite**. Itens da fatura em formato de **extrato** (28/10/2026): agrupados pelo dia da compra (o mais recente primeiro; sem data no fim), nome inteiro com a parcela num selo ("1/10"), categoria e "a cobrar no fechamento" embaixo, Editar e Excluir (discreto) numa linha própria no celular.
- **Contas e conferência** — contas (cadastrar, editar, desativar), saldo vindo do banco, e **Conferir com o extrato** (trava o período conferido; dá para desfazer a última).

## Planejamento
- **Orçamentos** — limite por categoria, uso, ritmo; copiar do mês anterior.
- **Categorias** — despesas e receitas, subcategorias (1 nível), desativar, marcar receita como **eventual**.

## Conta
- **Família** — criar família, convidar por link (token guardado só como hash), aceitar convite, membros, **Zerar tudo** (só o dono).
- **Acesso** — entrar, criar conta, recuperar e trocar senha.

## Em todo o app
Visual segue o design system "Tudo Azul" (artefato no claude.ai): painéis brancos sobre o fundo claro, ações principais em azul, valores sempre com sinal. Em 28/10/2026: ações rápidas do Início viraram 4 painéis-botão iguais com ícone (2×2 até telas bem largas; no celular o ícone fica acima do rótulo para "Transferência" caber em 320px); a lista de Lançamentos ficou compacta (valor na linha da descrição, Excluir discreto) e os totais viram linhas no celular. Parte 2 (2026.4): toda tela abre com o mesmo cabeçalho (`CabecalhoPagina`: título, uma linha dizendo para que serve e as ações à direita no computador, embaixo no celular); Conferir tem o link "← Contas" acima do título. Parte 3 (PR 1): cada categoria tem **ícone e cor** — o app sugere pelo nome (Mercado → carrinho, Saúde → coração), a subcategoria herda da principal e a pessoa pode trocar em Categorias → Editar ("Auto" volta para a sugestão); o ícone aparece em cada linha de Lançamentos (compra no cartão com o da categoria; transferência: setas; pagamento de cartão/dívida: cartão, em grafite), nos itens da fatura em Cartões e nas listas do Início (vencidos, últimos lançamentos e próximos planejados). O valor continua nas cores de receita/despesa.

**Menu "Mais" do celular** (folha que sobe de baixo): 4 cartões de atalho no topo (Calendário, Recorrentes, Contas e conferência, Categorias, em 2 colunas) e, abaixo, as outras telas em grupos; toda linha e todo cartão trazem uma frase dizendo para que a tela serve (`descricao` em `navegacao.ts`). Cada tela aparece uma vez só. O menu lateral (iPad e computador) não mudou.

PWA instalável · versão `AAAA.E` · ocultar valores · valores sempre vindos do banco (o front não soma dinheiro).
