/**
 * Cores dos gráficos (validadas com o validador da skill de dataviz no fundo branco dos cards, em 05/11/2026:
 * faixa de luminosidade, croma, separação para daltonismo ΔE 24,7 e visão normal ΔE 33,6, contraste ≥ 3:1).
 * O app ainda não tem modo escuro; quando tiver, os passos escuros precisam ser escolhidos e validados à parte.
 * A cor nunca é a única informação: todo gráfico mostra o nome (legenda ou rótulo) e o valor em texto.
 */
/** Série única (linha, barras de categoria): azul. */
export const COR_LINHA = '#2a78d6'
/** Balanço mês a mês: receita (azul) × despesa (laranja), na ordem fixa da paleta categórica. */
export const COR_RECEITA = '#2a78d6'
export const COR_DESPESA = '#eb6834'
/**
 * Relatórios, Entradas x Saídas (#179, pedido do dono: "o verde do Organizze, no Tudo Azul azul; vermelho para negativo").
 * Entrada azul (a mesma COR_RECEITA) e saída vermelha (Tailwind red-600, 4,8:1 no branco, acima de 3:1 para barra).
 * Azul × vermelho separam bem também para daltonismo (protan/deutan confundem verde e vermelho, não azul e vermelho).
 * O laranja do Início (COR_DESPESA) continua lá até o dono decidir (pendência em "40 - Pendências").
 */
export const COR_SAIDA = '#dc2626'
/**
 * Saldo das contas como área clara ao fundo das barras (Relatórios, #179, como no Organizze): escala própria, sem eixo.
 * A área é contexto (contraste baixo de propósito, para não competir com as barras): o valor de cada saldo está no
 * toque/tooltip e na tabela logo abaixo (regra de alívio do validador), e a borda mostra a forma.
 */
export const COR_SALDO_AREA = '#dbeafe'
export const COR_SALDO_BORDA = '#93c5fd'
