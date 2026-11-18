import { useSyncExternalStore } from 'react'

/**
 * Barra lateral recolhida (pedido do dono, 17/11/2026: "um botão para recolher e expandir a lateral, para a tela ficar cheia,
 * deixando no lado só os símbolos"). Só apresentação, no computador: no celular a barra não existe. A escolha fica neste aparelho
 * (como "Ocultar valores"); sem armazenamento, vale só nesta visita.
 */
const CHAVE = 'tudo-azul:barra-lateral-recolhida'

function lerPreferencia(): boolean {
  try { return localStorage.getItem(CHAVE) === '1' } catch { return false }
}

let recolhida = lerPreferencia()
const ouvintes = new Set<() => void>()

export function barraRecolhida(): boolean {
  return recolhida
}

export function definirBarraRecolhida(v: boolean): void {
  if (v === recolhida) return
  recolhida = v
  try { localStorage.setItem(CHAVE, v ? '1' : '0') } catch { /* sem armazenamento: vale só nesta visita */ }
  ouvintes.forEach((f) => f())
}

function assinar(f: () => void): () => void {
  ouvintes.add(f)
  return () => { ouvintes.delete(f) }
}

/** true = só os ícones. Muda em todos os componentes ao mesmo tempo. */
export function useBarraRecolhida(): boolean {
  return useSyncExternalStore(assinar, barraRecolhida, () => false)
}
