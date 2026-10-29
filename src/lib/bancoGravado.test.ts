import { beforeEach, describe, expect, it, vi } from 'vitest'

// banco de mentira: ainda sem a migration 017 (faltam bank, issuer e brand) ou já com ela
const fake = vi.hoisted(() => {
  const e = { migration017: false, selects: [] as { tabela: string; colunas: string }[] }
  function from(tabela: string) {
    let colunas = ''
    const b: Record<string, unknown> = {}
    for (const op of ['select', 'eq', 'order']) {
      b[op] = (...args: unknown[]) => { if (op === 'select') { colunas = String(args[0]); e.selects.push({ tabela, colunas }) } return b }
    }
    b.then = (ok: (r: unknown) => unknown) => {
      const novas = /\b(bank|issuer|brand)\b/.test(colunas)
      if (novas && !e.migration017) return Promise.resolve(ok({ data: null, error: { code: '42703', message: 'column does not exist' } }))
      const linha = tabela === 'accounts'
        ? { id: 'a1', name: 'Corrente', type: 'checking', initial_balance: '0.00', opening_date: '2026-01-01', active: true, ...(novas ? { bank: 'caixa' } : {}) }
        : { id: 'k1', name: 'Cartão principal', closing_day: 17, due_day: 25, active: true, ...(novas ? { issuer: 'nubank', brand: 'mastercard' } : {}) }
      return Promise.resolve(ok({ data: [linha], error: null }))
    }
    return b
  }
  return { e, supabase: { from, rpc: () => Promise.resolve({ data: [], error: null }) } }
})
vi.mock('./supabase', () => ({ supabase: fake.supabase }))

import { listarCartoes } from './cartoes'
import { listarContas } from './contas'

beforeEach(() => {
  fake.e.migration017 = false
  fake.e.selects = []
})

describe('antes da migration 017 (colunas novas inexistentes)', () => {
  it('Contas lê sem a coluna do banco e a tela continua funcionando', async () => {
    const r = await listarContas('h1', '2026-10-29')
    expect(r.contas).toHaveLength(1)
    expect(r.contas[0]).toMatchObject({ nome: 'Corrente', banco: null })
    const colunas = fake.e.selects.filter((s) => s.tabela === 'accounts').map((s) => s.colunas)
    expect(colunas).toHaveLength(2)
    expect(colunas[0]).toContain('bank')
    expect(colunas[1]).not.toContain('bank')
  })

  it('Cartões lê sem emissor e bandeira', async () => {
    const r = await listarCartoes('h1', '2026-10-29')
    expect(r[0]).toMatchObject({ nome: 'Cartão principal', emissor: null, bandeira: null, fechamento: 17 })
    const colunas = fake.e.selects.filter((s) => s.tabela === 'debts').map((s) => s.colunas)
    expect(colunas).toHaveLength(2)
    expect(colunas[1]).not.toMatch(/issuer|brand/)
  })

  it('erro que não é coluna inexistente continua sendo erro', async () => {
    fake.e.migration017 = true
    const original = fake.supabase.from
    fake.supabase.from = (t: string) => {
      const b = original(t) as Record<string, unknown>
      b.then = (ok: (r: unknown) => unknown) => Promise.resolve(ok({ data: null, error: { code: '42501', message: 'sem permissão' } }))
      return b
    }
    try {
      await expect(listarContas('h1', '2026-10-29')).rejects.toMatchObject({ code: '42501' })
    } finally {
      fake.supabase.from = original
    }
  })
})

describe('com a migration 017', () => {
  it('Contas e Cartões trazem o banco, o emissor e a bandeira numa consulta só', async () => {
    fake.e.migration017 = true
    const contas = await listarContas('h1', '2026-10-29')
    const cartoes = await listarCartoes('h1', '2026-10-29')
    expect(contas.contas[0].banco).toBe('caixa')
    expect(cartoes[0]).toMatchObject({ emissor: 'nubank', bandeira: 'mastercard' })
    expect(fake.e.selects).toHaveLength(2)
  })
})
