import type { ComponentType } from 'react'
import {
  IconeCalendario, IconeCartoes, IconeCategorias, IconeContas, IconeFamilia, IconeLancamentos,
  IconeAnalises, IconeOrcamentos, IconeRecorrentes, IconeRelatorios, IconeVisaoGeral, IconeDividas, IconeInvestimentos, IconeBens,
} from './icons'

export interface ItemNavegacao {
  caminho: string
  rotulo: string
  /** Rótulo curto para a barra inferior do celular. */
  curto: string
  Icone: ComponentType
  /** Uma linha dizendo para que a tela serve (aparece no "Mais" do celular). */
  descricao: string
  /** Fica sempre na barra inferior do celular; os demais ficam no "Mais". */
  fixoNoCelular?: boolean
  /** No "Mais" do celular aparece como cartão de atalho no topo, em vez de linha da lista. */
  atalho?: boolean
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
      { caminho: '/', rotulo: 'Início', curto: 'Início', Icone: IconeVisaoGeral, descricao: 'O que pede atenção agora na família.', fixoNoCelular: true },
      { caminho: '/analises', rotulo: 'Análises', curto: 'Análises', Icone: IconeAnalises, descricao: 'Como as finanças estão indo no mês.' },
      { caminho: '/relatorios', rotulo: 'Relatórios e exportação', curto: 'Relat.', Icone: IconeRelatorios, descricao: 'Planilha e cópia completa dos dados.' },
    ],
  },
  {
    titulo: 'Movimentações',
    itens: [
      { caminho: '/lancamentos', rotulo: 'Lançamentos', curto: 'Lançam.', Icone: IconeLancamentos, descricao: 'Receitas, despesas e transferências do mês.', fixoNoCelular: true },
      { caminho: '/calendario', rotulo: 'Calendário', curto: 'Calend.', Icone: IconeCalendario, descricao: 'O que entra e sai a cada dia do mês.', atalho: true },
      { caminho: '/recorrentes', rotulo: 'Recorrentes', curto: 'Recorr.', Icone: IconeRecorrentes, descricao: 'Contas e receitas que se repetem.', atalho: true },
      { caminho: '/cartoes', rotulo: 'Cartões', curto: 'Cartões', Icone: IconeCartoes, descricao: 'Fatura, parcelas e limite de cada cartão.', fixoNoCelular: true },
      { caminho: '/contas', rotulo: 'Contas', curto: 'Contas', Icone: IconeContas, descricao: 'Saldo de cada conta, vindo do banco.', atalho: true },
    ],
  },
  {
    titulo: 'Planejamento',
    itens: [
      { caminho: '/orcamentos', rotulo: 'Orçamentos', curto: 'Orçam.', Icone: IconeOrcamentos, descricao: 'Quanto gastar por categoria no mês.', fixoNoCelular: true },
      { caminho: '/categorias', rotulo: 'Categorias', curto: 'Categ.', Icone: IconeCategorias, descricao: 'Como receitas e despesas são agrupadas.', atalho: true },
    ],
  },
  {
    titulo: 'Patrimônio',
    itens: [
      { caminho: '/dividas', rotulo: 'Dívidas e empréstimos', curto: 'Dívidas', Icone: IconeDividas, descricao: 'Saldo devedor, pagamentos e estratégias de quitação.' },
      { caminho: '/investimentos', rotulo: 'Investimentos', curto: 'Invest.', Icone: IconeInvestimentos, descricao: 'Carteira e operações de ativos da família.' },
      { caminho: '/bens', rotulo: 'Bens e patrimônio', curto: 'Bens', Icone: IconeBens, descricao: 'Imóveis, veículos e outros bens da família.' },
    ],
  },
  {
    titulo: 'Conta',
    itens: [
      { caminho: '/familia', rotulo: 'Família', curto: 'Família', Icone: IconeFamilia, descricao: 'Quem participa, convites e versão do app.' },
    ],
  },
]

export const itensNavegacao: ItemNavegacao[] = gruposNavegacao.flatMap((g) => g.itens)
export const itensFixosNoCelular: ItemNavegacao[] = itensNavegacao.filter((i) => i.fixoNoCelular)

/** Item ativo para um caminho (uma subtela como `/contas/abc` conta como "Contas"). */
export function itemAtivo(pathname: string): ItemNavegacao | undefined {
  return itensNavegacao.find((i) => (i.caminho === '/' ? pathname === '/' : pathname === i.caminho || pathname.startsWith(`${i.caminho}/`)))
}
