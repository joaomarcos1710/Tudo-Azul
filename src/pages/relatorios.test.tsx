// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Periodo } from '../lib/periodoRelatorio'

// as abas de verdade têm testes próprios; aqui, cada uma mostra o período que recebeu e sabe avançar um período
vi.mock('../components/EntradasSaidas', async () => {
  const { moverPeriodo } = await import('../lib/periodoRelatorio')
  return {
    EntradasSaidas: ({ periodo, aoMudarPeriodo }: { periodo: Periodo; aoMudarPeriodo: (p: Periodo) => void }) => (
      <div><p>Entradas x Saídas de {periodo.de} a {periodo.ate}</p><button type="button" onClick={() => aoMudarPeriodo(moverPeriodo(periodo, 1))}>avançar ES</button></div>
    ),
  }
})
vi.mock('../components/RelatorioContas', async () => {
  const { moverPeriodo } = await import('../lib/periodoRelatorio')
  return {
    RelatorioContas: ({ periodo, aoMudarPeriodo }: { periodo: Periodo; aoMudarPeriodo: (p: Periodo) => void }) => (
      <div><p>Contas de {periodo.de} a {periodo.ate}</p><button type="button" onClick={() => aoMudarPeriodo(moverPeriodo(periodo, -1))}>voltar Contas</button></div>
    ),
  }
})
vi.mock('../components/RelatorioPessoas', async () => {
  const { moverPeriodo } = await import('../lib/periodoRelatorio')
  return {
    RelatorioPessoas: ({ periodo, aoMudarPeriodo }: { periodo: Periodo; aoMudarPeriodo: (p: Periodo) => void }) => (
      <div><p>Gastos por pessoa de {periodo.de} a {periodo.ate}</p><button type="button" onClick={() => aoMudarPeriodo(moverPeriodo(periodo, 1))}>avançar pessoas</button></div>
    ),
  }
})
// "hoje" fixo: 05/11/2026
vi.mock('../lib/contas', async (o) => ({ ...(await o<typeof import('../lib/contas')>()), hojeSP: () => '2026-11-05' }))

import Relatorios from './Relatorios'

afterEach(cleanup)

const aba = (nome: string) => within(screen.getByRole('tablist', { name: 'Relatórios' })).getByRole('tab', { name: nome })

describe('Relatórios', () => {
  it('só os relatórios: título "Relatórios" e nenhuma exportação (foi para Conta › Exportar dados)', () => {
    render(<Relatorios />)
    expect(screen.getByRole('heading', { name: 'Relatórios' })).toBeTruthy()
    expect(screen.queryByText(/Exportar lançamentos/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Preparar exportação completa' })).toBeNull()
  })

  it('abas no topo (tablist): Entradas x Saídas aberta; tocar em Contas abre Contas no painel da aba', async () => {
    const u = userEvent.setup()
    render(<Relatorios />)
    expect(within(screen.getByRole('tablist', { name: 'Relatórios' })).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Entradas x Saídas', 'Contas', 'Gastos por pessoa'])
    expect(aba('Entradas x Saídas').getAttribute('aria-selected')).toBe('true')
    expect(aba('Contas').getAttribute('aria-selected')).toBe('false')
    expect(screen.getByRole('tabpanel').textContent).toContain('Entradas x Saídas de 2026-11-01 a 2026-11-30')
    await u.click(aba('Contas'))
    expect(aba('Contas').getAttribute('aria-selected')).toBe('true')
    const painel = screen.getByRole('tabpanel', { name: 'Contas' })
    expect(painel.textContent).toContain('Contas de 2026-11-01 a 2026-11-30')
    // só a aba aberta fica montada (e consulta o banco)
    expect(screen.queryByText(/Entradas x Saídas de/)).toBeNull()
  })

  it('teclado: setas, Home e End trocam de aba e levam o foco (só a aba escolhida fica no Tab)', () => {
    render(<Relatorios />)
    expect(aba('Entradas x Saídas').tabIndex).toBe(0)
    expect(aba('Contas').tabIndex).toBe(-1)
    fireEvent.keyDown(aba('Entradas x Saídas'), { key: 'ArrowRight' })
    expect(aba('Contas').getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(aba('Contas'))
    fireEvent.keyDown(aba('Contas'), { key: 'Home' })
    expect(aba('Entradas x Saídas').getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(aba('Entradas x Saídas'), { key: 'End' })
    expect(aba('Gastos por pessoa').getAttribute('aria-selected')).toBe('true')
  })

  it('o período é um só: o escolhido numa aba continua na outra, nos dois sentidos', async () => {
    const u = userEvent.setup()
    render(<Relatorios />)
    await u.click(screen.getByRole('button', { name: 'avançar ES' }))
    expect(screen.getByText('Entradas x Saídas de 2026-12-01 a 2026-12-31')).toBeTruthy()
    await u.click(aba('Contas'))
    expect(screen.getByText('Contas de 2026-12-01 a 2026-12-31')).toBeTruthy()
    await u.click(aba('Gastos por pessoa'))
    expect(screen.getByText('Gastos por pessoa de 2026-12-01 a 2026-12-31')).toBeTruthy()
    await u.click(screen.getByRole('button', { name: 'avançar pessoas' }))
    expect(screen.getByText('Gastos por pessoa de 2027-01-01 a 2027-01-31')).toBeTruthy()
    await u.click(screen.getByRole('button', { name: 'voltar Contas' }))
    await u.click(screen.getByRole('button', { name: 'voltar Contas' }))
    expect(screen.getByText('Contas de 2026-10-01 a 2026-10-31')).toBeTruthy()
    await u.click(aba('Entradas x Saídas'))
    expect(screen.getByText('Entradas x Saídas de 2026-10-01 a 2026-10-31')).toBeTruthy()
  })
})
