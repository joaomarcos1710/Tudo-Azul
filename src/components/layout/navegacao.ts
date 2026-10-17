import type { ComponentType } from 'react'
import {
  IconeCartoes, IconeCategorias, IconeContas, IconeFamilia, IconeLancamentos,
  IconeOrcamentos, IconeRelatorios, IconeVisaoGeral,
} from './icons'

export interface ItemNavegacao {
  caminho: string
  rotulo: string
  /** Rótulo curto para a barra inferior do celular. */
  curto: string
  Icone: ComponentType
}

export const itensNavegacao: ItemNavegacao[] = [
  { caminho: '/', rotulo: 'Visão geral', curto: 'Início', Icone: IconeVisaoGeral },
  { caminho: '/lancamentos', rotulo: 'Lançamentos', curto: 'Lançam.', Icone: IconeLancamentos },
  { caminho: '/contas', rotulo: 'Contas', curto: 'Contas', Icone: IconeContas },
  { caminho: '/cartoes', rotulo: 'Cartões', curto: 'Cartões', Icone: IconeCartoes },
  { caminho: '/categorias', rotulo: 'Categorias', curto: 'Categ.', Icone: IconeCategorias },
  { caminho: '/orcamentos', rotulo: 'Orçamentos', curto: 'Orçam.', Icone: IconeOrcamentos },
  { caminho: '/relatorios', rotulo: 'Relatórios', curto: 'Relat.', Icone: IconeRelatorios },
  { caminho: '/familia', rotulo: 'Configurações da família', curto: 'Família', Icone: IconeFamilia },
]
