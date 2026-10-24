/**
 * Paleta categórica dos gráficos (validada com o skill de dataviz: separação para daltonismo ≥ 8,
 * na ordem fixa abaixo). A cor segue a POSIÇÃO no ranking do mês; "Outros" é sempre cinza.
 * Três cores ficam abaixo de 3:1 no fundo branco: por isso todo gráfico mostra nome, valor e %
 * em texto ao lado (a cor nunca é a única informação).
 */
export const CORES_CATEGORIAS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'] as const
export const COR_OUTROS = '#64748b'
export const COR_LINHA = '#2a78d6'
