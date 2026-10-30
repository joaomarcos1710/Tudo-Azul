# Benchmark de gestão financeira

Pesquisa documental realizada em 30/10/2026 sobre funcionalidades públicas de Minhas Economias, Organizze e Mobills. O objetivo é identificar padrões úteis ao Tudo Azul, não reproduzir código, identidade visual ou funcionalidades proprietárias.

## Minhas Economias

**Pontos observados**
- Contas manuais e conexão bancária via Open Finance.
- Orçamentos mensais por categoria, com alertas de aproximação e acompanhamento mensal/anual.
- Categorias e subcategorias personalizáveis.
- Objetivos com valor-alvo, valor acumulado, prazo, lembretes e histórico de depósitos/resgates.
- Tags para agrupar transações de categorias diferentes.
- Membros para atribuir ganhos e gastos a pessoas e comparar a participação de cada uma.
- Extrato com filtros por período, tipo, situação, conta, cartão, categoria, membro e tag.

**O que vale estudar para o Tudo Azul**
- Metas financeiras com progresso, prazo e contribuições vinculadas a movimentos reais.
- Tags como dimensão transversal às categorias, especialmente para projetos ou viagens.
- Atribuição opcional de transações a membros da família, sem dividir artificialmente as contas compartilhadas.

## Organizze

**Pontos observados**
- A tela inicial é organizada em widgets/cards que podem ser movidos e minimizados.
- A visão geral documenta blocos de saldo geral, contas, cartões, limites, contas a pagar/receber, maiores gastos, receitas/despesas e acesso rápido.
- Controle de múltiplas contas e cartões, relatórios, planejamento de curto prazo, limites por categoria e alertas.
- A central de ajuda documenta arquivamento/reativação de cartões e contas, filtros e exportação de faturas.
- O site também apresenta categorização assistida por IA e conexão bancária.

**O que vale estudar para o Tudo Azul**
- Personalização do Início, que fundamenta a entrega inicial dos widgets.
- Mostrar informações acionáveis sem obrigar a pessoa a abrir várias telas.
- Manter cartões, contas e compromissos futuros como blocos operacionais, separados dos indicadores de desempenho mensal.

## Mobills

**Pontos observados**
- Dashboard personalizado, relatórios dinâmicos, orçamento e acompanhamento do fluxo financeiro.
- A documentação distingue saldo atual, saldo previsto e saldo diário.
- O saldo previsto considera receitas e despesas pendentes; a projeção pode ser consultada para datas futuras.
- Há gestão de contas e cartões, parcelas, planejamento e objetivos.

**O que vale estudar para o Tudo Azul**
- Deixar explícita a diferença entre saldo realizado e saldo projetado.
- Permitir consultar o saldo por conta em uma data futura, com as movimentações planejadas e faturas consideradas.
- Explicar a composição da projeção para que o usuário consiga rastrear divergências.

**Diferença de regra importante:** o Mobills documenta que contas arquivadas deixam de compor determinados saldos. O Tudo Azul mantém contas inativas no patrimônio e no histórico; active=false impede apenas novas movimentações. Não copiar essa regra do concorrente.

## Decisões para o Tudo Azul

1. **Dashboard modular:** começar com patrimônio líquido, saldo disponível, entradas, despesas e resultado; permitir adicionar, remover, reordenar e restaurar.
2. **Cálculos financeiros no banco:** widgets apenas apresentam valores retornados pelas consultas oficiais. O front não deve somar dinheiro de relatórios.
3. **Projeção transparente:** distinguir saldo atual, saldo planejado e saldo por data. Fatura de cartão deve ser considerada no vencimento e na conta pagadora, conforme a regra do produto.
4. **Família primeiro:** manter o household compartilhado e avaliar no futuro atribuição opcional por membro, sem transformar contas conjuntas em contas individuais.
5. **Classificação assistida:** regras podem sugerir categorias, mas a pessoa confirma; não reclassificar histórico silenciosamente.
6. **Sem Open Finance por enquanto:** a decisão atual do projeto é manter lançamentos manuais e avaliar importação de arquivos/API em etapa posterior. A presença do recurso nos concorrentes não altera essa decisão.
7. **Metas e tags depois do núcleo:** são boas referências, mas devem entrar com modelo de dados, regras financeiras e testes próprios.

## Fontes públicas

### Minhas Economias
- [O que é o Minhas Economias?](https://faq.minhaseconomias.com.br/hc/pt-br/articles/35593611981595-O-que-%C3%A9-o-Minhas-Economias)
- [Orçamentos](https://faq.minhaseconomias.com.br/hc/pt-br/articles/35610172368667-O-que-%C3%A9-a-ferramenta-de-or%C3%A7amentos)
- [Objetivos](https://faq.minhaseconomias.com.br/hc/pt-br/articles/35615605707163-O-que-%C3%A9-a-ferramenta-de-Objetivos)
- [Membros](https://faq.minhaseconomias.com.br/hc/pt-br/articles/35610319457947-O-que-%C3%A9-a-funcionalidade-Membros)
- [Tags](https://faq.minhaseconomias.com.br/hc/pt-br/articles/35610801539355-O-que-s%C3%A3o-e-como-funcionam-as-tags-no-Minhas-Economias)
- [Filtros do extrato](https://faq.minhaseconomias.com.br/hc/pt-br/articles/35612043640475-Como-aplicar-filtros-no-extrato)

### Organizze
- [Organizando os cards da tela inicial](https://ajuda.organizze.com.br/hc/pt-br/articles/6106910677523-Web-Organizando-os-cards-da-tela-inicial)
- [Visão geral e seus cards](https://ajuda.organizze.com.br/hc/pt-br/sections/6106034604947-Vis%C3%A3o-geral)
- [O que é o Organizze?](https://ajuda.organizze.com.br/hc/pt-br/articles/6105543338771-O-que-%C3%A9-o-Organizze)
- [Site oficial e recursos](https://www.organizze.com.br/)

### Mobills
- [Saldo atual, previsto e diário](https://mobills.zendesk.com/hc/pt-br/articles/360050436554-Como-s%C3%A3o-calculados-os-saldos-no-Mobills-Saldo-atual-Previsto-e-Di%C3%A1rio)
- [Projeção de saldo futura](https://mobills.zendesk.com/hc/pt-br/articles/360051158034-Como-ter-uma-proje%C3%A7%C3%A3o-de-saldo-futura)
- [Funcionalidades na Google Play](https://play.google.com/store/apps/details?id=br.com.gerenciadorfinanceiro.controller)
- [Guia de utilização](https://www.mobills.com.br/blog/mobills/como-utilizar-o-mobills/)

## Limitações da pesquisa

A análise usa páginas públicas e documentação oficial. Não houve acesso às áreas autenticadas, inspeção de tráfego privado, extração de dados de usuários nem engenharia reversa de código proprietário. Os fluxos internos e as diferenças entre planos devem ser confirmados com testes autorizados antes de qualquer implementação.
