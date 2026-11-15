// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const mock = vi.hoisted(() => ({ listarBens: vi.fn() }))
vi.mock('../lib/FamiliaContext', () => ({
  useFamilia: () => ({ familia: { id: 'h1', nome: 'Casa', papel: 'owner' }, carregando: false, erro: false, recarregar: vi.fn() }),
}))
vi.mock('../lib/bens', async (o) => ({ ...(await o<typeof import('../lib/bens')>()), listarBens: mock.listarBens }))

import Bens from './Bens'

const montar = () => render(<MemoryRouter><Bens /></MemoryRouter>)
beforeEach(() => { mock.listarBens.mockReset() })
afterEach(cleanup)

describe('Bens: erro de consulta não pode parecer "nenhum bem cadastrado" (auditoria do agente melhorias, 15/11/2026)', () => {
  it('a consulta falha: aviso de indisponível com "Tentar de novo" e SEM "Nenhum bem cadastrado" nem "Cadastrar primeiro bem"', async () => {
    mock.listarBens.mockRejectedValue(new Error('sem rede'))
    montar()
    expect(await screen.findByTestId('bens-indisponiveis')).toBeTruthy()
    expect(screen.queryByText('Nenhum bem cadastrado')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Cadastrar primeiro bem' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeTruthy()
  })

  it('a consulta dá certo e vem vazia: aí sim "Nenhum bem cadastrado"', async () => {
    mock.listarBens.mockResolvedValue([])
    montar()
    expect(await screen.findByText('Nenhum bem cadastrado')).toBeTruthy()
    expect(screen.queryByTestId('bens-indisponiveis')).toBeNull()
  })

  it('falha e depois "Tentar de novo" funciona', async () => {
    mock.listarBens.mockRejectedValueOnce(new Error('sem rede')).mockResolvedValue([])
    montar()
    expect(await screen.findByTestId('bens-indisponiveis')).toBeTruthy()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByText('Nenhum bem cadastrado')).toBeTruthy()
    expect(screen.queryByTestId('bens-indisponiveis')).toBeNull()
  })
})
