import { useSyncExternalStore } from 'react'

/**
 * "Ocultar valores": troca o dinheiro mostrado na tela por uma máscara (para abrir o app em público).
 * É só apresentação: nada muda nos dados, nas contas nem no que é gravado. A preferência fica neste aparelho.
 */
const CHAVE = 'tudo-azul:ocultar-valores'
export const MASCARA = 'R$ ••••'

function lerPreferencia(): boolean {
  try { return localStorage.getItem(CHAVE) === '1' } catch { return false }
}

let ocultos = lerPreferencia()
const ouvintes = new Set<() => void>()

export function valoresOcultos(): boolean {
  return ocultos
}

export function definirValoresOcultos(v: boolean): void {
  if (v === ocultos) return
  ocultos = v
  try { localStorage.setItem(CHAVE, v ? '1' : '0') } catch { /* sem armazenamento: vale só nesta sessão */ }
  ouvintes.forEach((f) => f())
}

function assinar(f: () => void): () => void {
  ouvintes.add(f)
  return () => { ouvintes.delete(f) }
}

/** Re-renderiza quem usa quando a preferência muda; o `App` usa para atualizar todas as telas. */
export function useValoresOcultos(): boolean {
  return useSyncExternalStore(assinar, valoresOcultos, () => false)
}
