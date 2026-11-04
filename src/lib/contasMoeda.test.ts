import { beforeEach, describe, expect, it, vi } from 'vitest'

// multimoeda F1 (migration 055): moeda da conta na criação e total por moeda, com o banco de mentira
const fake = vi.hoisted(() => {
  const e = {
    inseridos: [] as Record<string, unknown>[],
    atualizados: [] as Record<string, unknown>[],
    porMoeda: { data: [] as unknown, error: null as { code: string } | null },
    rpcs: [] as [string, Record<string, unknown>][],
  }
  const fim = { eq: () => Promise.resolve({ error: null }) }
  const supabase = {
    from: () => ({
      insert: (v: Record<string, unknown>) => { e.inseridos.push(v); return Promise.resolve({ error: null }) },
      update: (v: Record<string, unknown>) => { e.atualizados.push(v); return fim },
    }),
    rpc: (nome: string, args: Record<string, unknown>) => { e.rpcs.push([nome, args]); return Promise.resolve(e.porMoeda) },
  }
  return { e, supabase }
})
vi.mock('./supabase', () => ({ supabase: fake.supabase }))

import { aceitaLancamento, criarConta, editarConta, mesmaMoeda, outrasMoedas, totaisPorMoeda } from './contas'
import type { Cents } from './format'
import { resumoPorMoeda } from './lancamentos'

const c = (n: number) => n as Cents
const dados = { nome: 'Conta', tipo: 'checking' as const, saldoInicial: c(25050), abertura: '2026-11-01' }

beforeEach(() => {
  fake.e.inseridos = []
  fake.e.atualizados = []
  fake.e.porMoeda = { data: [], error: null }
  fake.e.rpcs = []
})

describe('moeda da conta', () => {
  it('conta em dólar grava currency_code; em reais não manda a coluna (funciona antes da migration 055)', async () => {
    await criarConta('h1', { ...dados, moeda: 'USD' })
    await criarConta('h1', { ...dados, moeda: 'BRL' })
    await criarConta('h1', dados)
    expect(fake.e.inseridos[0]).toMatchObject({ currency_code: 'USD', initial_balance: '250.50' })
    expect(fake.e.inseridos[1]).not.toHaveProperty('currency_code')
    expect(fake.e.inseridos[2]).not.toHaveProperty('currency_code')
  })

  it('editar nunca manda a moeda', async () => {
    await editarConta('a1', { ...dados, moeda: 'EUR' })
    expect(fake.e.atualizados[0]).not.toHaveProperty('currency_code')
  })

  it('F2 (056): receita, despesa e transferência em qualquer moeda; cartão, dívida e provento só em reais (sem moeda = BRL)', () => {
    for (const moeda of ['BRL', 'USD', 'EUR']) expect(aceitaLancamento({ moeda }, 'lancamento')).toBe(true)
    expect(aceitaLancamento({}, 'cartao_divida_provento')).toBe(true)
    expect(aceitaLancamento({ moeda: 'BRL' }, 'cartao_divida_provento')).toBe(true)
    expect(aceitaLancamento({ moeda: 'USD' }, 'cartao_divida_provento')).toBe(false)
    expect(aceitaLancamento({ moeda: 'EUR' }, 'cartao_divida_provento')).toBe(false)
  })

  it('transferência só entre contas da mesma moeda (sem moeda = BRL)', () => {
    expect(mesmaMoeda({ moeda: 'USD' }, { moeda: 'USD' })).toBe(true)
    expect(mesmaMoeda({}, { moeda: 'BRL' })).toBe(true)
    expect(mesmaMoeda({ moeda: 'BRL' }, { moeda: 'USD' })).toBe(false)
    expect(mesmaMoeda({ moeda: 'USD' }, { moeda: 'EUR' })).toBe(false)
  })
})

describe('totaisPorMoeda', () => {
  it('lê os totais do banco em centavos, sem converter nem somar moedas', async () => {
    fake.e.porMoeda = { data: [
      { currency_code: 'BRL', total: '1000.00', total_active: '900.00' },
      { currency_code: 'USD', total: '250.50', total_active: '250.50' },
    ], error: null }
    const r = await totaisPorMoeda('h1', '2026-11-04')
    expect(r).toEqual([
      { moeda: 'BRL', total: 100000, totalAtivas: 90000 },
      { moeda: 'USD', total: 25050, totalAtivas: 25050 },
    ])
    expect(outrasMoedas(r).map((m) => m.moeda)).toEqual(['USD'])
  })

  it('banco ainda sem a função (migration 055 não aplicada): lista vazia, a tela segue', async () => {
    fake.e.porMoeda = { data: null, error: { code: 'PGRST202' } }
    expect(await totaisPorMoeda('h1')).toEqual([])
  })

  it('outro erro continua sendo erro', async () => {
    fake.e.porMoeda = { data: null, error: { code: '42501' } }
    await expect(totaisPorMoeda('h1')).rejects.toMatchObject({ code: '42501' })
  })
})

describe('resumoPorMoeda (multimoeda F2, migration 056)', () => {
  it('lê receita, despesa e resultado pagos por moeda, em centavos, do banco (period_summary_by_currency)', async () => {
    fake.e.porMoeda = { data: [{ currency_code: 'USD', income: '1000.00', expense: '40.25', result: '959.75' }], error: null }
    expect(await resumoPorMoeda('h1', '2026-11-01', '2026-11-30')).toEqual([{ moeda: 'USD', receitas: 100000, despesas: 4025, resultado: 95975 }])
    expect(fake.e.rpcs).toEqual([['period_summary_by_currency', { p_household: 'h1', p_from: '2026-11-01', p_to: '2026-11-30' }]])
  })

  it('banco ainda sem a função (migration 056 não aplicada): lista vazia, a tela segue', async () => {
    fake.e.porMoeda = { data: null, error: { code: '42883' } }
    expect(await resumoPorMoeda('h1', '2026-11-01', '2026-11-30')).toEqual([])
  })

  it('outro erro continua sendo erro', async () => {
    fake.e.porMoeda = { data: null, error: { code: '42501' } }
    await expect(resumoPorMoeda('h1', '2026-11-01', '2026-11-30')).rejects.toMatchObject({ code: '42501' })
  })
})
