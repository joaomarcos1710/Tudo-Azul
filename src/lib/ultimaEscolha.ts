/**
 * Lembra, neste aparelho, a última conta e o último cartão usados num lançamento novo ("conta principal").
 * Só conveniência: guardado no navegador, por família. Se o armazenamento falhar (aba privada, bloqueio), vale o padrão.
 */
type Escolha = 'conta' | 'cartao'

const chave = (familiaId: string, tipo: Escolha) => `tudoazul:ultima-${tipo}:${familiaId}`

export function ultimaEscolha(familiaId: string, tipo: Escolha): string | null {
  try {
    return window.localStorage.getItem(chave(familiaId, tipo))
  } catch {
    return null
  }
}

export function lembrarEscolha(familiaId: string, tipo: Escolha, id: string): void {
  try {
    if (id) window.localStorage.setItem(chave(familiaId, tipo), id)
  } catch {
    // sem armazenamento: o formulário abre na primeira conta, como antes
  }
}
