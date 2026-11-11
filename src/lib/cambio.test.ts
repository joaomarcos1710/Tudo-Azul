import { beforeEach, describe, expect, it, vi } from 'vitest'

// conversão para reais pela PTAX (migration 108), com o banco de mentira
const fake = vi.hoisted(() => {
  const e = { rpcs: [] as [string, Record<string, unknown>][], resposta: { data: [] as unknown, error: null as unknown } }
  const supabase = { rpc: (nome: string, args: Record<string, unknown>) => { e.rpcs.push([nome, args]); return Promise.resolve(e.resposta) } }
  return { e, supabase }
})
vi.mock('./supabase', () => ({ supabase: fake.supabase }))

import { converterParaReais, textoCotacao } from './cambio'
import type { Cents } from './format'

const c = (n: number) => n as Cents
beforeEach(() => { fake.e.rpcs = []; fake.e.resposta = { data: [], error: null } })

describe('converterParaReais', () => {
  it('manda moedas e valores em texto decimal (sem conta em ponto flutuante) e devolve na mesma ordem, em centavos', async () => {
    fake.e.resposta = { error: null, data: [
      { ord: 2, currency: 'EUR', amount: '33.14', amount_brl: '208.78', rate: '6.30000', rate_date: '2026-11-08' },
      { ord: 1, currency: 'USD', amount: '100.00', amount_brl: 547.72, rate: 5.4772, rate_date: '2026-11-10' },
      { ord: 3, currency: 'USD', amount: '-12.50', amount_brl: '-68.47', rate: '5.47720', rate_date: '2026-11-10' },
    ] }
    const r = await converterParaReais([{ moeda: 'USD', valor: c(10000) }, { moeda: 'EUR', valor: c(3314) }, { moeda: 'USD', valor: c(-1250) }], '2026-11-10')
    expect(fake.e.rpcs).toEqual([['fx_to_brl', { p_currencies: ['USD', 'EUR', 'USD'], p_amounts: ['100.00', '33.14', '-12.50'], p_date: '2026-11-10' }]])
    expect(r).toEqual([
      { moeda: 'USD', valor: 10000, reais: 54772, taxa: '5.4772', dataTaxa: '2026-11-10' },
      { moeda: 'EUR', valor: 3314, reais: 20878, taxa: '6.30000', dataTaxa: '2026-11-08' },
      { moeda: 'USD', valor: -1250, reais: -6847, taxa: '5.47720', dataTaxa: '2026-11-10' },
    ])
  })

  it('sem cotação recente: reais nulo (a tela não inventa número)', async () => {
    fake.e.resposta = { error: null, data: [{ ord: 1, currency: 'EUR', amount: '1.00', amount_brl: null, rate: null, rate_date: null }] }
    expect(await converterParaReais([{ moeda: 'EUR', valor: c(100) }], '2026-11-10')).toEqual([{ moeda: 'EUR', valor: 100, reais: null, taxa: null, dataTaxa: null }])
  })

  it('lista vazia não chama o banco', async () => {
    expect(await converterParaReais([], '2026-11-10')).toEqual([])
    expect(fake.e.rpcs).toHaveLength(0)
  })

  it('erro do banco sobe para quem chamou', async () => {
    fake.e.resposta = { data: null, error: { code: 'PGRST202' } }
    await expect(converterParaReais([{ moeda: 'USD', valor: c(1) }], '2026-11-10')).rejects.toMatchObject({ code: 'PGRST202' })
  })
})

describe('textoCotacao', () => {
  it('fonte, data e taxa com até 4 casas', () => {
    expect(textoCotacao({ moeda: 'EUR', valor: c(1), reais: c(6), taxa: '6.23050', dataTaxa: '2026-11-10' }, '€')).toBe('PTAX de 10/11/2026: € 1 = R$ 6,2305')
    expect(textoCotacao({ moeda: 'USD', valor: c(1), reais: c(5), taxa: '5.5', dataTaxa: '2026-11-10' }, 'US$')).toBe('PTAX de 10/11/2026: US$ 1 = R$ 5,50')
  })
  it('sem taxa: vazio', () => {
    expect(textoCotacao({ moeda: 'USD', valor: c(1), reais: null, taxa: null, dataTaxa: null }, 'US$')).toBe('')
  })
})
