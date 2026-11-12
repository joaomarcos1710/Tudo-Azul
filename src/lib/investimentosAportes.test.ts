import { describe, expect, it } from 'vitest'
import { juntarHistoricoEAportes } from './investimentos'
import type { AporteMensal, HistoricoInvestimento } from './investimentos'
import type { Cents } from './format'

const c = (n: number) => n as Cents
const hist: HistoricoInvestimento[] = [
  { mes: '2026-09-01', moeda: 'BRL', valorAtual: c(150000), custoTotal: c(100000) },
  { mes: '2026-10-01', moeda: 'BRL', valorAtual: c(160000), custoTotal: c(60000) }, // custo caiu: houve resgate
  { mes: '2026-10-01', moeda: 'USD', valorAtual: c(5000), custoTotal: c(4000) },
]

describe('juntarHistoricoEAportes', () => {
  it('usa o aporte líquido do mesmo mês e moeda e marca que ele é líquido', () => {
    const aportes: AporteMensal[] = [
      { mes: '2026-09-01', moeda: 'BRL', liquido: c(100000) },
      { mes: '2026-10-01', moeda: 'BRL', liquido: c(90000) }, // pôs 100.000 e tirou 10.000: o custo (60.000) não é isso
      { mes: '2026-10-01', moeda: 'USD', liquido: c(4000) },
    ]
    expect(juntarHistoricoEAportes(hist, aportes)).toEqual([
      { mes: '2026-09-01', moeda: 'BRL', valorAtual: 150000, aportado: 100000, aportadoLiquido: true },
      { mes: '2026-10-01', moeda: 'BRL', valorAtual: 160000, aportado: 90000, aportadoLiquido: true },
      { mes: '2026-10-01', moeda: 'USD', valorAtual: 5000, aportado: 4000, aportadoLiquido: true },
    ])
  })

  it('o aporte de uma moeda não vaza para outra (mesmo mês)', () => {
    const aportes: AporteMensal[] = [{ mes: '2026-10-01', moeda: 'USD', liquido: c(1) }]
    const r = juntarHistoricoEAportes(hist, aportes)
    expect(r.find((p) => p.mes === '2026-10-01' && p.moeda === 'BRL')).toMatchObject({ aportado: 60000, aportadoLiquido: false })
    expect(r.find((p) => p.mes === '2026-10-01' && p.moeda === 'USD')).toMatchObject({ aportado: 1, aportadoLiquido: true })
  })

  it('sem aportes (null: banco sem a migration 114), cai para o custo do histórico e marca que não é líquido', () => {
    expect(juntarHistoricoEAportes(hist, null).map((p) => [p.aportado, p.aportadoLiquido]))
      .toEqual([[100000, false], [60000, false], [4000, false]])
  })

  it('aporte líquido zero é um número de verdade, não "ausente"', () => {
    const r = juntarHistoricoEAportes([hist[0]], [{ mes: '2026-09-01', moeda: 'BRL', liquido: c(0) }])
    expect(r[0]).toMatchObject({ aportado: 0, aportadoLiquido: true })
  })

  it('aporte líquido negativo (resgatou mais do que pôs) é mantido como está', () => {
    const r = juntarHistoricoEAportes([hist[0]], [{ mes: '2026-09-01', moeda: 'BRL', liquido: c(-5000) }])
    expect(r[0].aportado).toBe(-5000)
  })
})
