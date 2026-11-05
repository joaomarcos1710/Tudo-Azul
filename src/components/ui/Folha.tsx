import { useEffect, useId, useRef } from 'react'
import type { KeyboardEvent as KeyboardEventReact, ReactNode } from 'react'

const FOCAVEIS = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

/**
 * Folha de opções por cima da tela: no celular e no iPad em retrato sobe de baixo (bottom sheet); no computador
 * (lg) fica no centro. Fecha no ×, no Esc e clicando fora; o Tab não sai dela; ao abrir, o foco vai para o primeiro
 * controle e, ao fechar, volta para quem a abriu. A página de trás não rola enquanto ela está aberta.
 */
export function Folha({ titulo, aoFechar, rodape, children }: {
  titulo: string
  aoFechar: () => void
  /** Botões fixos no pé (ex.: Cancelar · Aplicar). */
  rodape?: ReactNode
  children: ReactNode
}) {
  const painel = useRef<HTMLDivElement>(null)
  const corpo = useRef<HTMLDivElement>(null)
  const idTitulo = useId()
  const fechar = useRef(aoFechar)
  fechar.current = aoFechar

  useEffect(() => {
    const origem = document.activeElement as HTMLElement | null
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); fechar.current() } }
    document.addEventListener('keydown', esc)
    const antes = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // o primeiro controle do conteúdo (não o ×): quem abriu os filtros quer mexer neles
    ;(corpo.current?.querySelector<HTMLElement>(FOCAVEIS) ?? painel.current?.querySelector<HTMLElement>(FOCAVEIS))?.focus()
    return () => {
      document.removeEventListener('keydown', esc)
      document.body.style.overflow = antes
      origem?.focus?.()
    }
  }, [])

  function prenderTab(e: KeyboardEventReact<HTMLDivElement>) {
    if (e.key !== 'Tab') return
    const itens = Array.from(painel.current?.querySelectorAll<HTMLElement>(FOCAVEIS) ?? [])
    if (itens.length === 0) return
    const primeiro = itens[0], ultimo = itens[itens.length - 1]
    if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus() }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus() }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 lg:items-center lg:p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) aoFechar() }}>
      <div ref={painel} role="dialog" aria-modal="true" aria-labelledby={idTitulo} onKeyDown={prenderTab}
        className="flex max-h-[88vh] w-full max-w-lg flex-col rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] shadow-card lg:rounded-2xl lg:pb-0">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 id={idTitulo} className="text-base font-semibold text-marinho">{titulo}</h2>
          <button type="button" aria-label="Fechar" onClick={aoFechar}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-xl text-slate-500 hover:bg-azul-claro">
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <div ref={corpo} className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {rodape && <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">{rodape}</div>}
      </div>
    </div>
  )
}
