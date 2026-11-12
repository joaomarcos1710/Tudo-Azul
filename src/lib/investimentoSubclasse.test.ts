import { beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => {
  const estado = {
    colunas: [] as string[],
    respostas: [] as { data: unknown; error: unknown }[],
    rpcs: [] as { nome: string; args: Record<string, unknown> }[],
    rpcResposta: { data: [] as unknown, error: null as unknown },
  }
  const b: Record<string, unknown> = {}
  b.select = (c: string) => { estado.colunas.push(c); return b }
  b.eq = () => b
  b.order = () => b
  b.then = (ok: (r: unknown) => unknown) => Promise.resolve(ok(estado.respostas.shift() ?? { data: [], error: null }))
  return {
    estado,
    supabase: {
      from: () => b,
      rpc: (nome: string, args: Record<string, unknown>) => { estado.rpcs.push({ nome, args }); return Promise.resolve(estado.rpcResposta) },
    },
  }
})
vi.mock('./supabase', () => ({ supabase: fake.supabase }))

import {
  definirSubclasseAtivo, listarAlocacaoInvestimentos, listarAtivosInvestimento, macroDaClasse,
} from './investimentos'
import type { ClasseAtivo } from './investimentos'

beforeEach(() => {
  fake.estado.colunas = []
  fake.estado.respostas = []
  fake.estado.rpcs = []
  fake.estado.rpcResposta = { data: [], error: null }
})

const linha = { id: 'a1', name: 'Tesouro Selic', ticker: null, asset_class: 'fixed_income', currency_code: 'BRL', active: true }

describe('macroDaClasse (a mesma regra da função investment_allocation)', () => {
  it.each<[ClasseAtivo, string]>([
    ['fixed_income', 'fixed_income'], ['equity', 'variable'], ['reit', 'variable'], ['etf', 'variable'], ['crypto', 'variable'],
    ['fund', 'other'], ['other', 'other'],
  ])('%s -> %s', (classe, macro) => {
    expect(macroDaClasse(classe)).toBe(macro)
  })
})

describe('listarAtivosInvestimento e a migration 034', () => {
  it('lê a subclasse quando a coluna existe', async () => {
    fake.estado.respostas = [{ data: [{ ...linha, subclass: 'Tesouro Direto' }], error: null }]
    const r = await listarAtivosInvestimento('h1')
    expect(fake.estado.colunas[0]).toContain('subclass')
    expect(fake.estado.colunas).toHaveLength(4)
    expect(r[0].quantidadeProventos).toBe(0)
    expect(r[0].subclasse).toBe('Tesouro Direto')
  })

  it('banco sem a coluna liquidity (antes da migration da liquidez): lê com a subclasse e o ativo fica líquido', async () => {
    // a primeira leitura pede também a cotação da bolsa (migration 109) e a segunda a instituição (106); sem a
    // liquidez, as três primeiras falham
    const semLiquidez = { data: null, error: { message: 'column investment_assets.liquidity does not exist' } }
    fake.estado.respostas = [semLiquidez, semLiquidez, semLiquidez, { data: [{ ...linha, subclass: 'Tesouro Direto' }], error: null }]
    const r = await listarAtivosInvestimento('h1')
    expect(fake.estado.colunas[0]).toContain('market_quote')
    expect(fake.estado.colunas[1]).toContain('institution')
    expect(fake.estado.colunas[1]).not.toContain('market_quote')
    expect(fake.estado.colunas[2]).toContain('liquidity')
    expect(fake.estado.colunas[2]).not.toContain('institution')
    expect(fake.estado.colunas[3]).toContain('subclass')
    expect(fake.estado.colunas[3]).not.toContain('liquidity')
    expect([r[0].subclasse, r[0].liquidez]).toEqual(['Tesouro Direto', 'liquid'])
  })

  it('ativo restrito vem como restrito; qualquer outro valor é líquido', async () => {
    fake.estado.respostas = [{ data: [{ ...linha, liquidity: 'restricted' }], error: null }]
    expect((await listarAtivosInvestimento('h1'))[0].liquidez).toBe('restricted')
  })

  it('banco sem a coluna subclass: lê sem ela e a subclasse fica vazia (nunca inventada)', async () => {
    const semColuna = { data: null, error: { message: 'column investment_assets.subclass does not exist' } }
    fake.estado.respostas = [semColuna, semColuna, semColuna, semColuna, { data: [linha], error: null }]
    const r = await listarAtivosInvestimento('h1')
    expect(fake.estado.colunas).toHaveLength(8)
    expect(fake.estado.colunas[4]).not.toContain('subclass')
    expect(r[0].subclasse).toBeNull()
  })

  it('erro que não é da coluna continua sendo erro', async () => {
    fake.estado.respostas = [{ data: null, error: { message: 'v' } }, { data: null, error: { message: 'w' } }, { data: null, error: { message: 'x' } }, { data: null, error: { message: 'y' } }, { data: null, error: { message: 'rede' } }]
    await expect(listarAtivosInvestimento('h1')).rejects.toMatchObject({ message: 'rede' })
  })
})

describe('listarAlocacaoInvestimentos', () => {
  it('chama investment_allocation e converte para centavos sem somar nada', async () => {
    fake.estado.rpcResposta = { error: null, data: [
      { currency_code: 'BRL', level: 'macro', macro: 'fixed_income', subclass: null, market_value: '800.50', share: '80.1' },
      { currency_code: 'BRL', level: 'subclass', macro: 'fixed_income', subclass: 'CDB', market_value: '200.00', share: 20 },
      { currency_code: 'USD', level: 'macro', macro: 'variable', subclass: null, market_value: 200, share: 100 },
    ] }
    const r = await listarAlocacaoInvestimentos('h1', '2026-11-02')
    expect(fake.estado.rpcs).toEqual([{ nome: 'investment_allocation', args: { p_household: 'h1', p_as_of: '2026-11-02' } }])
    expect(r.map((l) => [l.moeda, l.nivel, l.macro, l.subclasse, l.valor, l.percentual])).toEqual([
      ['BRL', 'macro', 'fixed_income', null, 80050, 80.1],
      ['BRL', 'subclass', 'fixed_income', 'CDB', 20000, 20],
      ['USD', 'macro', 'variable', null, 20000, 100],
    ])
  })

  it('erro do banco (migration ausente) sobe para a tela decidir', async () => {
    fake.estado.rpcResposta = { data: null, error: { message: 'function investment_allocation does not exist' } }
    await expect(listarAlocacaoInvestimentos('h1', '2026-11-02')).rejects.toBeTruthy()
  })
})

describe('definirSubclasseAtivo', () => {
  it('manda o texto aparado; vazio vira nulo (limpa)', async () => {
    await definirSubclasseAtivo('a1', '  CDB ')
    await definirSubclasseAtivo('a1', '   ')
    expect(fake.estado.rpcs.map((c) => [c.nome, c.args])).toEqual([
      ['investment_asset_set_subclass', { p_asset: 'a1', p_subclass: 'CDB' }],
      ['investment_asset_set_subclass', { p_asset: 'a1', p_subclass: null }],
    ])
  })

  it('erro do banco sobe', async () => {
    fake.estado.rpcResposta = { data: null, error: { message: 'subclasse inválida' } }
    await expect(definirSubclasseAtivo('a1', 'x')).rejects.toMatchObject({ message: 'subclasse inválida' })
  })
})

import { arquivarAtivoInvestimento, editarAtivoInvestimento, excluirAtivoInvestimento, reativarAtivoInvestimento } from './investimentos'

describe('gerir ativos (migration 037)', () => {
  it('editar: manda nome e código aparados (código vazio vira nulo) e a classe', async () => {
    await editarAtivoInvestimento({ ativoId: 'a1', nome: '  Tesouro Selic ', ticker: '   ', classe: 'fixed_income' })
    expect(fake.estado.rpcs).toEqual([{ nome: 'investment_asset_update', args: { p_asset: 'a1', p_name: 'Tesouro Selic', p_ticker: null, p_class: 'fixed_income' } }])
  })

  it('arquivar, reativar e excluir chamam as funções certas, só com o id do ativo', async () => {
    await arquivarAtivoInvestimento('a1')
    await reativarAtivoInvestimento('a1')
    await excluirAtivoInvestimento('a1')
    expect(fake.estado.rpcs.map((c) => [c.nome, c.args])).toEqual([
      ['investment_asset_archive', { p_asset: 'a1' }],
      ['investment_asset_unarchive', { p_asset: 'a1' }],
      ['investment_asset_delete', { p_asset: 'a1' }],
    ])
  })

  it('erro do banco sobe em todas', async () => {
    fake.estado.rpcResposta = { data: null, error: { message: 'ainda há posição aberta' } }
    await expect(arquivarAtivoInvestimento('a1')).rejects.toMatchObject({ message: 'ainda há posição aberta' })
    await expect(excluirAtivoInvestimento('a1')).rejects.toMatchObject({ message: 'ainda há posição aberta' })
    await expect(editarAtivoInvestimento({ ativoId: 'a1', nome: 'x', ticker: '', classe: 'other' })).rejects.toBeTruthy()
    await expect(reativarAtivoInvestimento('a1')).rejects.toBeTruthy()
  })
})

import { excluirAtivoComHistorico } from './investimentos'

describe('excluir ativo com histórico (migration 050)', () => {
  it('manda o id e o nome digitado e devolve as contagens', async () => {
    fake.estado.rpcResposta = { data: [{ operations: 7, valuations: 1, distributions: 0 }], error: null }
    await expect(excluirAtivoComHistorico('a1', 'CDB')).resolves.toEqual({ operacoes: 7, avaliacoes: 1, proventos: 0 })
    expect(fake.estado.rpcs[fake.estado.rpcs.length - 1]).toEqual({ nome: 'investment_asset_purge', args: { p_asset: 'a1', p_confirm_name: 'CDB' } })
  })

  it('nome errado: o erro do banco sobe', async () => {
    fake.estado.rpcResposta = { data: null, error: { code: '22023', message: 'Digite o nome exato do ativo para confirmar a exclusão.' } }
    await expect(excluirAtivoComHistorico('a1', 'x')).rejects.toMatchObject({ code: '22023' })
  })
})
