// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CabecalhoPagina } from './CabecalhoPagina'

afterEach(cleanup)

describe('CabecalhoPagina', () => {
  it('mostra título, descrição e ações', () => {
    render(
      <MemoryRouter>
        <CabecalhoPagina titulo="Contas" descricao="Saldo de cada conta." acoes={<button>Salvar</button>} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Contas' })).toBeTruthy()
    expect(screen.getByText('Saldo de cada conta.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeTruthy()
  })

  it('sem descrição nem ações, só o título', () => {
    const { container } = render(<MemoryRouter><CabecalhoPagina titulo="Início" /></MemoryRouter>)
    expect(container.querySelectorAll('p, a, button')).toHaveLength(0)
  })

  it('nenhuma tela escreve o próprio <h1>: todas usam o cabeçalho padrão', () => {
    const dir = join(__dirname, '../../pages')
    // A landing pública tem um hero próprio; as telas autenticadas usam CabecalhoPagina.
    const telas = readdirSync(dir).filter((f) => f.endsWith('.tsx') && !f.includes('.test.') && f !== 'BoasVindas.tsx')
    const comH1 = telas.filter((f) => readFileSync(join(dir, f), 'utf8').includes('<h1'))
    expect(comH1).toEqual([])
  })
})
