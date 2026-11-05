// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AvisosInicio } from './AvisosInicio'
import type { AvisoInicio } from '../../lib/avisosInicio'
import { MASCARA, definirValoresOcultos } from '../../lib/privacidade'
import type { Cents } from '../../lib/format'

const c = (n: number) => n as Cents
const HOJE = '2026-04-20'
const aviso = (a: Partial<AvisoInicio> & Pick<AvisoInicio, 'tipo'>): AvisoInicio => ({
  quantidade: 1, total: c(20000), data: '2026-04-23', cartaoId: null, cartaoNome: null, ...a,
})
const montar = (avisos: AvisoInicio[]) => render(<MemoryRouter><AvisosInicio avisos={avisos} hoje={HOJE} /></MemoryRouter>)
const link = (nome: RegExp) => screen.getByRole('link', { name: nome })

afterEach(() => { cleanup(); definirValoresOcultos(false) })

describe('Avisos do topo do Início', () => {
  it('sem avisos, a faixa não aparece', () => {
    const { container } = montar([])
    expect(container.innerHTML).toBe('')
    expect(screen.queryByRole('region', { name: 'Avisos' })).toBeNull()
  })

  it('a receber: singular, total do banco e link para Lançamentos filtrado por receita no mês', () => {
    montar([aviso({ tipo: 'receivable' })])
    const l = link(/^Contas a receber: Você tem 1 conta a receber no total de R\$ 200,00 nos próximos 7 dias\.$/)
    expect(l.getAttribute('href')).toBe('/lancamentos?mes=2026-04&tipo=receita')
    expect(within(l).getByText('Contas a receber')).toBeTruthy()
  })

  it('#183: o ícone de cada aviso segue a regra de cores (vencido vermelho; fatura, a pagar e atrasado atenção; a receber verde)', () => {
    montar([aviso({ tipo: 'overdue_payable' }), aviso({ tipo: 'overdue_receivable' }), aviso({ tipo: 'invoice', cartaoNome: 'Cartão X' }),
      aviso({ tipo: 'payable' }), aviso({ tipo: 'receivable' })])
    const corDoIcone = (titulo: string) => (within(screen.getByRole('region', { name: 'Avisos' })).getByText(titulo).closest('a') as HTMLElement)
      .querySelector('[aria-hidden="true"]')!.className.match(/text-(prejuizo|atencao|agendado|lucro)\b/)?.[0]
    expect(corDoIcone('Contas vencidas')).toBe('text-prejuizo')
    expect(corDoIcone('Recebimentos atrasados')).toBe('text-atencao')
    expect(corDoIcone('Fatura do cartão')).toBe('text-atencao')
    expect(corDoIcone('Contas a pagar')).toBe('text-atencao')
    expect(corDoIcone('Contas a receber')).toBe('text-agendado')
  })

  it('a pagar: plural e link filtrado por despesa no mês do mais próximo', () => {
    montar([aviso({ tipo: 'payable', quantidade: 3, total: c(106250), data: '2026-04-30' })])
    expect(link(/Você tem 3 contas a pagar no total de R\$ 1\.062,50 nos próximos 7 dias/).getAttribute('href'))
      .toBe('/lancamentos?mes=2026-04&tipo=despesa')
  })

  it('fatura: cartão, valor e data, com link para a tela do cartão', () => {
    montar([
      aviso({ tipo: 'invoice', total: c(8000), data: '2026-04-25', cartaoId: 'k1', cartaoNome: 'Cartão Azul' }),
      aviso({ tipo: 'invoice', total: c(500), data: '2026-04-21', cartaoId: 'k2', cartaoNome: 'Nubank' }),
      aviso({ tipo: 'invoice', total: c(100), data: HOJE, cartaoId: 'k3', cartaoNome: 'Inter' }),
    ])
    expect(link(/A fatura do Cartão Azul de R\$ 80,00 vence em 25\/04\./).getAttribute('href')).toBe('/cartoes?cartao=k1')
    expect(link(/A fatura do Nubank de R\$ 5,00 vence amanhã\./).getAttribute('href')).toBe('/cartoes?cartao=k2')
    expect(link(/A fatura do Inter de R\$ 1,00 vence hoje\./)).toBeTruthy()
  })

  it('vencidos: a pagar e a receber, singular e plural, levando ao card de vencidos', () => {
    montar([
      aviso({ tipo: 'overdue_payable', quantidade: 1, total: c(3000), data: '2026-04-10' }),
      aviso({ tipo: 'overdue_receivable', quantidade: 2, total: c(1500), data: '2026-04-15' }),
    ])
    expect(link(/^Contas vencidas: Você tem 1 conta a pagar já vencida no total de R\$ 30,00\.$/).getAttribute('href')).toBe('#vencidos')
    expect(link(/^Recebimentos atrasados: Você tem 2 contas a receber com a data já passada no total de R\$ 15,00\.$/).getAttribute('href')).toBe('#vencidos')
  })

  it('"ocultar valores": a máscara vale no texto e no aria-label (o leitor de tela não revela o valor)', () => {
    definirValoresOcultos(true)
    montar([aviso({ tipo: 'receivable' })])
    const l = link(/Contas a receber/)
    expect(l.getAttribute('aria-label')).toContain(MASCARA)
    expect(l.getAttribute('aria-label')).not.toContain('200,00')
    expect(l.textContent).not.toContain('200,00')
  })

  it('celular: rolagem com snap e pontinhos (um por aviso) só quando há mais de um; computador: grade', () => {
    montar([aviso({ tipo: 'payable' }), aviso({ tipo: 'receivable' })])
    const lista = screen.getByTestId('avisos-inicio')
    expect(lista.className).toMatch(/snap-x/)
    expect(lista.className).toMatch(/overflow-x-auto/)
    expect(lista.className).toMatch(/md:grid/)
    const pontos = screen.getByTestId('avisos-pontinhos')
    expect(pontos.getAttribute('aria-hidden')).toBe('true')
    expect(pontos.children).toHaveLength(2)
    expect(pontos.children[0].getAttribute('data-ativo')).toBe('true')
    cleanup()
    montar([aviso({ tipo: 'payable' })])
    expect(screen.queryByTestId('avisos-pontinhos')).toBeNull()
  })
})
