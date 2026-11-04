import { beforeEach, describe, expect, it, vi } from 'vitest'

// banco de mentira: filtros de verdade sobre linhas em memória; `erro` por tabela simula o banco sem a migration 052
const fake = vi.hoisted(() => {
  const tabelas: Record<string, Record<string, unknown>[]> = {}
  const erros: Record<string, { code: string; message: string } | null> = {}
  function consulta(tabela: string) {
    const filtros: ((r: Record<string, unknown>) => boolean)[] = []
    const b: Record<string, unknown> = {}
    b.select = () => b
    b.order = () => b
    b.eq = (c: string, v: unknown) => { filtros.push((r) => r[c] === v); return b }
    b.gte = (c: string, v: string) => { filtros.push((r) => String(r[c]) >= v); return b }
    b.lte = (c: string, v: string) => { filtros.push((r) => String(r[c]) <= v); return b }
    b.is = (c: string, v: null) => { filtros.push((r) => (r[c] ?? null) === v); return b }
    b.then = (ok: (r: unknown) => unknown) => {
      const erro = erros[tabela] ?? null
      if (erro) return Promise.resolve(ok({ data: null, error: erro }))
      return Promise.resolve(ok({ data: (tabelas[tabela] ?? []).filter((r) => filtros.every((f) => f(r))), error: null }))
    }
    return b
  }
  return { tabelas, erros, supabase: { from: (t: string) => consulta(t) } }
})
vi.mock('./supabase', () => ({ supabase: fake.supabase }))

import { listarCreditosDeCartao } from './lancamentos'

const evento = (extra: Record<string, unknown>) => ({
  id: 'e1', household_id: 'h1', debt_id: 'd1', kind: 'income_credit', date: '2026-11-17', credit_date: '2026-11-03',
  amount: '50.00', category_id: 'sal', note: 'Estorno de IOF', voided_at: null, ...extra,
})

beforeEach(() => {
  fake.erros.debt_events = null
  fake.tabelas.debts = [{ id: 'd1', household_id: 'h1', name: 'Nubank', kind: 'card' }]
  fake.tabelas.debt_events = [
    evento({}),
    evento({ id: 'e2', date: '2026-10-17', credit_date: '2026-10-01', note: 'Outro mês' }),
    evento({ id: 'e3', voided_at: '2026-11-04T10:00:00Z', note: 'Anulado' }),
    evento({ id: 'e4', kind: 'payment', note: 'Pagamento' }),
    evento({ id: 'e5', household_id: 'h2', note: 'Outra família' }),
  ]
})

describe('listarCreditosDeCartao', () => {
  it('lista os créditos avulsos não anulados do mês, no dia do fechamento (o mês em que contam nos totais)', async () => {
    const r = await listarCreditosDeCartao('h1', '2026-11', {}, '2026-11-04')
    expect(r).toEqual([{
      id: 'e1', data: '2026-11-17', dataCredito: '2026-11-03', descricao: 'Estorno de IOF', cartaoNome: 'Nubank',
      categoriaId: 'sal', valor: 5000, planejado: true,
    }])
  })

  it('depois do fechamento deixa de ser planejado', async () => {
    const [r] = await listarCreditosDeCartao('h1', '2026-11', {}, '2026-11-17')
    expect(r.planejado).toBe(false)
  })

  it('não tem conta: some com filtro de conta, de despesa e de transferência; filtro de receita e de categoria mantêm', async () => {
    expect(await listarCreditosDeCartao('h1', '2026-11', { contaId: 'a1' }, '2026-11-04')).toEqual([])
    expect(await listarCreditosDeCartao('h1', '2026-11', { tipo: 'expense' }, '2026-11-04')).toEqual([])
    expect(await listarCreditosDeCartao('h1', '2026-11', { tipo: 'transfer' }, '2026-11-04')).toEqual([])
    expect(await listarCreditosDeCartao('h1', '2026-11', { tipo: 'income' }, '2026-11-04')).toHaveLength(1)
    expect(await listarCreditosDeCartao('h1', '2026-11', { categoriaId: 'sal' }, '2026-11-04')).toHaveLength(1)
    expect(await listarCreditosDeCartao('h1', '2026-11', { categoriaId: 'outra' }, '2026-11-04')).toEqual([])
  })

  it('banco ainda sem a migration 052 (coluna inexistente): lista vazia; outro erro sobe', async () => {
    fake.erros.debt_events = { code: '42703', message: 'column does not exist' }
    expect(await listarCreditosDeCartao('h1', '2026-11', {}, '2026-11-04')).toEqual([])
    fake.erros.debt_events = { code: '42501', message: 'sem permissão' }
    await expect(listarCreditosDeCartao('h1', '2026-11', {}, '2026-11-04')).rejects.toMatchObject({ code: '42501' })
  })
})
