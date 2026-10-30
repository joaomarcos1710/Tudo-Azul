# Dashboard personalizável

## Objetivo
A tela Início deve abrir com uma visão financeira clara e adaptável, sem alterar cálculos, lançamentos ou dados da família.

## Primeira entrega
- Widgets: patrimônio líquido, saldo disponível, entradas do mês, despesas do mês e resultado do mês.
- Cada usuário pode adicionar, remover, reordenar e restaurar os widgets.
- A ordem e a seleção ficam salvas neste navegador, separadas por usuário autenticado.
- Os indicadores reutilizam `net_worth` e `period_summary`; os valores continuam calculados no banco.
- Se uma consulta falhar, os demais blocos do Início continuam disponíveis.
- Preferências inválidas são normalizadas: IDs desconhecidos são ignorados e duplicados são removidos.

## Limites conhecidos
- As preferências ainda não sincronizam entre dispositivos.
- Cartões, vencidos, próximos planejados, contas e últimos lançamentos continuam em seções próprias.
- O patrimônio exibido considera contas e dívidas; não inclui bens físicos nem investimentos.

## Próximas melhorias possíveis
- Avaliar widgets para faturas que vencem no mês, saldo projetado e compromissos futuros.
- Só incluir widgets novos quando houver fonte financeira no banco com testes e sem duplicar valores.
- Avaliar sincronização das preferências no Supabase, com RLS e testes de isolamento, antes de substituir o armazenamento local.
