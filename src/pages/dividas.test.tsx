// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mock = vi.hoisted(() => ({
  listarDividas: vi.fn(),
  listarContas: vi.fn(),
  listarCategorias: vi.fn(),
  renomearDivida: vi.fn(),
  listarParcelasDivida: vi.fn(),
  registrarPagamentoParcela: vi.fn(),
  arquivarDivida: vi.fn(),
  reativarDivida: vi.fn(),
  excluirDivida: vi.fn(),
}))
vi.mock('../lib/FamiliaContext', () => ({
  useFamilia: () => ({ familia: { id: 'h1', nome: 'Casa', papel: 'owner' }, carregando: false, erro: false, recarregar: vi.fn() }),
}))
vi.mock('../lib/dividas', async (o) => ({ ...(await o<typeof import('../lib/dividas')>()), listarDividas: mock.listarDividas, renomearDivida: mock.renomearDivida, listarParcelasDivida: mock.listarParcelasDivida, registrarPagamentoParcela: mock.registrarPagamentoParcela, arquivarDivida: mock.arquivarDivida, reativarDivida: mock.reativarDivida, excluirDivida: mock.excluirDivida }))
vi.mock('../lib/contas', async (o) => ({ ...(await o<typeof import('../lib/contas')>()), listarContas: mock.listarContas }))
vi.mock('../lib/categorias', async (o) => ({ ...(await o<typeof import('../lib/categorias')>()), listarCategorias: mock.listarCategorias }))

import Dividas from './Dividas'
import type { Cents } from '../lib/format'

const c = (n: number) => n as Cents

const ativas = () => [
  { id: 'd1', nome: 'Financiamento do imóvel', tipo: 'financing', saldo: c(25000000), compromissos: c(0), ativa: true, taxaMensalBps: 90, pagamentoMinimo: c(250000) },
  { id: 'd2', nome: 'Empréstimo pessoal', tipo: 'loan', saldo: c(500000), compromissos: c(0), ativa: true, taxaMensalBps: 200, pagamentoMinimo: c(50000) },
]
const quitada = { id: 'd9', nome: 'Consignado antigo', tipo: 'loan', saldo: c(0), compromissos: c(0), ativa: false, taxaMensalBps: 0, pagamentoMinimo: c(0) }
// a tela lê duas listas: ativas (padrão) e arquivadas
const porSituacao = (lista: unknown[], arquivadas: unknown[] = []) =>
  (_f: string, _d: string, situacao = 'ativas') => Promise.resolve(situacao === 'arquivadas' ? arquivadas : lista)

beforeEach(() => {
  mock.listarDividas.mockImplementation(porSituacao(ativas()))
  mock.arquivarDivida.mockResolvedValue(undefined)
  mock.reativarDivida.mockResolvedValue(undefined)
  mock.excluirDivida.mockResolvedValue(undefined)
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
    mock.listarDividas.mockImplementation(porSituacao([
      { id: 'd1', nome: 'Financiamenyo', tipo: 'financing', saldo: c(25000000), compromissos: c(0), ativa: true, taxaMensalBps: 90, pagamentoMinimo: c(250000) },
    ]))
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
  it('arquivar: confirma dentro do card da própria dívida e recarrega a lista', async () => {
    render(<Dividas />)
    await userEvent.click(await screen.findByRole('button', { name: 'Arquivar Empréstimo pessoal' }))
    const painel = screen.getByRole('group', { name: 'Arquivar Empréstimo pessoal' })
    expect(painel.closest('li')).toBe(screen.getByRole('button', { name: 'Arquivar Empréstimo pessoal' }).closest('li'))
    const antes = mock.listarDividas.mock.calls.length
    await userEvent.click(within(painel).getByRole('button', { name: 'Arquivar dívida' }))
    expect(mock.arquivarDivida).toHaveBeenCalledWith('d2')
    await vi.waitFor(() => expect(mock.listarDividas.mock.calls.length).toBeGreaterThan(antes))
  })

  it('arquivar com saldo: a recusa do banco aparece no próprio card, não no topo da página', async () => {
    mock.arquivarDivida.mockRejectedValue({ code: '23514', message: 'tem saldo ou parcelas a vencer: quite ou cancele antes de arquivar' })
    render(<Dividas />)
    await userEvent.click(await screen.findByRole('button', { name: 'Arquivar Financiamento do imóvel' }))
    const painel = screen.getByRole('group', { name: 'Arquivar Financiamento do imóvel' })
    await userEvent.click(within(painel).getByRole('button', { name: 'Arquivar dívida' }))
    expect(await within(painel).findByText(/quite ou cancele antes de arquivar/)).toBeTruthy()
  })

  it('excluir chama o banco com a dívida certa', async () => {
    render(<Dividas />)
    await userEvent.click(await screen.findByRole('button', { name: 'Excluir Financiamento do imóvel' }))
    await userEvent.click(within(screen.getByRole('group', { name: 'Excluir Financiamento do imóvel' })).getByRole('button', { name: 'Excluir dívida' }))
    expect(mock.excluirDivida).toHaveBeenCalledWith('d1')
  })

  it('arquivadas aparecem em seção própria, com Reativar', async () => {
    mock.listarDividas.mockImplementation(porSituacao(ativas(), [quitada]))
    render(<Dividas />)
    const secao = (await screen.findByRole('heading', { name: 'Arquivadas' })).closest('section')!
    expect(within(secao).getByText('Consignado antigo')).toBeTruthy()
    expect(within(secao).queryByText('Empréstimo pessoal')).toBeNull()
    await userEvent.click(within(secao).getByRole('button', { name: 'Reativar Consignado antigo' }))
    expect(mock.reativarDivida).toHaveBeenCalledWith('d9')
  })

  it('só com dívidas arquivadas: a seção aparece mesmo sem nenhuma ativa', async () => {
    mock.listarDividas.mockImplementation(porSituacao([], [quitada]))
    render(<Dividas />)
    expect(await screen.findByRole('heading', { name: 'Arquivadas' })).toBeTruthy()
  })
  it('vindo de Lançamentos (?baixar=), abre a baixa da parcela; a agenda inclui as vencidas e as marca', async () => {
    mock.listarParcelasDivida.mockResolvedValue([
      { id: 'p1', dividaId: 'd2', nomeDivida: 'Empréstimo pessoal', numero: 1, vencimento: '2026-01-05', valor: c(56000), formaPagamento: 'boleto', contaPagamentoId: null },
    ])
    window.history.pushState(null, '', '/dividas?baixar=p1')
    render(<Dividas />)
    expect(await screen.findByRole('heading', { name: 'Baixar parcela: Empréstimo pessoal' })).toBeTruthy()
    expect(screen.getByText('Vencida ·')).toBeTruthy()
    expect(window.location.search).toBe('')
    expect(mock.listarParcelasDivida.mock.calls[0][1]).toBe('2000-01-01')
  })
})
