import { useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { useFocoPreso } from './useFocoPreso'

/**
 * Tela de filtros (pedido do dono, 10/11/2026, como no Organizze): X à esquerda, ação principal à direita, grupos com
 * chips e cartões embaixo. No celular e no iPad em retrato ocupa a tela inteira; no computador (lg) é um painel no
 * centro, do tamanho do conteúdo (pedido do dono no mesmo dia: em Relatórios, dois grupos de filtro numa tela inteira de
 * monitor ficavam "enormes"), no mesmo desenho da Folha. Esc, o X e o clique fora (só no computador há "fora") fecham;
 * o Tab não sai dela; ao fechar, o foco volta para quem abriu.
 * A ação principal fica a cargo de quem usa: ou só fecha (filtro vale na hora) ou aplica um rascunho.
 */
export function TelaFiltros({ titulo, aoFechar, acaoPrincipal, rodape, children }: {
  titulo: string
  aoFechar: () => void
  acaoPrincipal: { rotulo: string; nomeAcessivel?: string; aoAcionar: () => void }
  /** Pé fixo (ex.: Limpar filtros), opcional. */
  rodape?: ReactNode
  children: ReactNode
}) {
  const painel = useRef<HTMLDivElement>(null)
  const corpo = useRef<HTMLDivElement>(null)
  const idTitulo = useId()
  // o primeiro controle do conteúdo (não o X): quem abriu os filtros quer mexer neles
  const prenderTab = useFocoPreso(painel, aoFechar, () => corpo.current?.querySelector<HTMLElement>('button, input, select'))

  return (
    <div className="fixed inset-0 z-50 flex bg-white lg:items-center lg:justify-center lg:bg-slate-900/50 lg:p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) aoFechar() }}>
      <div ref={painel} role="dialog" aria-modal="true" aria-labelledby={idTitulo} onKeyDown={prenderTab}
        className="flex h-full w-full flex-col bg-white lg:h-auto lg:max-h-[88vh] lg:max-w-lg lg:rounded-2xl lg:shadow-card">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <button type="button" aria-label="Fechar filtros" onClick={aoFechar}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-2xl text-marinho hover:bg-azul-claro">
            <span aria-hidden="true">×</span>
          </button>
          {/* no celular o título é só para leitor de tela (a tela inteira já diz o que é); no painel do computador aparece */}
          <h2 id={idTitulo} className="sr-only lg:not-sr-only lg:flex-1 lg:text-base lg:font-semibold lg:text-marinho">{titulo}</h2>
          <button type="button" onClick={acaoPrincipal.aoAcionar} aria-label={acaoPrincipal.nomeAcessivel}
            className="min-h-11 rounded-lg bg-azul-claro px-5 text-base font-semibold text-azul hover:ring-1 hover:ring-azul">
            {acaoPrincipal.rotulo}
          </button>
        </div>

        <div ref={corpo} className="flex-1 overflow-y-auto px-4 pb-8">{children}</div>

        {rodape && <div className="border-t border-slate-100 px-4 py-3">{rodape}</div>}
      </div>
    </div>
  )
}

export function GrupoFiltro({ titulo, children }: { titulo: string; children: ReactNode }) {
  const id = useId()
  return (
    <section role="group" aria-labelledby={id} className="mt-6">
      <h3 id={id} className="mb-3 text-base font-semibold text-marinho">{titulo}</h3>
      {children}
    </section>
  )
}

export function Chips({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>
}

export function Chip({ pressionado, onClick, children }: { pressionado: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={pressionado} onClick={onClick}
      className={`min-h-11 rounded-full border px-4 text-sm font-semibold transition-colors ${pressionado
        ? 'border-azul bg-azul text-white'
        : 'border-slate-300 bg-white text-marinho hover:border-azul'}`}>
      {children}
    </button>
  )
}

/** Uma fila de cartões que rola de lado (contas, cartões de crédito). */
export function CartoesFiltro({ children }: { children: ReactNode }) {
  return <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1">{children}</div>
}

export function CartaoFiltro({ pressionado, nome, onClick }: { pressionado: boolean; nome: string; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={pressionado} onClick={onClick}
      className={`flex min-h-14 min-w-44 shrink-0 snap-start items-center rounded-xl border px-4 text-left text-base font-semibold text-marinho transition-colors ${pressionado
        ? 'border-azul bg-azul-claro ring-2 ring-azul'
        : 'border-slate-200 bg-white hover:border-azul'}`}>
      {nome}
    </button>
  )
}
