import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

interface Props {
  titulo: ReactNode
  /** Uma linha dizendo para que a tela serve (design system: texto-secundário). */
  descricao?: ReactNode
  /** Link de volta acima do título, quando a tela foi aberta a partir de outra. */
  voltar?: { para: string; rotulo: string }
  /** Ações da tela: à direita do título no computador, embaixo dele no celular. */
  acoes?: ReactNode
}

/** Topo padrão de toda tela: título, descrição curta e ações principais. */
export function CabecalhoPagina({ titulo, descricao, voltar, acoes }: Props) {
  return (
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        {voltar && (
          <Link to={voltar.para} className="mb-1 inline-block text-sm font-semibold text-azul hover:underline">← {voltar.rotulo}</Link>
        )}
        <h1 className="text-2xl font-bold tracking-tight">{titulo}</h1>
        {descricao && <p className="mt-1 max-w-3xl text-sm text-slate-600">{descricao}</p>}
      </div>
      {acoes && <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">{acoes}</div>}
    </header>
  )
}
