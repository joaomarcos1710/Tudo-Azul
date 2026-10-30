import { describe, expect, it } from 'vitest'
import { asCents } from './format'
import { simularQuitacao } from './dividas'
import type { Divida } from './dividas'

const divida = (id: string, nome: string, saldo: number, taxa: number, minimo: number): Divida => ({
  id, nome, tipo: 'loan', saldo: asCents(saldo)!, compromissos: asCents(0)!, ativa: true,
  taxaMensalBps: taxa, pagamentoMinimo: asCents(minimo)!,
})

describe('simulador de quitação', () => {
  it('Snowball prioriza menor saldo e Avalanche prioriza maior taxa', () => {
    const dividas = [
      divida('a', 'Saldo menor', 300_000, 100, 10_000),
      divida('b', 'Juros maiores', 900_000, 300, 10_000),
    ]
    const budget = asCents(100_000)!
    expect(simularQuitacao(dividas, budget, 'snowball').prioridadeInicial).toEqual(['Saldo menor', 'Juros maiores'])
    expect(simularQuitacao(dividas, budget, 'avalanche').prioridadeInicial).toEqual(['Juros maiores', 'Saldo menor'])
  })

  it('quita uma dívida sem juros em três meses com orçamento fixo', () => {
    const resultado = simularQuitacao([divida('a', 'Pessoal', 25_000, 0, 0)], asCents(10_000)!, 'snowball')
    expect(resultado.quitado).toBe(true)
    expect(resultado.meses).toBe(3)
    expect(resultado.jurosTotais).toBe(asCents(0))
    expect(resultado.totalPago).toBe(asCents(25_000))
    expect(resultado.ordemQuitacao).toEqual(['Pessoal'])
  })

  it('calcula juros e amortização usando centavos inteiros', () => {
    const resultado = simularQuitacao([divida('a', 'Empréstimo', 100_000, 100, 10_000)], asCents(11_000)!, 'avalanche')
    expect(resultado.quitado).toBe(true)
    expect(resultado.meses).toBe(10)
    expect(resultado.jurosTotais).toBe(asCents(5_378))
    expect(resultado.totalPago).toBe(asCents(105_378))
  })

  it('não simula quando o orçamento não cobre os pagamentos mínimos', () => {
    const resultado = simularQuitacao([
      divida('a', 'A', 100_000, 100, 8_000),
      divida('b', 'B', 100_000, 100, 8_000),
    ], asCents(15_000)!, 'snowball')
    expect(resultado.quitado).toBe(false)
    expect(resultado.erro).toMatch(/menor que a soma/)
    expect(resultado.jurosTotais).toBeNull()
  })

  it('informa quando o orçamento não quita todas as dívidas no horizonte de 600 meses', () => {
    const resultado = simularQuitacao([divida('a', 'A', 100_000, 0, 0)], asCents(100)!, 'avalanche')
    expect(resultado.quitado).toBe(false)
    expect(resultado.meses).toBe(600)
    expect(resultado.erro).toMatch(/600 meses/)
  })

  it('não altera as dívidas recebidas como entrada', () => {
    const original = divida('a', 'A', 50_000, 0, 0)
    const snapshot = { ...original }
    simularQuitacao([original], asCents(10_000)!, 'snowball')
    expect(original).toEqual(snapshot)
  })
})
