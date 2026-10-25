import { beforeEach, describe, expect, it, vi } from 'vitest'

// banco de mentira: tabelas devolvem o que foi programado; guarda os filtros que a leitura aplicou
const fake = vi.hoisted(() => {
  const e = {
    tabelas: {} as Record<string, { data: unknown[]; count?: number; error?: unknown }>,
    rpc: {} as Record<string, { data: unknown; error: unknown }>,
    filtros: [] as { tabela: string; op: string; args: unknown[] }[],
  }
  function from(tabela: string) {
    const b: Record<string, unknown> = {}
    for (const op of ['select', 'eq', 'is', 'lt', 'order', 'limit']) {
      b[op] = (...args: unknown[]) => { e.filtros.push({ tabela, op, args }); return b }
    }
    b.then = (ok: (r: unknown) => unknown) => {
      const t = e.tabelas[tabela] ?? { data: [] }
      return Promise.resolve(ok({ data: t.data, count: t.count, error: t.error ?? null }))
    }
    return b
  }
  return { e, supabase: { from, rpc: (nome: string) => Promise.resolve(e.rpc[nome] ?? { data: [], error: null }) } }
})
vi.mock('./supabase', () => ({ supabase: fake.supabase }))

import { resumoDosCartoes } from './cartoes'
import { ultimasConferencias } from './conciliacao'
import { vencidosPlanejados } from './painel'

beforeEach(() => {
  fake.e.tabelas = {}
  fake.e.rpc = {}
  fake.e.filtros = []
})

describe('vencidosPlanejados', () => {
  it('pede só planejado, fora da lixeira, antes de hoje, do mais antigo para o mais novo, e devolve o total', async () => {
    fake.e.tabelas.transactions = {
      data: [{ id: 't1', type: 'expense', description: 'Luz', amount: '180.00', date: '2026-10-01' }],
      count: 4,
    }
    const r = await vencidosPlanejados('h1', '2026-10-25', 1)
    expect(r.total).toBe(4)
    expect(r.itens).toEqual([{ id: 't1', tipo: 'expense', descricao: 'Luz', valor: 18000, data: '2026-10-01' }])
    const f = fake.e.filtros.filter((x) => x.tabela === 'transactions')
    expect(f).toContainEqual({ tabela: 'transactions', op: 'eq', args: ['status', 'planned'] })
    expect(f).toContainEqual({ tabela: 'transactions', op: 'is', args: ['deleted_at', null] })
    expect(f).toContainEqual({ tabela: 'transactions', op: 'lt', args: ['date', '2026-10-25'] })
    expect(f).toContainEqual({ tabela: 'transactions', op: 'order', args: ['date'] })
    expect(f).toContainEqual({ tabela: 'transactions', op: 'limit', args: [1] })
  })

  it('sem contagem do banco, o total é o que veio', async () => {
    fake.e.tabelas.transactions = { data: [{ id: 't1', type: 'income', description: '', amount: '10.00', date: '2026-10-01' }] }
    expect((await vencidosPlanejados('h1', '2026-10-25')).total).toBe(1)
  })

  it('erro do banco sobe', async () => {
    fake.e.tabelas.transactions = { data: [], error: { message: 'rede' } }
    await expect(vencidosPlanejados('h1', '2026-10-25')).rejects.toMatchObject({ message: 'rede' })
  })
})

describe('ultimasConferencias', () => {
  it('guarda a data mais recente de cada conta; conta nunca conferida fica de fora', async () => {
    fake.e.tabelas.account_reconciliations = {
      data: [
        { account_id: 'a1', as_of: '2026-10-20' }, // já vem da mais nova para a mais antiga
        { account_id: 'a2', as_of: '2026-09-30' },
        { account_id: 'a1', as_of: '2026-09-01' },
      ],
    }
    const m = await ultimasConferencias()
    expect([...m.entries()]).toEqual([['a1', '2026-10-20'], ['a2', '2026-09-30']])
    expect(m.has('a3')).toBe(false)
  })
})

describe('resumoDosCartoes', () => {
  const cartao = (id: string, nome: string, ativo = true) => ({ id, name: nome, closing_day: 17, due_day: 25, active: ativo })

  it('fatura fechada mais antiga a pagar define o vencimento; vencida é a que já passou; cartão sem dívida não consulta faturas', async () => {
    fake.e.tabelas.debts = { data: [cartao('k1', 'Nubank'), cartao('k2', 'Inter'), cartao('k3', 'Antigo', false)] }
    fake.e.rpc.debt_balances = { data: [
      { debt_id: 'k1', debt: '1333.34', credit_receivable: '0', planned_remaining: '0' },
      { debt_id: 'k2', debt: '0', credit_receivable: '0', planned_remaining: '0' },
    ], error: null }
    fake.e.rpc.card_limits = { data: [{ debt_id: 'k1', credit_limit: '5800.00', committed: '530.00', available: '5270.00' }], error: null }
    fake.e.rpc.card_months = { data: [
      { label: '2026-09', closing_date: '2026-09-17', due_date: '2026-09-25', charged: '500.00', to_charge: '0', total: '500.00', paid: '500.00', items: 1, invoice_id: 'i1' },
      { label: '2026-10', closing_date: '2026-10-17', due_date: '2026-10-25', charged: '1333.34', to_charge: '0', total: '1333.34', paid: '0', items: 3, invoice_id: 'i2' },
    ], error: null }
    const r = await resumoDosCartoes('h1', '2026-10-24')
    expect(r.map((c) => c.nome)).toEqual(['Nubank', 'Inter']) // o inativo some
    expect(r[0]).toMatchObject({ id: 'k1', divida: 133334, vencimento: '2026-10-25', vencida: false, limiteDisponivel: 527000 })
    expect(r[1]).toMatchObject({ divida: 0, vencimento: null, vencida: false, limiteDisponivel: null })
    // depois do vencimento, a mesma fatura passa a vencida
    const depois = await resumoDosCartoes('h1', '2026-10-26')
    expect(depois[0]).toMatchObject({ vencimento: '2026-10-25', vencida: true })
  })
})
