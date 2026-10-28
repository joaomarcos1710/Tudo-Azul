import type { ReactNode } from 'react'
import { EmptyState } from '../components/ui/EmptyState'
import { CabecalhoPagina } from '../components/ui/CabecalhoPagina'

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
      <CabecalhoPagina titulo={titulo} />
      {children ?? (
        <EmptyState titulo="Disponível em breve" descricao={`${descricao} Planejado para a ${etapa}.`} />
      )}
    </>
  )
}
