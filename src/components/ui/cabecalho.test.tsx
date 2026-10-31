// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CabecalhoPagina } from './CabecalhoPagina'

afterEach(cleanup)

describe('CabecalhoPagina', () => {
  it('mostra título, descrição, link de volta e ações', () => {
    render(
      <MemoryRouter>
        <CabecalhoPagina titulo="Editar lançamento" descricao="Revise os dados do lançamento." voltar={{ para: '/lancamentos', rotulo: 'Lançamentos' }}
          acoes={<button>Salvar</button>} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Editar lançamento' })).toBeTruthy()
    expect(screen.getByText('Revise os dados do lançamento.')).toBeTruthy()
    expect(screen.getByRole('link', { name: '← Lançamentos' }).getAttribute('href')).toBe('/lancamentos')
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeTruthy()
  })

  it('sem descrição, volta nem ações, só o título', () => {
    const { container } = render(<MemoryRouter><CabecalhoPagina titulo="Início" /></MemoryRouter>)
    expect(container.querySelectorAll('p, a, button')).toHaveLength(0)
  })

  it('nenhuma tela escreve o próprio <h1>: todas usam o cabeçalho padrão', () => {
    const dir = join(__dirname, '../../pages')
    const telas = readdirSync(dir).filter((f) => f.endsWith('.tsx') && !f.includes('.test.'))
    const comH1 = telas.filter((f) => readFileSync(join(dir, f), 'utf8').includes('<h1'))
    expect(comH1).toEqual([])
  })
})
