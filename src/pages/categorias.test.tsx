// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mock = vi.hoisted(() => ({
  listarCategorias: vi.fn(),
  criarCategoria: vi.fn(),
  editarCategoria: vi.fn(),
  definirCategoriaAtiva: vi.fn(),
}))
vi.mock('../lib/FamiliaContext', () => ({
  useFamilia: () => ({ familia: { id: 'h1', nome: 'Casa', papel: 'owner' }, carregando: false, erro: false, recarregar: vi.fn() }),
}))
vi.mock('../lib/categorias', async (original) => ({
  ...(await original<typeof import('../lib/categorias')>()),
  listarCategorias: mock.listarCategorias,
  criarCategoria: mock.criarCategoria,
  editarCategoria: mock.editarCategoria,
  definirCategoriaAtiva: mock.definirCategoriaAtiva,
}))

import Categorias from './Categorias'
import { agrupar } from '../lib/categorias'
import type { Categoria } from '../lib/categorias'

const cat = (id: string, nome: string, extra: Partial<Categoria> = {}): Categoria =>
  ({ id, nome, tipo: 'expense', paiId: null, sistema: false, ativa: true, ...extra })

const base: Categoria[] = [
  cat('sc', 'Sem categoria', { sistema: true }),
  cat('m', 'Moradia'),
  cat('al', 'Aluguel', { paiId: 'm' }),
  cat('ag', 'Água', { paiId: 'm' }),
  cat('l', 'Lazer', { ativa: false }),
  cat('sal', 'Salário', { tipo: 'income' }),
]

beforeEach(() => {
  mock.listarCategorias.mockResolvedValue(base)
  mock.criarCategoria.mockResolvedValue(undefined)
  mock.editarCategoria.mockResolvedValue(undefined)
  mock.definirCategoriaAtiva.mockResolvedValue(undefined)
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('agrupar', () => {
  it('monta a árvore por tipo, em ordem alfabética, com "Sem categoria" por último', () => {
    const g = agrupar(base, 'expense')
    expect(g.map((x) => x.nome)).toEqual(['Lazer', 'Moradia', 'Sem categoria'])
    expect(g[1].filhas.map((x) => x.nome)).toEqual(['Água', 'Aluguel'])
    expect(agrupar(base, 'income').map((x) => x.nome)).toEqual(['Salário'])
  })
})

describe('Categorias', () => {
  it('mostra despesas com subcategorias; "Sem categoria" não tem ações', async () => {
    render(<Categorias />)
    expect(await screen.findByText('Moradia')).toBeTruthy()
    expect(screen.getByText('Aluguel')).toBeTruthy()
    expect(screen.queryByText('Salário')).toBeNull()
    const sem = screen.getByText('Sem categoria').closest('div')!
    expect(within(sem).queryByRole('button')).toBeNull()
    expect(within(sem).getByText('padrão')).toBeTruthy()
  })

  it('troca para receitas', async () => {
    render(<Categorias />)
    await screen.findByText('Moradia')
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Receitas' }))
    expect(screen.getByText('Salário')).toBeTruthy()
    expect(screen.queryByText('Moradia')).toBeNull()
  })

  it('cria subcategoria do tipo da aba atual', async () => {
    render(<Categorias />)
    const u = userEvent.setup()
    await u.click(await screen.findByRole('button', { name: 'Nova categoria' }))
    await u.type(screen.getByLabelText('Nome'), 'Condomínio')
    // "Sem categoria" não aparece como mãe possível
    expect(within(screen.getByLabelText('Dentro de (opcional)')).queryByText('Sem categoria')).toBeNull()
    await u.selectOptions(screen.getByLabelText('Dentro de (opcional)'), 'm')
    await u.click(screen.getByRole('button', { name: 'Criar categoria' }))
    expect(mock.criarCategoria).toHaveBeenCalledWith('h1', { nome: 'Condomínio', tipo: 'expense', paiId: 'm' })
  })

  it('reativa categoria desativada', async () => {
    render(<Categorias />)
    const linha = (await screen.findByText('Lazer')).closest('div')!
    await userEvent.setup().click(within(linha).getByRole('button', { name: 'Reativar' }))
    expect(mock.definirCategoriaAtiva).toHaveBeenCalledWith('l', true)
  })

  it('regra do banco aparece em português (ex.: virar subcategoria tendo filhas)', async () => {
    mock.editarCategoria.mockRejectedValue({ code: '23514', message: 'categoria com subcategorias não pode virar subcategoria' })
    render(<Categorias />)
    const u = userEvent.setup()
    const linha = (await screen.findByText('Moradia')).closest('div')!
    await u.click(within(linha).getByRole('button', { name: 'Editar' }))
    await u.selectOptions(screen.getByLabelText('Dentro de (opcional)'), 'l')
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(mock.editarCategoria).toHaveBeenCalledWith('m', { nome: 'Moradia', paiId: 'l' })
    expect((await screen.findByRole('alert')).textContent).toBe('Categoria com subcategorias não pode virar subcategoria.')
  })
})
