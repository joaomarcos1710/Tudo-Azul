// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({ supabase: { rpc } }))

import { despesasPorCategoria } from './painel'
import { guardarBaseGastosCartao, lerBaseGastosCartao } from './baseGastosCartao'

beforeEach(() => {
  rpc.mockReset()
  rpc.mockResolvedValue({ data: [{ category_id: 'g1', name: 'Casa', amount: '1200.00', share: '100.0' }], error: null })
})

describe('despesasPorCategoria com a base do cartão (migration 062)', () => {
  it('base da fatura (padrão) continua em expenses_by_category, que já existe no banco', async () => {
    await despesasPorCategoria('h1', '2026-07-01', '2026-07-31', 6)
    expect(rpc).toHaveBeenCalledWith('expenses_by_category', { p_household: 'h1', p_from: '2026-07-01', p_to: '2026-07-31', p_top: 6 })
  })
  it.each(['purchase', 'installment'] as const)('base %s vai para expenses_by_category_basis com p_basis e p_top', async (base) => {
    const r = await despesasPorCategoria('h1', '2026-07-01', '2026-07-31', 6, base)
    expect(rpc).toHaveBeenCalledWith('expenses_by_category_basis', { p_household: 'h1', p_from: '2026-07-01', p_to: '2026-07-31', p_basis: base, p_top: 6 })
    expect(r).toEqual([{ categoriaId: 'g1', nome: 'Casa', valor: 120000, percentual: 100 }])
  })
  it('erro do banco sobe (a tela mostra "indisponível")', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('function does not exist') })
    await expect(despesasPorCategoria('h1', '2026-07-01', '2026-07-31', 6, 'purchase')).rejects.toThrow()
  })
})

describe('escolha guardada no aparelho', () => {
  it('padrão fatura; guarda e lê; armazenamento quebrado não derruba a tela', () => {
    window.localStorage.clear()
    expect(lerBaseGastosCartao()).toBe('invoice')
    guardarBaseGastosCartao('installment')
    expect(lerBaseGastosCartao()).toBe('installment')
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqueado') })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('bloqueado') })
    expect(lerBaseGastosCartao()).toBe('invoice')
    expect(() => guardarBaseGastosCartao('purchase')).not.toThrow()
    get.mockRestore()
    set.mockRestore()
  })
})
