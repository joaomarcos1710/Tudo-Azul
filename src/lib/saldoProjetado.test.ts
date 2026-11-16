import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({ supabase: { rpc } }))

import { saldoTotalProjetado } from './saldoProjetado'

const TOTAL = { realized: '1000.50', planned: '-100.00', invoices: '50.00', unassigned_invoices: '0', total: '850.50' }

beforeEach(() => { rpc.mockReset() })

describe('saldoTotalProjetado (Início e Calendário: só o total, sem o saldo de cada conta)', () => {
  it('faz UMA chamada (balance_totals_projected) e converte para centavos; não pede o saldo de cada conta', async () => {
    rpc.mockResolvedValue({ data: [TOTAL], error: null })
    const total = await saldoTotalProjetado('h1', '2026-11-30', true)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('balance_totals_projected', { p_household: 'h1', p_as_of: '2026-11-30', p_include_planned: true })
    expect(rpc).not.toHaveBeenCalledWith('account_balances_projected', expect.anything())
    expect(total).toEqual({ efetuado: 100050, planejado: -10000, faturas: 5000, faturasSemConta: 0, saldo: 85050 })
  })
  it('sem linha, devolve null; com erro, lança (a tela trata como bloco opcional)', async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null })
    expect(await saldoTotalProjetado('h1', '2026-11-30', false)).toBeNull()
    expect(rpc).toHaveBeenLastCalledWith('balance_totals_projected', { p_household: 'h1', p_as_of: '2026-11-30', p_include_planned: false })
    rpc.mockResolvedValueOnce({ data: null, error: new Error('rede') })
    await expect(saldoTotalProjetado('h1', '2026-11-30', true)).rejects.toThrow('rede')
  })
})
