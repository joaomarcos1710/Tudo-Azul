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

  it('linha por classe: uma coluna só (nada lado a lado) e o valor nunca quebra entre "R$" e o número (iPad em pé, ~500px de conteúdo)', () => {
    render(<ComposicaoCarteira totais={[{ moeda: 'BRL', valorAtual: c(19821907) }]} alocacao={[macro('BRL', 19821907)]} liquidez={[]} instituicoes={[]} posicoes={[]} formatar={formatar} />)
    const lista = screen.getByRole('list', { name: 'Lista da carteira por classe' })
    expect(lista.className).not.toMatch(/grid-cols/)
    expect(within(lista).getAllByText(/BRL 198219\.07/)[0].parentElement?.className).toContain('whitespace-nowrap')
  })

  it('o nome da classe e da subclasse nunca é cortado com "…" e quebra linha (iPad em pé e janela de 1024px: "Renda fi…", "Fun…")', () => {
    render(<ComposicaoCarteira totais={[{ moeda: 'BRL', valorAtual: c(19821907) }]} alocacao={[macro('BRL', 19821907)]} liquidez={[]} instituicoes={[]} posicoes={[]} formatar={formatar} />)
    const lista = screen.getByRole('list', { name: 'Lista da carteira por classe' })
    const nomes = within(lista).getAllByText(/Renda variável|Renda fixa|Fundos e outros|Ações|FIIs/)
    expect(nomes.length).toBeGreaterThan(0)
    for (const nome of nomes) {
      expect(nome.className).not.toContain('truncate')
      expect(nome.className).toContain('break-words')
    }
  })

  it('uma barra por item, de uma cor só, com largura mínima de 1% (o item de 0,2% continua visível) e máxima de 100%', () => {
    const alocacao = [{ ...macro('BRL', 19821907), percentual: 99.8 }, { ...macro('BRL', 40000), macro: 'fixed_income' as const, percentual: 0.2 }]
    render(<ComposicaoCarteira totais={[{ moeda: 'BRL', valorAtual: c(19861907) }]} alocacao={alocacao} liquidez={[]} instituicoes={[]} posicoes={[]} formatar={formatar} />)
    const larguras = [...document.querySelectorAll<HTMLElement>('[data-barra]')].map((b) => b.style.width)
    expect(larguras).toContain('99.8%')
    expect(larguras).toContain('1%') // 0,2% do banco aparece com 1% de largura; o % exato continua em texto
    expect(larguras.every((w) => parseFloat(w) <= 100)).toBe(true)
    expect(document.querySelector('svg[role="img"]')).toBeNull()
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
