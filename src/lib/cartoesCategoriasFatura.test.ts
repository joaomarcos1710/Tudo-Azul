import { beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('./supabase', () => ({ supabase: { rpc: fake.rpc } }))

import { listarCategoriasDaFatura } from './cartoes'

beforeEach(() => { fake.rpc.mockReset() })

describe('listarCategoriasDaFatura (card_invoice_categories, migration 112)', () => {
  it('chama a função do banco com o cartão e o rótulo AAAA-MM e converte reais em centavos, sem somar nada', async () => {
    fake.rpc.mockResolvedValue({
      data: [
        { category_id: 'c1', name: 'Mercado', amount: '200.50', share: '77.0', total: '260.50' },
        { category_id: 'c2', name: 'Lazer', amount: 30, share: 11.5, total: 260.5 },
      ],
      error: null,
    })
    const r = await listarCategoriasDaFatura('k1', '2026-03')
    expect(fake.rpc).toHaveBeenCalledWith('card_invoice_categories', { p_debt: 'k1', p_label: '2026-03' })
    expect(r).toEqual([
      { categoriaId: 'c1', nome: 'Mercado', valor: 20050, percentual: 77, total: 26050 },
      { categoriaId: 'c2', nome: 'Lazer', valor: 3000, percentual: 11.5, total: 26050 },
    ])
  })

  it('sem linhas (ou data nulo) devolve lista vazia; erro do banco é propagado', async () => {
    fake.rpc.mockResolvedValue({ data: null, error: null })
    expect(await listarCategoriasDaFatura('k1', '2031-01')).toEqual([])
    const erro = { code: '42501', message: 'sem permissão' }
    fake.rpc.mockResolvedValue({ data: null, error: erro })
    await expect(listarCategoriasDaFatura('k1', '2026-03')).rejects.toBe(erro)
  })
})
