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
    for (const c of ['/', '/analises', '/lancamentos', '/calendario', '/recorrentes', '/cartoes', '/contas', '/dividas', '/investimentos', '/categorias', '/orcamentos', '/relatorios', '/familia']) {
      expect(caminhos).toContain(c)
    }
  })

  it('o menu lateral mostra os grupos na ordem e cada item dentro do seu grupo', () => {
    montar()
    const lateral = screen.getByRole('navigation', { name: 'Principal' })
    expect(within(lateral).getAllByRole('group').map((g) => g.getAttribute('aria-label')))
      .toEqual(['Visão geral', 'Movimentações', 'Planejamento', 'Patrimônio', 'Conta'])
    const mov = within(lateral).getByRole('group', { name: 'Movimentações' })
    expect(within(mov).getAllByRole('link').map((a) => a.textContent))
      .toEqual(['Lançamentos', 'Calendário', 'Recorrentes', 'Cartões', 'Contas'])
    expect(within(lateral).getByRole('link', { name: 'Recorrentes' }).getAttribute('href')).toBe('/recorrentes')
    expect(within(lateral).getByRole('link', { name: 'Investimentos' }).getAttribute('href')).toBe('/investimentos')
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

  it('toda tela tem uma frase curta dizendo para que serve', () => {
    for (const i of itensNavegacao) {
      expect(i.descricao.trim(), i.caminho).not.toBe('')
      expect(i.descricao.length, i.caminho).toBeLessThanOrEqual(60)
      expect(i.descricao.endsWith('.'), i.caminho).toBe(true)
    }
  })

  it('o Mais mostra 4 atalhos em cartões e o resto em lista, cada tela uma vez só, com a frase como descrição', async () => {
    const u = userEvent.setup()
    montar()
    await u.click(screen.getByRole('button', { name: 'Mais' }))
    const folha = screen.getByRole('dialog', { name: 'Menu' })
    const atalhos = within(folha).getByRole('group', { name: 'Atalhos' })
    expect(within(atalhos).getAllByRole('link').map((a) => a.getAttribute('aria-label')))
      .toEqual(['Calendário', 'Recorrentes', 'Contas', 'Categorias'])
    // nenhuma tela aparece duas vezes (cartão e linha)
    const hrefs = within(folha).getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(new Set(hrefs).size).toBe(hrefs.length)
    // o nome do link continua só o rótulo; a frase é a descrição (leitor de tela lê as duas)
    const cartoes = within(folha).getByRole('link', { name: 'Cartões' })
    expect(cartoes.getAttribute('href')).toBe('/cartoes')
    expect(cartoes.getAttribute('aria-describedby')).toBe('desc-/cartoes')
    expect(folha.querySelector('[id="desc-/cartoes"]')!.textContent).toBe('Fatura, parcelas e limite de cada cartão.')
    // as linhas que sobraram mantêm seus grupos; o grupo que ficou vazio some
    expect(within(folha).getAllByRole('group').map((g) => g.getAttribute('aria-label')))
      .toEqual(['Atalhos', 'Visão geral', 'Movimentações', 'Planejamento', 'Patrimônio', 'Conta'])
  })

  it('o menu lateral (iPad e computador) não muda: só os nomes, sem frases', () => {
    montar()
    const lateral = screen.getByRole('navigation', { name: 'Principal' })
    expect(within(lateral).queryByText('Fatura, parcelas e limite de cada cartão.')).toBeNull()
    expect(within(lateral).getAllByRole('link')).toHaveLength(itensNavegacao.length)
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
    expect(itemAtivo('/contas/abc')?.rotulo).toBe('Contas')
    expect(itemAtivo('/')?.rotulo).toBe('Início')
    expect(itemAtivo('/desconhecida')).toBeUndefined()
  })
})
