import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Cents } from './format'

const fake = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('./supabase', () => ({ supabase: { rpc: fake.rpc } }))
vi.mock('./contas', () => ({ COLUNA_INEXISTENTE: '42703', hojeSP: () => '2026-10-30' }))

import { criarCartao } from './cartoes'

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
