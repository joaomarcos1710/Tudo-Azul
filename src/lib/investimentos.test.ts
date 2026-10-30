import { describe, expect, it } from 'vitest'
import { normalizarDecimalInvestimento } from './investimentos'

describe('validação decimal de investimentos', () => {
  it('normaliza vírgula decimal sem arredondar', () => {
    expect(normalizarDecimalInvestimento('10', 12)).toBe('10')
    expect(normalizarDecimalInvestimento('1,234567890123', 12)).toBe('1.234567890123')
  })

  it('aceita precisão de preço unitário até dez casas', () => {
    expect(normalizarDecimalInvestimento('0,0000000001', 10)).toBe('0.0000000001')
  })

  it.each(['', '0', '0,00', '-1', '1,2,3', '1.2.3', 'abc', '1,1234567890123'])(
    'recusa valor inválido: %s',
    (valor) => expect(() => normalizarDecimalInvestimento(valor, 12)).toThrow(),
  )

  it('recusa parte inteira acima de doze dígitos', () => {
    expect(() => normalizarDecimalInvestimento('1234567890123', 10)).toThrow()
  })

  it('recusa casas decimais acima da precisão solicitada', () => {
    expect(() => normalizarDecimalInvestimento('1,12345678901', 10)).toThrow()
  })
})
