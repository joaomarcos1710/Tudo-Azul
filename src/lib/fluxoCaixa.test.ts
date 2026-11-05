import { beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => {
  const estado = { chamadas: [] as { nome: string; args: Record<string, unknown> }[], resposta: { data: [] as unknown, error: null as unknown } }
  return {
    estado,
    supabase: { rpc: (nome: string, args: Record<string, unknown>) => { estado.chamadas.push({ nome, args }); return Promise.resolve(estado.resposta) } },
  }
})
vi.mock('./supabase', () => ({ supabase: fake.supabase }))

import { fluxoDeCaixa, serieFluxo } from './fluxoCaixa'

beforeEach(() => {
  fake.estado.chamadas = []
  fake.estado.resposta = { data: [], error: null }
})

describe('fluxoDeCaixa', () => {
  it('chama cash_flow_report com os nomes certos; sem filtros manda nulo (não lista vazia) e planejados desligados', async () => {
    await fluxoDeCaixa('h1', '2026-03-01', '2026-03-31', 'week', { contas: [], membro: '' })
    expect(fake.estado.chamadas).toEqual([{ nome: 'cash_flow_report', args: {
      p_household: 'h1', p_from: '2026-03-01', p_to: '2026-03-31', p_step: 'week',
      p_accounts: null, p_member: null, p_include_planned: false,
    } }])
  })

  it('repassa conta, autor e não pagos', async () => {
    await fluxoDeCaixa('h1', '2026-03-01', '2026-03-31', 'day', { contas: ['a1', 'a2'], membro: 'u1', incluirNaoPagos: true })
    expect(fake.estado.chamadas[0].args).toMatchObject({ p_accounts: ['a1', 'a2'], p_member: 'u1', p_include_planned: true })
  })

  it('converte para centavos sem somar: usa os totais que o banco repete em cada linha', async () => {
    fake.estado.resposta = { error: null, data: [
      { period_start: '2026-03-01', income: '1100.50', expense: '520.00', balance: '580.50', cumulative: '580.50', total_income: '1100.50', total_expense: '520.00' },
      { period_start: '2026-04-01', income: 0, expense: '70.00', balance: '-70.00', cumulative: '510.50', total_income: '1100.50', total_expense: '520.00' },
    ] }
    const r = await fluxoDeCaixa('h1', '2026-03-01', '2026-04-30', 'month')
    expect(r.linhas.map((l) => [l.inicio, l.entradas, l.saidas, l.saldo, l.acumulado])).toEqual([
      ['2026-03-01', 110050, 52000, 58050, 58050],
      ['2026-04-01', 0, 7000, -7000, 51050],
    ])
    expect([r.totalEntradas, r.totalSaidas]).toEqual([110050, 52000])
  })

  it('período sem linhas: totais zerados', async () => {
    const r = await fluxoDeCaixa('h1', '2026-03-01', '2026-03-31', 'day')
    expect(r).toEqual({ linhas: [], totalEntradas: 0, totalSaidas: 0 })
  })

  it('erro do banco sobe', async () => {
    fake.estado.resposta = { data: null, error: { message: 'período inválido' } }
    await expect(fluxoDeCaixa('h1', '2026-03-31', '2026-03-01', 'day')).rejects.toMatchObject({ message: 'período inválido' })
  })
})

describe('serieFluxo (cash_flow_series, migration 066)', () => {
  it('uma chamada só, com o período e a divisão; sem filtros manda nulo', async () => {
    await serieFluxo('h1', '2026-11-01', '2026-11-30', 'total', { contas: [], membro: '' })
    expect(fake.estado.chamadas).toEqual([{ nome: 'cash_flow_series', args: {
      p_household: 'h1', p_from: '2026-11-01', p_to: '2026-11-30', p_step: 'total',
      p_accounts: null, p_member: null, p_include_planned: false,
    } }])
  })

  it('converte para centavos sem somar: resultado, saldo e totais vêm do banco; saldo nulo continua nulo', async () => {
    fake.estado.resposta = { error: null, data: [
      { period_start: '2026-10-26', period_end: '2026-11-01', income: '500.00', expense: 0, result: '500.00', closing_balance: '1570.00', total_income: '500.00', total_expense: '500.00', total_result: 0 },
      { period_start: '2026-11-02', period_end: '2026-11-08', income: 0, expense: '500.00', result: '-500.00', closing_balance: null, total_income: '500.00', total_expense: '500.00', total_result: 0 },
    ] }
    const r = await serieFluxo('h1', '2026-11-01', '2026-11-30', 'week')
    expect(r.linhas).toEqual([
      { inicio: '2026-10-26', fim: '2026-11-01', entradas: 50000, saidas: 0, resultado: 50000, saldo: 157000 },
      { inicio: '2026-11-02', fim: '2026-11-08', entradas: 0, saidas: 50000, resultado: -50000, saldo: null },
    ])
    expect([r.totalEntradas, r.totalSaidas, r.totalResultado]).toEqual([50000, 50000, 0])
  })

  it('erro do banco sobe', async () => {
    fake.estado.resposta = { data: null, error: { message: 'divisão inválida' } }
    await expect(serieFluxo('h1', '2026-11-01', '2026-11-30', 'day')).rejects.toMatchObject({ message: 'divisão inválida' })
  })
})
