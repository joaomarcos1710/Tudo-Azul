import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Cents } from './format'

// Proventos previstos (migration 20261113140000): nome e parâmetros das duas RPCs e a conversão em centavos.
const fake = vi.hoisted(() => {
  const chamadas: unknown[][] = []
  const resposta: { data: unknown; error: unknown } = { data: [], error: null }
  return { chamadas, resposta, supabase: { rpc: (nome: string, args: unknown) => { chamadas.push([nome, args]); return Promise.resolve(resposta) } } }
})
vi.mock('./supabase', () => ({ supabase: fake.supabase }))

import { listarProventosPrevistos, registrarProventosPrevistos } from './investimentos'

const c = (n: number) => n as Cents
beforeEach(() => { fake.chamadas.length = 0; fake.resposta.error = null; fake.resposta.data = [] })

describe('registrarProventosPrevistos', () => {
  it('manda a série (repetição em meses, data final e valor em reais com 2 casas) e devolve quantos o banco criou', async () => {
    fake.resposta.data = 12
    const n = await registrarProventosPrevistos({
      ativoId: 'a1', tipo: 'dividend', primeira: '2026-12-10', valor: c(8550), contaId: 'c1', cadaMeses: 1, ate: null, observacao: '  previsão  ',
    })
    expect(n).toBe(12)
    expect(fake.chamadas).toEqual([['investment_distribution_record_series', {
      p_asset: 'a1', p_kind: 'dividend', p_first: '2026-12-10', p_amount: '85.50', p_account: 'c1', p_every_months: 1, p_until: null, p_notes: 'previsão',
    }]])
  })
  it('observação vazia vira nulo; recusa do banco sobe como erro', async () => {
    await registrarProventosPrevistos({ ativoId: 'a1', tipo: 'jcp', primeira: '2026-12-10', valor: c(100), contaId: 'c1', cadaMeses: 3, ate: '2027-06-01', observacao: '  ' })
    expect((fake.chamadas[0][1] as { p_notes: unknown; p_until: unknown }).p_notes).toBeNull()
    expect((fake.chamadas[0][1] as { p_until: unknown }).p_until).toBe('2027-06-01')
    fake.resposta.error = { code: '22023' }
    await expect(registrarProventosPrevistos({ ativoId: 'a1', tipo: 'jcp', primeira: '2026-12-10', valor: c(100), contaId: 'c1', cadaMeses: 12, ate: null, observacao: '' }))
      .rejects.toMatchObject({ code: '22023' })
  })
})

describe('listarProventosPrevistos', () => {
  it('chama investment_planned_income e converte reais (texto ou número) em centavos inteiros', async () => {
    fake.resposta.data = [
      { asset_id: 'a1', asset_name: 'FII de teste', item_count: 12, next_date: '2026-12-10', next_amount: '85.50', total_12m: '1026.00' },
      { asset_id: 'a2', asset_name: 'Ação de teste', item_count: 4, next_date: '2027-01-15', next_amount: 40, total_12m: 160 },
    ]
    const linhas = await listarProventosPrevistos('h1')
    expect(fake.chamadas).toEqual([['investment_planned_income', { p_household: 'h1' }]])
    expect(linhas).toEqual([
      { ativoId: 'a1', nome: 'FII de teste', qtde: 12, proximaData: '2026-12-10', proximoValor: 8550, total12m: 102600 },
      { ativoId: 'a2', nome: 'Ação de teste', qtde: 4, proximaData: '2027-01-15', proximoValor: 4000, total12m: 16000 },
    ])
  })
  it('sem dados devolve lista vazia; erro do banco sobe (a tela segue sem o card)', async () => {
    fake.resposta.data = null
    expect(await listarProventosPrevistos('h1')).toEqual([])
    fake.resposta.error = { code: 'PGRST202' }
    await expect(listarProventosPrevistos('h1')).rejects.toMatchObject({ code: 'PGRST202' })
  })
})
