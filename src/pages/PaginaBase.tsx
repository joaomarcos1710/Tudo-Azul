import type { ReactNode } from 'react'
import { EmptyState } from '../components/ui/EmptyState'

interface Props {
  titulo: string
  etapa: string
  descricao: string
  children?: ReactNode
}

/** Casca das páginas ainda não implementadas: diz com clareza o que vem e em qual etapa. */
export function PaginaBase({ titulo, etapa, descricao, children }: Props) {
  return (
    <>
      <h1 className="mb-6 text-2xl font-bold">{titulo}</h1>
      {children ?? (
        <EmptyState titulo="Disponível em breve" descricao={`${descricao} Planejado para a ${etapa}.`} />
      )}
    </>
  )
}
