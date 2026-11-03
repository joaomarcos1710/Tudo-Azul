// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const mock = vi.hoisted(() => ({
  listarDividas: vi.fn(),
  listarContas: vi.fn(),
  listarCategorias: vi.fn(),
}))
vi.mock('../lib/FamiliaContext', () => ({
  useFamilia: () => ({ familia: { id: 'h1', nome: 'Casa', papel: 'owner' }, carregando: false, erro: false, recarregar: vi.fn() }),
}))
vi.mock('../lib/dividas', async (o) => ({ ...(await o<typeof import('../lib/dividas')>()), listarDividas: mock.listarDividas }))
vi.mock('../lib/contas', async (o) => ({ ...(await o<typeof import('../lib/contas')>()), listarContas: mock.listarContas }))
vi.mock('../lib/categorias', async (o) => ({ ...(await o<typeof import('../lib/categorias')>()), listarCategorias: mock.listarCategorias }))

import Dividas from './Dividas'
import type { Cents } from '../lib/format'

const c = (n: number) => n as Cents

beforeEach(() => {
  mock.listarDividas.mockResolvedValue([
    { id: 'd1', nome: 'Financiamento do imóvel', tipo: 'financing', saldo: c(25000000), compromissos: c(0), ativa: true, taxaMensalBps: 90, pagamentoMinimo: c(250000) },
    { id: 'd2', nome: 'Empréstimo pessoal', tipo: 'loan', saldo: c(500000), compromissos: c(0), ativa: true, taxaMensalBps: 200, pagamentoMinimo: c(50000) },
  ])
  mock.listarContas.mockResolvedValue({ contas: [], total: c(0) })
  mock.listarCategorias.mockResolvedValue([])
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('Dívidas', () => {
  it('lista empréstimos e financiamentos, com a grafia correta do tipo', async () => {
    render(<Dividas />)
    expect(await screen.findByText('Financiamento do imóvel')).toBeTruthy()
    expect(screen.getByText('Empréstimo pessoal')).toBeTruthy()
    expect(screen.getByText('Financiamento')).toBeTruthy() // rótulo do tipo
    expect(screen.getByText('Empréstimo')).toBeTruthy()
  })

  it('não oferece o simulador de quitação (removido a pedido do dono)', async () => {
    render(<Dividas />)
    await screen.findByText('Financiamento do imóvel')
    expect(screen.queryByText(/simulador/i)).toBeNull()
    expect(screen.queryByText(/snowball/i)).toBeNull()
    expect(screen.queryByText(/avalanche/i)).toBeNull()
    expect(screen.queryByLabelText(/Orçamento mensal total/)).toBeNull()
    // o que continua: registrar pagamento e os parâmetros do contrato
    expect(screen.getAllByRole('button', { name: 'Registrar pagamento' }).length).toBe(2)
    expect(screen.getAllByRole('button', { name: 'Parâmetros da dívida' }).length).toBe(2)
  })
})
