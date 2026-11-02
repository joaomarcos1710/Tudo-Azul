import { beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => {
  const estado = { rpcs: [] as { nome: string; args: Record<string, unknown> }[], resposta: { data: [] as unknown, error: null as unknown } }
  return { estado, supabase: { rpc: (nome: string, args: Record<string, unknown>) => { estado.rpcs.push({ nome, args }); return Promise.resolve(estado.resposta) } } }
})
vi.mock('./supabase', () => ({ supabase: fake.supabase }))

import { listarProventosPorAtivo, registrarProventoInvestimento } from './investimentos'
import type { Cents } from './format'

beforeEach(() => {
  fake.estado.rpcs = []
  fake.estado.resposta = { data: [], error: null }
})

describe('registrarProventoInvestimento', () => {
  it('chama investment_distribution_record com o valor líquido em reais decimais (não em centavos)', async () => {
    await registrarProventoInvestimento({
      ativoId: 'a1', tipo: 'jcp', data: '2026-11-02', valor: 12050 as Cents, contaId: 'c1', status: 'paid', observacao: '  JCP líquido ',
    })
    expect(fake.estado.rpcs).toEqual([{ nome: 'investment_distribution_record', args: {
      p_asset: 'a1', p_kind: 'jcp', p_date: '2026-11-02', p_amount: '120.50', p_account: 'c1', p_status: 'paid', p_notes: 'JCP líquido',
    } }])
  })

  it('observação vazia vai como nulo; planejado repassa o status', async () => {
    await registrarProventoInvestimento({
      ativoId: 'a1', tipo: 'dividend', data: '2026-12-01', valor: 1 as Cents, contaId: 'c1', status: 'planned', observacao: '   ',
    })
    expect(fake.estado.rpcs[0].args).toMatchObject({ p_amount: '0.01', p_status: 'planned', p_notes: null })
  })

  it('erro do banco sobe (ex.: ativo em USD, conta conciliada)', async () => {
    fake.estado.resposta = { data: null, error: { message: 'provento em conta só para ativos em BRL' } }
    await expect(registrarProventoInvestimento({
      ativoId: 'a1', tipo: 'income', data: '2026-11-02', valor: 100 as Cents, contaId: 'c1', status: 'paid', observacao: '',
    })).rejects.toMatchObject({ message: expect.stringContaining('BRL') })
  })
})

describe('listarProventosPorAtivo', () => {
  it('chama investment_income_by_asset e converte para centavos sem somar nada', async () => {
    fake.estado.resposta = { error: null, data: [
      { asset_id: 'a1', name: 'FII Z', currency_code: 'BRL', received: '120.50', planned: '30.00', last_received: '2026-10-20' },
      { asset_id: 'a2', name: 'Ação Y', currency_code: 'BRL', received: 85, planned: 0, last_received: null },
    ] }
    const r = await listarProventosPorAtivo('h1', '2025-12-01', '2027-05-31')
    expect(fake.estado.rpcs).toEqual([{ nome: 'investment_income_by_asset', args: { p_household: 'h1', p_from: '2025-12-01', p_to: '2027-05-31' } }])
    expect(r.map((l) => [l.assetId, l.nome, l.recebido, l.previsto, l.ultimoRecebimento])).toEqual([
      ['a1', 'FII Z', 12050, 3000, '2026-10-20'],
      ['a2', 'Ação Y', 8500, 0, null],
    ])
  })

  it('erro do banco (migration ausente) sobe para a tela decidir', async () => {
    fake.estado.resposta = { data: null, error: { message: 'function investment_income_by_asset does not exist' } }
    await expect(listarProventosPorAtivo('h1', '2026-01-01', '2026-12-31')).rejects.toBeTruthy()
  })
})
