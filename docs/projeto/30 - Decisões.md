---
tags: [tudo-azul, decisoes]
---
# Decisões tomadas (e por quê)

| Decisão | Motivo |
|---|---|
| Dinheiro em centavos; front não soma relatório | Evitar erro de arredondamento e divergência entre telas |
| Migration aplicada nunca é editada | Histórico confiável; mudança vira migration nova |
| Banco em produção só por workflow manual (simular → aplicar) | Ninguém mexe no banco real por acidente |
| Merge só com "pode" e trava de commit | Controle do dono; evita merge de código diferente do testado |
| Tailwind 4 em PR separado, com revisão visual | Mudança grande de estilo; não misturar com correção |
| Compra no cartão conta na **data de fechamento**; pagar fatura não é despesa | Evita dupla contagem; bate com a fatura |
| Conta nunca é apagada, só desativada | Preservar histórico e conferência |
| Versão `AAAA.E` | Saber qual edição está rodando; recomeça a cada ano |
| Limite de membros por família (1–10, padrão 2) | Base para planos pagos: 1, 3 e 5–10 já cabem |
| Ocultar valores é só máscara na tela; campos usam função própria | Não correr risco de gravar valor errado |
| Sem Open Finance / IA / app nativo / IR | Foco nos 3 critérios do corte |
| Alerta de vencimento: card "Vencidos" no app; push só se necessário | Custo alto (iPhone exige app instalado e servidor de envio) |
| Importar do Organizze só com CSV de exemplo inventado | Nunca expor dados reais |
| Inspiração de outros apps: só estrutura de ideias | Não copiar marca, texto, tela ou código |
| Documentação do projeto vive no repositório (`docs/projeto/`), atualizada a cada PR; Obsidian é opcional | A máquina de trabalho é temporária; o repositório é o que persiste e tem histórico |
| Períodos financeiros: mês-calendário continua o padrão; ciclo com dia de início 1–31 (ajusta ao último dia do mês curto), nomeado pelo mês em que começa | Quem recebe fora do dia 1 enxerga o mês dele; sem configuração nada muda |
| Período personalizado: no máximo 366 dias contando os dois extremos; datas de 2000 a 2100 | Cabe nos gráficos do banco (`daily_expenses` aceita até 367 inclusivos) sem resultado vazio silencioso |
| Orçamento e projeção continuam mensais; saldo não depende de período; cartão segue as próprias regras | Não misturar intervalos nem mudar regra financeira para totais "parecerem" iguais |
| Ciclo é preferência da família (só o dono altera); sem preferência individual nesta fase | Casais com datas de recebimento diferentes ficam como limitação conhecida |
