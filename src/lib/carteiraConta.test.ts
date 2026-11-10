import { beforeEach, describe, expect, it, vi } from 'vitest'

// Carteira como conta interna (migration 100, decisão do dono de 10/11/2026), com o banco de mentira
const fake = vi.hoisted(() => {
  const e = {
    contas: [] as Record<string, unknown>[],
    colunasLidas: [] as string[],
    rpcs: [] as [string, Record<string, unknown>][],
    respostaRpc: {} as Record<string, { data: unknown; error: unknown }>,
  }
  const supabase = {
    from: () => ({
      select: (colunas: string) => ({
        eq: () => ({
          order: () => { e.colunasLidas.push(colunas); return Promise.resolve({ data: e.contas, error: null }) },
        }),
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

import { listarContas } from './contas'
import { moverContaParaCarteira, registrarAvaliacaoTotal, registrarOperacaoInvestimento, registrarOperacaoPorValor } from './investimentos'
import type { Cents } from './format'

const linha = (id: string, nome: string, extra: Record<string, unknown> = {}) => ({
  id, name: nome, type: 'checking', initial_balance: '0', opening_date: '2026-01-01', active: true, bank: null, currency_code: 'BRL', ...extra,
})
const operacao = { ativoId: 'a1', data: '2026-11-10', tipo: 'buy' as const, quantidade: '1', precoUnitario: '100', tarifas: 0 as Cents, observacao: '' }

beforeEach(() => {
  fake.e.contas = []
  fake.e.colunasLidas = []
  fake.e.rpcs = []
  fake.e.respostaRpc = {}
})

describe('listarContas e a conta interna da carteira', () => {
  it('a carteira nunca aparece na lista de contas; vem à parte, só com o nome, para dar nome às transferências', async () => {
    fake.e.contas = [linha('c1', 'Itaú'), linha('k1', 'Carteira de investimentos', { system_role: 'investment_portfolio', type: 'brokerage' })]
    const r = await listarContas('h1', '2026-11-10')
    expect(fake.e.colunasLidas[0]).toContain('system_role')
    expect(r.contas.map((c) => c.id)).toEqual(['c1'])
    expect(r.internas).toEqual([{ id: 'k1', nome: 'Carteira de investimentos' }])
  })

  it('banco sem a coluna system_role (antes da migration 100): todas as contas são comuns', async () => {
    fake.e.contas = [linha('c1', 'Itaú')]
    const r = await listarContas('h1', '2026-11-10')
    expect(r.internas).toEqual([])
    expect(r.contas).toHaveLength(1)
  })
})

describe('compra e venda com conta', () => {
  it('com conta, manda p_account; sem conta, não manda (funciona no banco sem a migration 100)', async () => {
    await registrarOperacaoInvestimento({ ...operacao, contaId: 'c1' })
    await registrarOperacaoInvestimento(operacao)
    expect(fake.e.rpcs[0][0]).toBe('investment_operation_record')
    expect(fake.e.rpcs[0][1]).toMatchObject({ p_account: 'c1' })
    expect(fake.e.rpcs[1][1]).not.toHaveProperty('p_account')
  })
})

describe('aporte, resgate e avaliação só pelo valor (migration 104)', () => {
  it('manda o valor como texto decimal exato; nem quantidade nem preço saem do front', async () => {
    await registrarOperacaoPorValor({ ativoId: 'a1', data: '2026-11-10', tipo: 'buy', valor: 50007 as Cents, observacao: ' aporte ', contaId: 'c1' })
    await registrarOperacaoPorValor({ ativoId: 'a1', data: '2026-11-11', tipo: 'sell', valor: 1 as Cents, observacao: '' })
    expect(fake.e.rpcs).toEqual([
      ['investment_operation_record_by_value', { p_asset: 'a1', p_date: '2026-11-10', p_kind: 'buy', p_amount: '500.07', p_notes: 'aporte', p_account: 'c1' }],
      ['investment_operation_record_by_value', { p_asset: 'a1', p_date: '2026-11-11', p_kind: 'sell', p_amount: '0.01', p_notes: null, p_account: null }],
    ])
  })

  it('avaliação pelo total: o banco divide pelas unidades', async () => {
    await registrarAvaliacaoTotal({ ativoId: 'a1', data: '2026-11-10', valor: 103661 as Cents, fonte: ' Extrato ' })
    expect(fake.e.rpcs).toEqual([['investment_valuation_record_total', { p_asset: 'a1', p_date: '2026-11-10', p_total: '1036.61', p_source: 'Extrato' }]])
  })

  it('erro do banco sobe para a tela', async () => {
    fake.e.respostaRpc.investment_operation_record_by_value = { data: null, error: new Error('resgate maior que o valor do ativo') }
    await expect(registrarOperacaoPorValor({ ativoId: 'a1', data: '2026-11-10', tipo: 'sell', valor: 100 as Cents, observacao: '' })).rejects.toThrow(/resgate maior/)
  })
})

describe('mover conta para a carteira', () => {
  it('chama account_move_to_portfolio só com conta, nome, classe, liquidez e subclasse: o valor sai do banco', async () => {
    fake.e.respostaRpc.account_move_to_portfolio = { data: 'ativo-novo', error: null }
    const id = await moverContaParaCarteira({ contaId: 'c9', nome: ' Ações BTG ', classe: 'equity', liquidez: 'liquid', subclasse: '' })
    expect(id).toBe('ativo-novo')
    expect(fake.e.rpcs).toEqual([['account_move_to_portfolio', {
      p_account: 'c9', p_name: 'Ações BTG', p_class: 'equity', p_liquidity: 'liquid', p_subclass: null,
    }]])
  })

  it('erro do banco sobe (ex.: conta sem saldo)', async () => {
    fake.e.respostaRpc.account_move_to_portfolio = { data: null, error: { message: 'saldo zero' } }
    await expect(moverContaParaCarteira({ contaId: 'c9', nome: 'X', classe: 'equity', liquidez: 'liquid', subclasse: '' })).rejects.toMatchObject({ message: 'saldo zero' })
  })
})
