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

import { criarCartao, lancarCreditoNoCartao, listarCreditosDaFatura, listarItens, trocarPessoaDaCompra, visaoDosCartoes } from './cartoes'

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

describe('visaoDosCartoes (card_overview, migration 065)', () => {
  const linhaCartao = {
    row_kind: 'card', debt_id: 'k1', name: 'Nubank',
    month_label: '2026-11', month_closing: '2026-11-17', month_due: '2026-11-25', month_total: '120.50', month_paid: '0', month_status: 'aberta',
    current_label: '2026-11', current_closing: '2026-11-17', current_due: '2026-11-25', current_total: '120.50',
    pending_subscriptions: '39.90', current_with_subscriptions: '160.40',
    oldest_open_label: '2026-10', oldest_open_due: '2026-10-25', oldest_open_remaining: '50.00',
    credit_limit: '1000.00', limit_used: '300.00', limit_available: '700.00',
  }
  const linhaTotal = {
    row_kind: 'total', debt_id: null, name: null, month_label: '2026-11', month_total: '999.99', month_paid: '10.00',
    current_total: '120.50', pending_subscriptions: '39.90', current_with_subscriptions: '160.40', oldest_open_remaining: '50.00',
    credit_limit: '1000.00', limit_used: '300.00', limit_available: '700.00',
  }

  it('uma chamada para a família; o mês vai como 1º dia; centavos inteiros; os totais são os do banco (não a soma das linhas)', async () => {
    fake.rpc.mockResolvedValue({ data: [linhaCartao, linhaTotal], error: null })
    const v = await visaoDosCartoes('h1', '2026-11')
    expect(fake.rpc).toHaveBeenCalledTimes(1)
    expect(fake.rpc).toHaveBeenCalledWith('card_overview', { p_household: 'h1', p_month: '2026-11-01' })
    expect(v?.cartoes).toEqual([{
      id: 'k1', nome: 'Nubank',
      doMes: { mes: '2026-11', fechamento: '2026-11-17', vencimento: '2026-11-25', total: 12050, pago: 0, situacao: 'aberta' },
      atual: { mes: '2026-11', vencimento: '2026-11-25', total: 12050 },
      assinaturasPrevistas: 3990, atualComAssinaturas: 16040, fechadaMes: '2026-10', fechadaVencimento: '2026-10-25',
    }])
    // 999,99 ≠ 120,50: a tela usa o total do banco, nunca soma as linhas
    expect(v?.totais).toEqual({ faturasDoMes: 99999, pagoDoMes: 1000, assinaturasPrevistas: 3990, limite: 100000, limiteUsado: 30000, limiteDisponivel: 70000 })
  })

  it('sem mês: manda null (o banco usa a fatura atual de cada cartão); sem limite em nenhum cartão: limites nulos', async () => {
    fake.rpc.mockResolvedValue({ data: [{ ...linhaTotal, credit_limit: null, limit_used: null, limit_available: null }], error: null })
    const v = await visaoDosCartoes('h1', null)
    expect(fake.rpc).toHaveBeenCalledWith('card_overview', { p_household: 'h1', p_month: null })
    expect(v?.totais.limite).toBeNull()
    expect(v?.totais.limiteDisponivel).toBeNull()
  })

  it('cartão sem dias definidos: sem fatura do mês nem atual', async () => {
    fake.rpc.mockResolvedValue({ data: [{ ...linhaCartao, month_label: null, month_closing: null, current_label: null }, linhaTotal], error: null })
    const v = await visaoDosCartoes('h1', null)
    expect(v?.cartoes[0].doMes).toBeNull()
    expect(v?.cartoes[0].atual).toBeNull()
  })

  it('banco ainda sem a migration 065: null (a tela volta a ler por cartão); outro erro é lançado', async () => {
    fake.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'função não existe' } })
    expect(await visaoDosCartoes('h1', null)).toBeNull()
    fake.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'sem permissão' } })
    await expect(visaoDosCartoes('h1', null)).rejects.toMatchObject({ code: '42501' })
  })
})

describe('classificação por pessoa nas compras da fatura', () => {
  it('listarItens junta person_id e is_shared_expense das parcelas (card_items não traz)', async () => {
    fake.rpc.mockResolvedValue({
      data: [
        { installment_id: 'i1', plan: 'p1', seq: 1, plan_count: 3, description: 'TV', purchase_date: '2026-08-05', face: '100.00', remaining: '0', category_id: 'c1' },
        { installment_id: 'i2', plan: 'p2', seq: 1, plan_count: 1, description: 'Pizza', purchase_date: '2026-08-06', face: '50.00', remaining: '0', category_id: 'c1' },
      ], error: null,
    })
    fake.consulta.chamadas.length = 0
    fake.consulta.resultado = { data: [{ id: 'i1', person_id: 'pe1', is_shared_expense: false }, { id: 'i2', person_id: null, is_shared_expense: true }], error: null }
    const itens = await listarItens('card-1', '2026-08', { comPessoa: true })
    expect(fake.from).toHaveBeenCalledWith('debt_installments')
    expect(fake.consulta.chamadas).toContainEqual(['in', ['id', ['i1', 'i2']]])
    expect(itens.map((i) => [i.parcelaId, i.personId, i.isSharedExpense])).toEqual([['i1', 'pe1', false], ['i2', null, true]])
  })

  it('listarItens sem comPessoa não faz a leitura extra das parcelas', async () => {
    fake.rpc.mockResolvedValue({ data: [{ installment_id: 'i1', plan: 'p1', seq: 1, plan_count: 1, description: 'TV', purchase_date: null, face: '10', remaining: '0', category_id: 'c1' }], error: null })
    fake.from.mockClear()
    const itens = await listarItens('card-1', '2026-08')
    expect(fake.from).not.toHaveBeenCalled()
    expect(itens[0].personId).toBeUndefined()
  })

  it('trocarPessoaDaCompra chama card_purchase_set_person com a dívida, a compra e a classificação', async () => {
    fake.rpc.mockResolvedValue({ data: 3, error: null })
    expect(await trocarPessoaDaCompra('card-1', 'plano-1', { personId: 'pe2', isSharedExpense: false })).toBe(3)
    expect(fake.rpc).toHaveBeenCalledWith('card_purchase_set_person', { p_debt: 'card-1', p_plan: 'plano-1', p_person_id: 'pe2', p_is_shared_expense: false })
  })

  it('trocarPessoaDaCompra repassa o erro do banco', async () => {
    fake.rpc.mockResolvedValue({ data: null, error: { code: '23514', message: 'pessoa inativa' } })
    await expect(trocarPessoaDaCompra('card-1', 'plano-1', { personId: 'x', isSharedExpense: false })).rejects.toMatchObject({ code: '23514' })
  })
})
