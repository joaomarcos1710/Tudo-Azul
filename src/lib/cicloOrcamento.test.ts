import { describe, expect, it } from 'vitest'
import { chaveDoCicloDe, cicloDoOrcamento, diaDoCiclo, rotuloDoCiclo } from './cicloOrcamento'

describe('ciclo do orçamento', () => {
  it('dia 1 é o mês de calendário (incluindo fevereiro de ano bissexto)', () => {
    expect(cicloDoOrcamento('2026-03', 1)).toEqual({ inicio: '2026-03-01', fim: '2026-03-31' })
    expect(cicloDoOrcamento('2028-02', 1)).toEqual({ inicio: '2028-02-01', fim: '2028-02-29' })
  })
  it('dia 20: de 20 de um mês até 19 do seguinte, inclusive na virada do ano', () => {
    expect(cicloDoOrcamento('2026-11', 20)).toEqual({ inicio: '2026-11-20', fim: '2026-12-19' })
    expect(cicloDoOrcamento('2026-12', 20)).toEqual({ inicio: '2026-12-20', fim: '2027-01-19' })
    expect(cicloDoOrcamento('2026-01', 28)).toEqual({ inicio: '2026-01-28', fim: '2026-02-27' })
  })
  it('a chave do ciclo de hoje: antes do dia escolhido ainda é o ciclo do mês anterior', () => {
    expect(chaveDoCicloDe('2026-11-19', 20)).toBe('2026-10')
    expect(chaveDoCicloDe('2026-11-20', 20)).toBe('2026-11')
    expect(chaveDoCicloDe('2026-01-05', 20)).toBe('2025-12')
    expect(chaveDoCicloDe('2026-11-19', 1)).toBe('2026-11')
  })
  it('dia do ciclo: 1 no primeiro dia, e conta a virada de mês', () => {
    expect(diaDoCiclo('2026-11-20', '2026-11', 20)).toBe(1)
    expect(diaDoCiclo('2026-12-05', '2026-11', 20)).toBe(16)
    expect(diaDoCiclo('2026-11-19', '2026-10', 20)).toBe(31)
    expect(diaDoCiclo('2026-11-10', '2026-11', 1)).toBe(10)
    expect(diaDoCiclo('2026-10-01', '2026-11', 20)).toBe(1)
  })
  it('rótulo "20/11 a 19/12"', () => {
    expect(rotuloDoCiclo('2026-11', 20)).toBe('20/11 a 19/12')
    expect(rotuloDoCiclo('2026-11', 1)).toBe('01/11 a 30/11')
  })
})
