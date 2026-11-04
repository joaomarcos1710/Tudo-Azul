import { beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => {
  const estado = {
    eventos: [] as Record<string, unknown>[],
    chamadas: [] as { filtros: Record<string, unknown>; ordens: string[]; faixa: [number, number] | null }[],
  }
  function consulta(tabela: string) {
    const reg = { filtros: {} as Record<string, unknown>, ordens: [] as string[], faixa: null as [number, number] | null }
    if (tabela === 'debt_events') estado.chamadas.push(reg)
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'is', 'in', 'not', 'gte', 'lte']) b[m] = (...args: unknown[]) => { if (m !== 'select') reg.filtros[`${m}:${args[0]}`] = args[1]; return b }
    b.order = (c: string) => { reg.ordens.push(c); return b }
    b.range = (de: number, ate: number) => { reg.faixa = [de, ate]; return b }
    b.then = (ok: (r: { data: unknown; error: null }) => unknown) => {
      if (tabela === 'debts') return Promise.resolve(ok({ data: [{ id: 'd1', name: 'Nubank', kind: 'card', principal_category_id: null }, { id: 'd2', name: 'Empréstimo', kind: 'loan', principal_category_id: 'cfin' }], error: null }))
      const todos = estado.eventos
      return Promise.resolve(ok({ data: reg.faixa ? todos.slice(reg.faixa[0], reg.faixa[1] + 1) : todos, error: null }))
    }
    return b
  }
  return { estado, supabase: { from: (t: string) => consulta(t) } }
})
vi.mock('./supabase', () => ({ supabase: fake.supabase }))

import { listarMovimentosDeDivida } from './lancamentos'

const ev = (extra: Record<string, unknown>) => ({ id: 'e', debt_id: 'd1', date: '2026-10-10', kind: 'payment', amount: '300.00', account_id: 'a1', ...extra })

beforeEach(() => {
  fake.estado.eventos = []
  fake.estado.chamadas.length = 0
})

describe('listarMovimentosDeDivida', () => {
  it('sinal por tipo igual ao de account_movements e rótulos de fatura/dívida', async () => {
    fake.estado.eventos = [
      ev({ id: '1', kind: 'payment' }), ev({ id: '2', kind: 'payment', debt_id: 'd2' }), ev({ id: '3', kind: 'extra_principal', debt_id: 'd2' }),
      ev({ id: '4', kind: 'interest', debt_id: 'd2', amount: '10.50' }), ev({ id: '5', kind: 'fee', debt_id: 'd2', amount: '5.00' }),
      ev({ id: '6', kind: 'disbursement', debt_id: 'd2', amount: '1000.00' }), ev({ id: '7', kind: 'refund_cash', amount: '20.00' }),
    ]
    const r = await listarMovimentosDeDivida('h1', '2026-10')
    expect(r.map((m) => [m.descricao, m.valor, m.jaEmDespesas])).toEqual([
      ['Pagamento da fatura · Nubank', -30000, false], ['Pagamento de Empréstimo', -30000, true], ['Amortização de Empréstimo', -30000, true],
      ['Juros de Empréstimo', -1050, true], ['Tarifa de Empréstimo', -500, true],
      ['Crédito de Empréstimo', 100000, false], ['Devolução de Nubank', 2000, false],
    ])
  })

  it('só lê eventos não anulados do mês, com a conta pedida', async () => {
    await listarMovimentosDeDivida('h1', '2026-10', { contaId: 'a9' })
    const f = fake.estado.chamadas[0].filtros
    expect(f['eq:household_id']).toBe('h1')
    expect(f['is:voided_at']).toBeNull()
    expect(f['gte:date']).toBe('2026-10-01')
    expect(f['lte:date']).toBe('2026-10-31')
    expect(f['eq:account_id']).toBe('a9')
    expect(f['in:kind']).toEqual(['payment', 'extra_principal', 'disbursement', 'refund_cash', 'interest', 'fee'])
  })

  it('filtro de despesa: juros, tarifa e principal de empréstimo (já em despesas); pagamento de cartão fica de fora', async () => {
    fake.estado.eventos = [
      ev({ id: '1', kind: 'payment' }), ev({ id: '2', kind: 'payment', debt_id: 'd2' }),
      ev({ id: '3', kind: 'interest', debt_id: 'd2', amount: '10.50', category_id: 'cjur' }),
    ]
    const r = await listarMovimentosDeDivida('h1', '2026-10', { tipo: 'expense' })
    expect(fake.estado.chamadas[0].filtros['in:kind']).toEqual(['interest', 'fee', 'payment', 'extra_principal'])
    expect(r.map((m) => m.descricao)).toEqual(['Pagamento de Empréstimo', 'Juros de Empréstimo'])
  })

  it('filtro de categoria: juros pela categoria do evento, principal pela categoria escolhida na dívida', async () => {
    fake.estado.eventos = [
      ev({ id: '1', kind: 'payment' }), ev({ id: '2', kind: 'payment', debt_id: 'd2' }),
      ev({ id: '3', kind: 'interest', debt_id: 'd2', amount: '10.50', category_id: 'cjur' }),
    ]
    expect((await listarMovimentosDeDivida('h1', '2026-10', { categoriaId: 'cfin' })).map((m) => m.descricao)).toEqual(['Pagamento de Empréstimo'])
    expect((await listarMovimentosDeDivida('h1', '2026-10', { categoriaId: 'cjur' })).map((m) => m.descricao)).toEqual(['Juros de Empréstimo'])
    expect(fake.estado.chamadas[0].filtros['eq:category_id']).toBeUndefined() // o principal não tem categoria no evento
  })

  it('receita e transferência: nada, sem nem consultar', async () => {
    expect(await listarMovimentosDeDivida('h1', '2026-10', { tipo: 'income' })).toEqual([])
    expect(await listarMovimentosDeDivida('h1', '2026-10', { tipo: 'transfer' })).toEqual([])
    expect(fake.estado.chamadas).toHaveLength(0)
  })

  it('pagina com ordem total quando passa de 1.000 eventos', async () => {
    fake.estado.eventos = Array.from({ length: 1001 }, (_, i) => ev({ id: `x${i}` }))
    const r = await listarMovimentosDeDivida('h1', '2026-10')
    expect(r).toHaveLength(1001)
    expect(fake.estado.chamadas.map((c) => c.faixa)).toEqual([[0, 999], [1000, 1999]])
    expect(fake.estado.chamadas[0].ordens).toEqual(['date', 'created_at', 'id'])
  })
})

describe('valoresDasParcelas (prévia do parcelado; o banco usa a mesma regra)', () => {
  it('sobra dos centavos na primeira e soma igual ao total', async () => {
    const { valoresDasParcelas } = await import('./lancamentos')
    expect(valoresDasParcelas(1000 as never, 3)).toEqual([334, 333, 333])
    expect(valoresDasParcelas(120000 as never, 12).every((v) => v === 10000)).toBe(true)
    const v = valoresDasParcelas(1234567 as never, 7)
    expect(v.reduce((a, b) => a + b, 0)).toBe(1234567)
    expect(Number.isInteger(v[0])).toBe(true)
  })
})
