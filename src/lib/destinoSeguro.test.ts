import { describe, expect, it } from 'vitest'
import { destinoSeguro } from './destinoSeguro'

describe('destinoSeguro (volta depois do login)', () => {
  it('mantém caminho interno, inclusive com busca e hash do convite', () => {
    expect(destinoSeguro('/lancamentos?mes=2026-11')).toBe('/lancamentos?mes=2026-11')
    expect(destinoSeguro('/convite#token123')).toBe('/convite#token123')
  })
  it('troca por "/" tudo o que sairia do app', () => {
    expect(destinoSeguro('//evil.example/x')).toBe('/')
    expect(destinoSeguro('/\\evil.example')).toBe('/')
    expect(destinoSeguro('https://evil.example/')).toBe('/')
    expect(destinoSeguro('lancamentos')).toBe('/')
    expect(destinoSeguro(undefined)).toBe('/')
    expect(destinoSeguro(42)).toBe('/')
  })
})
