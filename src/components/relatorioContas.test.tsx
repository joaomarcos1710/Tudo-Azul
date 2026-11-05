// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mock = vi.hoisted(() => ({ relatorioContas: vi.fn(), listarContas: vi.fn() }))
vi.mock('../lib/FamiliaContext', () => ({
  useFamilia: () => ({ familia: { id: 'h1', nome: 'Casa', papel: 'owner' }, carregando: false, erro: false, recarregar: vi.fn() }),
}))
vi.mock('../lib/fluxoCaixa', async (o) => ({ ...(await o<typeof import('../lib/fluxoCaixa')>()), relatorioContas: mock.relatorioContas }))
vi.mock('../lib/contas', async (o) => ({ ...(await o<typeof import('../lib/contas')>()), listarContas: mock.listarContas, hojeSP: () => '2026-11-05' }))

import { RelatorioContas, avisoOutraMoeda } from './RelatorioContas'
import type { RelatorioContas as Relatorio } from '../lib/fluxoCaixa'
import type { Cents } from '../lib/format'
import { periodoDoMes } from '../lib/periodoRelatorio'
import type { Periodo } from '../lib/periodoRelatorio'

const c = (n: number) => n as Cents
const novembro = periodoDoMes('2026-11')

// dados inventados; os totais NÃO são a soma das linhas, de propósito: a tela mostra o total do banco, não soma
const doBanco: Relatorio = {
  linhas: [
    { contaId: 'a1', nome: 'Banco', tipo: 'checking', saldoInicial: c(100000), entradas: c(50000), saidas: c(40000),
      transferenciasEntrada: c(0), transferenciasSaida: c(20000), saldoFinal: c(110000) },
    { contaId: 'a2', nome: 'Poupança', tipo: 'savings', saldoInicial: c(0), entradas: c(20000), saidas: c(0),
      transferenciasEntrada: c(20000), transferenciasSaida: c(0), saldoFinal: c(20000) },
    { contaId: 'a3', nome: 'Carteira', tipo: 'cash', saldoInicial: c(-5000), entradas: c(0), saidas: c(1000),
      transferenciasEntrada: c(0), transferenciasSaida: c(0), saldoFinal: c(-6000) },
  ],
  totalInicial: c(95000), totalEntradas: c(50000), totalSaidas: c(21000), totalTransferencias: c(0), totalFinal: c(777700),
}

beforeEach(() => {
  mock.relatorioContas.mockResolvedValue(doBanco)
  mock.listarContas.mockResolvedValue({ contas: [{ id: 'a1', nome: 'Banco', ativa: true, moeda: 'BRL' }], total: c(0) })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

function abrir(periodo: Periodo = novembro, aoMudarPeriodo = vi.fn()) {
  render(<RelatorioContas periodo={periodo} aoMudarPeriodo={aoMudarPeriodo} />)
  return aoMudarPeriodo
}
const linhas = async () => screen.findAllByTestId('linha-conta')
/** Texto (versão do computador, com R$) e cor de cada célula de valor da linha. */
const celulas = (tr: HTMLElement) => within(tr).getAllByRole('cell').map((td) => {
  const s = td.querySelector('span.sm\\:inline') as HTMLElement
  return `${s.textContent}|${s.className.split(' ').find((k) => k.startsWith('text-'))}`
})

describe('Relatório › Contas', () => {
  it('uma linha por conta (a ordem do banco), com saldo inicial, entradas, saídas e saldo final; azul, vermelho com "−" e cinza no zero', async () => {
    abrir()
    const [banco, poup, carteira] = await linhas()
    expect(mock.relatorioContas).toHaveBeenCalledWith('h1', '2026-11-01', '2026-11-30', false)
    expect(within(banco).getByRole('rowheader').textContent).toContain('Banco')
    expect(celulas(banco)).toEqual(['R$ 1.000,00|text-azul', 'R$ 500,00|text-azul', '−R$ 400,00|text-negativo', 'R$ 1.100,00|text-azul'])
    expect(celulas(poup)).toEqual(['R$ 0,00|text-slate-500', 'R$ 200,00|text-azul', 'R$ 0,00|text-slate-500', 'R$ 200,00|text-azul'])
    expect(celulas(carteira)).toEqual(['−R$ 50,00|text-negativo', 'R$ 0,00|text-slate-500', '−R$ 10,00|text-negativo', '−R$ 60,00|text-negativo'])
  })

  it('transferência aparece na conta (entrada numa, saída na outra) e o total é o do banco, sem as transferências', async () => {
    abrir()
    const [banco, poup, carteira] = await linhas()
    expect(within(banco).getByRole('rowheader').textContent).toContain('Transferências: −R$ 200,00')
    expect(within(poup).getByRole('rowheader').textContent).toContain('Transferências: +R$ 200,00')
    expect(within(carteira).getByRole('rowheader').textContent).not.toContain('Transferências')
    const total = screen.getByTestId('total-contas')
    expect(within(total).getByRole('rowheader').textContent).toContain('sem as transferências')
    // 7.777,00 só existe no total do banco: a tela não somou as linhas
    expect(celulas(total)).toEqual(['R$ 950,00|text-azul', 'R$ 500,00|text-azul', '−R$ 210,00|text-negativo', 'R$ 7.777,00|text-azul'])
    expect(screen.getByTestId('notas-contas').textContent).toMatch(/as transferências somam R\$ 0,00 no total da família/)
  })

  it('"Todos" pede os não pagos ao banco (planejados, faturas e assinaturas no vencimento, fixos previstos)', async () => {
    const u = userEvent.setup()
    abrir()
    await linhas()
    expect(screen.getByRole('button', { name: 'Só pagos' }).getAttribute('aria-pressed')).toBe('true')
    await u.click(screen.getByRole('button', { name: 'Todos' }))
    expect(mock.relatorioContas).toHaveBeenLastCalledWith('h1', '2026-11-01', '2026-11-30', true)
    await linhas()
    expect(screen.getByTestId('notas-contas').textContent).toMatch(/assinaturas previstas/)
  })

  it('o período vem da página: as setas pedem o próximo à página e a tabela segue o período recebido', async () => {
    const u = userEvent.setup()
    const aoMudar = abrir()
    await linhas()
    await u.click(screen.getByRole('button', { name: 'Próximo período' }))
    expect(aoMudar).toHaveBeenCalledWith({ tipo: 'mes', de: '2026-12-01', ate: '2026-12-31' })
    cleanup()
    abrir(periodoDoMes('2026-12'))
    await linhas()
    expect(mock.relatorioContas).toHaveBeenLastCalledWith('h1', '2026-12-01', '2026-12-31', false)
    expect(screen.getByText('Contas · Dezembro de 2026')).toBeTruthy()
  })

  it('conta em outra moeda: avisa quantas ativas ficam fora (a desativada não conta)', async () => {
    mock.listarContas.mockResolvedValue({ contas: [
      { id: 'a1', nome: 'Banco', ativa: true, moeda: 'BRL' }, { id: 'u1', nome: 'Nomad USD', ativa: true, moeda: 'USD' },
      { id: 'e1', nome: 'Nomad EUR', ativa: true, moeda: 'EUR' }, { id: 'e2', nome: 'Antiga EUR', ativa: false, moeda: 'EUR' },
    ], total: c(0) })
    abrir()
    expect(await screen.findByText('2 contas em outra moeda ficam fora (o relatório é em reais, sem conversão).')).toBeTruthy()
    expect(avisoOutraMoeda(1)).toBe('1 conta em outra moeda fica fora (o relatório é em reais, sem conversão).')
  })

  it('só contas em reais: sem aviso de outra moeda', async () => {
    abrir()
    await linhas()
    expect(screen.queryByText(/em outra moeda/)).toBeNull()
  })

  it('erro do banco aparece; sem conta, diz que não há conta', async () => {
    mock.relatorioContas.mockRejectedValueOnce({ code: '22023', message: 'período inválido (até 10 anos)' })
    abrir()
    expect(await screen.findByRole('alert')).toBeTruthy()
    cleanup()
    mock.relatorioContas.mockResolvedValueOnce({ ...doBanco, linhas: [] })
    abrir()
    expect(await screen.findByText(/Nenhuma conta ativa em reais/)).toBeTruthy()
  })
})
