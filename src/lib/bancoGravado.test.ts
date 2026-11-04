import { beforeEach, describe, expect, it, vi } from 'vitest'

// banco de mentira: ainda sem a migration 017 (faltam bank, issuer e brand) ou já com ela
const fake = vi.hoisted(() => {
  const e = { migration017: false, migration024: false, migration055: false, selects: [] as { tabela: string; colunas: string }[] }
  function from(tabela: string) {
    let colunas = ''
    const b: Record<string, unknown> = {}
    for (const op of ['select', 'eq', 'order']) {
      b[op] = (...args: unknown[]) => { if (op === 'select') { colunas = String(args[0]); e.selects.push({ tabela, colunas }) } return b }
    }
    b.then = (ok: (r: unknown) => unknown) => {
      const novas = /\b(bank|issuer|brand)\b/.test(colunas)
      // a 024 (pay_account_id) vem depois da 017: o banco pode ter uma e não a outra
      if (/\bpay_account_id\b/.test(colunas) && !e.migration024) return Promise.resolve(ok({ data: null, error: { code: '42703', message: 'column does not exist' } }))
      if (novas && !e.migration017) return Promise.resolve(ok({ data: null, error: { code: '42703', message: 'column does not exist' } }))
      // a 055 (currency_code) vem depois da 017
      const moeda = /\bcurrency_code\b/.test(colunas)
      if (moeda && !e.migration055) return Promise.resolve(ok({ data: null, error: { code: '42703', message: 'column does not exist' } }))
      const linha = tabela === 'accounts'
        ? { id: 'a1', name: 'Corrente', type: 'checking', initial_balance: '0.00', opening_date: '2026-01-01', active: true, ...(novas ? { bank: 'caixa' } : {}), ...(moeda ? { currency_code: 'USD' } : {}) }
        : { id: 'k1', name: 'Cartão principal', closing_day: 17, due_day: 25, active: true, ...(novas ? { issuer: 'nubank', brand: 'mastercard' } : {}), ...(/\bpay_account_id\b/.test(colunas) ? { pay_account_id: 'a1' } : {}) }
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
  fake.e.migration024 = false
  fake.e.migration055 = false
  fake.e.selects = []
})

describe('antes da migration 017 (colunas novas inexistentes)', () => {
  it('Contas lê sem a coluna do banco e a tela continua funcionando', async () => {
    const r = await listarContas('h1', '2026-10-29')
    expect(r.contas).toHaveLength(1)
    expect(r.contas[0]).toMatchObject({ nome: 'Corrente', banco: null, moeda: 'BRL' })
    const colunas = fake.e.selects.filter((s) => s.tabela === 'accounts').map((s) => s.colunas)
    expect(colunas).toHaveLength(3)
    expect(colunas[0]).toMatch(/bank.*currency_code/)
    expect(colunas[1]).toContain('bank')
    expect(colunas[1]).not.toContain('currency_code')
    expect(colunas[2]).not.toMatch(/bank|currency_code/)
  })

  it('Contas com a 017 mas sem a 055 lê o banco e trata tudo como BRL', async () => {
    fake.e.migration017 = true
    const r = await listarContas('h1', '2026-10-29')
    expect(r.contas[0]).toMatchObject({ banco: 'caixa', moeda: 'BRL' })
    expect(fake.e.selects.filter((s) => s.tabela === 'accounts')).toHaveLength(2)
  })

  it('Contas com a 055 lê a moeda da conta', async () => {
    fake.e.migration017 = true
    fake.e.migration055 = true
    const r = await listarContas('h1', '2026-10-29')
    expect(r.contas[0]).toMatchObject({ banco: 'caixa', moeda: 'USD' })
    expect(fake.e.selects.filter((s) => s.tabela === 'accounts')).toHaveLength(1)
  })

  it('Cartões lê sem emissor e bandeira', async () => {
    const r = await listarCartoes('h1', '2026-10-29')
    expect(r[0]).toMatchObject({ nome: 'Cartão principal', emissor: null, bandeira: null, contaPagamentoId: null, fechamento: 17 })
    const colunas = fake.e.selects.filter((s) => s.tabela === 'debts').map((s) => s.colunas)
    expect(colunas).toHaveLength(3)
    expect(colunas[2]).not.toMatch(/issuer|brand|pay_account_id/)
  })

  it('Cartões com a 017 mas sem a 024 lê emissor e bandeira, sem a conta de pagamento', async () => {
    fake.e.migration017 = true
    const r = await listarCartoes('h1', '2026-10-29')
    expect(r[0]).toMatchObject({ emissor: 'nubank', bandeira: 'mastercard', contaPagamentoId: null })
    const colunas = fake.e.selects.filter((s) => s.tabela === 'debts').map((s) => s.colunas)
    expect(colunas).toHaveLength(2)
    expect(colunas[0]).toContain('pay_account_id')
    expect(colunas[1]).not.toContain('pay_account_id')
  })

  it('Cartões com a 024 lê a conta de pagamento', async () => {
    fake.e.migration017 = true
    fake.e.migration024 = true
    const r = await listarCartoes('h1', '2026-10-29')
    expect(r[0]).toMatchObject({ contaPagamentoId: 'a1' })
    expect(fake.e.selects.filter((s) => s.tabela === 'debts')).toHaveLength(1)
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
  it('Contas e Cartões trazem o banco, o emissor e a bandeira numa consulta só (banco já com a 055)', async () => {
    fake.e.migration017 = true
    fake.e.migration024 = true
    fake.e.migration055 = true
    const contas = await listarContas('h1', '2026-10-29')
    const cartoes = await listarCartoes('h1', '2026-10-29')
    expect(contas.contas[0].banco).toBe('caixa')
    expect(cartoes[0]).toMatchObject({ emissor: 'nubank', bandeira: 'mastercard' })
    expect(fake.e.selects).toHaveLength(2)
  })
})
