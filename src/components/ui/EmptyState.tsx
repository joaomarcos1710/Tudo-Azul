import type { ReactNode } from 'react'

interface Props {
  titulo: string
  descricao: string
  acao?: ReactNode
}

export function EmptyState({ titulo, descricao, acao }: Props) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-card border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      <h2 className="text-lg font-semibold">{titulo}</h2>
      <p className="max-w-md text-sm text-slate-600">{descricao}</p>
      {acao && <div className="mt-3">{acao}</div>}
    </div>
  )
}
