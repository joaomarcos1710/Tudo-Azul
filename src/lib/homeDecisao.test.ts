import { beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => {
  const e = { calls: [] as { name: string; args: unknown }[], response: null as unknown as { data: unknown; error: unknown } }
  return { e, supabase: { rpc: (name: string, args: unknown) => {
    e.calls.push({ name, args })
    return Promise.resolve(e.response)
  } } }
})
vi.mock('./supabase', () => ({ supabase: fake.supabase }))

import { carregarHomeDecisao } from './homeDecisao'

const PAYLOAD = {
  monthStart: '2026-11-01',
  monthEnd: '2026-11-30',
  asOf: '2026-11-08',
  availableMoney: '910.00',
  reserveCommitted: '75.00',
  circulatingBalance: '835.00',
  moneyFree: '785.00',
  dailySafeLimit: '35.68',
  currentDailyPace: '42.50',
  incomePaid: '3000.00',
  incomePlanned: '500.00',
  expensesPaid: '1200.00',
  expensesPlanned: '250.00',
  plannedOutflows: '50.00',
  projection: {
    daysInMonth: 30, daysElapsed: 8, daysLeft: 22,
    spent: '1200.00', planned: '250.00', variableSoFar: '300.00',
    pacePerDay: '37.50', paceExtra: '2.50', projected: '2400.00',
  },
  upcoming_commitments: [{
    id: 'card-unreconciled:card-1:2026-11',
    description: 'Fatura do cartão',
    source: 'Cartão Azul',
    sourceType: 'Cartão',
    month: '2026-11-01',
    currency: 'BRL',
    amount: '50.00',
  }],
}

beforeEach(() => {
  fake.e.calls = []
  fake.e.response = { data: PAYLOAD, error: null }
})

describe('carregarHomeDecisao', () => {
  it('traz os indicadores que a função já calculou por dentro (treasury), em centavos', async () => {
    fake.e.response = { data: { ...PAYLOAD, treasury: { month_start: '2026-11-01', month_end: '2026-11-30', available: 910.5, net_worth: '1234.56', savings_rate: null, regular_income_source: 'recurring' } }, error: null }
    const d = await carregarHomeDecisao('h1', '2026-11')
    expect(d.tesouraria?.disponivel).toBe(91050)
    expect(d.tesouraria?.patrimonio).toBe(123456)
    expect(d.tesouraria?.taxaPoupanca).toBeNull()
    expect(d.tesouraria?.fonteRenda).toBe('recorrente')
  })

  it('sem treasury, ou com treasury ilegível, tesouraria é null (o Início pede os indicadores à parte) e a decisão segue', async () => {
    expect((await carregarHomeDecisao('h1', '2026-11')).tesouraria).toBeNull()
    fake.e.response = { data: { ...PAYLOAD, treasury: { available: 'abc' } }, error: null }
    const d = await carregarHomeDecisao('h1', '2026-11')
    expect(d.tesouraria).toBeNull()
    expect(d.dinheiroLivre).toBe(78500)
  })

  it('consulta a RPC com a família e o mês, convertendo os valores para centavos', async () => {
    const d = await carregarHomeDecisao('household-1', '2026-11')
    expect(fake.e.calls).toEqual([{
      name: 'get_home_decision_month',
      args: { p_household: 'household-1', p_month: '2026-11-01' },
    }])
    expect([d.dinheiroDisponivel, d.reservasComprometidas, d.dinheiroLivre, d.saidasPlanejadas])
      .toEqual([91000, 7500, 78500, 5000])
    expect([d.projecao.diasNoMes, d.projecao.diasDecorridos, d.projecao.diasRestantes, d.projecao.projetado])
      .toEqual([30, 8, 22, 240000])
    expect(d.compromissos).toEqual([{
      id: 'card-unreconciled:card-1:2026-11',
      descricao: 'Fatura do cartão',
      origem: 'Cartão Azul',
      tipoOrigem: 'Cartão',
      mes: '2026-11-01',
      moeda: 'BRL',
      valor: 5000,
    }])
  })

  it('não transforma ausência de payload ou erro de RPC em saldo zero', async () => {
    fake.e.response = { data: null, error: { code: '42883' } }
    await expect(carregarHomeDecisao('h1', '2026-11')).rejects.toMatchObject({ code: '42883' })
    fake.e.response = { data: null, error: null }
    await expect(carregarHomeDecisao('h1', '2026-11')).rejects.toThrow('decisão da Home indisponível')
  })

  it('recusa valores monetários com precisão inválida', async () => {
    fake.e.response = { data: { ...PAYLOAD, moneyFree: '1.005' }, error: null }
    await expect(carregarHomeDecisao('h1', '2026-11')).rejects.toThrow(/valor monetário inválido/)
  })
})
