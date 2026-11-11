import { beforeEach, describe, expect, it, vi } from 'vitest'

// Instituição do ativo e totais da tela de posições (migration 106), com o banco de mentira
const fake = vi.hoisted(() => {
  const e = {
    ativos: [] as Record<string, unknown>[],
    /** colunas que o banco "não tem": pedir uma delas dá erro, como no banco sem a migration */
    colunasQueFaltam: [] as string[],
    colunasLidas: [] as string[],
    rpcs: [] as [string, Record<string, unknown>][],
    respostaRpc: {} as Record<string, { data: unknown; error: unknown }>,
  }
  const supabase = {
    from: (tabela: string) => ({
      select: (colunas: string) => ({
        eq: () => {
          // as três tabelas de histórico respondem direto no eq; a de ativos, no order
          const historico = Promise.resolve({ data: [], error: null })
          return Object.assign(historico, {
            order: () => {
              if (tabela === 'investment_assets') e.colunasLidas.push(colunas)
              const falta = e.colunasQueFaltam.find((c) => colunas.split(',').includes(c))
              return Promise.resolve(falta ? { data: null, error: { code: '42703', message: `column ${falta} does not exist` } } : { data: e.ativos, error: null })
            },
          })
        },
      }),
    }),
    rpc: (nome: string, args: Record<string, unknown>) => {
      e.rpcs.push([nome, args])
      return Promise.resolve(e.respostaRpc[nome] ?? { data: [], error: null })
    },
  }
  return { e, supabase }
})
vi.mock('./supabase', () => ({ supabase: fake.supabase }))

import { definirInstituicaoAtivo, listarAtivosInvestimento, listarInstituicoesInvestimentos, listarTotalProventos } from './investimentos'

const linha = (extra: Record<string, unknown> = {}) => ({
  id: 'a1', name: 'Tesouro de teste', ticker: null, asset_class: 'fixed_income', currency_code: 'BRL', active: true, ...extra,
})

beforeEach(() => {
  fake.e.ativos = []
  fake.e.colunasQueFaltam = []
  fake.e.colunasLidas = []
  fake.e.rpcs = []
  fake.e.respostaRpc = {}
})

describe('instituição do ativo (migration 106)', () => {
  it('lê a instituição junto com o ativo', async () => {
    fake.e.ativos = [linha({ subclass: 'Tesouro Direto', liquidity: 'liquid', institution: 'Corretora Teste' }), linha({ id: 'a2', institution: null })]
    const ativos = await listarAtivosInvestimento('h1')
    expect(ativos.map((a) => a.instituicao)).toEqual(['Corretora Teste', null])
    expect(fake.e.colunasLidas).toHaveLength(1)
    expect(fake.e.colunasLidas[0]).toMatch(/,institution$/)
  })

  it('banco ainda sem a coluna institution: lê de novo sem ela e a tela segue (instituição nula, liquidez preservada)', async () => {
    fake.e.colunasQueFaltam = ['institution']
    fake.e.ativos = [linha({ subclass: 'Previdência', liquidity: 'restricted' })]
    const ativos = await listarAtivosInvestimento('h1')
    expect(ativos).toHaveLength(1)
    expect(ativos[0]).toMatchObject({ instituicao: null, liquidez: 'restricted', subclasse: 'Previdência' })
    expect(fake.e.colunasLidas).toHaveLength(2)
    expect(fake.e.colunasLidas[1]).not.toMatch(/institution/)
  })

  it('definir instituição: tira os espaços das pontas; vazio vira nulo (limpa)', async () => {
    await definirInstituicaoAtivo('a1', '  Corretora Teste ')
    await definirInstituicaoAtivo('a1', '   ')
    expect(fake.e.rpcs).toEqual([
      ['investment_asset_set_institution', { p_asset: 'a1', p_institution: 'Corretora Teste' }],
      ['investment_asset_set_institution', { p_asset: 'a1', p_institution: null }],
    ])
  })

  it('totais por instituição: valor em centavos inteiros, instituição nula preservada', async () => {
    fake.e.respostaRpc.investment_institution_totals = { error: null, data: [
      { currency_code: 'BRL', institution: 'Corretora Teste', market_value: '1036.61' },
      { currency_code: 'BRL', institution: null, market_value: 0.1 },
    ] }
    expect(await listarInstituicoesInvestimentos('h1', '2026-11-11')).toEqual([
      { moeda: 'BRL', instituicao: 'Corretora Teste', valor: 103661 },
      { moeda: 'BRL', instituicao: null, valor: 10 },
    ])
    expect(fake.e.rpcs[0]).toEqual(['investment_institution_totals', { p_household: 'h1', p_as_of: '2026-11-11' }])
  })

  it('total de proventos do período: recebido e previsto em centavos, com as datas pedidas', async () => {
    fake.e.respostaRpc.investment_income_totals = { error: null, data: [{ currency_code: 'BRL', received: '12.84', planned: '5.00' }] }
    expect(await listarTotalProventos('h1', '2026-11-01', '2026-11-30')).toEqual([{ moeda: 'BRL', recebido: 1284, previsto: 500 }])
    expect(fake.e.rpcs[0]).toEqual(['investment_income_totals', { p_household: 'h1', p_from: '2026-11-01', p_to: '2026-11-30' }])
  })

  it('erro do banco sobe para quem chamou', async () => {
    fake.e.respostaRpc.investment_income_totals = { data: null, error: { code: 'PGRST202', message: 'função não existe' } }
    await expect(listarTotalProventos('h1', '2026-11-01', '2026-11-30')).rejects.toMatchObject({ code: 'PGRST202' })
  })
})
