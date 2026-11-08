import type { ComponentType } from 'react'
import {
  IconeCalendario, IconeCartoes, IconeCategorias, IconeContas, IconeFamilia, IconeLancamentos,
  IconeAnalises, IconeExportar, IconeOrcamentos, IconeRecorrentes, IconeRelatorios, IconeVisaoGeral, IconeDividas, IconeInvestimentos, IconeBens, IconePreferencias,
} from './icons'

export interface ItemNavegacao {
  caminho: string
  rotulo: string
  /** Rótulo curto para a barra inferior do celular. */
  curto: string
  Icone: ComponentType
  /** Uma linha dizendo para que a tela serve (aparece nos menus secundários). */
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

/** Todas as telas do app, usadas também no menu "Mais" do celular. */
export const gruposNavegacao: GrupoNavegacao[] = [
  {
    titulo: 'Visão geral',
    itens: [
      { caminho: '/', rotulo: 'Início', curto: 'Início', Icone: IconeVisaoGeral, descricao: 'O que pede atenção agora na família.', fixoNoCelular: true },
      { caminho: '/analises', rotulo: 'Análises', curto: 'Análises', Icone: IconeAnalises, descricao: 'Como as finanças estão indo no mês.' },
      { caminho: '/relatorios', rotulo: 'Relatórios', curto: 'Relat.', Icone: IconeRelatorios, descricao: 'Quanto entrou e saiu em cada período.' },
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
      { caminho: '/exportar', rotulo: 'Exportar dados', curto: 'Exportar', Icone: IconeExportar, descricao: 'Lançamentos em planilha e cópia completa dos dados.' },
    ],
  },
]

const itemPreferencias: ItemNavegacao = { caminho: '/preferencias', rotulo: 'Preferências', curto: 'Preferências', Icone: IconePreferencias, descricao: 'Personalize a navegação e as opções da sua conta.' }
export const itensNavegacao: ItemNavegacao[] = [...gruposNavegacao.flatMap((g) => g.itens), itemPreferencias]
export const itensFixosNoCelular: ItemNavegacao[] = itensNavegacao.filter((i) => i.fixoNoCelular)

/** Acesso rápido no desktop: sem cabeçalhos e sem configurações esporádicas. */
const caminhosAcessoRapido = ['/', '/lancamentos', '/cartoes', '/orcamentos', '/investimentos', '/analises', '/relatorios', '/calendario']
export const itensAcessoRapido: ItemNavegacao[] = caminhosAcessoRapido
  .map((caminho) => itensNavegacao.find((item) => item.caminho === caminho))
  .filter((item): item is ItemNavegacao => item !== undefined)

/** Destinos secundários exibidos no popover do perfil. */
export const gruposMenuPerfil: GrupoNavegacao[] = [
  { titulo: 'Gestão', itens: itensNavegacao.filter((i) => ['/contas', '/categorias', '/recorrentes'].includes(i.caminho)) },
  { titulo: 'Patrimônio & Conta', itens: itensNavegacao.filter((i) => ['/bens', '/dividas', '/familia'].includes(i.caminho)) },
  { titulo: 'Sistema', itens: itensNavegacao.filter((i) => ['/exportar', '/preferencias'].includes(i.caminho)) },
]

/** Item ativo para um caminho (uma subtela como `/contas/abc` conta como "Contas"). */
export function itemAtivo(pathname: string): ItemNavegacao | undefined {
  return itensNavegacao.find((i) => (i.caminho === '/' ? pathname === '/' : pathname === i.caminho || pathname.startsWith(`${i.caminho}/`)))
}
