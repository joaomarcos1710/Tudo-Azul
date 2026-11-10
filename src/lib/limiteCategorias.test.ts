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
    expect(fake.estado.colunas).toEqual(['id, name, type, parent_id, system_key, active, color, icon'])
    expect(r[0].eventual).toBe(false)
    expect([r[0].icone, r[0].cor]).toEqual([null, null])
  })

  it('lê ícone e cor escolhidos (colunas da migration 001, sem risco de não existirem)', async () => {
    fake.estado.respostas = [{ data: [{ ...linha, icon: 'maleta', color: '#2563EB' }], error: null }]
    const r = await listarCategorias('h1')
    expect([r[0].icone, r[0].cor]).toEqual(['maleta', '#2563EB'])
  })

  it('pedindo "eventual" e o banco ainda sem a coluna: lê sem ela, tudo regular', async () => {
    fake.estado.respostas = [
      { data: null, error: { message: 'column categories.non_consumption does not exist' } },
      { data: null, error: { message: 'column categories.eventual does not exist' } },
      { data: [linha], error: null },
    ]
    const r = await listarCategorias('h1', { comEventual: true })
    expect(fake.estado.colunas).toHaveLength(3)
    expect(r.map((c) => c.eventual)).toEqual([false])
  })

  it('a regra 50-30-20 saiu da tela: budget_group não é mais pedido ao banco', async () => {
    fake.estado.respostas = [{ data: [{ ...linha, eventual: false, non_consumption: false }], error: null }]
    await listarCategorias('h1', { comEventual: true })
    expect(fake.estado.colunas.join(' ')).not.toMatch(/budget_group/)
  })

  it('com a 071, pede e traz "não conta como consumo"; sem a 071, cai para a leitura de antes e a marca fica false', async () => {
    fake.estado.respostas = [{ data: [{ ...linha, eventual: false, non_consumption: true }], error: null }]
    expect((await listarCategorias('h1', { comEventual: true }))[0].naoConsumo).toBe(true)
    expect(fake.estado.colunas[0]).toMatch(/, non_consumption$/)
    fake.estado.colunas = []
    fake.estado.respostas = [
      { data: null, error: { message: 'column categories.non_consumption does not exist' } },
      { data: [{ ...linha, eventual: true }], error: null },
    ]
    const r = await listarCategorias('h1', { comEventual: true })
    expect([r[0].eventual, r[0].naoConsumo]).toEqual([true, false])
    expect(fake.estado.colunas[1]).not.toMatch(/non_consumption/)
  })

  it('com a coluna, traz a marca', async () => {
    fake.estado.respostas = [{ data: [{ ...linha, eventual: true }], error: null }]
    expect((await listarCategorias('h1', { comEventual: true }))[0].eventual).toBe(true)
  })

  it('erro que não é da coluna (sem o retry resolver) continua sendo erro', async () => {
    fake.estado.respostas = [{ data: null, error: { message: 'x' } }, { data: null, error: { message: 'y' } }, { data: null, error: { message: 'rede' } }]
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
