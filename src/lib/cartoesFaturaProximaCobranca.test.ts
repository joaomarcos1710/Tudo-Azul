import { beforeEach, describe, expect, it, vi } from 'vitest'

// "Abrir" de Recorrentes cai na fatura da próxima cobrança: o mês vem do closing_date do item agendado (banco), não de conta no app.
const fake = vi.hoisted(() => {
  const chamadas: unknown[][] = []
  const estado: { linhas: unknown[]; erro: unknown } = { linhas: [], erro: null }
  const supabase = {
    from: (tabela: string) => ({
      select: (colunas: string) => {
        chamadas.push(['select', tabela, colunas])
        const cadeia: Record<string, unknown> = {}
        for (const m of ['in', 'eq', 'order']) cadeia[m] = (...a: unknown[]) => { chamadas.push([m, ...a]); return cadeia }
        cadeia.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: estado.linhas, error: estado.erro }).then(ok)
        return cadeia
      },
    }),
  }
  return { chamadas, estado, supabase }
})
vi.mock('./supabase', () => ({ supabase: fake.supabase }))

import { faturaDaProximaCobranca } from './cartoes'

beforeEach(() => { fake.chamadas.length = 0; fake.estado.linhas = []; fake.estado.erro = null })

describe('faturaDaProximaCobranca', () => {
  it('sem assinaturas não consulta o banco', async () => {
    expect((await faturaDaProximaCobranca([])).size).toBe(0)
    expect(fake.chamadas).toEqual([])
  })
  it('pega o mês do fechamento da PRIMEIRA cobrança agendada de cada assinatura (ordem por ocorrência)', async () => {
    fake.estado.linhas = [
      { recurrence_id: 'r1', closing_date: '2026-12-17' },
      { recurrence_id: 'r2', closing_date: '2027-01-17' },
      { recurrence_id: 'r1', closing_date: '2027-01-17' },
    ]
    const mapa = await faturaDaProximaCobranca(['r1', 'r2', 'r3'])
    expect(Object.fromEntries(mapa)).toEqual({ r1: '2026-12', r2: '2027-01' })
    expect(fake.chamadas).toContainEqual(['in', 'recurrence_id', ['r1', 'r2', 'r3']])
    expect(fake.chamadas).toContainEqual(['eq', 'status', 'scheduled'])
    expect(fake.chamadas).toContainEqual(['order', 'occurrence_date'])
  })
  it('erro do banco sobe (a tela abre o cartão no mês atual)', async () => {
    fake.estado.erro = { code: '42501' }
    await expect(faturaDaProximaCobranca(['r1'])).rejects.toMatchObject({ code: '42501' })
  })
})
