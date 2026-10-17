// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Cents } from '../lib/format'

const mock = vi.hoisted(() => ({
  carregarPatrimonio: vi.fn(),
  proximosPlanejados: vi.fn(),
  resumoDoMes: vi.fn(),
  listarContas: vi.fn(),
}))
vi.mock('../lib/FamiliaContext', () => ({
  useFamilia: () => ({ familia: { id: 'h1', nome: 'Casa', papel: 'owner' }, carregando: false, erro: false, recarregar: vi.fn() }),
}))
vi.mock('../lib/painel', () => ({ carregarPatrimonio: mock.carregarPatrimonio, proximosPlanejados: mock.proximosPlanejados }))
vi.mock('../lib/lancamentos', async (o) => ({ ...(await o<typeof import('../lib/lancamentos')>()), resumoDoMes: mock.resumoDoMes }))
vi.mock('../lib/automaticos', () => ({ atualizarAutomaticos: () => Promise.resolve() }))
vi.mock('../lib/contas', async (o) => ({ ...(await o<typeof import('../lib/contas')>()), listarContas: mock.listarContas }))

import VisaoGeral from './VisaoGeral'

const c = (n: number) => n as Cents
const montar = () => render(<MemoryRouter><VisaoGeral /></MemoryRouter>)

beforeEach(() => {
  mock.carregarPatrimonio.mockResolvedValue({ disponivel: c(5065105), creditoAReceber: c(24590), divida: c(4002135), patrimonio: c(1087560), compromissos: c(482000) })
  mock.resumoDoMes.mockResolvedValue({ receitas: c(1215000), despesas: c(866726), resultado: c(348274), receitasPrevistas: c(0), despesasPrevistas: c(38990) })
  mock.listarContas.mockResolvedValue({
    contas: [
      { id: 'a1', nome: 'Itaú', tipo: 'checking', saldoInicial: c(0), abertura: '2026-10-01', ativa: true, saldo: c(1282030) },
      { id: 'a2', nome: 'Antiga', tipo: 'checking', saldoInicial: c(0), abertura: '2026-10-01', ativa: false, saldo: c(0) },
    ],
    total: c(1282030),
  })
  mock.proximosPlanejados.mockResolvedValue([{ id: 't1', tipo: 'expense', descricao: 'Internet', valor: c(12000), data: '2026-10-20' }])
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Visão geral', () => {
  it('mostra a equação do patrimônio com os valores do banco', async () => {
    montar()
    expect(await screen.findByText('R$ 50.651,05')).toBeTruthy()
    expect(screen.getByText('R$ 245,90')).toBeTruthy()
    expect(screen.getByText('R$ 40.021,35')).toBeTruthy()
    expect(screen.getByText('R$ 10.875,60')).toBeTruthy()
    expect(screen.getByText(/Não inclui bens nem investimentos/)).toBeTruthy()
    expect(screen.getByText('R$ 4.820,00')).toBeTruthy() // compromissos à parte
  })
  it('resumo do mês, próximos planejados e só contas ativas', async () => {
    montar()
    expect(await screen.findByText('+R$ 12.150,00')).toBeTruthy()
    expect(screen.getByText('−R$ 8.667,26')).toBeTruthy()
    expect(screen.getByText(/Internet/)).toBeTruthy()
    expect(screen.getByText('Itaú')).toBeTruthy()
    expect(screen.queryByText('Antiga')).toBeNull()
  })
  it('sem compromissos, não mostra a faixa', async () => {
    mock.carregarPatrimonio.mockResolvedValue({ disponivel: c(0), creditoAReceber: c(0), divida: c(0), patrimonio: c(0), compromissos: c(0) })
    montar()
    await screen.findByText(/Não inclui bens/)
    expect(screen.queryByText(/Compromissos futuros/)).toBeNull()
  })
})
