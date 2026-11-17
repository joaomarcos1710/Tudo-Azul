import { beforeEach, describe, expect, it, vi } from 'vitest'

// consulta falsa que registra os filtros pedidos ao banco
const fake = vi.hoisted(() => {
  const estado = { filtros: {} as Record<string, unknown>, ordens: [] as string[], limite: 0, linhas: [] as Record<string, unknown>[], tabela: '' }
  const b: Record<string, unknown> = {}
  for (const m of ['eq', 'not']) b[m] = (...a: unknown[]) => { estado.filtros[`${m}:${a[0]}`] = a.slice(1); return b }
  b.select = () => b
  b.order = (c: string) => { estado.ordens.push(c); return b }
  b.limit = (n: number) => { estado.limite = n; return b }
  b.then = (ok: (r: { data: unknown; error: null }) => unknown) => Promise.resolve(ok({ data: estado.linhas, error: null }))
  return { estado, supabase: { from: (t: string) => { estado.tabela = t; return b } } }
})
vi.mock('./supabase', () => ({ supabase: fake.supabase }))

import { LIMITE_LIXEIRA, listarLixeira } from './lancamentos'

beforeEach(() => { fake.estado.filtros = {}; fake.estado.ordens = []; fake.estado.linhas = [] })

describe('listarLixeira', () => {
  it('lê só os excluídos da família, do mais recente ao mais antigo, até o limite, e converte o valor para centavos', async () => {
    fake.estado.linhas = [{
      id: 't1', type: 'expense', account_id: 'a1', destination_account_id: null, category_id: 'g1', description: 'Mercado',
      amount: '187.40', date: '2026-11-10', status: 'paid', notes: null, recurrence_id: null, deleted_at: '2026-11-17T01:30:00Z',
    }]
    const r = await listarLixeira('h1')
    expect(fake.estado.tabela).toBe('transactions')
    expect(fake.estado.filtros['eq:household_id']).toEqual(['h1'])
    expect(fake.estado.filtros['not:deleted_at']).toEqual(['is', null])
    expect(fake.estado.ordens[0]).toBe('deleted_at')
    expect(fake.estado.limite).toBe(LIMITE_LIXEIRA)
    expect(r).toEqual([expect.objectContaining({ id: 't1', tipo: 'expense', valor: 18740, descricao: 'Mercado', excluidoEm: '2026-11-17T01:30:00Z', recorrente: false })])
  })
})
