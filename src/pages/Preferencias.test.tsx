// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const mock = vi.hoisted(() => ({
  familia: { id: 'h1', nome: 'Casa', papel: 'owner' as 'owner' | 'member' },
  sessao: { user: { id: 'u1', email: 'joao@exemplo.com', user_metadata: { name: 'João' } } },
  maybeSingle: vi.fn(),
  upsert: vi.fn(),
  rpc: vi.fn(),
  invoke: vi.fn(),
  signOut: vi.fn(),
  from: vi.fn(),
}))

vi.mock('../lib/auth', () => ({ useAuth: () => ({ sessao: mock.sessao, carregando: false }) }))
vi.mock('../lib/FamiliaContext', () => ({ useFamilia: () => ({ familia: mock.familia, carregando: false, erro: false }) }))
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: mock.from,
    rpc: mock.rpc,
    functions: { invoke: mock.invoke },
    auth: { signOut: mock.signOut },
  },
}))

import Preferencias from './Preferencias'

function montar() {
  return render(<MemoryRouter><Preferencias /></MemoryRouter>)
}

beforeEach(() => {
  mock.familia = { id: 'h1', nome: 'Casa', papel: 'owner' }
  mock.maybeSingle.mockResolvedValue({ data: null, error: null })
  mock.upsert.mockResolvedValue({ error: null })
  mock.rpc.mockResolvedValue({ data: { transactions_deleted: 0, investment_distributions_deleted: 0 }, error: null })
  mock.invoke.mockResolvedValue({ data: { success: true }, error: null })
  mock.signOut.mockResolvedValue({ error: null })
  mock.from.mockImplementation(() => ({
    select: () => ({ eq: () => ({ maybeSingle: mock.maybeSingle }) }),
    upsert: mock.upsert,
  }))
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Preferências', () => {
  it('persiste as escolhas individuais do usuário', async () => {
    const u = userEvent.setup()
    montar()
    await screen.findByRole('button', { name: 'Salvar alterações' })
    await u.click(screen.getByRole('radio', { name: 'Crescente' }))
    await u.click(screen.getByRole('radio', { name: 'Semanal' }))
    await u.click(screen.getByRole('radio', { name: 'Não' }))
    await u.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() => expect(mock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'u1',
        ordem_lancamentos: 'asc',
        periodo_padrao: 'weekly',
        saldo_diario: false,
      }),
      { onConflict: 'user_id' },
    ))
  })

  it('só habilita a exclusão da conta depois das duas confirmações', async () => {
    const u = userEvent.setup()
    montar()
    await screen.findByRole('button', { name: 'Salvar alterações' })
    await u.click(screen.getByRole('button', { name: 'Excluir conta por completo' }))
    expect(screen.getByRole('heading', { name: /Você está prestes a excluir a sua conta: João/ })).toBeTruthy()
    const continuar = screen.getByRole('button', { name: 'Continuar' })
    const caixas = screen.getAllByRole('checkbox')
    expect(caixas).toHaveLength(2)
    expect((continuar as HTMLButtonElement).disabled).toBe(true)
    await u.click(caixas[0])
    expect(continuar).toBeDisabled()
    await u.click(caixas[1])
    expect((continuar as HTMLButtonElement).disabled).toBe(false)
  })

  it('exige a frase exata para limpar lançamentos e preserva o escopo da família', async () => {
    const u = userEvent.setup()
    montar()
    await screen.findByRole('button', { name: 'Salvar alterações' })
    await u.click(screen.getByRole('button', { name: 'Excluir minhas transações' }))
    const excluir = screen.getByRole('button', { name: 'Excluir lançamentos' })
    expect((excluir as HTMLButtonElement).disabled).toBe(true)
    await u.type(screen.getByLabelText(/Para confirmar, escreva/), 'excluir transações')
    expect((excluir as HTMLButtonElement).disabled).toBe(false)
    await u.click(excluir)
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith('clear_household_transactions', {
      p_household: 'h1',
      p_confirmation: 'excluir transações',
    }))
  })

  it('não permite que um membro comum limpe as transações da família', async () => {
    mock.familia = { id: 'h1', nome: 'Casa', papel: 'member' }
    montar()
    await screen.findByRole('button', { name: 'Salvar alterações' })
    expect((screen.getByRole('button', { name: 'Excluir minhas transações' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
