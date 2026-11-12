import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent as KeyboardEventReact } from 'react'

/** Um item do menu "+ Lançamento": o que abre, o texto e a tecla de atalho (uma letra). */
export interface ItemNovo<T extends string> {
  chave: T
  rotulo: string
  tecla: string
}

/**
 * Menu "+ Lançamento" (pedido do dono, 10/11/2026, como no Organizze): botão com a lista do que se pode lançar e a tecla
 * de atalho de cada item. Fecha no Esc, no clique fora e no Tab; ao abrir, o foco vai ao primeiro item; setas, Home e End
 * andam entre eles. Ao escolher (ou fechar no Esc), o foco volta ao botão antes de `aoEscolher` rodar: quem abre uma folha
 * ou um painel o guarda como origem e devolve o foco a ele ao fechar.
 *
 * `forma`: `flutuante` é o "+" redondo de Lançamentos (o menu abre para cima); `primario` e `secundario` são o botão
 * "+ Lançamento" do cabeçalho das telas (Cartões; o menu abre para baixo).
 */
export function MenuNovo<T extends string>({ itens, aoEscolher, desabilitado = false, forma = 'flutuante' }: {
  itens: ItemNovo<T>[]
  aoEscolher: (chave: T) => void
  desabilitado?: boolean
  forma?: 'flutuante' | 'primario' | 'secundario'
}) {
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
    // abre com o foco no primeiro item
    ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc) }
  }, [aberto])

  function navegar(e: KeyboardEventReact<HTMLDivElement>) {
    const botoes = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])
    if (botoes.length === 0) return
    const atual = botoes.indexOf(document.activeElement as HTMLButtonElement)
    const destino = e.key === 'ArrowDown' ? (atual + 1) % botoes.length
      : e.key === 'ArrowUp' ? (atual - 1 + botoes.length) % botoes.length
      : e.key === 'Home' ? 0
      : e.key === 'End' ? botoes.length - 1
      : null
    if (destino !== null) { e.preventDefault(); botoes[destino].focus() }
    if (e.key === 'Tab') setAberto(false)
  }

  const flutuante = forma === 'flutuante'
  const estiloBotao = flutuante
    ? 'h-14 w-14 rounded-full bg-azul text-3xl font-light leading-none text-white shadow-card hover:bg-marinho'
    : `min-h-11 gap-1.5 rounded-lg px-3 text-sm font-semibold transition-colors ${forma === 'primario'
      ? 'bg-azul text-white hover:bg-blue-700'
      : 'border border-slate-300 bg-white text-marinho hover:bg-azul-claro'}`
  return (
    <div className="relative" ref={ref}>
      <button ref={botao} type="button" onClick={() => setAberto((v) => !v)} disabled={desabilitado} aria-haspopup="menu" aria-expanded={aberto}
        aria-controls={aberto ? idMenu : undefined} aria-label="Novo lançamento" title={`Novo lançamento (teclas ${itens.map((i) => i.tecla).join(', ')})`}
        className={`flex items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-azul disabled:cursor-not-allowed disabled:opacity-50 ${estiloBotao}`}>
        <span aria-hidden="true">+</span>
        {!flutuante && <span aria-hidden="true">Lançamento</span>}
      </button>
      {aberto && (
        <div id={idMenu} role="menu" aria-label="Novo lançamento" onKeyDown={navegar}
          className={`absolute right-0 z-40 w-64 max-w-[calc(100vw-2rem)] rounded-xl bg-marinho p-2 shadow-card ${flutuante ? 'bottom-full mb-2' : 'top-full mt-2'}`}>
          {itens.map((i) => (
            <button key={i.chave} type="button" role="menuitem"
              onClick={() => { setAberto(false); botao.current?.focus(); aoEscolher(i.chave) }}
              className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 text-left text-sm font-semibold text-white hover:bg-white/10 focus-visible:bg-white/10">
              {i.rotulo}
              {/* atalho de teclado físico: escondido no celular e em telas de toque */}
              <span className="hidden rounded-full border border-white/30 px-2 text-xs font-normal text-blue-100 sm:inline [@media(pointer:coarse)]:hidden" aria-label={`atalho: tecla ${i.tecla}`}>tecla {i.tecla}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Atalhos de teclado do menu (D, R…): com `ativo`, a tecla de um item o escolhe, fora de campos de texto e sem Ctrl, Meta
 * ou Alt. Quem usa passa `ativo = false` enquanto há folha, painel ou tela de filtros aberta por cima.
 */
export function useAtalhosNovo<T extends string>(itens: ItemNovo<T>[], ativo: boolean, aoEscolher: (chave: T) => void) {
  const escolher = useRef(aoEscolher)
  escolher.current = aoEscolher
  const lista = useRef(itens)
  lista.current = itens
  useEffect(() => {
    if (!ativo) return
    function tecla(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return
      const alvo = e.target as HTMLElement | null
      if (alvo && (alvo.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(alvo.tagName))) return
      const item = lista.current.find((i) => i.tecla.toLowerCase() === e.key.toLowerCase())
      if (!item) return
      e.preventDefault()
      escolher.current(item.chave)
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [ativo])
}
