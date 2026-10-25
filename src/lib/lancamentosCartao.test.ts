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

import { listarComprasDeCartao, mesmoDiaAnoPassado } from './lancamentos'

// compra de 20/10 em 3x, cartão que fecha dia 17: fechamentos em 17/11, 17/12 e 17/01 (due_date de cada parcela)
const parcela = (extra: Record<string, unknown>) => ({
  household_id: 'h1', debt_id: 'd1', plan: 'p1', seq: 1, description: 'Fone', purchase_date: '2026-10-20', face: '100.00', id: 'i1',
  due_date: '2026-11-17', ...extra,
})

beforeEach(() => {
  fake.tabelas.debts = [{ id: 'd1', name: 'Nubank', kind: 'card', closing_day: 17, household_id: 'h1' }]
  fake.tabelas.debt_installments = [
    parcela({ id: 'i1', seq: 1, due_date: '2026-11-17' }), parcela({ id: 'i2', seq: 2, due_date: '2026-12-17' }),
    parcela({ id: 'i3', seq: 3, due_date: '2027-01-17' }),
  ]
  fake.tabelas.debt_events = []
})

describe('listarComprasDeCartao', () => {
  it('cada parcela aparece só no mês dela, no dia da compra, com o N do plano inteiro', async () => {
    const out = await listarComprasDeCartao('h1', '2026-10')
    expect(out.parcelas.map((p) => [p.id, p.data, p.compra, p.parcela, p.deParcelas, p.valor, p.fechamento, p.cartaoNome])).toEqual([
      ['i1', '2026-10-20', '2026-10-20', 1, 3, 10000, 17, 'Nubank'],
    ])
    expect(out.semData).toBe(0)
    const nov = await listarComprasDeCartao('h1', '2026-11')
    expect(nov.parcelas.map((p) => [p.id, p.data, p.compra, p.parcela, p.deParcelas])).toEqual([['i2', '2026-11-20', '2026-10-20', 2, 3]])
    const dez = await listarComprasDeCartao('h1', '2026-12')
    expect(dez.parcelas.map((p) => [p.id, p.data, p.parcela])).toEqual([['i3', '2026-12-20', 3]])
  })

  it('depois da última parcela, o mês fica sem a compra', async () => {
    expect((await listarComprasDeCartao('h1', '2027-01')).parcelas).toEqual([])
    expect((await listarComprasDeCartao('h1', '2026-09')).parcelas).toEqual([])
  })

  it('compra no dia 31: em mês curto a parcela cai no último dia do mês', async () => {
    fake.tabelas.debt_installments = [
      parcela({ id: 'a1', plan: 'p2', seq: 1, purchase_date: '2026-01-31', due_date: '2026-02-17' }),
      parcela({ id: 'a2', plan: 'p2', seq: 2, purchase_date: '2026-01-31', due_date: '2026-03-17' }),
    ]
    const fev = await listarComprasDeCartao('h1', '2026-02')
    expect(fev.parcelas.map((p) => [p.id, p.data, p.compra])).toEqual([['a2', '2026-02-28', '2026-01-31']])
    const jan = await listarComprasDeCartao('h1', '2026-01')
    expect(jan.parcelas.map((p) => [p.id, p.data])).toEqual([['a1', '2026-01-31']])
  })

  it('virada de ano: a parcela de janeiro mostra a compra de dezembro', async () => {
    fake.tabelas.debt_installments = [
      parcela({ id: 'b2', plan: 'p3', seq: 2, purchase_date: '2026-12-05', due_date: '2027-01-17' }),
    ]
    const jan = await listarComprasDeCartao('h1', '2027-01')
    expect(jan.parcelas.map((p) => [p.data, p.compra, p.parcela])).toEqual([['2027-01-05', '2026-12-05', 2]])
  })

  it('compra excluída (cancelamento total) não aparece, mas o N continua sendo o plano inteiro', async () => {
    fake.tabelas.debt_events = [{ id: 'e1', household_id: 'h1', kind: 'cancel', installment_id: 'i2', amount: '100.00', voided_at: null }]
    expect((await listarComprasDeCartao('h1', '2026-11')).parcelas).toEqual([])
    const out = await listarComprasDeCartao('h1', '2026-10')
    expect(out.parcelas.map((p) => [p.id, p.deParcelas])).toEqual([['i1', 3]])
  })

  it('desconto parcial (cancelamento de parte da parcela) mostra só o que sobrou', async () => {
    fake.tabelas.debt_events = [{ id: 'e1', household_id: 'h1', kind: 'cancel', installment_id: 'i1', amount: '10.00', voided_at: null }]
    const out = await listarComprasDeCartao('h1', '2026-10')
    expect(out.parcelas.find((p) => p.id === 'i1')?.valor).toBe(9000)
  })

  it('cancelamento anulado não conta (a parcela volta)', async () => {
    fake.tabelas.debt_events = [{ id: 'e1', household_id: 'h1', kind: 'cancel', installment_id: 'i2', amount: '100.00', voided_at: '2026-10-21T10:00:00Z' }]
    expect((await listarComprasDeCartao('h1', '2026-11')).parcelas.map((p) => p.id)).toEqual(['i2'])
  })

  it('parcelas sem data de compra não aparecem e são contadas para avisar', async () => {
    fake.tabelas.debt_installments.push(parcela({ id: 'antiga', plan: 'p9', purchase_date: null, due_date: '2026-10-17' }))
    const out = await listarComprasDeCartao('h1', '2026-10')
    expect(out.parcelas.map((p) => p.id)).not.toContain('antiga')
    expect(out.semData).toBe(1)
  })
})

describe('mesmoDiaAnoPassado', () => {
  it('volta um ano e trata 29/02', () => {
    expect(mesmoDiaAnoPassado('2026-10-25')).toBe('2025-10-25')
    expect(mesmoDiaAnoPassado('2028-02-29')).toBe('2027-02-28')
    expect(mesmoDiaAnoPassado('2026-01-01')).toBe('2025-01-01')
  })
})
