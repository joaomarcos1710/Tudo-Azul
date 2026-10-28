// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { Cents } from '../lib/format'

const mock = vi.hoisted(() => ({
  listarLancamentos: vi.fn(),
  listarMovimentosDeDivida: vi.fn(),
  resumoDoMes: vi.fn(),
  listarContas: vi.fn(),
  listarCategorias: vi.fn(),
  atualizarAutomaticos: vi.fn(),
}))
vi.mock('../lib/FamiliaContext', () => ({
  useFamilia: () => ({ familia: { id: 'h1', nome: 'Casa', papel: 'owner' }, carregando: false, erro: false, recarregar: vi.fn() }),
}))
vi.mock('../lib/automaticos', () => ({ atualizarAutomaticos: mock.atualizarAutomaticos }))
vi.mock('../lib/categorias', () => ({ listarCategorias: mock.listarCategorias }))
vi.mock('../lib/contas', async (o) => ({ ...(await o<typeof import('../lib/contas')>()), listarContas: mock.listarContas }))
vi.mock('../lib/lancamentos', async (o) => ({
  ...(await o<typeof import('../lib/lancamentos')>()),
  listarLancamentos: mock.listarLancamentos, listarMovimentosDeDivida: mock.listarMovimentosDeDivida, resumoDoMes: mock.resumoDoMes,
}))

import Calendario from './Calendario'

const c = (n: number) => n as Cents
const montar = (url = '/calendario') => render(<MemoryRouter initialEntries={[url]}><Calendario /></MemoryRouter>)
const lanc = (id: string, data: string, tipo: 'income' | 'expense' | 'transfer', valor: number, status: 'paid' | 'planned', descricao: string) => ({
  id, tipo, contaId: 'a1', destinoId: tipo === 'transfer' ? 'a2' : null, categoriaId: tipo === 'transfer' ? null : 'g1',
  descricao, valor: c(valor), data, status, notas: '', recorrenciaId: null,
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-16T15:00:00Z')) // 12h de 16/10/2026 em São Paulo
  mock.atualizarAutomaticos.mockResolvedValue({ recorrentesOk: true, faturasOk: true })
  mock.listarLancamentos.mockResolvedValue([
    lanc('l1', '2026-10-05', 'income', 800000, 'paid', 'Salário'),
    lanc('l2', '2026-10-05', 'expense', 18740, 'paid', 'Conta de luz'),
    lanc('l3', '2026-10-25', 'expense', 12000, 'planned', 'Internet'),
    lanc('l4', '2026-10-12', 'transfer', 50000, 'paid', 'Guardar'),
  ])
  mock.listarMovimentosDeDivida.mockResolvedValue([
    { id: 'e1', data: '2026-10-10', contaId: 'a1', descricao: 'Pagamento de Nubank', valor: c(-133334), jaEmDespesas: false },
  ])
  mock.listarContas.mockResolvedValue({
    contas: [
      { id: 'a1', nome: 'Itaú', tipo: 'checking', saldoInicial: c(0), abertura: '2026-01-01', ativa: true, saldo: c(0) },
      { id: 'a2', nome: 'Poupança', tipo: 'savings', saldoInicial: c(0), abertura: '2026-01-01', ativa: true, saldo: c(0) },
    ],
    total: c(0),
  })
  mock.listarCategorias.mockResolvedValue([{ id: 'g1', nome: 'Moradia', tipo: 'expense', paiId: null, sistema: false, ativa: true, eventual: false }])
  mock.resumoDoMes.mockResolvedValue({ receitas: c(800000), despesas: c(18740), resultado: c(781260), receitasPrevistas: c(0), despesasPrevistas: c(12000) })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('Calendário', () => {
  it('abre no mês de hoje, com os 31 dias de outubro, hoje marcado e selecionado', async () => {
    montar()
    expect(await screen.findByRole('heading', { name: 'Outubro de 2026' })).toBeTruthy()
    const grade = screen.getByRole('group', { name: 'Dias de Outubro de 2026' })
    expect(within(grade).getAllByRole('button')).toHaveLength(31)
    const hoje = within(grade).getByRole('button', { name: /^16 de outubro de 2026, hoje: nada$/ })
    expect(hoje.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('16/10/2026 · hoje')).toBeTruthy()
    expect(screen.getByText('Nada neste dia.')).toBeTruthy()
    expect(mock.listarLancamentos).toHaveBeenCalledWith('h1', '2026-10')
  })

  it('cada dia diz quantos lançamentos e quantos planejados tem', async () => {
    montar()
    await screen.findByRole('heading', { name: 'Outubro de 2026' })
    expect(screen.getByRole('button', { name: '5 de outubro de 2026: 2 lançamentos' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '25 de outubro de 2026: 1 lançamento, 1 planejado' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '10 de outubro de 2026: 1 lançamento' })).toBeTruthy() // pagamento da fatura
    expect(screen.getByRole('button', { name: '1 de outubro de 2026: nada' })).toBeTruthy()
  })

  it('ao tocar no dia, mostra cada lançamento com o seu valor e se está pago ou planejado', async () => {
    const u = userEvent.setup()
    montar()
    await u.click(await screen.findByRole('button', { name: '5 de outubro de 2026: 2 lançamentos' }))
    expect(screen.getByText('05/10/2026')).toBeTruthy()
    const lista = screen.getByRole('list')
    expect(within(lista).getAllByRole('listitem')).toHaveLength(2)
    expect(within(lista).getByText('Salário')).toBeTruthy()
    expect(within(lista).getByText('+R$ 8.000,00')).toBeTruthy()
    expect(within(lista).getByText('Conta de luz')).toBeTruthy()
    expect(within(lista).getByText('−R$ 187,40')).toBeTruthy()
    expect(within(lista).getAllByText('Moradia · Itaú')).toHaveLength(2)
    await u.click(screen.getByRole('button', { name: '25 de outubro de 2026: 1 lançamento, 1 planejado' }))
    const lista25 = screen.getByRole('list')
    expect(within(lista25).getByText('Internet')).toBeTruthy()
    expect(within(lista25).getByText('Planejado')).toBeTruthy()
    expect(within(lista25).queryByText('Pago')).toBeNull()
  })

  it('pagamento de fatura aparece como saída da conta no dia; transferência aparece sem sinal de receita ou despesa', async () => {
    const u = userEvent.setup()
    montar()
    await u.click(await screen.findByRole('button', { name: '10 de outubro de 2026: 1 lançamento' }))
    expect(screen.getByText('Pagamento de Nubank')).toBeTruthy()
    expect(screen.getByText('−R$ 1.333,34')).toBeTruthy()
    await u.click(screen.getByRole('button', { name: '12 de outubro de 2026: 1 lançamento' }))
    expect(screen.getByText('Itaú → Poupança')).toBeTruthy()
    expect(screen.getByText('⇄ R$ 500,00')).toBeTruthy()
  })

  it('os totais do mês vêm do banco; a tela não soma nada por dia', async () => {
    const u = userEvent.setup()
    montar()
    const totais = await screen.findByRole('region', { name: 'Totais do mês' })
    expect(within(totais).getByText('+R$ 8.000,00')).toBeTruthy()
    expect(within(totais).getByText('−R$ 187,40')).toBeTruthy()
    expect(within(totais).getByText('R$ 7.812,60')).toBeTruthy()
    expect(mock.resumoDoMes).toHaveBeenCalledWith('h1', '2026-10')
    await u.click(screen.getByRole('button', { name: '5 de outubro de 2026: 2 lançamentos' }))
    // no dia 5 entram R$ 8.000,00 e saem R$ 187,40: nenhum "saldo do dia" é calculado na tela
    expect(screen.queryByText(/saldo do dia/i)).toBeNull()
    expect(screen.queryByText('R$ 7.812,60', { selector: 'li *' })).toBeNull()
  })

  it('navega entre os meses e limpa o dia escolhido fora do mês de hoje', async () => {
    const u = userEvent.setup()
    montar()
    await screen.findByRole('heading', { name: 'Outubro de 2026' })
    await u.click(screen.getByRole('button', { name: 'Próximo mês' }))
    expect(await screen.findByRole('heading', { name: 'Novembro de 2026' })).toBeTruthy()
    expect(mock.listarLancamentos).toHaveBeenLastCalledWith('h1', '2026-11')
    expect(await screen.findByText('Toque num dia para ver o que entra e sai.')).toBeTruthy()
    await u.click(screen.getByRole('button', { name: 'Mês anterior' }))
    await u.click(screen.getByRole('button', { name: 'Mês anterior' }))
    expect(await screen.findByRole('heading', { name: 'Setembro de 2026' })).toBeTruthy()
    expect(within(screen.getByRole('group', { name: 'Dias de Setembro de 2026' })).getAllByRole('button')).toHaveLength(30)
  })

  it('abre o mês pedido na URL (?mes=) e ignora valor inválido', async () => {
    montar('/calendario?mes=2028-02')
    expect(await screen.findByRole('heading', { name: 'Fevereiro de 2028' })).toBeTruthy()
    expect(within(screen.getByRole('group', { name: 'Dias de Fevereiro de 2028' })).getAllByRole('button')).toHaveLength(29) // bissexto
    cleanup()
    montar('/calendario?mes=2026-13')
    expect(await screen.findByRole('heading', { name: 'Outubro de 2026' })).toBeTruthy()
  })

  it('a semana começa na segunda: 01/10/2026 é quinta e ocupa a 4ª coluna', async () => {
    montar()
    const grade = await screen.findByRole('group', { name: 'Dias de Outubro de 2026' })
    // 7 cabeçalhos + 3 espaços vazios antes do dia 1
    const filhos = Array.from(grade.children)
    expect(filhos.slice(7, 10).every((f) => f.getAttribute('aria-hidden') === 'true' && f.textContent === '')).toBe(true)
    expect(filhos[10].getAttribute('aria-label')).toMatch(/^1 de outubro de 2026/)
  })

  it('erro do banco aparece na tela; falha só nas rotinas automáticas mostra aviso e segue', async () => {
    mock.listarLancamentos.mockRejectedValueOnce(Object.assign(new Error('x'), { code: '42501' }))
    montar()
    expect(await screen.findByText('Você não tem permissão para esta ação.')).toBeTruthy()
    cleanup()
    mock.atualizarAutomaticos.mockResolvedValueOnce({ recorrentesOk: false, faturasOk: true })
    montar()
    expect(await screen.findByText(/Não foi possível atualizar faturas e recorrentes agora/)).toBeTruthy()
    expect(await screen.findByRole('button', { name: '5 de outubro de 2026: 2 lançamentos' })).toBeTruthy()
  })

  it('resposta atrasada do mês anterior não sobrescreve o mês novo', async () => {
    const u = userEvent.setup()
    let liberar: (v: unknown) => void = () => {}
    mock.listarLancamentos
      .mockImplementationOnce(() => new Promise((r) => { liberar = r }))
      .mockResolvedValueOnce([lanc('n1', '2026-11-03', 'expense', 1000, 'paid', 'Padaria')])
    montar()
    await screen.findByRole('heading', { name: 'Outubro de 2026' })
    await u.click(screen.getByRole('button', { name: 'Próximo mês' }))
    expect(await screen.findByRole('button', { name: '3 de novembro de 2026: 1 lançamento' })).toBeTruthy()
    liberar([lanc('l9', '2026-10-05', 'income', 1, 'paid', 'Velho')])
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.getByRole('button', { name: '3 de novembro de 2026: 1 lançamento' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /de outubro de 2026/ })).toBeNull()
  })
})
