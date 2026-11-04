import { beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => {
  const estado = { rpcs: [] as { nome: string; args: Record<string, unknown> }[] }
  return {
    estado,
    supabase: { rpc: (nome: string, args: Record<string, unknown>) => { estado.rpcs.push({ nome, args }); return Promise.resolve({ data: null, error: null }) } },
  }
})
vi.mock('./supabase', () => ({ supabase: fake.supabase }))

import { opcoesDeFatura, registrarCompra } from './cartoes'
import type { Cents } from './format'

beforeEach(() => { fake.estado.rpcs = [] })

describe('escolher a fatura da compra (migration 051)', () => {
  it('7 opções: 3 antes, a da data e 3 depois, pelo mês do fechamento', () => {
    const o = opcoesDeFatura('2026-07-10', 18)
    expect(o.map((x) => x.deslocamento)).toEqual([-3, -2, -1, 0, 1, 2, 3])
    expect(o[3].rotulo).toBe('Julho/2026 (a da data)')
    expect(o[0].rotulo).toBe('Abril/2026 (-3)')
    expect(o[6].rotulo).toBe('Outubro/2026 (+3)')
  })

  it('no dia do fechamento ou depois, a da data é a seguinte; vira o ano', () => {
    expect(opcoesDeFatura('2026-12-18', 18)[3].rotulo).toBe('Janeiro/2027 (a da data)')
    expect(opcoesDeFatura('2026-12-17', 18)[3].rotulo).toBe('Dezembro/2026 (a da data)')
    expect(opcoesDeFatura('2027-01-05', 18)[0].rotulo).toBe('Outubro/2026 (-3)')
  })

  it('data inválida: nenhuma opção', () => {
    expect(opcoesDeFatura('', 18)).toEqual([])
  })

  it('a compra vai para card_purchase_at com o deslocamento (0 quando não escolhido)', async () => {
    await registrarCompra('k1', { descricao: ' TV ', data: '2026-07-10', total: 30000 as Cents, parcelas: 3, categoriaId: 'g1' }, 'c1')
    await registrarCompra('k1', { descricao: 'TV', data: '2026-07-10', total: 100 as Cents, parcelas: 1, categoriaId: 'g1', deslocamento: -2 })
    expect(fake.estado.rpcs).toEqual([
      { nome: 'card_purchase_at', args: { p_debt: 'k1', p_date: '2026-07-10', p_total: '300.00', p_count: 3, p_category: 'g1', p_description: 'TV', p_invoice_offset: 0, p_idem: 'c1' } },
      { nome: 'card_purchase_at', args: { p_debt: 'k1', p_date: '2026-07-10', p_total: '1.00', p_count: 1, p_category: 'g1', p_description: 'TV', p_invoice_offset: -2 } },
    ])
  })
})
