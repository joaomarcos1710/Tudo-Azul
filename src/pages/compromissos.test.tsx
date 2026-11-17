// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const mock = vi.hoisted(() => ({
  listarParcelasAtivas: vi.fn(),
  carregarProjecaoCompromissos: vi.fn(),
}))
vi.mock('../lib/FamiliaContext', () => ({
  useFamilia: () => ({ familia: { id: 'h1', nome: 'Casa', papel: 'owner' }, carregando: false, erro: false, recarregar: vi.fn() }),
}))
vi.mock('../lib/parcelasAtivas', () => ({
  listarParcelasAtivas: mock.listarParcelasAtivas,
  listarParcelasQueAcabam: vi.fn().mockResolvedValue({ planos: [], totais: [] }),
  listarCronogramaParcelas: vi.fn().mockResolvedValue(new Map()),
  resumoParcelasDoMes: vi.fn().mockResolvedValue([]),
}))
vi.mock('../lib/projecaoCompromissos', () => ({ carregarProjecaoCompromissos: mock.carregarProjecaoCompromissos }))

import Compromissos from './Compromissos'

const montar = (entrada = '/compromissos') => render(<MemoryRouter initialEntries={[entrada]}><Compromissos /></MemoryRouter>)

beforeEach(() => {
  mock.listarParcelasAtivas.mockResolvedValue({ parcelamentos: [], totais: [] })
  mock.carregarProjecaoCompromissos.mockResolvedValue([])
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('Compromissos: a projeção e as parcelas que saíram de Recorrentes (17/11/2026)', () => {
  it('abre em Projeção; a aba Parcelas só carrega quando é aberta', async () => {
    montar()
    expect(screen.getByRole('heading', { name: 'Compromissos' })).toBeTruthy()
    const abas = within(screen.getByRole('tablist', { name: 'Seções de Compromissos' })).getAllByRole('tab').map((a) => a.textContent)
    expect(abas).toEqual(['Projeção', 'Parcelas'])
    expect(screen.getByRole('tab', { name: 'Projeção' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tabpanel').id).toBe('painel-projecao')
    expect(await screen.findByText('Projeção de compromissos')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Parcelas ativas' })).toBeNull()
    expect(mock.listarParcelasAtivas).not.toHaveBeenCalled()
  })

  it('?aba=parcelas abre direto em Parcelas (o link do card de Recorrentes), sem carregar a projeção', async () => {
    montar('/compromissos?aba=parcelas')
    expect(await screen.findByRole('heading', { name: 'Parcelas ativas' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Parcelas' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByText('Projeção de compromissos')).toBeNull()
    expect(mock.carregarProjecaoCompromissos).not.toHaveBeenCalled()
  })

  it('clicar troca o painel: só o da aba escolhida aparece, nos dois sentidos', async () => {
    const u = userEvent.setup()
    montar()
    await screen.findByText('Projeção de compromissos')
    await u.click(screen.getByRole('tab', { name: 'Parcelas' }))
    expect(await screen.findByRole('heading', { name: 'Parcelas ativas' })).toBeTruthy()
    expect(screen.queryByText('Projeção de compromissos')).toBeNull()
    await u.click(screen.getByRole('tab', { name: 'Projeção' }))
    expect(await screen.findByText('Projeção de compromissos')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Parcelas ativas' })).toBeNull()
  })

  it('setas movem entre as abas e o foco acompanha (dando a volta)', async () => {
    const u = userEvent.setup()
    montar()
    await screen.findByText('Projeção de compromissos')
    screen.getByRole('tab', { name: 'Projeção' }).focus()
    await u.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Parcelas' }))
    expect(screen.getByRole('tab', { name: 'Parcelas' }).getAttribute('aria-selected')).toBe('true')
    await u.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Projeção' })) // volta dando a volta
    await u.keyboard('{ArrowLeft}')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Parcelas' }))
  })

  it('valor inválido em ?aba= cai em Projeção (nunca erro na tela)', async () => {
    montar('/compromissos?aba=qualquer')
    expect(await screen.findByText('Projeção de compromissos')).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Projeção' }).getAttribute('aria-selected')).toBe('true')
  })

  it('mostra os parcelamentos do banco na aba Parcelas', async () => {
    mock.listarParcelasAtivas.mockResolvedValue({
      parcelamentos: [{
        chave: 'card:k1:p1', origem: 'card', moeda: 'BRL', descricao: 'Geladeira', origemId: 'k1', origemNome: 'Nubank',
        valorParcela: 10000, parcelaAtual: 5, totalParcelas: 10, parcelasPagas: 4, percentualPago: 40,
        total: 100000, pago: 40000, saldoRestante: 60000, futuro: 50000, situacaoMes: 'pending',
        proximoVencimento: '2026-11-15', emAtraso: 0,
      }],
      totais: [{ moeda: 'BRL', qtde: 1, saldoRestante: 60000, futuro: 50000 }],
    })
    montar('/compromissos?aba=parcelas')
    expect(await screen.findByRole('heading', { name: 'Parcelas ativas' })).toBeTruthy()
    expect(await screen.findByText('Parcela 5 de 10')).toBeTruthy()
  })

  it('se as parcelas ativas falharem, só esse bloco avisa e a aba Projeção continua funcionando', async () => {
    mock.listarParcelasAtivas.mockRejectedValue({ code: '57014' })
    const u = userEvent.setup()
    montar('/compromissos?aba=parcelas')
    expect(await screen.findByText(/Não foi possível carregar as parcelas ativas/)).toBeTruthy()
    await u.click(screen.getByRole('tab', { name: 'Projeção' }))
    expect(await screen.findByText('Projeção de compromissos')).toBeTruthy()
  })
})
