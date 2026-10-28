import { describe, expect, it } from 'vitest'
import {
  asCents, centsFromDb, centsToDecimal, currentMonth, formatBRL, formatDate, formatMonth,
  MAX_CENTS, primeiraMaiuscula, parseBRL, type Cents,
} from './format'

const c = (n: number) => n as Cents

describe('formatBRL (recebe centavos)', () => {
  it('formata no padrão brasileiro', () => {
    expect(formatBRL(c(125050))).toBe('R$ 1.250,50')
    expect(formatBRL(c(0))).toBe('R$ 0,00')
    expect(formatBRL(c(-3000))).toBe('-R$ 30,00')
    expect(formatBRL(c(-0))).toBe('R$ 0,00')
    expect(formatBRL(c(5))).toBe('R$ 0,05')
    expect(formatBRL(c(-50))).toBe('-R$ 0,50')
    expect(formatBRL(MAX_CENTS)).toBe('R$ 999.999.999.999,99')
  })
  it('formata direto de centavos, sem passar por reais em ponto flutuante', () => {
    expect(formatBRL(parseBRL('1,01')!)).toBe('R$ 1,01')
    expect(formatBRL(parseBRL('1.005,00')!)).toBe('R$ 1.005,00')
  })
})

describe('parseBRL (devolve centavos)', () => {
  it('aceita formatos comuns', () => {
    expect(parseBRL('1.250,50')).toBe(125050)
    expect(parseBRL('R$ 1.250,50')).toBe(125050)
    expect(parseBRL('1250,5')).toBe(125050)
    expect(parseBRL('1250.50')).toBe(125050)
    expect(parseBRL('1.250.000')).toBe(125000000)
    expect(parseBRL('1.250')).toBe(125000)
    expect(parseBRL('12.5')).toBe(1250)
    expect(parseBRL('-1.250,50')).toBe(-125050)
    expect(parseBRL('0,5')).toBe(50)
    expect(parseBRL('1250')).toBe(125000)
    expect(parseBRL('R$ 3,00')).toBe(300)
    expect(parseBRL('0,01')).toBe(1)
    expect(parseBRL('007,10')).toBe(710)
  })
  it('zero negativo vira zero', () => {
    expect(Object.is(parseBRL('-0,00'), 0)).toBe(true)
  })
  it('M4: rejeita lixo e ambiguidades, sem adivinhar', () => {
    for (const ruim of ['', 'abc', '1,2,3', '1.2.3', '1250.5.0', '1,234', '12..5', '1.2,50', '--5', '1.250,500', '1R$250', '1 2', 'R$R$10', ',50', '1.']) {
      expect(parseBRL(ruim), `entrada: "${ruim}"`).toBeNull()
    }
  })
  it('aceita o sinal antes do R$ e R$ em minúsculas, mas segue recusando espaço no meio do número', () => {
    expect(parseBRL('-R$ 30,00')).toBe(-3000)
    expect(parseBRL('r$ 10')).toBe(1000)
    expect(parseBRL('\u00a0R$ 1.250,50\u00a0')).toBe(125050)
    expect(parseBRL('1 234,56')).toBeNull()
  })
  it('respeita o limite de numeric(14,2)', () => {
    expect(parseBRL('999.999.999.999,99')).toBe(MAX_CENTS)
    expect(parseBRL('-999.999.999.999,99')).toBe(-MAX_CENTS)
    expect(parseBRL('1.000.000.000.000,00')).toBeNull()
    expect(parseBRL('99999999999999999999')).toBeNull()
  })
  it('sempre devolve inteiro', () => {
    for (const e of ['0,1', '0,2', '0,3', '1,99', '19,90', '1234,56']) {
      expect(Number.isInteger(parseBRL(e)), e).toBe(true)
    }
  })
})

describe('soma em centavos (M1, M2)', () => {
  it('M1: 0,10 + 0,20 = 0,30 exatos', () => {
    const soma = parseBRL('0,10')! + parseBRL('0,20')!
    expect(soma).toBe(30)
    expect(formatBRL(c(soma))).toBe('R$ 0,30')
  })
  it('M2: 1.000 lançamentos de 0,10 = 100,00 exatos', () => {
    let soma = 0
    for (let i = 0; i < 1000; i++) soma += parseBRL('0,10')!
    expect(soma).toBe(10000)
    expect(formatBRL(c(soma))).toBe('R$ 100,00')
  })
})

describe('centsToDecimal: envio ao banco (M3, M5)', () => {
  it('M5: 125050 vira a string "1250.50"', () => {
    expect(centsToDecimal(c(125050))).toBe('1250.50')
    expect(centsToDecimal(c(5))).toBe('0.05')
    expect(centsToDecimal(c(-50))).toBe('-0.50')
    expect(centsToDecimal(c(0))).toBe('0.00')
  })
  it('M3: ida e volta de 999.999.999.999,99 (texto -> centavos -> decimal -> texto)', () => {
    const cents = parseBRL('999.999.999.999,99')!
    const decimal = centsToDecimal(cents)
    expect(decimal).toBe('999999999999.99')
    expect(formatBRL(centsFromDb(decimal))).toBe('R$ 999.999.999.999,99')
  })
})

describe('centsFromDb: leitura do banco', () => {
  it('aceita número ou string do PostgREST', () => {
    expect(centsFromDb(1250.5)).toBe(125050)
    expect(centsFromDb('1250.50')).toBe(125050)
    expect(centsFromDb(0.1)).toBe(10)
    expect(centsFromDb(0.29)).toBe(29) // 0.29 * 100 em float dá 28.999999999999996
    expect(centsFromDb(-30)).toBe(-3000)
    expect(centsFromDb('1.2300')).toBe(123)
    expect(centsFromDb(999999999999.99)).toBe(MAX_CENTS)
    expect(Object.is(centsFromDb('-0.00'), 0)).toBe(true)
  })
  it('lança erro em valor fora do contrato, em vez de arredondar', () => {
    for (const ruim of ['1.234', 'abc', '', '1e3', '1000000000000.00', 'NaN', '1,50']) {
      expect(() => centsFromDb(ruim), ruim).toThrow()
    }
    expect(() => centsFromDb(Number.NaN)).toThrow()
    expect(() => centsFromDb(Number.POSITIVE_INFINITY)).toThrow()
    expect(() => centsFromDb(1e21)).toThrow()
  })
})

describe('asCents', () => {
  it('aceita só inteiros seguros dentro do limite', () => {
    expect(asCents(125050)).toBe(125050)
    expect(asCents(1.5)).toBeNull()
    expect(asCents(MAX_CENTS + 1)).toBeNull()
    expect(asCents(Number.NaN)).toBeNull()
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

describe('primeiraMaiuscula', () => {
  it('põe maiúscula só na primeira letra do título do mês', () => {
    expect(primeiraMaiuscula(formatMonth('2026-10'))).toBe('Outubro de 2026')
    expect(primeiraMaiuscula('em março de 2027')).toBe('Em março de 2027')
    expect(primeiraMaiuscula('últimos 12 meses')).toBe('Últimos 12 meses')
    expect(primeiraMaiuscula('')).toBe('')
  })
})
