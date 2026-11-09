import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import BoasVindas from './BoasVindas'

describe('página pública de boas-vindas', () => {
  it('apresenta a proposta do Tudo Azul e os acessos de cadastro e login', () => {
    render(<MemoryRouter><BoasVindas /></MemoryRouter>)

    expect(screen.getByRole('heading', { name: /sua vida financeira, em equilíbrio/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: /começar agora/i }).getAttribute('href')).toBe('/cadastro')
    expect(screen.getByRole('link', { name: /já tenho uma conta/i }).getAttribute('href')).toBe('/entrar')
  })

  it('apresenta os principais recursos sem expor dados reais da família', () => {
    render(<MemoryRouter><BoasVindas /></MemoryRouter>)

    expect(screen.getByText('Prévia ilustrativa')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Finanças em família' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Contas e cartões' })).toBeTruthy()
  })
})
