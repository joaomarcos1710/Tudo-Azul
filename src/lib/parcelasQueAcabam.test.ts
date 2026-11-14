import { beforeEach, describe, expect, it, vi } from 'vitest'

// Parcelamentos que terminam em breve (migration 20261114100000): nome e parâmetros da RPC e a conversão em centavos.
const fake = vi.hoisted(() => {
  const chamadas: unknown[][] = []
  const resposta: { data: unknown; error: unknown } = { data: [], error: null }
  return { chamadas, resposta, supabase: { rpc: (nome: string, args: unknown) => { chamadas.push([nome, args]); return Promise.resolve(resposta) } } }
})
vi.mock('./supabase', () => ({ supabase: fake.supabase }))

import { listarParcelasQueAcabam } from './parcelasAtivas'

beforeEach(() => { fake.chamadas.length = 0; fake.resposta.error = null; fake.resposta.data = [] })

describe('listarParcelasQueAcabam', () => {
  it('chama installments_ending_soon com a família e os dias (60 por padrão) e converte reais do banco em centavos inteiros', async () => {
    fake.resposta.data = [
      { row_kind: 'plan', currency_code: 'BRL', plan_key: 'card:k1:p1', description: 'Bagaggio', source_name: 'Nubank', last_due: '2027-01-15', freed_monthly: '250.00', plan_count: null },
      { row_kind: 'plan', currency_code: 'BRL', plan_key: 'account:g1', description: 'Pacco', source_name: 'Itaú', last_due: '2026-12-20', freed_monthly: 211.54, plan_count: null },
      { row_kind: 'total', currency_code: 'BRL', plan_key: null, description: null, source_name: null, last_due: null, freed_monthly: '461.54', plan_count: 2 },
    ]
    const r = await listarParcelasQueAcabam('h1')
    expect(fake.chamadas).toEqual([['installments_ending_soon', { p_household: 'h1', p_days: 60 }]])
    expect(r.planos).toEqual([
      { chave: 'card:k1:p1', moeda: 'BRL', descricao: 'Bagaggio', origemNome: 'Nubank', ultimoVencimento: '2027-01-15', valor: 25000 },
      { chave: 'account:g1', moeda: 'BRL', descricao: 'Pacco', origemNome: 'Itaú', ultimoVencimento: '2026-12-20', valor: 21154 },
    ])
    expect(r.totais).toEqual([{ moeda: 'BRL', qtde: 2, liberado: 46154 }])
  })
  it('aceita outro horizonte; sem dados devolve vazio; erro do banco sobe (a tela segue sem o aviso)', async () => {
    await listarParcelasQueAcabam('h1', 90)
    expect(fake.chamadas[0][1]).toEqual({ p_household: 'h1', p_days: 90 })
    fake.resposta.data = null
    expect(await listarParcelasQueAcabam('h1')).toEqual({ planos: [], totais: [] })
    fake.resposta.error = { code: 'PGRST202' }
    await expect(listarParcelasQueAcabam('h1')).rejects.toMatchObject({ code: 'PGRST202' })
  })
})
