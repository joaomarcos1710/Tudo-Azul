import type { ComponentType } from 'react'
import {
  IconeCartoes, IconeCategorias, IconeContas, IconeFamilia, IconeLancamentos,
  IconeAnalises, IconeOrcamentos, IconeRecorrentes, IconeRelatorios, IconeVisaoGeral,
} from './icons'

export interface ItemNavegacao {
  caminho: string
  rotulo: string
  /** Rótulo curto para a barra inferior do celular. */
  curto: string
  Icone: ComponentType
  /** Fica sempre na barra inferior do celular; os demais ficam no "Mais". */
  fixoNoCelular?: boolean
}

export interface GrupoNavegacao {
  titulo: string
  itens: ItemNavegacao[]
}

/** O app em grupos (menu lateral no iPad/computador; "Mais" no celular). Toda tela tem de estar aqui. */
export const gruposNavegacao: GrupoNavegacao[] = [
  {
    titulo: 'Visão geral',
    itens: [
      { caminho: '/', rotulo: 'Início', curto: 'Início', Icone: IconeVisaoGeral, fixoNoCelular: true },
      { caminho: '/analises', rotulo: 'Análises', curto: 'Análises', Icone: IconeAnalises },
      { caminho: '/relatorios', rotulo: 'Relatórios e exportação', curto: 'Relat.', Icone: IconeRelatorios },
    ],
  },
  {
    titulo: 'Movimentações',
    itens: [
      { caminho: '/lancamentos', rotulo: 'Lançamentos', curto: 'Lançam.', Icone: IconeLancamentos, fixoNoCelular: true },
      { caminho: '/recorrentes', rotulo: 'Recorrentes', curto: 'Recorr.', Icone: IconeRecorrentes },
      { caminho: '/cartoes', rotulo: 'Cartões', curto: 'Cartões', Icone: IconeCartoes, fixoNoCelular: true },
      { caminho: '/contas', rotulo: 'Contas e conferência', curto: 'Contas', Icone: IconeContas },
    ],
  },
  {
    titulo: 'Planejamento',
    itens: [
      { caminho: '/orcamentos', rotulo: 'Orçamentos', curto: 'Orçam.', Icone: IconeOrcamentos, fixoNoCelular: true },
      { caminho: '/categorias', rotulo: 'Categorias', curto: 'Categ.', Icone: IconeCategorias },
    ],
  },
  {
    titulo: 'Conta',
    itens: [
      { caminho: '/familia', rotulo: 'Família', curto: 'Família', Icone: IconeFamilia },
    ],
  },
]

export const itensNavegacao: ItemNavegacao[] = gruposNavegacao.flatMap((g) => g.itens)
export const itensFixosNoCelular: ItemNavegacao[] = itensNavegacao.filter((i) => i.fixoNoCelular)

/** Item ativo para um caminho (`/contas/abc/conferir` conta como "Contas"). */
export function itemAtivo(pathname: string): ItemNavegacao | undefined {
  return itensNavegacao.find((i) => (i.caminho === '/' ? pathname === '/' : pathname === i.caminho || pathname.startsWith(`${i.caminho}/`)))
}
