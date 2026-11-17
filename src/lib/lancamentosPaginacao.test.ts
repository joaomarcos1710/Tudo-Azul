import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Paginação das listas de Lançamentos (pendência da #418, 17/11/2026): o servidor corta cada resposta em 1000 linhas
 * (`max_rows` do supabase/config.toml). Antes, um período longo vinha cortado nas 1000 mais recentes sem aviso e a busca
 * perdia achados; agora as duas leem página por página, em ordem total, até acabar.
 */
const fake = vi.hoisted(() => {
  const estado = {
    transacoes: [] as Record<string, unknown>[],
    achados: [] as { source: string; id: string }[],
    /** código de erro da primeira consulta de transações (colunas novas ausentes no banco), ou null */
    erroNaPrimeira: null as string | null,
    consultas: [] as { colunas: string; ordens: string[]; faixa: [number, number] }[],
    chamadasRpc: [] as { nome: string; ordens: string[]; faixa: [number, number] }[],
  }
  function builder(resolver: (faixa: [number, number]) => { data: unknown; error: unknown }, registrar: (ordens: string[], faixa: [number, number]) => void) {
    const ordens: string[] = []
    let faixa: [number, number] = [0, 999]
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'is', 'in', 'not', 'gte', 'lte', 'or']) b[m] = () => b
    b.order = (c: string) => { ordens.push(c); return b }
    b.range = (de: number, ate: number) => { faixa = [de, ate]; return b }
    b.then = (ok: (r: { data: unknown; error: unknown }) => unknown) => {
      registrar(ordens, faixa)
      return Promise.resolve(ok(resolver(faixa)))
    }
    return b
  }
  const supabase = {
    from: (_t: string) => {
      let colunas = ''
      const b = builder(
        (faixa) => {
          if (estado.erroNaPrimeira && estado.consultas.length === 1) return { data: null, error: { code: estado.erroNaPrimeira, message: 'coluna' } }
          return { data: estado.transacoes.slice(faixa[0], faixa[1] + 1), error: null }
        },
        (ordens, faixa) => { estado.consultas.push({ colunas, ordens, faixa }) },
      )
      const select = b.select as () => unknown
      b.select = (c: string) => { colunas = c; return select() }
      return b
    },
    rpc: (nome: string) => builder(
      (faixa) => ({ data: estado.achados.slice(faixa[0], faixa[1] + 1), error: null }),
      (ordens, faixa) => { estado.chamadasRpc.push({ nome, ordens, faixa }) },
    ),
  }
  return { estado, supabase }
})
vi.mock('./supabase', () => ({ supabase: fake.supabase }))

import { buscarNoPeriodo, listarLancamentosNoPeriodo, LIMITE_LINHAS_SERVIDOR, TETO_LINHAS_LISTA } from './lancamentos'

const linha = (i: number) => ({
  id: `t${i}`, type: 'expense', account_id: 'a1', destination_account_id: null, category_id: null, description: `Item ${i}`,
  amount: '10.00', date: '2026-10-15', status: 'paid', notes: null, recurrence_id: null, person_id: null, is_shared_expense: false,
})

beforeEach(() => {
  fake.estado.transacoes = []
  fake.estado.achados = []
  fake.estado.erroNaPrimeira = null
  fake.estado.consultas.length = 0
  fake.estado.chamadasRpc.length = 0
})

describe('listarLancamentosNoPeriodo lê página por página', () => {
  it('2.500 linhas: três consultas de 1000, em ordem total (data, criação, id), e nenhuma linha some', async () => {
    fake.estado.transacoes = Array.from({ length: 2500 }, (_, i) => linha(i))
    const r = await listarLancamentosNoPeriodo('h1', '2026-01-01', '2026-12-31')
    expect(r).toHaveLength(2500)
    expect(r[0].id).toBe('t0')
    expect(r[2499].id).toBe('t2499')
    expect(fake.estado.consultas.map((c) => c.faixa)).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
    expect(fake.estado.consultas[0].ordens).toEqual(['date', 'created_at', 'id'])
  })

  it('exatamente 1000 linhas: pede mais uma página (vazia) para ter certeza de que acabou', async () => {
    fake.estado.transacoes = Array.from({ length: LIMITE_LINHAS_SERVIDOR }, (_, i) => linha(i))
    const r = await listarLancamentosNoPeriodo('h1', '2026-10-01', '2026-10-31')
    expect(r).toHaveLength(1000)
    expect(fake.estado.consultas).toHaveLength(2)
  })

  it('poucas linhas ou nenhuma: uma consulta só', async () => {
    fake.estado.transacoes = [linha(1), linha(2)]
    expect(await listarLancamentosNoPeriodo('h1', '2026-10-01', '2026-10-31')).toHaveLength(2)
    expect(fake.estado.consultas).toHaveLength(1)
    fake.estado.consultas.length = 0
    fake.estado.transacoes = []
    expect(await listarLancamentosNoPeriodo('h1', '2026-10-01', '2026-10-31')).toEqual([])
    expect(fake.estado.consultas).toHaveLength(1)
  })

  it('banco sem as colunas novas: refaz com as colunas antigas e continua paginando', async () => {
    fake.estado.erroNaPrimeira = '42703'
    fake.estado.transacoes = Array.from({ length: 1200 }, (_, i) => linha(i))
    const r = await listarLancamentosNoPeriodo('h1', '2026-10-01', '2026-10-31')
    expect(r).toHaveLength(1200)
    expect(fake.estado.consultas[0].colunas).toContain('person_id')
    expect(fake.estado.consultas[1].colunas).not.toContain('person_id')
    expect(fake.estado.consultas.slice(1).map((c) => c.faixa)).toEqual([[0, 999], [1000, 1999]])
  })

  it('passa do teto de páginas: para nele (a tela avisa que a lista está incompleta)', async () => {
    fake.estado.transacoes = Array.from({ length: TETO_LINHAS_LISTA + 5000 }, (_, i) => linha(i))
    const r = await listarLancamentosNoPeriodo('h1', '2026-01-01', '2026-12-31')
    expect(r).toHaveLength(TETO_LINHAS_LISTA)
    expect(fake.estado.consultas).toHaveLength(TETO_LINHAS_LISTA / LIMITE_LINHAS_SERVIDOR)
  })
})

describe('buscarNoPeriodo lê o resultado da busca página por página', () => {
  it('1.500 achados (lançamentos e cartão): duas chamadas em ordem por id, e todos os ids entram', async () => {
    fake.estado.achados = Array.from({ length: 1500 }, (_, i) => ({ source: i % 3 === 0 ? 'card' : 'transaction', id: `x${i}` }))
    const r = await buscarNoPeriodo('h1', '2026-01-01', '2026-12-31', 'flora', {})
    expect(r).not.toBeNull()
    expect(r!.lancamentos.size + r!.cartao.size).toBe(1500)
    expect(r!.cartao.size).toBe(500)
    expect(fake.estado.chamadasRpc.map((c) => c.faixa)).toEqual([[0, 999], [1000, 1999]])
    expect(fake.estado.chamadasRpc[0]).toMatchObject({ nome: 'ledger_search', ordens: ['id'] })
  })

  it('poucos achados: uma chamada só', async () => {
    fake.estado.achados = [{ source: 'transaction', id: 'a' }, { source: 'card', id: 'b' }]
    const r = await buscarNoPeriodo('h1', '2026-10-01', '2026-10-31', 'flora', {})
    expect([...r!.lancamentos]).toEqual(['a'])
    expect([...r!.cartao]).toEqual(['b'])
    expect(fake.estado.chamadasRpc).toHaveLength(1)
  })
})
