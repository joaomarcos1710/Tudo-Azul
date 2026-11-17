// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { Cents } from '../lib/format'

const mock = vi.hoisted(() => ({ listarLixeira: vi.fn(), restaurarDaLixeira: vi.fn(), listarContas: vi.fn(), listarCategorias: vi.fn() }))
vi.mock('../lib/FamiliaContext', () => ({
  useFamilia: () => ({ familia: { id: 'h1', nome: 'Casa', papel: 'owner' }, carregando: false, erro: false, recarregar: vi.fn() }),
}))
vi.mock('../lib/lancamentos', async (o) => ({
  ...(await o<typeof import('../lib/lancamentos')>()), listarLixeira: mock.listarLixeira, restaurarDaLixeira: mock.restaurarDaLixeira,
}))
vi.mock('../lib/contas', async (o) => ({ ...(await o<typeof import('../lib/contas')>()), listarContas: mock.listarContas }))
vi.mock('../lib/categorias', async (o) => ({ ...(await o<typeof import('../lib/categorias')>()), listarCategorias: mock.listarCategorias }))

import Lixeira from './Lixeira'

const c = (n: number) => n as Cents
const item = (id: string, extra: Record<string, unknown> = {}) => ({
  id, tipo: 'expense', contaId: 'a1', destinoId: null, categoriaId: 'g1', descricao: 'Mercado', valor: c(18740), data: '2026-11-10',
  status: 'paid', notas: '', recorrenciaId: null, recorrente: false, excluidoEm: '2026-11-17T01:30:00Z', ...extra,
})
const montar = () => render(<MemoryRouter><Lixeira /></MemoryRouter>)

beforeEach(() => {
  mock.listarLixeira.mockResolvedValue([
    item('t1'),
    item('t2', { tipo: 'income', descricao: 'Salário', valor: c(800000), categoriaId: 'g2' }),
    item('t3', { tipo: 'transfer', descricao: 'Guardar', categoriaId: null, destinoId: 'a2', valor: c(50000) }),
  ])
  mock.restaurarDaLixeira.mockResolvedValue(undefined)
  mock.listarContas.mockResolvedValue({ contas: [
    { id: 'a1', nome: 'Itaú', tipo: 'checking', saldoInicial: c(0), abertura: '2026-01-01', ativa: true, saldo: c(0) },
    { id: 'a2', nome: 'Poupança', tipo: 'savings', saldoInicial: c(0), abertura: '2026-01-01', ativa: true, saldo: c(0) },
  ], total: c(0) })
  mock.listarCategorias.mockResolvedValue([
    { id: 'g1', nome: 'Mercado', tipo: 'expense', paiId: null, sistema: false, ativa: true, eventual: false },
    { id: 'g2', nome: 'Salário', tipo: 'income', paiId: null, sistema: false, ativa: true, eventual: false },
  ])
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('Lixeira de Lançamentos', () => {
  it('lista os excluídos com data, categoria, conta, valor com sinal e o dia da exclusão no fuso de São Paulo', async () => {
    montar()
    const lista = await screen.findByRole('list', { name: 'Lançamentos na lixeira' })
    expect(within(lista).getAllByRole('listitem')).toHaveLength(3)
    expect(within(lista).getByText('10/11/2026 · Mercado · Itaú')).toBeTruthy()
    expect(within(lista).getByText('−R$ 187,40')).toBeTruthy()
    expect(within(lista).getByText('+R$ 8.000,00')).toBeTruthy()
    expect(within(lista).getByText('10/11/2026 · Itaú → Poupança')).toBeTruthy()
    // 01:30 UTC de 17/11 é 22:30 de 16/11 em São Paulo
    expect(within(lista).getAllByText('Excluído em 16/11/2026')).toHaveLength(3)
    expect(screen.getByRole('link', { name: 'Voltar para Lançamentos' }).getAttribute('href')).toBe('/lancamentos')
  })

  it('Restaurar devolve o lançamento, tira da lista e avisa; alvo de toque de 44px', async () => {
    const u = userEvent.setup()
    montar()
    const botao = await screen.findByRole('button', { name: 'Restaurar Mercado de 10/11/2026' })
    expect(botao.className).toContain('min-h-11')
    await u.click(botao)
    expect(mock.restaurarDaLixeira).toHaveBeenCalledWith('t1')
    expect(await screen.findByText(/1 lançamento restaurado\./)).toBeTruthy()
    expect(within(screen.getByRole('list', { name: 'Lançamentos na lixeira' })).getAllByRole('listitem')).toHaveLength(2)
  })

  it('erro do banco ao restaurar (ex.: conta desativada) aparece e o item fica na lista', async () => {
    mock.restaurarDaLixeira.mockRejectedValue({ code: '23514', message: 'conta de origem desativada' })
    const u = userEvent.setup()
    montar()
    await u.click(await screen.findByRole('button', { name: 'Restaurar Mercado de 10/11/2026' }))
    expect(await screen.findByText(/desativada/i)).toBeTruthy()
    expect(within(screen.getByRole('list', { name: 'Lançamentos na lixeira' })).getAllByRole('listitem')).toHaveLength(3)
  })

  it('lixeira vazia: diz que está vazia', async () => {
    mock.listarLixeira.mockResolvedValue([])
    montar()
    expect(await screen.findByRole('heading', { name: 'A lixeira está vazia' })).toBeTruthy()
  })

  it('falha ao carregar: mostra o erro, sem lista', async () => {
    mock.listarLixeira.mockRejectedValue(new Error('rede'))
    montar()
    expect(await screen.findByRole('alert').catch(() => screen.findByText(/rede|conexão|Não foi possível/i))).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Lançamentos na lixeira' })).toBeNull()
  })
})
