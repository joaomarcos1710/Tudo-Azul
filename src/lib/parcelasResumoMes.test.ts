import { beforeEach, describe, expect, it, vi } from 'vitest'

// Resumo do mês dos parcelamentos (migration 20261114140000): nome e parâmetros da RPC e a conversão em centavos.
const fake = vi.hoisted(() => {
  const chamadas: unknown[][] = []
  const resposta: { data: unknown; error: unknown } = { data: [], error: null }
  return { chamadas, resposta, supabase: { rpc: (nome: string, args: unknown) => { chamadas.push([nome, args]); return Promise.resolve(resposta) } } }
})
vi.mock('./supabase', () => ({ supabase: fake.supabase }))

import { resumoParcelasDoMes } from './parcelasAtivas'

beforeEach(() => { fake.chamadas.length = 0; fake.resposta.error = null; fake.resposta.data = [] })

describe('resumoParcelasDoMes', () => {
  it('chama installment_month_summary com a família e converte reais do banco em centavos inteiros, uma linha por moeda', async () => {
    fake.resposta.data = [
      { currency_code: 'BRL', active_count: 6, month_count: 5, month_total: '433.33', paid_total: 100, pending_total: '333.33', examples: ['Atraso', 'Futuro', 'Lixeira'] },
      { currency_code: 'USD', active_count: 1, month_count: 1, month_total: '100.00', paid_total: '0.00', pending_total: '100.00', examples: null },
    ]
    const r = await resumoParcelasDoMes('h1')
    expect(fake.chamadas).toEqual([['installment_month_summary', { p_household: 'h1' }]])
    expect(r).toEqual([
      { moeda: 'BRL', ativos: 6, comParcelaNoMes: 5, totalMes: 43333, pagoMes: 10000, faltaMes: 33333, exemplos: ['Atraso', 'Futuro', 'Lixeira'] },
      { moeda: 'USD', ativos: 1, comParcelaNoMes: 1, totalMes: 10000, pagoMes: 0, faltaMes: 10000, exemplos: [] },
    ])
  })
  it('sem dados devolve lista vazia; erro do banco sobe (a tela segue sem o card)', async () => {
    fake.resposta.data = null
    expect(await resumoParcelasDoMes('h1')).toEqual([])
    fake.resposta.error = { code: 'PGRST202' }
    await expect(resumoParcelasDoMes('h1')).rejects.toMatchObject({ code: 'PGRST202' })
  })
})
