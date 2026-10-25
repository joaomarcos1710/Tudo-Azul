import { beforeEach, describe, expect, it, vi } from 'vitest'

// banco de mentira: cada chamada devolve a próxima resposta; guarda as colunas pedidas
const fake = vi.hoisted(() => {
  const estado = { colunas: [] as string[], respostas: [] as { data: unknown; error: unknown }[], rpc: { data: [] as unknown, error: null as unknown } as { data: unknown; error: unknown } | null }
  const b: Record<string, unknown> = {}
  b.select = (c: string) => { estado.colunas.push(c); return b }
  b.eq = () => b
  b.order = () => b
  b.then = (ok: (r: unknown) => unknown) => Promise.resolve(ok(estado.respostas.shift() ?? { data: [], error: null }))
  return { estado, supabase: { from: () => b, rpc: (nome: string) => Promise.resolve(nome === 'card_limits' && estado.rpc ? estado.rpc : { data: [], error: null }) } }
})
vi.mock('./supabase', () => ({ supabase: fake.supabase }))

import { listarCategorias } from './categorias'
import { listarCartoes } from './cartoes'

beforeEach(() => {
  fake.estado.colunas = []
  fake.estado.respostas = []
  fake.estado.rpc = { data: [], error: null }
})

describe('listarCategorias e a migration 012', () => {
  const linha = { id: 'c1', name: 'Salário', type: 'income', parent_id: null, system_key: null, active: true }

  it('sem pedir "eventual", nunca toca na coluna nova (as outras telas não quebram antes da migration)', async () => {
    fake.estado.respostas = [{ data: [linha], error: null }]
    const r = await listarCategorias('h1')
    expect(fake.estado.colunas).toEqual(['id, name, type, parent_id, system_key, active'])
    expect(r[0].eventual).toBe(false)
  })

  it('pedindo "eventual" e o banco ainda sem a coluna: lê sem ela, tudo regular', async () => {
    fake.estado.respostas = [{ data: null, error: { message: 'column categories.eventual does not exist' } }, { data: [linha], error: null }]
    const r = await listarCategorias('h1', { comEventual: true })
    expect(fake.estado.colunas).toHaveLength(2)
    expect(r.map((c) => c.eventual)).toEqual([false])
  })

  it('com a coluna, traz a marca', async () => {
    fake.estado.respostas = [{ data: [{ ...linha, eventual: true }], error: null }]
    expect((await listarCategorias('h1', { comEventual: true }))[0].eventual).toBe(true)
  })

  it('erro que não é da coluna (sem o retry resolver) continua sendo erro', async () => {
    fake.estado.respostas = [{ data: null, error: { message: 'x' } }, { data: null, error: { message: 'rede' } }]
    await expect(listarCategorias('h1', { comEventual: true })).rejects.toMatchObject({ message: 'rede' })
  })
})

describe('listarCartoes e a migration 011', () => {
  it('se card_limits falhar (banco sem a migration), os cartões aparecem sem limite', async () => {
    fake.estado.respostas = [{ data: [{ id: 'k1', name: 'Nubank', closing_day: 17, due_day: 25, active: true }], error: null }]
    fake.estado.rpc = { data: null, error: { message: 'function public.card_limits does not exist' } }
    const r = await listarCartoes('h1', '2026-10-31')
    expect(r).toHaveLength(1)
    expect(r[0].limite).toBeNull()
    expect(r[0].limiteDisponivel).toBeNull()
  })
})
