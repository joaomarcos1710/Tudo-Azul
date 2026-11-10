import { beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => {
  const e = {
    calls: [] as { name: string; args: unknown }[],
    response: null as unknown as { data: unknown; error: unknown },
    inserts: [] as { table: string; value: unknown }[],
  }
  return {
    e,
    supabase: {
      rpc: (name: string, args: unknown) => {
        e.calls.push({ name, args })
        return Promise.resolve(e.response)
      },
      from: (table: string) => ({
        insert: (value: unknown) => {
          e.inserts.push({ table, value })
          return Promise.resolve({ error: null })
        },
      }),
    },
  }
})
vi.mock('./supabase', () => ({ supabase: fake.supabase }))

import { asCents } from './format'
import { criarReserva, listarReservas, registrarAlocacaoReserva } from './reservas'

const ROWS = [
  {
    reserve_id: 'r1', name: 'Viagem', currency_code: 'BRL', target_amount: '500.00',
    target_date: '2027-06-01', icon: null, color: null, status: 'active',
    balance: '75.00', allocation_id: 'a2', allocation_amount: '-25.00',
    allocation_date: '2026-11-08', allocation_description: 'Resgate',
    allocation_created_at: '2026-11-08T12:00:00Z',
  },
  {
    reserve_id: 'r1', name: 'Viagem', currency_code: 'BRL', target_amount: '500.00',
    target_date: '2027-06-01', icon: null, color: null, status: 'active',
    balance: '75.00', allocation_id: 'a1', allocation_amount: '100.00',
    allocation_date: '2026-11-07', allocation_description: 'Aporte',
    allocation_created_at: '2026-11-07T12:00:00Z',
  },
]

beforeEach(() => {
  fake.e.calls = []
  fake.e.inserts = []
  fake.e.response = { data: ROWS, error: null }
})

describe('reservas', () => {
  it('usa o saldo agregado pelo banco e agrupa o histórico sem somar no cliente', async () => {
    const [r] = await listarReservas('h1')
    expect(fake.e.calls).toEqual([{ name: 'reserve_overview', args: { p_household: 'h1' } }])
    expect(r).toMatchObject({
      id: 'r1', nome: 'Viagem', moeda: 'BRL', meta: 50000, saldo: 7500,
      movimentos: [
        { id: 'a2', valor: -2500, descricao: 'Resgate' },
        { id: 'a1', valor: 10000, descricao: 'Aporte' },
      ],
    })
  })

  it('registra alocação com valor assinado e chave de idempotência explícita', async () => {
    fake.e.response = { data: 'allocation-1', error: null }
    const id = await registrarAlocacaoReserva('r1', asCents(-2500)!, '2026-11-08', 'Resgate', 'idem-1')
    expect(id).toBe('allocation-1')
    expect(fake.e.calls).toEqual([{
      name: 'record_reserve_allocation',
      args: {
        p_reserve_id: 'r1',
        p_amount: '-25.00',
        p_date: '2026-11-08',
        p_description: 'Resgate',
        p_idempotency_key: 'idem-1',
      },
    }])
  })

  it('cria envelope com moeda obrigatória e sem gravar saldo inicial no ledger', async () => {
    await criarReserva('h1', '  Viagem  ', 'EUR', asCents(10000), '2027-06-01')
    expect(fake.e.inserts).toEqual([{
      table: 'reserves',
      value: {
        household_id: 'h1', name: 'Viagem', currency_code: 'EUR',
        target_amount: '100.00', target_date: '2027-06-01',
      },
    }])
  })
})
