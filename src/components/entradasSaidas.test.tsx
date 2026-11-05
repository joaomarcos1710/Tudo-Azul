// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mock = vi.hoisted(() => ({
  fluxoDeCaixa: vi.fn(),
  listarContas: vi.fn(),
  listarMembros: vi.fn(),
  resumoPorMoeda: vi.fn(),
}))
vi.mock('../lib/FamiliaContext', () => ({
  useFamilia: () => ({ familia: { id: 'h1', nome: 'Casa', papel: 'owner' }, carregando: false, erro: false, recarregar: vi.fn() }),
}))
vi.mock('../lib/fluxoCaixa', async (o) => ({ ...(await o<typeof import('../lib/fluxoCaixa')>()), fluxoDeCaixa: mock.fluxoDeCaixa }))
vi.mock('../lib/contas', async (o) => ({ ...(await o<typeof import('../lib/contas')>()), listarContas: mock.listarContas }))
vi.mock('../lib/familia', async (o) => ({ ...(await o<typeof import('../lib/familia')>()), listarMembros: mock.listarMembros }))
vi.mock('../lib/lancamentos', async (o) => ({ ...(await o<typeof import('../lib/lancamentos')>()), resumoPorMoeda: mock.resumoPorMoeda }))

import { EntradasSaidas } from './EntradasSaidas'
import { periodoDoFluxo } from '../lib/fluxoCaixa'
import type { Cents } from '../lib/format'

const c = (n: number) => n as Cents
const ultimaChamada = () => mock.fluxoDeCaixa.mock.calls[mock.fluxoDeCaixa.mock.calls.length - 1]

const fluxo = {
  linhas: [
    { inicio: '2026-09-01', entradas: c(100000), saidas: c(40000), saldo: c(60000), acumulado: c(60000) },
    { inicio: '2026-10-01', entradas: c(50000), saidas: c(70000), saldo: c(-20000), acumulado: c(40000) },
  ],
  totalEntradas: c(150000),
  totalSaidas: c(110000),
}

beforeEach(() => {
  mock.fluxoDeCaixa.mockResolvedValue(fluxo)
  mock.listarContas.mockResolvedValue({ contas: [
    { id: 'a1', nome: 'Banco', ativa: true }, { id: 'a2', nome: 'Carteira', ativa: false },
  ], total: c(0) })
  mock.listarMembros.mockResolvedValue([{ userId: 'u1', nome: 'João', papel: 'owner' }, { userId: 'u2', nome: 'Ana', papel: 'member' }])
  mock.resumoPorMoeda.mockResolvedValue([])
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('periodoDoFluxo', () => {
  it('diário e semanal: o mês escolhido; mensal: 12 meses que terminam nele', () => {
    expect(periodoDoFluxo('2026-02', 'day')).toEqual(['2026-02-01', '2026-02-28'])
    expect(periodoDoFluxo('2026-02', 'week')).toEqual(['2026-02-01', '2026-02-28'])
    expect(periodoDoFluxo('2026-10', 'month')).toEqual(['2025-11-01', '2026-10-31'])
  })
})

describe('Entradas x Saídas', () => {
  it('mostra os valores e os totais exatamente como o banco devolveu (o front não soma)', async () => {
    render(<EntradasSaidas />)
    const tabela = await screen.findByRole('table')
    const linhaTotal = within(tabela).getByText('Total do período').closest('tr') as HTMLElement
    expect(linhaTotal.textContent).toMatch(/1\.500,00/)
    expect(linhaTotal.textContent).toMatch(/1\.100,00/)
    expect(linhaTotal.textContent).toMatch(/400,00/) // o último acumulado, não uma subtração feita no front
    expect(within(tabela).getByText('Setembro de 2026')).toBeTruthy()
    expect(within(tabela).getByText('Outubro de 2026')).toBeTruthy()
  })

  it('pede ao banco o mensal por padrão, sem filtros', async () => {
    render(<EntradasSaidas />)
    await screen.findByRole('table')
    const [fam, de, ate, passo, filtros] = mock.fluxoDeCaixa.mock.calls[0]
    expect(fam).toBe('h1')
    expect(passo).toBe('month')
    expect(de < ate).toBe(true)
    expect(filtros).toEqual({ contas: [], membro: '', incluirNaoPagos: false })
  })

  it('trocar para semanal e marcar conta, autor e não pagos refaz a consulta com os filtros', async () => {
    const u = userEvent.setup()
    render(<EntradasSaidas />)
    await screen.findByRole('table')
    await u.click(screen.getByRole('button', { name: 'Semanal' }))
    await u.click(screen.getByLabelText('Banco'))
    await u.selectOptions(screen.getByLabelText('Lançado por'), 'u2')
    await u.click(screen.getByLabelText('Considerar não pagos'))
    const ultima = ultimaChamada()
    expect(ultima[3]).toBe('week')
    expect(ultima[4]).toEqual({ contas: ['a1'], membro: 'u2', incluirNaoPagos: true })
  })

  it('avisa o que fica de fora quando se filtra por conta, e por autor com não pagos', async () => {
    const u = userEvent.setup()
    render(<EntradasSaidas />)
    await screen.findByRole('table')
    expect(screen.queryByText(/não têm conta/)).toBeNull()
    await u.click(screen.getByLabelText('Banco'))
    expect(screen.getByText(/não têm conta/)).toBeTruthy()
    expect(screen.queryByText(/não têm autor/)).toBeNull()
    await u.click(screen.getByLabelText('Considerar não pagos'))
    await u.selectOptions(screen.getByLabelText('Lançado por'), 'u1')
    expect(screen.getByText(/não têm autor/)).toBeTruthy()
  })

  it('navegar de mês refaz a consulta para outro período', async () => {
    const u = userEvent.setup()
    render(<EntradasSaidas />)
    await screen.findByRole('table')
    const antes = ultimaChamada()[2]
    await u.click(screen.getByRole('button', { name: 'Mês anterior' }))
    expect(ultimaChamada()[2] < antes).toBe(true)
  })

  it('erro do banco (ex.: migration ausente) mostra o aviso e não derruba a tela', async () => {
    mock.fluxoDeCaixa.mockRejectedValue(new Error('function public.cash_flow_report does not exist'))
    render(<EntradasSaidas />)
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('sem o filtro de membros quando a família tem uma pessoa só', async () => {
    mock.listarMembros.mockResolvedValue([{ userId: 'u1', nome: 'João', papel: 'owner' }])
    render(<EntradasSaidas />)
    await screen.findByRole('table')
    expect(screen.queryByLabelText('Lançado por')).toBeNull()
  })

  it('trocar o filtro tira a tabela antiga enquanto o número novo não chega', async () => {
    const u = userEvent.setup()
    render(<EntradasSaidas />)
    expect((await screen.findAllByText('R$ 1.500,00')).length).toBeGreaterThan(0)
    mock.fluxoDeCaixa.mockReturnValueOnce(new Promise(() => {}))
    await u.selectOptions(screen.getByLabelText('Lançado por'), 'u2')
    expect(screen.getByRole('status').textContent).toMatch(/Carregando/)
    expect(screen.queryByText('R$ 1.500,00')).toBeNull()
  })

  it('no celular, cada período é um cartão (sem rolar para o lado)', async () => {
    render(<EntradasSaidas />)
    const lista = await screen.findByRole('list', { name: 'Entradas e saídas por período' })
    expect(lista.className).toMatch(/sm:hidden/)
    expect(within(lista).getAllByRole('listitem')).toHaveLength(3) // 2 períodos + total
    expect(screen.getByRole('table').closest('div')!.className).toMatch(/hidden.*sm:block/)
  })
})

describe('Entradas x Saídas: multimoeda F2 (migration 056)', () => {
  it('o filtro de contas só oferece contas em reais (o relatório é em reais)', async () => {
    mock.listarContas.mockResolvedValue({ contas: [
      { id: 'a1', nome: 'Banco', ativa: true, moeda: 'BRL' }, { id: 'u1', nome: 'Conta em dólar', ativa: true, moeda: 'USD' },
    ], total: c(0) })
    render(<EntradasSaidas />)
    expect(await screen.findByRole('checkbox', { name: 'Banco' })).toBeTruthy()
    expect(screen.queryByRole('checkbox', { name: 'Conta em dólar' })).toBeNull()
  })

  it('mostra as outras moedas à parte, do banco, no mesmo período; com filtro de conta o bloco some', async () => {
    mock.resumoPorMoeda.mockResolvedValue([{ moeda: 'USD', receitas: c(100000), despesas: c(4025), resultado: c(95975) }])
    const u = userEvent.setup()
    render(<EntradasSaidas />)
    const bloco = await screen.findByRole('group', { name: 'Em outras moedas' })
    expect(bloco.textContent).toMatch(/\+US\$\s*1\.000,00/)
    expect(bloco.textContent).toMatch(/=\s*US\$\s*959,75/)
    const [de, ate] = ultimaChamada().slice(1, 3)
    expect(mock.resumoPorMoeda).toHaveBeenLastCalledWith('h1', de, ate)
    // os totais em reais continuam os do banco (cash_flow_report), sem o dólar
    expect(within(screen.getByRole('table')).getByText('Total do período').closest('tr')!.textContent).toMatch(/1\.500,00/)
    await u.click(await screen.findByRole('checkbox', { name: 'Banco' }))
    expect(screen.queryByRole('group', { name: 'Em outras moedas' })).toBeNull()
  })
})
