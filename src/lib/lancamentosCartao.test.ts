import { beforeEach, describe, expect, it, vi } from 'vitest'

// banco de mentira com os filtros que listarComprasDeCartao usa de verdade
const fake = vi.hoisted(() => {
  const tabelas: Record<string, Record<string, unknown>[]> = {}
  function consulta(tabela: string) {
    const filtros: ((r: Record<string, unknown>) => boolean)[] = []
    let faixa: [number, number] | null = null
    let contar = false
    const b: Record<string, unknown> = {}
    const linhas = () => (tabelas[tabela] ?? []).filter((r) => filtros.every((f) => f(r)))
    for (const m of ['select', 'order']) b[m] = (_a?: unknown, opts?: { count?: string; head?: boolean }) => {
      if (m === 'select' && opts?.count) contar = true
      return b
    }
    b.eq = (c: string, v: unknown) => { filtros.push((r) => r[c] === v); return b }
    b.gte = (c: string, v: string) => { filtros.push((r) => String(r[c]) >= v); return b }
    b.lte = (c: string, v: string) => { filtros.push((r) => String(r[c]) <= v); return b }
    b.is = (c: string, v: null) => { filtros.push((r) => (r[c] ?? null) === v); return b }
    b.in = (c: string, vs: unknown[]) => { filtros.push((r) => vs.includes(r[c])); return b }
    b.range = (de: number, ate: number) => { faixa = [de, ate]; return b }
    b.then = (ok: (r: unknown) => unknown) => {
      const todas = linhas()
      if (contar) return Promise.resolve(ok({ count: todas.length, data: null, error: null }))
      return Promise.resolve(ok({ data: faixa ? todas.slice(faixa[0], faixa[1] + 1) : todas, error: null }))
    }
    return b
  }
  return { tabelas, supabase: { from: (t: string) => consulta(t) } }
})
vi.mock('./supabase', () => ({ supabase: fake.supabase }))

import { listarComprasDeCartao } from './lancamentos'

const parcela = (extra: Record<string, unknown>) => ({
  household_id: 'h1', debt_id: 'd1', plan: 'p1', seq: 1, description: 'Fone', purchase_date: '2026-10-20', face: '100.00', id: 'i1', ...extra,
})

beforeEach(() => {
  fake.tabelas.debts = [{ id: 'd1', name: 'Nubank', kind: 'card', closing_day: 17, household_id: 'h1' }]
  fake.tabelas.debt_installments = [
    parcela({ id: 'i1', seq: 1 }), parcela({ id: 'i2', seq: 2 }), parcela({ id: 'i3', seq: 3 }),
  ]
  fake.tabelas.debt_events = []
})

describe('listarComprasDeCartao', () => {
  it('lista cada parcela no dia da compra, com o N do plano inteiro e o dia do fechamento', async () => {
    const r = await listarComprasDeCartao('h1', '2026-10')
    expect(r.parcelas.map((p) => [p.parcela, p.deParcelas, p.valor, p.fechamento, p.cartaoNome])).toEqual([
      [1, 3, 10000, 17, 'Nubank'], [2, 3, 10000, 17, 'Nubank'], [3, 3, 10000, 17, 'Nubank'],
    ])
    expect(r.semData).toBe(0)
  })

  it('compra excluída (cancelamento total) não aparece', async () => {
    fake.tabelas.debt_events = [{ id: 'e1', household_id: 'h1', kind: 'cancel', installment_id: 'i2', amount: '100.00', voided_at: null }]
    const r = await listarComprasDeCartao('h1', '2026-10')
    expect(r.parcelas.map((p) => p.id)).toEqual(['i1', 'i3'])
    expect(r.parcelas.every((p) => p.deParcelas === 3)).toBe(true) // o N continua sendo o plano inteiro
  })

  it('desconto parcial (cancelamento de parte da parcela) mostra só o que sobrou', async () => {
    fake.tabelas.debt_events = [{ id: 'e1', household_id: 'h1', kind: 'cancel', installment_id: 'i1', amount: '10.00', voided_at: null }]
    const r = await listarComprasDeCartao('h1', '2026-10')
    expect(r.parcelas.find((p) => p.id === 'i1')?.valor).toBe(9000)
  })

  it('cancelamento anulado não conta (a parcela volta)', async () => {
    fake.tabelas.debt_events = [{ id: 'e1', household_id: 'h1', kind: 'cancel', installment_id: 'i2', amount: '100.00', voided_at: '2026-10-21T10:00:00Z' }]
    const r = await listarComprasDeCartao('h1', '2026-10')
    expect(r.parcelas.map((p) => p.id)).toContain('i2')
  })

  it('parcelas sem data de compra não aparecem e são contadas para avisar', async () => {
    fake.tabelas.debt_installments.push(parcela({ id: 'antiga', plan: 'p9', purchase_date: null }))
    const r = await listarComprasDeCartao('h1', '2026-10')
    expect(r.parcelas.map((p) => p.id)).not.toContain('antiga')
    expect(r.semData).toBe(1)
  })

  it('compra de outro mês não entra', async () => {
    const r = await listarComprasDeCartao('h1', '2026-11')
    expect(r.parcelas).toEqual([])
  })
})
