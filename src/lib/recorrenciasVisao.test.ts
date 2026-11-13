import { beforeEach, describe, expect, it, vi } from 'vitest'

// Visão geral dos recorrentes (migration 20261113120000): nome e parâmetro da RPC, e a conversão dos números do banco em centavos.
const fake = vi.hoisted(() => {
  const chamadas: unknown[][] = []
  const resposta: { data: unknown; error: unknown } = { data: [], error: null }
  return { chamadas, resposta, supabase: { rpc: (nome: string, args: unknown) => { chamadas.push([nome, args]); return Promise.resolve(resposta) } } }
})
vi.mock('./supabase', () => ({ supabase: fake.supabase }))

import { resumoVisaoGeral } from './recorrencias'

beforeEach(() => { fake.chamadas.length = 0; fake.resposta.error = null; fake.resposta.data = [] })

describe('resumoVisaoGeral', () => {
  it('chama recurrence_overview com a família e converte reais do banco (texto ou número) em centavos inteiros', async () => {
    fake.resposta.data = [
      { kind: 'expense', klass: 'all', item_count: 8, suggested_count: 6, total_monthly: '2417.52', total_yearly: '29010.23' },
      { kind: 'expense', klass: 'fixed', item_count: 6, suggested_count: 5, total_monthly: 2117.5, total_yearly: 25410.23 },
      { kind: 'income', klass: 'all', item_count: 2, suggested_count: 0, total_monthly: '5500.00', total_yearly: '66000.00' },
    ]
    const linhas = await resumoVisaoGeral('h1')
    expect(fake.chamadas).toEqual([['recurrence_overview', { p_household: 'h1' }]])
    expect(linhas).toEqual([
      { tipo: 'expense', recorte: 'all', qtde: 8, sugeridas: 6, porMes: 241752, porAno: 2901023 },
      { tipo: 'expense', recorte: 'fixed', qtde: 6, sugeridas: 5, porMes: 211750, porAno: 2541023 },
      { tipo: 'income', recorte: 'all', qtde: 2, sugeridas: 0, porMes: 550000, porAno: 6600000 },
    ])
    expect(linhas.every((l) => Number.isInteger(l.porMes) && Number.isInteger(l.porAno))).toBe(true)
  })

  it('sem linhas devolve lista vazia; erro do banco sobe (a tela cai no resumo de antes)', async () => {
    fake.resposta.data = null
    expect(await resumoVisaoGeral('h1')).toEqual([])
    fake.resposta.error = { code: 'PGRST202' }
    await expect(resumoVisaoGeral('h1')).rejects.toMatchObject({ code: 'PGRST202' })
  })
})
