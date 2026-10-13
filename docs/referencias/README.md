# Referências visuais (a visão do Tudo Azul)

Telas de exemplo geradas no Google Stitch, guardadas como **norte de design**, não como especificação.

> **Atenção:** os números nas imagens são fictícios e **incoerentes entre as telas** (ex.: comprometimento de renda de 19,4% numa e 18,2% em outra; passivo de R$ 74.380 numa e R$ 38.400 em outra). O app usa dados reais, calculados pelo banco. Nunca copie valores destas imagens para testes ou regras.

## Mapa: tela → etapa do plano (`docs/PLANO.md`)

| Referência | Etapa |
|---|---|
| `dashboard-desktop.png`, `dashboard-mobile.png` | 6 (dashboard); cartões e faturas na 9 |
| `dividas.png` | 10 (dívidas e empréstimos, simulador Avalanche / Bola de Neve) |
| `investimentos.png` | 11 (investimentos, alocação, proventos) |
| `patrimonio-investimentos-e-dividas.png` | 12 (patrimônio líquido) |
| `DESIGN.md` | Tokens de cor e tipografia (tema escuro por padrão, via variáveis CSS) |

## Decisões já tomadas sobre a referência
- **Tema:** escuro por padrão; variáveis de cor para permitir tema claro depois.
- **Despesa nunca só por cor:** manter sinal (−) ou ícone, por acessibilidade. O `DESIGN.md` sugere remover o sinal; não seguimos isso.
- **Open Finance e recomendação de ativos:** fora do escopo atual (dependem de serviço externo / são atividade regulada). Importação de OFX/CSV é o caminho.
- **Avatar/nome/"Premium":** itens da amostra, sem correspondência no produto.
- **Inconsistências do `DESIGN.md`:** o cabeçalho (`#041329`) e o texto (`#0A192F`) divergem; a unificação dos tokens é feita na implementação.
