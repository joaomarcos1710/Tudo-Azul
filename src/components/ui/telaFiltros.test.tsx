// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Chip, Chips, GrupoFiltro, TelaFiltros } from './TelaFiltros'

afterEach(cleanup)

function montar(aoFechar = vi.fn(), aoAplicar = vi.fn()) {
  render(
    <TelaFiltros titulo="Filtros" aoFechar={aoFechar} acaoPrincipal={{ rotulo: 'Aplicar', aoAcionar: aoAplicar }}>
      <GrupoFiltro titulo="Considerar lançamentos">
        <Chips><Chip pressionado onClick={() => {}}>Pagos</Chip></Chips>
      </GrupoFiltro>
    </TelaFiltros>,
  )
  return { aoFechar, aoAplicar, painel: screen.getByRole('dialog', { name: 'Filtros' }) }
}

describe('TelaFiltros', () => {
  it('no computador é um painel no centro, do tamanho do conteúdo (não a tela inteira do monitor); no celular, tela inteira', () => {
    const { painel } = montar()
    // celular: ocupa tudo; computador (lg): largura e altura limitadas, cantos arredondados
    expect(painel.className).toMatch(/\bh-full\b/)
    expect(painel.className).toMatch(/\bw-full\b/)
    expect(painel.className).toMatch(/lg:h-auto/)
    expect(painel.className).toMatch(/lg:max-w-lg/)
    expect(painel.className).toMatch(/lg:max-h-\[88vh\]/)
    const fundo = painel.parentElement as HTMLElement
    expect(fundo.className).toMatch(/\bfixed inset-0\b/)
    expect(fundo.className).toMatch(/lg:bg-slate-900\/50/) // escurece a página atrás só no computador
    expect(fundo.className).toMatch(/lg:items-center/)
  })

  it('clicar fora do painel fecha; clicar dentro não', () => {
    const { painel, aoFechar } = montar()
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Pagos' }))
    fireEvent.mouseDown(painel)
    expect(aoFechar).not.toHaveBeenCalled()
    fireEvent.mouseDown(painel.parentElement as HTMLElement)
    expect(aoFechar).toHaveBeenCalledTimes(1)
  })

  it('o X e o Esc fecham; a ação principal é de quem usa', () => {
    const { painel, aoFechar, aoAplicar } = montar()
    fireEvent.click(screen.getByRole('button', { name: 'Fechar filtros' }))
    fireEvent.keyDown(painel, { key: 'Escape' })
    expect(aoFechar).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }))
    expect(aoAplicar).toHaveBeenCalledTimes(1)
    expect(aoFechar).toHaveBeenCalledTimes(2)
  })
})
