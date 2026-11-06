// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Cents } from '../lib/format'

const mock = vi.hoisted(() => ({
  cobrarFaturasFechadas: vi.fn(),
  listarCartoes: vi.fn(),
  listarMovimentosDoCartao: vi.fn(),
  anularMovimentoCartao: vi.fn(),
  criarCartao: vi.fn(),
  definirCiclo: vi.fn(),
  definirLimite: vi.fn(),
  definirIdentidade: vi.fn(),
  arquivarCartao: vi.fn(),
  renomearCartao: vi.fn(),
  definirContaPagamento: vi.fn(),
  reativarCartao: vi.fn(),
  excluirCartao: vi.fn(),
  registrarCompra: vi.fn(),
  lancarCreditoNoCartao: vi.fn(),
  listarCreditosDaFatura: vi.fn(),
  trocarCategoriaDoCredito: vi.fn(),
  listarFaturas: vi.fn(),
  listarItens: vi.fn(),
  pagarFatura: vi.fn(),
  reabrirFatura: vi.fn(),
  previaExclusao: vi.fn(),
  excluirCompra: vi.fn(),
  editarParcela: vi.fn(),
  listarContas: vi.fn(),
  listarCategorias: vi.fn(),
  totalFaturasDoMes: vi.fn(),
  estornarParcela: vi.fn(),
  listarPagamentosDaFatura: vi.fn(),
  visaoDosCartoes: vi.fn(),
}))
vi.mock('../lib/FamiliaContext', () => ({
  useFamilia: () => ({ familia: { id: 'h1', nome: 'Casa', papel: 'owner' }, carregando: false, erro: false, recarregar: vi.fn() }),
}))
vi.mock('../lib/cartoes', async (o) => ({
  ...(await o<typeof import('../lib/cartoes')>()),
  cobrarFaturasFechadas: mock.cobrarFaturasFechadas, listarCartoes: mock.listarCartoes, criarCartao: mock.criarCartao,
  listarMovimentosDoCartao: mock.listarMovimentosDoCartao, anularMovimentoCartao: mock.anularMovimentoCartao,
  definirCiclo: mock.definirCiclo, definirLimite: mock.definirLimite, definirIdentidade: mock.definirIdentidade, arquivarCartao: mock.arquivarCartao, renomearCartao: mock.renomearCartao, definirContaPagamento: mock.definirContaPagamento, reativarCartao: mock.reativarCartao, excluirCartao: mock.excluirCartao, registrarCompra: mock.registrarCompra, listarFaturas: mock.listarFaturas,
  listarItens: mock.listarItens, pagarFatura: mock.pagarFatura, reabrirFatura: mock.reabrirFatura,
  previaExclusao: mock.previaExclusao, excluirCompra: mock.excluirCompra, editarParcela: mock.editarParcela,
  lancarCreditoNoCartao: mock.lancarCreditoNoCartao, listarCreditosDaFatura: mock.listarCreditosDaFatura,
  trocarCategoriaDoCredito: mock.trocarCategoriaDoCredito, totalFaturasDoMes: mock.totalFaturasDoMes, estornarParcela: mock.estornarParcela, listarPagamentosDaFatura: mock.listarPagamentosDaFatura,
  visaoDosCartoes: mock.visaoDosCartoes,
}))
vi.mock('../lib/recorrencias', () => ({ gerarOcorrencias: () => Promise.resolve(0) }))
vi.mock('../lib/contas', async (o) => ({ ...(await o<typeof import('../lib/contas')>()), listarContas: mock.listarContas }))
vi.mock('../lib/categorias', async (o) => ({ ...(await o<typeof import('../lib/categorias')>()), listarCategorias: mock.listarCategorias }))

import Cartoes from './Cartoes'
import { fechamentoDaCompra, inicioDaTroca, melhorDiaDeCompra, ontemSP, proximaFatura, situacaoFatura } from '../lib/cartoes'
import { hojeSP } from '../lib/contas'
import { formatDate } from '../lib/format'
import type { Fatura, VisaoCartoes } from '../lib/cartoes'

const c = (n: number) => n as Cents
/** Fixa só o relógio (Date): "hoje" em São Paulo = `dia`, ao meio-dia. Timers continuam reais (Testing Library e userEvent). */
function fixarHoje(dia: string) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${dia}T15:00:00Z`))
}
/** Abre o menu "⋯" do cartão e escolhe a ação (as ações secundárias ficam lá desde a #163). */
async function escolherNoMenu(u: ReturnType<typeof userEvent.setup>, acao: string, cartao = 'Nubank') {
  await u.click(await screen.findByRole('button', { name: `Mais opções do cartão ${cartao}` }))
  await u.click(within(screen.getByRole('menu', { name: `Mais opções do cartão ${cartao}` })).getByRole('menuitem', { name: acao }))
}
/** Ações de uma compra ou crédito da fatura (#183): ficam no ⋯ da linha ("Ações de TV", "Ações do crédito Cashback"). */
async function acaoDaLinha(u: ReturnType<typeof userEvent.setup>, menu: string, acao: string) {
  await u.click(await screen.findByRole('button', { name: menu }))
  await u.click(within(screen.getByRole('menu', { name: menu })).getByRole('menuitem', { name: acao }))
}
/** O "Ver fatura" do próprio cartão (#181; o resumo tem outro igual para a próxima fatura). */
async function botaoVerFatura(cartao = 'Nubank') {
  const li = (await screen.findByRole('heading', { name: new RegExp(`^${cartao}`) })).closest('li')!
  return within(li).getByRole('button', { name: /^Ver fatura/ })
}
/** Pagar fatura (#181): "Ver fatura" no cartão e, dentro da fatura, "Pagar fatura". */
async function abrirPagar(u: ReturnType<typeof userEvent.setup>, cartao = 'Nubank') {
  await u.click(await botaoVerFatura(cartao))
  await u.click(await screen.findByRole('button', { name: 'Pagar fatura' }))
}
const nubank = { id: 'k1', nome: 'Nubank', emissor: null, bandeira: null, fechamento: 17, vencimento: 25, ativo: true, divida: c(13334), credito: c(0), compromissos: c(39666), limite: null, limiteComprometido: null, limiteDisponivel: null }
const fatura = (f: Partial<Fatura>): Fatura => ({
  mes: '2026-03', fechamento: '2026-03-17', vencimento: '2026-03-25', cobrado: c(0), aCobrar: c(0), total: c(0), pago: c(0), itens: 1, faturaId: null,
  saldoAnterior: c(0), adiantamentoEntrada: c(0), adiantamentoSaida: c(0), creditos: c(0), ...f,
})

beforeEach(() => {
  mock.listarMovimentosDoCartao.mockResolvedValue([])
  mock.cobrarFaturasFechadas.mockResolvedValue(0)
  mock.listarCartoes.mockResolvedValue([nubank])
  mock.listarContas.mockResolvedValue({ contas: [{ id: 'a1', nome: 'Itaú', tipo: 'checking', saldoInicial: c(0), abertura: '2026-01-01', ativa: true, saldo: c(500000) }], total: c(500000) })
  mock.listarCategorias.mockResolvedValue([
    { id: 'g1', nome: 'Compras pessoais', tipo: 'expense', paiId: null, sistema: false, ativa: true, eventual: false },
    { id: 'g2', nome: 'Salário', tipo: 'income', paiId: null, sistema: false, ativa: true, eventual: false },
    { id: 'g3', nome: 'Estorno de IOF', tipo: 'income', paiId: 'g2', sistema: false, ativa: true, eventual: false },
  ])
  mock.listarFaturas.mockResolvedValue([])
  mock.listarItens.mockResolvedValue([])
  mock.previaExclusao.mockResolvedValue([])
  mock.listarCreditosDaFatura.mockResolvedValue([])
  mock.lancarCreditoNoCartao.mockResolvedValue('ev1')
  mock.totalFaturasDoMes.mockResolvedValue(null)
  mock.estornarParcela.mockResolvedValue(undefined)
  mock.listarPagamentosDaFatura.mockResolvedValue([])
  // padrão: banco sem a migration 065 (a tela lê card_months por cartão); os testes da 065 definem o resumo
  mock.visaoDosCartoes.mockResolvedValue(null)
  for (const f of [mock.criarCartao, mock.definirCiclo, mock.definirLimite, mock.definirIdentidade, mock.arquivarCartao, mock.renomearCartao, mock.definirContaPagamento, mock.reativarCartao, mock.excluirCartao, mock.registrarCompra, mock.pagarFatura, mock.reabrirFatura, mock.excluirCompra, mock.editarParcela]) f.mockResolvedValue(undefined)
})
afterEach(() => {
  vi.useRealTimers()
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
    expect(situacaoFatura(fatura({ cobrado: c(100), total: c(100), pago: c(0) }), '2026-10-17')).toBe('fechada')
    expect(situacaoFatura(fatura({ cobrado: c(100), total: c(100), pago: c(100) }), '2026-10-17')).toBe('paga')
    expect(situacaoFatura(fatura({ total: c(0) }), '2026-10-17')).toBe('paga') // fatura sem nada
  })
  it('situação: fechada ainda não cobrada (card_bill_due falhou) não aparece como "Paga"', () => {
    // depois do fechamento, cobrado 0 e total > 0: falta cobrar, então é "fechada" (antes saía "paga" pelo cobrado 0)
    expect(situacaoFatura(fatura({ fechamento: '2026-03-17', cobrado: c(0), aCobrar: c(5000), total: c(5000), pago: c(0) }), '2026-03-20')).toBe('fechada')
    expect(situacaoFatura(fatura({ fechamento: '2026-03-17', cobrado: c(0), aCobrar: c(5000), total: c(5000), pago: c(5000) }), '2026-03-20')).toBe('paga')
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

  it('no cartão, "Ver fatura" em pílula azul no lugar do "Pagar fatura de <mês> (vence …)"; sem dívida, "Nova compra" é a principal', async () => {
    const { unmount } = render(<Cartoes />)
    await screen.findByText('Nubank')
    const ver = await botaoVerFatura()
    expect(ver.textContent).toBe('Ver fatura')
    expect(ver.className.split(' ')).toEqual(expect.arrayContaining(['rounded-full', 'bg-azul-claro', 'text-azul']))
    expect(screen.queryByRole('button', { name: /^Pagar fatura/ })).toBeNull() // pagar só dentro da fatura
    expect(screen.getByRole('button', { name: 'Nova compra' }).className.split(' ')).not.toContain('bg-azul')
    // #183: "Fatura fechada a pagar" ainda no prazo é atenção (âmbar); vermelho só quando vence
    expect(screen.getByText('R$ 133,34').className).toContain('text-atencao')
    expect(screen.getByText('R$ 133,34').className).not.toContain('text-prejuizo')
    unmount()

    mock.listarCartoes.mockResolvedValue([{ ...nubank, divida: c(0) }])
    render(<Cartoes />)
    await screen.findByText('Nubank')
    expect(screen.getByRole('button', { name: 'Nova compra' }).className.split(' ')).toContain('bg-azul')
    expect((await botaoVerFatura()).className.split(' ')).not.toContain('bg-azul')
    expect(screen.queryByText('R$ 0,00')).toBeNull() // sem fatura fechada, o zero não vai para o destaque (#163)
  })

  it('?cartao=<id> (aviso de fatura do Início) abre as faturas daquele cartão', async () => {
    window.history.pushState({}, '', '/cartoes?cartao=k1')
    try {
      render(<Cartoes />)
      await screen.findByText('Nubank')
      expect(screen.getByRole('button', { name: 'Ocultar faturas' }).getAttribute('aria-expanded')).toBe('true')
      expect(document.getElementById('cartao-k1')).toBeTruthy()
    } finally {
      window.history.pushState({}, '', '/')
    }
  })

  it('sem ?cartao=, as faturas começam fechadas', async () => {
    render(<Cartoes />)
    await screen.findByText('Nubank')
    expect(screen.queryByRole('button', { name: 'Ocultar faturas' })).toBeNull()
    expect(screen.queryByRole('tablist')).toBeNull()
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
    expect(mock.criarCartao).toHaveBeenCalledWith({ nome: 'Nubank', fechamento: 17, vencimento: 25, saldoAtual: 125050, emissor: null, bandeira: null, contaPagamentoId: null })
  })

  it('cadastra cartão com emissor e bandeira (nome livre)', async () => {
    const u = userEvent.setup()
    mock.listarCartoes.mockResolvedValue([])
    render(<Cartoes />)
    await u.click(await screen.findByRole('button', { name: 'Novo cartão' }))
    await u.type(screen.getByLabelText('Nome'), 'Cartão principal')
    await u.selectOptions(screen.getByLabelText('Banco emissor'), 'Nubank')
    await u.selectOptions(screen.getByLabelText('Bandeira'), 'Mastercard')
    await u.selectOptions(screen.getByLabelText('Dia do fechamento'), '17')
    await u.selectOptions(screen.getByLabelText('Dia do vencimento'), '25')
    await u.click(screen.getByRole('button', { name: 'Cadastrar cartão' }))
    expect(mock.criarCartao).toHaveBeenCalledWith({ nome: 'Cartão principal', fechamento: 17, vencimento: 25, saldoAtual: 0, emissor: 'nubank', bandeira: 'mastercard', contaPagamentoId: null })
  })

  it('escolhe banco e bandeira de um cartão existente e pode limpar', async () => {
    const u = userEvent.setup()
    render(<Cartoes />)
    await escolherNoMenu(u, 'Banco e bandeira')
    await u.selectOptions(screen.getByLabelText('Banco emissor'), 'Itaú')
    await u.selectOptions(screen.getByLabelText('Bandeira'), 'Visa')
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(mock.definirIdentidade).toHaveBeenCalledWith('k1', 'itau', 'visa')
    cleanup()
    mock.listarCartoes.mockResolvedValue([{ ...nubank, emissor: 'itau', bandeira: 'visa' }])
    render(<Cartoes />)
    await escolherNoMenu(u, 'Banco e bandeira')
    await u.selectOptions(screen.getByLabelText('Banco emissor'), 'Automático (pelo nome do cartão)')
    await u.selectOptions(screen.getByLabelText('Bandeira'), 'Não informar')
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(mock.definirIdentidade).toHaveBeenLastCalledWith('k1', null, null)
  })

  it('mostra o selo do emissor e a bandeira no cartão, mesmo com nome sem banco', async () => {
    mock.listarCartoes.mockResolvedValue([{ ...nubank, nome: 'Cartão principal', emissor: 'nubank', bandeira: 'mastercard' }])
    const { container } = render(<Cartoes />)
    await screen.findByRole('heading', { name: 'Cartão principal' })
    expect(container.querySelector('[data-banco="nubank"]')).not.toBeNull()
    expect(container.querySelector('img[data-bandeira="mastercard"]')).not.toBeNull()
  })

  it('cartão sem emissor nem bandeira: cai no nome e não mostra bandeira', async () => {
    const { container } = render(<Cartoes />)
    await screen.findByRole('heading', { name: 'Nubank' })
    expect(container.querySelector('[data-banco="nubank"]')).not.toBeNull()
    expect(container.querySelector('img[data-bandeira]')).toBeNull()
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
    expect(mock.registrarCompra).toHaveBeenCalledWith('k1', { descricao: 'TV', data: '2026-10-15', total: 30000, parcelas: 3, categoriaId: 'g1' }, expect.any(String))
  })

  it('compra em outra fatura: o seletor manda o deslocamento escolhido', async () => {
    const u = userEvent.setup()
    render(<Cartoes />)
    await u.click(await screen.findByRole('button', { name: 'Nova compra' }))
    await u.type(screen.getByLabelText('Descrição'), 'TV')
    await u.selectOptions(screen.getByLabelText('Categoria'), 'g1')
    await u.type(screen.getByLabelText('Valor total (R$)'), '300,00')
    const data = screen.getByLabelText('Data da compra')
    await u.clear(data)
    await u.type(data, '2026-10-15')
    const fatura = screen.getByLabelText('Fatura') as HTMLSelectElement
    expect(fatura.options).toHaveLength(7)
    await u.selectOptions(fatura, '-1')
    await u.click(screen.getByRole('button', { name: 'Lançar compra' }))
    expect(mock.registrarCompra).toHaveBeenCalledWith('k1', { descricao: 'TV', data: '2026-10-15', total: 30000, parcelas: 1, categoriaId: 'g1', deslocamento: -1 }, expect.any(String))
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
    await abrirPagar(u)
    expect((screen.getByLabelText('Valor (R$)') as HTMLInputElement).value).toBe('133,34')
    expect(await screen.findByText(/Quita a fatura de/)).toBeTruthy()
    await u.selectOptions(screen.getByLabelText('Pagar com a conta'), 'a1')
    await u.click(screen.getByRole('button', { name: 'Registrar pagamento' }))
    expect(mock.pagarFatura).toHaveBeenCalledWith('k1', expect.objectContaining({ contaId: 'a1', valor: 13334, faturaId: 'f3' }), expect.any(String))
  })

  it('sem fatura fechada, dá para pagar adiantado: o aviso explica que vira crédito e o pagamento não liga a nenhuma fatura', async () => {
    const u = userEvent.setup()
    mock.listarCartoes.mockResolvedValue([{ ...nubank, divida: c(0), compromissos: c(20000) }])
    mock.listarFaturas.mockResolvedValue([fatura({ mes: '2099-01', fechamento: '2099-01-17', aCobrar: c(10000), total: c(10000) })])
    render(<Cartoes />)
    await u.click(await botaoVerFatura())
    const botao = (await screen.findByRole('button', { name: 'Pagar fatura' })) as HTMLButtonElement
    expect(botao.disabled).toBe(false)
    // o parágrafo fixo saiu do cartão (#163): a explicação aparece no diálogo de pagamento, antes de digitar o valor
    expect(screen.queryByText(/Não há fatura fechada/)).toBeNull()

    await u.click(botao)
    expect((screen.getByLabelText('Valor (R$)') as HTMLInputElement).value).toBe('') // sem dívida, não sugere valor
    expect((await screen.findByText(/Não há fatura fechada/)).textContent).toMatch(/pagar antes do fechamento vira crédito no cartão/)
    await u.selectOptions(screen.getByLabelText('Pagar com a conta'), 'a1')
    await u.type(screen.getByLabelText('Valor (R$)'), '120,00')
    await u.click(screen.getByRole('button', { name: 'Registrar pagamento' }))
    expect(mock.pagarFatura).toHaveBeenCalledWith('k1', expect.objectContaining({ contaId: 'a1', valor: 12000, faturaId: null }), expect.any(String))
  })

  it('pagar mais que a fatura fechada: o excedente vira crédito e a tela avisa; mais que tudo, pede para conferir', async () => {
    const u = userEvent.setup()
    mock.listarFaturas.mockResolvedValue([fatura({ mes: '2026-03', fechamento: '2026-03-17', cobrado: c(13334), total: c(13334), faturaId: 'f3' })])
    render(<Cartoes />)
    await abrirPagar(u)
    const valor = screen.getByLabelText('Valor (R$)')
    await u.clear(valor)
    await u.type(valor, '200,00') // fatura 133,34; passa da fatura, mas cabe nas parcelas futuras (396,66)
    expect(await screen.findByText(/O que passar da fatura fechada \(R\$ 133,34\)/)).toBeTruthy()
    expect(screen.queryByText(/mais do que tudo o que este cartão tem a pagar/)).toBeNull()
    await u.clear(valor)
    await u.type(valor, '900,00') // passa de fatura + parcelas futuras (133,34 + 396,66 = 530,00)
    expect(await screen.findByText(/mais do que tudo o que este cartão tem a pagar/)).toBeTruthy()
    await u.click(screen.getByRole('button', { name: 'Registrar pagamento' }))
    expect(mock.pagarFatura).toHaveBeenCalledWith('k1', expect.objectContaining({ valor: 90000, faturaId: 'f3' }), expect.any(String))
  })

  it('o aviso de "mais que tudo" desconta o crédito que o cartão já tem', async () => {
    const u = userEvent.setup()
    mock.listarCartoes.mockResolvedValue([{ ...nubank, divida: c(0), compromissos: c(20000), credito: c(12000) }])
    render(<Cartoes />)
    await abrirPagar(u)
    await u.type(screen.getByLabelText('Valor (R$)'), '100,00') // 100 > 200 − 120 = 80 que ainda falta cobrir
    expect(await screen.findByText(/mais do que tudo o que este cartão tem a pagar/)).toBeTruthy()
  })

  it('mostra as faturas com total e os itens com n/N', async () => {
    const u = userEvent.setup()
    mock.listarFaturas.mockResolvedValue([fatura({ mes: '2099-04', fechamento: '2099-04-17', aCobrar: c(18000), total: c(18000), itens: 2 })])
    mock.listarItens.mockResolvedValue([
      { parcelaId: 'p1', compra: 'x', parcela: 2, deParcelas: 3, descricao: 'TV', dataCompra: '2099-03-15', valor: c(10000), falta: c(10000), categoriaId: 'g1' },
    ])
    render(<Cartoes />)
    await u.click(await botaoVerFatura())
    // a fatura de 2099 não é a do ciclo atual: aparece só na lista de faturas (o destaque mostra a atual, sem compras)
    // na aba e no "Gasto do mês" do resumo da fatura escolhida
    expect((await screen.findAllByText('R$ 180,00')).length).toBe(2)
    expect(await screen.findByText('2/3')).toBeTruthy()
    expect(screen.getAllByText('Aberta').length).toBe(2) // selo da aba e do cabeçalho da fatura
    // #183: fatura aberta (a pagar no futuro) = agendado, verde
    for (const selo of screen.getAllByText('Aberta')) expect(selo.className).toContain('bg-agendado-fundo text-agendado')
    expect(mock.listarItens).toHaveBeenCalledWith('k1', '2099-04')
  })

  it('fatura como extrato: compras agrupadas por dia (mais recente primeiro), nome inteiro, categoria e situação; sem data no fim', async () => {
    const u = userEvent.setup()
    mock.listarFaturas.mockResolvedValue([fatura({ mes: '2099-04', fechamento: '2099-04-17', aCobrar: c(30000), total: c(30000), itens: 3 })])
    mock.listarItens.mockResolvedValue([
      { parcelaId: 'p1', compra: 'a', parcela: 1, deParcelas: 10, descricao: 'Viagem para Floripa com a família', dataCompra: '2099-03-24', valor: c(10000), falta: c(10000), categoriaId: 'g1' },
      { parcelaId: 'p2', compra: 'b', parcela: 1, deParcelas: 1, descricao: 'Cinema', dataCompra: '2099-03-28', valor: c(4550), falta: c(0), categoriaId: 'g1' },
      { parcelaId: 'p3', compra: 'c', parcela: 3, deParcelas: 3, descricao: 'Antiga', dataCompra: null, valor: c(1000), falta: c(0), categoriaId: 'g1' },
    ])
    render(<Cartoes />)
    await u.click(await botaoVerFatura())
    await screen.findByText('Viagem para Floripa com a família')
    const dias = screen.getAllByRole('group').filter((g) => /\d{2}\/\d{2}\/\d{4}|Sem data/.test(g.getAttribute('aria-label') ?? ''))
    expect(dias.map((g) => g.getAttribute('aria-label'))).toEqual(['28/03/2099', '24/03/2099', 'Sem data da compra'])
    const viagem = within(dias[1]).getByText('Viagem para Floripa com a família').closest('li')!
    expect(within(viagem).getByText('1/10')).toBeTruthy()
    expect(within(viagem).getByText('Compras pessoais · a cobrar no fechamento')).toBeTruthy()
    expect(within(dias[0]).getByText('Compras pessoais')).toBeTruthy() // já cobrada: sem "a cobrar"
    expect(within(dias[0]).queryByText('1/1')).toBeNull() // à vista não mostra parcela
  })

  it('cada item da fatura mostra o ícone da categoria da compra', async () => {
    const u = userEvent.setup()
    mock.listarFaturas.mockResolvedValue([fatura({ mes: '2099-04', fechamento: '2099-04-17', aCobrar: c(10000), total: c(10000), itens: 1 })])
    mock.listarItens.mockResolvedValue([
      { parcelaId: 'p1', compra: 'x', parcela: 1, deParcelas: 10, descricao: 'Viagem', dataCompra: '2099-03-24', valor: c(10000), falta: c(10000), categoriaId: 'g1' },
    ])
    render(<Cartoes />)
    await u.click(await botaoVerFatura())
    const linha = (await screen.findByText('Viagem')).closest('li')!
    expect(linha.querySelector('[data-icone]')!.getAttribute('data-icone')).toBe('sacola') // g1 = Compras pessoais
  })

  const item = { parcelaId: 'p1', compra: 'x', parcela: 2, deParcelas: 3, descricao: 'TV', dataCompra: '2099-03-15', valor: c(10000), falta: c(10000), categoriaId: 'g1' }
  const abrirFatura = async (u: ReturnType<typeof userEvent.setup>, f: Partial<Fatura> = {}) => {
    mock.listarFaturas.mockResolvedValue([fatura({ mes: '2099-04', fechamento: '2099-04-17', aCobrar: c(10000), total: c(10000), itens: 1, ...f })])
    mock.listarItens.mockResolvedValue([item])
    render(<Cartoes />)
    await u.click(await botaoVerFatura())
    await screen.findByText('2/3')
  }

  it('edita o valor de uma parcela (só ela)', async () => {
    const u = userEvent.setup()
    await abrirFatura(u)
    await acaoDaLinha(u, 'Ações de TV', 'Editar valor')
    const campo = screen.getByLabelText('Valor da parcela (R$)')
    await u.clear(campo)
    await u.type(campo, '100,01')
    await u.click(screen.getByRole('button', { name: 'Salvar valor' }))
    expect(mock.editarParcela).toHaveBeenCalledWith('p1', 10001)
  })

  it('excluir compra mostra a prévia (dinheiro volta para a conta) e só exclui ao confirmar', async () => {
    const u = userEvent.setup()
    mock.previaExclusao.mockResolvedValue([
      { tipo: 'payment', data: '2099-04-20', valor: c(10000), contaId: 'a1', fatura: '2099-04' },
      { tipo: 'cancel', data: '2099-05-17', valor: c(20000), contaId: null, fatura: null },
    ])
    await abrirFatura(u)
    await acaoDaLinha(u, 'Ações de TV', 'Excluir compra')
    expect(await screen.findByText(/o dinheiro volta para/)).toBeTruthy()
    expect(screen.getByText('Itaú')).toBeTruthy()
    expect(mock.excluirCompra).not.toHaveBeenCalled()
    await u.click(screen.getByRole('button', { name: 'Excluir compra' }))
    expect(mock.excluirCompra).toHaveBeenCalledWith('k1', 'x')
  })

  it('reabrir fatura com pagamento (ainda não travada: não fechou) pede confirmação e chama o banco', async () => {
    const u = userEvent.setup()
    await abrirFatura(u, { cobrado: c(10000), aCobrar: c(0), pago: c(10000), faturaId: 'f4' })
    await u.click(screen.getByRole('button', { name: 'Reabrir fatura' }))
    expect(mock.reabrirFatura).not.toHaveBeenCalled()
    await u.click(within(screen.getByRole('group', { name: 'Reabrir fatura' })).getByRole('button', { name: 'Reabrir fatura' }))
    expect(mock.reabrirFatura).toHaveBeenCalledWith('k1', '2099-04')
  })

  it('crédito / reembolso: só categorias de RECEITA e envia valor em centavos, data e descrição', async () => {
    const u = userEvent.setup()
    render(<Cartoes />)
    await escolherNoMenu(u, 'Crédito / reembolso')
    await u.type(screen.getByLabelText('Descrição'), 'Estorno de IOF')
    expect(screen.queryByRole('option', { name: 'Compras pessoais' })).toBeNull() // só receita
    await u.selectOptions(screen.getByLabelText('Categoria de receita'), 'g2')
    await u.type(screen.getByLabelText('Valor (R$)'), '50,00')
    const data = screen.getByLabelText('Data do crédito')
    await u.clear(data)
    await u.type(data, '2026-10-10')
    await u.click(screen.getByRole('button', { name: 'Lançar crédito' }))
    expect(mock.lancarCreditoNoCartao).toHaveBeenCalledWith('k1',
      { descricao: 'Estorno de IOF', data: '2026-10-10', valor: 5000, categoriaId: 'g2', fechamento: null }, expect.any(String))
  })

  it('crédito / reembolso: pode escolher uma fatura posterior; sem categoria não envia', async () => {
    const u = userEvent.setup()
    mock.listarFaturas.mockResolvedValue([
      fatura({ mes: '2026-09', fechamento: '2026-09-17' }), fatura({ mes: '2026-11', fechamento: '2026-11-17' }),
    ])
    render(<Cartoes />)
    await escolherNoMenu(u, 'Crédito / reembolso')
    await u.type(screen.getByLabelText('Descrição'), 'Cashback')
    await u.type(screen.getByLabelText('Valor (R$)'), '10,00')
    const data = screen.getByLabelText('Data do crédito')
    await u.clear(data)
    await u.type(data, '2026-10-01')
    expect(screen.queryByRole('option', { name: /Setembro/i })).toBeNull() // fechou antes do crédito
    await u.selectOptions(screen.getByLabelText('Fatura'), '2026-11-17')
    await u.click(screen.getByRole('button', { name: 'Lançar crédito' }))
    expect(screen.getByText('Escolha a categoria de receita.')).toBeTruthy()
    expect(mock.lancarCreditoNoCartao).not.toHaveBeenCalled()
    await u.selectOptions(screen.getByLabelText('Categoria de receita'), 'g2')
    await u.click(screen.getByRole('button', { name: 'Lançar crédito' }))
    expect(mock.lancarCreditoNoCartao).toHaveBeenCalledWith('k1', expect.objectContaining({ fechamento: '2026-11-17', valor: 1000 }), expect.any(String))
  })

  it('o crédito aparece na fatura em azul, com sinal +, e pode ser anulado', async () => {
    const u = userEvent.setup()
    mock.listarCreditosDaFatura.mockResolvedValue([
      { id: 'ev9', descricao: 'Reembolso do plano', dataCredito: '2099-04-02', fechamento: '2099-04-17', valor: c(5000), categoriaId: 'g2' },
    ])
    mock.anularMovimentoCartao.mockResolvedValue(undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await abrirFatura(u, { creditos: c(5000) })
    expect(mock.listarCreditosDaFatura).toHaveBeenCalledWith('k1', '2099-04')
    const linha = (await screen.findByText('Reembolso do plano')).closest('li')!
    const valor = within(linha).getByText(/^\+R\$\s?50,00$/)
    expect(valor.className).toContain('text-lucro')
    expect(within(linha).getByText(/Salário · receita/)).toBeTruthy()
    expect(screen.getByText(/Créditos e reembolsos nesta fatura.*R\$\s?50,00/)).toBeTruthy()
    await acaoDaLinha(u, 'Ações do crédito Reembolso do plano', 'Anular crédito')
    expect(mock.anularMovimentoCartao).toHaveBeenCalledWith('ev9', expect.any(String))
  })

  it('mostra saldo anterior e adiantamento da fatura', async () => {
    const u = userEvent.setup()
    await abrirFatura(u, { saldoAnterior: c(4000), adiantamentoSaida: c(2500) })
    const resumo = screen.getByLabelText('Resumo da fatura')
    expect(within(resumo).getByText('Saldo anterior').nextElementSibling?.textContent).toMatch(/R\$\s?40,00/)
    expect(screen.getByText(/Sobra de adiantamento.*R\$\s?25,00/)).toBeTruthy()
  })

  it('se a cobrança das faturas falhar, mostra aviso e mantém os cartões', async () => {
    mock.cobrarFaturasFechadas.mockRejectedValue(new Error('x'))
    render(<Cartoes />)
    expect(await screen.findByText('Nubank')).toBeTruthy()
    expect(screen.getByText(/Não foi possível fechar as faturas agora/)).toBeTruthy()
  })

  it('anular um pagamento: pede confirmação, anula e recarrega; cancelar a confirmação não anula', async () => {
    const u = userEvent.setup()
    mock.listarCartoes.mockResolvedValue([{ ...nubank, divida: c(0), compromissos: c(0), credito: c(10000) }])
    mock.listarMovimentosDoCartao.mockResolvedValue([
      { id: 'ev1', data: '2026-10-24', tipo: 'pagamento', valor: c(10000), ligadoAFatura: false },
    ])
    mock.anularMovimentoCartao.mockResolvedValue(undefined)
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<Cartoes />)
    await u.click(await botaoVerFatura())
    await u.click(await screen.findByRole('button', { name: 'Anular' }))
    expect(confirmar).toHaveBeenCalled()
    expect(mock.anularMovimentoCartao).not.toHaveBeenCalled()
    confirmar.mockReturnValue(true)
    await u.click(screen.getByRole('button', { name: 'Anular' }))
    expect(mock.anularMovimentoCartao).toHaveBeenCalledWith('ev1', expect.any(String))
  })
})

describe('Limite do cartão', () => {
  const comLimite = { ...nubank, limite: c(580000), limiteComprometido: c(53000), limiteDisponivel: c(527000) }

  it('sem limite, não mostra barra e oferece "Definir limite"', async () => {
    render(<Cartoes />)
    await screen.findByText('Nubank')
    expect(screen.queryByText(/Disponível R\$/)).toBeNull()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Mais opções do cartão Nubank' }))
    expect(screen.getByRole('menuitem', { name: 'Definir limite' })).toBeTruthy()
  })

  it('com limite, mostra limite, disponível e comprometido vindos do banco', async () => {
    mock.listarCartoes.mockResolvedValue([comLimite])
    render(<Cartoes />)
    expect(await screen.findByText('Limite R$ 5.800,00')).toBeTruthy()
    expect(screen.getByText('Disponível R$ 5.270,00')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Comprometido R$ 530,00 de R$ 5.800,00' })).toBeTruthy()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Mais opções do cartão Nubank' }))
    expect(screen.getByRole('menuitem', { name: 'Alterar limite' })).toBeTruthy()
  })

  it('passou do limite: avisa o quanto, sem bloquear nada', async () => {
    mock.listarCartoes.mockResolvedValue([{ ...comLimite, limiteComprometido: c(600000), limiteDisponivel: c(-20000) }])
    render(<Cartoes />)
    expect(await screen.findByText('Passou do limite em R$ 200,00')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Nova compra' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('grava o limite em centavos', async () => {
    const u = userEvent.setup()
    render(<Cartoes />)
    await escolherNoMenu(u, 'Definir limite')
    await u.type(screen.getByLabelText('Limite do cartão (R$)'), '5.800,00')
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(mock.definirLimite).toHaveBeenCalledWith('k1', 580000)
  })

  it('campo em branco remove o limite', async () => {
    const u = userEvent.setup()
    mock.listarCartoes.mockResolvedValue([comLimite])
    render(<Cartoes />)
    await escolherNoMenu(u, 'Alterar limite')
    await u.clear(screen.getByLabelText('Limite do cartão (R$)'))
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(mock.definirLimite).toHaveBeenCalledWith('k1', null)
  })

  it('valor inválido ou zero não chega ao banco', async () => {
    const u = userEvent.setup()
    render(<Cartoes />)
    await escolherNoMenu(u, 'Definir limite')
    await u.type(screen.getByLabelText('Limite do cartão (R$)'), '0')
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText(/Valor inválido/)).toBeTruthy()
    expect(mock.definirLimite).not.toHaveBeenCalled()
  })
})

describe('Arquivar e excluir cartão', () => {
  it('arquivar pede confirmação e só então chama o banco', async () => {
    render(<Cartoes />)
    const u = userEvent.setup()
    await escolherNoMenu(u, 'Arquivar')
    expect(mock.arquivarCartao).not.toHaveBeenCalled()
    await u.click(within(screen.getByRole('group', { name: 'Arquivar cartão' })).getByRole('button', { name: 'Arquivar cartão' }))
    expect(mock.arquivarCartao).toHaveBeenCalledWith('k1')
  })

  it('excluir cartão chama o banco depois da confirmação', async () => {
    render(<Cartoes />)
    const u = userEvent.setup()
    await escolherNoMenu(u, 'Excluir')
    await u.click(within(screen.getByRole('group', { name: 'Excluir cartão' })).getByRole('button', { name: 'Excluir cartão' }))
    expect(mock.excluirCartao).toHaveBeenCalledWith('k1')
  })

  it('com histórico o banco recusa e a regra aparece na tela', async () => {
    mock.excluirCartao.mockRejectedValue({ code: '23503', message: 'tem histórico: só é possível arquivar' })
    render(<Cartoes />)
    const u = userEvent.setup()
    await escolherNoMenu(u, 'Excluir')
    await u.click(within(screen.getByRole('group', { name: 'Excluir cartão' })).getByRole('button', { name: 'Excluir cartão' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Tem histórico: só é possível arquivar.')
  })

  it('arquivado sai da lista principal, aparece em Arquivados e reativa', async () => {
    mock.listarCartoes.mockResolvedValue([nubank, { ...nubank, id: 'k2', nome: 'Cartão antigo', ativo: false }])
    render(<Cartoes />)
    const secao = (await screen.findByRole('heading', { name: 'Arquivados' })).closest('section')!
    expect(within(secao).getByText(/Cartão antigo/)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /^Mais opções do cartão/ })).toHaveLength(1) // só o cartão ativo tem o menu (com Arquivar)
    expect(screen.queryAllByText(/Fatura fechada a pagar/)).toHaveLength(1)
    await userEvent.setup().click(within(secao).getByRole('button', { name: 'Reativar' }))
    expect(mock.reativarCartao).toHaveBeenCalledWith('k2')
  })

  it('sem cartão arquivado não mostra a seção', async () => {
    render(<Cartoes />)
    await screen.findByRole('button', { name: 'Mais opções do cartão Nubank' })
    expect(screen.queryByRole('heading', { name: 'Arquivados' })).toBeNull()
  })
})

describe('Renomear cartão', () => {
  it('abre com o nome atual e grava o nome aparado', async () => {
    render(<Cartoes />)
    const u = userEvent.setup()
    await escolherNoMenu(u, 'Renomear')
    const campo = screen.getByLabelText('Nome do cartão') as HTMLInputElement
    expect(campo.value).toBe('Nubank')
    await u.clear(campo)
    await u.type(campo, '  Nubank Roxinho  ')
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(mock.renomearCartao).toHaveBeenCalledWith('k1', 'Nubank Roxinho')
  })

  it('nome vazio não chama o banco', async () => {
    render(<Cartoes />)
    const u = userEvent.setup()
    await escolherNoMenu(u, 'Renomear')
    await u.clear(screen.getByLabelText('Nome do cartão'))
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText('Use de 1 a 60 caracteres.')).toBeTruthy()
    expect(mock.renomearCartao).not.toHaveBeenCalled()
  })

  it('nome repetido mostra a mensagem do banco', async () => {
    mock.renomearCartao.mockRejectedValue({ code: '23505', message: 'duplicate key value violates unique constraint "debts_name_uq"' })
    render(<Cartoes />)
    const u = userEvent.setup()
    await escolherNoMenu(u, 'Renomear')
    await u.type(screen.getByLabelText('Nome do cartão'), ' 2')
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Já existe um registro com esse nome.')
  })
})

describe('Conta de pagamento do cartão', () => {
  it('no cadastro, a conta escolhida vai junto; sem escolher, vai null', async () => {
    mock.listarCartoes.mockResolvedValue([])
    render(<Cartoes />)
    const u = userEvent.setup()
    await u.click(await screen.findByRole('button', { name: 'Cadastrar o primeiro cartão' }))
    await u.type(screen.getByLabelText('Nome'), 'Caixa Infinite')
    await u.selectOptions(screen.getByLabelText('Dia do fechamento'), '18')
    await u.selectOptions(screen.getByLabelText('Dia do vencimento'), '28')
    await u.selectOptions(screen.getByLabelText('Conta que paga a fatura (opcional)'), 'a1')
    await u.click(screen.getByRole('button', { name: 'Cadastrar cartão' }))
    expect(mock.criarCartao).toHaveBeenCalledWith(expect.objectContaining({ nome: 'Caixa Infinite', contaPagamentoId: 'a1' }))
  })

  it('mostra "paga com" e permite trocar a conta; "Nenhuma" limpa', async () => {
    mock.listarCartoes.mockResolvedValue([{ ...nubank, contaPagamentoId: 'a1' }])
    render(<Cartoes />)
    const u = userEvent.setup()
    expect(await screen.findByText(/paga com Itaú/)).toBeTruthy()
    await escolherNoMenu(u, 'Conta de pagamento')
    const seletor = screen.getByLabelText('Conta que paga a fatura') as HTMLSelectElement
    expect(seletor.value).toBe('a1')
    await u.selectOptions(seletor, '')
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(mock.definirContaPagamento).toHaveBeenCalledWith('k1', null)
  })

  it('"Pagar fatura" já vem com a conta de pagamento do cartão escolhida', async () => {
    mock.listarContas.mockResolvedValue({ contas: [
      { id: 'a1', nome: 'Itaú', tipo: 'checking', saldoInicial: c(0), abertura: '2026-01-01', ativa: true, saldo: c(500000) },
      { id: 'a2', nome: 'Caixa', tipo: 'checking', saldoInicial: c(0), abertura: '2026-01-01', ativa: true, saldo: c(100000) },
    ], total: c(600000) })
    mock.listarCartoes.mockResolvedValue([{ ...nubank, contaPagamentoId: 'a2' }])
    render(<Cartoes />)
    await abrirPagar(userEvent.setup())
    expect((screen.getByLabelText('Pagar com a conta') as HTMLSelectElement).value).toBe('a2')
  })

  it('conta de pagamento arquivada não é pré-selecionada', async () => {
    mock.listarContas.mockResolvedValue({ contas: [
      { id: 'a1', nome: 'Itaú', tipo: 'checking', saldoInicial: c(0), abertura: '2026-01-01', ativa: true, saldo: c(500000) },
      { id: 'a2', nome: 'Antiga', tipo: 'checking', saldoInicial: c(0), abertura: '2026-01-01', ativa: false, saldo: c(0) },
    ], total: c(500000) })
    mock.listarCartoes.mockResolvedValue([{ ...nubank, contaPagamentoId: 'a2' }])
    render(<Cartoes />)
    await abrirPagar(userEvent.setup())
    expect((screen.getByLabelText('Pagar com a conta') as HTMLSelectElement).value).toBe('a1')
  })

  it('multimoeda F1: conta em outra moeda não paga fatura nem vira conta de pagamento (o banco também recusa)', async () => {
    mock.listarContas.mockResolvedValue({ contas: [
      { id: 'a1', nome: 'Itaú', tipo: 'checking', saldoInicial: c(0), abertura: '2026-01-01', ativa: true, saldo: c(500000), moeda: 'BRL' },
      { id: 'a3', nome: 'Conta em dólar', tipo: 'checking', saldoInicial: c(0), abertura: '2026-01-01', ativa: true, saldo: c(10000), moeda: 'USD' },
    ], total: c(500000) })
    mock.listarCartoes.mockResolvedValue([nubank])
    render(<Cartoes />)
    const u = userEvent.setup()
    const opcoes = (rotulo: string) => Array.from((screen.getByLabelText(rotulo) as HTMLSelectElement).options).map((o) => o.textContent)
    await escolherNoMenu(u, 'Conta de pagamento')
    expect(opcoes('Conta que paga a fatura')).toContain('Itaú')
    expect(opcoes('Conta que paga a fatura')).not.toContain('Conta em dólar')
    await u.click(screen.getByRole('button', { name: 'Cancelar' }))
    await abrirPagar(u)
    expect(opcoes('Pagar com a conta')).toContain('Itaú')
    expect(opcoes('Pagar com a conta')).not.toContain('Conta em dólar')
  })
})

describe('Destaque da fatura (fatura atual)', () => {
  it('cartão sem ciclo: escolhe a aberta que fecha primeiro e ignora fechada e paga', () => {
    const hoje = '2026-10-30'
    const fs = [
      fatura({ mes: '2026-09', fechamento: '2026-09-18', vencimento: '2026-09-28', cobrado: c(5000), pago: c(5000), total: c(5000) }), // paga
      fatura({ mes: '2026-10', fechamento: '2026-10-18', vencimento: '2026-10-28', cobrado: c(7000), pago: c(0), total: c(7000) }), // fechada
      fatura({ mes: '2027-01', fechamento: '2027-01-18', vencimento: '2027-01-28', aCobrar: c(300), total: c(300) }),
      fatura({ mes: '2026-11', fechamento: '2026-11-18', vencimento: '2026-11-28', aCobrar: c(43897), total: c(43897) }),
    ]
    expect(proximaFatura(fs, hoje)).toEqual({ mes: '2026-11', vencimento: '2026-11-28', total: c(43897) })
    expect(proximaFatura(fs.slice(0, 2), hoje)).toBeNull()
    expect(proximaFatura([], hoje)).toBeNull()
  })

  it('a fatura atual é a do ciclo de hoje, pela regra do banco: sem compra nele, R$ 0,00 com a data certa (não a do mês seguinte)', () => {
    const ciclo = { fechamento: 18, vencimento: 28 }
    // hoje 05/11, fecha dia 18: ciclo atual fecha 18/11 e vence 28/11; só há compra na fatura de dezembro
    const fs = [fatura({ mes: '2026-12', fechamento: '2026-12-18', vencimento: '2026-12-28', aCobrar: c(43897), total: c(43897) })]
    expect(proximaFatura(fs, '2026-11-05', ciclo)).toEqual({ mes: '2026-11', vencimento: '2026-11-28', total: c(0) })
    // com linha do ciclo atual, o valor e o vencimento são os do banco
    const comAtual = [fatura({ mes: '2026-11', fechamento: '2026-11-18', vencimento: '2026-11-30', aCobrar: c(100), total: c(100) }), ...fs]
    expect(proximaFatura(comAtual, '2026-11-05', ciclo)).toEqual({ mes: '2026-11', vencimento: '2026-11-30', total: c(100) })
    // no dia do fechamento a compra já vai para a seguinte; fecha 28 e vence 5: vencimento no mês seguinte
    expect(proximaFatura([], '2026-11-18', ciclo)).toEqual({ mes: '2026-12', vencimento: '2026-12-28', total: c(0) })
    expect(proximaFatura([], '2026-12-20', { fechamento: 28, vencimento: 5 })).toEqual({ mes: '2026-12', vencimento: '2027-01-05', total: c(0) })
    // fecha dia 31 em fevereiro: fecha 28/02 (como o banco); no dia 28 já é março
    expect(proximaFatura([], '2026-02-27', { fechamento: 31, vencimento: 10 })).toEqual({ mes: '2026-02', vencimento: '2026-03-10', total: c(0) })
    expect(proximaFatura([], '2026-02-28', { fechamento: 31, vencimento: 10 })).toEqual({ mes: '2026-03', vencimento: '2026-04-10', total: c(0) })
  })

  it('sem fatura fechada, o destaque é a "Fatura atual" (aberta) com o valor do banco; nada de "R$ 0,00" em destaque', async () => {
    fixarHoje('2026-11-05')
    mock.listarCartoes.mockResolvedValue([{ ...nubank, divida: c(0), fechamento: 18, vencimento: 28 }])
    mock.listarFaturas.mockResolvedValue([fatura({ mes: '2026-11', fechamento: '2026-11-18', vencimento: '2026-11-28', aCobrar: c(1183405), total: c(1183405) })])
    render(<Cartoes />)
    const rotulo = await screen.findByText(/^Fatura atual \(vence 28\/11\)/)
    expect(rotulo.textContent).toContain('aberta — fecha dia 18')
    const valor = screen.getByText('R$ 11.834,05')
    expect(valor.className).toContain('text-3xl')
    expect(screen.queryByText('R$ 0,00')).toBeNull()
    // no cartão (o resumo ao lado tem o seu "Próxima fatura vence em", que é outra coisa: uma data)
    const cartao = screen.getByRole('heading', { name: /^Nubank/ }).closest('li')!
    expect(within(cartao).queryByText(/Fatura fechada a pagar|Fatura a pagar|Próxima fatura/)).toBeNull()
  })

  it('com fatura fechada e não paga, ela é o destaque (com o vencimento) e a atual aparece embaixo, menor', async () => {
    fixarHoje('2026-11-05')
    mock.listarFaturas.mockResolvedValue([
      fatura({ mes: '2026-10', fechamento: '2026-10-17', vencimento: '2026-10-25', cobrado: c(13334), total: c(13334), faturaId: 'f3' }),
      fatura({ mes: '2026-11', fechamento: '2026-11-17', vencimento: '2026-11-25', aCobrar: c(43897), total: c(43897) }),
    ])
    render(<Cartoes />)
    // 25/10 já passou em 05/11: é vencida (selo da #166); o texto passa a "venceu"
    expect(await screen.findByText('Fatura fechada a pagar (venceu 25/10)')).toBeTruthy()
    expect(screen.getByText('R$ 133,34').className).toContain('text-3xl')
    const linha = await screen.findByTestId('atual-k1')
    expect(linha.textContent).toBe('Fatura atual (aberta, vence 25/11): R$ 438,97')
    expect(linha.className).not.toContain('text-3xl')
  })

  it('ciclo atual sem compra e compra só no mês seguinte: a fatura atual é a deste ciclo, sem compras (não a de dezembro)', async () => {
    fixarHoje('2026-11-05')
    mock.listarCartoes.mockResolvedValue([{ ...nubank, divida: c(0), fechamento: 18, vencimento: 28 }])
    mock.listarFaturas.mockResolvedValue([fatura({ mes: '2026-12', fechamento: '2026-12-18', vencimento: '2026-12-28', aCobrar: c(43897), total: c(43897) })])
    render(<Cartoes />)
    expect(await screen.findByText('Sem fatura em aberto')).toBeTruthy()
    expect(screen.getByTestId('atual-k1').textContent).toBe('Fatura atual (vence 28/11): sem compras ainda')
    expect(screen.queryByText('R$ 438,97')).toBeNull()
  })

  it('fecha dia 31: a ajuda de Nova compra e de Crédito diz que em mês curto fecha no último dia', async () => {
    const u = userEvent.setup()
    mock.listarCartoes.mockResolvedValue([{ ...nubank, fechamento: 31, vencimento: 10 }])
    render(<Cartoes />)
    await u.click(await screen.findByRole('button', { name: 'Nova compra' }))
    expect(screen.getByText(/Compra antes do fechamento \(dia 31 ou o último dia do mês, se for mais curto\)/)).toBeTruthy()
    await u.click(screen.getByRole('button', { name: 'Cancelar' }))
    await escolherNoMenu(u, 'Crédito / reembolso')
    expect(screen.getByText(/Crédito antes do fechamento \(dia 31 ou o último dia do mês, se for mais curto\)/)).toBeTruthy()
  })

  it('sem fatura fechada e com a atual zerada (ou sem nenhuma fatura): "Sem fatura em aberto"', async () => {
    fixarHoje('2026-11-05')
    mock.listarCartoes.mockResolvedValue([{ ...nubank, divida: c(0), compromissos: c(0) }])
    mock.listarFaturas.mockResolvedValue([fatura({ mes: '2026-11', fechamento: '2026-11-17', vencimento: '2026-11-25', total: c(0) })])
    render(<Cartoes />)
    expect(await screen.findByText('Sem fatura em aberto')).toBeTruthy()
    expect(screen.getByTestId('atual-k1').textContent).toBe('Fatura atual (vence 25/11): sem compras ainda')
    expect(screen.queryByText(/^Fatura atual \(vence/, { selector: 'dt' })).toBeNull() // nada de valor zero em destaque
    cleanup()
    mock.listarFaturas.mockResolvedValue([])
    render(<Cartoes />)
    expect(await screen.findByText('Sem fatura em aberto')).toBeTruthy()
  })

  it('se a leitura das faturas falhar, não afirma "sem fatura": avisa e o cartão segue', async () => {
    mock.listarCartoes.mockResolvedValue([{ ...nubank, divida: c(0) }])
    mock.listarFaturas.mockRejectedValue(new Error('falhou'))
    render(<Cartoes />)
    expect(await screen.findByText('Não foi possível ler a fatura atual agora.')).toBeTruthy()
    expect(screen.queryByText('Sem fatura em aberto')).toBeNull()
    expect(await botaoVerFatura()).toBeTruthy()
  })

  it('erro ao carregar os itens de uma fatura aparece só ali: as abas de fatura continuam na tela', async () => {
    mock.listarFaturas.mockResolvedValue([fatura({ mes: '2099-01', fechamento: '2099-01-17', aCobrar: c(10000), total: c(10000) })])
    mock.listarItens.mockRejectedValue(new Error('rede'))
    const u = userEvent.setup()
    render(<Cartoes />)
    await u.click(await botaoVerFatura())
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getAllByRole('tab').length).toBeGreaterThan(0)
  })
})

describe('Menos botões: ações secundárias no menu "Mais opções"', () => {
  const OITO = ['Crédito / reembolso', 'Alterar dias', 'Definir limite', 'Banco e bandeira', 'Conta de pagamento', 'Renomear', 'Arquivar', 'Excluir']

  it('no cartão ficam só Ver fatura, Nova compra e o botão "⋯" (#181: "Pagar fatura" mora dentro da fatura)', async () => {
    render(<Cartoes />)
    const cartao = (await screen.findByRole('heading', { name: /Nubank/ })).closest('li')!
    expect(within(cartao).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual([
      // o nome acessível diz o mês da fatura (a atual: sem fatura fechada listada, só o saldo de referência)
      expect.stringMatching(/^Ver fatura de \p{L}+, Nubank$/u), 'Nova compra', 'Mais opções do cartão Nubank',
    ])
    expect(within(cartao).queryByRole('menu')).toBeNull()
  })

  it('o menu abre, lista as 8 ações (Excluir por último, separado e em vermelho) e fecha com Esc devolvendo o foco', async () => {
    const u = userEvent.setup()
    render(<Cartoes />)
    const gatilho = await screen.findByRole('button', { name: 'Mais opções do cartão Nubank' })
    expect(gatilho.getAttribute('aria-haspopup')).toBe('menu')
    expect(gatilho.getAttribute('aria-expanded')).toBe('false')
    await u.click(gatilho)
    expect(gatilho.getAttribute('aria-expanded')).toBe('true')
    const menu = screen.getByRole('menu', { name: 'Mais opções do cartão Nubank' })
    const itens = within(menu).getAllByRole('menuitem')
    expect(itens.map((i) => i.textContent)).toEqual(OITO)
    expect(itens[7].className).toContain('text-negativo')
    expect(within(menu).getByRole('separator')).toBeTruthy()
    expect(document.activeElement).toBe(itens[0]) // abre com o foco na primeira ação
    await u.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(itens[1])
    await u.keyboard('{End}')
    expect(document.activeElement).toBe(itens[7])
    await u.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(itens[0])
    await u.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(gatilho)
  })

  it('clicar fora fecha o menu', async () => {
    const u = userEvent.setup()
    render(<Cartoes />)
    await u.click(await screen.findByRole('button', { name: 'Mais opções do cartão Nubank' }))
    expect(screen.getByRole('menu')).toBeTruthy()
    await u.click(screen.getByText('Fecha dia 17 · vence dia 25'))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it.each([
    ['Crédito / reembolso', () => screen.getByRole('heading', { name: 'Crédito / reembolso · Nubank' })],
    ['Alterar dias', () => screen.getByLabelText('Dia do fechamento')],
    ['Definir limite', () => screen.getByLabelText('Limite do cartão (R$)')],
    ['Banco e bandeira', () => screen.getByLabelText('Banco emissor')],
    ['Conta de pagamento', () => screen.getByRole('heading', { name: 'Conta de pagamento · Nubank' })],
    ['Renomear', () => screen.getByRole('heading', { name: 'Renomear · Nubank' })],
    ['Arquivar', () => screen.getByRole('group', { name: 'Arquivar cartão' })],
    ['Excluir', () => screen.getByRole('group', { name: 'Excluir cartão' })],
  ])('"%s" no menu abre o mesmo diálogo de antes e fecha o menu', async (acao, dialogo) => {
    const u = userEvent.setup()
    render(<Cartoes />)
    await escolherNoMenu(u, acao)
    expect(dialogo()).toBeTruthy()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('Alterar dias avisa a partir de que fatura os dias novos valem (migration 061), só quando muda algo', async () => {
    const u = userEvent.setup()
    render(<Cartoes />)
    await escolherNoMenu(u, 'Alterar dias')
    expect(screen.queryByText(/A mudança vale a partir da fatura que fecha em/)).toBeNull()
    await u.selectOptions(screen.getByLabelText('Dia do fechamento'), '5')
    const desde = inicioDaTroca(hojeSP(), { fechamento: 17, vencimento: 25 }, 5, 25)
    expect(desde).not.toBeNull()
    expect(screen.getByText(`A mudança vale a partir da fatura que fecha em ${formatDate(desde as string)}.`)).toBeTruthy()
  })

  it('com um diálogo aberto, o menu fica desabilitado (como os botões eram)', async () => {
    const u = userEvent.setup()
    render(<Cartoes />)
    await u.click(await screen.findByRole('button', { name: 'Nova compra' }))
    expect((screen.getByRole('button', { name: 'Mais opções do cartão Nubank' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('cartão sem ciclo: Crédito / reembolso desabilitado e "Definir fechamento" no menu', async () => {
    const u = userEvent.setup()
    mock.listarCartoes.mockResolvedValue([{ ...nubank, fechamento: null, vencimento: null }])
    render(<Cartoes />)
    await u.click(await screen.findByRole('button', { name: 'Mais opções do cartão Nubank' }))
    expect((screen.getByRole('menuitem', { name: 'Crédito / reembolso' }) as HTMLButtonElement).disabled).toBe(true)
    await u.click(screen.getByRole('menuitem', { name: 'Definir fechamento' }))
    expect(screen.getByLabelText('Dia do fechamento')).toBeTruthy()
  })
})

describe('Melhorias de uso da aba Cartões (#166)', () => {
  /** AAAA-MM de `n` meses depois de 2025-01. */
  const mesN = (n: number) => `${2025 + Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`
  /** 24 faturas (jan/2025 a dez/2026), as passadas pagas; hoje 05/11/2026, fecha 17: a atual é novembro/2026. */
  const historico = () => Array.from({ length: 24 }, (_, n) => {
    const m = mesN(n)
    const passada = m < '2026-11'
    return fatura({ mes: m, fechamento: `${m}-17`, vencimento: `${m}-25`, total: c(1000 + n), cobrado: passada ? c(1000 + n) : c(0),
      aCobrar: passada ? c(0) : c(1000 + n), pago: passada ? c(1000 + n) : c(0) })
  })

  it('1. o painel abre dentro do próprio cartão, leva o foco ao título e devolve o foco ao botão ao fechar', async () => {
    const u = userEvent.setup()
    mock.listarCartoes.mockResolvedValue([nubank, { ...nubank, id: 'k2', nome: 'Inter' }])
    render(<Cartoes />)
    const cartaoNubank = (await screen.findByRole('heading', { name: /^Nubank/ })).closest('li')!
    await u.click(within(cartaoNubank).getByRole('button', { name: /^Ver fatura/ }))
    const pagar = await within(cartaoNubank).findByRole('button', { name: 'Pagar fatura' })
    await u.click(pagar)
    const titulo = screen.getByRole('heading', { name: 'Pagar fatura · Nubank' })
    expect(cartaoNubank.contains(titulo)).toBe(true) // e não no topo da página
    const cartaoInter = screen.getByRole('heading', { name: /^Inter/ }).closest('li')!
    expect(within(cartaoInter).queryByRole('heading', { name: /Pagar fatura/ })).toBeNull()
    expect(document.activeElement).toBe(titulo)
    await u.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('heading', { name: 'Pagar fatura · Nubank' })).toBeNull()
    expect(document.activeElement).toBe(pagar)
  })

  it('1. pelo menu "⋯": o painel abre no cartão e, ao fechar, o foco volta para o botão do menu', async () => {
    const u = userEvent.setup()
    render(<Cartoes />)
    const cartao = (await screen.findByRole('heading', { name: /^Nubank/ })).closest('li')!
    await escolherNoMenu(u, 'Renomear')
    const titulo = within(cartao).getByRole('heading', { name: 'Renomear · Nubank' })
    expect(document.activeElement).toBe(titulo)
    await u.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Mais opções do cartão Nubank' }))
  })

  it('2. as abas abrem na fatura atual, mostram as 6 anteriores e as próximas, e "Ver mais antigas" mostra o resto', async () => {
    fixarHoje('2026-11-05')
    const u = userEvent.setup()
    mock.listarCartoes.mockResolvedValue([{ ...nubank, divida: c(0) }])
    mock.listarFaturas.mockResolvedValue(historico())
    render(<Cartoes />)
    await u.click(await botaoVerFatura())
    const abas = await screen.findAllByRole('tab')
    expect(abas.map((a) => a.querySelector('span')!.textContent)).toEqual([
      'Maio de 2026', 'Junho de 2026', 'Julho de 2026', 'Agosto de 2026', 'Setembro de 2026', 'Outubro de 2026', 'Novembro de 2026', 'Dezembro de 2026',
    ])
    const escolhida = screen.getByRole('tab', { selected: true })
    expect(escolhida.textContent).toContain('Novembro de 2026')
    expect(escolhida.tabIndex).toBe(0)
    expect(abas[0].tabIndex).toBe(-1)
    await vi.waitFor(() => expect(mock.listarItens).toHaveBeenCalledWith('k1', '2026-11'))
    expect(mock.listarItens).not.toHaveBeenCalledWith('k1', '2025-01')
    const painel = screen.getByRole('tabpanel')
    expect(painel.getAttribute('aria-labelledby')).toBe(escolhida.id)
    await u.click(screen.getByRole('button', { name: 'Ver mais antigas (16 faturas)' }))
    expect(screen.getAllByRole('tab')).toHaveLength(24)
    expect(screen.queryByRole('button', { name: /Ver mais antigas/ })).toBeNull()
    expect(screen.getByRole('tab', { selected: true }).textContent).toContain('Novembro de 2026')
  })

  it('2. setas, Home e End andam entre as abas e já mostram a fatura', async () => {
    fixarHoje('2026-11-05')
    const u = userEvent.setup()
    mock.listarCartoes.mockResolvedValue([{ ...nubank, divida: c(0) }])
    mock.listarFaturas.mockResolvedValue(historico())
    render(<Cartoes />)
    await u.click(await botaoVerFatura())
    const atual = await screen.findByRole('tab', { selected: true })
    atual.focus()
    await u.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { selected: true }).textContent).toContain('Dezembro de 2026')
    expect(document.activeElement).toBe(screen.getByRole('tab', { selected: true }))
    await vi.waitFor(() => expect(mock.listarItens).toHaveBeenCalledWith('k1', '2026-12'))
    await u.keyboard('{ArrowRight}') // volta para a primeira visível
    expect(screen.getByRole('tab', { selected: true }).textContent).toContain('Maio de 2026')
    await u.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { selected: true }).textContent).toContain('Dezembro de 2026')
    await u.keyboard('{Home}')
    expect(screen.getByRole('tab', { selected: true }).textContent).toContain('Maio de 2026')
    await u.keyboard('{End}')
    expect(screen.getByRole('tab', { selected: true }).textContent).toContain('Dezembro de 2026')
  })

  it('2. fatura fechada não paga mais antiga que a janela continua à vista', async () => {
    fixarHoje('2026-11-05')
    const u = userEvent.setup()
    const fs = historico()
    fs[0] = { ...fs[0], pago: c(0) } // jan/2025 ficou sem pagar
    mock.listarFaturas.mockResolvedValue(fs)
    render(<Cartoes />)
    await u.click(await botaoVerFatura())
    expect(await screen.findAllByRole('tab')).toHaveLength(24)
    // #181: "Ver fatura" abre na fatura a pagar (a de jan/2025), a que o "Pagar fatura" dela quita
    expect(screen.getByRole('tab', { selected: true }).textContent).toContain('Janeiro de 2025')
  })

  it('3. resumo: "Faturas que vencem em <mês>" com o total do banco (card_invoices_month), antes dos cartões', async () => {
    fixarHoje('2026-11-05')
    mock.totalFaturasDoMes.mockResolvedValue({ faturas: 2, total: c(50000), pago: c(10000), falta: c(40000) })
    render(<Cartoes />)
    const resumo = await screen.findByRole('complementary', { name: 'Resumo dos cartões' })
    const faixa = await within(resumo).findByTestId('faturas-do-mes')
    expect(mock.totalFaturasDoMes).toHaveBeenCalledWith('h1', '2026-11')
    expect(faixa.textContent).toBe('Faturas que vencem em novembroR$ 500,002 faturas · já pago R$ 100,00 · falta R$ 400,00')
    // no celular vem em cima dos cartões (no computador, ao lado, pela grade)
    expect(resumo.compareDocumentPosition(screen.getByRole('heading', { name: /^Nubank/ })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('3. resumo: "Próxima fatura vence em" é a data mais próxima entre os cartões com algo a pagar (data, não soma)', async () => {
    fixarHoje('2026-11-05')
    mock.listarCartoes.mockResolvedValue([
      { ...nubank, id: 'a', nome: 'Azul', divida: c(0), fechamento: 28, vencimento: 5 },
      { ...nubank, id: 'b', nome: 'Bradesco', divida: c(0), fechamento: 10, vencimento: 20 },
      { ...nubank, id: 'z', nome: 'Zero', divida: c(0), fechamento: 6, vencimento: 8 }, // vence 08/11, mas sem nada a pagar
    ])
    mock.listarFaturas.mockImplementation((id: string) => Promise.resolve(
      id === 'a' ? [fatura({ mes: '2026-11', fechamento: '2026-11-28', vencimento: '2026-12-05', aCobrar: c(1000), total: c(1000) })]
      : id === 'b' ? [fatura({ mes: '2026-11', fechamento: '2026-11-10', vencimento: '2026-11-20', aCobrar: c(2000), total: c(2000) })]
      : []))
    render(<Cartoes />)
    const proxima = await screen.findByTestId('proxima-fatura')
    expect(proxima.textContent).toBe('Próxima fatura vence em20/11/2026Cartão BradescoVer fatura')
    expect(within(proxima).queryByText('Vencida')).toBeNull()
  })

  it('3. resumo com fatura vencida: mostra "vencida desde" em vermelho (sem o selo repetido, #181)', async () => {
    fixarHoje('2026-11-05')
    mock.listarFaturas.mockResolvedValue([fatura({ mes: '2026-10', fechamento: '2026-10-17', vencimento: '2026-10-25', cobrado: c(13334), total: c(13334) })])
    render(<Cartoes />)
    const proxima = await screen.findByTestId('proxima-fatura')
    expect(proxima.textContent).toBe('Fatura vencida desde25/10/2026Cartão NubankVer fatura')
    expect(within(proxima).getByText('25/10/2026').className).toContain('text-prejuizo')
  })

  it('3. sem fatura no mês, ou se a leitura falhar, a faixa não aparece e os cartões seguem', async () => {
    mock.totalFaturasDoMes.mockRejectedValue(new Error('rede'))
    render(<Cartoes />)
    expect(await screen.findByRole('heading', { name: /^Nubank/ })).toBeTruthy()
    expect(screen.queryByTestId('faturas-do-mes')).toBeNull()
  })

  it('4. fatura fechada com vencimento passado: selo "Vencida" no destaque e na aba', async () => {
    fixarHoje('2026-11-05')
    const u = userEvent.setup()
    mock.listarFaturas.mockResolvedValue([
      fatura({ mes: '2026-09', fechamento: '2026-09-17', vencimento: '2026-09-25', cobrado: c(5000), total: c(5000), faturaId: 'f1' }),
      fatura({ mes: '2026-10', fechamento: '2026-10-17', vencimento: '2026-10-25', cobrado: c(8334), total: c(8334), faturaId: 'f2' }),
    ])
    render(<Cartoes />)
    // o vencimento mostrado é o da mais antiga não paga (25/09)
    const destaque = await screen.findByText('Fatura fechada a pagar (venceu 25/09)')
    expect(within(destaque).getByText('Vencida')).toBeTruthy()
    await u.click(await botaoVerFatura())
    const abas = await screen.findAllByRole('tab')
    expect(abas.map((a) => a.textContent)).toEqual(['Setembro de 2026R$ 50,00Vencida', 'Outubro de 2026R$ 83,34Vencida'])
  })

  it('4. fechada mas ainda no prazo: sem selo "Vencida" (fica "Fechada")', async () => {
    fixarHoje('2026-10-20')
    const u = userEvent.setup()
    mock.listarFaturas.mockResolvedValue([
      fatura({ mes: '2026-10', fechamento: '2026-10-17', vencimento: '2026-10-25', cobrado: c(13334), total: c(13334), faturaId: 'f2' }),
    ])
    render(<Cartoes />)
    expect(await screen.findByText('Fatura fechada a pagar (vence 25/10)')).toBeTruthy()
    expect(screen.queryByText('Vencida')).toBeNull()
    await u.click(await botaoVerFatura())
    expect((await screen.findByRole('tab')).textContent).toBe('Outubro de 2026R$ 133,34Fechada')
    // #183: o selo "Fechada" (a pagar) é de atenção, não vermelho
    expect(within(screen.getByRole('tab')).getByText('Fechada').className).toContain('bg-atencao-fundo text-atencao')
  })

  it('5. "Parcelas futuras" virou "A cobrar (atual + futuras)", com a dica', async () => {
    render(<Cartoes />)
    expect(await screen.findByText('A cobrar (atual + futuras)')).toBeTruthy()
    expect(screen.queryByText('Parcelas futuras')).toBeNull()
    const dica = screen.getByText(/Inclui as compras da fatura atual, que ainda não fechou/)
    // auditoria 5h (axe): a dica fica fora do <dl> (texto solto dentro de <dl> é inválido)
    expect(dica.closest('dl')).toBeNull()
    // #183: o valor em verde vem com o rótulo "Agendado" ao lado
    const dd = screen.getByText('A cobrar (atual + futuras)').nextElementSibling as HTMLElement
    expect(dd.tagName).toBe('DD')
    expect(dd.querySelector('.text-agendado')).not.toBeNull()
    expect(within(dd).getByText('Agendado').className).toContain('bg-agendado-fundo text-agendado')
    for (const dl of document.querySelectorAll('dl')) {
      for (const filho of Array.from(dl.children)) {
        const ok = ['DT', 'DD'].includes(filho.tagName) || (filho.tagName === 'DIV' && Array.from(filho.children).every((x) => ['DT', 'DD'].includes(x.tagName)))
        expect(ok).toBe(true)
      }
    }
  })

  it('6. estornar parte de uma parcela na linha da compra: valor até o da parcela, data, e recarrega', async () => {
    fixarHoje('2026-11-05')
    const u = userEvent.setup()
    mock.listarFaturas.mockResolvedValue([fatura({ mes: '2026-11', fechamento: '2026-11-17', vencimento: '2026-11-25', aCobrar: c(10000), total: c(10000), faturaId: 'f9' })])
    mock.listarItens.mockResolvedValue([
      { parcelaId: 'p1', compra: 'x', parcela: 1, deParcelas: 1, descricao: 'TV', dataCompra: '2026-11-01', valor: c(10000), falta: c(10000), categoriaId: 'g1' },
    ])
    render(<Cartoes />)
    await u.click(await botaoVerFatura())
    await acaoDaLinha(u, 'Ações de TV', 'Estornar')
    const form = screen.getByRole('form', { name: 'Estornar TV' })
    expect(form.closest('li')!.textContent).toContain('TV') // abre na linha da compra
    expect(document.activeElement).toBe(form)
    await u.type(within(form).getByLabelText('Valor do estorno (R$)'), '150,00')
    await u.click(within(form).getByRole('button', { name: 'Estornar' }))
    expect(within(form).getByText('No máximo o valor da parcela (R$ 100,00).')).toBeTruthy()
    expect(mock.estornarParcela).not.toHaveBeenCalled()
    const carregou = mock.listarCartoes.mock.calls.length
    await u.clear(within(form).getByLabelText('Valor do estorno (R$)'))
    await u.type(within(form).getByLabelText('Valor do estorno (R$)'), '40,00')
    await u.click(within(form).getByRole('button', { name: 'Estornar' }))
    expect(mock.estornarParcela).toHaveBeenCalledWith('p1', { data: '2026-11-05', valor: 4000, faturaId: 'f9' })
    await vi.waitFor(() => expect(mock.listarCartoes.mock.calls.length).toBeGreaterThan(carregou))
    expect(screen.queryByRole('form', { name: 'Estornar TV' })).toBeNull()
  })

  it('6. a mensagem do banco aparece se o estorno for recusado', async () => {
    const u = userEvent.setup()
    mock.listarFaturas.mockResolvedValue([fatura({ mes: '2099-04', fechamento: '2099-04-17', aCobrar: c(10000), total: c(10000) })])
    mock.listarItens.mockResolvedValue([
      { parcelaId: 'p1', compra: 'x', parcela: 1, deParcelas: 1, descricao: 'TV', dataCompra: '2099-03-15', valor: c(10000), falta: c(10000), categoriaId: 'g1' },
    ])
    mock.estornarParcela.mockRejectedValue({ code: '22023', message: 'valor do estorno inválido' })
    render(<Cartoes />)
    await u.click(await botaoVerFatura())
    await acaoDaLinha(u, 'Ações de TV', 'Estornar')
    await u.type(screen.getByLabelText('Valor do estorno (R$)'), '10,00')
    await u.click(screen.getByRole('button', { name: 'Estornar' }))
    expect(await screen.findByText('Valor do estorno inválido.')).toBeTruthy()
    expect(screen.getByRole('form', { name: 'Estornar TV' })).toBeTruthy()
  })

  it('7. "Melhor dia de compra" no cabeçalho: o dia em que a compra já vai para a fatura seguinte', async () => {
    fixarHoje('2026-11-05')
    mock.listarCartoes.mockResolvedValue([nubank, { ...nubank, id: 'k2', nome: 'Inter', fechamento: null, vencimento: null }])
    render(<Cartoes />)
    const nu = (await screen.findByRole('heading', { name: /^Nubank/ })).closest('li')!
    expect(within(nu).getByText('Melhor dia de compra: 17')).toBeTruthy()
    const inter = screen.getByRole('heading', { name: /^Inter/ }).closest('li')!
    expect(within(inter).queryByText(/Melhor dia de compra/)).toBeNull() // sem ciclo, não inventa
  })

  it('7. melhorDiaDeCompra segue a regra do banco (fechamentoDaCompra) e ajusta ao mês', () => {
    expect(melhorDiaDeCompra('2026-11-05', 17)).toBe(17)
    expect(melhorDiaDeCompra('2026-11-17', 17)).toBe(17) // no próprio dia do fechamento, hoje ainda é o melhor dia
    expect(melhorDiaDeCompra('2026-11-18', 17)).toBe(17)
    expect(melhorDiaDeCompra('2026-11-05', 31)).toBe(30) // novembro tem 30 dias
    expect(melhorDiaDeCompra('2026-02-10', 31)).toBe(28)
    expect(melhorDiaDeCompra('2028-02-10', 30)).toBe(29) // bissexto
    expect(melhorDiaDeCompra('2026-11-05', null)).toBeNull()
    // é mesmo o primeiro dia da fatura seguinte: a véspera cai na de novembro, o dia já na de dezembro
    expect(fechamentoDaCompra('2026-11-16', 17)).toBe('2026-11-17')
    expect(fechamentoDaCompra('2026-11-17', 17)).toBe('2026-12-17')
  })

  it('8. cartões em ordem de próximo vencimento (vencida primeiro); empate pelo nome', async () => {
    fixarHoje('2026-11-05')
    mock.listarCartoes.mockResolvedValue([
      { ...nubank, id: 'a', nome: 'Azul', divida: c(0), fechamento: 28, vencimento: 5 }, // atual vence 05/12
      { ...nubank, id: 'b', nome: 'Bradesco', divida: c(0), fechamento: 10, vencimento: 20 }, // atual vence 20/11
      { ...nubank, id: 'c', nome: 'Caixa', divida: c(5000) }, // fechada vencida em 25/10
      { ...nubank, id: 'd', nome: 'Amarelo', divida: c(0), fechamento: 10, vencimento: 20 }, // empata com Bradesco
    ])
    mock.listarFaturas.mockImplementation((id: string) => Promise.resolve(id === 'c'
      ? [fatura({ mes: '2026-10', fechamento: '2026-10-17', vencimento: '2026-10-25', cobrado: c(5000), total: c(5000) })]
      : []))
    render(<Cartoes />)
    await screen.findByRole('heading', { name: /^Azul/ })
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent?.trim())).toEqual(['Caixa', 'Amarelo', 'Bradesco', 'Azul'])
  })
})

describe('Fatura paga travada (migration 064)', () => {
  // setembro paga (300 de 300), com uma compra, um crédito e dois pagamentos em dias seguidos
  const setembro = fatura({ mes: '2026-09', fechamento: '2026-09-17', vencimento: '2026-09-25', cobrado: c(30000), total: c(30000), pago: c(30000),
    faturaId: 'f9', saldoAnterior: c(1500), itens: 1 })
  const novembro = fatura({ mes: '2026-11', fechamento: '2026-11-17', vencimento: '2026-11-25', aCobrar: c(5000), total: c(5000), faturaId: null })
  const tv = { parcelaId: 'p9', compra: 'x9', parcela: 1, deParcelas: 1, descricao: 'TV', dataCompra: '2026-09-02', valor: c(30000), falta: c(0), categoriaId: 'g1' }

  async function abrirSetembro(u: ReturnType<typeof userEvent.setup>) {
    fixarHoje('2026-11-05')
    mock.listarCartoes.mockResolvedValue([{ ...nubank, divida: c(0) }])
    mock.listarFaturas.mockResolvedValue([setembro, novembro])
    mock.listarItens.mockResolvedValue([tv])
    mock.listarCreditosDaFatura.mockResolvedValue([
      { id: 'cr9', descricao: 'Cashback', dataCredito: '2026-09-03', fechamento: '2026-09-17', valor: c(1000), categoriaId: 'g2' },
    ])
    mock.listarPagamentosDaFatura.mockResolvedValue([
      { id: 'pg1', data: '2026-09-24', valor: c(20000) },
      { id: 'pg2', data: '2026-09-25', valor: c(10000) },
    ])
    render(<Cartoes />)
    await u.click(await botaoVerFatura())
    await u.click(await screen.findByRole('tab', { name: /Setembro/ }))
    await screen.findByText('TV')
  }

  it('aba de fatura paga: sem nenhuma ação de mudar valor; "Paga em dd/mm" (último pagamento) e "travada" com a dica', async () => {
    const u = userEvent.setup()
    await abrirSetembro(u)
    const painel = screen.getByRole('tabpanel')
    for (const nome of [/Reabrir/, /Estornar/, /Editar/, /Excluir compra/, /Anular/, /^Pagar/, /^Ações de /]) {
      expect(within(painel).queryByRole('button', { name: nome })).toBeNull()
    }
    // #183: nem o ⋯ aparece na compra da fatura paga (a linha continua com o valor)
    for (const linha of within(painel).getAllByTestId('compra-fatura')) {
      expect(within(linha).queryByRole('button')).toBeNull()
      expect(linha.querySelector('[data-valor]')).not.toBeNull()
    }
    // #202 (migration 077): o crédito da fatura paga só troca de categoria (classificação); anular continua fora
    await u.click(within(painel).getByRole('button', { name: 'Ações do crédito Cashback' }))
    expect(within(screen.getByRole('menu', { name: 'Ações do crédito Cashback' })).getAllByRole('menuitem').map((i) => i.textContent))
      .toEqual(['Trocar categoria'])
    await u.keyboard('{Escape}')
    const trava = within(painel).getByTestId('fatura-travada')
    expect(trava.textContent).toContain('Paga em 25/09')
    expect(trava.textContent).toContain('Fatura paga — travada')
    expect(trava.textContent).toMatch(/lance um crédito ou estorno na fatura atual/)
    expect(within(painel).getByText(/Fechou em 17\/09/).textContent).toMatch(/Venceu em 25\/09/)
    expect(mock.listarPagamentosDaFatura).toHaveBeenCalledWith('k1', 'f9')
  })

  it('fatura com 2 pagamentos mostra as 2 linhas com as datas; resumo com saldo anterior, gasto do mês e valor pago do banco', async () => {
    const u = userEvent.setup()
    await abrirSetembro(u)
    const lista = screen.getByRole('list', { name: 'Pagamentos da fatura' })
    const linhas = within(lista).getAllByRole('listitem').map((l) => l.textContent?.replace(/\u00a0/g, ' '))
    expect(linhas).toEqual(['Pagamento recebido em 24/09/2026R$ 200,00', 'Pagamento recebido em 25/09/2026R$ 100,00'])
    const resumo = screen.getByLabelText('Resumo da fatura')
    const valor = (rotulo: string) => within(resumo).getByText(rotulo).nextElementSibling?.textContent?.replace(/\u00a0/g, ' ')
    expect(valor('Saldo anterior')).toBe('R$ 15,00')
    expect(valor('Gasto do mês')).toBe('R$ 300,00')
    expect(valor('Valor pago')).toBe('R$ 300,00')
  })

  it('fatura fechada e ainda não paga continua corrigível: Estornar, Editar, Excluir e Anular crédito à vista', async () => {
    const u = userEvent.setup()
    fixarHoje('2026-11-05')
    mock.listarFaturas.mockResolvedValue([{ ...setembro, pago: c(10000) }, novembro])
    mock.listarItens.mockResolvedValue([tv])
    mock.listarCreditosDaFatura.mockResolvedValue([
      { id: 'cr9', descricao: 'Cashback', dataCredito: '2026-09-03', fechamento: '2026-09-17', valor: c(1000), categoriaId: 'g2' },
    ])
    render(<Cartoes />)
    await u.click(await botaoVerFatura())
    await u.click(await screen.findByRole('tab', { name: /Setembro/ }))
    await screen.findByText('TV')
    expect(screen.queryByTestId('fatura-travada')).toBeNull()
    expect(screen.getByRole('button', { name: 'Reabrir fatura' })).toBeTruthy()
    // #183: Estornar · Editar · Excluir num menu ⋯ (não mais três botões de texto ocupando a linha)
    expect(screen.queryByRole('button', { name: 'Estornar TV' })).toBeNull()
    await u.click(screen.getByRole('button', { name: 'Ações de TV' }))
    const menu = screen.getByRole('menu', { name: 'Ações de TV' })
    const itens = within(menu).getAllByRole('menuitem')
    expect(itens.map((i) => i.textContent)).toEqual(['Estornar', 'Editar valor', 'Excluir compra'])
    expect(itens[2].className).toContain('text-negativo') // destrutiva, por último e separada
    expect(within(menu).getByRole('separator')).toBeTruthy()
    await u.keyboard('{Escape}')
    await u.click(screen.getByRole('button', { name: 'Ações do crédito Cashback' }))
    expect(within(screen.getByRole('menu', { name: 'Ações do crédito Cashback' })).getAllByRole('menuitem').map((i) => i.textContent))
      .toEqual(['Trocar categoria', 'Anular crédito'])
  })

  it('#202: "Trocar categoria" num crédito de fatura paga abre o painel com a categoria atual e chama a RPC em lote com o id', async () => {
    const u = userEvent.setup()
    mock.trocarCategoriaDoCredito.mockResolvedValue(1)
    await abrirSetembro(u)
    await acaoDaLinha(u, 'Ações do crédito Cashback', 'Trocar categoria')
    const form = screen.getByRole('form', { name: 'Trocar categoria do crédito' })
    const seletor = within(form).getByLabelText('Categoria de receita') as HTMLSelectElement
    expect(seletor.value).toBe('g2')
    // só categorias de receita (a de despesa não aparece)
    expect(Array.from(seletor.options).map((o) => o.value)).toEqual(['g2', 'g3'])
    await u.selectOptions(seletor, 'g3')
    await u.click(within(form).getByRole('button', { name: 'Salvar categoria' }))
    expect(mock.trocarCategoriaDoCredito).toHaveBeenCalledWith(['cr9'], 'g3')
    expect(mock.listarCreditosDaFatura.mock.calls.length).toBeGreaterThan(1) // recarrega depois de gravar
    expect(screen.queryByRole('form', { name: 'Trocar categoria do crédito' })).toBeNull()
  })

  it('#202: o banco recusa a troca (ex.: categoria inativa) e o painel mostra o erro sem fechar', async () => {
    const u = userEvent.setup()
    mock.trocarCategoriaDoCredito.mockRejectedValue({ code: '23514', message: 'categoria de receita inválida ou inativa' })
    await abrirSetembro(u)
    await acaoDaLinha(u, 'Ações do crédito Cashback', 'Trocar categoria')
    const form = screen.getByRole('form', { name: 'Trocar categoria do crédito' })
    await u.selectOptions(within(form).getByLabelText('Categoria de receita'), 'g3')
    await u.click(within(form).getByRole('button', { name: 'Salvar categoria' }))
    expect(await within(form).findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('form', { name: 'Trocar categoria do crédito' })).toBeTruthy()
  })

  it('#183: na lista de compras o valor tem coluna própria (nunca por cima do nome), o título corta em 2 linhas e a categoria fica embaixo', async () => {
    const u = userEvent.setup()
    fixarHoje('2026-11-05')
    const longa = { ...tv, parcelaId: 'p10', descricao: 'Supermercado do bairro com nome comprido de verdade', valor: c(53456), parcela: 2, deParcelas: 10 }
    mock.listarFaturas.mockResolvedValue([{ ...setembro, pago: c(10000) }, novembro])
    mock.listarItens.mockResolvedValue([longa])
    mock.listarCreditosDaFatura.mockResolvedValue([])
    render(<Cartoes />)
    await u.click(await botaoVerFatura())
    await u.click(await screen.findByRole('tab', { name: /Setembro/ }))
    const titulo = await screen.findByText(longa.descricao)
    const linha = titulo.closest('[data-testid="compra-fatura"]') as HTMLElement
    const grade = linha.firstElementChild as HTMLElement
    expect(grade.className).toContain('grid-cols-[auto_minmax(0,1fr)_auto]')
    expect(grade.children).toHaveLength(3) // ícone | texto | valor + ⋯
    expect(titulo.className).toContain('line-clamp-2')
    const valor = within(linha).getByText(/^−R\$\s?534,56$/)
    expect(valor.className.split(' ')).toEqual(expect.arrayContaining(['whitespace-nowrap', 'tabular-nums', 'text-prejuizo']))
    // o valor não está no mesmo bloco do texto: fica na terceira coluna, junto do ⋯
    expect(grade.children[1].contains(valor)).toBe(false)
    expect(grade.children[2].contains(valor)).toBe(true)
    expect(within(grade.children[2] as HTMLElement).getByRole('button', { name: `Ações de ${longa.descricao}` })).toBeTruthy()
    // categoria e parcela embaixo do título, no bloco do texto
    expect(within(grade.children[1] as HTMLElement).getByText('2/10')).toBeTruthy()
  })

  it('#183: no resumo da fatura (saldo anterior, gasto do mês, valor pago) os valores não quebram e empilham quando falta espaço', async () => {
    const u = userEvent.setup()
    await abrirSetembro(u)
    const resumo = screen.getByLabelText('Resumo da fatura')
    expect(resumo.className.split(' ')).toEqual(expect.arrayContaining(['grid-cols-1', 'sm:grid-cols-3', 'md:grid-cols-1', 'xl:grid-cols-3']))
    for (const rotulo of ['Saldo anterior', 'Gasto do mês', 'Valor pago']) {
      const dd = within(resumo).getByText(rotulo).nextElementSibling as HTMLElement
      expect(dd.className.split(' ')).toEqual(expect.arrayContaining(['whitespace-nowrap', 'tabular-nums']))
    }
  })

  it('"Ver fatura" do destaque abre a fatura a que se refere: a fechada a pagar ou, sem dívida, a atual', async () => {
    fixarHoje('2026-11-05')
    mock.listarFaturas.mockResolvedValue([
      fatura({ mes: '2026-10', fechamento: '2026-10-17', vencimento: '2026-10-25', cobrado: c(13334), total: c(13334), faturaId: 'f3' }),
      novembro,
    ])
    render(<Cartoes />)
    const u = userEvent.setup()
    await u.click(within((await screen.findByRole('heading', { name: /^Nubank/ })).closest('li')!).getByRole('button', { name: 'Ver fatura de outubro, Nubank' }))
    expect((await screen.findByRole('tab', { selected: true })).textContent).toMatch(/^Outubro de 2026/)
    cleanup()
    mock.listarCartoes.mockResolvedValue([{ ...nubank, divida: c(0) }])
    mock.listarFaturas.mockResolvedValue([setembro, novembro])
    render(<Cartoes />)
    // setembro está paga; o botão é da fatura atual (novembro)
    await u.click(within((await screen.findByRole('heading', { name: /^Nubank/ })).closest('li')!).getByRole('button', { name: 'Ver fatura de novembro, Nubank' }))
    expect((await screen.findByRole('tab', { selected: true })).textContent).toMatch(/^Novembro de 2026/)
  })

  it('pagamento de fatura travada: sem "Anular" (só o último, lançado há menos de 24 h, mantém o botão)', async () => {
    const u = userEvent.setup()
    fixarHoje('2026-11-05')
    mock.listarCartoes.mockResolvedValue([{ ...nubank, divida: c(0) }])
    mock.listarFaturas.mockResolvedValue([setembro, { ...novembro, mes: '2026-10', fechamento: '2026-10-17', vencimento: '2026-10-25', cobrado: c(5000), aCobrar: c(0), pago: c(5000), faturaId: 'f10' }])
    mock.listarMovimentosDoCartao.mockResolvedValue([
      { id: 'm2', data: '2026-11-05', tipo: 'pagamento', valor: c(5000), ligadoAFatura: true, faturaId: 'f10', criadoEm: '2026-11-05T14:00:00Z' },
      { id: 'm1', data: '2026-09-25', tipo: 'pagamento', valor: c(30000), ligadoAFatura: true, faturaId: 'f9', criadoEm: '2026-09-25T12:00:00Z' },
    ])
    render(<Cartoes />)
    await u.click(await botaoVerFatura())
    const antiga = (await screen.findByText(/25\/09\/2026 · Pagamento/)).closest('li')!
    expect(within(antiga).queryByRole('button', { name: 'Anular' })).toBeNull()
    expect(within(antiga).getByText('Fatura paga — travada')).toBeTruthy()
    const recente = screen.getByText(/05\/11\/2026 · Pagamento/).closest('li')!
    expect(within(recente).getByRole('button', { name: 'Anular' })).toBeTruthy()
  })
})

describe('Resumo de todos os cartões numa chamada (card_overview, migration 065, #175)', () => {
  const itau = { ...nubank, id: 'k2', nome: 'Itaú', divida: c(0), fechamento: 28, vencimento: 5 }
  /** Resposta do banco: as somas (totais) vêm prontas e de propósito NÃO batem com a soma das linhas (a tela não soma). */
  const visao = (mes: string | null, total: number): VisaoCartoes => ({
    mes,
    cartoes: [
      {
        id: 'k1', nome: 'Nubank',
        doMes: { mes: '2026-11', fechamento: '2026-11-17', vencimento: '2026-11-25', total: c(20000), pago: c(0), situacao: 'aberta' },
        atual: { mes: '2026-11', vencimento: '2026-11-25', total: c(20000) },
        assinaturasPrevistas: c(3990), atualComAssinaturas: c(23990), fechadaMes: '2026-10', fechadaVencimento: '2026-10-25',
      },
      {
        id: 'k2', nome: 'Itaú',
        doMes: { mes: '2026-11', fechamento: '2026-11-28', vencimento: '2026-12-05', total: c(5000), pago: c(0), situacao: 'aberta' },
        atual: { mes: '2026-11', vencimento: '2026-12-05', total: c(5000) },
        assinaturasPrevistas: c(0), atualComAssinaturas: c(5000), fechadaMes: null, fechadaVencimento: null,
      },
    ],
    totais: { faturasDoMes: c(total), pagoDoMes: c(0), assinaturasPrevistas: c(3990), limite: c(800000), limiteUsado: c(200000), limiteDisponivel: c(600000) },
  })
  beforeEach(() => {
    fixarHoje('2026-11-05')
    mock.listarCartoes.mockResolvedValue([nubank, itau])
    mock.visaoDosCartoes.mockImplementation((_: string, mes: string | null) => Promise.resolve(visao(mes, mes === '2026-12' ? 77777 : 99999)))
  })

  it('carrega o resumo com UMA chamada para a família, sem card_months por cartão nem card_invoices_month', async () => {
    render(<Cartoes />)
    await screen.findByTestId('resumo-do-mes')
    expect(mock.visaoDosCartoes).toHaveBeenCalledTimes(1)
    expect(mock.visaoDosCartoes).toHaveBeenCalledWith('h1', '2026-11')
    expect(mock.listarFaturas).not.toHaveBeenCalled()
    expect(mock.totalFaturasDoMes).not.toHaveBeenCalled()
  })

  it('topo: faturas do mês, limite total e disponível vindos do banco, com a barra do limite usado em texto', async () => {
    render(<Cartoes />)
    const resumo = await screen.findByTestId('resumo-do-mes')
    // 999,99 é o total do banco; a soma das linhas daria 250,00
    expect(within(resumo).getByText('Faturas que fecham em novembro')).toBeTruthy()
    expect(within(resumo).getByTestId('total-faturas-mes').textContent).toBe('R$ 999,99')
    expect(within(resumo).queryByText('R$ 250,00')).toBeNull()
    const limite = within(resumo).getByTestId('limite-total')
    expect(within(limite).getByText('Limite total R$ 8.000,00')).toBeTruthy()
    expect(within(limite).getByText('Disponível R$ 6.000,00')).toBeTruthy()
    expect(within(limite).getByRole('img', { name: 'Comprometido R$ 2.000,00 de R$ 8.000,00' })).toBeTruthy()
    // #181: a nota não repete o limite total (já no título da barra)
    expect(limite.textContent).toContain('Usado R$ 2.000,00 · soma dos cartões com limite, hoje.')
    expect(limite.textContent).not.toContain('de R$ 8.000,00')
    // a fatura de cada cartão no mês, com a situação no cadeado (sem selo de texto)
    expect(within(resumo).getByText('Nubank').closest('li')!.textContent).toBe('NubankR$ 200,00')
    expect(within(resumo).getByText('Itaú').closest('li')!.textContent).toBe('ItaúR$ 50,00')
    expect(within(resumo).getAllByRole('img', { name: 'Fatura aberta' })).toHaveLength(2)
  })

  it('seletor de mês: "‹ Novembro de 2026 ›"; trocar o mês faz uma chamada só e muda só o resumo', async () => {
    const u = userEvent.setup()
    render(<Cartoes />)
    const grupo = await screen.findByRole('group', { name: 'Mês do resumo dos cartões' })
    expect(within(grupo).getByText('Novembro de 2026')).toBeTruthy()
    await u.click(within(grupo).getByRole('button', { name: 'Próximo mês (dezembro de 2026)' }))
    expect(within(grupo).getByText('Dezembro de 2026')).toBeTruthy()
    expect(mock.visaoDosCartoes).toHaveBeenLastCalledWith('h1', '2026-12')
    expect(mock.visaoDosCartoes).toHaveBeenCalledTimes(2)
    expect((await screen.findByText('R$ 777,77')).getAttribute('data-testid')).toBe('total-faturas-mes')
    expect(screen.getByText('Faturas que fecham em dezembro')).toBeTruthy()
    // nada mais é recarregado (nem as automações, nem card_months)
    expect(mock.cobrarFaturasFechadas).toHaveBeenCalledTimes(1)
    expect(mock.listarFaturas).not.toHaveBeenCalled()
    await u.click(within(grupo).getByRole('button', { name: /^Mês anterior/ }))
    await u.click(within(grupo).getByRole('button', { name: /^Mês anterior/ }))
    expect(mock.visaoDosCartoes).toHaveBeenLastCalledWith('h1', '2026-10')
  })

  it('destaque: abaixo da fatura atual, "inclui R$ X de assinaturas previstas" (valores do banco); sem previstas, nada', async () => {
    mock.listarCartoes.mockResolvedValue([{ ...nubank, divida: c(0) }, itau])
    render(<Cartoes />)
    const previstas = await screen.findByTestId('previstas-k1')
    // #183: o verde da previsão vem com o rótulo "Agendado"
    expect(previstas.textContent).toBe('Prevista até o fechamento: R$ 239,90 Agendado — inclui R$ 39,90 de assinaturas previstas')
    expect(within(previstas).getByText('Agendado').className).toContain('bg-agendado-fundo text-agendado')
    expect(screen.queryByTestId('previstas-k2')).toBeNull()
  })

  it('destaque com fatura fechada a pagar: o vencimento dela vem do resumo do banco', async () => {
    render(<Cartoes />)
    await screen.findByTestId('resumo-do-mes')
    expect(screen.getByText('Fatura fechada a pagar (venceu 25/10)')).toBeTruthy()
    expect(within(screen.getByRole('heading', { name: /^Nubank/ }).closest('li')!).getByRole('button', { name: 'Ver fatura de outubro, Nubank' })).toBeTruthy()
    expect(screen.getByTestId('previstas-k1').textContent).toContain('inclui R$ 39,90 de assinaturas previstas')
  })

  it('banco sem a 065 (resumo null): volta a ler card_months por cartão e mostra as faturas que vencem no mês', async () => {
    mock.visaoDosCartoes.mockResolvedValue(null)
    mock.totalFaturasDoMes.mockResolvedValue({ faturas: 1, total: c(12300), pago: c(0), falta: c(12300) })
    render(<Cartoes />)
    expect(await screen.findByTestId('faturas-do-mes')).toBeTruthy()
    expect(mock.listarFaturas).toHaveBeenCalledTimes(2)
    expect(screen.queryByTestId('resumo-do-mes')).toBeNull()
  })
})

describe('Visual do resumo e dos botões de fatura (#181, pedido do dono)', () => {
  const linha = (id: string, nome: string, situacao: 'aberta' | 'fechada' | 'paga', vencimento: string, total: number) => ({
    id, nome,
    doMes: { mes: '2026-11', fechamento: '2026-11-03', vencimento, total: c(total), pago: c(situacao === 'paga' ? total : 0), situacao },
    atual: { mes: '2026-11', vencimento, total: c(total) },
    assinaturasPrevistas: c(0), atualComAssinaturas: c(total), fechadaMes: null, fechadaVencimento: null,
  })
  /** Quatro cartões inventados, um por situação (vencida = fechada com vencimento passado). */
  const visao: VisaoCartoes = {
    mes: '2026-11',
    cartoes: [
      linha('k1', 'CARTÃO INFINITO', 'aberta', '2026-11-28', 20000),
      linha('k2', 'Cartão B', 'fechada', '2026-11-10', 5000),
      linha('k3', 'Cartão C', 'paga', '2026-11-09', 3000),
      linha('k4', 'Cartão D', 'fechada', '2026-11-01', 1000),
    ],
    totais: { faturasDoMes: c(29000), pagoDoMes: c(3000), assinaturasPrevistas: c(0), limite: null, limiteUsado: null, limiteDisponivel: null },
  }
  const caixa = { ...nubank, id: 'k1', nome: 'CARTÃO INFINITO', divida: c(0), fechamento: 20, vencimento: 28 }
  beforeEach(() => {
    fixarHoje('2026-11-05')
    mock.listarCartoes.mockResolvedValue([caixa])
    mock.visaoDosCartoes.mockResolvedValue(visao)
  })

  it('cada fatura do resumo tem um cadeado com o rótulo da situação: aberta, fechada, paga e vencida (forma diferente, não só cor)', async () => {
    render(<Cartoes />)
    const bloco = await screen.findByTestId('bloco-faturas-mes')
    const cadeado = (nome: string) => within(within(bloco).getByText(nome).closest('li')!).getByRole('img')
    expect(cadeado('CARTÃO INFINITO').getAttribute('aria-label')).toBe('Fatura aberta')
    expect(cadeado('Cartão B').getAttribute('aria-label')).toBe('Fatura fechada')
    expect(cadeado('Cartão C').getAttribute('aria-label')).toBe('Fatura paga')
    expect(cadeado('Cartão D').getAttribute('aria-label')).toBe('Fatura vencida')
    // o desenho muda em cada situação (cadeado aberto, fechado, com ✓, com !)
    const desenhos = ['CARTÃO INFINITO', 'Cartão B', 'Cartão C', 'Cartão D'].map((n) => cadeado(n).innerHTML)
    expect(new Set(desenhos).size).toBe(4)
    // #183: aberta = agendado (verde), fechada = atenção (âmbar), paga = tudo certo (azul), vencida = prejuízo (vermelho)
    expect(['CARTÃO INFINITO', 'Cartão B', 'Cartão C', 'Cartão D'].map((n) => cadeado(n).className.match(/text-(agendado|atencao|lucro|prejuizo)\b/)?.[0]))
      .toEqual(['text-agendado', 'text-atencao', 'text-lucro', 'text-prejuizo'])
    // o selo de texto saiu
    for (const selo of ['Aberta', 'Fechada', 'Paga', 'Vencida']) expect(within(bloco).queryByText(selo)).toBeNull()
    // e o botão da linha diz a situação em texto para o leitor de tela
    expect(within(bloco).getByRole('button', { name: 'Ver fatura de novembro, Cartão D: fatura vencida, R$ 10,00' })).toBeTruthy()
  })

  it('sem o selo, o nome do cartão fica inteiro ("CARTÃO INFINITO", nome inventado do tamanho do do print), sozinho no espaço que sobra e com o nome completo no title', async () => {
    render(<Cartoes />)
    const nome = await screen.findByTestId('nome-resumo-k1')
    expect(nome.textContent).toBe('CARTÃO INFINITO')
    expect(nome.getAttribute('title')).toBe('CARTÃO INFINITO')
    // o nome ocupa o espaço livre (flex-1) e só corta se não couber; o valor não quebra
    expect(nome.className.split(' ')).toEqual(expect.arrayContaining(['flex-1', 'min-w-0', 'truncate']))
    expect(nome.closest('li')!.textContent).toBe('CARTÃO INFINITOR$ 200,00')
  })

  it('o seletor de mês fica dentro do bloco do resumo, compacto: "‹ Novembro de 2026 ›", sem "Out"/"Dez", setas de 44px', async () => {
    render(<Cartoes />)
    const bloco = await screen.findByTestId('bloco-faturas-mes')
    const grupo = within(bloco).getByRole('group', { name: 'Mês do resumo dos cartões' })
    expect(grupo.textContent).toBe('‹Novembro de 2026›')
    const setas = within(grupo).getAllByRole('button')
    expect(setas.map((b) => b.getAttribute('aria-label'))).toEqual(['Mês anterior (outubro de 2026)', 'Próximo mês (dezembro de 2026)'])
    for (const b of setas) expect(b.className.split(' ')).toEqual(expect.arrayContaining(['min-h-11', 'min-w-11']))
    expect(screen.queryByRole('button', { name: /^Ir para/ })).toBeNull()
  })

  it('"Ver fatura" no resumo abre as faturas daquele cartão na fatura do mês e leva o foco até ela', async () => {
    const rolou = vi.fn()
    Element.prototype.scrollIntoView = rolou
    try {
      mock.listarFaturas.mockResolvedValue([
        fatura({ mes: '2026-10', fechamento: '2026-10-20', vencimento: '2026-10-28', cobrado: c(4000), total: c(4000), pago: c(4000), faturaId: 'f10' }),
        fatura({ mes: '2026-11', fechamento: '2026-11-20', vencimento: '2026-11-28', aCobrar: c(20000), total: c(20000) }),
        fatura({ mes: '2026-12', fechamento: '2026-12-20', vencimento: '2026-12-28', aCobrar: c(900), total: c(900) }),
      ])
      const u = userEvent.setup()
      render(<Cartoes />)
      const bloco = await screen.findByTestId('bloco-faturas-mes')
      expect(screen.queryByRole('tablist')).toBeNull()
      await u.click(within(bloco).getByRole('button', { name: /^Ver fatura de novembro, CARTÃO INFINITO/ }))
      const painel = await screen.findByRole('tabpanel', { name: /^Novembro de 2026/ })
      expect(document.getElementById('cartao-k1')!.contains(painel)).toBe(true)
      expect(screen.getByRole('tab', { selected: true }).textContent).toMatch(/^Novembro de 2026/)
      expect(document.activeElement).toBe(painel)
      expect(rolou).toHaveBeenCalled()
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })

  it('"Pagar fatura" só dentro da fatura não paga (pílula azul); fatura paga fica com "Paga em dd/mm · travada"', async () => {
    const u = userEvent.setup()
    mock.listarFaturas.mockResolvedValue([
      fatura({ mes: '2026-10', fechamento: '2026-10-20', vencimento: '2026-10-28', cobrado: c(4000), total: c(4000), pago: c(4000), faturaId: 'f10' }),
      fatura({ mes: '2026-11', fechamento: '2026-11-20', vencimento: '2026-11-28', aCobrar: c(20000), total: c(20000) }),
    ])
    mock.listarPagamentosDaFatura.mockResolvedValue([{ id: 'pg1', data: '2026-10-27', valor: c(4000) }])
    render(<Cartoes />)
    await screen.findByTestId('bloco-faturas-mes')
    expect(screen.queryByRole('button', { name: /^Pagar fatura/ })).toBeNull() // fora da fatura, não há
    const li = document.getElementById('cartao-k1')!
    await u.click(within(li).getByRole('button', { name: /^Ver fatura/ }))
    const painel = await screen.findByRole('tabpanel', { name: /^Novembro de 2026/ })
    const pagar = within(painel).getByRole('button', { name: 'Pagar fatura' })
    expect(pagar.className.split(' ')).toEqual(expect.arrayContaining(['rounded-full', 'bg-azul-claro', 'text-azul']))
    // o vencimento continua na fatura, não no botão
    expect(within(painel).getByText(/Vence em 28\/11/)).toBeTruthy()
    await u.click(screen.getByRole('tab', { name: /Outubro/ }))
    const paga = await screen.findByRole('tabpanel', { name: /^Outubro de 2026/ })
    expect(within(paga).queryByRole('button', { name: /Pagar/ })).toBeNull()
    expect((await within(paga).findByTestId('fatura-travada')).textContent).toContain('Paga em 27/10 · Fatura paga — travada')
    // o formulário abre dentro da fatura
    await u.click(screen.getByRole('tab', { name: /Novembro/ }))
    await u.click(within(await screen.findByRole('tabpanel', { name: /^Novembro de 2026/ })).getByRole('button', { name: 'Pagar fatura' }))
    expect(within(screen.getByRole('tabpanel')).getByRole('heading', { name: 'Pagar fatura · CARTÃO INFINITO' })).toBeTruthy()
  })

  it('com fatura fechada a pagar, só ela tem "Pagar fatura"; a aberta diz para abrir a fechada (o pagamento quita a mais antiga)', async () => {
    const u = userEvent.setup()
    mock.listarCartoes.mockResolvedValue([{ ...caixa, divida: c(4000) }])
    mock.listarFaturas.mockResolvedValue([
      fatura({ mes: '2026-10', fechamento: '2026-10-20', vencimento: '2026-10-28', cobrado: c(4000), total: c(4000), faturaId: 'f10' }),
      fatura({ mes: '2026-11', fechamento: '2026-11-20', vencimento: '2026-11-28', aCobrar: c(20000), total: c(20000) }),
    ])
    mock.visaoDosCartoes.mockResolvedValue(null)
    render(<Cartoes />)
    await u.click(await botaoVerFatura('CARTÃO INFINITO'))
    const fechada = await screen.findByRole('tabpanel', { name: /^Outubro de 2026/ })
    expect(within(fechada).getByRole('button', { name: 'Pagar fatura' })).toBeTruthy()
    await u.click(screen.getByRole('tab', { name: /Novembro/ }))
    const aberta = await screen.findByRole('tabpanel', { name: /^Novembro de 2026/ })
    expect(within(aberta).queryByRole('button', { name: 'Pagar fatura' })).toBeNull()
    expect(within(aberta).getByText(/Para pagar, abra a fatura de outubro de 2026/)).toBeTruthy()
  })
  it('"Próxima fatura vence em" não repete "Cartão" quando o nome já começa com ele', async () => {
    mock.listarCartoes.mockResolvedValue([{ ...caixa, nome: 'Cartão Verde', divida: c(4000) }])
    mock.visaoDosCartoes.mockResolvedValue(null)
    mock.listarFaturas.mockResolvedValue([fatura({ mes: '2026-11', fechamento: '2026-11-03', vencimento: '2026-11-10', cobrado: c(4000), total: c(4000) })])
    render(<Cartoes />)
    expect((await screen.findByTestId('proxima-fatura')).textContent).toBe('Próxima fatura vence em10/11/2026Cartão VerdeVer fatura')
  })
})
