import { useEffect, useRef } from 'react'
import type { KeyboardEvent as KeyboardEventReact, RefObject } from 'react'

export const FOCAVEIS = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

// diálogos abertos, do mais antigo ao mais novo: o Esc fecha só o de cima (a Folha aberta por cima do painel de
// Lançamentos), seja qual for a ordem em que os ouvintes do document foram registrados
const abertos: object[] = []

/**
 * Comportamento de diálogo modal (Folha e o painel de Lançamentos): ao abrir, o foco vai para o primeiro controle de
 * `inicio()` (ou do painel); o Esc fecha só o diálogo de cima; a página de trás não rola; ao fechar, o foco volta para
 * quem abriu. Devolve o `onKeyDown` do painel, que prende o Tab dentro dele.
 */
export function useFocoPreso(painel: RefObject<HTMLElement | null>, aoFechar: () => void, inicio?: () => HTMLElement | null | undefined) {
  const fechar = useRef(aoFechar)
  fechar.current = aoFechar
  const comeco = useRef(inicio)
  comeco.current = inicio

  useEffect(() => {
    const eu = {}
    abertos.push(eu)
    const origem = document.activeElement as HTMLElement | null
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || abertos[abertos.length - 1] !== eu) return
      e.stopPropagation()
      fechar.current()
    }
    document.addEventListener('keydown', esc)
    const antes = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    ;(comeco.current?.()?.querySelector<HTMLElement>(FOCAVEIS) ?? painel.current?.querySelector<HTMLElement>(FOCAVEIS))?.focus()
    return () => {
      abertos.splice(abertos.indexOf(eu), 1)
      document.removeEventListener('keydown', esc)
      document.body.style.overflow = antes
      origem?.focus?.()
    }
  }, [painel])

  return function prenderTab(e: KeyboardEventReact<HTMLElement>) {
    if (e.key !== 'Tab') return
    const itens = Array.from(painel.current?.querySelectorAll<HTMLElement>(FOCAVEIS) ?? [])
    if (itens.length === 0) return
    const primeiro = itens[0], ultimo = itens[itens.length - 1]
    if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus() }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus() }
  }
}
