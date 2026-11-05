import { beforeEach, describe, expect, it, vi } from 'vitest'

// banco de mentira: a tabela debts (com os filtros que listarFaturasDoMes usa) e as funções card_months / card_items
const fake = vi.hoisted(() => {
  const tabelas: Record<string, Record<string, unknown>[]> = {}
  const rpcs: Record<string, (args: Record<string, unknown>) => unknown[]> = {}
  const chamadas: [string, Record<string, unknown>][] = []
  function consulta(tabela: string) {
    const filtros: ((r: Record<string, unknown>) => boolean)[] = []
    const b: Record<string, unknown> = {}
    b.select = () => b
    b.eq = (c: string, v: unknown) => { filtros.push((r) => r[c] === v); return b }
    b.then = (ok: (r: unknown) => unknown) =>
      Promise.resolve(ok({ data: (tabelas[tabela] ?? []).filter((r) => filtros.every((f) => f(r))), error: null }))
    return b
  }
  const supabase = {
    from: (t: string) => consulta(t),
    rpc: (nome: string, args: Record<string, unknown>) => {
      chamadas.push([nome, args])
      return Promise.resolve({ data: rpcs[nome]?.(args) ?? [], error: null })
    },
  }
  return { tabelas, rpcs, chamadas, supabase }
})
vi.mock('./supabase', () => ({ supabase: fake.supabase }))

import { listarComprasDasFaturas, listarFaturasDoMes, mesmoDiaAnoPassado, situacaoDaFatura } from './lancamentos'
import type { Fatura } from './cartoes'
import type { Cents } from './format'

// Nubank fecha dia 28 e vence dia 5 do mês seguinte; Itaú fecha dia 20 e vence dia 28 do mesmo mês
const mesBanco = (label: string, closing: string, due: string, extra: Record<string, unknown> = {}) => ({
  label, closing_date: closing, due_date: due, charged: '0', pending: '0', total: '0', paid: '0', items: 0, invoice_id: null,
  previous_open: '0', advance_in: '0', advance_out: '0', credits: '0', ...extra,
})

beforeEach(() => {
  fake.chamadas.length = 0
  fake.tabelas.debts = [
    { id: 'nu', name: 'Nubank', kind: 'card', household_id: 'h1', pay_account_id: 'a1' },
    { id: 'it', name: 'Itaú', kind: 'card', household_id: 'h1', pay_account_id: null },
    { id: 'emp', name: 'Empréstimo', kind: 'loan', household_id: 'h1', pay_account_id: 'a1' },
  ]
  fake.rpcs.card_months = ({ p_debt }) => (p_debt === 'nu'
    ? [
        // fecha em outubro e vence em novembro: só aparece na lista de novembro
        mesBanco('2026-10', '2026-10-28', '2026-11-05', { charged: '350.00', total: '350.00', items: 2 }),
        mesBanco('2026-11', '2026-11-28', '2026-12-05', { pending: '80.00', total: '80.00', items: 1 }),
      ]
    : [
        mesBanco('2026-11', '2026-11-20', '2026-11-28', { charged: '1234.56', total: '1234.56', paid: '1234.56', items: 3 }),
        // fatura só com crédito avulso (sem compra, total zero): não vira linha
        mesBanco('2026-12', '2026-12-20', '2026-12-28', { charged: '-50.00', credits: '50.00' }),
      ])
  fake.rpcs.card_items = ({ p_debt, p_label }) => (p_debt === 'nu' && p_label === '2026-10'
    ? [
        { installment_id: 'i1', plan: 'p1', seq: 1, plan_count: 1, description: 'Mercado do mês', purchase_date: '2026-10-03', face: '200.00', remaining: '0', category_id: 'mer' },
        { installment_id: 'i2', plan: 'p2', seq: 2, plan_count: 3, description: 'Fone', purchase_date: '2026-09-10', face: '150.00', remaining: '0', category_id: 'ele' },
      ]
    : [])
})

describe('listarFaturasDoMes', () => {
  it('uma linha por fatura que VENCE no mês, com o total do banco e a situação', async () => {
    const nov = await listarFaturasDoMes('h1', '2026-11', {}, '2026-11-10')
    expect(nov.map((f) => [f.cartaoNome, f.mes, f.fechamento, f.vencimento, f.total, f.pago, f.itens, f.situacao])).toEqual([
      // venceu em 05/11 e não foi paga
      ['Nubank', '2026-10', '2026-10-28', '2026-11-05', 35000, 0, 2, 'vencida'],
      ['Itaú', '2026-11', '2026-11-20', '2026-11-28', 123456, 123456, 3, 'aberta'],
    ])
    // empréstimo não é cartão: não chama card_months para ele
    expect(fake.chamadas.filter(([n]) => n === 'card_months').map(([, a]) => a.p_debt).sort()).toEqual(['it', 'nu'])
    // a fatura que fecha em outubro não aparece em outubro (aparece no vencimento)
    expect((await listarFaturasDoMes('h1', '2026-10', {}, '2026-11-10')).map((f) => f.mes)).toEqual([])
  })

  it('fatura só de crédito avulso (sem compra e sem valor) não vira linha', async () => {
    expect((await listarFaturasDoMes('h1', '2026-12', {}, '2026-11-10')).map((f) => [f.cartaoNome, f.mes])).toEqual([['Nubank', '2026-11']])
  })

  it('receita e transferência não têm fatura; despesa tem', async () => {
    expect(await listarFaturasDoMes('h1', '2026-11', { tipo: 'income' }, '2026-11-10')).toEqual([])
    expect(await listarFaturasDoMes('h1', '2026-11', { tipo: 'transfer' }, '2026-11-10')).toEqual([])
    expect(fake.chamadas).toEqual([])
    expect((await listarFaturasDoMes('h1', '2026-11', { tipo: 'expense' }, '2026-11-10'))).toHaveLength(2)
  })

  it('filtro de conta: só a fatura do cartão cuja conta de pagamento é aquela; cartão sem conta some', async () => {
    expect((await listarFaturasDoMes('h1', '2026-11', { contaId: 'a1' }, '2026-11-10')).map((f) => f.cartaoNome)).toEqual(['Nubank'])
    expect(await listarFaturasDoMes('h1', '2026-11', { contaId: 'a2' }, '2026-11-10')).toEqual([])
  })
})

describe('listarComprasDasFaturas (filtro de categoria)', () => {
  it('as compras daquela categoria, uma a uma, no vencimento da fatura em que estão', async () => {
    const faturas = await listarFaturasDoMes('h1', '2026-11', { categoriaId: 'mer' }, '2026-11-10')
    const compras = await listarComprasDasFaturas(faturas, 'mer')
    expect(compras.map((c) => [c.id, c.descricao, c.cartaoNome, c.vencimento, c.fechamento, c.valor, c.categoriaId])).toEqual([
      ['i1', 'Mercado do mês', 'Nubank', '2026-11-05', '2026-10-28', 20000, 'mer'],
    ])
    expect(await listarComprasDasFaturas(faturas, 'outra')).toEqual([])
  })
})

describe('situacaoDaFatura', () => {
  const f = (x: Partial<Fatura>): Fatura => ({
    mes: '2026-10', fechamento: '2026-10-28', vencimento: '2026-11-05', cobrado: 35000 as Cents, aCobrar: 0 as Cents, total: 35000 as Cents,
    pago: 0 as Cents, itens: 2, faturaId: null, saldoAnterior: 0 as Cents, adiantamentoEntrada: 0 as Cents, adiantamentoSaida: 0 as Cents,
    creditos: 0 as Cents, ...x,
  })
  it('aberta antes do fechamento; fechada até o vencimento; vencida depois; paga quando pagou', () => {
    expect(situacaoDaFatura(f({}), '2026-10-27')).toBe('aberta')
    expect(situacaoDaFatura(f({}), '2026-11-05')).toBe('fechada')
    expect(situacaoDaFatura(f({}), '2026-11-06')).toBe('vencida')
    expect(situacaoDaFatura(f({ pago: 35000 as Cents }), '2026-11-06')).toBe('paga')
  })
})

describe('mesmoDiaAnoPassado', () => {
  it('volta um ano e trata 29/02', () => {
    expect(mesmoDiaAnoPassado('2026-10-25')).toBe('2025-10-25')
    expect(mesmoDiaAnoPassado('2028-02-29')).toBe('2027-02-28')
    expect(mesmoDiaAnoPassado('2026-01-01')).toBe('2025-01-01')
  })
})
