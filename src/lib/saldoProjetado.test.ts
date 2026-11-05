import { beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => {
  const estado = { chamadas: [] as { nome: string; args: Record<string, unknown> }[], respostas: {} as Record<string, { data: unknown; error: unknown }> }
  return {
    estado,
    supabase: {
      rpc: (nome: string, args: Record<string, unknown>) => {
        estado.chamadas.push({ nome, args })
        return Promise.resolve(estado.respostas[args.p_as_of as string] ?? { data: [], error: null })
      },
    },
  }
})
vi.mock('./supabase', () => ({ supabase: fake.supabase }))

import { saldosNasDatas } from './saldoProjetado'

beforeEach(() => {
  fake.estado.chamadas = []
  fake.estado.respostas = {}
})

describe('saldosNasDatas', () => {
  it('uma chamada a balance_totals_projected por data, e devolve o total do banco em centavos, na mesma ordem', async () => {
    fake.estado.respostas = {
      '2026-09-30': { data: [{ total: '1234.56' }], error: null },
      '2026-10-31': { data: [{ total: -50.1 }], error: null },
    }
    const r = await saldosNasDatas('h1', ['2026-09-30', '2026-10-31'], true)
    expect(r).toEqual([123456, -5010])
    expect(fake.estado.chamadas).toEqual([
      { nome: 'balance_totals_projected', args: { p_household: 'h1', p_as_of: '2026-09-30', p_include_planned: true } },
      { nome: 'balance_totals_projected', args: { p_household: 'h1', p_as_of: '2026-10-31', p_include_planned: true } },
    ])
  })

  it('uma data com erro derruba a lista toda (sem buraco falso na coluna)', async () => {
    fake.estado.respostas = { '2026-10-31': { data: null, error: { message: 'falhou' } } }
    await expect(saldosNasDatas('h1', ['2026-09-30', '2026-10-31'], false)).rejects.toMatchObject({ message: 'falhou' })
  })
})
