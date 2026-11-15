// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const mock = vi.hoisted(() => ({ listarReservas: vi.fn() }))
vi.mock('../lib/FamiliaContext', () => ({
  useFamilia: () => ({ familia: { id: 'h1', nome: 'Casa', papel: 'owner' }, carregando: false, erro: false, recarregar: vi.fn() }),
}))
vi.mock('../lib/reservas', async (o) => ({ ...(await o<typeof import('../lib/reservas')>()), listarReservas: mock.listarReservas }))

import Reservas from './Reservas'

const montar = () => render(<MemoryRouter><Reservas /></MemoryRouter>)
beforeEach(() => { mock.listarReservas.mockReset() })
afterEach(cleanup)

describe('Reservas: erro de consulta não pode parecer "nenhuma reserva" (auditoria do agente melhorias, 15/11/2026)', () => {
  it('a consulta falha: aparece o aviso de indisponível e NÃO "Nenhuma reserva criada" nem "Crie uma reserva para começar"', async () => {
    mock.listarReservas.mockRejectedValue(new Error('sem rede'))
    montar()
    expect(await screen.findByTestId('reservas-indisponiveis')).toBeTruthy()
    expect(screen.queryByText('Nenhuma reserva criada')).toBeNull()
    expect(screen.queryByText(/Crie uma reserva para começar/)).toBeNull()
  })

  it('a tela fala só em "reservas", nunca em "envelopes" (nome decidido pelo dono)', async () => {
    mock.listarReservas.mockResolvedValue([])
    const { container } = montar()
    expect(await screen.findByText('Nenhuma reserva criada')).toBeTruthy()
    expect(screen.getByText('Suas reservas')).toBeTruthy()
    expect(container.textContent ?? '').not.toMatch(/envelope/i)
    expect(document.body.innerHTML).not.toMatch(/envelope/i)
  })
  it('a consulta dá certo e vem vazia: aí sim "Nenhuma reserva criada"', async () => {
    mock.listarReservas.mockResolvedValue([])
    montar()
    expect(await screen.findByText('Nenhuma reserva criada')).toBeTruthy()
    expect(screen.queryByTestId('reservas-indisponiveis')).toBeNull()
  })

  it('falha e depois Atualizar funciona: o aviso some e a lista aparece', async () => {
    mock.listarReservas.mockRejectedValueOnce(new Error('sem rede')).mockResolvedValue([])
    montar()
    expect(await screen.findByTestId('reservas-indisponiveis')).toBeTruthy()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Atualizar' }))
    expect(await screen.findByText('Nenhuma reserva criada')).toBeTruthy()
    expect(screen.queryByTestId('reservas-indisponiveis')).toBeNull()
  })
})
