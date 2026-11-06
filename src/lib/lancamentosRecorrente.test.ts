import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Cents } from './format'

// "Este e os próximos" (migration 073): o nome e os parâmetros da RPC têm de bater com o banco; depois, o UPDATE de sempre
const fake = vi.hoisted(() => {
  const chamadas: unknown[][] = []
  const resposta: { data: unknown; error: unknown } = { data: 4, error: null }
  const supabase = {
    rpc: (nome: string, args: Record<string, unknown>) => { chamadas.push(['rpc', nome, args]); return Promise.resolve(resposta) },
    from: (tabela: string) => ({
      update: (linha: Record<string, unknown>) => ({
        eq: (col: string, v: string) => { chamadas.push(['update', tabela, linha, col, v]); return Promise.resolve({ error: null }) },
      }),
    }),
  }
  return { chamadas, resposta, supabase }
})
vi.mock('./supabase', () => ({ supabase: fake.supabase }))

import { editarEsteEProximos, perguntaSeRepete } from './lancamentos'
import type { DadosLancamento, Lancamento } from './lancamentos'

const c = (n: number) => n as Cents
const luz: Lancamento = {
  id: 'r1', tipo: 'expense', contaId: 'a1', destinoId: null, categoriaId: 'mer', descricao: 'Luz', valor: c(10000),
  data: '2026-11-10', status: 'planned', notas: '', recorrente: true,
}
const dados: DadosLancamento = {
  tipo: 'expense', contaId: 'a1', destinoId: null, categoriaId: 'mer', descricao: 'Luz', valor: c(10000),
  data: '2026-11-10', status: 'planned', notas: '',
}

beforeEach(() => { fake.chamadas.length = 0; fake.resposta.data = 4; fake.resposta.error = null })

describe('perguntaSeRepete (#191)', () => {
  it('pergunta quando o recorrente muda valor, data, descrição ou categoria', () => {
    expect(perguntaSeRepete(luz, { ...dados, valor: c(12000) })).toBe(true)
    expect(perguntaSeRepete(luz, { ...dados, data: '2026-11-15' })).toBe(true)
    expect(perguntaSeRepete(luz, { ...dados, descricao: 'Energia' })).toBe(true)
    expect(perguntaSeRepete(luz, { ...dados, categoriaId: 'outra' })).toBe(true)
  })
  it('não pergunta: nada mudou, só situação/observação/conta, espaço na descrição, tipo trocado ou não é recorrente', () => {
    expect(perguntaSeRepete(luz, dados)).toBe(false)
    expect(perguntaSeRepete(luz, { ...dados, status: 'paid', notas: 'pago no app do banco', contaId: 'a2' })).toBe(false)
    expect(perguntaSeRepete(luz, { ...dados, descricao: ' Luz ' })).toBe(false)
    expect(perguntaSeRepete(luz, { ...dados, tipo: 'income', valor: c(1) })).toBe(false)
    expect(perguntaSeRepete({ ...luz, recorrente: false }, { ...dados, valor: c(12000) })).toBe(false)
    expect(perguntaSeRepete({ ...luz, recorrente: undefined }, { ...dados, valor: c(12000) })).toBe(false)
  })
})

describe('editarEsteEProximos (migration 073)', () => {
  it('chama recurrence_update_from com o valor em decimal montado dos centavos e depois grava o resto só neste', async () => {
    expect(await editarEsteEProximos('r1', { ...dados, valor: c(12050), data: '2026-11-15', descricao: ' Luz nova ', status: 'paid', notas: 'x' })).toBe(4)
    expect(fake.chamadas[0]).toEqual(['rpc', 'recurrence_update_from', {
      p_transaction: 'r1', p_date: '2026-11-15', p_description: 'Luz nova', p_amount: '120.50', p_category: 'mer',
    }])
    expect(fake.chamadas[1]).toEqual(['update', 'transactions', expect.objectContaining({ status: 'paid', notes: 'x', amount: '120.50' }), 'id', 'r1'])
  })
  it('transferência vai sem categoria', async () => {
    await editarEsteEProximos('r1', { ...dados, tipo: 'transfer', destinoId: 'a2', categoriaId: null })
    expect(fake.chamadas[0]).toEqual(['rpc', 'recurrence_update_from', expect.objectContaining({ p_category: null })])
  })
  it('erro do banco sobe e o UPDATE não roda', async () => {
    fake.resposta.data = null
    fake.resposta.error = { code: '22023', message: 'parâmetros inválidos' }
    await expect(editarEsteEProximos('r1', dados)).rejects.toMatchObject({ code: '22023' })
    expect(fake.chamadas).toHaveLength(1)
  })
})
