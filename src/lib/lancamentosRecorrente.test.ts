import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Cents } from './format'

// "Este e os próximos" (migration 074): o nome e os parâmetros da RPC têm de bater com o banco; uma chamada só (sem UPDATE depois)
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

import { editarEsteEProximos, pararDeRepetirAPartirDe, perguntaSeRepete } from './lancamentos'
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

describe('perguntaSeRepete (#194)', () => {
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

describe('editarEsteEProximos (migration 074)', () => {
  it('UMA chamada: recurrence_update_from com o formulário inteiro (valor em decimal dos centavos, situação, observação, conta)', async () => {
    expect(await editarEsteEProximos('r1', { ...dados, valor: c(12050), data: '2026-11-15', descricao: ' Luz nova ', status: 'paid', notas: ' x ', contaId: 'a2' })).toBe(4)
    expect(fake.chamadas).toEqual([['rpc', 'recurrence_update_from', {
      p_transaction: 'r1', p_date: '2026-11-15', p_description: 'Luz nova', p_amount: '120.50', p_category: 'mer',
      p_status: 'paid', p_notes: 'x', p_account: 'a2', p_destination: null,
    }]])
  })
  it('observação vazia vai nula; transferência vai sem categoria e com o destino', async () => {
    await editarEsteEProximos('r1', { ...dados, tipo: 'transfer', destinoId: 'a2', categoriaId: 'mer', notas: '   ' })
    expect(fake.chamadas).toEqual([['rpc', 'recurrence_update_from', expect.objectContaining({ p_category: null, p_destination: 'a2', p_notes: null })]])
  })
  it('erro do banco sobe e nada mais é chamado', async () => {
    fake.resposta.data = null
    fake.resposta.error = { code: '55000', message: 'a conta já foi conciliada' }
    await expect(editarEsteEProximos('r1', { ...dados, status: 'paid' })).rejects.toMatchObject({ code: '55000' })
    expect(fake.chamadas).toHaveLength(1)
  })
})

describe('pararDeRepetirAPartirDe (recurrence_end)', () => {
  it('manda a véspera da ocorrência como data final: esta e as próximas planejadas saem, as anteriores ficam', async () => {
    await pararDeRepetirAPartirDe('r1', '2026-12-10')
    expect(fake.chamadas).toEqual([['rpc', 'recurrence_end', { p_id: 'r1', p_end: '2026-12-09' }]])
  })
  it('a véspera atravessa mês e ano', async () => {
    await pararDeRepetirAPartirDe('r1', '2026-12-01')
    await pararDeRepetirAPartirDe('r1', '2027-01-01')
    await pararDeRepetirAPartirDe('r1', '2028-03-01')
    expect(fake.chamadas.map((x) => (x[2] as { p_end: string }).p_end)).toEqual(['2026-11-30', '2026-12-31', '2028-02-29'])
  })
  it('recusa do banco sobe como erro', async () => {
    fake.resposta.error = { code: '42501' }
    await expect(pararDeRepetirAPartirDe('r1', '2026-12-10')).rejects.toMatchObject({ code: '42501' })
  })
})
