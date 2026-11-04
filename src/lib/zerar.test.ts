import { describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({ supabase: { rpc } }))

import { previaZerar, totalDaPrevia, zerarTudo } from './zerar'

describe('zerar: contagens da prévia e do reset (migration 054)', () => {
  it('lê as chaves de investimentos, bens e agenda do contrato e as soma no total de itens', async () => {
    rpc.mockResolvedValue({
      data: {
        transactions: 0, accounts: 0, debts: 0, installments: 0, events: 0, recurrences: 0, reconciliations: 0, budgets: 0,
        schedule: 3, investment_assets: 1, investment_operations: 2, investment_valuations: 1, investment_distributions: 1,
        family_assets: 1, family_asset_valuations: 2,
      },
      error: null,
    })
    const p = await previaZerar('h1')
    expect(rpc).toHaveBeenCalledWith('reset_preview', { p_household: 'h1' })
    expect(p).toMatchObject({
      agendaContrato: 3, ativosInvestimento: 1, operacoesInvestimento: 2, avaliacoesInvestimento: 1, proventos: 1, bens: 1, avaliacoesBens: 2,
    })
    // família só com investimento e bem ainda tem o que zerar
    expect(totalDaPrevia(p)).toBe(11)
  })

  it('banco ainda sem a migration 054 (chaves ausentes): as novas contam 0, sem quebrar', async () => {
    rpc.mockResolvedValue({ data: { transactions: 2, accounts: 1 }, error: null })
    const p = await zerarTudo('h1', 'zerar tudo')
    expect(rpc).toHaveBeenCalledWith('reset_household', { p_household: 'h1', p_confirmation: 'zerar tudo' })
    expect(p.bens).toBe(0)
    expect(totalDaPrevia(p)).toBe(3)
  })
})
