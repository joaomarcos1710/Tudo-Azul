import { beforeEach, describe, expect, it, vi } from 'vitest'

// banco de mentira: guarda cada chamada e devolve respostas programadas
const fake = vi.hoisted(() => {
  const e = {
    chamadas: [] as { op: string; tabela?: string; payload?: unknown; filtros: Record<string, unknown> }[],
    rpc: {} as Record<string, { data: unknown; error: unknown }>,
    tabelas: {} as Record<string, { data: unknown; error: unknown }>,
  }
  function from(tabela: string) {
    const ch: { op: string; tabela: string; payload?: unknown; filtros: Record<string, unknown> } = { op: 'select', tabela, filtros: {} }
    e.chamadas.push(ch)
    const b: Record<string, unknown> = {}
    b.select = () => b
    b.update = (p: unknown) => { ch.op = 'update'; ch.payload = p; return b }
    b.insert = (p: unknown) => { ch.op = 'insert'; ch.payload = p; return b }
    b.delete = () => { ch.op = 'delete'; return b }
    b.eq = (c: string, v: unknown) => { ch.filtros[c] = v; return b }
    b.then = (ok: (r: unknown) => unknown) => Promise.resolve(ok(e.tabelas[`${tabela}:${ch.op}:${ch.filtros.month ?? ''}`] ?? e.tabelas[`${tabela}:${ch.op}`] ?? { data: [], error: null }))
    return b
  }
  return { e, supabase: { from, rpc: (nome: string, args: unknown) => { e.chamadas.push({ op: `rpc:${nome}`, payload: args, filtros: {} }); return Promise.resolve(e.rpc[nome] ?? { data: [], error: null }) } } }
})
vi.mock('./supabase', () => ({ supabase: fake.supabase }))

import { copiarDoMesAnterior, definirOrcamento, listarOrcamentos, removerOrcamento } from './orcamentos'

beforeEach(() => {
  fake.e.chamadas = []
  fake.e.rpc = {}
  fake.e.tabelas = {}
})

const linhaProj = { category_id: 'c1', category_name: 'Mercado', amount_limit: '1000.00', spent: '300.00', planned: '200.00', pace_extra: '630.00', projected: '1130.00', remaining: '-130.00' }

describe('listarOrcamentos', () => {
  it('lê a projeção do banco em centavos e manda o primeiro dia do mês e a data de hoje', async () => {
    fake.e.rpc.budget_projection = { data: [linhaProj], error: null }
    // o "restante" (limite − gasto) vem do banco (budget_usage.remaining): a tela não faz essa conta
    fake.e.rpc.budget_usage = { data: [{ category_id: 'c1', remaining: '700.00' }], error: null }
    const r = await listarOrcamentos('h1', '2026-10', '2026-10-10')
    expect(r).toEqual([{ categoriaId: 'c1', nome: 'Mercado', limite: 100000, gasto: 30000, previsto: 20000, ritmo: 63000, projetado: 113000, sobra: -13000, restante: 70000 }])
    expect(fake.e.chamadas[0]).toMatchObject({ op: 'rpc:budget_projection', payload: { p_household: 'h1', p_month: '2026-10-01', p_today: '2026-10-10' } })
  })

  it('banco ainda sem a projeção (migration 013): cai para budget_usage, só com o gasto', async () => {
    fake.e.rpc.budget_projection = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.budget_projection' } }
    fake.e.rpc.budget_usage = { data: [{ category_id: 'c1', category_name: 'Mercado', amount_limit: '1000.00', spent: '300.00', remaining: '700.00' }], error: null }
    const r = await listarOrcamentos('h1', '2026-10', '2026-10-10')
    expect(r[0]).toMatchObject({ limite: 100000, gasto: 30000, projetado: null, sobra: null, previsto: null, ritmo: null, restante: 70000 })
  })

  it('erro que não é "função inexistente" (ex.: queda do banco) não vira "sem projeção" em silêncio', async () => {
    fake.e.rpc.budget_projection = { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }
    await expect(listarOrcamentos('h1', '2026-10', '2026-10-10')).rejects.toMatchObject({ code: '57014' })
  })

  it('se os dois falharem, o erro sobe', async () => {
    fake.e.rpc.budget_projection = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }
    fake.e.rpc.budget_usage = { data: null, error: { message: 'rede' } }
    await expect(listarOrcamentos('h1', '2026-10', '2026-10-10')).rejects.toMatchObject({ message: 'rede' })
  })
})

describe('definirOrcamento', () => {
  it('limite já existe: só atualiza o valor (o cliente só pode mudar amount_limit)', async () => {
    fake.e.tabelas['budgets:update'] = { data: [{ id: 'b1' }], error: null }
    await definirOrcamento('h1', 'c1', '2026-10', 150000 as never)
    expect(fake.e.chamadas.map((c) => c.op)).toEqual(['update'])
    expect(fake.e.chamadas[0].payload).toEqual({ amount_limit: '1500.00' })
    expect(fake.e.chamadas[0].filtros).toMatchObject({ household_id: 'h1', category_id: 'c1', month: '2026-10-01' })
  })

  it('limite novo: atualiza (nada), depois insere com as colunas permitidas', async () => {
    fake.e.tabelas['budgets:update'] = { data: [], error: null }
    await definirOrcamento('h1', 'c1', '2026-10', 150000 as never)
    expect(fake.e.chamadas.map((c) => c.op)).toEqual(['update', 'insert'])
    expect(fake.e.chamadas[1].payload).toEqual({ household_id: 'h1', category_id: 'c1', month: '2026-10-01', amount_limit: '1500.00' })
  })

  it('outra aba criou o mesmo limite no meio do caminho (23505): atualiza em vez de falhar', async () => {
    fake.e.tabelas['budgets:update'] = { data: [], error: null }
    fake.e.tabelas['budgets:insert'] = { data: null, error: { code: '23505', message: 'duplicate key' } }
    await definirOrcamento('h1', 'c1', '2026-10', 150000 as never)
    expect(fake.e.chamadas.map((c) => c.op)).toEqual(['update', 'insert', 'update'])
  })

  it('erro do banco sobe (ex.: categoria que não é principal)', async () => {
    fake.e.tabelas['budgets:update'] = { data: [], error: null }
    fake.e.tabelas['budgets:insert'] = { data: null, error: { message: 'orçamento só é permitido em categoria raiz' } }
    await expect(definirOrcamento('h1', 'c1', '2026-10', 100 as never)).rejects.toMatchObject({ message: expect.stringContaining('raiz') })
  })
})

describe('removerOrcamento', () => {
  it('apaga só o limite da categoria naquele mês', async () => {
    await removerOrcamento('h1', 'c1', '2026-10')
    expect(fake.e.chamadas[0]).toMatchObject({ op: 'delete', filtros: { household_id: 'h1', category_id: 'c1', month: '2026-10-01' } })
  })
})

describe('copiarDoMesAnterior', () => {
  it('copia os limites que faltam, com o mesmo valor, e não mexe nos que já existem', async () => {
    fake.e.tabelas['budgets:select:2026-09-01'] = { data: [{ category_id: 'a', amount_limit: '500.00' }, { category_id: 'b', amount_limit: '250.50' }], error: null }
    fake.e.tabelas['budgets:select:2026-10-01'] = { data: [{ category_id: 'b' }], error: null }
    const n = await copiarDoMesAnterior('h1', '2026-10', '2026-09')
    expect(n).toBe(1)
    const ins = fake.e.chamadas.find((c) => c.op === 'insert')
    expect(ins?.payload).toEqual([{ household_id: 'h1', category_id: 'a', month: '2026-10-01', amount_limit: '500.00' }])
  })

  it('nada a copiar: não grava', async () => {
    fake.e.tabelas['budgets:select:2026-09-01'] = { data: [], error: null }
    expect(await copiarDoMesAnterior('h1', '2026-10', '2026-09')).toBe(0)
    expect(fake.e.chamadas.some((c) => c.op === 'insert')).toBe(false)
  })
})
