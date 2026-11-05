import { beforeEach, describe, expect, it, vi } from 'vitest'

// as funções de lote só chamam as RPCs da migration 060: nomes e parâmetros têm de bater com o banco
const fake = vi.hoisted(() => {
  const chamadas: [string, Record<string, unknown>][] = []
  const resposta: { data: unknown; error: unknown } = { data: 3, error: null }
  const supabase = { rpc: (nome: string, args: Record<string, unknown>) => { chamadas.push([nome, args]); return Promise.resolve(resposta) } }
  return { chamadas, resposta, supabase }
})
vi.mock('./supabase', () => ({ supabase: fake.supabase }))

import {
  LIMITE_LOTE, marcarPagoEmLote, moverParaLixeiraEmLote, mudarCategoriaEmLote, restaurarDaLixeiraEmLote, voltarPlanejadoEmLote,
} from './lancamentos'

beforeEach(() => { fake.chamadas.length = 0; fake.resposta.data = 3; fake.resposta.error = null })

describe('edição em lote (migration 060)', () => {
  it('cada ação é uma RPC só, com os parâmetros da função do banco, e devolve quantos mudaram', async () => {
    expect(await mudarCategoriaEmLote(['a', 'b'], 'cat')).toBe(3)
    expect(await marcarPagoEmLote(['a'], '2026-11-05')).toBe(3)
    expect(await voltarPlanejadoEmLote(['a', 'b'], ['2026-11-01', '2026-11-02'])).toBe(3)
    expect(await moverParaLixeiraEmLote(['a'])).toBe(3)
    expect(await restaurarDaLixeiraEmLote(['a'])).toBe(3)
    expect(fake.chamadas).toEqual([
      ['transactions_bulk_set_category', { p_ids: ['a', 'b'], p_category: 'cat' }],
      ['transactions_bulk_mark_paid', { p_ids: ['a'], p_date: '2026-11-05' }],
      ['transactions_bulk_mark_planned', { p_ids: ['a', 'b'], p_dates: ['2026-11-01', '2026-11-02'] }],
      ['transactions_bulk_trash', { p_ids: ['a'] }],
      ['transactions_bulk_restore', { p_ids: ['a'] }],
    ])
    expect(LIMITE_LOTE).toBe(500)
  })

  it('erro do banco sobe para a tela (não vira "0 alterados")', async () => {
    fake.resposta.data = null
    fake.resposta.error = { code: '23514', message: 'categoria de despesa só em despesa' }
    await expect(mudarCategoriaEmLote(['a'], 'cat')).rejects.toMatchObject({ code: '23514' })
  })
})
