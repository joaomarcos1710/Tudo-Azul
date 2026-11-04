// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Cents } from '../lib/format'

const mock = vi.hoisted(() => ({ carregar: vi.fn(), salvar: vi.fn(), resumo: vi.fn() }))
vi.mock('../lib/avisoDiario', async (o) => ({
  ...(await o<typeof import('../lib/avisoDiario')>()),
  carregarPreferenciaAviso: mock.carregar, salvarPreferenciaAviso: mock.salvar, resumoDoDia: mock.resumo,
}))

import { AvisoDiario } from './AvisoDiario'

const c = (n: number) => n as Cents
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('AvisoDiario (tela Família)', () => {
  it('sem preferência salva: desligado, 7h e esconder valores marcado; prévia sem R$', async () => {
    mock.carregar.mockResolvedValue(null)
    mock.resumo.mockResolvedValue({ vencidos: 1, vencidosSaida: c(18000), hoje: 0, hojeSaida: c(0), faturas: 0, faturasValor: c(0), proximaFatura: null, fimDoMes: '2026-11-30', saldoPrevisto: c(5000) })
    render(<AvisoDiario userId="u1" familiaId="h1" email="dono@exemplo.com" />)
    const ligar = await screen.findByRole('checkbox', { name: 'Receber o aviso diário' }) as HTMLInputElement
    expect(ligar.checked).toBe(false)
    expect((screen.getByRole('combobox', { name: 'Horário' }) as HTMLSelectElement).value).toBe('7')
    expect((screen.getByRole('checkbox', { name: /Esconder valores/ }) as HTMLInputElement).checked).toBe(true)
    const previa = screen.getByLabelText('Prévia do aviso de hoje')
    expect(previa.textContent).toContain('1 compromisso vencido')
    expect(previa.textContent).not.toMatch(/R\$/)
    expect(screen.getByText('dono@exemplo.com')).toBeTruthy()
  })

  it('liga, escolhe 6h, mostra valores e salva', async () => {
    mock.carregar.mockResolvedValue(null)
    mock.resumo.mockResolvedValue(null)
    mock.salvar.mockResolvedValue(undefined)
    render(<AvisoDiario userId="u1" familiaId="h1" email={null} />)
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Receber o aviso diário' }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Horário' }), '6')
    await userEvent.click(screen.getByRole('checkbox', { name: /Esconder valores/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(mock.salvar).toHaveBeenCalledWith('u1', 'h1', { ligado: true, hora: 6, esconderValores: false }))
    expect(await screen.findByText('Aviso ligado: chega às 6h, quando houver algo a avisar.')).toBeTruthy()
    expect(screen.getByText('Prévia indisponível agora.')).toBeTruthy()
  })

  it('nada a avisar: diz que o e-mail não seria enviado; erro ao salvar aparece', async () => {
    mock.carregar.mockResolvedValue({ ligado: true, hora: 8, esconderValores: true })
    mock.resumo.mockResolvedValue({ vencidos: 0, vencidosSaida: c(0), hoje: 0, hojeSaida: c(0), faturas: 0, faturasValor: c(0), proximaFatura: null, fimDoMes: '2026-11-30', saldoPrevisto: c(-1) })
    mock.salvar.mockRejectedValue({ code: '42501', message: 'new row violates row-level security policy' })
    render(<AvisoDiario userId="u1" familiaId="h1" email={null} />)
    expect(await screen.findByText('Nada a avisar hoje: o e-mail não seria enviado.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
  })
})
