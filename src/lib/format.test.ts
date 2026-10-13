import { describe, expect, it } from 'vitest'
import { currentMonth, formatBRL, formatDate, formatMonth, parseBRL } from './format'

describe('formatBRL', () => {
  it('formata no padrão brasileiro', () => {
    expect(formatBRL(1250.5)).toBe('R$ 1.250,50')
    expect(formatBRL(0)).toBe('R$ 0,00')
    expect(formatBRL(-30)).toBe('-R$ 30,00')
    expect(formatBRL(-0)).toBe('R$ 0,00')
    expect(formatBRL(-0.004)).toBe('R$ 0,00')
  })
})

describe('parseBRL', () => {
  it('aceita formatos comuns', () => {
    expect(parseBRL('1.250,50')).toBe(1250.5)
    expect(parseBRL('R$ 1.250,50')).toBe(1250.5)
    expect(parseBRL('1250,5')).toBe(1250.5)
    expect(parseBRL('1250.50')).toBe(1250.5)
    expect(parseBRL('1.250.000')).toBe(1250000)
    expect(parseBRL('1.250')).toBe(1250)
    expect(parseBRL('12.5')).toBe(12.5)
    expect(parseBRL('-1.250,50')).toBe(-1250.5)
  })
  it('rejeita lixo', () => {
    expect(parseBRL('')).toBeNull()
    expect(parseBRL('abc')).toBeNull()
    expect(parseBRL('1,2,3')).toBeNull()
  })
})

describe('datas', () => {
  it('formatDate não desloca o dia', () => {
    expect(formatDate('2026-10-13')).toBe('13/10/2026')
    expect(formatDate('2026-01-01T00:00:00Z')).toBe('01/01/2026')
  })
  it('formatMonth', () => {
    expect(formatMonth('2026-10')).toBe('outubro de 2026')
  })
  it('currentMonth usa o fuso de São Paulo', () => {
    // 01/11 02:00 UTC ainda é 31/10 23:00 em São Paulo
    expect(currentMonth(new Date('2026-11-01T02:00:00Z'))).toBe('2026-10')
  })
})
