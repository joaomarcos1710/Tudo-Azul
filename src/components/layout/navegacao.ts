import type { ComponentType } from 'react'
import {
  IconeVisaoGeral, IconeLancamentos, IconeContas, IconeFluxo,
  IconeBens, IconeInvestimentos, IconeEmprestimos, IconeOrcamentos,
  IconeMetas, IconeRelatorios, IconeCategorias, IconeFamilia, IconeCalendario,
} from './icons'

export interface ItemNavegacao {
  caminho: string
  rotulo: string
  curto: string
  Icone: ComponentType
}

export const itensNavegacao: ItemNavegacao[] = [
  { caminho: '/', rotulo: 'Visão Geral', curto: 'Início', Icone: IconeVisaoGeral },
  { caminho: '/calendario', rotulo: 'Calendário Financeiro', curto: 'Calend.', Icone: IconeCalendario },
  { caminho: '/lancamentos', rotulo: 'Lançamentos', curto: 'Lançam.', Icone: IconeLancamentos },
  { caminho: '/contas', rotulo: 'Contas & Cartões', curto: 'Contas', Icone: IconeContas },
  { caminho: '/fluxo', rotulo: 'Receitas & Gastos (Parcelas)', curto: 'Fluxo', Icone: IconeFluxo },
  { caminho: '/bens', rotulo: 'Meus Bens', curto: 'Bens', Icone: IconeBens },
  { caminho: '/investimentos', rotulo: 'Investimentos', curto: 'Invest.', Icone: IconeInvestimentos },
  { caminho: '/emprestimos', rotulo: 'Empréstimos', curto: 'Dívidas', Icone: IconeEmprestimos },
  { caminho: '/orcamentos', rotulo: 'Orçamentos', curto: 'Orçam.', Icone: IconeOrcamentos },
  { caminho: '/metas', rotulo: 'Sonhos & Metas', curto: 'Sonhos', Icone: IconeMetas },
  { caminho: '/relatorios', rotulo: 'Resumo & Comparativo', curto: 'Relat.', Icone: IconeRelatorios },
  { caminho: '/categorias', rotulo: 'Categorias (50-30-20)', curto: 'Categ.', Icone: IconeCategorias },
  { caminho: '/familia', rotulo: 'Família', curto: 'Família', Icone: IconeFamilia },
]
