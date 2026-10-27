// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Cents } from '../lib/format'

const mock = vi.hoisted(() => ({
  saldoNaData: vi.fn(),
  movimentosAte: vi.fn(),
  ultimasConciliacoes: vi.fn(),
  conciliar: vi.fn(),
  desfazerUltimaConciliacao: vi.fn(),
  listarContas: vi.fn(),
}))
vi.mock('../lib/FamiliaContext', () => ({
  useFamilia: () => ({ familia: { id: 'h1', nome: 'Casa', papel: 'owner' }, carregando: false, erro: false, recarregar: vi.fn() }),
}))
vi.mock('../lib/conciliacao', () => ({
  saldoNaData: mock.saldoNaData, movimentosAte: mock.movimentosAte, ultimasConciliacoes: mock.ultimasConciliacoes,
  conciliar: mock.conciliar, desfazerUltimaConciliacao: mock.desfazerUltimaConciliacao,
}))
vi.mock('../lib/contas', async (o) => ({ ...(await o<typeof import('../lib/contas')>()), listarContas: mock.listarContas }))

import Conferir from './Conferir'

const c = (n: number) => n as Cents
const montar = () => render(
  <MemoryRouter initialEntries={['/contas/a1/conferir']}>
    <Routes><Route path="/contas/:contaId/conferir" element={<Conferir />} /></Routes>
  </MemoryRouter>,
)

beforeEach(() => {
  mock.listarContas.mockResolvedValue({
    contas: [{ id: 'a1', nome: 'Itaú', tipo: 'checking', saldoInicial: c(100000), abertura: '2026-10-01', ativa: true, saldo: c(0) }],
    total: c(0),
  })
  mock.saldoNaData.mockResolvedValue(c(524960))
  mock.movimentosAte.mockResolvedValue([
    { origem: 'opening', id: 'a1', data: '2026-10-01', descricao: 'Saldo inicial', valor: c(100000), conferido: false },
    { origem: 'transaction', id: 't1', data: '2026-10-06', descricao: 'Salário', valor: c(500000), conferido: true },
    { origem: 'transaction', id: 't2', data: '2026-10-05', descricao: 'Mercado', valor: c(-25040), conferido: false },
    { origem: 'debt', id: 'e1', data: '2026-10-04', descricao: 'Pagamento de Nubank', valor: c(-10000), conferido: true },
  ])
  mock.ultimasConciliacoes.mockResolvedValue([])
  mock.conciliar.mockResolvedValue(undefined)
  mock.desfazerUltimaConciliacao.mockResolvedValue(null)
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('Conferir conta', () => {
  it('mostra o saldo do app vindo do banco e os movimentos com sinal', async () => {
    montar()
    expect(await screen.findByText('Conferir Itaú')).toBeTruthy()
    expect(screen.getByText('R$ 5.249,60')).toBeTruthy()
    expect(screen.getByText('−R$ 250,40')).toBeTruthy()
    expect(screen.getByText('+R$ 5.000,00')).toBeTruthy()
    expect(screen.getByText(/cartão\/dívida/)).toBeTruthy()
    expect(screen.getByText('Saldo inicial')).toBeTruthy()
    expect(screen.getByText('R$ 1.000,00')).toBeTruthy()
  })

  it('com diferença, não deixa concluir e mostra o valor', async () => {
    const u = userEvent.setup()
    montar()
    await screen.findByText('R$ 5.249,60')
    await u.type(screen.getByLabelText('Saldo no extrato (R$)'), '5.249,00')
    expect(screen.getByText('-R$ 0,60')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Concluir conciliação' }) as HTMLButtonElement).disabled).toBe(true)
    expect(mock.conciliar).not.toHaveBeenCalled()
  })

  it('diferença zero conclui com a data e o saldo do extrato', async () => {
    const u = userEvent.setup()
    montar()
    await screen.findByText('R$ 5.249,60')
    await u.type(screen.getByLabelText('Saldo no extrato (R$)'), '5.249,60')
    expect(screen.getByText('Zero ✓')).toBeTruthy()
    await u.click(screen.getByRole('button', { name: 'Concluir conciliação' }))
    expect(mock.conciliar).toHaveBeenCalledWith('a1', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), 524960)
    expect(await screen.findByText(/o saldo bate com o extrato/)).toBeTruthy()
  })

  it('conta conciliada: avisa a data travada e desfaz a última com confirmação', async () => {
    const u = userEvent.setup()
    mock.ultimasConciliacoes.mockResolvedValue([{ data: '2026-10-10', saldoExtrato: c(494960), lancamentos: 3, criadaEm: 'x' }])
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    montar()
    expect(await screen.findByText(/Conta conciliada até 10\/10\/2026/)).toBeTruthy()
    await u.click(screen.getByRole('button', { name: 'Desfazer a de 10/10/2026' }))
    expect(window.confirm).toHaveBeenCalled()
    expect(mock.desfazerUltimaConciliacao).toHaveBeenCalledWith('a1')
  })

  it('desfazer: dois toques seguidos durante a chamada desfazem só UMA conciliação', async () => {
    mock.ultimasConciliacoes.mockResolvedValue([
      { data: '2026-10-10', saldoExtrato: c(100000), lancamentos: 3, criadaEm: '2026-10-10T10:00:00Z' },
      { data: '2026-09-10', saldoExtrato: c(90000), lancamentos: 2, criadaEm: '2026-09-10T10:00:00Z' },
    ])
    let terminar: (v: unknown) => void = () => {}
    mock.desfazerUltimaConciliacao.mockReturnValue(new Promise((r) => { terminar = r }))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const u = userEvent.setup()
    montar()
    const botao = await screen.findByRole('button', { name: 'Desfazer a de 10/10/2026' })
    await u.click(botao)
    await u.click(screen.getByRole('button', { name: /Aguarde/ }))
    expect(mock.desfazerUltimaConciliacao).toHaveBeenCalledTimes(1)
    terminar(null)
  })
})
