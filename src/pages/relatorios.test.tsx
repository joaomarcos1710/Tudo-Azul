// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('../components/EntradasSaidas', () => ({ EntradasSaidas: () => <p>relatório</p> }))

import Relatorios from './Relatorios'

afterEach(cleanup)

describe('Relatórios', () => {
  it('só os relatórios: título "Relatórios" e nenhuma exportação (foi para Conta › Exportar dados)', () => {
    render(<Relatorios />)
    expect(screen.getByRole('heading', { name: 'Relatórios' })).toBeTruthy()
    expect(screen.getByText('relatório')).toBeTruthy()
    expect(screen.queryByText(/Exportar lançamentos/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Preparar exportação completa' })).toBeNull()
  })
})
