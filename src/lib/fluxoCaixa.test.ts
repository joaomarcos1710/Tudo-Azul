import { beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => {
  const estado = { chamadas: [] as { nome: string; args: Record<string, unknown> }[], resposta: { data: [] as unknown, error: null as unknown } }
  return {
    estado,
    supabase: { rpc: (nome: string, args: Record<string, unknown>) => { estado.chamadas.push({ nome, args }); return Promise.resolve(estado.resposta) } },
  }
})
vi.mock('./supabase', () => ({ supabase: fake.supabase }))

import { fluxoDeCaixa, relatorioContas, serieFluxo } from './fluxoCaixa'

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

describe('relatorioContas (account_flow_report, migration 067)', () => {
  it('uma chamada, com os nomes certos e os não pagos', async () => {
    await relatorioContas('h1', '2026-11-01', '2026-11-30', true)
    expect(fake.estado.chamadas).toEqual([{ nome: 'account_flow_report', args: {
      p_household: 'h1', p_from: '2026-11-01', p_to: '2026-11-30', p_include_planned: true,
    } }])
  })

  it('converte para centavos sem somar: os totais são os que o banco repete em cada linha', async () => {
    const tot = { total_opening: '1050.00', total_income: '500.00', total_expense: '200.00', total_transfers: 0, total_closing: '1350.00' }
    fake.estado.resposta = { error: null, data: [
      { account_id: 'a1', name: 'Banco', type: 'checking', opening_balance: '1000.00', income: '500.00', expense: '400.00', transfer_in: 0, transfer_out: '200.00', closing_balance: '1100.00', ...tot },
      { account_id: 'a2', name: 'Poupança', type: 'savings', opening_balance: '50.00', income: '200.00', expense: 0, transfer_in: '200.00', transfer_out: 0, closing_balance: '250.00', ...tot },
    ] }
    const r = await relatorioContas('h1', '2026-09-01', '2026-09-30', false)
    expect(r.linhas).toEqual([
      { contaId: 'a1', nome: 'Banco', tipo: 'checking', saldoInicial: 100000, entradas: 50000, saidas: 40000, transferenciasEntrada: 0, transferenciasSaida: 20000, saldoFinal: 110000 },
      { contaId: 'a2', nome: 'Poupança', tipo: 'savings', saldoInicial: 5000, entradas: 20000, saidas: 0, transferenciasEntrada: 20000, transferenciasSaida: 0, saldoFinal: 25000 },
    ])
    expect([r.totalInicial, r.totalEntradas, r.totalSaidas, r.totalTransferencias, r.totalFinal]).toEqual([105000, 50000, 20000, 0, 135000])
  })

  it('sem conta: zero linhas e totais zerados; erro do banco sobe', async () => {
    const r = await relatorioContas('h1', '2026-09-01', '2026-09-30', false)
    expect(r).toEqual({ linhas: [], totalInicial: 0, totalEntradas: 0, totalSaidas: 0, totalTransferencias: 0, totalFinal: 0 })
    fake.estado.resposta = { data: null, error: { message: 'período inválido (até 10 anos)' } }
    await expect(relatorioContas('h1', '2016-01-01', '2026-12-31', false)).rejects.toMatchObject({ message: 'período inválido (até 10 anos)' })
  })
})
