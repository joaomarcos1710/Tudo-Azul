import { beforeEach, describe, expect, it, vi } from 'vitest'

// etiquetas livres nas contas (migration 072), com o banco de mentira
const fake = vi.hoisted(() => {
  const e = {
    tabelas: {} as Record<string, { data: unknown; error: { code: string } | null }>,
    inseridos: [] as [string, Record<string, unknown>][],
    atualizados: [] as [string, Record<string, unknown>, string][],
    apagados: [] as [string, string][],
    rpcs: [] as [string, Record<string, unknown>][],
  }
  const supabase = {
    from: (t: string) => {
      const leitura = { eq: () => leitura, order: () => Promise.resolve(e.tabelas[t]), then: (ok: (r: unknown) => unknown) => Promise.resolve(e.tabelas[t]).then(ok) }
      return {
        select: () => leitura,
        insert: (v: Record<string, unknown>) => {
          e.inseridos.push([t, v])
          return { select: () => ({ single: () => Promise.resolve({ data: { id: 'nova', name: v.name }, error: null }) }) }
        },
        update: (v: Record<string, unknown>) => ({ eq: (_c: string, id: string) => { e.atualizados.push([t, v, id]); return Promise.resolve({ error: null }) } }),
        delete: () => ({ eq: (_c: string, id: string) => { e.apagados.push([t, id]); return Promise.resolve({ error: null }) } }),
      }
    },
    rpc: (nome: string, args: Record<string, unknown>) => { e.rpcs.push([nome, args]); return Promise.resolve({ error: null }) },
  }
  return { e, supabase }
})
vi.mock('./supabase', () => ({ supabase: fake.supabase }))

import { apagarEtiqueta, criarEtiqueta, definirEtiquetasDaConta, erroNomeEtiqueta, listarEtiquetas, mesmasEtiquetas, nomeEtiqueta, renomearEtiqueta } from './etiquetas'

beforeEach(() => {
  fake.e.inseridos.length = 0
  fake.e.atualizados.length = 0
  fake.e.apagados.length = 0
  fake.e.rpcs.length = 0
  fake.e.tabelas = {
    account_tags: { data: [{ id: 't2', name: 'Reserva' }, { id: 't1', name: 'Conjunta' }], error: null },
    account_tag_links: { data: [{ account_id: 'a1', tag_id: 't1' }, { account_id: 'a1', tag_id: 't2' }, { account_id: 'a2', tag_id: 't2' }], error: null },
  }
})

describe('listarEtiquetas', () => {
  it('devolve as etiquetas em ordem alfabética e as ligações por conta', async () => {
    const r = await listarEtiquetas('h1')
    expect(r.disponivel).toBe(true)
    expect(r.etiquetas.map((t) => t.nome)).toEqual(['Conjunta', 'Reserva'])
    expect(r.porConta.get('a1')).toEqual(['t1', 't2'])
    expect(r.porConta.get('a2')).toEqual(['t2'])
  })

  it('banco sem a migration 072: indisponível, sem quebrar a tela', async () => {
    fake.e.tabelas.account_tags = { data: null, error: { code: 'PGRST205' } }
    const r = await listarEtiquetas('h1')
    expect(r).toMatchObject({ disponivel: false, etiquetas: [] })
  })

  it('outro erro do banco é repassado', async () => {
    fake.e.tabelas.account_tag_links = { data: null, error: { code: '42501' } }
    await expect(listarEtiquetas('h1')).rejects.toMatchObject({ code: '42501' })
  })
})

describe('escrita', () => {
  it('cria com o nome aparado e devolve a etiqueta', async () => {
    expect(await criarEtiqueta('h1', '  Viagem   2027 ')).toEqual({ id: 'nova', nome: 'Viagem 2027' })
    expect(fake.e.inseridos).toEqual([['account_tags', { household_id: 'h1', name: 'Viagem 2027' }]])
  })

  it('renomeia, apaga e troca as etiquetas da conta numa chamada só (sem repetidas)', async () => {
    await renomearEtiqueta('t1', ' PJ ')
    await apagarEtiqueta('t2')
    await definirEtiquetasDaConta('a1', ['t1', 't1', 't3'])
    expect(fake.e.atualizados).toEqual([['account_tags', { name: 'PJ' }, 't1']])
    expect(fake.e.apagados).toEqual([['account_tags', 't2']])
    expect(fake.e.rpcs).toEqual([['account_tags_set', { p_account: 'a1', p_tags: ['t1', 't3'] }]])
  })
})

describe('regras do nome (as mesmas do banco)', () => {
  const existentes = [{ id: 't1', nome: 'Reserva de emergência' }]
  it('vazio, longo demais e repetido sem olhar maiúscula', () => {
    expect(erroNomeEtiqueta('   ', existentes)).toMatch(/Informe/)
    expect(erroNomeEtiqueta('x'.repeat(31), existentes)).toMatch(/30 caracteres/)
    expect(erroNomeEtiqueta('x'.repeat(30), existentes)).toBeNull()
    expect(erroNomeEtiqueta(' RESERVA DE EMERGÊNCIA ', existentes)).toMatch(/Já existe/)
    expect(erroNomeEtiqueta('Reserva de emergência', existentes, 't1')).toBeNull() // renomear para o próprio nome
  })
  it('nomeEtiqueta apara e junta espaços; mesmasEtiquetas ignora a ordem', () => {
    expect(nomeEtiqueta('  a   b ')).toBe('a b')
    expect(mesmasEtiquetas(['a', 'b'], ['b', 'a'])).toBe(true)
    expect(mesmasEtiquetas(['a'], ['a', 'b'])).toBe(false)
  })
})
