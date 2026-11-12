import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent as KeyboardEventReact } from 'react'

export interface AcaoMenu {
  rotulo: string
  aoEscolher: () => void
  desabilitado?: boolean
  /** Por que a ação está desabilitada (texto curto, visível sob o rótulo e lido pelo leitor de tela). */
  motivo?: string
  /** Ação destrutiva (Excluir): vai separada por um traço, em vermelho. Ponha por último. */
  perigo?: boolean
}

/**
 * Botão "⋯" com as ações secundárias de um item (mesmo comportamento do menu "+ Lançamento"): fecha no Esc, no clique fora
 * e no Tab; setas, Home e End andam entre as ações; ao fechar pelo teclado o foco volta para o botão. Ao escolher uma ação,
 * o foco também volta para o botão antes dela rodar: quem abre um painel guarda o botão como origem e devolve o foco a ele.
 */
export function MenuAcoes({ rotulo, acoes, desabilitado = false }: { rotulo: string; acoes: AcaoMenu[]; desabilitado?: boolean }) {
  const [aberto, setAberto] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const botao = useRef<HTMLButtonElement>(null)
  const idMenu = useId()

  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setAberto(false); botao.current?.focus() } }
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', esc)
    // abre com o foco na primeira ação disponível
    ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')?.focus()
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc) }
  }, [aberto])

  function navegar(e: KeyboardEventReact<HTMLDivElement>) {
    const itens = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? [])
    if (itens.length === 0) return
    const atual = itens.indexOf(document.activeElement as HTMLButtonElement)
    const destino = e.key === 'ArrowDown' ? (atual + 1) % itens.length
      : e.key === 'ArrowUp' ? (atual - 1 + itens.length) % itens.length
      : e.key === 'Home' ? 0
      : e.key === 'End' ? itens.length - 1
      : null
    if (destino !== null) { e.preventDefault(); itens[destino].focus() }
    if (e.key === 'Tab') setAberto(false)
  }

  return (
    <div className="relative" ref={ref}>
      <button ref={botao} type="button" aria-label={rotulo} title={rotulo} aria-haspopup="menu" aria-expanded={aberto}
        aria-controls={aberto ? idMenu : undefined} disabled={desabilitado} onClick={() => setAberto((v) => !v)}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-3 text-xl font-bold leading-none text-azul transition-colors hover:bg-azul-claro disabled:cursor-not-allowed disabled:opacity-50">
        <span aria-hidden="true">⋯</span>
      </button>
      {aberto && (
        <div id={idMenu} role="menu" aria-label={rotulo} onKeyDown={navegar}
          className="absolute right-0 z-40 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-card">
          {acoes.map((a, k) => (
            <div key={a.rotulo} role="none">
              {a.perigo && <div role="separator" className="my-1 border-t border-slate-200" />}
              <button type="button" role="menuitem" disabled={a.desabilitado} aria-label={a.rotulo} aria-describedby={a.motivo ? `${idMenu}-motivo-${k}` : undefined}
                onClick={() => { setAberto(false); botao.current?.focus(); a.aoEscolher() }}
                className={`group flex min-h-11 w-full flex-col justify-center rounded-lg px-3 py-1 text-left text-sm font-semibold disabled:cursor-not-allowed ${
                  a.perigo ? 'text-negativo hover:bg-negativo-fundo' : 'text-marinho hover:bg-azul-claro'}`}>
                <span className="group-disabled:opacity-50">{a.rotulo}</span>
                {a.motivo && <span id={`${idMenu}-motivo-${k}`} className="text-xs font-normal text-slate-600">{a.motivo}</span>}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
