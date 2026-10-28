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
- **Lançamentos** — receitas, despesas e transferências do mês; filtros conta → tipo → categoria (categoria só do tipo escolhido); formulário único: conta **ou** cartão; marcar como pago pede data e valor reais; lixeira (desfazer a última exclusão).
- **Calendário** (`/calendario?mes=AAAA-MM`) — o mês em grade (semana começa na segunda); cada dia mostra marcas de entrada paga (verde), saída paga (vermelha) e planejado (âmbar); tocar no dia lista os lançamentos com valor e "Pago"/"Planejado" (inclui pagamento de fatura e de dívida saindo da conta). **Não soma por dia**: os totais do mês (receitas pagas, despesas pagas, resultado) vêm do banco. Compra no cartão aparece no fechamento da fatura, não no dia da compra. Ideia trazida do protótipo do Base44.
- **Recorrentes** — contas mensais e assinaturas no cartão.
- **Cartões** — fatura por mês, parcelas, pagar fatura, reabrir fatura, excluir compra, editar parcela, anular pagamento/devolução, **limite**.
- **Contas e conferência** — contas (cadastrar, editar, desativar), saldo vindo do banco, e **Conferir com o extrato** (trava o período conferido; dá para desfazer a última).

## Planejamento
- **Orçamentos** — limite por categoria, uso, ritmo; copiar do mês anterior.
- **Categorias** — despesas e receitas, subcategorias (1 nível), desativar, marcar receita como **eventual**.

## Conta
- **Família** — criar família, convidar por link (token guardado só como hash), aceitar convite, membros, **Zerar tudo** (só o dono).
- **Acesso** — entrar, criar conta, recuperar e trocar senha.

## Em todo o app
Visual segue o design system "Tudo Azul" (artefato no claude.ai): painéis brancos sobre o fundo claro, ações principais em azul, valores sempre com sinal. Em 28/10/2026: ações rápidas do Início viraram 4 painéis-botão iguais com ícone; a lista de Lançamentos ficou compacta (valor na linha da descrição, Excluir discreto) e os totais viram linhas no celular.

PWA instalável · versão `AAAA.E` · ocultar valores · valores sempre vindos do banco (o front não soma dinheiro).
