import { describe, expect, it } from 'vitest'
import { sugerirRegras } from './regrasAutomaticas'
import type { RegraAutomatica } from './regrasAutomaticas'

const regra = (extra: Partial<RegraAutomatica>): RegraAutomatica => ({
  id: 'r1',
  nome: 'Mercado',
  trechoDescricao: 'mercado',
  tipo: 'expense',
  categoriaId: 'cat-alimentacao',
  ativa: true,
  prioridade: 0,
  ...extra,
})

describe('sugerirRegras', () => {
  it('ignora maiúsculas, acentos e espaços repetidos', () => {
    expect(sugerirRegras('  SUPERMERCADO   SÃO JOÃO ', 'expense', [
      regra({ trechoDescricao: 'sao joao', categoriaId: 'cat-mercado' }),
    ])).toEqual([{
      regraId: 'r1',
      nomeRegra: 'Mercado',
      categoriaId: 'cat-mercado',
      trechoCorrespondente: 'sao joao',
    }])
  })

  it('prioriza maior prioridade e depois critério mais específico', () => {
    const r = sugerirRegras('Compra no Mercado Central', 'expense', [
      regra({ id: 'generica', trechoDescricao: 'mercado', prioridade: 1 }),
      regra({ id: 'especifica', trechoDescricao: 'mercado central', prioridade: 1 }),
      regra({ id: 'alta', trechoDescricao: 'central', prioridade: 2 }),
    ])
    expect(r.map((x) => x.regraId)).toEqual(['alta', 'especifica', 'generica'])
  })

  it('ignora regra inativa, critério vazio e tipo incompatível', () => {
    const r = sugerirRegras('mercado', 'expense', [
      regra({ id: 'inativa', ativa: false }),
      regra({ id: 'vazia', trechoDescricao: '   ' }),
      regra({ id: 'receita', tipo: 'income' }),
    ])
    expect(r).toEqual([])
  })

  it('não sugere nada para descrição vazia', () => {
    expect(sugerirRegras('  ', 'expense', [regra({})])).toEqual([])
  })

  it('não altera as regras de entrada', () => {
    const regras = [regra({ trechoDescricao: '  Mercado  ' })]
    const antes = structuredClone(regras)
    sugerirRegras('mercado', 'expense', regras)
    expect(regras).toEqual(antes)
  })

  it('mantém tipos isolados, inclusive transferências', () => {
    expect(sugerirRegras('Pix mercado', 'transfer', [
      regra({ tipo: 'expense' }),
    ])).toEqual([])
  })
})
