// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import type { Cents } from '../../lib/format'
import { MASCARA, definirValoresOcultos } from '../../lib/privacidade'

const mock = vi.hoisted(() => ({ listarParcelasAtivas: vi.fn(), registrarFalhaConsulta: vi.fn() }))
vi.mock('../../lib/parcelasAtivas', () => ({ listarParcelasAtivas: mock.listarParcelasAtivas }))
vi.mock('../../lib/consultaOpcional', () => ({ registrarFalhaConsulta: mock.registrarFalhaConsulta }))

import { ParcelasAtivas } from './ParcelasAtivas'
import type { ParcelamentoAtivo, ParcelasAtivas as Dados } from '../../lib/parcelasAtivas'

const c = (n: number) => n as Cents
const plano = (p: Partial<ParcelamentoAtivo> = {}): ParcelamentoAtivo => ({
  chave: 'card:k1:p1', origem: 'card', moeda: 'BRL', descricao: 'Geladeira', origemId: 'k1', origemNome: 'Nubank',
  valorParcela: c(10000), parcelaAtual: 5, totalParcelas: 10, parcelasPagas: 4, percentualPago: 40,
  total: c(100000), pago: c(40000), saldoRestante: c(60000), futuro: c(50000), situacaoMes: 'pending',
  proximoVencimento: '2026-11-15', emAtraso: 0, ...p,
})
const dados = (parcelamentos: ParcelamentoAtivo[], totais: Dados['totais'] = []): Dados => ({ parcelamentos, totais })
const montar = () => render(<MemoryRouter><ParcelasAtivas familiaId="h1" /></MemoryRouter>)
const brl = (cents: number, moeda = 'BRL') => ({ moeda, qtde: 1, saldoRestante: c(cents), futuro: c(cents) })

beforeEach(() => { localStorage.clear(); definirValoresOcultos(false) })
afterEach(() => { cleanup(); vi.clearAllMocks(); definirValoresOcultos(false) })

describe('Parcelas ativas', () => {
  it('cada parcelamento vira um cartão: descrição, origem, parcela n de N, % pago, saldo restante e situação do mês', async () => {
    mock.listarParcelasAtivas.mockResolvedValue(dados([
      plano(),
      plano({ chave: 'account:g1', origem: 'account', descricao: 'Sofá', origemId: 'a1', origemNome: 'Banco', parcelaAtual: 3, totalParcelas: 5,
        percentualPago: 20, saldoRestante: c(40000), situacaoMes: 'paid', proximoVencimento: '2026-12-12' }),
      plano({ chave: 'card:k1:p2', descricao: 'Curso', situacaoMes: 'none', proximoVencimento: null }),
    ], [brl(80000)]))
    montar()
    const cartoes = await screen.findAllByTestId('parcelamento')
    expect(cartoes).toHaveLength(3)

    const geladeira = within(cartoes[0])
    expect(geladeira.getByRole('heading', { name: 'Geladeira' })).toBeTruthy()
    expect(geladeira.getByText(/Cartão de crédito/)).toBeTruthy()
    expect(geladeira.getByText('Parcela 5 de 10')).toBeTruthy()
    expect(geladeira.getByText('40% pago')).toBeTruthy()
    expect(geladeira.getByText('Saldo restante').nextSibling?.textContent).toBe('−R$ 600,00')
    expect(geladeira.getByText('−R$ 100,00')).toBeTruthy()
    expect(geladeira.getByText('Pendente de pagamento')).toBeTruthy()
    expect(geladeira.getByText('Próximo vencimento 15/11/2026')).toBeTruthy()

    const sofa = within(cartoes[1])
    expect(sofa.getByText(/Parcelamento em conta/)).toBeTruthy()
    expect(sofa.getByText('Parcela 3 de 5')).toBeTruthy()
    expect(sofa.getByText('Parcela deste mês paga')).toBeTruthy()

    expect(within(cartoes[2]).getByText('Nenhuma parcela neste mês')).toBeTruthy()
    expect(within(cartoes[2]).queryByText(/Próximo vencimento/)).toBeNull()
  })

  it('a barra de progresso é acessível e usa o percentual que veio do banco (nada é recalculado a partir dos valores)', async () => {
    // valores que, se recalculados no front, dariam outro número (pago 90% do total): o que vale é percentualPago = 37
    mock.listarParcelasAtivas.mockResolvedValue(dados([
      plano({ percentualPago: 37, total: c(100000), pago: c(90000), saldoRestante: c(10000) }),
    ], [brl(10000)]))
    montar()
    const barra = await screen.findByRole('progressbar', { name: 'Geladeira: 37% pago' })
    expect(barra.getAttribute('aria-valuenow')).toBe('37')
    expect(barra.getAttribute('aria-valuemin')).toBe('0')
    expect(barra.getAttribute('aria-valuemax')).toBe('100')
    expect((barra.firstElementChild as HTMLElement).style.width).toBe('37%')
  })

  it('o total vem do banco: a tela não soma os saldos dos cartões', async () => {
    mock.listarParcelasAtivas.mockResolvedValue(dados([
      plano({ saldoRestante: c(60000) }), plano({ chave: 'card:k1:p2', saldoRestante: c(20000) }),
    ], [{ moeda: 'BRL', qtde: 2, saldoRestante: c(123456), futuro: c(7890) }]))
    montar()
    const total = await screen.findByTestId('total-parcelas-BRL')
    expect(within(total).getByText('−R$ 1.234,56')).toBeTruthy()
    expect(within(total).getByText('−R$ 78,90')).toBeTruthy()
    expect(within(total).getByText(/Saldo restante · 2 parcelamentos/)).toBeTruthy()
    expect(within(total).getByText(/Nas faturas futuras/)).toBeTruthy()
    // a soma dos dois cartões (R$ 800,00) nunca é calculada
    expect(within(total).queryByText('−R$ 800,00')).toBeNull()
  })

  it('moedas diferentes têm totais separados, cada um na sua moeda', async () => {
    mock.listarParcelasAtivas.mockResolvedValue(dados([
      plano(), plano({ chave: 'account:g2', origem: 'account', moeda: 'USD', descricao: 'Curso em dólar', valorParcela: c(10000), saldoRestante: c(20000) }),
    ], [brl(60000), { moeda: 'USD', qtde: 1, saldoRestante: c(20000), futuro: c(20000) }]))
    montar()
    expect(await screen.findByTestId('total-parcelas-BRL')).toBeTruthy()
    const usd = screen.getByTestId('total-parcelas-USD')
    expect(usd.textContent).toContain('(USD)')
    expect(usd.textContent).toMatch(/US\$\s?200,00/)
  })

  it('atraso aparece com texto (a cor não é a única informação)', async () => {
    mock.listarParcelasAtivas.mockResolvedValue(dados([plano({ emAtraso: 1 }), plano({ chave: 'card:k1:p2', emAtraso: 2 })], [brl(1)]))
    montar()
    expect(await screen.findByText('1 parcela em atraso')).toBeTruthy()
    expect(screen.getByText('2 parcelas em atraso')).toBeTruthy()
  })

  it('valor da parcela e saldo restante são saídas: vermelho e com o sinal de menos', async () => {
    mock.listarParcelasAtivas.mockResolvedValue(dados([plano()], [brl(60000)]))
    montar()
    const cartao = await screen.findByTestId('parcelamento')
    for (const texto of ['−R$ 100,00', '−R$ 600,00']) {
      expect(within(cartao).getByText(texto).className).toContain('text-prejuizo')
    }
  })

  it('ocultar valores: nenhum valor em dinheiro aparece; o progresso (que não é dinheiro) continua', async () => {
    definirValoresOcultos(true)
    mock.listarParcelasAtivas.mockResolvedValue(dados([plano()], [brl(60000)]))
    montar()
    const cartao = await screen.findByTestId('parcelamento')
    expect(cartao.textContent).not.toMatch(/\d+,\d{2}/)
    expect(within(cartao).getAllByText(`−${MASCARA}`).length).toBe(2)
    expect(screen.getByTestId('total-parcelas-BRL').textContent).not.toMatch(/\d+,\d{2}/)
    expect(within(cartao).getByText('40% pago')).toBeTruthy()
    // ligar e desligar na hora, sem recarregar
    act(() => definirValoresOcultos(false))
    expect(within(cartao).getByText('−R$ 600,00')).toBeTruthy()
  })

  it('o cartão do parcelamento leva para a página do cartão', async () => {
    mock.listarParcelasAtivas.mockResolvedValue(dados([plano()], [brl(60000)]))
    montar()
    const link = await screen.findByRole('link', { name: 'Nubank' })
    expect(link.getAttribute('href')).toBe('/cartoes/k1')
  })

  it('"+ Novo parcelamento" abre o fluxo que já existe (compra no cartão); a despesa em conta tem o seu atalho', async () => {
    mock.listarParcelasAtivas.mockResolvedValue(dados([plano()], [brl(60000)]))
    montar()
    await screen.findByTestId('parcelamento')
    expect(screen.getByRole('link', { name: '+ Novo parcelamento' }).getAttribute('href')).toBe('/lancamentos?novo=cartao')
    expect(screen.getByRole('link', { name: 'Parcelar uma despesa em conta' }).getAttribute('href')).toBe('/lancamentos?novo=despesa')
  })

  it('a grade é responsiva: 1 coluna no celular, 2 no tablet e 3 no computador', async () => {
    mock.listarParcelasAtivas.mockResolvedValue(dados([plano()], [brl(60000)]))
    montar()
    const lista = (await screen.findByTestId('parcelamento')).parentElement as HTMLElement
    expect(lista.className).toContain('grid')
    expect(lista.className).toContain('md:grid-cols-2')
    expect(lista.className).toContain('xl:grid-cols-3')
    expect(lista.className).toMatch(/(^|\s)grid-cols-1(\s|$)/)
    expect(lista.className).not.toMatch(/(^|\s)grid-cols-[2-9]/)
  })

  it('sem parcelamento: estado vazio claro, com o botão de criar', async () => {
    mock.listarParcelasAtivas.mockResolvedValue(dados([]))
    montar()
    expect(await screen.findByText(/Nenhum parcelamento em andamento/)).toBeTruthy()
    expect(screen.queryByTestId('parcelamento')).toBeNull()
    expect(screen.getByRole('link', { name: '+ Novo parcelamento' })).toBeTruthy()
  })

  it('carregando: avisa e não mostra cartão nem vazio', () => {
    mock.listarParcelasAtivas.mockReturnValue(new Promise(() => undefined))
    montar()
    expect(screen.getByRole('status').textContent).toContain('Carregando')
    expect(screen.queryByText(/Nenhum parcelamento/)).toBeNull()
  })

  it('se a leitura falhar, só este bloco avisa (e a falha vai ao Sentry com o nome da consulta)', async () => {
    const falha = { code: '57014' }
    mock.listarParcelasAtivas.mockRejectedValue(falha)
    montar()
    expect(await screen.findByText(/Não foi possível carregar as parcelas ativas/)).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Parcelas ativas' })).toBeTruthy()
    expect(screen.queryByTestId('parcelamento')).toBeNull()
    expect(screen.queryByText(/Nenhum parcelamento/)).toBeNull()
    expect(mock.registrarFalhaConsulta).toHaveBeenCalledWith('active_installment_plans', falha)
  })
})
