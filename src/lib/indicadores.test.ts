import { beforeEach, describe, expect, it, vi } from 'vitest'

// banco de mentira: guarda a chamada e devolve a linha programada (dados inventados)
const fake = vi.hoisted(() => {
  const e = { chamadas: [] as { nome: string; args: unknown }[], resposta: { data: [] as unknown, error: null as unknown } }
  return { e, supabase: { rpc: (nome: string, args: unknown) => { e.chamadas.push({ nome, args }); return Promise.resolve(e.resposta) } } }
})
vi.mock('./supabase', () => ({ supabase: fake.supabase }))

import { carregarIndicadores } from './indicadores'
import { formatMeses, formatPct } from '../components/ui/FaixaIndicadores'

const LINHA = {
  month_start: '2026-11-01', month_end: '2026-11-30',
  accounts_active: '12250.00', card_bills_closed: '300.00', available: '11950.00',
  accounts_total: '12650.00', credit_receivable: 0, family_assets: '50000.00', investments: '1000.00',
  debt_total: '35300.00', planned_commitments: '900.00', net_worth: '28350.00',
  income: '6000.00', expense: '4000.00', result: '2000.00', savings_rate: '33.3', savings_band: 'saudavel',
  reserve: '3000.00', expense_closed_months: '3000.00', closed_months: 6, average_expense: '500.00',
  reserve_months: '6.0', reserve_band: 'saudavel',
  debt_installments: '1000', regular_income: '5000.00', commitment_pct: '20.0', commitment_band: 'saudavel',
}

beforeEach(() => {
  fake.e.chamadas = []
  fake.e.resposta = { data: [LINHA], error: null }
})

describe('carregarIndicadores (home_indicators, migration 071)', () => {
  it('chama a função do banco com a família e hoje, uma vez, e lê os valores em centavos', async () => {
    const d = await carregarIndicadores('h1', '2026-11-06')
    expect(fake.e.chamadas).toEqual([{ nome: 'home_indicators', args: { p_household: 'h1', p_as_of: '2026-11-06' } }])
    expect([d.disponivel, d.patrimonio, d.resultado, d.dividas, d.parcelasDividas, d.despesaMedia]).toEqual([1195000, 2835000, 200000, 3530000, 100000, 50000])
    expect([d.taxaPoupanca, d.coberturaReserva, d.comprometimento, d.mesesFechados]).toEqual([33.3, 6, 20, 6])
    expect([d.faixaPoupanca, d.faixaReserva, d.faixaComprometimento]).toEqual(['saudavel', 'saudavel', 'saudavel'])
  })

  it('sem base (null do banco): taxa, cobertura, comprometimento, média e faixas ficam null; faixa desconhecida também', async () => {
    fake.e.resposta = { data: [{ ...LINHA, savings_rate: null, savings_band: null, reserve_months: null, reserve_band: 'outra', average_expense: null, commitment_pct: null, commitment_band: null }], error: null }
    const d = await carregarIndicadores('h1', '2026-11-06')
    expect([d.taxaPoupanca, d.faixaPoupanca, d.coberturaReserva, d.faixaReserva, d.despesaMedia, d.comprometimento, d.faixaComprometimento])
      .toEqual([null, null, null, null, null, null, null])
  })

  it('erro do banco ou nenhuma linha (quem não é da família) vira erro, nunca zeros', async () => {
    fake.e.resposta = { data: null, error: { code: '42883', message: 'sem a função' } }
    await expect(carregarIndicadores('h1', '2026-11-06')).rejects.toMatchObject({ code: '42883' })
    fake.e.resposta = { data: [], error: null }
    await expect(carregarIndicadores('h1', '2026-11-06')).rejects.toThrow('indicadores indisponíveis')
  })

  it('valor com mais de 2 casas é erro de contrato (não arredonda dinheiro no front)', async () => {
    fake.e.resposta = { data: [{ ...LINHA, family_assets: '50000.005' }], error: null }
    await expect(carregarIndicadores('h1', '2026-11-06')).rejects.toThrow(/valor monetário inválido/)
  })
})

describe('formatação das razões', () => {
  it('uma casa, vírgula e "—" sem base; mês no singular', () => {
    expect([formatPct(33.3), formatPct(-1.7), formatPct(0), formatPct(null)]).toEqual(['33,3%', '−1,7%', '0,0%', '—'])
    expect([formatMeses(6), formatMeses(1), formatMeses(2.9), formatMeses(null)]).toEqual(['6,0 meses', '1,0 mês', '2,9 meses', '—'])
  })
})
