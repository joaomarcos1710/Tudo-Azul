/**
 * Base dos gastos de cartão nos relatórios POR CATEGORIA (migration 062, decisão de 05/11/2026).
 * Só muda o relatório por categoria: totais do mês, orçamento, saldo e projeções seguem sempre a data da fatura.
 * A escolha fica neste aparelho (localStorage); se o armazenamento falhar, vale o padrão (fatura).
 */
export type BaseGastosCartao = 'invoice' | 'purchase' | 'installment'

export const BASES_GASTOS_CARTAO: { chave: BaseGastosCartao; rotulo: string; explicacao: string }[] = [
  { chave: 'invoice', rotulo: 'Data da fatura', explicacao: 'Cada parcela conta no mês em que a fatura do cartão fecha.' },
  { chave: 'purchase', rotulo: 'Data da compra', explicacao: 'A compra conta inteira (todas as parcelas, já sem estornos) no mês em que foi feita, mesmo com a fatura ainda aberta.' },
  { chave: 'installment', rotulo: 'Data da parcela', explicacao: 'Cada parcela conta no mês dela: a 1ª no mês da compra, a 2ª no mês seguinte, e assim por diante, sem olhar o fechamento.' },
]

const CHAVE = 'tudoazul:base-gastos-cartao'

export function ehBaseGastosCartao(v: unknown): v is BaseGastosCartao {
  return v === 'invoice' || v === 'purchase' || v === 'installment'
}

export function lerBaseGastosCartao(): BaseGastosCartao {
  try {
    const v = window.localStorage.getItem(CHAVE)
    return ehBaseGastosCartao(v) ? v : 'invoice'
  } catch {
    return 'invoice'
  }
}

export function guardarBaseGastosCartao(base: BaseGastosCartao): void {
  try {
    window.localStorage.setItem(CHAVE, base)
  } catch {
    // sem armazenamento: a escolha vale só enquanto a tela estiver aberta
  }
}
