import type { ComponentType } from 'react'
import {
  IconeCalendario, IconeCartoes, IconeCategorias, IconeContas, IconeFamilia, IconeLancamentos,
  IconeAnalises, IconeCompromissos, IconeExportar, IconeOrcamentos, IconeRecorrentes, IconeRelatorios, IconeVisaoGeral, IconeDividas, IconeInvestimentos, IconeBens, IconePreferencias,
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

/**
 * Todas as telas do app, usadas também no menu "Mais" do celular. Barra de baixo (pedido do dono, 10/11/2026):
 * Investimentos entrou no lugar de Orçamentos, que virou atalho no "Mais" (no lugar de
 * Categorias, que segue na lista).
 */
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
      { caminho: '/orcamentos', rotulo: 'Orçamentos', curto: 'Orçam.', Icone: IconeOrcamentos, descricao: 'Quanto gastar por categoria no mês.', atalho: true },
      { caminho: '/compromissos', rotulo: 'Compromissos', curto: 'Compr.', Icone: IconeCompromissos, descricao: 'O que já está comprometido nos próximos meses.' },
      { caminho: '/reservas', rotulo: 'Reservas', curto: 'Reservas', Icone: IconeOrcamentos, descricao: 'Reservas virtuais, aportes e resgates.' },
      { caminho: '/categorias', rotulo: 'Categorias', curto: 'Categ.', Icone: IconeCategorias, descricao: 'Como receitas e despesas são agrupadas.' },
    ],
  },
  {
    titulo: 'Patrimônio',
    itens: [
      { caminho: '/dividas', rotulo: 'Dívidas e empréstimos', curto: 'Dívidas', Icone: IconeDividas, descricao: 'Saldo devedor, pagamentos e estratégias de quitação.' },
      { caminho: '/investimentos', rotulo: 'Investimentos', curto: 'Invest.', Icone: IconeInvestimentos, descricao: 'Carteira e operações de ativos da família.', fixoNoCelular: true },
      { caminho: '/bens', rotulo: 'Bens e patrimônio', curto: 'Bens', Icone: IconeBens, descricao: 'Imóveis, veículos e outros bens da família.' },
    ],
  },
  {
    titulo: 'Conta',
    itens: [
      { caminho: '/familia', rotulo: 'Família', curto: 'Família', Icone: IconeFamilia, descricao: 'Quem participa, convites e versão do app.' },
      { caminho: '/exportar', rotulo: 'Exportar dados', curto: 'Exportar', Icone: IconeExportar, descricao: 'Lançamentos em planilha e cópia completa dos dados.' },
      // no celular só o menu "Mais" lista as telas de conta: se ficar fora de gruposNavegacao, a tela some no iPhone
      { caminho: '/preferencias', rotulo: 'Preferências', curto: 'Preferências', Icone: IconePreferencias, descricao: 'Personalize a navegação e as opções da sua conta.' },
    ],
  },
]

export const itensNavegacao: ItemNavegacao[] = gruposNavegacao.flatMap((g) => g.itens)
export const itensFixosNoCelular: ItemNavegacao[] = itensNavegacao.filter((i) => i.fixoNoCelular)

/**
 * Barra lateral do computador, enxuta (pedido do dono, 17/11/2026: "hoje tem muitas coisas; só os mais importantes, e nos 3 pontos
 * do nome aparece o resto"). Só as nove telas do dia a dia, numa lista só e nesta ordem. Todas as outras telas ficam no menu do
 * nome (o ⋮), em "Mais telas", e a tela atual aparece na barra mesmo quando é uma delas, para não perder o rumo.
 * O menu "Mais" do celular (gruposNavegacao) não muda.
 */
const caminhosBarraLateral = ['/', '/lancamentos', '/calendario', '/cartoes', '/contas', '/recorrentes', '/orcamentos', '/investimentos', '/analises']
export const itensBarraLateral: ItemNavegacao[] = caminhosBarraLateral
  .map((c) => itensNavegacao.find((i) => i.caminho === c))
  .filter((i): i is ItemNavegacao => i !== undefined)

const caminhosConta = ['/familia', '/exportar', '/preferencias']
/** As telas que não estão na barra lateral: ficam no menu do nome, em "Mais telas", na ordem do menu do celular. */
export const itensMaisTelas: ItemNavegacao[] = itensNavegacao
  .filter((i) => !caminhosBarraLateral.includes(i.caminho) && !caminhosConta.includes(i.caminho))

/** Menu do nome (⋮): "Mais telas" e "Conta" (família, exportação e preferências); Sair e a versão ficam no próprio menu. */
export const gruposMenuPerfil: GrupoNavegacao[] = [
  { titulo: 'Mais telas', itens: itensMaisTelas },
  { titulo: 'Conta', itens: itensNavegacao.filter((i) => caminhosConta.includes(i.caminho)) },
]

/** Item ativo para um caminho (uma subtela como `/contas/abc` conta como "Contas"). */
export function itemAtivo(pathname: string): ItemNavegacao | undefined {
  return itensNavegacao.find((i) => (i.caminho === '/' ? pathname === '/' : pathname === i.caminho || pathname.startsWith(`${i.caminho}/`)))
}
