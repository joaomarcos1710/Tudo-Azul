import { beforeEach, describe, expect, it, vi } from 'vitest'

// multimoeda F1 (migration 055): moeda da conta na criação e total por moeda, com o banco de mentira
const fake = vi.hoisted(() => {
  const e = {
    inseridos: [] as Record<string, unknown>[],
    atualizados: [] as Record<string, unknown>[],
    porMoeda: { data: [] as unknown, error: null as { code: string } | null },
  }
  const fim = { eq: () => Promise.resolve({ error: null }) }
  const supabase = {
    from: () => ({
      insert: (v: Record<string, unknown>) => { e.inseridos.push(v); return Promise.resolve({ error: null }) },
      update: (v: Record<string, unknown>) => { e.atualizados.push(v); return fim },
    }),
    rpc: () => Promise.resolve(e.porMoeda),
  }
  return { e, supabase }
})
vi.mock('./supabase', () => ({ supabase: fake.supabase }))

import { aceitaLancamento, criarConta, editarConta, outrasMoedas, totaisPorMoeda } from './contas'
import type { Cents } from './format'

const c = (n: number) => n as Cents
const dados = { nome: 'Conta', tipo: 'checking' as const, saldoInicial: c(25050), abertura: '2026-11-01' }

beforeEach(() => {
  fake.e.inseridos = []
  fake.e.atualizados = []
  fake.e.porMoeda = { data: [], error: null }
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

  it('só conta em reais aceita lançamento por enquanto (sem moeda conhecida = BRL)', () => {
    expect(aceitaLancamento({ moeda: 'BRL' })).toBe(true)
    expect(aceitaLancamento({})).toBe(true)
    expect(aceitaLancamento({ moeda: 'USD' })).toBe(false)
    expect(aceitaLancamento({ moeda: 'EUR' })).toBe(false)
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
