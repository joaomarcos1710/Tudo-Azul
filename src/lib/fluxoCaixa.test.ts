import { beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => {
  const estado = { chamadas: [] as { nome: string; args: Record<string, unknown> }[], resposta: { data: [] as unknown, error: null as unknown } }
  return {
    estado,
    supabase: { rpc: (nome: string, args: Record<string, unknown>) => { estado.chamadas.push({ nome, args }); return Promise.resolve(estado.resposta) } },
  }
})
vi.mock('./supabase', () => ({ supabase: fake.supabase }))

import { fluxoDeCaixa } from './fluxoCaixa'

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
