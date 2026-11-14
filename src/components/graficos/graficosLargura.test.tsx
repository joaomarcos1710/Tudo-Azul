// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { Cents } from '../../lib/format'
import type { PontoEvolucao } from '../../lib/investimentos'
import { LinhaAcumulada } from './LinhaAcumulada'
import type { PontoDia } from './LinhaAcumulada'
import { GraficoEvolucao } from '../investimentos/GraficoEvolucao'

// Os dois gráficos desenham na largura REAL da caixa (useLargura), como LinhaMensal e BalancoMensal. Com a largura fixa de 640
// o texto encolhia para ~6px no celular e crescia para ~18px no monitor (visto renderizado em 14/11/2026).
let larguraDaCaixa = 400
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => larguraDaCaixa })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth')
})

const c = (n: number) => n as Cents
const dias: PontoDia[] = Array.from({ length: 14 }, (_, i) => ({ dia: `2026-11-${String(i + 1).padStart(2, '0')}`, valor: c(5000), acumulado: c(5000 * (i + 1)) }))
const pontos: PontoEvolucao[] = Array.from({ length: 12 }, (_, i) => ({
  mes: `2026-${String(i + 1).padStart(2, '0')}-01`, moeda: 'BRL', valorAtual: c(1_000_000 + i * 85_000), aportado: c(950_000 + i * 70_000), aportadoLiquido: true,
}))
const reais = (v: Cents) => `R$ ${(v / 100).toLocaleString('pt-BR')}`

describe('LinhaAcumulada (Início): largura real da caixa', () => {
  it('desenha 1:1 na largura medida, no celular e no monitor, e o texto dos eixos não fica menor que 12px', () => {
    larguraDaCaixa = 358
    const { container, unmount } = render(<LinhaAcumulada pontos={dias} ate="2026-11-14" />)
    expect(container.querySelector('svg')!.getAttribute('viewBox')).toBe('0 0 358 220')
    for (const t of container.querySelectorAll('svg text')) expect(Number(t.getAttribute('font-size'))).toBeGreaterThanOrEqual(12)
    unmount()
    larguraDaCaixa = 1216
    const monitor = render(<LinhaAcumulada pontos={dias} ate="2026-11-14" />)
    expect(monitor.container.querySelector('svg')!.getAttribute('viewBox')).toBe('0 0 1216 220')
  })
})

describe('GraficoEvolucao (Investimentos): largura real da caixa', () => {
  const rotulosX = (container: HTMLElement) => [...container.querySelectorAll('svg text')].filter((t) => /de 26$/.test(t.textContent ?? ''))

  it('desenha 1:1 na largura medida e o texto dos eixos não fica menor que 12px', () => {
    larguraDaCaixa = 358
    const { container } = render(<GraficoEvolucao moedaCodigo="BRL" pontos={pontos} formatar={reais} />)
    expect(container.querySelector('svg[role="img"]')!.getAttribute('viewBox')).toBe('0 0 358 220')
    for (const t of container.querySelectorAll('svg[role="img"] text')) expect(Number(t.getAttribute('font-size'))).toBeGreaterThanOrEqual(12)
  })

  it('os rótulos dos meses não se sobrepõem: poucos no celular, mais no monitor, sempre terminando em dezembro', () => {
    larguraDaCaixa = 358
    const celular = render(<GraficoEvolucao moedaCodigo="BRL" pontos={pontos} formatar={reais} />)
    const noCelular = rotulosX(celular.container)
    expect(noCelular.length).toBeLessThanOrEqual(3)
    expect(noCelular[noCelular.length - 1].textContent).toMatch(/^dez/)
    // espaço mínimo entre os rótulos vizinhos (o último é ancorado à direita)
    const xs = noCelular.map((t) => Number(t.getAttribute('x')))
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(90)
    celular.unmount()
    larguraDaCaixa = 1216
    const monitor = render(<GraficoEvolucao moedaCodigo="BRL" pontos={pontos} formatar={reais} />)
    const noMonitor = rotulosX(monitor.container)
    expect(noMonitor.length).toBeGreaterThan(noCelular.length)
    expect(noMonitor[noMonitor.length - 1].textContent).toMatch(/^dez/)
  })
})
