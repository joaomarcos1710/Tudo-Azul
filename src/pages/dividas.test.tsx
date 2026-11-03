// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mock = vi.hoisted(() => ({
  listarDividas: vi.fn(),
  listarContas: vi.fn(),
  listarCategorias: vi.fn(),
  renomearDivida: vi.fn(),
  listarParcelasDivida: vi.fn(),
  registrarPagamentoParcela: vi.fn(),
}))
vi.mock('../lib/FamiliaContext', () => ({
  useFamilia: () => ({ familia: { id: 'h1', nome: 'Casa', papel: 'owner' }, carregando: false, erro: false, recarregar: vi.fn() }),
}))
vi.mock('../lib/dividas', async (o) => ({ ...(await o<typeof import('../lib/dividas')>()), listarDividas: mock.listarDividas, renomearDivida: mock.renomearDivida, listarParcelasDivida: mock.listarParcelasDivida, registrarPagamentoParcela: mock.registrarPagamentoParcela }))
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
  mock.renomearDivida.mockResolvedValue(undefined)
  mock.listarParcelasDivida.mockResolvedValue([])
  mock.registrarPagamentoParcela.mockResolvedValue(undefined)
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

  it('renomear: corrige o nome de um financiamento cadastrado com erro de digitação', async () => {
    mock.listarDividas.mockResolvedValue([
      { id: 'd1', nome: 'Financiamenyo', tipo: 'financing', saldo: c(25000000), compromissos: c(0), ativa: true, taxaMensalBps: 90, pagamentoMinimo: c(250000) },
    ])
    const u = userEvent.setup()
    render(<Dividas />)
    await u.click(await screen.findByRole('button', { name: 'Renomear Financiamenyo' }))
    const campo = screen.getByLabelText('Nome')
    await u.clear(campo)
    await u.type(campo, '  Financiamento do imóvel ')
    await u.click(screen.getByRole('button', { name: 'Salvar nome' }))
    expect(mock.renomearDivida).toHaveBeenCalledWith('d1', '  Financiamento do imóvel ')
  })

  it('renomear: nome vazio não chama o banco', async () => {
    const u = userEvent.setup()
    render(<Dividas />)
    await u.click(await screen.findByRole('button', { name: 'Renomear Empréstimo pessoal' }))
    await u.clear(screen.getByLabelText('Nome'))
    await u.click(screen.getByRole('button', { name: 'Salvar nome' }))
    expect(screen.getByText('Informe o nome.')).toBeTruthy()
    expect(mock.renomearDivida).not.toHaveBeenCalled()
  })

  it('renomear: erro do banco aparece e a tela segue', async () => {
    mock.renomearDivida.mockRejectedValue(new Error('nome inválido: use de 1 a 60 caracteres'))
    const u = userEvent.setup()
    render(<Dividas />)
    await u.click(await screen.findByRole('button', { name: 'Renomear Empréstimo pessoal' }))
    await u.type(screen.getByLabelText('Nome'), ' novo')
    await u.click(screen.getByRole('button', { name: 'Salvar nome' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText('Empréstimo pessoal')).toBeTruthy()
  })
  it('consignado: a parcela traz juros e só o principal abate o saldo; sem conta de saída', async () => {
    mock.listarParcelasDivida.mockResolvedValue([
      { id: 'p1', dividaId: 'd2', nomeDivida: 'Empréstimo pessoal', numero: 1, vencimento: '2027-01-05', valor: c(56000), formaPagamento: 'payroll', contaPagamentoId: null },
    ])
    render(<Dividas />)
    await userEvent.click(await screen.findByRole('button', { name: 'Baixar parcela' }))
    expect(screen.queryByLabelText('Conta de saída')).toBeNull()
    const juros = screen.getByLabelText('Juros incluídos (R$)')
    await userEvent.clear(juros)
    await userEvent.type(juros, '60,00')
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar baixa' }))
    expect(mock.registrarPagamentoParcela).toHaveBeenCalledWith(expect.objectContaining({
      parcelaId: 'p1', contaId: null, principal: c(50000), juros: c(6000), tarifa: c(0),
    }))
  })
})
