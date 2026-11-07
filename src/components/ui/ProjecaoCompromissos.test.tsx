// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { Cents } from '../../lib/format'

const mock = vi.hoisted(() => ({ carregar: vi.fn() }))
vi.mock('../../lib/projecaoCompromissos', () => ({
  carregarProjecaoCompromissos: mock.carregar,
}))

import { ProjecaoCompromissos } from './ProjecaoCompromissos'

const c = (n: number) => n as Cents
const linha = (overrides: Partial<{
  id: string | null
  descricao: string
  origem: string | null
  tipoOrigem: string
  mes: string
  moeda: string
  valor: Cents
  tipoLinha: 'item' | 'total'
}> = {}) => ({
  id: 'seguro-auto',
  descricao: 'Seguro auto',
  origem: 'Itaú',
  tipoOrigem: 'Conta',
  mes: '2026-11',
  moeda: 'BRL',
  valor: c(25000),
  tipoLinha: 'item' as const,
  ...overrides,
})

beforeEach(() => {
  mock.carregar.mockResolvedValue([
    linha(),
    linha({ mes: '2026-12', valor: c(25000) }),
    linha({ id: 'celular', descricao: 'Celular 8/12', origem: 'Nubank', tipoOrigem: 'Cartão', mes: '2026-11', valor: c(18990) }),
    linha({ id: null, descricao: 'Total do mês', origem: null, tipoOrigem: 'total', mes: '2026-11', valor: c(43990), tipoLinha: 'total' }),
    linha({ id: null, descricao: 'Total do mês', origem: null, tipoOrigem: 'total', mes: '2026-12', valor: c(25000), tipoLinha: 'total' }),
  ])
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Projeção de compromissos', () => {
  it('mostra despesas, origem, meses e totais fornecidos pelo banco', async () => {
    render(<ProjecaoCompromissos familiaId="h1" hoje="2026-11-07" />)

    expect(await screen.findByText('Seguro auto')).toBeTruthy()
    expect(screen.getByText('Conta · Itaú')).toBeTruthy()
    expect(screen.getByText('Cartão · Nubank')).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Nov 26' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Abr 27' })).toBeTruthy()

    const linhaSeguro = screen.getByText('Seguro auto').closest('tr')!
    expect(within(linhaSeguro).getAllByText('R$ 250,00')).toHaveLength(2)
    expect(within(linhaSeguro).getAllByText('-')).toHaveLength(4)

    expect(screen.getByText(/Total do mês/)).toBeTruthy()
    expect(screen.getByText('R$ 439,90')).toBeTruthy()
    expect(mock.carregar).toHaveBeenCalledWith('h1', '2026-11-07', 6)
  })

  it('permite compactar para três meses sem nova consulta', async () => {
    render(<ProjecaoCompromissos familiaId="h1" hoje="2026-11-07" />)
    await screen.findByText('Seguro auto')

    fireEvent.click(screen.getByRole('button', { name: '3 meses' }))

    expect(screen.getByRole('columnheader', { name: 'Nov 26' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Jan 27' })).toBeTruthy()
    expect(screen.queryByRole('columnheader', { name: 'Fev 27' })).toBeNull()
    expect(mock.carregar).toHaveBeenCalledTimes(1)
  })

  it('mostra estado vazio quando não existem compromissos', async () => {
    mock.carregar.mockResolvedValueOnce([])
    render(<ProjecaoCompromissos familiaId="h1" hoje="2026-11-07" />)

    expect(await screen.findByText('Nenhum compromisso previsto nos próximos 6 meses.')).toBeTruthy()
  })

  it('informa indisponibilidade sem esconder silenciosamente a falha', async () => {
    mock.carregar.mockRejectedValueOnce(new Error('indisponível'))
    render(<ProjecaoCompromissos familiaId="h1" hoje="2026-11-07" />)

    expect(await screen.findByText('Não foi possível concluir agora. Tente de novo em instantes.')).toBeTruthy()
  })
})
