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
    // flex-wrap em vez de "sm:flex-row": com a barra lateral (a partir de md) o conteúdo fica estreito (~500px num iPad em pé) mesmo com a
    // janela larga, e o título era espremido por botões que não encolhem. Agora as ações descem para a linha de baixo quando faltar espaço.
    <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-[14rem] flex-1">
        <h1 className="text-2xl font-bold tracking-tight">{titulo}</h1>
        {descricao && <p className="mt-1 max-w-3xl text-sm text-slate-600">{descricao}</p>}
      </div>
      {acoes && <div className="flex max-w-full flex-wrap items-center gap-2 sm:justify-end">{acoes}</div>}
    </header>
  )
}
