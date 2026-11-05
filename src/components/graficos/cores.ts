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
 * Saldo das contas no fim de cada período (Relatórios): aqua, 3º passo da paleta categórica, num gráfico à parte
 * (nunca no mesmo eixo das barras). Validado junto com receita e despesa em "todos os pares" (ΔE daltonismo 9,2;
 * visão normal 24,0). Contraste 2,82:1 no branco (abaixo de 3:1): por isso o último valor vai escrito na ponta da
 * linha e a tabela com todos os saldos fica logo abaixo (regra de alívio do validador).
 */
export const COR_SALDO = '#1baf7a'
