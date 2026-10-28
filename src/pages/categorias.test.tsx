// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mock = vi.hoisted(() => ({
  listarCategorias: vi.fn(),
  criarCategoria: vi.fn(),
  editarCategoria: vi.fn(),
  definirCategoriaAtiva: vi.fn(),
  definirCategoriaEventual: vi.fn(),
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
  definirCategoriaEventual: mock.definirCategoriaEventual,
}))

import Categorias from './Categorias'
import { agrupar } from '../lib/categorias'
import type { Categoria } from '../lib/categorias'

const cat = (id: string, nome: string, extra: Partial<Categoria> = {}): Categoria =>
  ({ id, nome, tipo: 'expense', paiId: null, sistema: false, ativa: true, eventual: false, ...extra })

const base: Categoria[] = [
  cat('sc', 'Sem categoria', { sistema: true }),
  cat('m', 'Moradia'),
  cat('al', 'Aluguel', { paiId: 'm' }),
  cat('ag', 'Água', { paiId: 'm' }),
  cat('l', 'Lazer', { ativa: false }),
  cat('sal', 'Salário', { tipo: 'income' }),
  cat('d13', '13º salário', { tipo: 'income', eventual: true }),
  cat('bon', 'Bônus', { tipo: 'income', paiId: 'd13' }),
]

beforeEach(() => {
  mock.listarCategorias.mockResolvedValue(base)
  mock.criarCategoria.mockResolvedValue(undefined)
  mock.editarCategoria.mockResolvedValue(undefined)
  mock.definirCategoriaAtiva.mockResolvedValue(undefined)
  mock.definirCategoriaEventual.mockResolvedValue(undefined)
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
    expect(agrupar(base, 'income').map((x) => x.nome)).toEqual(['13º salário', 'Salário'])
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
    expect(mock.criarCategoria).toHaveBeenCalledWith('h1', { nome: 'Condomínio', tipo: 'expense', paiId: 'm', icone: null, cor: null })
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
    expect(mock.editarCategoria).toHaveBeenCalledWith('m', { nome: 'Moradia', paiId: 'l', icone: null, cor: null })
    expect((await screen.findByRole('alert')).textContent).toBe('Categoria com subcategorias não pode virar subcategoria.')
  })
})

describe('Receita eventual', () => {
  it('marca a receita como eventual; despesa não tem esse botão', async () => {
    render(<Categorias />)
    const u = userEvent.setup()
    await screen.findByText('Moradia')
    expect(screen.queryByRole('button', { name: /eventual/ })).toBeNull()
    await u.click(screen.getByRole('tab', { name: 'Receitas' }))
    const sal = screen.getByText('Salário').closest('div')!
    await u.click(within(sal).getByRole('button', { name: 'Marcar como eventual' }))
    expect(mock.definirCategoriaEventual).toHaveBeenCalledWith('sal', true)
  })

  it('categoria já eventual oferece voltar a regular; a subcategoria herda a marca e não tem botão próprio', async () => {
    render(<Categorias />)
    const u = userEvent.setup()
    await screen.findByText('Moradia')
    await u.click(screen.getByRole('tab', { name: 'Receitas' }))
    const mae = screen.getByText('13º salário').closest('div')!
    expect(within(mae).getByText('eventual')).toBeTruthy()
    await u.click(within(mae).getByRole('button', { name: 'Marcar como regular' }))
    expect(mock.definirCategoriaEventual).toHaveBeenCalledWith('d13', false)
    const filha = screen.getByText('Bônus').closest('div')!
    expect(within(filha).getByText('eventual (da principal)')).toBeTruthy()
    expect(within(filha).queryByRole('button', { name: /eventual|regular/ })).toBeNull()
  })
})

describe('Ícone e cor', () => {
  const iconeDa = (nome: string) => screen.getByText(nome).closest('div')!.querySelector('[data-icone]')!.getAttribute('data-icone')

  it('cada linha mostra o ícone: sugerido pelo nome, herdado pela subcategoria e fixo em "Sem categoria"', async () => {
    mock.listarCategorias.mockResolvedValue([...base, cat('mer', 'Mercado', { icone: 'sacola', cor: '#9333EA' })])
    render(<Categorias />)
    await screen.findByText('Moradia')
    expect(iconeDa('Moradia')).toBe('casa')
    expect(iconeDa('Água')).toBe('casa') // herda da mãe, não vira "energia"
    expect(iconeDa('Sem categoria')).toBe('etiqueta')
    expect(iconeDa('Mercado')).toBe('sacola') // a escolha gravada vence a sugestão
  })

  it('escolher ícone e cor grava a escolha; "Auto" volta para a sugestão (null)', async () => {
    mock.listarCategorias.mockResolvedValue([...base, cat('mer', 'Mercado', { icone: 'sacola', cor: '#9333EA' })])
    render(<Categorias />)
    const u = userEvent.setup()
    const linha = (await screen.findByText('Moradia')).closest('div')!
    await u.click(within(linha).getByRole('button', { name: 'Editar' }))
    expect(screen.getByRole('button', { name: 'Ícone sugerido pelo nome' }).getAttribute('aria-pressed')).toBe('true')
    await u.click(screen.getByRole('button', { name: 'Coração' }))
    await u.click(screen.getByRole('button', { name: 'Rosa' }))
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(mock.editarCategoria).toHaveBeenCalledWith('m', { nome: 'Moradia', paiId: null, icone: 'coracao', cor: '#DB2777' })

    const mercado = (await screen.findByText('Mercado')).closest('div')!
    await u.click(within(mercado).getByRole('button', { name: 'Editar' }))
    expect(screen.getByRole('button', { name: 'Compras' }).getAttribute('aria-pressed')).toBe('true')
    await u.click(screen.getByRole('button', { name: 'Ícone sugerido pelo nome' }))
    await u.click(screen.getByRole('button', { name: 'Cor sugerida pelo nome' }))
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(mock.editarCategoria).toHaveBeenLastCalledWith('mer', { nome: 'Mercado', paiId: null, icone: null, cor: null })
  })

  it('na subcategoria, o automático é o da principal', async () => {
    render(<Categorias />)
    const u = userEvent.setup()
    const linha = (await screen.findByText('Aluguel')).closest('div')!
    await u.click(within(linha).getByRole('button', { name: 'Editar' }))
    expect(screen.getByRole('button', { name: 'Ícone igual ao da principal' })).toBeTruthy()
    expect(screen.getByText(/usa o ícone e a cor da principal/)).toBeTruthy()
  })
})
