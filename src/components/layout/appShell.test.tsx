// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AppShell } from './AppShell'
import { gruposNavegacao, itemAtivo, itensFixosNoCelular, itensNavegacao } from './navegacao'
import { definirValoresOcultos } from '../../lib/privacidade'

vi.mock('../../lib/supabase', () => ({ supabase: null, supabaseConfigurado: true }))

function montar(caminho = '/') {
  return render(
    <MemoryRouter initialEntries={[caminho]}>
      <Routes><Route element={<AppShell />}><Route path="*" element={<p>conteúdo</p>} /></Route></Routes>
    </MemoryRouter>,
  )
}

describe('menu em grupos', () => {
  beforeEach(() => definirValoresOcultos(false))
  afterEach(cleanup)

  it('toda tela do app está no menu (inclui Recorrentes, que antes não aparecia) e sem caminhos repetidos', () => {
    const caminhos = itensNavegacao.map((i) => i.caminho)
    expect(new Set(caminhos).size).toBe(caminhos.length)
    for (const c of ['/', '/analises', '/lancamentos', '/recorrentes', '/cartoes', '/contas', '/categorias', '/orcamentos', '/relatorios', '/familia']) {
      expect(caminhos).toContain(c)
    }
  })

  it('o menu lateral mostra os grupos na ordem e cada item dentro do seu grupo', () => {
    montar()
    const lateral = screen.getByRole('navigation', { name: 'Principal' })
    expect(within(lateral).getAllByRole('group').map((g) => g.getAttribute('aria-label')))
      .toEqual(['Visão geral', 'Movimentações', 'Planejamento', 'Conta'])
    const mov = within(lateral).getByRole('group', { name: 'Movimentações' })
    expect(within(mov).getAllByRole('link').map((a) => a.textContent))
      .toEqual(['Lançamentos', 'Recorrentes', 'Cartões', 'Contas e conferência'])
    expect(within(lateral).getByRole('link', { name: 'Recorrentes' }).getAttribute('href')).toBe('/recorrentes')
  })

  it('celular: 4 atalhos fixos + "Mais"; o resto só aparece dentro do Mais', async () => {
    const u = userEvent.setup()
    montar()
    const barra = screen.getByRole('navigation', { name: 'Principal no celular' })
    expect(within(barra).getAllByRole('link').map((a) => a.textContent)).toEqual(['Início', 'Lançam.', 'Cartões', 'Orçam.'])
    expect(itensFixosNoCelular).toHaveLength(4)
    expect(screen.queryByRole('dialog')).toBeNull()
    await u.click(within(barra).getByRole('button', { name: 'Mais' }))
    const folha = screen.getByRole('dialog', { name: 'Menu' })
    // todas as telas, em grupos
    const total = gruposNavegacao.reduce((n, g) => n + g.itens.length, 0)
    expect(within(folha).getAllByRole('link')).toHaveLength(total)
    expect(within(folha).getByRole('link', { name: 'Recorrentes' })).toBeTruthy()
    expect(within(folha).getByRole('link', { name: 'Categorias' })).toBeTruthy()
  })

  it('o Mais fecha com Esc, no fundo, no ×, e ao escolher um item (que leva à tela)', async () => {
    const u = userEvent.setup()
    montar()
    const mais = () => screen.getByRole('button', { name: 'Mais' })
    await u.click(mais())
    await u.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(mais()) // o foco volta para quem abriu

    await u.click(mais())
    await u.click(screen.getByRole('button', { name: 'Fechar menu' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    await u.click(mais())
    await u.click(screen.getByRole('button', { name: 'Fechar' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    await u.click(mais())
    await u.click(within(screen.getByRole('dialog')).getByRole('link', { name: 'Recorrentes' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('"Mais" fica destacado quando a tela atual não é um dos 4 atalhos', () => {
    montar('/recorrentes')
    expect(screen.getByRole('button', { name: 'Mais' }).className).toContain('text-azul')
    cleanup()
    montar('/lancamentos')
    expect(screen.getByRole('button', { name: 'Mais' }).className).toContain('text-slate-500')
  })

  it('Análises fica no grupo Visão geral, logo depois do Início, e leva a /analises', () => {
    const visao = gruposNavegacao.find((g) => g.titulo === 'Visão geral')!
    expect(visao.itens.map((i) => i.rotulo)).toEqual(['Início', 'Análises', 'Relatórios e exportação'])
    expect(visao.itens.find((i) => i.rotulo === 'Análises')?.caminho).toBe('/analises')
  })
  it('em /analises o item ativo é Análises, e não Início', () => {
    expect(itemAtivo('/analises')?.rotulo).toBe('Análises')
    expect(itemAtivo('/')?.rotulo).toBe('Início')
  })

  it('itemAtivo: subtela de conta conta como Contas; raiz só casa com "/"', () => {
    expect(itemAtivo('/contas/abc/conferir')?.rotulo).toBe('Contas e conferência')
    expect(itemAtivo('/')?.rotulo).toBe('Início')
    expect(itemAtivo('/desconhecida')).toBeUndefined()
  })
})
