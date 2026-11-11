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

import {
  DIAS_COTACAO_PARADA, codigoDaBolsa, cotacaoParada, definirCotacaoBolsaAtivo, definirInstituicaoAtivo, listarAportesInvestimentos,
  listarAtivosInvestimento, listarInstituicoesInvestimentos, listarTotalProventos, segueABolsa,
} from './investimentos'
import type { ClasseAtivo, MoedaInvestimento } from './investimentos'

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
    expect(fake.e.colunasLidas[0]).toMatch(/,institution,market_quote$/)
  })

  it('banco ainda sem a coluna institution: lê de novo sem ela e a tela segue (instituição nula, liquidez preservada)', async () => {
    // banco anterior à 106 também não tem a coluna da cotação da bolsa (109)
    fake.e.colunasQueFaltam = ['institution', 'market_quote']
    fake.e.ativos = [linha({ subclass: 'Previdência', liquidity: 'restricted' })]
    const ativos = await listarAtivosInvestimento('h1')
    expect(ativos).toHaveLength(1)
    expect(ativos[0]).toMatchObject({ instituicao: null, liquidez: 'restricted', subclasse: 'Previdência', cotacaoBolsa: null })
    expect(fake.e.colunasLidas).toHaveLength(3)
    expect(fake.e.colunasLidas[2]).not.toMatch(/institution/)
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

describe('aportes e resgates (migration 107)', () => {
  it('separa as linhas por ativo das linhas de total e converte para centavos, sem conta nenhuma', async () => {
    fake.e.respostaRpc.investment_contributions = { error: null, data: [
      { level: 'asset', asset_id: 'a1', currency_code: 'BRL', contributed: '1000.00', redeemed: '550.00', net_contributed: '450.00', market_value: '550.00', total_result: '100.00' },
      { level: 'asset', asset_id: 'a2', currency_code: 'BRL', contributed: 1000, redeemed: 2000, net_contributed: -1000, market_value: 500, total_result: 1500 },
      { level: 'total', asset_id: null, currency_code: 'BRL', contributed: '2000.00', redeemed: '2550.00', net_contributed: '-550.00', market_value: '1050.00', total_result: '1600.00' },
      { level: 'total', asset_id: null, currency_code: 'USD', contributed: '10.10', redeemed: '0', net_contributed: '10.10', market_value: '9.99', total_result: '-0.11' },
    ] }
    const r = await listarAportesInvestimentos('h1', '2026-11-10')
    expect(fake.e.rpcs[0]).toEqual(['investment_contributions', { p_household: 'h1', p_as_of: '2026-11-10' }])
    expect([...r.porAtivo.keys()]).toEqual(['a1', 'a2'])
    expect(r.porAtivo.get('a1')).toEqual({ moeda: 'BRL', aportado: 100000, resgatado: 55000, liquido: 45000, valorAtual: 55000, ganho: 10000 })
    expect(r.porAtivo.get('a2')).toMatchObject({ liquido: -100000, ganho: 150000 }) // líquido negativo vem do banco como é
    expect(r.totais).toEqual([
      { moeda: 'BRL', aportado: 200000, resgatado: 255000, liquido: -55000, valorAtual: 105000, ganho: 160000 },
      { moeda: 'USD', aportado: 1010, resgatado: 0, liquido: 1010, valorAtual: 999, ganho: -11 },
    ])
  })

  it('banco sem a função: o erro sobe (a tela cai no custo do que está investido)', async () => {
    fake.e.respostaRpc.investment_contributions = { data: null, error: { code: 'PGRST202', message: 'função não existe' } }
    await expect(listarAportesInvestimentos('h1', '2026-11-10')).rejects.toMatchObject({ code: 'PGRST202' })
  })
})

describe('cotação da bolsa no ativo (migration 109)', () => {
  it('lê a escolha junto com o ativo: ligada, desligada', async () => {
    fake.e.ativos = [linha({ institution: null, market_quote: true }), linha({ id: 'a2', institution: null, market_quote: false })]
    const ativos = await listarAtivosInvestimento('h1')
    expect(ativos.map((a) => a.cotacaoBolsa)).toEqual([true, false])
    expect(fake.e.colunasLidas).toHaveLength(1)
  })

  it('banco ainda sem a coluna market_quote: lê de novo sem ela e a escolha vem nula (a opção não aparece na tela)', async () => {
    fake.e.colunasQueFaltam = ['market_quote']
    fake.e.ativos = [linha({ institution: 'Corretora Teste' })]
    const ativos = await listarAtivosInvestimento('h1')
    expect(ativos[0]).toMatchObject({ cotacaoBolsa: null, instituicao: 'Corretora Teste' })
    expect(fake.e.colunasLidas).toHaveLength(2)
    expect(fake.e.colunasLidas[1]).toMatch(/,institution$/)
  })

  it('ligar e desligar chamam a função do banco só com o ativo e a escolha', async () => {
    await definirCotacaoBolsaAtivo('a1', true)
    await definirCotacaoBolsaAtivo('a1', false)
    expect(fake.e.rpcs).toEqual([
      ['investment_asset_set_market_quote', { p_asset: 'a1', p_on: true }],
      ['investment_asset_set_market_quote', { p_asset: 'a1', p_on: false }],
    ])
  })

  it('a recusa do banco sobe (ex.: ativo lançado só pelo valor)', async () => {
    fake.e.respostaRpc.investment_asset_set_market_quote = { data: null, error: { code: '22023', message: 'este ativo tem lançamento só pelo valor' } }
    await expect(definirCotacaoBolsaAtivo('a1', true)).rejects.toMatchObject({ code: '22023' })
  })

  // a mesma tabela do teste do banco (103_market_quotes, S1 a S15): a tela só oferece o que o banco aceita
  it.each<[string | null, ClasseAtivo | '', MoedaInvestimento, string | null]>([
    ['TAZL3', 'equity', 'BRL', 'TAZL3'],
    ['  tazl11 ', 'reit', 'BRL', 'TAZL11'],
    ['TAZL11', 'etf', 'BRL', 'TAZL11'],
    ['TAZL11', 'fund', 'BRL', 'TAZL11'],
    ['TAZL3', 'equity', 'USD', null],
    ['TAZL3', 'fixed_income', 'BRL', null],
    ['TAZL3', 'crypto', 'BRL', null],
    ['TAZL3', 'other', 'BRL', null],
    ['TAZL3', '', 'BRL', null],
    [null, 'equity', 'BRL', null],
    ['', 'equity', 'BRL', null],
    ['BTC', 'equity', 'BRL', null],
    ['TAZL3F', 'equity', 'BRL', null],
    ['TAZL123', 'equity', 'BRL', null],
    ['TAZL3&x=1', 'equity', 'BRL', null],
  ])('codigoDaBolsa(%j, %j, %j) = %j', (ticker, classe, moeda, esperado) => {
    expect(codigoDaBolsa(ticker, classe, moeda)).toBe(esperado)
  })

  it('segueABolsa: precisa da escolha ligada E de o ativo ainda poder', () => {
    const base = { ticker: 'TAZL3', classe: 'equity' as ClasseAtivo, moeda: 'BRL' as MoedaInvestimento }
    expect(segueABolsa({ ...base, cotacaoBolsa: true })).toBe(true)
    expect(segueABolsa({ ...base, cotacaoBolsa: false })).toBe(false)
    expect(segueABolsa({ ...base, cotacaoBolsa: null })).toBe(false)
    expect(segueABolsa({ ...base, ticker: 'XX', cotacaoBolsa: true })).toBe(false) // o código deixou de ser da bolsa
    expect(segueABolsa({ ...base, ticker: null, cotacaoBolsa: true })).toBe(false)
  })

  it('cotacaoParada: avisa só depois de 4 dias corridos (fim de semana com feriado colado não é atraso)', () => {
    expect(DIAS_COTACAO_PARADA).toBe(4)
    expect(cotacaoParada('2026-11-11', '2026-11-11')).toBeNull()
    expect(cotacaoParada('2026-11-06', '2026-11-09')).toBeNull() // sexta vista na segunda
    expect(cotacaoParada('2026-11-06', '2026-11-10')).toBeNull() // sexta vista na terça (segunda feriado): 4 dias
    expect(cotacaoParada('2026-11-06', '2026-11-11')).toBe(5)
    expect(cotacaoParada('2026-10-01', '2026-11-11')).toBe(41)
    expect(cotacaoParada('2026-12-30', '2027-01-05')).toBe(6) // vira o ano
    expect(cotacaoParada(null, '2026-11-11')).toBe('sem-preco')
  })
})
