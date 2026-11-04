import type { ReactNode } from 'react'

interface Props {
  titulo: ReactNode
  /** Uma linha dizendo para que a tela serve (design system: texto-secundário). */
  descricao?: ReactNode
  /** Ações da tela: à direita do título no computador, embaixo dele no celular. */
  acoes?: ReactNode
}

/** Topo padrão de toda tela: título, descrição curta e ações principais. */
export function CabecalhoPagina({ titulo, descricao, acoes }: Props) {
  return (
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">{titulo}</h1>
        {descricao && <p className="mt-1 max-w-3xl text-sm text-slate-600">{descricao}</p>}
      </div>
      {acoes && <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">{acoes}</div>}
    </header>
  )
}
