// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mock = vi.hoisted(() => ({
  listarCategorias: vi.fn(),
  definirCategoriaGrupo: vi.fn(),
  relatorioRegra: vi.fn(),
}))
vi.mock('../lib/FamiliaContext', () => ({
  useFamilia: () => ({ familia: { id: 'h1', nome: 'Casa', papel: 'owner' }, carregando: false, erro: false, recarregar: vi.fn() }),
}))
vi.mock('../lib/categorias', async (original) => ({
  ...(await original<typeof import('../lib/categorias')>()),
  listarCategorias: mock.listarCategorias,
  definirCategoriaGrupo: mock.definirCategoriaGrupo,
}))
vi.mock('../lib/regra503020', async (original) => ({
  ...(await original<typeof import('../lib/regra503020')>()),
  relatorioRegra: mock.relatorioRegra,
}))

import Categorias from './Categorias'
import { sugerirGrupo } from '../lib/regra503020'
import type { Categoria } from '../lib/categorias'
import type { Cents } from '../lib/format'

const c = (n: number) => n as Cents
const cat = (id: string, nome: string, extra: Partial<Categoria> = {}): Categoria =>
  ({ id, nome, tipo: 'expense', paiId: null, sistema: false, ativa: true, eventual: false, ...extra })

beforeEach(() => {
  mock.listarCategorias.mockResolvedValue([
    cat('sc', 'Sem categoria', { sistema: true }),
    cat('m', 'Moradia', { grupo: 'essential' }),
    cat('al', 'Aluguel', { paiId: 'm' }),
    cat('l', 'Lazer'),
    cat('x', 'Coisas variadas'),
  ])
  mock.definirCategoriaGrupo.mockResolvedValue(undefined)
  mock.relatorioRegra.mockResolvedValue([
    { grupo: 'essential', valor: c(400000), percentualDespesa: 57.1, percentualRenda: 40 },
    { grupo: 'lifestyle', valor: c(200000), percentualDespesa: 28.6, percentualRenda: 20 },
    { grupo: 'investment', valor: c(0), percentualDespesa: 0, percentualRenda: 0 },
    { grupo: 'none', valor: c(100000), percentualDespesa: 14.3, percentualRenda: 10 },
  ])
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('sugerirGrupo', () => {
  it('sugere pelo nome, sem acento e por palavra inteira; sem pista, nenhuma', () => {
    expect(sugerirGrupo('Moradia')).toBe('essential')
    expect(sugerirGrupo('Saúde')).toBe('essential')
    expect(sugerirGrupo('Restaurantes')).toBeNull() // plural não é palavra-chave exata; o app não chuta
    expect(sugerirGrupo('Restaurante')).toBe('lifestyle')
    expect(sugerirGrupo('Reserva de viagem')).toBe('investment') // investir tem prioridade sobre desejos
    expect(sugerirGrupo('Coisas variadas')).toBeNull()
    expect(sugerirGrupo('Bar do Zé')).toBe('lifestyle')
    expect(sugerirGrupo('Barato')).toBeNull() // "bar" dentro de outra palavra não conta
  })
})

describe('Categorias × regra 50-30-20', () => {
  it('mostra o cartão do mês com valores e % vindos do banco, e o que está sem grupo', async () => {
    render(<Categorias />)
    expect(await screen.findByText(/Regra 50-30-20 em/)).toBeTruthy()
    expect(screen.getByText(/R\$\s*4\.000,00 · 40% da renda/)).toBeTruthy()
    expect(screen.getByText(/R\$\s*2\.000,00 · 20% da renda/)).toBeTruthy()
    expect(screen.getByText(/R\$\s*1\.000,00 · classifique abaixo/)).toBeTruthy()
  })

  it('classificar chama o banco com o grupo escolhido e recarrega o relatório', async () => {
    render(<Categorias />)
    await userEvent.selectOptions(await screen.findByLabelText('Grupo de Lazer'), 'lifestyle')
    expect(mock.definirCategoriaGrupo).toHaveBeenCalledWith('l', 'lifestyle')
    expect(mock.relatorioRegra.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('"Sem grupo" grava nulo', async () => {
    render(<Categorias />)
    await userEvent.selectOptions(await screen.findByLabelText('Grupo de Moradia'), '')
    expect(mock.definirCategoriaGrupo).toHaveBeenCalledWith('m', null)
  })

  it('subcategoria mostra o grupo herdado da principal e não recebe sugestão', async () => {
    render(<Categorias />)
    expect(await screen.findByText('Necessidades (da principal)')).toBeTruthy()
    expect((screen.getByLabelText('Grupo de Aluguel') as HTMLSelectElement).selectedOptions[0].textContent).toBe('Igual à principal')
    expect(screen.queryByRole('button', { name: /Sugestão: Necessidades/ })).toBeNull()
  })

  it('só sugere; nunca grava sozinho — gravar exige clicar em "Sugestão"', async () => {
    render(<Categorias />)
    const botao = await screen.findByRole('button', { name: 'Sugestão: Desejos' }) // Lazer
    expect(mock.definirCategoriaGrupo).not.toHaveBeenCalled()
    await userEvent.click(botao)
    expect(mock.definirCategoriaGrupo).toHaveBeenCalledWith('l', 'lifestyle')
    // "Coisas variadas" não tem pista: sem botão de sugestão
    expect(screen.getAllByRole('button', { name: /Sugestão/ })).toHaveLength(1)
  })

  it('banco sem a migration 032: a tela segue funcionando, só sem o cartão', async () => {
    mock.relatorioRegra.mockRejectedValue(new Error('function public.budget_rule_report does not exist'))
    render(<Categorias />)
    expect(await screen.findByLabelText('Grupo de Lazer')).toBeTruthy()
    expect(screen.queryByText(/Regra 50-30-20 em/)).toBeNull()
  })
})
