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
  listarFaturas: vi.fn(),
  listarItens: vi.fn(),
  pagarFatura: vi.fn(),
  reabrirFatura: vi.fn(),
  previaExclusao: vi.fn(),
  excluirCompra: vi.fn(),
  editarParcela: vi.fn(),
  listarContas: vi.fn(),
  listarCategorias: vi.fn(),
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
}))
vi.mock('../lib/recorrencias', () => ({ gerarOcorrencias: () => Promise.resolve(0) }))
vi.mock('../lib/contas', async (o) => ({ ...(await o<typeof import('../lib/contas')>()), listarContas: mock.listarContas }))
vi.mock('../lib/categorias', async (o) => ({ ...(await o<typeof import('../lib/categorias')>()), listarCategorias: mock.listarCategorias }))

import Cartoes from './Cartoes'
import { ontemSP, proximaFatura, situacaoFatura } from '../lib/cartoes'
import type { Fatura } from '../lib/cartoes'

const c = (n: number) => n as Cents
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
  ])
  mock.listarFaturas.mockResolvedValue([])
  mock.listarItens.mockResolvedValue([])
  mock.previaExclusao.mockResolvedValue([])
  mock.listarCreditosDaFatura.mockResolvedValue([])
  mock.lancarCreditoNoCartao.mockResolvedValue('ev1')
  for (const f of [mock.criarCartao, mock.definirCiclo, mock.definirLimite, mock.definirIdentidade, mock.arquivarCartao, mock.renomearCartao, mock.definirContaPagamento, mock.reativarCartao, mock.excluirCartao, mock.registrarCompra, mock.pagarFatura, mock.reabrirFatura, mock.excluirCompra, mock.editarParcela]) f.mockResolvedValue(undefined)
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

  it('a ação principal segue a fatura: com fatura a pagar é "Pagar fatura" (valor em vermelho); sem ela, "Nova compra"', async () => {
    const { unmount } = render(<Cartoes />)
    await screen.findByText('Nubank')
    expect(screen.getByRole('button', { name: 'Pagar fatura' }).className.split(' ')).toContain('bg-azul')
    expect(screen.getByRole('button', { name: 'Nova compra' }).className.split(' ')).not.toContain('bg-azul')
    expect(screen.getByText('R$ 133,34').className).toContain('text-negativo')
    unmount()

    mock.listarCartoes.mockResolvedValue([{ ...nubank, divida: c(0) }])
    render(<Cartoes />)
    await screen.findByText('Nubank')
    expect(screen.getByRole('button', { name: 'Nova compra' }).className.split(' ')).toContain('bg-azul')
    expect(screen.getByRole('button', { name: 'Pagar fatura' }).className.split(' ')).not.toContain('bg-azul')
    expect(screen.getByText('R$ 0,00').className).not.toContain('text-negativo')
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
    await u.click(await screen.findByRole('button', { name: 'Escolher banco e bandeira' }))
    await u.selectOptions(screen.getByLabelText('Banco emissor'), 'Itaú')
    await u.selectOptions(screen.getByLabelText('Bandeira'), 'Visa')
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(mock.definirIdentidade).toHaveBeenCalledWith('k1', 'itau', 'visa')
    cleanup()
    mock.listarCartoes.mockResolvedValue([{ ...nubank, emissor: 'itau', bandeira: 'visa' }])
    render(<Cartoes />)
    await u.click(await screen.findByRole('button', { name: 'Banco e bandeira' }))
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
    await u.click(await screen.findByRole('button', { name: 'Pagar fatura' }))
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
    const botao = (await screen.findByRole('button', { name: 'Pagar fatura' })) as HTMLButtonElement
    expect(botao.disabled).toBe(false)
    const aviso = await screen.findByText(/Não há fatura fechada/)
    expect(aviso.textContent).toMatch(/R\$ 200,00/)
    expect(aviso.textContent).toMatch(/fecha no dia 17/)
    expect(aviso.textContent).toMatch(/vira crédito no cartão/)
    expect(botao.getAttribute('aria-describedby')).toBe(aviso.id)

    await u.click(botao)
    expect((screen.getByLabelText('Valor (R$)') as HTMLInputElement).value).toBe('') // sem dívida, não sugere valor
    await u.selectOptions(screen.getByLabelText('Pagar com a conta'), 'a1')
    await u.type(screen.getByLabelText('Valor (R$)'), '120,00')
    expect(await screen.findByText(/fica como crédito no cartão/)).toBeTruthy()
    await u.click(screen.getByRole('button', { name: 'Registrar pagamento' }))
    expect(mock.pagarFatura).toHaveBeenCalledWith('k1', expect.objectContaining({ contaId: 'a1', valor: 12000, faturaId: null }), expect.any(String))
  })

  it('pagar mais que a fatura fechada: o excedente vira crédito e a tela avisa; mais que tudo, pede para conferir', async () => {
    const u = userEvent.setup()
    mock.listarFaturas.mockResolvedValue([fatura({ mes: '2026-03', fechamento: '2026-03-17', cobrado: c(13334), total: c(13334), faturaId: 'f3' })])
    render(<Cartoes />)
    await u.click(await screen.findByRole('button', { name: 'Pagar fatura' }))
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
    await u.click(await screen.findByRole('button', { name: 'Pagar fatura' }))
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
    await u.click(await screen.findByRole('button', { name: 'Ver faturas' }))
    // o total da fatura aberta aparece na "Próxima fatura" do cartão e na lista de faturas
    expect((await screen.findAllByText('R$ 180,00')).length).toBe(2)
    expect(await screen.findByText('2/3')).toBeTruthy()
    expect(screen.getByText('Aberta')).toBeTruthy()
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
    await u.click(await screen.findByRole('button', { name: 'Ver faturas' }))
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
    await u.click(await screen.findByRole('button', { name: 'Ver faturas' }))
    const linha = (await screen.findByText('Viagem')).closest('li')!
    expect(linha.querySelector('[data-icone]')!.getAttribute('data-icone')).toBe('sacola') // g1 = Compras pessoais
  })

  const item = { parcelaId: 'p1', compra: 'x', parcela: 2, deParcelas: 3, descricao: 'TV', dataCompra: '2099-03-15', valor: c(10000), falta: c(10000), categoriaId: 'g1' }
  const abrirFatura = async (u: ReturnType<typeof userEvent.setup>, f: Partial<Fatura> = {}) => {
    mock.listarFaturas.mockResolvedValue([fatura({ mes: '2099-04', fechamento: '2099-04-17', aCobrar: c(10000), total: c(10000), itens: 1, ...f })])
    mock.listarItens.mockResolvedValue([item])
    render(<Cartoes />)
    await u.click(await screen.findByRole('button', { name: 'Ver faturas' }))
    await screen.findByText('2/3')
  }

  it('edita o valor de uma parcela (só ela)', async () => {
    const u = userEvent.setup()
    await abrirFatura(u)
    await u.click(screen.getByRole('button', { name: 'Editar valor de TV' }))
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
    await u.click(screen.getByRole('button', { name: 'Excluir compra TV' }))
    expect(await screen.findByText(/o dinheiro volta para/)).toBeTruthy()
    expect(screen.getByText('Itaú')).toBeTruthy()
    expect(mock.excluirCompra).not.toHaveBeenCalled()
    await u.click(screen.getByRole('button', { name: 'Excluir compra' }))
    expect(mock.excluirCompra).toHaveBeenCalledWith('k1', 'x')
  })

  it('reabrir fatura paga pede confirmação e chama o banco', async () => {
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
    await u.click(await screen.findByRole('button', { name: 'Crédito / reembolso' }))
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
    await u.click(await screen.findByRole('button', { name: 'Crédito / reembolso' }))
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

  it('o crédito aparece na fatura em verde, com sinal +, e pode ser anulado', async () => {
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
    expect(valor.className).toContain('text-positivo')
    expect(within(linha).getByText(/Salário · receita/)).toBeTruthy()
    expect(screen.getByText(/Créditos e reembolsos nesta fatura.*R\$\s?50,00/)).toBeTruthy()
    await u.click(within(linha).getByRole('button', { name: 'Anular crédito Reembolso do plano' }))
    expect(mock.anularMovimentoCartao).toHaveBeenCalledWith('ev9', expect.any(String))
  })

  it('mostra saldo anterior e adiantamento da fatura', async () => {
    const u = userEvent.setup()
    await abrirFatura(u, { saldoAnterior: c(4000), adiantamentoSaida: c(2500) })
    expect(screen.getByText(/Saldo anterior.*R\$\s?40,00/)).toBeTruthy()
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
    await u.click(await screen.findByRole('button', { name: 'Ver faturas' }))
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
    expect(screen.getByRole('button', { name: 'Definir limite' })).toBeTruthy()
  })

  it('com limite, mostra limite, disponível e comprometido vindos do banco', async () => {
    mock.listarCartoes.mockResolvedValue([comLimite])
    render(<Cartoes />)
    expect(await screen.findByText('Limite R$ 5.800,00')).toBeTruthy()
    expect(screen.getByText('Disponível R$ 5.270,00')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Comprometido R$ 530,00 de R$ 5.800,00' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Alterar limite' })).toBeTruthy()
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
    await u.click(await screen.findByRole('button', { name: 'Definir limite' }))
    await u.type(screen.getByLabelText('Limite do cartão (R$)'), '5.800,00')
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(mock.definirLimite).toHaveBeenCalledWith('k1', 580000)
  })

  it('campo em branco remove o limite', async () => {
    const u = userEvent.setup()
    mock.listarCartoes.mockResolvedValue([comLimite])
    render(<Cartoes />)
    await u.click(await screen.findByRole('button', { name: 'Alterar limite' }))
    await u.clear(screen.getByLabelText('Limite do cartão (R$)'))
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(mock.definirLimite).toHaveBeenCalledWith('k1', null)
  })

  it('valor inválido ou zero não chega ao banco', async () => {
    const u = userEvent.setup()
    render(<Cartoes />)
    await u.click(await screen.findByRole('button', { name: 'Definir limite' }))
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
    await u.click(await screen.findByRole('button', { name: 'Arquivar' }))
    expect(mock.arquivarCartao).not.toHaveBeenCalled()
    await u.click(within(screen.getByRole('group', { name: 'Arquivar cartão' })).getByRole('button', { name: 'Arquivar cartão' }))
    expect(mock.arquivarCartao).toHaveBeenCalledWith('k1')
  })

  it('excluir cartão chama o banco depois da confirmação', async () => {
    render(<Cartoes />)
    const u = userEvent.setup()
    await u.click(await screen.findByRole('button', { name: 'Excluir' }))
    await u.click(within(screen.getByRole('group', { name: 'Excluir cartão' })).getByRole('button', { name: 'Excluir cartão' }))
    expect(mock.excluirCartao).toHaveBeenCalledWith('k1')
  })

  it('com histórico o banco recusa e a regra aparece na tela', async () => {
    mock.excluirCartao.mockRejectedValue({ code: '23503', message: 'tem histórico: só é possível arquivar' })
    render(<Cartoes />)
    const u = userEvent.setup()
    await u.click(await screen.findByRole('button', { name: 'Excluir' }))
    await u.click(within(screen.getByRole('group', { name: 'Excluir cartão' })).getByRole('button', { name: 'Excluir cartão' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Tem histórico: só é possível arquivar.')
  })

  it('arquivado sai da lista principal, aparece em Arquivados e reativa', async () => {
    mock.listarCartoes.mockResolvedValue([nubank, { ...nubank, id: 'k2', nome: 'Cartão antigo', ativo: false }])
    render(<Cartoes />)
    const secao = (await screen.findByRole('heading', { name: 'Arquivados' })).closest('section')!
    expect(within(secao).getByText(/Cartão antigo/)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Arquivar' })).toHaveLength(1) // só o cartão ativo tem Arquivar
    expect(screen.queryAllByText(/Fatura a pagar/)).toHaveLength(1)
    await userEvent.setup().click(within(secao).getByRole('button', { name: 'Reativar' }))
    expect(mock.reativarCartao).toHaveBeenCalledWith('k2')
  })

  it('sem cartão arquivado não mostra a seção', async () => {
    render(<Cartoes />)
    await screen.findByRole('button', { name: 'Arquivar' })
    expect(screen.queryByRole('heading', { name: 'Arquivados' })).toBeNull()
  })
})

describe('Renomear cartão', () => {
  it('abre com o nome atual e grava o nome aparado', async () => {
    render(<Cartoes />)
    const u = userEvent.setup()
    await u.click(await screen.findByRole('button', { name: 'Renomear' }))
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
    await u.click(await screen.findByRole('button', { name: 'Renomear' }))
    await u.clear(screen.getByLabelText('Nome do cartão'))
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText('Use de 1 a 60 caracteres.')).toBeTruthy()
    expect(mock.renomearCartao).not.toHaveBeenCalled()
  })

  it('nome repetido mostra a mensagem do banco', async () => {
    mock.renomearCartao.mockRejectedValue({ code: '23505', message: 'duplicate key value violates unique constraint "debts_name_uq"' })
    render(<Cartoes />)
    const u = userEvent.setup()
    await u.click(await screen.findByRole('button', { name: 'Renomear' }))
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
    await u.click(screen.getByRole('button', { name: 'Conta de pagamento' }))
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
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Pagar fatura' }))
    expect((screen.getByLabelText('Pagar com a conta') as HTMLSelectElement).value).toBe('a2')
  })

  it('conta de pagamento arquivada não é pré-selecionada', async () => {
    mock.listarContas.mockResolvedValue({ contas: [
      { id: 'a1', nome: 'Itaú', tipo: 'checking', saldoInicial: c(0), abertura: '2026-01-01', ativa: true, saldo: c(500000) },
      { id: 'a2', nome: 'Antiga', tipo: 'checking', saldoInicial: c(0), abertura: '2026-01-01', ativa: false, saldo: c(0) },
    ], total: c(500000) })
    mock.listarCartoes.mockResolvedValue([{ ...nubank, contaPagamentoId: 'a2' }])
    render(<Cartoes />)
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Pagar fatura' }))
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
    await u.click(await screen.findByRole('button', { name: 'Escolher conta de pagamento' }))
    expect(opcoes('Conta que paga a fatura')).toContain('Itaú')
    expect(opcoes('Conta que paga a fatura')).not.toContain('Conta em dólar')
    await u.click(screen.getByRole('button', { name: 'Cancelar' }))
    await u.click(screen.getByRole('button', { name: 'Pagar fatura' }))
    expect(opcoes('Pagar com a conta')).toContain('Itaú')
    expect(opcoes('Pagar com a conta')).not.toContain('Conta em dólar')
  })
})

describe('Próxima fatura', () => {
  it('escolhe a aberta que fecha primeiro e ignora fechada e paga', () => {
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

  it('mostra o valor da próxima fatura mesmo com "Fatura a pagar" zerada', async () => {
    mock.listarFaturas.mockResolvedValue([fatura({ mes: '2099-12', fechamento: '2099-12-18', vencimento: '2099-12-28', aCobrar: c(43897), total: c(43897) })])
    render(<Cartoes />)
    const linha = await screen.findByTestId('proxima-k1')
    expect(linha.textContent).toContain('Próxima fatura (vence 28/12)')
    expect(linha.textContent).toContain('R$ 438,97')
  })

  it('sem fatura aberta, ou se a leitura das faturas falhar, não mostra a linha e o cartão segue', async () => {
    render(<Cartoes />)
    await screen.findByRole('button', { name: 'Pagar fatura' })
    expect(screen.queryByTestId('proxima-k1')).toBeNull()
    cleanup()
    mock.listarFaturas.mockRejectedValue(new Error('falhou'))
    render(<Cartoes />)
    await screen.findByRole('button', { name: 'Pagar fatura' })
    expect(screen.queryByTestId('proxima-k1')).toBeNull()
  })

  it('erro ao carregar os itens de uma fatura aparece só ali: as abas de fatura continuam na tela', async () => {
    mock.listarFaturas.mockResolvedValue([fatura({ mes: '2099-01', fechamento: '2099-01-17', aCobrar: c(10000), total: c(10000) })])
    mock.listarItens.mockRejectedValue(new Error('rede'))
    const u = userEvent.setup()
    render(<Cartoes />)
    await u.click(await screen.findByRole('button', { name: 'Ver faturas' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getAllByRole('tab').length).toBeGreaterThan(0)
  })
})
