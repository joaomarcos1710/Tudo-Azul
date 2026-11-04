import { describe, expect, it } from 'vitest'
import { faixaDoEixo } from './LinhaMensal'

describe('faixaDoEixo (gráfico mês a mês)', () => {
  it('segue os valores em vez de começar no zero (patrimônio não fica achatado)', () => {
    const f = faixaDoEixo([11800000, 14056337])
    expect(f.min).toBeGreaterThan(0)
    expect(f.min).toBeLessThanOrEqual(11800000)
    expect(f.max).toBeGreaterThanOrEqual(14056337)
  })
  it('série que cruza o zero tem a marca do zero, e nunca "-0"', () => {
    const f = faixaDoEixo([-150000, 450000])
    expect(f.marcas).toContain(0)
    expect(f.marcas.some((v) => Object.is(v, -0))).toBe(false)
  })
  it('valores iguais ainda dão uma faixa', () => {
    const f = faixaDoEixo([500000, 500000])
    expect(f.max).toBeGreaterThan(f.min)
  })
})
