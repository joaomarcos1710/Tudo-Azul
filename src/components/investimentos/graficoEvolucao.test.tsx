// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { Cents } from '../../lib/format'
import type { PontoEvolucao } from '../../lib/investimentos'
import { GraficoEvolucao, cortarInicioVazio } from './GraficoEvolucao'

afterEach(cleanup)

const c = (n: number) => n as Cents
const reais = (v: Cents) => `R$ ${(v / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
const pontos: PontoEvolucao[] = [
  { mes: '2026-08-01', moeda: 'BRL', valorAtual: c(100000), aportado: c(100000), aportadoLiquido: true },
  { mes: '2026-09-01', moeda: 'BRL', valorAtual: c(215000), aportado: c(200000), aportadoLiquido: true },
  { mes: '2026-10-01', moeda: 'BRL', valorAtual: c(320000), aportado: c(300000), aportadoLiquido: true },
]
const montar = (p = pontos) => render(<GraficoEvolucao moedaCodigo="BRL" pontos={p} formatar={(v) => reais(v)} />)

describe('GraficoEvolucao', () => {
  it('mostra o título, a legenda com as duas séries e o rótulo acessível com os dois últimos valores do banco', () => {
    montar()
    expect(screen.getByRole('heading', { name: 'Evolução em BRL' })).toBeTruthy()
    const legenda = within(screen.getByRole('list', { name: 'Legenda' })).getAllByRole('listitem').map((li) => li.textContent)
    expect(legenda).toEqual(['Valor atual', 'Aportado'])
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      'Evolução da carteira em BRL: valor atual R$ 3.200,00, aportado R$ 3.000,00')
  })

  it('desenha as duas linhas: a do aportado é tracejada (a cor não é a única pista)', () => {
    const { container } = montar()
    const caminhos = Array.from(container.querySelectorAll('svg[role="img"] path'))
    expect(caminhos).toHaveLength(2)
    expect(caminhos.filter((p) => p.getAttribute('stroke-dasharray')).length).toBe(1)
  })

  it('a tela não calcula rendimento: só os dois números, sem diferença entre eles', () => {
    montar()
    expect(screen.getByText(/Último mês:/).textContent).toBe('Último mês: valor atual R$ 3.200,00 · aportado R$ 3.000,00')
    expect(screen.queryByText(/R\$ 200,00/)).toBeNull() // 3.200 − 3.000 não aparece em lugar nenhum
  })

  it('tabela com todos os meses, valor atual e aportado', () => {
    montar()
    const linhas = screen.getAllByRole('row').slice(1).map((tr) => Array.from(tr.children).map((td) => td.textContent))
    expect(linhas).toEqual([
      ['ago. de 26', 'R$ 1.000,00', 'R$ 1.000,00'],
      ['set. de 26', 'R$ 2.150,00', 'R$ 2.000,00'],
      ['out. de 26', 'R$ 3.200,00', 'R$ 3.000,00'],
    ])
  })

  it('passar o cursor mostra o mês com valor atual e aportado daquele ponto; sair esconde', () => {
    montar()
    const area = screen.getByTestId('area-evolucao') as unknown as SVGRectElement
    const svg = area.ownerSVGElement as SVGSVGElement
    svg.getBoundingClientRect = () => ({ left: 0, width: 640, top: 0, height: 220, right: 640, bottom: 220, x: 0, y: 0, toJSON: () => ({}) })
    expect(screen.queryByRole('status')).toBeNull()
    // jsdom não tem PointerEvent: um MouseEvent com o tipo 'pointermove' leva o clientX até o React
    fireEvent(area, new MouseEvent('pointermove', { clientX: 351, bubbles: true })) // meio do gráfico = setembro
    const dica = screen.getByRole('status')
    expect(dica.textContent).toContain('setembro de 2026')
    expect(dica.textContent).toContain('Valor atual: R$ 2.150,00')
    expect(dica.textContent).toContain('Aportado: R$ 2.000,00')
    fireEvent.pointerLeave(area)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('o último rótulo do eixo termina na borda (centrado ele era cortado no celular)', () => {
    const { container } = montar()
    const rotulos = Array.from(container.querySelectorAll('svg[role="img"] text')).filter((t) => /de 26$/.test(t.textContent ?? ''))
    expect(rotulos[rotulos.length - 1].getAttribute('text-anchor')).toBe('end')
    expect(rotulos[0].getAttribute('text-anchor')).toBe('middle')
  })

  it('aporte líquido: sem nota; com o aportado vindo do custo (banco sem a migration 114), avisa', () => {
    montar()
    expect(screen.queryByText(/custo do que ainda está investido/)).toBeNull()
    cleanup()
    montar(pontos.map((p) => ({ ...p, aportadoLiquido: false })))
    expect(screen.getByText(/custo do que ainda está investido: ele cai a cada resgate/)).toBeTruthy()
  })

  it('um único mês não desenha linha: diz desde quando há histórico (sem divisão por zero)', () => {
    const { container } = montar([pontos[0]])
    expect(container.querySelector('svg[role="img"]')).toBeNull()
    expect(screen.getByTestId('evolucao-sem-historico').textContent).toBe(
      'Histórico a partir de agosto de 2026. O gráfico aparece quando houver dois fechamentos mensais desde o primeiro aporte.')
    expect(screen.getByRole('heading', { name: 'Evolução em BRL' })).toBeTruthy()
    expect(container.innerHTML).not.toContain('NaN')
  })

  it('sem nenhum ponto com valor, diz que ainda não há histórico', () => {
    montar([{ ...pontos[0], valorAtual: c(0), aportado: c(0) }])
    expect(screen.getByTestId('evolucao-sem-historico').textContent).toBe('Sem histórico ainda.')
  })

  it('o gráfico começa no mês do primeiro aporte: os zeros do começo ficam de fora, os do meio e do fim ficam', () => {
    const zero = (mes: string): PontoEvolucao => ({ mes, moeda: 'BRL', valorAtual: c(0), aportado: c(0), aportadoLiquido: true })
    const serie = [zero('2026-05-01'), zero('2026-06-01'), ...pontos, zero('2026-11-01')]
    expect(cortarInicioVazio(serie).map((p) => p.mes)).toEqual(['2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01'])
    expect(cortarInicioVazio([zero('2026-05-01')])).toEqual([])
    const { container } = montar(serie)
    const linhas = Array.from(container.querySelectorAll('tbody tr')).map((tr) => tr.textContent ?? '')
    expect(linhas).toHaveLength(4)
    expect(linhas.some((t) => /mai|jun/i.test(t))).toBe(false)
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('valor atual R$ 0,00') // o último mês (zero no fim) continua lá
  })
})
