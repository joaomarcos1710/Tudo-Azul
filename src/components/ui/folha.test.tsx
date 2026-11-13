// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Folha } from './Folha'

afterEach(cleanup)

const fundoDe = () => screen.getByRole('dialog').parentElement as HTMLElement

describe('Folha', () => {
  it('padrão: sobe de baixo no celular (bottom sheet) e fica no centro só no computador', () => {
    render(<Folha titulo="Filtros" aoFechar={() => {}}>conteúdo</Folha>)
    expect(fundoDe().className).toContain('items-end')
    expect(fundoDe().className).toContain('lg:items-center')
    expect(screen.getByRole('dialog').className).toContain('rounded-t-2xl')
  })

  it('centro: um card no meio da tela também no celular (pedido do dono nos Cartões), com os cantos arredondados em volta', () => {
    render(<Folha titulo="Editar compra" aoFechar={() => {}} centro>conteúdo</Folha>)
    expect(fundoDe().className).toContain('items-center')
    expect(fundoDe().className).not.toContain('items-end')
    expect(fundoDe().className).toContain('p-4') // não encosta nas bordas do celular
    expect(screen.getByRole('dialog').className).toContain('rounded-2xl')
    expect(screen.getByRole('dialog').className).not.toContain('rounded-t-2xl')
  })

  it('fecha no ×, no Esc e clicando fora, nos dois modos', async () => {
    const u = userEvent.setup()
    for (const centro of [false, true]) {
      const fechar = vi.fn()
      render(<Folha titulo="T" aoFechar={fechar} centro={centro}>x</Folha>)
      await u.click(screen.getByRole('button', { name: 'Fechar' }))
      await u.keyboard('{Escape}')
      await u.click(fundoDe())
      expect(fechar).toHaveBeenCalledTimes(3)
      cleanup()
    }
  })
})
