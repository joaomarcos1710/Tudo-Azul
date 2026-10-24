// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { Cents } from '../lib/format'

const mock = vi.hoisted(() => ({
  listarContas: vi.fn(),
  criarConta: vi.fn(),
  editarConta: vi.fn(),
  definirAtiva: vi.fn(),
}))
vi.mock('../lib/FamiliaContext', () => ({
  useFamilia: () => ({ familia: { id: 'h1', nome: 'Casa', papel: 'owner' }, carregando: false, erro: false, recarregar: vi.fn() }),
}))
vi.mock('../lib/contas', async (original) => ({
  ...(await original<typeof import('../lib/contas')>()),
  listarContas: mock.listarContas,
  criarConta: mock.criarConta,
  editarConta: mock.editarConta,
  definirAtiva: mock.definirAtiva,
}))

import Contas from './Contas'
import { hojeSP } from '../lib/contas'

const c = (n: number) => n as Cents
const corrente = { id: 'a1', nome: 'Itaú', tipo: 'checking' as const, saldoInicial: c(100000), abertura: '2026-12-01', ativa: true, saldo: c(125050) }

beforeEach(() => {
  mock.listarContas.mockResolvedValue({ contas: [], total: c(0) })
  mock.criarConta.mockResolvedValue(undefined)
  mock.editarConta.mockResolvedValue(undefined)
  mock.definirAtiva.mockResolvedValue(undefined)
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('hojeSP', () => {
  it('usa o dia de São Paulo, não o UTC', () => {
    expect(hojeSP(new Date('2026-12-01T02:30:00Z'))).toBe('2026-11-30')
  })
})

describe('Contas', () => {
  it('sem contas, convida a cadastrar a primeira', async () => {
    render(<MemoryRouter><Contas /></MemoryRouter>)
    expect(await screen.findByText('Nenhuma conta ainda')).toBeTruthy()
  })

  it('mostra saldo e total que vêm do banco, formatados a partir de centavos', async () => {
    mock.listarContas.mockResolvedValue({
      contas: [corrente, { ...corrente, id: 'a2', nome: 'Carteira', tipo: 'cash', ativa: false, saldo: c(-5000) }],
      total: c(120050),
    })
    render(<MemoryRouter><Contas /></MemoryRouter>)
    expect(await screen.findByText('R$ 1.200,50')).toBeTruthy() // total do banco, não somado na tela
    expect(screen.getByText('R$ 1.250,50')).toBeTruthy()
    expect(screen.getByText('-R$ 50,00')).toBeTruthy()
    expect(screen.getByText('desativada')).toBeTruthy()
  })

  it('conta que abre no futuro mostra a data em vez de saldo', async () => {
    mock.listarContas.mockResolvedValue({ contas: [{ ...corrente, saldo: null }], total: c(0) })
    render(<MemoryRouter><Contas /></MemoryRouter>)
    expect(await screen.findByText('abre em 01/12/2026')).toBeTruthy()
  })

  it('cadastra conta com saldo inicial em centavos (aceita negativo)', async () => {
    render(<MemoryRouter><Contas /></MemoryRouter>)
    const u = userEvent.setup()
    await u.click(await screen.findByRole('button', { name: 'Cadastrar a primeira conta' }))
    await u.type(screen.getByLabelText('Nome'), 'Nubank')
    await u.selectOptions(screen.getByLabelText('Tipo'), 'savings')
    const saldo = screen.getByLabelText('Saldo inicial (R$)')
    await u.clear(saldo)
    await u.type(saldo, '-1.250,50')
    await u.click(screen.getByRole('button', { name: 'Cadastrar conta' }))
    expect(mock.criarConta).toHaveBeenCalledWith('h1', { nome: 'Nubank', tipo: 'savings', saldoInicial: -125050, abertura: hojeSP() })
    expect(mock.listarContas).toHaveBeenCalledTimes(2)
  })

  it('não envia valor inválido', async () => {
    render(<MemoryRouter><Contas /></MemoryRouter>)
    const u = userEvent.setup()
    await u.click(await screen.findByRole('button', { name: 'Cadastrar a primeira conta' }))
    await u.type(screen.getByLabelText('Nome'), 'Nubank')
    const saldo = screen.getByLabelText('Saldo inicial (R$)')
    await u.clear(saldo)
    await u.type(saldo, '1.2.3')
    await u.click(screen.getByRole('button', { name: 'Cadastrar conta' }))
    expect(screen.getByText(/Valor inválido/)).toBeTruthy()
    expect(mock.criarConta).not.toHaveBeenCalled()
  })

  it('editar preenche os dados atuais e salva', async () => {
    mock.listarContas.mockResolvedValue({ contas: [corrente], total: c(125050) })
    render(<MemoryRouter><Contas /></MemoryRouter>)
    const u = userEvent.setup()
    await u.click(await screen.findByRole('button', { name: 'Editar' }))
    expect((screen.getByLabelText('Saldo inicial (R$)') as HTMLInputElement).value).toBe('1.000,00')
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(mock.editarConta).toHaveBeenCalledWith('a1', { nome: 'Itaú', tipo: 'checking', saldoInicial: 100000, abertura: '2026-12-01' })
  })

  it('desativar com planejado em aberto mostra a regra do banco', async () => {
    mock.listarContas.mockResolvedValue({ contas: [corrente], total: c(125050) })
    mock.definirAtiva.mockRejectedValue({ code: '23514', message: 'conta com lançamento planejado em aberto não pode ser desativada' })
    render(<MemoryRouter><Contas /></MemoryRouter>)
    const item = (await screen.findByText('Itaú')).closest('li')!
    await userEvent.setup().click(within(item).getByRole('button', { name: 'Desativar' }))
    expect(mock.definirAtiva).toHaveBeenCalledWith('a1', false)
    expect((await screen.findByRole('alert')).textContent).toBe('Conta com lançamento planejado em aberto não pode ser desativada.')
  })

  it('nome repetido vira mensagem clara', async () => {
    mock.criarConta.mockRejectedValue({ code: '23505', message: 'duplicate key value violates unique constraint "accounts_name_uq"' })
    render(<MemoryRouter><Contas /></MemoryRouter>)
    const u = userEvent.setup()
    await u.click(await screen.findByRole('button', { name: 'Cadastrar a primeira conta' }))
    await u.type(screen.getByLabelText('Nome'), 'Itaú')
    await u.click(screen.getByRole('button', { name: 'Cadastrar conta' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Já existe um registro com esse nome.')
  })
})
