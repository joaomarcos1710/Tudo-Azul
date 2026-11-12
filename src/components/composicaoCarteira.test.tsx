// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ComposicaoCarteira } from './investimentos/ComposicaoCarteira'
import type { Cents } from '../lib/format'
import type { LinhaAlocacao, MoedaInvestimento } from '../lib/investimentos'

afterEach(cleanup)

const c = (n: number) => n as Cents
const formatar = (v: Cents, m: MoedaInvestimento) => `${m} ${(v / 100).toFixed(2)}`
const macro = (moeda: MoedaInvestimento, valor: number): LinhaAlocacao =>
  ({ moeda, nivel: 'macro', macro: 'variable', subclasse: null, valor: c(valor), percentual: 100 })

describe('ComposicaoCarteira', () => {
  it('se a moeda escolhida deixa de ter posição, a composição passa para a primeira que tiver (sem aba vazia)', async () => {
    const u = userEvent.setup()
    const props = { alocacao: [macro('BRL', 1000), macro('USD', 2000)], liquidez: [], instituicoes: [], posicoes: [], formatar }
    const { rerender } = render(<ComposicaoCarteira {...props} totais={[{ moeda: 'BRL', valorAtual: c(1000) }, { moeda: 'USD', valorAtual: c(2000) }]} />)
    await u.click(screen.getByRole('tab', { name: 'USD' }))
    expect(screen.getAllByText(/USD 20\.00/).length).toBeGreaterThan(0)
    rerender(<ComposicaoCarteira {...props} totais={[{ moeda: 'BRL', valorAtual: c(1000) }]} />)
    expect(screen.queryByRole('tablist', { name: 'Moeda da composição' })).toBeNull()
    expect(screen.getAllByText(/BRL 10\.00/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/USD/)).toBeNull()
  })

  it('sem nenhuma moeda com posição não desenha nada', () => {
    const { container } = render(<ComposicaoCarteira totais={[]} alocacao={[]} liquidez={[]} instituicoes={[]} posicoes={[]} formatar={formatar} />)
    expect(container.firstChild).toBeNull()
  })

  it('moeda com posição mas sem linha de classe: a visão Classe diz "Nada para mostrar ainda" em vez de quebrar', async () => {
    render(<ComposicaoCarteira totais={[{ moeda: 'EUR', valorAtual: c(500) }]} alocacao={[]} liquidez={[]} instituicoes={[]} posicoes={[]} formatar={formatar} />)
    expect(within(screen.getByRole('tabpanel')).getByText('Nada para mostrar ainda.')).toBeTruthy()
  })
})
