// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { NavegacaoCarteira } from './NavegacaoCarteira'

describe('NavegacaoCarteira', () => {
  it('oferece atalhos acessíveis para todas as seções da carteira', () => {
    render(<NavegacaoCarteira />)
    const nav = screen.getByRole('navigation', { name: 'Seções da Minha Carteira' })
    const links = within(nav).getAllByRole('link')
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Visão geral', '#visao-geral'],
      ['Contas', '#contas'],
      ['Cartões', '#cartoes'],
    ])
  })
})
