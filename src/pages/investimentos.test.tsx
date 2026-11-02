// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mock = vi.hoisted(() => ({
  listarAtivosInvestimento: vi.fn(),
  listarCarteiraInvestimentos: vi.fn(),
  listarAlocacaoInvestimentos: vi.fn(),
  criarAtivoInvestimento: vi.fn(),
  definirSubclasseAtivo: vi.fn(),
}))
vi.mock('../lib/FamiliaContext', () => ({
  useFamilia: () => ({ familia: { id: 'h1', nome: 'Casa', papel: 'owner' }, carregando: false, erro: false, recarregar: vi.fn() }),
}))
vi.mock('../lib/investimentos', async (o) => ({
  ...(await o<typeof import('../lib/investimentos')>()),
  listarAtivosInvestimento: mock.listarAtivosInvestimento,
  listarCarteiraInvestimentos: mock.listarCarteiraInvestimentos,
  listarAlocacaoInvestimentos: mock.listarAlocacaoInvestimentos,
  criarAtivoInvestimento: mock.criarAtivoInvestimento,
  definirSubclasseAtivo: mock.definirSubclasseAtivo,
}))

import Investimentos from './Investimentos'
import type { Cents } from '../lib/format'

const c = (n: number) => n as Cents
const ativo = (id: string, nome: string, classe: string, extra: Record<string, unknown> = {}) =>
  ({ id, nome, ticker: null, classe, moeda: 'BRL', ativo: true, subclasse: null, ...extra })
const posicao = (assetId: string, nome: string, classe: string, valor: number) => ({
  assetId, nome, ticker: null, classe, moeda: 'BRL', quantidade: '1', custoMedio: '1', custoTotal: c(valor), precoAtual: '1',
  valorAtual: c(valor), resultado: c(0), dataAvaliacao: null, fonteAvaliacao: null,
})

beforeEach(() => {
  mock.listarAtivosInvestimento.mockResolvedValue([
    ativo('a1', 'Tesouro Selic', 'fixed_income', { subclasse: 'Tesouro Direto' }),
    ativo('a2', 'Ação Y', 'equity', { subclasse: 'Ações' }),
    ativo('a3', 'Fundo W', 'fund'),
  ])
  mock.listarCarteiraInvestimentos.mockResolvedValue({
    posicoes: [posicao('a1', 'Tesouro Selic', 'fixed_income', 60000), posicao('a2', 'Ação Y', 'equity', 10000), posicao('a3', 'Fundo W', 'fund', 5000)],
    totais: [{ moeda: 'BRL', custoTotal: c(75000), valorAtual: c(75000), resultado: c(0) }],
  })
  mock.listarAlocacaoInvestimentos.mockResolvedValue([
    { moeda: 'BRL', nivel: 'macro', macro: 'fixed_income', subclasse: null, valor: c(60000), percentual: 80 },
    { moeda: 'BRL', nivel: 'macro', macro: 'other', subclasse: null, valor: c(5000), percentual: 6.7 },
    { moeda: 'BRL', nivel: 'macro', macro: 'variable', subclasse: null, valor: c(10000), percentual: 13.3 },
    { moeda: 'BRL', nivel: 'subclass', macro: 'fixed_income', subclasse: 'Tesouro Direto', valor: c(60000), percentual: 80 },
    { moeda: 'BRL', nivel: 'subclass', macro: 'other', subclasse: null, valor: c(5000), percentual: 6.7 },
    { moeda: 'BRL', nivel: 'subclass', macro: 'variable', subclasse: 'Ações', valor: c(10000), percentual: 13.3 },
  ])
  mock.criarAtivoInvestimento.mockResolvedValue('novo-id')
  mock.definirSubclasseAtivo.mockResolvedValue(undefined)
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('Investimentos × macroclasse e subclasse', () => {
  it('mostra a alocação por moeda com valores e % do banco, e "Sem subclasse" para o que não tem', async () => {
    render(<Investimentos />)
    const secao = (await screen.findByRole('heading', { name: 'Alocação da carteira' })).closest('section') as HTMLElement
    expect(within(secao).getByText('Renda fixa')).toBeTruthy()
    expect(within(secao).getByText('Renda variável')).toBeTruthy()
    expect(within(secao).getByText('Fundos e outros')).toBeTruthy()
    expect(secao.textContent).toMatch(/600,00 · 80%/)
    expect(secao.textContent).toMatch(/50,00 · 6,7%/)
    expect(within(secao).getByText('Tesouro Direto')).toBeTruthy()
    expect(within(secao).getByText('Sem subclasse')).toBeTruthy()
  })

  it('filtra as posições por macroclasse e por subclasse', async () => {
    const u = userEvent.setup()
    render(<Investimentos />)
    await screen.findByText('Alocação da carteira')
    const posicoes = () => (screen.getByRole('heading', { name: 'Ativos e posições' }).closest('section') as HTMLElement)
    expect(within(posicoes()).getAllByRole('listitem')).toHaveLength(3)

    await u.selectOptions(screen.getByLabelText('Macroclasse'), 'variable')
    expect(within(posicoes()).getAllByRole('listitem')).toHaveLength(1)
    expect(within(posicoes()).getByText(/Ação Y/)).toBeTruthy()

    await u.selectOptions(screen.getByLabelText('Macroclasse'), '')
    await u.selectOptions(screen.getByLabelText('Subclasse'), 'Tesouro Direto')
    expect(within(posicoes()).getByText(/Tesouro Selic/)).toBeTruthy()
    expect(within(posicoes()).queryByText(/Ação Y/)).toBeNull()

    await u.selectOptions(screen.getByLabelText('Macroclasse'), 'variable') // variável + Tesouro Direto = nada
    expect(within(posicoes()).getByText('Nenhuma posição com esse filtro.')).toBeTruthy()
  })

  it('cadastrar ativo com subclasse: cria e depois grava a subclasse', async () => {
    const u = userEvent.setup()
    render(<Investimentos />)
    await u.click(await screen.findByRole('button', { name: 'Novo ativo' }))
    await u.type(screen.getByLabelText('Nome do ativo'), 'CDB Banco X')
    await u.type(screen.getByLabelText('Subclasse (opcional)'), 'CDB')
    await u.click(screen.getByRole('button', { name: 'Salvar ativo' }))
    expect(mock.criarAtivoInvestimento).toHaveBeenCalledWith(expect.objectContaining({ familiaId: 'h1', nome: 'CDB Banco X', classe: 'fixed_income' }))
    expect(mock.criarAtivoInvestimento.mock.calls[0][0]).not.toHaveProperty('subclasse')
    expect(mock.definirSubclasseAtivo).toHaveBeenCalledWith('novo-id', 'CDB')
  })

  it('sem subclasse digitada, não chama a RPC de subclasse', async () => {
    const u = userEvent.setup()
    render(<Investimentos />)
    await u.click(await screen.findByRole('button', { name: 'Novo ativo' }))
    await u.type(screen.getByLabelText('Nome do ativo'), 'Algo')
    await u.click(screen.getByRole('button', { name: 'Salvar ativo' }))
    expect(mock.criarAtivoInvestimento).toHaveBeenCalled()
    expect(mock.definirSubclasseAtivo).not.toHaveBeenCalled()
  })

  it('se a subclasse falhar depois do ativo criado, avisa que o ativo existe', async () => {
    const u = userEvent.setup()
    mock.definirSubclasseAtivo.mockRejectedValue(new Error('subclasse inválida'))
    render(<Investimentos />)
    await u.click(await screen.findByRole('button', { name: 'Novo ativo' }))
    await u.type(screen.getByLabelText('Nome do ativo'), 'CDB Banco X')
    await u.type(screen.getByLabelText('Subclasse (opcional)'), 'CDB')
    await u.click(screen.getByRole('button', { name: 'Salvar ativo' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/Ativo cadastrado, mas a subclasse não foi salva/)
  })

  it('editar a subclasse de um ativo existente; vazio limpa', async () => {
    const u = userEvent.setup()
    render(<Investimentos />)
    await u.click(await screen.findByRole('button', { name: 'Subclasse de Fundo W' }))
    const campo = screen.getByLabelText('Subclasse de Fundo W (vazio limpa)')
    await u.type(campo, 'Multimercado')
    await u.click(screen.getByRole('button', { name: 'Salvar subclasse' }))
    expect(mock.definirSubclasseAtivo).toHaveBeenCalledWith('a3', 'Multimercado')

    await u.click(await screen.findByRole('button', { name: 'Subclasse de Tesouro Selic' }))
    await u.clear(screen.getByLabelText('Subclasse de Tesouro Selic (vazio limpa)'))
    await u.click(screen.getByRole('button', { name: 'Salvar subclasse' }))
    expect(mock.definirSubclasseAtivo).toHaveBeenLastCalledWith('a1', '')
  })

  it('banco sem a migration 034: a carteira aparece normalmente, só sem a seção de alocação', async () => {
    mock.listarAlocacaoInvestimentos.mockRejectedValue(new Error('function public.investment_allocation does not exist'))
    render(<Investimentos />)
    expect(await screen.findByText('Resumo da carteira')).toBeTruthy()
    expect(screen.getAllByText(/Tesouro Selic/).length).toBeGreaterThan(0)
    expect(screen.queryByText('Alocação da carteira')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
