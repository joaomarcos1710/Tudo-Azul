import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Cents } from './format'

const fake = vi.hoisted(() => {
  // consulta encadeada do PostgREST: cada filtro é registrado e o await devolve `resultado`
  const consulta = { chamadas: [] as [string, unknown[]][], resultado: { data: [] as unknown, error: null as unknown } }
  const builder: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'is', 'gte', 'lte', 'order', 'in', 'limit']) {
    builder[m] = (...args: unknown[]) => { consulta.chamadas.push([m, args]); return builder }
  }
  builder.then = (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) => Promise.resolve(consulta.resultado).then(ok, falha)
  return { rpc: vi.fn(), from: vi.fn(() => builder), consulta }
})
vi.mock('./supabase', () => ({ supabase: { rpc: fake.rpc, from: fake.from } }))
vi.mock('./contas', () => ({ COLUNA_INEXISTENTE: '42703', hojeSP: () => '2026-10-30' }))

import { criarCartao, lancarCreditoNoCartao, listarCreditosDaFatura } from './cartoes'

beforeEach(() => {
  fake.rpc.mockReset()
  fake.rpc.mockResolvedValue({ data: 'card-1', error: null })
})

describe('criarCartao', () => {
  it('envia todos os dados em uma única RPC atômica', async () => {
    const id = await criarCartao({
      nome: '  Nubank  ', fechamento: 17, vencimento: 25, saldoAtual: 125050 as Cents,
      emissor: 'nubank', bandeira: 'mastercard', contaPagamentoId: 'account-1',
    })

    expect(id).toBe('card-1')
    expect(fake.rpc).toHaveBeenCalledTimes(1)
    expect(fake.rpc).toHaveBeenCalledWith('create_card', {
      p_name: 'Nubank',
      p_reference_date: '2026-10-29',
      p_reference_balance: '1250.50',
      p_closing_day: 17,
      p_due_day: 25,
      p_issuer: 'nubank',
      p_brand: 'mastercard',
      p_pay_account: 'account-1',
    })
  })

  it('envia nulls quando emissor, bandeira e conta pagadora não foram escolhidos', async () => {
    await criarCartao({ nome: 'Cartão simples', fechamento: 10, vencimento: 20, saldoAtual: 0 as Cents })
    expect(fake.rpc).toHaveBeenCalledTimes(1)
    expect(fake.rpc).toHaveBeenCalledWith('create_card', expect.objectContaining({
      p_issuer: null, p_brand: null, p_pay_account: null,
    }))
  })

  it('propaga erro do banco sem tentar criar etapas separadas', async () => {
    fake.rpc.mockResolvedValue({ data: null, error: new Error('conta pagadora inválida') })
    await expect(criarCartao({
      nome: 'Cartão inválido', fechamento: 17, vencimento: 25, saldoAtual: 0 as Cents,
      contaPagamentoId: 'foreign-account',
    })).rejects.toThrow('conta pagadora inválida')
    expect(fake.rpc).toHaveBeenCalledTimes(1)
  })
})

describe('lancarCreditoNoCartao', () => {
  it('chama card_credit_income com valor decimal, categoria de receita, descrição sem espaços e a chave', async () => {
    fake.rpc.mockResolvedValue({ data: 'ev-1', error: null })
    const id = await lancarCreditoNoCartao('card-1',
      { descricao: '  Estorno de IOF ', data: '2026-10-10', valor: 5050 as Cents, categoriaId: 'cat-inc' }, 'chave-1')
    expect(id).toBe('ev-1')
    expect(fake.rpc).toHaveBeenCalledTimes(1)
    expect(fake.rpc).toHaveBeenCalledWith('card_credit_income', {
      p_debt: 'card-1', p_date: '2026-10-10', p_amount: '50.50', p_category: 'cat-inc',
      p_description: 'Estorno de IOF', p_closing: null, p_idem: 'chave-1',
    })
  })

  it('envia a fatura escolhida (fechamento) e omite a chave quando não há', async () => {
    fake.rpc.mockResolvedValue({ data: 'ev-2', error: null })
    await lancarCreditoNoCartao('card-1',
      { descricao: 'Cashback', data: '2026-10-01', valor: 1000 as Cents, categoriaId: 'cat-inc', fechamento: '2026-11-17' })
    const [, params] = fake.rpc.mock.calls[0]
    expect(params).toMatchObject({ p_closing: '2026-11-17', p_amount: '10.00' })
    expect(params).not.toHaveProperty('p_idem')
  })

  it('propaga a recusa do banco (ex.: categoria de despesa)', async () => {
    fake.rpc.mockResolvedValue({ data: null, error: Object.assign(new Error('categoria de receita inválida'), { code: '23514' }) })
    await expect(lancarCreditoNoCartao('card-1',
      { descricao: 'x', data: '2026-10-01', valor: 100 as Cents, categoriaId: 'cat-exp' })).rejects.toThrow('categoria de receita inválida')
  })
})

describe('listarCreditosDaFatura', () => {
  beforeEach(() => {
    fake.consulta.chamadas = []
    fake.consulta.resultado = { data: [], error: null }
  })

  it('lê os créditos avulsos não anulados do mês do fechamento e converte para centavos', async () => {
    fake.consulta.resultado = {
      data: [{ id: 'e1', date: '2026-02-17', credit_date: '2026-02-03', amount: '12.34', category_id: 'cat-inc', note: 'Cashback' }],
      error: null,
    }
    const r = await listarCreditosDaFatura('card-1', '2026-02')
    expect(fake.from).toHaveBeenCalledWith('debt_events')
    expect(fake.consulta.chamadas).toEqual(expect.arrayContaining([
      ['eq', ['debt_id', 'card-1']], ['eq', ['kind', 'income_credit']], ['is', ['voided_at', null]],
      ['gte', ['date', '2026-02-01']], ['lte', ['date', '2026-02-28']],
    ]))
    expect(r).toEqual([{ id: 'e1', descricao: 'Cashback', dataCredito: '2026-02-03', fechamento: '2026-02-17', valor: 1234, categoriaId: 'cat-inc' }])
  })

  it('banco ainda sem a migration 052 (coluna inexistente): lista vazia, sem quebrar a tela', async () => {
    fake.consulta.resultado = { data: null, error: { code: '42703', message: 'column does not exist' } }
    await expect(listarCreditosDaFatura('card-1', '2026-02')).resolves.toEqual([])
  })

  it('outro erro do banco é propagado', async () => {
    fake.consulta.resultado = { data: null, error: { code: '42501', message: 'sem permissão' } }
    await expect(listarCreditosDaFatura('card-1', '2026-02')).rejects.toMatchObject({ code: '42501' })
  })
})
