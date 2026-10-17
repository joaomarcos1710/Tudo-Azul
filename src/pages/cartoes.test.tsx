// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Cents } from '../lib/format'

const mock = vi.hoisted(() => ({
  cobrarFaturasFechadas: vi.fn(),
  listarCartoes: vi.fn(),
  criarCartao: vi.fn(),
  definirCiclo: vi.fn(),
  registrarCompra: vi.fn(),
  listarFaturas: vi.fn(),
  listarItens: vi.fn(),
  pagarFatura: vi.fn(),
  listarContas: vi.fn(),
  listarCategorias: vi.fn(),
}))
vi.mock('../lib/FamiliaContext', () => ({
  useFamilia: () => ({ familia: { id: 'h1', nome: 'Casa', papel: 'owner' }, carregando: false, erro: false, recarregar: vi.fn() }),
}))
vi.mock('../lib/cartoes', async (o) => ({
  ...(await o<typeof import('../lib/cartoes')>()),
  cobrarFaturasFechadas: mock.cobrarFaturasFechadas, listarCartoes: mock.listarCartoes, criarCartao: mock.criarCartao,
  definirCiclo: mock.definirCiclo, registrarCompra: mock.registrarCompra, listarFaturas: mock.listarFaturas,
  listarItens: mock.listarItens, pagarFatura: mock.pagarFatura,
}))
vi.mock('../lib/contas', async (o) => ({ ...(await o<typeof import('../lib/contas')>()), listarContas: mock.listarContas }))
vi.mock('../lib/categorias', async (o) => ({ ...(await o<typeof import('../lib/categorias')>()), listarCategorias: mock.listarCategorias }))

import Cartoes from './Cartoes'
import { ontemSP, situacaoFatura } from '../lib/cartoes'
import type { Fatura } from '../lib/cartoes'

const c = (n: number) => n as Cents
const nubank = { id: 'k1', nome: 'Nubank', fechamento: 17, vencimento: 25, ativo: true, divida: c(13334), credito: c(0), compromissos: c(39666) }
const fatura = (f: Partial<Fatura>): Fatura => ({
  mes: '2026-03', fechamento: '2026-03-17', vencimento: '2026-03-25', cobrado: c(0), aCobrar: c(0), total: c(0), pago: c(0), itens: 1, faturaId: null, ...f,
})

beforeEach(() => {
  mock.cobrarFaturasFechadas.mockResolvedValue(0)
  mock.listarCartoes.mockResolvedValue([nubank])
  mock.listarContas.mockResolvedValue({ contas: [{ id: 'a1', nome: 'Itaú', tipo: 'checking', saldoInicial: c(0), abertura: '2026-01-01', ativa: true, saldo: c(500000) }], total: c(500000) })
  mock.listarCategorias.mockResolvedValue([
    { id: 'g1', nome: 'Compras pessoais', tipo: 'expense', paiId: null, sistema: false, ativa: true },
    { id: 'g2', nome: 'Salário', tipo: 'income', paiId: null, sistema: false, ativa: true },
  ])
  mock.listarFaturas.mockResolvedValue([])
  mock.listarItens.mockResolvedValue([])
  for (const f of [mock.criarCartao, mock.definirCiclo, mock.registrarCompra, mock.pagarFatura]) f.mockResolvedValue(undefined)
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('regras auxiliares', () => {
  it('ontemSP usa o dia de São Paulo e vira o mês', () => {
    expect(ontemSP(new Date('2026-03-01T12:00:00Z'))).toBe('2026-02-28')
    expect(ontemSP(new Date('2026-12-01T02:30:00Z'))).toBe('2026-11-29') // 23h30 de 30/11 em SP
  })
  it('situação da fatura', () => {
    expect(situacaoFatura(fatura({ fechamento: '2026-10-20' }), '2026-10-17')).toBe('aberta')
    expect(situacaoFatura(fatura({ cobrado: c(100), pago: c(0) }), '2026-10-17')).toBe('fechada')
    expect(situacaoFatura(fatura({ cobrado: c(100), pago: c(100) }), '2026-10-17')).toBe('paga')
  })
})

describe('Cartões', () => {
  it('cobra as faturas fechadas antes de mostrar os valores do banco', async () => {
    render(<Cartoes />)
    expect(await screen.findByText('Nubank')).toBeTruthy()
    expect(mock.cobrarFaturasFechadas).toHaveBeenCalled()
    expect(mock.cobrarFaturasFechadas.mock.invocationCallOrder[0]).toBeLessThan(mock.listarCartoes.mock.invocationCallOrder[0])
    expect(screen.getByText('Fecha dia 17 · vence dia 25')).toBeTruthy()
    expect(screen.getByText('R$ 133,34')).toBeTruthy()
    expect(screen.getByText('R$ 396,66')).toBeTruthy()
  })

  it('sem cartões, convida a cadastrar', async () => {
    mock.listarCartoes.mockResolvedValue([])
    render(<Cartoes />)
    expect(await screen.findByText('Nenhum cartão ainda')).toBeTruthy()
  })

  it('cartão sem ciclo não aceita compra', async () => {
    mock.listarCartoes.mockResolvedValue([{ ...nubank, fechamento: null, vencimento: null }])
    render(<Cartoes />)
    expect(await screen.findByText(/Defina o dia de fechamento/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Nova compra' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('cadastra cartão com fechamento, vencimento e faturas em aberto', async () => {
    const u = userEvent.setup()
    mock.listarCartoes.mockResolvedValue([])
    render(<Cartoes />)
    await u.click(await screen.findByRole('button', { name: 'Novo cartão' }))
    await u.type(screen.getByLabelText('Nome'), 'Nubank')
    await u.selectOptions(screen.getByLabelText('Dia do fechamento'), '17')
    await u.selectOptions(screen.getByLabelText('Dia do vencimento'), '25')
    const saldo = screen.getByLabelText('Faturas fechadas e não pagas hoje (R$)')
    await u.clear(saldo)
    await u.type(saldo, '1.250,50')
    await u.click(screen.getByRole('button', { name: 'Cadastrar cartão' }))
    expect(mock.criarCartao).toHaveBeenCalledWith({ nome: 'Nubank', fechamento: 17, vencimento: 25, saldoAtual: 125050 })
  })

  it('compra nova parcelada envia o total e o número de parcelas', async () => {
    const u = userEvent.setup()
    render(<Cartoes />)
    await u.click(await screen.findByRole('button', { name: 'Nova compra' }))
    await u.type(screen.getByLabelText('Descrição'), 'TV')
    await u.selectOptions(screen.getByLabelText('Categoria'), 'g1')
    expect(screen.queryByRole('option', { name: 'Salário' })).toBeNull() // só categorias de despesa
    await u.type(screen.getByLabelText('Valor total (R$)'), '300,00')
    const parcelas = screen.getByLabelText('Parcelas')
    await u.clear(parcelas)
    await u.type(parcelas, '3')
    const data = screen.getByLabelText('Data da compra')
    await u.clear(data)
    await u.type(data, '2026-10-15')
    await u.click(screen.getByRole('button', { name: 'Lançar compra' }))
    expect(mock.registrarCompra).toHaveBeenCalledWith('k1', { descricao: 'TV', data: '2026-10-15', total: 30000, parcelas: 3, categoriaId: 'g1' })
  })

  it('parcelamento em andamento: valor da parcela × parcelas restantes, a partir de hoje', async () => {
    const u = userEvent.setup()
    render(<Cartoes />)
    await u.click(await screen.findByRole('button', { name: 'Nova compra' }))
    await u.click(screen.getByLabelText('Parcelamento já em andamento'))
    await u.type(screen.getByLabelText('Descrição'), 'Geladeira (iniciada em agosto)')
    await u.selectOptions(screen.getByLabelText('Categoria'), 'g1')
    await u.type(screen.getByLabelText('Valor de cada parcela (R$)'), '250,00')
    const parcelas = screen.getByLabelText(/Parcelas que ainda faltam/)
    await u.clear(parcelas)
    await u.type(parcelas, '7')
    expect(screen.queryByLabelText('Data da compra')).toBeNull()
    await u.click(screen.getByRole('button', { name: 'Lançar compra' }))
    const [, dados] = mock.registrarCompra.mock.calls[0]
    expect(dados).toMatchObject({ total: 175000, parcelas: 7 })
    expect(dados.data).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('compra sem categoria não é enviada', async () => {
    const u = userEvent.setup()
    render(<Cartoes />)
    await u.click(await screen.findByRole('button', { name: 'Nova compra' }))
    await u.type(screen.getByLabelText('Descrição'), 'TV')
    await u.type(screen.getByLabelText('Valor total (R$)'), '300,00')
    await u.click(screen.getByRole('button', { name: 'Lançar compra' }))
    expect(screen.getByText('Escolha a categoria.')).toBeTruthy()
    expect(mock.registrarCompra).not.toHaveBeenCalled()
  })

  it('pagar fatura: sugere a dívida e liga à fatura fechada mais antiga', async () => {
    const u = userEvent.setup()
    mock.listarFaturas.mockResolvedValue([
      fatura({ mes: '2026-03', fechamento: '2026-03-17', cobrado: c(13334), total: c(13334), faturaId: 'f3' }),
      fatura({ mes: '2099-01', fechamento: '2099-01-17', aCobrar: c(100), total: c(100) }),
    ])
    render(<Cartoes />)
    await u.click(await screen.findByRole('button', { name: 'Pagar fatura' }))
    expect((screen.getByLabelText('Valor (R$)') as HTMLInputElement).value).toBe('133,34')
    expect(await screen.findByText(/Quita a fatura de/)).toBeTruthy()
    await u.selectOptions(screen.getByLabelText('Pagar com a conta'), 'a1')
    await u.click(screen.getByRole('button', { name: 'Registrar pagamento' }))
    expect(mock.pagarFatura).toHaveBeenCalledWith('k1', expect.objectContaining({ contaId: 'a1', valor: 13334, faturaId: 'f3' }))
  })

  it('mostra as faturas com total e os itens com n/N', async () => {
    const u = userEvent.setup()
    mock.listarFaturas.mockResolvedValue([fatura({ mes: '2099-04', fechamento: '2099-04-17', aCobrar: c(18000), total: c(18000), itens: 2 })])
    mock.listarItens.mockResolvedValue([
      { parcelaId: 'p1', compra: 'x', parcela: 2, deParcelas: 3, descricao: 'TV', dataCompra: '2099-03-15', valor: c(10000), falta: c(10000), categoriaId: 'g1' },
    ])
    render(<Cartoes />)
    await u.click(await screen.findByRole('button', { name: 'Ver faturas' }))
    expect(await screen.findByText('R$ 180,00')).toBeTruthy()
    expect(await screen.findByText('· 2/3')).toBeTruthy()
    expect(screen.getByText('Aberta')).toBeTruthy()
    expect(mock.listarItens).toHaveBeenCalledWith('k1', '2099-04')
  })
})
