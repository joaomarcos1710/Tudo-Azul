import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({ supabase: { rpc } }))

import { listarParcelasAtivas } from './parcelasAtivas'

const plano = {
  row_kind: 'plan', currency_code: 'BRL', source_type: 'card', plan_key: 'card:k1:p1', description: 'Geladeira',
  source_id: 'k1', source_name: 'Nubank', installment_amount: '100.00', current_number: 5, total_count: 10, paid_count: 4,
  percent_paid: 40, total_amount: '1000.00', paid_amount: '400.00', remaining_amount: '600.00', future_amount: 500,
  month_status: 'pending', next_due: '2026-11-15', overdue_count: 1, plan_count: null,
}
const total = {
  row_kind: 'total', currency_code: 'BRL', source_type: null, plan_key: null, description: null, source_id: null, source_name: null,
  installment_amount: null, current_number: null, total_count: null, paid_count: null, percent_paid: null, total_amount: '1000.00',
  paid_amount: '400.00', remaining_amount: '600.00', future_amount: '500.00', month_status: null, next_due: null, overdue_count: null, plan_count: 1,
}

beforeEach(() => rpc.mockReset())

describe('listarParcelasAtivas', () => {
  it('chama a função do banco com a família e converte o dinheiro para centavos inteiros', async () => {
    rpc.mockResolvedValue({ data: [plano, total], error: null })
    const r = await listarParcelasAtivas('h1')
    expect(rpc).toHaveBeenCalledWith('active_installment_plans', { p_household: 'h1' })
    expect(r.parcelamentos).toEqual([{
      chave: 'card:k1:p1', origem: 'card', moeda: 'BRL', descricao: 'Geladeira', origemId: 'k1', origemNome: 'Nubank',
      valorParcela: 10000, parcelaAtual: 5, totalParcelas: 10, parcelasPagas: 4, percentualPago: 40,
      total: 100000, pago: 40000, saldoRestante: 60000, futuro: 50000, situacaoMes: 'pending',
      proximoVencimento: '2026-11-15', emAtraso: 1,
    }])
    expect(r.totais).toEqual([{ moeda: 'BRL', qtde: 1, saldoRestante: 60000, futuro: 50000 }])
  })

  it('o total é o que o banco mandou, sem soma no front', async () => {
    // dois parcelamentos de 600,00 e um total de 1,00: a função não soma nem confere
    rpc.mockResolvedValue({ data: [plano, { ...plano, plan_key: 'card:k1:p2' }, { ...total, remaining_amount: '1.00', future_amount: '0.00', plan_count: 2 }], error: null })
    const r = await listarParcelasAtivas('h1')
    expect(r.parcelamentos).toHaveLength(2)
    expect(r.totais).toEqual([{ moeda: 'BRL', qtde: 2, saldoRestante: 100, futuro: 0 }])
  })

  it('um total por moeda, sem misturar', async () => {
    rpc.mockResolvedValue({ data: [plano, total, { ...total, currency_code: 'USD', remaining_amount: '200.00', future_amount: '200.00' }], error: null })
    const r = await listarParcelasAtivas('h1')
    expect(r.totais.map((t) => [t.moeda, t.saldoRestante])).toEqual([['BRL', 60000], ['USD', 20000]])
  })

  it('sem linhas: vazio', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    expect(await listarParcelasAtivas('h1')).toEqual({ parcelamentos: [], totais: [] })
  })

  it('erro do banco é repassado (a tela isola o bloco)', async () => {
    const erro = { code: '42501', message: 'x' }
    rpc.mockResolvedValue({ data: null, error: erro })
    await expect(listarParcelasAtivas('h1')).rejects.toBe(erro)
  })
})
